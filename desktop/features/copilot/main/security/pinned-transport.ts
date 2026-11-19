/*
 * The socket a guarded request actually gets (section 7.3 of the plan).
 *
 * `egress-guard.ts` decides whether a destination may be contacted, and it decides
 * that from the addresses the host resolved to. That decision is only worth
 * something if the bytes afterwards go to one of those addresses. Handing a `pin`
 * to an ordinary `fetch` does not achieve that: `fetch` has no such option, ignores
 * it, and does its own lookup, so a host that answers with a local address at check
 * time and a public one a millisecond later sends a local-only business's content
 * to the cloud. That is DNS rebinding, and the guard's own comment described the
 * recheck after the response as a backstop rather than a fix.
 *
 * This module is the fix. It dials with `node:http` / `node:https` and supplies the
 * socket a `lookup` of its own, which answers with the verified address and never
 * calls a resolver. There is therefore no lookup between the check and the connect
 * for an attacker to win: the only name that can be dialled is the one that was
 * classified, and the only address is the one that was returned.
 *
 * Four decisions carry the rest.
 *
 * 1. The verified address is the address, but the verified name stays the name.
 *    `servername` is set to the hostname from the pin, so the TLS handshake sends
 *    that name (SNI) and the certificate is validated against it. Connecting to an
 *    IP while presenting the IP as the identity would defeat the certificate: a
 *    valid certificate for `api.example.com` would no longer be required to belong
 *    to `api.example.com`. `rejectUnauthorized` is never set, here or anywhere, so
 *    a self-signed or wrong-name certificate still fails.
 *
 * 2. A lookup for any other name is refused rather than answered. Node asks the
 *    lookup function for whatever host it is connecting to; if that is not the
 *    pinned name, something in the chain is not what the guard checked, and
 *    answering anyway would hand it the address it asked for under a name nobody
 *    vetted.
 *
 * 3. Several verified addresses are tried in turn, and only for connection-level
 *    failures. A host with both an IPv4 and an IPv6 address is normal, and failing
 *    the whole call because the first address was unreachable would report a
 *    working provider as broken. A response, once received, is never retried: that
 *    would mean sending the request twice.
 *
 * 4. The address actually used is reported on the response. A response whose
 *    reachability cannot be stated would leave the guard's backstop with nothing to
 *    check, and a silent transport is a transport nobody can audit.
 *
 * Errors leaving this module are rebuilt, not passed through. A Node network error
 * carries the host and port in its message and, for `ENOTFOUND`, the name that was
 * asked for; a provider URL can carry an API key in its query string, and a name is
 * one step from it. Only a short code survives, which is enough to tell
 * `ECONNREFUSED` from `ENOTFOUND` without carrying anything from the provider.
 */
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/**
 * The addresses a hop was verified to resolve to.
 *
 * Structurally the same as `GuardPin` in the guard. Declared again here rather than
 * imported so that this module depends on nothing in it: the guard imports this
 * one, and a cycle between the two would be a runtime order problem for one file
 * that only ever needs the other's type.
 */
export interface PinnedTarget {
  readonly hostname: string
  readonly addresses: readonly string[]
}

/** What the guard hands over. Mirrors `GuardFetch`, for the same reason. */
export interface PinnedRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  redirect?: 'manual'
  pin: PinnedTarget
}

/** The part of a response an adapter reads, plus the address that answered it. */
export interface PinnedResponse {
  readonly status: number
  readonly ok: boolean
  readonly headers: { get: (name: string) => string | null }
  text: () => Promise<string>
  json: () => Promise<unknown>
  /**
   * The body as it arrives, chunk by chunk.
   *
   * A conversation reply is a stream, and a caller that only learns the first
   * word once the last one has arrived has not streamed anything. This is the one
   * way to read a body before it is complete.
   *
   * Reading the body this way and reading it as text are alternatives, not both:
   * a socket delivers its bytes once. The second read of either kind is refused
   * rather than answered with whatever remains, because a half body returned as a
   * whole one is the kind of quiet wrong answer this app works hard to avoid.
   */
  bytes: () => AsyncIterable<Uint8Array>
  readonly url: string
  readonly connectedAddress: string
}

export interface PinnedTransportOptions {
  /** How long the whole call may take when the caller supplies no signal. */
  timeoutMs?: number
  /**
   * Cap on a buffered response body. A provider that never closes its stream would
   * otherwise be read until memory runs out, and an oversized reply is a fault to
   * report rather than a payload to hold.
   */
  maxResponseBytes?: number
}

export type PinnedTransport = (url: string, init: PinnedRequestInit) => Promise<PinnedResponse>

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/**
 * Connection failures worth trying the next verified address for.
 *
 * A TLS or HTTP-level failure is deliberately absent: those mean the address
 * answered, and repeating the request somewhere else would be a second request
 * rather than a retry.
 */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'ETIMEDOUT',
  'EADDRNOTAVAIL',
])

/** Node error codes and names are short upper-case tokens; anything else is not one. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,39}$/

/**
 * A failure with a code and no description.
 *
 * The message is fixed because the original one is not safe to repeat: it names the
 * host, the port, or both.
 */
function codedError (code: string): Error & { code: string } {
  const error = new Error('The request could not be completed.') as Error & { code: string }
  error.code = code
  return error
}

/** A cancellation, named so that callers can tell it from a failure. */
function abortError (): Error {
  const cancelled = new Error('The request was cancelled.')
  cancelled.name = 'AbortError'
  return cancelled
}

/** The code of a thrown error, reduced to a token or replaced with `unknown`. */
function codeOf (error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown'
  try {
    const value = (error as { code?: unknown }).code
    if (typeof value === 'string' && SAFE_CODE.test(value)) return value
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

/** A host without its IPv6 brackets, which is the spelling DNS and `isIP` expect. */
function bareHost (host: string): string {
  const text = String(host ?? '').trim().toLowerCase()
  if (text.startsWith('[') && text.endsWith(']')) return text.slice(1, -1)
  return text
}

/**
 * The `lookup` a pinned socket uses instead of resolving anything.
 *
 * `all` is honoured because Node passes it when it wants every address at once; a
 * lookup that always answers in the single-address shape fails those callers with a
 * confusing error rather than a connection.
 */
function createPinnedLookup (pin: PinnedTarget, address: string): (hostname: string, options: unknown, callback: (...args: unknown[]) => void) => void {
  const expected = bareHost(pin.hostname)
  const family = isIP(address)

  return (hostname, options, callback) => {
    if (bareHost(hostname) !== expected) {
      // Answering would resolve a name the guard never classified.
      callback(codedError('EPINNEDHOST'))
      return
    }
    if (family === 0) {
      callback(codedError('EINVAL'))
      return
    }
    const wantsAll = typeof options === 'object' && options !== null && (options as { all?: unknown }).all === true
    if (wantsAll) callback(null, [{ address, family }])
    else callback(null, address, family)
  }
}

/**
 * The options one attempt is made with, exported so the identity rule can be read
 * and tested without a certificate.
 *
 * `servername` is the pinned hostname and not the address. That is the line that
 * keeps a pinned connection from turning into an unverified one: the certificate
 * must still name the host the caller asked for.
 */
export function buildPinnedRequestOptions (
  pin: PinnedTarget,
  address: string,
  init: PinnedRequestInit,
): https.RequestOptions {
  const hostname = bareHost(pin.hostname)
  const options: https.RequestOptions = {
    method: (init.method ?? 'GET').toUpperCase(),
    headers: init.headers ?? {},
    lookup: createPinnedLookup(pin, address) as unknown as https.RequestOptions['lookup'],
  }

  // An IP literal has no name to present, and SNI forbids one. Node's own
  // behaviour is the same, and leaving it unset keeps `servername || host` in the
  // certificate check pointing at the host the URL named.
  if (isIP(hostname) === 0) options.servername = hostname

  return options
}

/** The body as bytes, or a refusal when it is not something that can be sent. */
function bodyBytes (body: unknown): Buffer | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  // A plain object would be silently sent as "[object Object]", which is a bug the
  // provider would report much later as a malformed request.
  throw new TypeError('a pinned request body must be a string, a Buffer or undefined')
}

/** One header, as a string, however Node happened to store it. */
function headerValue (res: http.IncomingMessage, name: string): string | null {
  const value = res.headers[name.toLowerCase()]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join(', ')
  return null
}

/**
 * The body, read once, up to a cap.
 *
 * Cached because a caller may ask for the text and then the JSON, and a stream can
 * only be read once.
 */
function createBodyReader (
  res: http.IncomingMessage,
  maxBytes: number,
  claim: () => void,
): () => Promise<string> {
  let pending: Promise<string> | null = null

  return () => {
    if (pending !== null) return pending
    claim()
    pending = new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0

      res.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > maxBytes) {
          // Stop reading rather than growing without bound, and say why.
          res.destroy()
          reject(codedError('RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      res.on('error', (error: unknown) => reject(codedError(codeOf(error))))
    })
    return pending
  }
}

/**
 * The body as it arrives.
 *
 * Node's message is already an async iterable of chunks, so the loop below is the
 * whole mechanism: each chunk is handed on the moment it lands, which is what
 * makes a delta visible before the response finishes. The cap and the abort are
 * the same two rules the buffered reader keeps - stop rather than grow without
 * bound, and stop when the caller cancels - applied to a body that is never held
 * whole.
 */
function createByteStream (
  res: http.IncomingMessage,
  maxBytes: number,
  claim: () => void,
): () => AsyncIterable<Uint8Array> {
  return () => {
    claim()
    return (async function* streamBody (): AsyncGenerator<Uint8Array> {
      let total = 0
      try {
        for await (const chunk of res as AsyncIterable<Buffer | Uint8Array>) {
          const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk)
          total += bytes.length
          if (total > maxBytes) {
            res.destroy()
            throw codedError('RESPONSE_TOO_LARGE')
          }
          yield bytes
        }
      } catch (error) {
        // The cap above is this module's own refusal and keeps its code; anything
        // else is the socket failing or the call being cancelled, and its code is
        // the most a caller may be told.
        if (error instanceof Error && (error as { code?: unknown }).code === 'RESPONSE_TOO_LARGE') throw error
        throw codedError(codeOf(error))
      }
    })()
  }
}

function adaptResponse (
  res: http.IncomingMessage,
  url: string,
  address: string,
  maxBytes: number,
): PinnedResponse {
  const status = res.statusCode ?? 0
  let claimed = false

  /*
   * One body, one reader. Whichever comes first claims it, and the other is
   * refused rather than answered with an empty remainder that would look like a
   * provider sending nothing.
   */
  const claim = (): void => {
    if (claimed) throw codedError('EBODYALREADYREAD')
    claimed = true
  }

  const readText = createBodyReader(res, maxBytes, claim)

  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headerValue(res, name) },
    text: readText,
    json: async () => JSON.parse(await readText()) as unknown,
    bytes: createByteStream(res, maxBytes, claim),
    url,
    connectedAddress: address,
  }
}

/**
 * One attempt against one verified address.
 *
 * Resolves as soon as the status line and headers arrive, so a streaming adapter
 * can consume the body as it comes. Nothing here follows a redirect: the guard asks
 * for `redirect: 'manual'` and follows a hop itself, because a hop it did not
 * classify is a hop it cannot allow.
 */
async function attempt (
  url: URL,
  init: PinnedRequestInit,
  address: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<PinnedResponse> {
  const options = buildPinnedRequestOptions(init.pin, address, init)
  const signal = init.signal

  if (signal?.aborted === true) throw abortError()

  return await new Promise<PinnedResponse>((resolve, reject) => {
    let settled = false
    let response: http.IncomingMessage | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function onAbort (): void {
      const cancelled = abortError()
      // Destroying the response as well as the request is what stops a body read
      // from continuing after the caller has finished with the call.
      response?.destroy(cancelled)
      request.destroy(cancelled)
      fail(cancelled)
    }

    const request = url.protocol === 'https:'
      ? https.request(url, options as https.RequestOptions)
      : http.request(url, options as http.RequestOptions)

    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    // The guard may pass no signal at all; without a timer a provider that accepts
    // the connection and then says nothing would hang the call for ever.
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const cancelled = abortError()
        request.destroy(cancelled)
        fail(cancelled)
      }, timeoutMs)
      // A pending timer must not keep the process alive on its own.
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref()
    }

    request.on('error', (error: unknown) => {
      fail(codedError(codeOf(error)))
    })

    request.on('response', (res: http.IncomingMessage) => {
      if (settled) {
        // The call was cancelled between the request going out and the answer
        // arriving. Releasing the socket keeps a cancelled call from holding one.
        res.destroy()
        return
      }
      settled = true
      response = res
      // The call itself is answered, so the timer has done its job. The abort
      // listener stays attached until the body closes: a caller that cancels while
      // reading a stream should have the stream stopped, not merely ignored.
      if (timer !== null) clearTimeout(timer)
      timer = null
      res.on('close', cleanup)
      resolve(adaptResponse(res, url.toString(), address, maxBytes))
    })

    const bytes = bodyBytes(init.body)
    if (bytes === undefined) request.end()
    else request.end(bytes)
  })
}

/**
 * A transport that connects only to the addresses it was told were verified.
 *
 * `timeoutMs` here is the whole call, and the guard's own timeout is passed in as a
 * signal, so the shorter of the two wins.
 */
export function createPinnedTransport (options: PinnedTransportOptions = {}): PinnedTransport {
  const timeoutMs = Number.isInteger(options.timeoutMs) && (options.timeoutMs as number) > 0
    ? (options.timeoutMs as number)
    : DEFAULT_TIMEOUT_MS
  const maxResponseBytes = Number.isInteger(options.maxResponseBytes) && (options.maxResponseBytes as number) > 0
    ? (options.maxResponseBytes as number)
    : DEFAULT_MAX_RESPONSE_BYTES

  return async function pinnedFetch (url: string, init: PinnedRequestInit): Promise<PinnedResponse> {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('a pinned request needs a URL')
    }
    if (typeof init !== 'object' || init === null || typeof init.pin !== 'object' || init.pin === null) {
      throw new TypeError('a pinned request needs a pin')
    }

    // No verified address means nothing may be dialled. Falling back to a name
    // would be exactly the lookup this module exists to avoid.
    const addresses = Array.isArray(init.pin.addresses) ? init.pin.addresses : []
    if (addresses.length === 0) throw codedError('EPINNOPIN')

    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw codedError('EINVALIDURL')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw codedError('EUNSAFESCHEME')
    }

    // Built once, before the first socket, so a body of the wrong shape fails the
    // call rather than the second attempt after a connection error.
    bodyBytes(init.body)

    let lastFailure: Error = codedError('unknown')
    for (const address of addresses) {
      if (typeof address !== 'string' || address.length === 0) continue
      try {
        return await attempt(parsed, init, address, timeoutMs, maxResponseBytes)
      } catch (error) {
        lastFailure = error instanceof Error ? error : codedError('unknown')
        const cancelled = lastFailure.name === 'AbortError'
        if (cancelled) throw lastFailure
        if (!RETRYABLE_CODES.has(codeOf(lastFailure))) throw lastFailure
      }
    }
    throw lastFailure
  }
}

/**
 * The resolver a production caller hands the guard.
 *
 * Kept here, next to the transport, because it is the other half of the same
 * decision: these are the addresses the guard classifies and the transport dials.
 * A resolver that answers nothing is a failure rather than an empty list, so a host
 * that no longer exists cannot be read as one with no cloud addresses.
 */
export function createDnsResolver (
  options: {
    resolve?: (hostname: string) => Promise<Array<{ address: string }>>
  } = {},
): (hostname: string) => Promise<string[]> {
  const answer = options.resolve ?? (async (hostname: string) => await dnsLookup(hostname, { all: true, verbatim: true }))

  return async (hostname: string) => {
    const records = await answer(hostname)
    if (!Array.isArray(records)) throw codedError('ENOTFOUND')

    const addresses: string[] = []
    for (const record of records) {
      if (typeof record !== 'object' || record === null) continue
      const address = (record as { address?: unknown }).address
      if (typeof address === 'string' && address.length > 0) addresses.push(address)
    }
    if (addresses.length === 0) throw codedError('ENOTFOUND')
    return addresses
  }
}
