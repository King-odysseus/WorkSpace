/*
 * Anthropic's Messages API, translated to the neutral provider contract.
 *
 * Three differences from the OpenAI-shaped services are worth naming, because
 * each one is a place a careless mapping would change what the model sees:
 *
 * 1. The system prompt is a top-level field, not a message. System turns are
 *    collected into it, and a system turn carrying an image is refused rather
 *    than silently dropped: the caller asked for something this protocol cannot
 *    express.
 * 2. Roles must alternate. Two consecutive user turns are merged into one
 *    message, which is also what a tool result needs, because Anthropic carries
 *    tool results in a user turn.
 * 3. `max_tokens` is required. The capability profile supplies a number when
 *    the caller did not, so a call can never be rejected for a missing field.
 *
 * The adapter reads its stream from the response text rather than from a socket
 * because the guarded transport hands back text (see `ProviderTransportResponse`).
 * Every delta is therefore produced after the body arrived; the shape of the
 * stream a caller sees is unaffected.
 */

import { ProviderError, toProviderFailure } from '../../../shared/providers/errors.js'
import { estimateChatTokens } from '../../../shared/providers/tokens.js'
import type {
  AIProvider,
  AssistantPart,
  CallContext,
  ChatDelta,
  ChatMessage,
  ChatRequest,
  ChatResult,
  EmbedRequest,
  EmbedResult,
  FinishReason,
  MessagePart,
  ModelInfo,
  ProviderCapabilities,
  TestResult,
  ToolDefinition,
} from '../../../shared/providers/types.js'
import { modelsFromPayload, outputBudget, resolveCapabilities } from '../capabilities.js'
import { mergeTextParts } from '../parts.js'
import { providerIdFor, type ProviderPreset } from '../presets.js'
import { isAborted, type ProviderTransport } from '../transport.js'
import {
  asArray,
  asNonNegativeInteger,
  asRecord,
  asString,
  assertOk,
  authFor,
  classifyStreamError,
  credentialHeaderNames,
  endpointIsCloud,
  joinUrl,
  parseArgumentsJson,
  readSse,
  readJson,
  sseJson,
} from '../wire.js'

const DEFAULT_API_VERSION = '2023-06-01'

export interface AnthropicProviderOptions {
  readonly preset: ProviderPreset
  readonly credential: string | null
  readonly baseUrl?: string
  readonly defaultModel?: string
  readonly apiVersion?: string
}

/** One content block, as the wire wants it. */
type WireBlock = Record<string, unknown>

interface WireMessage {
  readonly role: 'user' | 'assistant'
  readonly content: WireBlock[]
}

interface OpenToolCall {
  readonly id: string
  readonly name: string
  buffer: string
}

/** A thrown value the adapter may keep, or a token that replaces it. */
function asProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError(toProviderFailure(error))
}

function finishReason(stopReason: string | null, parts: readonly AssistantPart[]): FinishReason {
  switch (stopReason) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_call'
    case 'refusal':
      return 'content_filter'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    default:
      // A reply that arrived without a stop reason is treated as a normal stop
      // unless it asked for a tool, which is the only case a caller must act on.
      return parts.some((part) => part.type === 'tool_call') ? 'tool_call' : 'stop'
  }
}

/** Merge ends of a streamed reply so a long answer stays within the part cap. */
/** The system prompt, or undefined when the conversation has none. */
function systemPrompt(messages: readonly ChatMessage[]): string | undefined {
  const sections: string[] = []
  for (const message of messages) {
    if (message.role !== 'system') continue
    for (const part of message.parts) {
      if (part.type !== 'text') throw new ProviderError('internal_error')
      sections.push(part.text)
    }
  }
  return sections.length === 0 ? undefined : sections.join('\n\n')
}

/** One neutral part as an Anthropic content block. */
function wireBlock(part: MessagePart): WireBlock {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return {
        type: 'image',
        source: { type: 'base64', media_type: part.mediaType, data: part.data },
      }
    case 'tool_call':
      // `input` must be an object on this protocol. The arguments came from a
      // previous reply; a non-object is the caller's bug, and an empty object
      // keeps the conversation usable instead of failing the whole turn.
      return { type: 'tool_use', id: part.id, name: part.name, input: asRecord(part.arguments) ?? {} }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: part.content,
        is_error: part.isError === true,
      }
  }
}

/**
 * Map neutral messages, merging adjacent turns of the same role.
 *
 * Tool results travel in a user turn here, so a `tool` message and a following
 * `user` message must become one turn; sending two in a row is rejected by the
 * API rather than interpreted.
 */
function wireMessages(messages: readonly ChatMessage[]): WireMessage[] {
  const wire: WireMessage[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    const role = message.role === 'assistant' ? 'assistant' : 'user'
    const blocks: WireBlock[] = []
    for (const part of message.parts) {
      // A tool result on an assistant turn would be the model answering itself,
      // and a text part in a tool turn has no tool_use_id to belong to. Both are
      // caller bugs, and mapping either would change what the model is told.
      if (role === 'assistant' && part.type === 'tool_result') {
        throw new ProviderError('internal_error')
      }
      if (message.role === 'tool' && part.type !== 'tool_result') {
        throw new ProviderError('internal_error')
      }
      blocks.push(wireBlock(part))
    }
    if (blocks.length === 0) continue

    const previous = wire[wire.length - 1]
    if (previous !== undefined && previous.role === role) {
      previous.content.push(...blocks)
    } else {
      wire.push({ role, content: blocks })
    }
  }

  return wire
}

function toolSchemas(tools: readonly ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }))
}

/** Read `usage` from a message payload; a missing count is zero, never NaN. */
function usageOf(payload: Record<string, unknown>): { in: number; out: number } {
  const usage = asRecord(payload.usage)
  if (usage === null) return { in: 0, out: 0 }
  return {
    in: asNonNegativeInteger(usage.input_tokens) ?? 0,
    out: asNonNegativeInteger(usage.output_tokens) ?? 0,
  }
}

/** Read the text and tool-call blocks of a completed message. */
function partsOf(content: readonly unknown[]): AssistantPart[] {
  const parts: AssistantPart[] = []

  for (const block of content) {
    const record = asRecord(block)
    if (record === null) continue
    const type = asString(record.type)

    if (type === 'text') {
      const text = asString(record.text)
      if (text === null) continue
      parts.push({ type: 'text', text })
      continue
    }

    if (type === 'tool_use') {
      const id = asString(record.id)
      const name = asString(record.name)
      if (id === null || name === null) throw new ProviderError('malformed_response')
      parts.push({ type: 'tool_call', id, name, arguments: record.input ?? {} })
    }
    // thinking and redacted_thinking carry no answer, and an unknown block type
    // is something this app cannot use; both are skipped rather than guessed at.
  }

  return parts
}

/** Read one SSE payload, refusing a body that is not JSON. */
export function createAnthropicProvider(
  options: AnthropicProviderOptions,
  deps: { readonly transport: ProviderTransport },
): AIProvider {
  const preset = options.preset
  const providerId = providerIdFor(preset)
  const baseUrl = (options.baseUrl ?? preset.baseUrl).trim()
  const cloud = endpointIsCloud(baseUrl)
  const learned = new Map<string, ProviderCapabilities>()

  const headers = (streaming: boolean): Record<string, string> => ({
    'content-type': 'application/json',
    accept: streaming ? 'text/event-stream' : 'application/json',
    ...preset.extraHeaders,
    ...authFor(preset.auth, options.credential, preset.requiresKey),
    'anthropic-version': options.apiVersion ?? preset.apiVersion ?? DEFAULT_API_VERSION,
  })

  const secretHeaders = credentialHeaderNames(preset.auth)

  const resolveModel = (modelId: string | undefined): string => {
    const resolved = (modelId ?? options.defaultModel ?? preset.defaultModel).trim()
    if (resolved.length === 0) throw new ProviderError('model_not_found')
    return resolved
  }

  const capabilitiesOf = (modelId: string): ProviderCapabilities =>
    learned.get(modelId) ?? resolveCapabilities(preset, modelId)

  const refuseWhenUnsupported = (unsupported: boolean): void => {
    if (unsupported) throw new ProviderError('unsupported')
  }

  /** Checks every request has to pass before a socket is touched. */
  const checkRequest = (request: ChatRequest, modelId: string): ProviderCapabilities => {
    const capabilities = capabilitiesOf(modelId)
    refuseWhenUnsupported(request.jsonMode === true)
    const hasImage = request.messages.some((message) =>
      message.parts.some((part) => part.type === 'image'),
    )
    refuseWhenUnsupported(hasImage && !capabilities.vision)
    const wantsTools = request.tools !== undefined && request.tools.length > 0
    refuseWhenUnsupported(wantsTools && capabilities.tools !== 'native')
    return capabilities
  }

  const buildBody = (
    request: ChatRequest,
    modelId: string,
    capabilities: ProviderCapabilities,
    streaming: boolean,
  ): Record<string, unknown> => {
    const system = systemPrompt(request.messages)
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: outputBudget(request.maxOutputTokens, capabilities),
      messages: wireMessages(request.messages),
      stream: streaming,
    }
    if (system !== undefined) body.system = system
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.stop !== undefined) body.stop_sequences = request.stop
    if (request.tools !== undefined && request.tools.length > 0) {
      body.tools = toolSchemas(request.tools)
    }
    return body
  }

  const listModels = async (ctx: CallContext): Promise<ModelInfo[]> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.models), {
        method: 'GET',
        headers: headers(false),
        secretHeaders,
      })
      await assertOk(response)
      const models = modelsFromPayload(preset, providerId, cloud, await readJson(response))
      for (const model of models) learned.set(model.id, model.capabilities)
      return models
    } catch (error) {
      throw asProviderError(error)
    }
  }

  const chat = async (request: ChatRequest, ctx: CallContext): Promise<ChatResult> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const modelId = resolveModel(request.modelId)
      const capabilities = checkRequest(request, modelId)

      const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.chat), {
        method: 'POST',
        headers: headers(false),
        body: buildBody(request, modelId, capabilities, false),
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')

      const content = asArray(payload.content)
      if (content === null) throw new ProviderError('malformed_response')
      const parts = partsOf(content)
      if (parts.length === 0) throw new ProviderError('malformed_response')

      return {
        providerId,
        modelId: asString(payload.model) ?? modelId,
        cloud,
        usage: usageOf(payload),
        finishReason: finishReason(asString(payload.stop_reason), parts),
        parts,
      }
    } catch (error) {
      throw asProviderError(error)
    }
  }

  /*
   * A generator cannot be wrapped in the usual try/catch at the call site, so
   * the mapping happens here: a transport that throws something raw, or a body
   * that stops being readable, still reaches the caller as a failure token.
   */
  async function* stream(request: ChatRequest, ctx: CallContext): AsyncGenerator<ChatDelta> {
    try {
      yield* streamBody(request, ctx)
    } catch (error) {
      throw asProviderError(error)
    }
  }

  async function* streamBody(request: ChatRequest, ctx: CallContext): AsyncGenerator<ChatDelta> {
    const modelId = resolveModel(request.modelId)
    const capabilities = checkRequest(request, modelId)
    refuseWhenUnsupported(!capabilities.streaming)
    if (isAborted(ctx)) throw new ProviderError('aborted')

    const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.chat), {
      method: 'POST',
      headers: headers(true),
      body: buildBody(request, modelId, capabilities, true),
      secretHeaders,
    })
    await assertOk(response)

    const parts: AssistantPart[] = []
    const openCalls = new Map<number, OpenToolCall>()
    let reportedModel = modelId
    let inputTokens = 0
    let outputTokens = 0
    let stopReason: string | null = null

    for await (const event of readSse(response)) {
      // A cancelled stream must stop before doing more work, not merely stop
      // being read: the caller has already moved on.
      if (isAborted(ctx)) throw new ProviderError('aborted')
      if (event.data.length === 0) continue

      const payload = sseJson(event.data)
      if (payload === null) continue
      const type = asString(payload.type) ?? event.event

      switch (type) {
        case 'message_start': {
          const message = asRecord(payload.message)
          if (message === null) break
          reportedModel = asString(message.model) ?? reportedModel
          const usage = asRecord(message.usage)
          if (usage !== null) {
            inputTokens = asNonNegativeInteger(usage.input_tokens) ?? inputTokens
          }
          break
        }
        case 'content_block_start': {
          const index = asNonNegativeInteger(payload.index) ?? 0
          const block = asRecord(payload.content_block)
          if (block === null || asString(block.type) !== 'tool_use') break
          const id = asString(block.id)
          const name = asString(block.name)
          if (id === null || name === null) throw new ProviderError('malformed_response')
          openCalls.set(index, { id, name, buffer: '' })
          break
        }
        case 'content_block_delta': {
          const index = asNonNegativeInteger(payload.index) ?? 0
          const delta = asRecord(payload.delta)
          if (delta === null) break
          const deltaType = asString(delta.type)

          if (deltaType === 'text_delta') {
            const chunk = asString(delta.text)
            if (chunk === null) break
            parts.push({ type: 'text', text: chunk })
            yield { type: 'text', text: chunk }
            break
          }

          if (deltaType === 'input_json_delta') {
            const fragment = typeof delta.partial_json === 'string' ? delta.partial_json : ''
            const open = openCalls.get(index)
            if (open !== undefined) open.buffer += fragment
          }
          break
        }
        case 'content_block_stop': {
          const index = asNonNegativeInteger(payload.index) ?? 0
          const open = openCalls.get(index)
          if (open === undefined) break
          openCalls.delete(index)

          const argumentsJson = open.buffer.length > 0 ? open.buffer : '{}'
          yield { type: 'tool_call', index, id: open.id, name: open.name, argumentsJson }
          parts.push({
            type: 'tool_call',
            id: open.id,
            name: open.name,
            arguments: parseArgumentsJson(argumentsJson),
          })
          break
        }
        case 'message_delta': {
          const delta = asRecord(payload.delta)
          if (delta !== null) {
            const stop = asString(delta.stop_reason)
            if (stop !== null) stopReason = stop
          }
          const usage = asRecord(payload.usage)
          if (usage !== null) {
            outputTokens = asNonNegativeInteger(usage.output_tokens) ?? outputTokens
          }
          break
        }
        case 'error':
          throw new ProviderError(classifyStreamError(payload.error))
        default:
          break
      }
    }

    const finalParts = mergeTextParts(parts)
    if (finalParts.length === 0) throw new ProviderError('malformed_response')

    yield {
      type: 'done',
      result: {
        providerId,
        modelId: reportedModel,
        cloud,
        usage: { in: inputTokens, out: outputTokens },
        // A stream that never said why it stopped is reported as an error
        // finish rather than a clean stop, so a caller can tell it was cut off.
        finishReason: stopReason === null ? 'error' : finishReason(stopReason, finalParts),
        parts: finalParts,
      },
    }
  }

  const embed = async (_request: EmbedRequest, _ctx: CallContext): Promise<EmbedResult> => {
    // Anthropic publishes no embedding endpoint. Refusing here spends no key and
    // sends no content, and the caller gets the sentence that explains why.
    throw new ProviderError('unsupported')
  }

  const countTokens = async (request: ChatRequest): Promise<number> => estimateChatTokens(request)

  const testConnection = async (ctx: CallContext): Promise<TestResult> => {
    try {
      const models = await listModels(ctx)
      return { ok: true, modelCount: models.length }
    } catch (error) {
      return {
        ok: false,
        failure: error instanceof ProviderError ? error.failure : toProviderFailure(error),
      }
    }
  }

  return { id: providerId, listModels, chat, stream, embed, countTokens, testConnection }
}
