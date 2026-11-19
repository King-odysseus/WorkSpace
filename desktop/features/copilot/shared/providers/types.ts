/*
 * The provider-neutral contract every model adapter answers to.
 *
 * Section 9.1 of the plan names the shape; this module is where it lives. The
 * point of it is that a feature never learns which company answered: it sends
 * neutral messages and reads one neutral result, and the adapter in between
 * translates. Three rules follow from that, and each is a way this could
 * otherwise go wrong.
 *
 * 1. Every schema is strict, as in the access contract. An unknown key is a
 *    rejection, not a silent strip, so a caller cannot smuggle a provider field
 *    (a URL, an auth header, a raw wire payload) through a request that is
 *    supposed to describe a conversation.
 *
 * 2. An image part carries base64 `data`, never a `url`. A URL part would turn
 *    whatever the screen shows into a fetch instruction for a host the model
 *    named, and the egress guard would then be deciding whether to obey the
 *    screen rather than whether to obey the app. Images are bytes the app holds.
 *
 * 3. Every result carries its own attribution - provider, model, and whether the
 *    bytes went to the cloud or stayed local - plus usage. Without that the
 *    ledger cannot record cost and the screen cannot say who answered, so it is
 *    part of the contract rather than something each adapter may add.
 *
 * Cancellation rides on `CallContext.signal` rather than on each request: one
 * signal cancels a chat, a stream and an embedding, and the egress guard needs
 * it anyway to abandon a request that is already dead.
 */
import { z } from 'zod'

import { PROVIDER_FAILURES } from './errors.js'

/* ------------------------------------------------------------------ *
 * Enumerations
 * ------------------------------------------------------------------ */

/** Who is speaking. `tool` carries a tool result back to the model. */
export const PROVIDER_ROLES = Object.freeze(['system', 'user', 'assistant', 'tool'] as const)

export type ProviderRole = (typeof PROVIDER_ROLES)[number]

/**
 * How well a model can call tools (section 9.4).
 *
 * `native` means the provider's own tool protocol; `prompted` means the adapter
 * asks for JSON and validates it; `none` means the feature must work without
 * tools. The three exist because one feature has to run on all of them.
 */
export const TOOL_SUPPORT = Object.freeze(['native', 'prompted', 'none'] as const)

export type ToolSupport = (typeof TOOL_SUPPORT)[number]

/** Why the model stopped. `tool_call` means it wants a tool to run first. */
export const FINISH_REASONS = Object.freeze([
  'stop',
  'length',
  'tool_call',
  'content_filter',
  'error',
] as const)

export type FinishReason = (typeof FINISH_REASONS)[number]

/**
 * The image types an adapter may be handed.
 *
 * A closed list, not any string: each adapter has to know what its provider
 * accepts, and an unknown type is better refused here than silently relabelled
 * at the wire.
 */
export const IMAGE_MEDIA_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const)

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number]

/** Bounds that keep one request from being an unbounded upload or prompt. */
export const MAX_TEXT_CHARS = 1_000_000
export const MAX_IMAGE_CHARS = 8_000_000

/* ------------------------------------------------------------------ *
 * Capabilities and models
 * ------------------------------------------------------------------ */

/**
 * What one model can do, exactly as section 9.1 lists it.
 *
 * Capabilities are per model, not per provider: the same provider serves a
 * vision model and a text-only one, and a route that needs vision has to see
 * that difference before it picks.
 */
export const providerCapabilitiesSchema = z.strictObject({
  contextWindow: z.number().int().positive(),
  maxOutput: z.number().int().positive(),
  tools: z.enum(TOOL_SUPPORT),
  vision: z.boolean(),
  webSearch: z.boolean(),
  streaming: z.boolean(),
  embeddings: z.boolean(),
  jsonMode: z.boolean(),
})

export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

/**
 * One model a provider offers.
 *
 * `cloud` is the adapter's answer about where the bytes go, derived from the
 * endpoint it actually calls (section 7.3), not from the provider's name. An
 * "Ollama" entry pointed at a public host is a cloud model.
 */
export const modelInfoSchema = z.strictObject({
  id: z.string().min(1).max(200),
  providerId: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  cloud: z.boolean(),
  capabilities: providerCapabilitiesSchema,
})

export type ModelInfo = z.infer<typeof modelInfoSchema>

/* ------------------------------------------------------------------ *
 * Message parts
 * ------------------------------------------------------------------ */

export const textPartSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().max(MAX_TEXT_CHARS),
})

/** Base64 bytes and their media type. Deliberately no `url` field. */
export const imagePartSchema = z.strictObject({
  type: z.literal('image'),
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  data: z.string().min(1).max(MAX_IMAGE_CHARS),
})

/**
 * A model asking for a tool to run.
 *
 * `arguments` stays `unknown` because it is the model's JSON, not ours: the
 * caller validates it against the tool's own schema before acting on it, and
 * that validation is what stops a model from choosing its own arguments shape.
 * Nothing here executes a tool.
 */
export const toolCallPartSchema = z.strictObject({
  type: z.literal('tool_call'),
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  arguments: z.unknown(),
})

/** The result of a tool call, on its way back to the model. */
export const toolResultPartSchema = z.strictObject({
  type: z.literal('tool_result'),
  toolCallId: z.string().min(1).max(120),
  content: z.string().max(MAX_TEXT_CHARS),
  isError: z.boolean().optional(),
})

export const messagePartSchema = z.discriminatedUnion('type', [
  textPartSchema,
  imagePartSchema,
  toolCallPartSchema,
  toolResultPartSchema,
])

export type MessagePart = z.infer<typeof messagePartSchema>

/**
 * What a model may say back: text and tool calls only.
 *
 * A tool *result* in an assistant reply would be the model answering itself on
 * the app's behalf, so the reply schema cannot express it.
 */
export const assistantPartSchema = z.discriminatedUnion('type', [
  textPartSchema,
  toolCallPartSchema,
])

export type AssistantPart = z.infer<typeof assistantPartSchema>

export const chatMessageSchema = z.strictObject({
  role: z.enum(PROVIDER_ROLES),
  // A message with no parts carries nothing; refusing it here keeps every
  // adapter from having to decide what an empty turn means.
  parts: z.array(messagePartSchema).min(1).max(200),
})

export type ChatMessage = z.infer<typeof chatMessageSchema>

/* ------------------------------------------------------------------ *
 * Tools
 * ------------------------------------------------------------------ */

/**
 * One tool offered to a model.
 *
 * `parameters` is JSON Schema, passed through unchanged. It is a plain object
 * rather than a modelled shape because adapters must forward it verbatim;
 * reshaping it would drop keywords a provider understands.
 */
export const toolDefinitionSchema = z.strictObject({
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  parameters: z.record(z.string(), z.unknown()),
})

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>

/* ------------------------------------------------------------------ *
 * Requests and results
 * ------------------------------------------------------------------ */

export const chatRequestSchema = z.strictObject({
  // Omitted means "the provider's default model", which is what a connection
  // test wants; every routed call names one.
  modelId: z.string().min(1).max(200).optional(),
  messages: z.array(chatMessageSchema).min(1).max(500),
  tools: z.array(toolDefinitionSchema).max(64).optional(),
  maxOutputTokens: z.number().int().positive().max(200_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  jsonMode: z.boolean().optional(),
  stop: z.array(z.string().max(200)).max(8).optional(),
})

export type ChatRequest = z.infer<typeof chatRequestSchema>

/** Tokens in and out, as the provider reported them. The ledger labels estimates. */
export const usageSchema = z.strictObject({
  in: z.number().int().nonnegative(),
  out: z.number().int().nonnegative(),
})

export type Usage = z.infer<typeof usageSchema>

/**
 * One completed call.
 *
 * `parts` repeats the accumulated output even when the caller streamed it, so a
 * consumer that loses the stream still holds the whole answer. A caller that
 * streamed should read `parts` as the final word rather than concatenating
 * deltas it might have missed.
 */
export const chatResultSchema = z.strictObject({
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
  cloud: z.boolean(),
  usage: usageSchema,
  finishReason: z.enum(FINISH_REASONS),
  parts: z.array(assistantPartSchema).max(200),
})

export type ChatResult = z.infer<typeof chatResultSchema>

/**
 * One piece of a streamed answer.
 *
 * `tool_call` carries `argumentsJson` because provider protocols stream tool
 * arguments as a string fragment. The final `done` delta is the only place a
 * caller learns usage and attribution, so a stream that ends without it is
 * incomplete and sending one is the adapter's job.
 */
export const chatDeltaSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), text: z.string().max(MAX_TEXT_CHARS) }),
  z.strictObject({
    type: z.literal('tool_call'),
    index: z.number().int().nonnegative(),
    id: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    argumentsJson: z.string().max(MAX_TEXT_CHARS),
  }),
  z.strictObject({ type: z.literal('done'), result: chatResultSchema }),
])

export type ChatDelta = z.infer<typeof chatDeltaSchema>

export const embedRequestSchema = z.strictObject({
  modelId: z.string().min(1).max(200).optional(),
  inputs: z.array(z.string().max(MAX_TEXT_CHARS)).min(1).max(64),
})

export type EmbedRequest = z.infer<typeof embedRequestSchema>

export const embedResultSchema = z.strictObject({
  providerId: z.string().min(1).max(200),
  modelId: z.string().min(1).max(200),
  cloud: z.boolean(),
  usage: usageSchema,
  // One vector per input, in input order. A non-empty vector of finite numbers
  // is all a caller may rely on; the dimensions belong to the model.
  vectors: z.array(z.array(z.number().finite()).min(1)).max(64),
})

export type EmbedResult = z.infer<typeof embedResultSchema>

/**
 * The outcome of "Test connection".
 *
 * A refusal is a value, not a throw: the screen shows the reason beside the
 * button that caused it, and an exception would leave the caller to guess which
 * fixed token to draw. The failure is one of the safe tokens, so no server body
 * can reach the screen through it.
 */
export const testResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), modelCount: z.number().int().nonnegative() }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(PROVIDER_FAILURES) }),
])

export type TestResult = z.infer<typeof testResultSchema>

/* ------------------------------------------------------------------ *
 * The call context
 * ------------------------------------------------------------------ */

/**
 * What every model call is asked about itself (section 7.3).
 *
 * The egress guard cannot decide whether a call may leave the machine without
 * knowing which business it serves and why, and the audit log needs the same
 * facts. It is therefore a required argument of every network method rather
 * than something an adapter may invent.
 */
export const CALL_PURPOSES = Object.freeze([
  'chat_strategy',
  'quick',
  'embeddings',
  'research',
  'email_draft',
  'plan_tasks',
  'dna_extract',
  // Pre-flight calls: listing models and testing a key happen before any
  // business is chosen, which is also why businessId may be null.
  'connection_test',
  'model_list',
] as const)

export type CallPurpose = (typeof CALL_PURPOSES)[number]

const callContextInputSchema = z.strictObject({
  businessId: z.number().int().positive().nullable(),
  providerId: z.string().min(1).max(200),
  userId: z.number().int().positive(),
  purpose: z.enum(CALL_PURPOSES),
  /**
   * True when the request body still holds the person's own words, which is only
   * ever the case for a model whose endpoint looked local.
   *
   * The privacy rules rewrite the text for a cloud model and leave it alone for a
   * local one, so "the endpoint is local" is the only reason an unredacted body is
   * safe to send. A caller that states it here lets the guard hold the request to
   * that promise at every hop: an endpoint that answers with a redirect to a public
   * address would otherwise carry the private text out of the machine, because the
   * transport follows a redirect and the decision to redact was already made from
   * the first hostname.
   */
  unredactedContent: z.boolean().optional(),
})

export type CallContextInput = z.infer<typeof callContextInputSchema>

/**
 * The context as an adapter receives it.
 *
 * `signal` is outside the schema because an AbortSignal is not data: it is a
 * promise about the future, and it can be neither validated nor sent anywhere.
 * It is attached beside the validated fields instead.
 */
export interface CallContext extends CallContextInput {
  readonly signal?: AbortSignal
}

/**
 * Build a context, refusing anything malformed.
 *
 * Fail fast: an unknown purpose or a missing provider would otherwise reach the
 * guard and be refused there, where the reason is much harder to see.
 */
export function createCallContext(input: CallContextInput, signal?: AbortSignal): CallContext {
  const checked = callContextInputSchema.parse(input)
  return Object.freeze({ ...checked, signal })
}

/* ------------------------------------------------------------------ *
 * The adapter interface
 * ------------------------------------------------------------------ */

/**
 * One provider, as every feature sees it (section 9.1).
 *
 * `ctx` is added to `listModels` and `testConnection` relative to the plan's
 * sketch: both make a network call, and section 7.3 says every model call goes
 * through the guard with a context. Without it the guard would have to be
 * bypassed for exactly the two calls that run before anything is configured.
 */
export interface AIProvider {
  /** Stable id, for example 'anthropic', 'openai-compatible:deepseek', 'ollama'. */
  readonly id: string
  listModels(ctx: CallContext): Promise<ModelInfo[]>
  chat(request: ChatRequest, ctx: CallContext): Promise<ChatResult>
  stream(request: ChatRequest, ctx: CallContext): AsyncIterable<ChatDelta>
  embed(request: EmbedRequest, ctx: CallContext): Promise<EmbedResult>
  /** Local estimate when the provider has no counter. Never a network call. */
  countTokens(request: ChatRequest): Promise<number>
  testConnection(ctx: CallContext): Promise<TestResult>
}
