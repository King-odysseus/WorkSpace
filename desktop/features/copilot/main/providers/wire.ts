/*
 * Small, shared pieces of talking to an HTTP model provider.
 *
 * Everything here exists to keep two promises from the plan:
 *
 * 1. A provider body never travels further than the adapter that read it.
 *    `assertOk` reads a failed body only to pick a failure token, and throws a
 *    `ProviderError` that cannot carry text; `readJson` reports a parse failure
 *    as `malformed_response` without quoting what it received.
 *
 * 2. Nothing here opens a socket. Adapters receive a `ProviderTransport`, and
 *    these helpers only shape a URL, headers and a parsed body.
 */

import { ProviderError, toProviderFailure, type ProviderFailure } from '../../shared/providers/errors.js'
import { parseJsonReply } from '../../shared/providers/structured.js'
import { classifyIpAddress, isIpLiteral, normalizeHost } from '../security/ip-ranges.js'
import type { ProviderTransportResponse } from './transport.js'

/**
 * How a provider wants its key attached.
 *
 * `bearer` covers the OpenAI convention (`Authorization: Bearer <key>`).
 * `api-key` exists because Anthropic and some self-hosted gateways name their
 * own header, and a header name is a provider difference rather than a secret.
 */
export type AuthStyle =
  | { readonly kind: 'bearer' }
  | { readonly kind: 'api-key'; readonly header: string }
  | { readonly kind: 'none' }

/** A base URL and a path, joined without doubling or dropping a slash. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim()
  // An empty base URL is a configuration bug, not a network error, and sending
  // "/v1/models" to the local machine would hide it.
  if (base.length === 0) throw new ProviderError('internal_error')
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/**
 * Whether the endpoint's bytes leave this machine.
 *
 * Derived from the address the adapter will actually dial, as section 7.3
 * requires, not from the provider's name: a local server pointed at a public
 * host is a cloud model, and the reverse is the one that leaks. A URL this
 * module cannot parse counts as cloud, because the safe answer for a local-only
 * business is to refuse.
 */
export function endpointIsCloud(baseUrl: string): boolean {
  let host: string | null
  try {
    host = normalizeHost(new URL(baseUrl).hostname)
  } catch {
    return true
  }
  if (host === null) return true

  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === 'local' || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (isIpLiteral(host)) return classifyIpAddress(host) !== 'local'
  return true
}

/**
 * The header that carries a key, or a refusal when there should be one.
 *
 * Missing credentials fail before the network: "the key was rejected" is the
 * sentence the Models screen already knows how to show, and a request without a
 * key would only earn the same answer a round trip later.
 */
export function credentialHeaders(auth: AuthStyle, credential: string | null): Record<string, string> {
  if (auth.kind === 'none') return {}
  if (credential === null || credential.trim().length === 0) throw new ProviderError('provider_unauthorized')
  if (auth.kind === 'bearer') return { Authorization: `Bearer ${credential}` }
  return { [auth.header]: credential }
}

/**
 * The headers for an optional credential.
 *
 * A custom gateway may take no key at all, so an empty credential is only a
 * failure when the provider needs one. Making that choice here keeps every
 * adapter's header code identical.
 */
export function authFor(auth: AuthStyle, credential: string | null, required: boolean): Record<string, string> {
  const present = credential !== null && credential.trim().length > 0
  if (!present) {
    if (required) throw new ProviderError('provider_unauthorized')
    return {}
  }
  return credentialHeaders(auth, credential)
}

/** The header names the guard must treat as secrets when a redirect is followed. */
export function credentialHeaderNames(auth: AuthStyle): readonly string[] {
  if (auth.kind === 'bearer') return ['authorization']
  if (auth.kind === 'api-key') return [auth.header.toLowerCase()]
  return []
}

/** Read a body, mapping a failed read to a token. */
export async function readText(response: ProviderTransportResponse): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    throw new ProviderError(toProviderFailure(error))
  }
}

/** Read a JSON body, refusing a reply that is not JSON at all. */
export async function readJson(response: ProviderTransportResponse): Promise<unknown> {
  const text = await readText(response)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
}

const CONTEXT_PATTERNS: readonly RegExp[] = [
  /context length/i,
  /context window/i,
  /maximum context/i,
  /too many tokens/i,
  /prompt is too long/i,
  /exceeds? the (?:model'?s )?(?:maximum )?context/i,
]

const MODEL_PATTERNS: readonly RegExp[] = [
  /model[^.]{0,40}not found/i,
  /unknown model/i,
  /invalid model/i,
  /no such model/i,
  /model[^.]{0,40}does not exist/i,
]

/**
 * Turn a rejected status into a token.
 *
 * The body is inspected only for a handful of phrases because a few providers
 * report "context too long" and "no such model" as a plain 400, and the person
 * can act on those two. Nothing from the body is returned or logged.
 */
export function classifyStatus(status: number, body: string): ProviderFailure {
  if (status === 401 || status === 403) return 'provider_unauthorized'
  if (status === 404) return 'model_not_found'
  if (status === 408) return 'timeout'
  if (status === 413) return 'context_too_long'
  if (status === 429) return 'provider_rate_limited'
  if (status >= 500) return 'provider_unavailable'

  if (status >= 400) {
    for (const pattern of CONTEXT_PATTERNS) {
      if (pattern.test(body)) return 'context_too_long'
    }
    for (const pattern of MODEL_PATTERNS) {
      if (pattern.test(body)) return 'model_not_found'
    }
    return 'provider_rejected'
  }

  return 'internal_error'
}

/** Refuse a non-2xx reply, reading its body only long enough to classify it. */
export async function assertOk(response: ProviderTransportResponse): Promise<void> {
  if (response.ok) return

  let body = ''
  try {
    body = await response.text()
  } catch {
    // The status is enough to classify without a body; a failed read must not
    // replace the refusal the provider already gave.
    body = ''
  }
  throw new ProviderError(classifyStatus(response.status, body))
}

/**
 * Classify an error a provider sent inside a streamed body.
 *
 * A stream can fail after its status line said 200, so there is no status to
 * map. Providers label these failures with a type token; only that token is
 * read, never the accompanying message, which often quotes the request.
 */
export function classifyStreamError(error: unknown): ProviderFailure {
  const record = asRecord(error)
  const raw = record === null ? null : (asString(record.type) ?? asString(record.code))
  const token = (raw ?? '').toLowerCase()

  if (token.includes('context') || token.includes('too_many_tokens')) return 'context_too_long'
  if (token.includes('rate_limit')) return 'provider_rate_limited'
  if (token.includes('auth') || token.includes('api_key') || token.includes('permission')) {
    return 'provider_unauthorized'
  }
  if (token.includes('not_found') || token.includes('no_such_model')) return 'model_not_found'
  if (token.includes('overloaded') || token.includes('unavailable') || token.includes('server')) {
    return 'provider_unavailable'
  }
  if (token.includes('invalid') || token.includes('bad_request')) return 'provider_rejected'
  return 'malformed_response'
}

/** Parse one SSE payload, refusing a body that is not JSON. */
export function sseJson(data: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
  return asRecord(parsed)
}

/* ------------------------------------------------------------------ *
 * Reading untyped JSON safely
 * ------------------------------------------------------------------ */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.trunc(value)
}

export function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null
  return Math.trunc(value)
}

/** A tool call's arguments, which arrive as a JSON string on both wire formats. */
export function parseArgumentsJson(text: string): unknown {
  const parsed = parseJsonReply(text)
  if (!parsed.ok) throw new ProviderError('malformed_response')
  return parsed.value
}

/* ------------------------------------------------------------------ *
 * Server-sent events
 * ------------------------------------------------------------------ */

/** One event from a streamed body. `event` is null when the protocol omits it. */
export interface SseEvent {
  readonly event: string | null
  readonly data: string
}

function completeEvent(event: string | null, data: readonly string[]): SseEvent | null {
  if (data.length === 0) return event === null ? null : { event, data: '' }
  return { event, data: data.join('\n') }
}

/**
 * Split a body that is already complete into events.
 *
 * Used for a recorded fixture and for a transport that can only offer whole
 * bodies. A live stream uses `parseSseStream` below, which hands each event on
 * as it arrives; both follow the same event-stream rules, so a fixture and a real
 * reply are parsed by the same logic.
 */
export function* parseSse(text: string): Generator<SseEvent> {
  let event: string | null = null
  let data: string[] = []

  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      const ready = completeEvent(event, data)
      if (ready !== null) yield ready
      event = null
      data = []
      continue
    }

    if (line.startsWith(':')) continue

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  const tail = completeEvent(event, data)
  if (tail !== null) yield tail
}

/**
 * Split a streamed body into events *as it arrives*.
 *
 * The function above needs the whole body first, which is fine for a recorded
 * fixture and useless for a live conversation: the person would wait for the last
 * word before seeing the first. This reader keeps only the tail of an unfinished
 * line between chunks, so an event is handed on the moment its blank line lands.
 *
 * Three details are not incidental.
 *
 * 1. The decoder is fed with `stream: true`, so a multi-byte character split
 *    across two chunks is decoded once rather than as two broken halves. A reply
 *    in Yoruba or Arabic would otherwise arrive with replacement characters at
 *    chunk boundaries.
 *
 * 2. A `\r\n` line ending is handled the same way the string parser handles it.
 *
 * 3. Anything the reader throws - a destroyed socket, a cancelled call, an
 *    oversized body - becomes a provider failure token, because a raw socket error
 *    quotes the request URL and a URL can carry a key.
 */
export async function* parseSseStream (chunks: AsyncIterable<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder('utf-8')
  let pending = ''
  let event: string | null = null
  let data: string[] = []

  /** Close the event in progress, if there is one. */
  function flush (): SseEvent | null {
    const ready = completeEvent(event, data)
    event = null
    data = []
    return ready
  }

  /** Read one complete line. Returns an event only when the line was blank. */
  function takeLine (line: string): SseEvent | null {
    if (line.length === 0) return flush()
    // A leading colon is a comment: providers send keep-alives this way, and
    // drawing one would put a blank delta on the screen.
    if (line.startsWith(':')) return null

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
    return null
  }

  try {
    for await (const chunk of chunks) {
      pending += decoder.decode(chunk, { stream: true })

      for (;;) {
        const at = pending.indexOf('\n')
        if (at === -1) break
        let line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        const ready = takeLine(line)
        if (ready !== null) yield ready
      }
    }

    // Whatever the decoder held back, plus a last line the body never ended with
    // a newline.
    pending += decoder.decode()
    if (pending.length > 0) {
      let line = pending
      if (line.endsWith('\r')) line = line.slice(0, -1)
      takeLine(line)
    }

    const tail = flush()
    if (tail !== null) yield tail
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError(toProviderFailure(error))
  }
}

/**
 * The events of a streamed reply, from bytes when the transport can deliver them
 * and from the whole body when it cannot.
 *
 * A caller asks for events and does not decide how the body arrived. The fallback
 * exists so a recorded fixture, or a transport that only offers whole bodies,
 * still exercises the same parsing code rather than a second copy of it.
 */
export async function* readSse (response: ProviderTransportResponse): AsyncGenerator<SseEvent> {
  const bytes = response.bytes
  if (typeof bytes === 'function') {
    yield* parseSseStream(bytes())
    return
  }

  yield* parseSse(await readText(response))
}

/**
 * The lines of a streamed body, as they arrive.
 *
 * Some protocols - newline-delimited JSON among them - are not event streams at
 * all, and splitting them into events would invent a format. This hands each line
 * on the moment it lands, decoding multi-byte characters across chunk boundaries
 * the same way `parseSseStream` does.
 */
export async function* streamLines (chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8')
  let pending = ''

  try {
    for await (const chunk of chunks) {
      pending += decoder.decode(chunk, { stream: true })

      for (;;) {
        const at = pending.indexOf('\n')
        if (at === -1) break
        let line = pending.slice(0, at)
        pending = pending.slice(at + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        yield line
      }
    }

    pending += decoder.decode()
    if (pending.length > 0) {
      if (pending.endsWith('\r')) pending = pending.slice(0, -1)
      yield pending
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError(toProviderFailure(error))
  }
}
