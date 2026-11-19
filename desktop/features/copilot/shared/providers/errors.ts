/*
 * Why a model call failed, reduced to fixed tokens and fixed sentences.
 *
 * Section 7.1 of the plan requires that a provider error becomes a safe message
 * and never includes the response body. That is a stronger rule than it sounds,
 * because the things that go wrong with a model call are exactly the things
 * that carry secrets:
 *
 * - A rejected key comes back with a body that may echo the key, and a request
 *   library may put the full URL in its error text.
 * - A malformed reply contains the provider's raw payload next to the field
 *   that was missing.
 * - A transport failure names the host it could not reach.
 *
 * So nothing from the original failure travels: `ProviderError` is built from a
 * token, its message is looked up from a table, and `cause` is deliberately not
 * set. `console.error(error)` prints `cause` as well as the message, so keeping
 * the original as a cause would leak through the one line logs use.
 *
 * The mapping in `toProviderFailure` is the only place a raw failure is read,
 * which means adapters never decide for themselves what to tell the person.
 */

/**
 * Every way a call can fail.
 *
 * These are tokens, not prose: they travel through IPC, into logs, and into the
 * usage ledger, so they must stay stable and must never carry a value.
 */
export const PROVIDER_FAILURES = Object.freeze([
  // The adapter cannot do this at all: no embeddings, no streaming, no tools.
  'unsupported',
  // The person cancelled, or the app abandoned the call.
  'aborted',
  // The provider could not be reached.
  'network',
  'timeout',
  // The key was rejected.
  'provider_unauthorized',
  'provider_rate_limited',
  'provider_unavailable',
  // The provider refused the request itself: a bad model id, a bad payload.
  'provider_rejected',
  // The reply did not have the shape the protocol requires.
  'malformed_response',
  // A prompted model answered with JSON that did not match the tool schema
  // after one repair attempt (section 9.4).
  'schema_mismatch',
  'context_too_long',
  'model_not_found',
  // The egress guard refused to let a cloud call leave a local-only business.
  'egress_blocked',
  // A bug in this app, not in the provider.
  'internal_error',
] as const)

export type ProviderFailure = (typeof PROVIDER_FAILURES)[number]

/**
 * What the person is told. One sentence each, action first.
 *
 * These are shown verbatim, so they never name a host, a model id, a token or
 * a server message: a person who sees "The key was rejected" knows to replace
 * the key, and a person who sees a URL has learned something about the network.
 */
export const PROVIDER_FAILURE_MESSAGES: Readonly<Record<ProviderFailure, string>> = Object.freeze({
  unsupported: 'This model cannot do that. Choose one that supports it.',
  aborted: 'The request was cancelled.',
  network: 'The provider could not be reached. Check the connection and try again.',
  timeout: 'The provider took too long to answer. Try again.',
  provider_unauthorized: 'The key was rejected. Replace it in Models.',
  provider_rate_limited: 'The provider is rate limiting this account. Try again shortly.',
  provider_unavailable: 'The provider is unavailable right now. Try again later.',
  provider_rejected: 'The provider refused this request.',
  malformed_response: 'The provider sent a reply this app could not read.',
  schema_mismatch: 'The reply did not match the shape this task needs. Try again.',
  context_too_long: 'This is too long for the model. Shorten it or start a new conversation.',
  model_not_found: 'That model is not available on this provider.',
  egress_blocked: 'This business is local only, so a cloud model cannot be used here.',
  internal_error: 'Something went wrong inside the assistant.',
})

/**
 * Failures worth retrying.
 *
 * A rejected key, a wrong model id or a shape mismatch will fail the same way
 * every time, so retrying them only delays the message the person needs.
 */
const RETRYABLE: ReadonlySet<ProviderFailure> = new Set<ProviderFailure>([
  'network',
  'timeout',
  'provider_rate_limited',
  'provider_unavailable',
])

/**
 * A failure already reduced to a token.
 *
 * The constructor takes only the token, which makes it impossible to pass an
 * original message in by accident.
 */
export class ProviderError extends Error {
  readonly failure: ProviderFailure
  readonly retryable: boolean

  constructor(failure: ProviderFailure) {
    super(PROVIDER_FAILURE_MESSAGES[failure])
    this.name = 'ProviderError'
    this.failure = failure
    this.retryable = RETRYABLE.has(failure)
  }
}

/**
 * Whether a thrown value is an abort.
 *
 * A cancelled fetch reports itself two ways depending on where it was
 * cancelled: a DOMException named AbortError from the platform, or a Node error
 * with code ABORT_ERR. Both mean the same thing to the person.
 */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR'
}

/** Read one field from a thrown value without trusting its type. */
function field(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined
  return (error as Record<string, unknown>)[key]
}

/**
 * Reduce anything a transport or an adapter threw to one of the tokens above.
 *
 * The order matters: an abort is checked first, because an aborted request is
 * often also reported as a network error and telling the person "check your
 * connection" after they pressed Cancel is a lie.
 */
export function toProviderFailure(error: unknown): ProviderFailure {
  if (error instanceof ProviderError) return error.failure
  if (isAbortError(error)) return 'aborted'

  const status = field(error, 'status')
  if (typeof status === 'number') {
    if (status === 401 || status === 403) return 'provider_unauthorized'
    if (status === 404) return 'model_not_found'
    if (status === 408) return 'timeout'
    if (status === 413) return 'context_too_long'
    if (status === 429) return 'provider_rate_limited'
    if (status >= 500) return 'provider_unavailable'
    if (status >= 400) return 'provider_rejected'
  }

  switch (field(error, 'code')) {
    case 'network_error':
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'network'
    case 'timeout':
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return 'timeout'
    case 'ABORT_ERR':
      return 'aborted'
    case 'egress_blocked':
      return 'egress_blocked'
    default:
      break
  }

  return 'internal_error'
}
