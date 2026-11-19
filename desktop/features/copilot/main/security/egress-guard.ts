/*
 * The only network path a model call may take (section 7.3 of the plan).
 *
 * Everything here exists because "is this destination local" cannot be answered
 * by looking at the provider's name. An entry labelled "Ollama" pointing at a
 * public host is cloud traffic, and for a local-only business that is the one
 * thing that must never happen. So each request is classified from the addresses
 * the host actually resolves to, redirects are followed by hand and re-classified
 * at every hop, and a refused call throws before the transport is touched.
 *
 * Decisions worth stating, because each closes a specific hole.
 *
 * 1. Classification is "any address is cloud, therefore cloud". A host resolving
 *    to both `127.0.0.1` and a public address is not local; taking the friendlier
 *    answer is how a resolver trick or a stray CNAME becomes an egress.
 *
 * 2. Blocking happens before the transport call. A guard that sent the request
 *    and then changed its mind has already leaked the payload.
 *
 * 3. A redirect is re-classified like a fresh request, and credentials travel no
 *    further than the same origin (scheme, host and port) or an http to https
 *    upgrade on the default ports. Following a redirect with the Authorization
 *    header intact hands the key to whoever answered.
 *
 * 4. The addresses a host resolved to are handed to the transport as a pin, and
 *    the transport connects to one of them. A host that changes its answer
 *    between the check and the connect therefore has no second lookup to poison:
 *    the socket never asks DNS again. `pinned-transport.ts` is that transport and
 *    is what this guard uses unless a test installs its own, because a pin only
 *    means anything to a transport that can act on it. `fetch` cannot: it has no
 *    such option and resolves the name itself, so handing it a pin would leave the
 *    rebind gap wide open. The recheck below stays as a backstop for a transport
 *    that reports where it actually connected, not as the mitigation.
 *
 * 5. Every attempt, allowed or blocked, writes one audit record. A record is
 *    built by the audit module from an allow-list, so a key in a query string
 *    cannot reach it.
 */
import { classifyIpAddress, normalizeHost, splitHostAndPort } from './ip-ranges.js'

import { createPinnedTransport } from './pinned-transport.js'

import {
  createAuditRecord,
  describeTarget,
  type AuditBlockReason,
  type AuditSink,
} from './audit.js'

import type { CallPurpose } from '../../shared/providers/types.js'

/** What every guarded call is asked about itself. Mirrors the provider contract. */
export interface GuardCallContext {
  readonly businessId: number | null
  readonly providerId: string
  readonly userId: number
  readonly purpose: CallPurpose
  /** True when this business must never reach a cloud model. */
  readonly localOnly: boolean
  /**
   * True when the request body was not rewritten by the privacy rules.
   *
   * Separate from `localOnly` because it is a fact about one request rather than a
   * policy about a business: the text is only safe to send unredacted because the
   * endpoint looked local, so every hop of that request has to stay local too.
   */
  readonly unredactedContent?: boolean
  readonly signal?: AbortSignal
}

/** Why a call was refused. These are tokens, never prose from the network. */
export const EGRESS_FAILURES = Object.freeze([
  'local_only',
  'unredacted_content',
  'invalid_target',
  'cross_origin_redirect',
  'too_many_redirects',
  'unsafe_scheme',
] as const)

export type EgressFailure = (typeof EGRESS_FAILURES)[number]

const EGRESS_FAILURE_MESSAGES: Readonly<Record<EgressFailure, string>> = Object.freeze({
  local_only: 'This business is local only, so a cloud model cannot be used here.',
  unredacted_content: 'That model asked to send this conversation to a cloud address, so it was stopped.',
  invalid_target: 'That address could not be verified as local or cloud, so the request was not sent.',
  cross_origin_redirect: 'That provider redirected the request to another address, so it was not followed.',
  too_many_redirects: 'That provider redirected the request too many times.',
  unsafe_scheme: 'That address is not something this app will request.',
})

/**
 * A refused call.
 *
 * Built from a token only. The URL is deliberately not kept: a provider URL can
 * carry a key in its query string, so an error that echoed its target would be a
 * leak wearing an error message.
 */
export class EgressBlockedError extends Error {
  readonly reason: EgressFailure

  constructor (reason: EgressFailure) {
    super(EGRESS_FAILURE_MESSAGES[reason])
    this.name = 'EgressBlockedError'
    this.reason = reason
  }
}

/**
 * A call that was allowed to go out and never completed.
 *
 * The original error is deliberately not attached. A transport error routinely
 * carries the request URL in its message, and a provider URL may hold a key in
 * its query string, so rethrowing it as-is leaked secrets into whatever caught
 * it. Only a bounded code survives, which is enough to tell ECONNREFUSED from
 * ENOTFOUND without carrying anything from the provider.
 */
export class EgressTransportError extends Error {
  readonly code: string

  constructor (code: string) {
    super('The model provider could not be reached.')
    this.name = 'EgressTransportError'
    this.code = code
  }
}

/** The part of a response the guard and an adapter both read. */
export interface GuardedResponse {
  readonly status: number
  readonly ok: boolean
  readonly headers: { get: (name: string) => string | null }
  text: () => Promise<string>
  json: () => Promise<unknown>
  /**
   * The body as it arrives, for a caller that must act on the first word rather
   * than the last. Optional because a test double may only offer whole bodies;
   * a caller that needs to stream checks for it rather than assuming.
   */
  bytes?: () => AsyncIterable<Uint8Array>
  readonly url: string
  /**
   * The address the socket actually reached, when the transport can say so.
   *
   * Optional because a test double has no socket. When it is present the guard
   * checks it, so a transport that ignored the pin is caught rather than trusted.
   */
  readonly connectedAddress?: string | null
}

/**
 * The addresses a hop was verified to resolve to.
 *
 * A transport receiving this MUST connect to one of these addresses, and MUST use
 * `hostname` for the Host header and the TLS handshake. That contract is what
 * makes the classification binding: the address that was checked is the address
 * that is dialled, and no lookup happens between the two.
 */
export interface GuardPin {
  readonly hostname: string
  readonly addresses: readonly string[]
}

export interface GuardedRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /**
   * Extra header names to treat as credentials on top of the defaults. The guard
   * needs this because a custom OpenAI-compatible entry can name its own header.
   */
  secretHeaders?: readonly string[]
}

/** The transport, as the guard sees it. `redirect: manual` is always forced. */
export type GuardFetch = (
  url: string,
  init: {
    method: string
    headers: Record<string, string>
    body?: unknown
    signal?: AbortSignal
    redirect: 'manual'
    pin: GuardPin
  },
) => Promise<GuardedResponse>

export interface EgressGuardOptions {
  /**
   * Defaults to the pinned transport, which is the only one that can honour a pin.
   * Injected by tests so the guard can be exercised without a socket, and by any
   * future caller that needs to observe requests.
   */
  fetchImpl?: GuardFetch
  /**
   * Resolve a hostname to its addresses. Injected because the guard's job is to
   * classify what it is told; a test that dialled a real resolver would be
   * testing the resolver.
   */
  resolve: (hostname: string) => Promise<string[]>
  audit?: AuditSink
  log?: { warn: (message: string) => void }
  maxRedirects?: number
  timeoutMs?: number
}

export interface EgressGuard {
  fetch: (ctx: GuardCallContext, url: string, init?: GuardedRequestInit) => Promise<GuardedResponse>
}

/**
 * Header names that carry a secret. Dropped on any cross-origin hop.
 *
 * Lower case, because headers are matched case-insensitively and a provider is
 * free to send `Authorization` or `authorization`.
 */
const DEFAULT_SECRET_HEADERS: readonly string[] = Object.freeze([
  'authorization',
  'proxy-authorization',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
  'x-auth-token',
  'x-access-token',
  'cookie',
])

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 60_000

function lowerHeaders (headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue
    out[name.toLowerCase()] = value
  }
  return out
}

/**
 * Whether a body is a plain object that still has to become text.
 *
 * Only a plain object is serialised. A string, a Buffer, or a stream is already
 * something a transport can send, and re-encoding it here would corrupt it: a body
 * of bytes passed through `JSON.stringify` would be sent as a list of numbers, which
 * the provider would reject much later and for a reason nobody could trace back.
 */
function isPlainBody (body: unknown): body is Record<string, unknown> {
  if (typeof body !== 'object' || body === null) return false
  const prototype = Object.getPrototypeOf(body)
  return prototype === Object.prototype || prototype === null
}

/** The origin a request belongs to: scheme, host and effective port. */
function originOf (url: URL): string {
  return `${url.protocol}//${url.hostname.toLowerCase()}:${effectivePort(url)}`
}

/** The port the request will actually reach, with the scheme default filled in. */
function effectivePort (url: URL): number {
  if (url.port !== '') return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/**
 * Whether credentials may travel from one hop to the next.
 *
 * The same origin (scheme, host and port) always may. An http to https upgrade on
 * the same host may too, but only on the default ports: 80 to 443 is one service
 * on a secure port, while an upgrade that lands on some other port is a different
 * listener, and a redirect is not reason enough to hand it a key. Checking the
 * ports is what stopped the earlier rule from following `/v1/chat` on port 80 to a
 * collector on 8443 with the Authorization header attached.
 */
function mayCarryCredentials (from: URL, to: URL): boolean {
  if (originOf(from) === originOf(to)) return true
  return from.protocol === 'http:' &&
    to.protocol === 'https:' &&
    from.hostname.toLowerCase() === to.hostname.toLowerCase() &&
    effectivePort(from) === 80 &&
    effectivePort(to) === 443
}

function hasSecretHeader (headers: Record<string, string>, names: ReadonlySet<string>): boolean {
  for (const name of Object.keys(headers)) {
    if (names.has(name)) return true
  }
  return false
}

export function createEgressGuard (options: EgressGuardOptions): EgressGuard {
  if (typeof options?.resolve !== 'function') {
    // Required, and not defaulted: what a host resolves to is the whole input to
    // the classification, so a caller has to say where it comes from.
    throw new TypeError('createEgressGuard needs a resolve function')
  }

  const resolveHost = options.resolve
  const audit = options.audit
  const log = options.log
  const maxRedirects = Number.isInteger(options.maxRedirects) && (options.maxRedirects as number) >= 0
    ? (options.maxRedirects as number)
    : DEFAULT_MAX_REDIRECTS
  const timeoutMs = Number.isInteger(options.timeoutMs) && (options.timeoutMs as number) > 0
    ? (options.timeoutMs as number)
    : DEFAULT_TIMEOUT_MS

  /*
   * The shipped default. Constructed here rather than at the top of the module so
   * that the caller's timeout, when it set one, is the transport's too.
   */
  const provided = options.fetchImpl
  if (provided !== undefined && typeof provided !== 'function') {
    throw new TypeError('createEgressGuard needs a fetchImpl to be a function')
  }
  const fetchImpl: GuardFetch = provided ?? createPinnedTransport({ timeoutMs })

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot egress: ${message}`)
  }

  /*
   * One record per attempt. The target is reduced to scheme, host and port before
   * it reaches the sink, which is what keeps a key in a query string out of the
   * audit log.
   */
  function writeAudit (
    ctx: GuardCallContext,
    fields: {
      outcome: 'allowed' | 'blocked' | 'failed'
      reason?: AuditBlockReason | null
      url?: string | null
      cloud?: boolean | null
      status?: number | null
      redirects?: number
    },
  ): void {
    if (!audit) return
    audit.record(createAuditRecord({
      outcome: fields.outcome,
      reason: fields.reason ?? null,
      providerId: ctx.providerId,
      purpose: ctx.purpose,
      businessId: ctx.businessId,
      userId: ctx.userId,
      target: fields.url ? describeTarget(fields.url) : null,
      cloud: fields.cloud ?? null,
      status: fields.status ?? null,
      redirects: fields.redirects ?? 0,
    }))
  }

  /**
   * Classify one destination from its resolved addresses.
   *
   * `cloud` is true when ANY address is cloud, and an address that cannot be
   * classified at all makes the whole destination unusable: a resolver that
   * answers something unparseable is not evidence of locality.
   */
  async function classifyDestination (
    url: URL,
  ): Promise<{ cloud: boolean; addresses: readonly string[] } | { failure: EgressFailure }> {
    const authority = splitHostAndPort(url.host)
    if (authority === null) return { failure: 'invalid_target' }

    const host = authority.host
    // An IP literal needs no resolver, and asking one would let a hostile answer
    // override what the URL plainly says.
    const literal = classifyIpAddress(host)

    let addresses: unknown
    if (literal === 'invalid') {
      try {
        addresses = await resolveHost(host)
      } catch {
        /*
         * A resolver that refuses is not evidence of locality, and it is not a
         * transport failure either: nothing was sent. Failing closed keeps a
         * broken resolver, or a poisoned answer, from becoming a bypass, and the
         * refusal is recorded like every other one.
         */
        return { failure: 'invalid_target' }
      }
    } else {
      addresses = [host]
    }

    if (!Array.isArray(addresses) || addresses.length === 0) return { failure: 'invalid_target' }

    const verified: string[] = []
    let anyCloud = false
    for (const address of addresses) {
      const kind = classifyIpAddress(address)
      if (kind === 'invalid') return { failure: 'invalid_target' }
      if (kind === 'cloud') anyCloud = true
      // The classifier accepted it, which it only does for a string.
      verified.push(String(address))
    }
    return { cloud: anyCloud, addresses: Object.freeze(verified) }
  }

  /**
   * The refusal for a call that must not reach a cloud address, or null when it may.
   *
   * Two different promises can demand the same thing, and keeping them apart is what
   * makes the audit line honest:
   *
   * - a business set to local-only must never use a cloud model at all;
   * - a request whose text the privacy rules left unrewritten must not reach one
   *   either, because that text is only safe while the endpoint is local. Without
   *   this second rule a local server could answer a 307 with a public `Location`
   *   and the transport, which follows redirects, would forward the person's own
   *   words to the address the redirect named.
   */
  function cloudRefusal (ctx: GuardCallContext, cloud: boolean): EgressFailure | null {
    if (!cloud) return null
    if (ctx.localOnly) return 'local_only'
    if (ctx.unredactedContent === true) return 'unredacted_content'
    return null
  }

  /**
   * One guarded call.
   *
   * The loop follows redirects itself so that every hop is classified before it
   * is requested, which a transport that followed redirects internally could not
   * offer.
   */
  async function guardFetch (
    ctx: GuardCallContext,
    url: string,
    init: GuardedRequestInit = {},
  ): Promise<GuardedResponse> {
    if (typeof url !== 'string' || url.length === 0) {
      throw new TypeError('guardedFetch needs a URL')
    }

    const secretNames = new Set<string>(DEFAULT_SECRET_HEADERS)
    for (const name of init.secretHeaders ?? []) {
      if (typeof name === 'string' && name.length > 0) secretNames.add(name.toLowerCase())
    }

    let headers = lowerHeaders(init.headers)
    let method = (init.method ?? 'GET').toUpperCase()
    let body = init.body
    /*
     * The bytes, decided once, before the first hop.
     *
     * Every adapter builds its request as an object and the transport below sends
     * strings, so the body has to become text somewhere. It happens here rather than
     * in the transport for two reasons. The guard is the one place that knows what
     * will actually leave - that is what the audit line and the redirect rule are
     * about - and a body serialised per hop could differ between hops, so a redirect
     * would carry something the decision above was not made about.
     */
    if (isPlainBody(body)) body = JSON.stringify(body)

    let current: URL
    try {
      current = new URL(url)
    } catch {
      /*
       * Recorded like every other refusal. A trail with a hole exactly where a
       * caller handed over something unusable is worse than no trail: the call
       * happened, and why it never went out is the interesting part. The target is
       * null because an unparseable URL cannot be reduced to scheme, host and port.
       */
      writeAudit(ctx, { outcome: 'blocked', reason: 'invalid_target', url: null })
      warn('refused a URL that could not be parsed')
      throw new EgressBlockedError('invalid_target')
    }
    let redirects = 0

    for (;;) {
      // Scheme first: file, data and anything else is refused before a resolver
      // is consulted, so a hostile payload cannot reach a different subsystem.
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        writeAudit(ctx, { outcome: 'blocked', reason: 'unsafe_scheme', url: current.toString() })
        warn('refused a scheme that is not http or https')
        throw new EgressBlockedError('unsafe_scheme')
      }

      const classified = await classifyDestination(current)
      if ('failure' in classified) {
        writeAudit(ctx, { outcome: 'blocked', reason: classified.failure, url: current.toString() })
        warn(`refused an unclassifiable destination (${classified.failure})`)
        throw new EgressBlockedError(classified.failure)
      }

      /*
       * The block that matters most: decided before the transport is touched, so
       * not one byte of a local-only business leaves the machine. It runs on every
       * hop, which is what stops a local endpoint redirecting unredacted text to a
       * public address.
       */
      const refusal = cloudRefusal(ctx, classified.cloud)
      if (refusal !== null) {
        writeAudit(ctx, { outcome: 'blocked', reason: refusal, url: current.toString(), cloud: true })
        warn(refusal === 'local_only'
          ? 'refused a cloud destination under a local-only policy'
          : 'refused a cloud destination for a request whose text was not redacted')
        throw new EgressBlockedError(refusal)
      }

      const signal = buildSignal(ctx.signal, timeoutMs)

      /*
       * The verified addresses travel with the request. The transport connects to
       * one of them and uses `hostname` for the Host header and the TLS handshake,
       * so the address that was classified is the address that is dialled. That is
       * what closes the rebind gap: there is no lookup between the check and the
       * socket for an attacker to win.
       */
      const pin: GuardPin = {
        hostname: current.hostname.toLowerCase(),
        addresses: classified.addresses,
      }

      let response: GuardedResponse
      try {
        response = await fetchImpl(current.toString(), {
          method,
          headers,
          body,
          signal,
          redirect: 'manual',
          pin,
        })
      } catch (error) {
        writeAudit(ctx, {
          outcome: 'failed',
          url: current.toString(),
          cloud: classified.cloud,
          redirects,
        })
        const code = safeErrorCode(error)
        const aborted = signal?.aborted === true || isAbortError(error)
        warn(`transport failed (${code})`)
        // The original error is dropped rather than chained: its message routinely
        // holds the request URL, and a provider URL can hold a key in its query.
        throw aborted ? abortError() : new EgressTransportError(code)
      }

      const location = response.headers?.get?.('location') ?? null
      if (REDIRECT_STATUSES.has(response.status) && typeof location === 'string' && location.length > 0) {
        if (redirects >= maxRedirects) {
          writeAudit(ctx, {
            outcome: 'blocked',
            reason: 'too_many_redirects',
            url: current.toString(),
            cloud: classified.cloud,
            status: response.status,
            redirects,
          })
          warn('refused a redirect chain that was too long')
          throw new EgressBlockedError('too_many_redirects')
        }

        let next: URL
        try {
          next = new URL(location, current)
        } catch {
          writeAudit(ctx, {
            outcome: 'blocked',
            reason: 'invalid_target',
            url: current.toString(),
            cloud: classified.cloud,
            status: response.status,
            redirects,
          })
          throw new EgressBlockedError('invalid_target')
        }

        /*
         * 303 always becomes a bodyless GET, and a 301 or 302 in answer to a POST
         * does as browsers do. Re-sending a body after that would send it where
         * the redirect asked, which is the opposite of what the guard is for.
         */
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
          headers = stripBodyHeaders(headers)
        }

        /*
         * Credentials never travel to another origin. The check happens here,
         * before the hop is requested, rather than at send time: a guard that
         * dropped the header quietly would follow a redirect the provider had no
         * business asking for, and the caller would see a puzzling 401 instead of
         * the real reason.
         */
        // The hop actually being made, not the first URL of the chain: what
        // matters is whether THIS redirect moves the key somewhere new.
        if (!mayCarryCredentials(current, next)) {
          if (hasSecretHeader(headers, secretNames)) {
            writeAudit(ctx, {
              outcome: 'blocked',
              reason: 'cross_origin_redirect',
              url: current.toString(),
              cloud: classified.cloud,
              status: response.status,
              redirects,
            })
            warn('refused a cross-origin redirect that would have carried credentials')
            throw new EgressBlockedError('cross_origin_redirect')
          }
          // Nothing secret to protect, so strip defensively and carry on.
          headers = stripSecretHeaders(headers, secretNames)
        }

        redirects += 1
        current = next
        continue
      }

      /*
       * Backstop only. The pin is the mitigation; this catches a transport that
       * ignored it and nonetheless says where it connected. A transport that
       * reports nothing is trusted to honour the pin, which GuardPin states.
       */
      const connected = response.connectedAddress
      if (typeof connected === 'string' && connected.length > 0) {
        const backstop = cloudRefusal(ctx, classifyIpAddress(connected) !== 'local')
        if (backstop !== null) {
          writeAudit(ctx, {
            outcome: 'blocked',
            reason: backstop,
            url: current.toString(),
            cloud: true,
            status: response.status,
            redirects,
          })
          warn('discarded a response that came from an address the guard had not verified')
          throw new EgressBlockedError(backstop)
        }
      }

      writeAudit(ctx, {
        outcome: 'allowed',
        url: current.toString(),
        cloud: classified.cloud,
        status: response.status,
        redirects,
      })
      return response
    }
  }

  return Object.freeze({ fetch: guardFetch })
}

/** A signal that aborts on the caller's signal or on the guard's own timeout. */
function buildSignal (signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  // any() is present in every Node the desktop package supports (22.12+).
  return AbortSignal.any([signal, timeout])
}

function isAbortError (error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  try {
    return (error as { name?: unknown }).name === 'AbortError'
  } catch {
    return false
  }
}

/**
 * A cancellation, rebuilt without the original error.
 *
 * Providers tell a cancellation from a failure by `name === 'AbortError'`, so the
 * name is kept and everything else is dropped. The caller's own abort reason is
 * not forwarded either: it is caller text of unknown shape travelling into an
 * error a page may display.
 */
function abortError (): Error {
  const cancelled = new Error('The request was cancelled.')
  cancelled.name = 'AbortError'
  return cancelled
}

/** Node error codes and names are short upper-case tokens; anything else is not one. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,39}$/

/**
 * A short code that describes a transport failure without quoting it.
 *
 * `ENOTFOUND` and `ECONNREFUSED` are worth keeping because they tell a person
 * whether to check the URL or the network. The message they came with is not: it
 * carries the URL, and the URL can carry a key.
 */
function safeErrorCode (error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown'
  try {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && SAFE_CODE.test(code)) return code
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && SAFE_CODE.test(name)) return name
  } catch {
    return 'unknown'
  }
  return 'unknown'
}

function stripSecretHeaders (
  headers: Record<string, string>,
  secretNames: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (secretNames.has(name)) continue
    out[name] = value
  }
  return out
}

/** A GET after a redirect must not describe a body it does not have. */
function stripBodyHeaders (headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name === 'content-length' || name === 'content-type') continue
    out[name] = value
  }
  return out
}

/*
 * Exported for the tests, and because the rule "which hops may carry a
 * credential" is worth stating in one place rather than re-deriving in a test.
 * The address helpers are deliberately NOT re-exported here: they come from
 * ip-ranges, and two star exports of the same name through the bundle entry would
 * be an ambiguity rather than a convenience.
 */
export { mayCarryCredentials as egressMayCarryCredentials, originOf as egressOriginOf }
