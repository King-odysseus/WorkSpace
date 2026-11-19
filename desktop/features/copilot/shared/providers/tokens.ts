/*
 * A rough, local token estimate, for the one job that needs a number before a
 * call is made: telling a model's limit (and later a spend limit) how big a
 * request is.
 *
 * It is deliberately not a tokenizer. A real one is a per-model vocabulary of
 * tens of thousands of entries, and shipping one per provider would be both a
 * dependency and a lie about accuracy the moment a model is updated. Section
 * 9.1 asks `countTokens` to "estimate if the provider has no counter", so the
 * estimate is a character count over a divisor, and every caller treats it as
 * an estimate.
 *
 * Two properties matter more than precision, and both are tested:
 *
 * - It never makes a network call, so it can run on the main thread while a
 *   person types a message.
 * - It never throws. It is fed model output and tool arguments, which are
 *   untrusted and can be cyclic, enormous, or not JSON at all; an estimator
 *   that threw would turn a display problem into a failed request.
 */

import type { ChatMessage, ChatRequest, MessagePart } from './types.js'

/**
 * Characters per token.
 *
 * Four is the usual rule of thumb for English prose in current vocabularies.
 * Nigerian English prose, code and JSON all run a little denser, which makes
 * this a slight over-estimate for them - the safe direction, since the number
 * is used to refuse a request that would not fit.
 */
export const CHARS_PER_TOKEN = 4

/** Providers frame each turn with role and separator tokens, roughly this many. */
export const MESSAGE_OVERHEAD_TOKENS = 4

/**
 * An image costs far more than its character count suggests, and the exact cost
 * depends on resolution and on a tiling rule that differs per provider. A flat
 * figure is used so an image-heavy request is not estimated at almost nothing.
 */
export const IMAGE_TOKEN_ESTIMATE = 850

/** A tool result is framed like a message, so it carries the same overhead. */
export const TOOL_RESULT_OVERHEAD_TOKENS = MESSAGE_OVERHEAD_TOKENS

/**
 * JSON.stringify that cannot throw.
 *
 * Tool arguments arrive from a model and are untrusted: they may be cyclic, or
 * contain a BigInt, either of which makes JSON.stringify throw. An empty string
 * under-counts by a few tokens and is the right trade against failing a request
 * because a size estimate could not be computed.
 */
function safeJson(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

/** Tokens for one piece of text. Empty text is zero, not one. */
export function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0
  // At least one: a single character still occupies a token once framed.
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN))
}

/** Tokens for one part of a message. */
export function estimatePartTokens(part: MessagePart): number {
  switch (part.type) {
    case 'text':
      return estimateTextTokens(part.text)
    case 'image':
      return IMAGE_TOKEN_ESTIMATE
    case 'tool_call':
      // The name and the arguments are what the model emitted, so both count.
      return estimateTextTokens(part.name) + estimateTextTokens(safeJson(part.arguments))
    case 'tool_result':
      return TOOL_RESULT_OVERHEAD_TOKENS + estimateTextTokens(part.content)
  }
}

/** Tokens for one turn, including its framing. */
export function estimateMessageTokens(message: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS
  for (const part of message.parts) total += estimatePartTokens(part)
  return total
}

/**
 * Tokens for a whole request: the conversation, plus the tool definitions that
 * are resent with every call and are often the largest fixed part of a prompt.
 */
export function estimateChatTokens(request: ChatRequest): number {
  let total = 0
  for (const message of request.messages) total += estimateMessageTokens(message)

  for (const tool of request.tools ?? []) {
    total += estimateTextTokens(tool.name)
    total += estimateTextTokens(tool.description)
    total += estimateTextTokens(safeJson(tool.parameters))
  }

  return total
}
