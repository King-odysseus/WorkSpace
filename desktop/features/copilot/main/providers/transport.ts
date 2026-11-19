/*
 * The one door an adapter may use to reach a provider.
 *
 * Section 7.3 of the plan says every model call goes through the egress guard,
 * including the two that run before anything is configured (listing models and
 * testing a key). An adapter that held a `fetch` of its own could step around
 * that rule, and a rule enforced by remembering to obey it is not a rule. So an
 * adapter is handed this interface and nothing else: a request plus the call
 * context, and the guard decides whether it may leave.
 *
 * `createGuardedTransport` is the only implementation that ships. It turns a
 * `CallContext` into the guard's own context by adding the one fact only the
 * app can know - whether this business is local only - and then reduces
 * whatever the guard threw to a `ProviderError` built from a token.
 *
 * Two deliberate choices:
 *
 * 1. `isLocalOnly` has no default. A policy that silently answered "false"
 *    would let every cloud call out of a local-only business, and the failure
 *    would look exactly like a working app. The caller that wires the real
 *    policy has to name it.
 *
 * 2. A cancellation is checked before dialling. The guard also honours the
 *    signal, but an aborted request that never reaches the network leaves no
 *    audit line and no socket to clean up, and the person who pressed Cancel
 *    gets the answer immediately.
 */

import { ProviderError, toProviderFailure } from '../../shared/providers/errors.js'
import type { CallContext } from '../../shared/providers/types.js'
import { EgressBlockedError, type EgressGuard } from '../security/egress-guard.js'

export type TransportMethod = 'GET' | 'POST'

/**
 * What an adapter asks the transport to send.
 *
 * `secretHeaders` names any header the guard would not recognise as a
 * credential on its own. A custom OpenAI-compatible entry may call its key
 * header anything, and the guard drops secrets on a redirect; without the hint
 * the header would survive a cross-origin hop.
 */
export interface ProviderTransportRequest {
  readonly method: TransportMethod
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly secretHeaders?: readonly string[]
}

/**
 * The part of a response an adapter reads.
 *
 * `bytes` is the streaming door and `text()` is the whole-body one; they are
 * alternatives, because a socket delivers its bytes once. An adapter reads
 * `bytes` when the protocol streams and `text()` when it does not.
 */
export interface ProviderTransportResponse {
  readonly status: number
  readonly ok: boolean
  text(): Promise<string>
  json(): Promise<unknown>
  /**
   * The body as it arrives, chunk by chunk.
   *
   * Every reply an adapter reads happens to be complete already - a model list, a
   * connection test - but a conversation reply is a stream, and an adapter that
   * only learned its first word after the last one arrived has not streamed. This
   * is the one way to read a body before it is finished.
   *
   * Optional because a test double may only offer whole bodies, and because the
   * guard hands it on only when the transport below it can produce it.
   */
  bytes?: () => AsyncIterable<Uint8Array>
}

export interface ProviderTransport {
  request(
    ctx: CallContext,
    url: string,
    request: ProviderTransportRequest,
  ): Promise<ProviderTransportResponse>
}

/** Whether the business behind a call must never reach a cloud model. */
export type LocalOnlyPolicy = (ctx: CallContext) => boolean

/**
 * Reduce anything the guard threw to a failure token.
 *
 * An egress refusal is checked by type, not by message: `EgressBlockedError`
 * carries a `reason` token where a transport error carries a `code`, and only
 * the type tells the two apart without reading prose.
 */
function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error
  if (error instanceof EgressBlockedError) return new ProviderError('egress_blocked')
  return new ProviderError(toProviderFailure(error))
}

/** Whether a call has been cancelled. A helper because reading the signal again
 * after a first check would be narrowed to "not aborted" by the compiler. */
export function isAborted(ctx: CallContext): boolean {
  return ctx.signal?.aborted === true
}

export function createGuardedTransport(guard: EgressGuard, isLocalOnly: LocalOnlyPolicy): ProviderTransport {
  const transport: ProviderTransport = {
    async request(ctx, url, request) {
      if (isAborted(ctx)) throw new ProviderError('aborted')

      try {
        return await guard.fetch(
          {
            businessId: ctx.businessId,
            providerId: ctx.providerId,
            userId: ctx.userId,
            purpose: ctx.purpose,
            localOnly: isLocalOnly(ctx),
            /*
             * Stated separately from the business policy, and only when the caller
             * stated it: a business that is not local-only still must not have
             * unredacted text redirected to a cloud address, and the guard is the
             * only place that sees the hops. A request that says nothing is one
             * whose text was rewritten, so there is no promise to hold it to.
             */
            ...(ctx.unredactedContent === true ? { unredactedContent: true } : {}),
            signal: ctx.signal,
          },
          url,
          {
            method: request.method,
            headers: { ...request.headers },
            body: request.body,
            secretHeaders: request.secretHeaders,
          },
        )
      } catch (error) {
        throw asProviderError(error)
      }
    },
  }

  return Object.freeze(transport)
}
