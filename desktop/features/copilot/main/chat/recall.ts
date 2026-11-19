/*
 * Asking the model for a small, typed answer about a conversation.
 *
 * Three features need this and each one needs it identically: pulling remembered
 * items out of an exchange, compressing a long thread, and drafting a task from
 * what the person asked for. They differ only in the schema and the wording, so
 * the parts that must not differ live here once.
 *
 * What lives here is precisely the part that has already been got wrong
 * somewhere in this app:
 *
 * 1. *The privacy rule applies to a recall call too.* These calls carry the
 *    conversation, so a cloud call must be substituted and checked exactly like a
 *    normal turn. A "summary" that sent the person's own words to a cloud model
 *    would be a hole in the rule that only shows up two messages later.
 *
 * 2. *One repair, and then a token.* `requestStructuredOutput` owns that policy,
 *    so a model that answers with prose costs one extra ask and never a crash.
 *
 * 3. *A failure is quiet and bounded.* Every caller treats a failed recall as
 *    "nothing learned this time" rather than as an error on screen: the person
 *    asked a question and got their answer, and a summary that could not be
 *    written is not their problem. The token is logged, never shown.
 *
 * Nothing here decides what to ask or what the answer means. It is the transport
 * between a schema and a provider, and it holds no key and builds no address.
 */

import type { z } from 'zod'

import type { CallContext, ChatMessage } from '../../shared/providers/types.js'
import { requestStructuredOutput } from '../../shared/providers/structured.js'
import { buildCloudPayload, type PrivacyIdentity } from './privacy.js'
import type { RoutedProvider } from '../providers/settings-service.js'

/**
 * The instruction added for the single repair attempt.
 *
 * It names the shape problems and nothing else. Repeating the model's own answer
 * back to it would double the prompt, and on a cloud call that means paying to
 * send the same text twice.
 */
export const REPAIR_INSTRUCTION =
  'That answer did not match the shape asked for. Answer again with JSON only, no prose and no code fence.'

/**
 * The conversation to send for a recall call, or null when it may not be sent.
 *
 * Null is a real answer: a cloud call whose text still identifies somebody is
 * refused, and the caller treats that as "nothing learned this time" rather than
 * inventing a second, subtler leak. Local calls are sent as they are, because the
 * model already runs on this machine and already sees what the person sees.
 */
export function recallConversation (
  conversation: readonly ChatMessage[],
  routed: RoutedProvider,
  identity: PrivacyIdentity,
): ChatMessage[] | null {
  if (!routed.cloud) return conversation.map((message) => ({ role: message.role, parts: [...message.parts] }))

  const payload = buildCloudPayload(conversation, identity)
  if (payload.preview.blocked) return null
  return payload.messages
}

export interface StructuredAsk {
  readonly routed: RoutedProvider
  readonly ctx: CallContext
  /** The instruction: what to read and what shape to answer in. */
  readonly system: string
  /** The conversation being reasoned about. Already substituted when it is cloud. */
  readonly conversation: readonly ChatMessage[]
}

/**
 * One typed answer from the model, with the single repair attempt.
 *
 * `temperature: 0` because every caller wants the same answer twice rather than a
 * different one each time; a remembered item that changes on every read would
 * make the panel flicker and the tests meaningless.
 */
export async function askStructured<T> (
  ask: StructuredAsk,
  schema: z.ZodType<T>,
): Promise<T> {
  return requestStructuredOutput({
    schema,
    async ask (attempt) {
      const messages: ChatMessage[] = [
        { role: 'system', parts: [{ type: 'text', text: ask.system }] },
        ...ask.conversation,
      ]

      if (attempt.repair) {
        messages.push({ role: 'user', parts: [{ type: 'text', text: REPAIR_INSTRUCTION }] })
      }

      const result = await ask.routed.provider.chat(
        { modelId: ask.routed.modelId ?? undefined, messages, temperature: 0 },
        ask.ctx,
      )

      return result.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
    },
  })
}
