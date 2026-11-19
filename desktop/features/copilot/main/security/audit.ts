/*
 * The egress trail: one record per model call, allowed or blocked.
 *
 * Every request the app makes to a model passes through one function, and that
 * function has to leave a line behind whether it allowed the call or refused it.
 * The line is what answers "did this business's content ever go to a public
 * host, and why" long after the socket is gone.
 *
 * The hard rule from the plan is that a record must never carry an API key, a
 * token, a request body or any payload text. That sounds like a rule about not
 * logging the body, but the dangerous part is the provider URL itself:
 *
 *   https://api.example.com/v1/chat?key=sk-live-...     <- key in the query
 *   https://user:sk-live-...@api.example.com/v1/chat    <- key in the userinfo
 *
 * A base URL is typed by a person and can hold a key in the query string, the
 * userinfo, even the path. So an audit line that stored the URL "for context"
 * would be a plaintext key store with a retention policy. A target is therefore
 * reduced to scheme, host and port, and the path, query, fragment and userinfo
 * are never captured at all. `describeTarget` is that reduction, and it is the
 * reason this module exists as its own file rather than a helper somewhere.
 *
 * Three decisions follow, and each is a way this could otherwise go wrong.
 *
 * 1. Records are built from an allow-list, one named field at a time, never by
 *    spreading what the caller passed. A spread copies whatever a caller - or a
 *    later refactor - put on the object, which is exactly how a body string ends
 *    up in a log. Naming each field means an extra key is dropped by
 *    construction rather than by remembering.
 *
 * 2. Records are frozen. A record that can be edited after it was written is not
 *    evidence: a later code path could widen `cloud` on an allowed call, or blank
 *    a block reason, and the trail would agree with it. Freezing makes the stored
 *    value final, and the sink stores only records that are already frozen.
 *
 * 3. The sink is bounded. A desktop session makes thousands of calls, and an
 *    unbounded array is a slow leak that grows fastest exactly when a provider
 *    is failing and something is retrying. Keeping the newest N is the useful
 *    end of a trail when a person asks why the call they just made failed.
 *
 * Nothing here throws, whatever it is handed: it runs on the main thread beside a
 * live request, and an audit failure must never become the reason a call fails.
 */

import { normalizeHost } from './ip-ranges.js'

/* ------------------------------------------------------------------ *
 * The vocabulary
 * ------------------------------------------------------------------ */

/**
 * How an attempt ended.
 *
 * `failed` is separate from `blocked` on purpose: blocked is a policy decision
 * this app made, failed is an attempt that never completed. Collapsing them
 * would hide the difference in exactly the report a person reads to tell
 * "we refused" from "it broke".
 */
export const AUDIT_OUTCOMES = Object.freeze(['allowed', 'blocked', 'failed'] as const)

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number]

/** Why a call was refused. Each is a policy answer, not a transport failure. */
export const AUDIT_BLOCK_REASONS = Object.freeze([
  'local_only',
  'unredacted_content',
  'invalid_target',
  'cross_origin_redirect',
  'too_many_redirects',
  'unsafe_scheme',
] as const)

export type AuditBlockReason = (typeof AUDIT_BLOCK_REASONS)[number]

const OUTCOMES: ReadonlySet<string> = new Set<string>(AUDIT_OUTCOMES)
const BLOCK_REASONS: ReadonlySet<string> = new Set<string>(AUDIT_BLOCK_REASONS)

/** A provider id or purpose longer than this is a caller bug, not a name. */
const MAX_LABEL_LENGTH = 120

/** The only schemes a model call may use (section 7.3 of the plan). */
const HTTP_SCHEMES: ReadonlySet<string> = new Set<string>(['http', 'https'])

const MIN_PORT = 1
const MAX_PORT = 65535
const MIN_STATUS = 100
const MAX_STATUS = 599

/** How many records a trail keeps before the oldest are dropped. */
const DEFAULT_AUDIT_LIMIT = 500

/* ------------------------------------------------------------------ *
 * The shape
 * ------------------------------------------------------------------ */

/**
 * Where a call was going, as far as the trail may remember.
 *
 * Three fields and no more. There is deliberately no path, query, fragment or
 * userinfo on this type, so there is nowhere for a key to be stored: the type is
 * the rule, not a convention someone has to follow.
 */
export interface AuditTarget {
  scheme: string
  host: string
  /** The port as written, or null. A default port is never filled in. */
  port: number | null
}

/**
 * One attempt, as stored.
 *
 * Every field is readonly because a stored record is evidence: it says which
 * provider answered, for which purpose, on whose behalf, where the bytes were
 * going and whether they went. A record that could be edited afterwards would
 * prove nothing.
 */
export interface AuditRecord {
  readonly at: number
  readonly kind: 'egress'
  readonly outcome: AuditOutcome
  readonly reason: AuditBlockReason | null
  readonly providerId: string
  readonly purpose: string
  readonly businessId: number | null
  readonly userId: number
  readonly target: AuditTarget | null
  readonly cloud: boolean | null
  readonly status: number | null
  readonly redirects: number
}

/**
 * What a caller may say about an attempt.
 *
 * `providerId`, `purpose` and `userId` are required because a record without them
 * cannot be attributed to anything, and an unattributable audit line is worse
 * than none: it looks like coverage. `target` accepts a URL as well as a
 * description, so a caller holding the request URL can hand the whole thing over
 * and have it reduced here, at the one boundary that knows how.
 *
 * The tokens are typed as their unions on purpose, but every field is normalised
 * at runtime as well: a caller reading a value out of a settings file is not
 * bound by the compiler.
 */
export interface AuditInput {
  at?: number | null
  outcome?: AuditOutcome | string | null
  reason?: AuditBlockReason | string | null
  providerId: string
  purpose: string
  businessId?: number | null
  userId: number
  target?: AuditTarget | string | URL | null
  cloud?: boolean | null
  status?: number | null
  redirects?: number | null
}

/* ------------------------------------------------------------------ *
 * Reading values that may not be values
 * ------------------------------------------------------------------ */

/**
 * One property of a value that is not trusted to be an object.
 *
 * The input may be null, a number, a cyclic object, or an object whose getter
 * throws (a Proxy over a revoked target, or a settings object mid-teardown).
 * Every one of those has to read as "no value" rather than raise, because the
 * alternative is an audit call that fails a live request.
 */
function readField (source: unknown, key: string): unknown {
  if (typeof source !== 'object' || source === null) return undefined
  try {
    return (source as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function isOutcome (value: unknown): value is AuditOutcome {
  return typeof value === 'string' && OUTCOMES.has(value)
}

function isBlockReason (value: unknown): value is AuditBlockReason {
  return typeof value === 'string' && BLOCK_REASONS.has(value)
}

/** A URL from a value that claims to be one, or null. */
function parseUrl (value: unknown): URL | null {
  if (typeof value === 'string') {
    try {
      return new URL(value)
    } catch {
      return null
    }
  }

  if (typeof value !== 'object' || value === null) return null
  // A revoked Proxy throws from the prototype lookup, so even this is guarded.
  try {
    return value instanceof URL ? value : null
  } catch {
    return null
  }
}

/** A scheme with no colon, lower-cased, or null when it is not one we may use. */
function schemeOf (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const scheme = value.trim().toLowerCase().replace(/:$/, '')
  return HTTP_SCHEMES.has(scheme) ? scheme : null
}

function isPort (value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PORT && value <= MAX_PORT
}

/**
 * The port exactly as written, or null.
 *
 * A missing port stays null instead of becoming 80 or 443: filling one in would
 * describe an endpoint the app never dialled, and the guard compares records
 * against the destination it actually used.
 */
function portOf (value: unknown): number | null {
  if (typeof value === 'number') return isPort(value) ? value : null
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return null
  const port = Number(value)
  return isPort(port) ? port : null
}

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

/**
 * Scheme, host and port of a URL, or null.
 *
 * The returned object is built field by field rather than copied from the URL,
 * which is the whole point: a URL object carries the path, the query, the
 * fragment and any userinfo, and none of them may be stored. Whatever a caller
 * passes, the answer is either those three fields or nothing.
 *
 * Anything that is not an http or https URL is null rather than "unknown host":
 * the guard reports an unparseable target as `invalid_target`, and a scheme it
 * will not dial as `unsafe_scheme`, so this only has to say "not a destination
 * we can describe".
 */
export function describeTarget (url: unknown): AuditTarget | null {
  const parsed = parseUrl(url)
  if (parsed === null) return null

  try {
    const scheme = schemeOf(parsed.protocol)
    if (scheme === null) return null

    // Brackets are URL syntax around an IPv6 literal, not part of the host, and
    // normalizeHost is the same normalisation the guard compares against.
    const host = normalizeHost(parsed.hostname)
    if (host === null) return null

    const target: AuditTarget = { scheme, host, port: portOf(parsed.port) }
    return Object.freeze(target)
  } catch {
    // A URL instance is a live object whose getters a caller could have replaced.
    return null
  }
}

/** A target given as an already-reduced object, re-checked and rebuilt. */
function coerceTarget (value: unknown): AuditTarget | null {
  if (typeof value !== 'object' || value === null) return null

  const scheme = schemeOf(readField(value, 'scheme'))
  if (scheme === null) return null

  const host = normalizeHost(readField(value, 'host'))
  if (host === null) return null

  const target: AuditTarget = { scheme, host, port: portOf(readField(value, 'port')) }
  return Object.freeze(target)
}

/** Whatever form a caller used, reduced to the three fields or to null. */
function targetOf (value: unknown): AuditTarget | null {
  try {
    if (typeof value === 'string') return describeTarget(value)
    if (value instanceof URL) return describeTarget(value)
    return coerceTarget(value)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

function timestampOf (value: unknown, clock: () => number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // A caller-supplied clock can throw or answer nonsense; a record still needs a
  // finite time, because it is stored and sorted with the others.
  try {
    const now = clock()
    return Number.isFinite(now) ? now : 0
  } catch {
    return 0
  }
}

/**
 * Build a record from an allow-list of fields.
 *
 * `clock` is a parameter rather than `Date.now` for the same reason the sink
 * takes one: a test has to be able to say what time it is.
 *
 * Every read goes through `readField`, so no input shape can make this throw, and
 * every value is normalised to something the trail can be read back from: an
 * unknown outcome is `failed` (something did not work), an unknown reason is null
 * (there is no sentence for it on the screen), a business id that is not a
 * positive integer is null (there is no such business), and a provider or purpose
 * that is not a string is empty rather than "[object Object]".
 */
function buildRecord (input: unknown, clock: () => number): AuditRecord {
  const at = timestampOf(readField(input, 'at'), clock)

  const outcomeValue = readField(input, 'outcome')
  const outcome: AuditOutcome = isOutcome(outcomeValue) ? outcomeValue : 'failed'

  const reasonValue = readField(input, 'reason')
  const reason: AuditBlockReason | null = isBlockReason(reasonValue) ? reasonValue : null

  const providerValue = readField(input, 'providerId')
  const providerId = typeof providerValue === 'string'
    ? providerValue.slice(0, MAX_LABEL_LENGTH)
    : ''

  const purposeValue = readField(input, 'purpose')
  const purpose = typeof purposeValue === 'string'
    ? purposeValue.slice(0, MAX_LABEL_LENGTH)
    : ''

  const businessValue = readField(input, 'businessId')
  const businessId = typeof businessValue === 'number' &&
    Number.isInteger(businessValue) &&
    businessValue > 0
    ? businessValue
    : null

  const userValue = readField(input, 'userId')
  const userId = typeof userValue === 'number' &&
    Number.isInteger(userValue) &&
    userValue > 0
    ? userValue
    : 0

  const statusValue = readField(input, 'status')
  const status = typeof statusValue === 'number' &&
    Number.isInteger(statusValue) &&
    statusValue >= MIN_STATUS &&
    statusValue <= MAX_STATUS
    ? statusValue
    : null

  const redirectsValue = readField(input, 'redirects')
  const redirects = typeof redirectsValue === 'number' &&
    Number.isInteger(redirectsValue) &&
    redirectsValue >= 0
    ? redirectsValue
    : 0

  const cloudValue = readField(input, 'cloud')
  const cloud = typeof cloudValue === 'boolean' ? cloudValue : null

  const record: AuditRecord = {
    at,
    kind: 'egress',
    outcome,
    reason,
    providerId,
    purpose,
    businessId,
    userId,
    target: targetOf(readField(input, 'target')),
    cloud,
    status,
    redirects,
  }
  return Object.freeze(record)
}

/**
 * One frozen record from whatever a caller has.
 *
 * The input is read as `unknown` internally, so passing a settings object, a
 * half-built value or nothing at all produces a record rather than an exception.
 */
export function createAuditRecord (input: AuditInput): AuditRecord {
  return buildRecord(input, () => Date.now())
}

/* ------------------------------------------------------------------ *
 * The sink
 * ------------------------------------------------------------------ */

export interface AuditSink {
  record (entry: AuditRecord): void
  entries (): readonly AuditRecord[]
  clear (): void
  size (): number
}

/** A frozen object, or false when asking throws (a revoked Proxy does). */
function isFrozen (value: object): boolean {
  try {
    return Object.isFrozen(value)
  } catch {
    return false
  }
}

/**
 * One log line's worth of a value.
 *
 * Control characters fold to single spaces so a provider id cannot split a log
 * entry in two or start a line that reads like a separate record. Nothing else is
 * changed: the id is the app's own, not a payload.
 */
function logText (value: string): string {
  return value.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()
}

/**
 * A bounded trail in the order the calls happened.
 *
 * The field checks on `record()` are shallow on purpose - a frozen object whose
 * outcome is a known token - because the record is then rebuilt through the same
 * allow-list `createAuditRecord` uses. That means the sink can neither be used to
 * store free text (a URL, a body) nor made to disagree with the constructor about
 * what a record looks like.
 */
export function createAuditSink (options?: {
  limit?: number
  now?: () => number
  log?: { warn (message: string): void }
}): AuditSink {
  const requested = options?.limit
  const limit = typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested)
    : DEFAULT_AUDIT_LIMIT

  const providedClock = options?.now
  const clock: () => number = typeof providedClock === 'function'
    ? providedClock
    : () => Date.now()

  const log = options?.log
  const trail: AuditRecord[] = []

  function warn (message: string): void {
    if (typeof log !== 'object' || log === null) return
    try {
      if (typeof log.warn === 'function') log.warn(`zuricopilot egress audit: ${message}`)
    } catch {
      // A logger that throws must not turn an audit into a failed call. There is
      // nowhere further to report it, so it stops here by design.
    }
  }

  /**
   * The record to store, or null when the value is not one.
   *
   * A value that is not frozen is refused rather than copied: a mutable object
   * handed to the sink could be edited afterwards, and a trail that can be edited
   * is not evidence.
   */
  function acceptable (entry: unknown): AuditRecord | null {
    if (typeof entry !== 'object' || entry === null) return null
    if (!isFrozen(entry)) return null
    if (!isOutcome(readField(entry, 'outcome'))) return null
    return buildRecord(entry, clock)
  }

  function record (entry: AuditRecord): void {
    const stored = acceptable(entry)
    if (stored === null) return

    trail.push(stored)
    // The oldest go first: the newest record is the one a person asking "why did
    // that just fail" needs, and the trail must not grow with the session.
    while (trail.length > limit) trail.shift()

    if (stored.outcome === 'blocked') {
      // Provider, purpose and reason only. The target is exactly what must not be
      // written down: its host is a destination, and the URL it came from can
      // carry a key. An allowed call writes nothing, because it is the normal
      // case and a line per call would bury the refusals.
      const reason = stored.reason === null ? 'unspecified' : stored.reason
      warn(`blocked ${logText(stored.providerId)} for ${logText(stored.purpose)} (${reason})`)
    }
  }

  function entries (): readonly AuditRecord[] {
    // A new array every call, so a caller that sorts, splices or empties what it
    // got back cannot reorder the trail. The records inside are frozen already.
    return trail.slice()
  }

  function clear (): void {
    trail.length = 0
  }

  function size (): number {
    return trail.length
  }

  // Frozen and closed over the array: no caller can reach in and replace it.
  return Object.freeze({ record, entries, clear, size })
}
