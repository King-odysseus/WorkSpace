/*
 * One adapter for every provider that speaks the OpenAI chat-completions shape.
 *
 * OpenAI, DeepSeek, Kimi, Together, OpenRouter, LM Studio and a custom endpoint
 * differ in their base URL, the header their key goes in, three paths, the model
 * they default to and what their models can do. All of that is data (see
 * `presets.ts`); this file is the translation, and it has no branch that names a
 * company. That is deliberate: a service-specific branch would be a path the
 * contract suite never runs and the guard's rules never cover.
 *
 * Two things this protocol does not do uniformly:
 *
 * - Tools. Some servers implement `tools`/`tool_calls` natively; a local model
 *   server may not. When the capability profile says 'prompted', the adapter
 *   asks for one JSON object and validates it instead of pretending the native
 *   protocol exists.
 * - Output-token fields and stream usage. `max_tokens` is universal enough to be
 *   the default, `max_completion_tokens` is what newer OpenAI chat models accept,
 *   and `stream_options.include_usage` is rejected by some compatible servers.
 *   Each is a preset flag rather than a guess at request time.
 */

import { ProviderError, toProviderFailure } from '../../../shared/providers/errors.js'
import { parseJsonReply } from '../../../shared/providers/structured.js'
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

export interface OpenAiCompatibleOptions {
  readonly preset: ProviderPreset
  readonly credential: string | null
  readonly baseUrl?: string
  readonly defaultModel?: string
}

type WireMessage = Record<string, unknown>

interface OpenToolCall {
  id: string | null
  name: string | null
  buffer: string
}

function asProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError(toProviderFailure(error))
}

function finishReason(value: string | null): FinishReason {
  switch (value) {
    case 'length':
      return 'length'
    case 'tool_calls':
    case 'function_call':
      return 'tool_call'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

function usageOf(payload: Record<string, unknown>): { in: number; out: number } {
  const usage = asRecord(payload.usage)
  if (usage === null) return { in: 0, out: 0 }
  return {
    in: asNonNegativeInteger(usage.prompt_tokens) ?? 0,
    out: asNonNegativeInteger(usage.completion_tokens) ?? 0,
  }
}

/** Text from a message content field that may be a string or a list of parts. */
function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  const list = asArray(content)
  if (list === null) return ''

  let text = ''
  for (const entry of list) {
    const record = asRecord(entry)
    if (record === null) continue
    if (asString(record.type) !== 'text') continue
    const chunk = asString(record.text)
    if (chunk !== null) text += chunk
  }
  return text
}

/**
 * Map one neutral turn to one or more wire messages.
 *
 * A `tool` turn becomes one message per result, because this protocol pairs a
 * tool message with a single `tool_call_id`. An assistant turn with tool calls
 * keeps them in one message, which is the shape the model produced them in.
 */
function wireMessages(message: ChatMessage): WireMessage[] {
  if (message.role === 'system') {
    const text = message.parts
      .map((part) => {
        if (part.type !== 'text') throw new ProviderError('internal_error')
        return part.text
      })
      .join('\n\n')
    return [{ role: 'system', content: text }]
  }

  if (message.role === 'tool') {
    const results: WireMessage[] = []
    for (const part of message.parts) {
      if (part.type !== 'tool_result') throw new ProviderError('internal_error')
      results.push({ role: 'tool', tool_call_id: part.toolCallId, content: part.content })
    }
    return results
  }

  const texts: string[] = []
  const images: { mediaType: string; data: string }[] = []
  const calls: { id: string; name: string; arguments: unknown }[] = []

  for (const part of message.parts) {
    if (part.type === 'text') texts.push(part.text)
    else if (part.type === 'image') images.push({ mediaType: part.mediaType, data: part.data })
    else if (part.type === 'tool_call') calls.push({ id: part.id, name: part.name, arguments: part.arguments })
    // A tool result outside a tool turn has no `tool_call_id` to attach to.
    else throw new ProviderError('internal_error')
  }

  const entry: WireMessage = { role: message.role }
  const text = texts.join('')

  if (images.length > 0) {
    const content: WireMessage[] = texts.map((piece) => ({ type: 'text', text: piece }))
    for (const image of images) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mediaType};base64,${image.data}` },
      })
    }
    entry.content = content
  } else if (text.length > 0) {
    entry.content = text
  } else if (calls.length > 0) {
    // A tool-calling assistant turn is allowed to carry no text at all.
    entry.content = null
  } else {
    entry.content = ''
  }

  if (calls.length > 0) {
    entry.tool_calls = calls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }))
  }

  return [entry]
}

const PROMPT_INSTRUCTIONS =
  'Reply with JSON only. To call a tool, reply {"tool":"<name>","arguments":{...}}. To answer without a tool, reply {"answer":"<text>"}.'

function promptedInstruction(tools: readonly ToolDefinition[]): string {
  const catalogue = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
  return `You may call one of these tools:\n${JSON.stringify(catalogue)}\n${PROMPT_INSTRUCTIONS}`
}

/** Put the tool instruction after the leading system turns, not at the end. */
function insertInstruction(messages: WireMessage[], instruction: string): void {
  let index = 0
  while (index < messages.length && messages[index]?.role === 'system') index += 1
  messages.splice(index, 0, { role: 'system', content: instruction })
}

/** Read the native tool calls of a completed reply. */
function nativeToolCalls(message: Record<string, unknown>): AssistantPart[] {
  const list = asArray(message.tool_calls)
  if (list === null) return []

  const parts: AssistantPart[] = []
  for (const entry of list) {
    const record = asRecord(entry)
    if (record === null) continue
    const fn = asRecord(record.function)
    if (fn === null) continue

    const id = asString(record.id)
    const name = asString(fn.name)
    // Without an id the app cannot send the result back, so a call missing one
    // is a broken reply rather than a call with an invented identity.
    if (id === null || name === null) throw new ProviderError('malformed_response')

    const raw = typeof fn.arguments === 'string' ? fn.arguments : ''
    parts.push({
      type: 'tool_call',
      id,
      name,
      arguments: parseArgumentsJson(raw.length === 0 ? '{}' : raw),
    })
  }
  return parts
}

/**
 * Read the one JSON object a prompted model was asked for.
 *
 * Anything that is not exactly one of the two shapes is a `schema_mismatch`:
 * guessing which field the model meant is how a tool call ends up with
 * arguments nobody validated.
 */
function promptedParts(text: string): AssistantPart[] {
  const parsed = parseJsonReply(text)
  if (!parsed.ok) throw new ProviderError('schema_mismatch')

  const record = asRecord(parsed.value)
  if (record === null) throw new ProviderError('schema_mismatch')

  const tool = asString(record.tool)
  if (tool !== null) {
    const args = asRecord(record.arguments)
    if (args === null) throw new ProviderError('schema_mismatch')
    return [{ type: 'tool_call', id: 'prompted_1', name: tool, arguments: args }]
  }

  if (typeof record.answer === 'string') return [{ type: 'text', text: record.answer }]
  throw new ProviderError('schema_mismatch')
}

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions,
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

  /** Every request passes these checks before a URL is built. */
  const checkRequest = (
    request: ChatRequest,
    modelId: string,
  ): { capabilities: ProviderCapabilities; prompted: boolean } => {
    const capabilities = capabilitiesOf(modelId)

    refuseWhenUnsupported(request.jsonMode === true && !capabilities.jsonMode)

    const hasImage = request.messages.some((message) =>
      message.parts.some((part) => part.type === 'image'),
    )
    refuseWhenUnsupported(hasImage && !capabilities.vision)

    const wantsTools = request.tools !== undefined && request.tools.length > 0
    refuseWhenUnsupported(wantsTools && capabilities.tools === 'none')

    return { capabilities, prompted: wantsTools && capabilities.tools === 'prompted' }
  }

  const buildBody = (
    request: ChatRequest,
    modelId: string,
    capabilities: ProviderCapabilities,
    prompted: boolean,
    streaming: boolean,
  ): Record<string, unknown> => {
    const messages: WireMessage[] = []
    for (const message of request.messages) messages.push(...wireMessages(message))

    if (prompted && request.tools !== undefined && request.tools.length > 0) {
      insertInstruction(messages, promptedInstruction(request.tools))
    }

    const body: Record<string, unknown> = {
      model: modelId,
      [preset.maxTokensField ?? 'max_tokens']: outputBudget(request.maxOutputTokens, capabilities),
      messages,
      stream: streaming,
    }

    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.stop !== undefined) body.stop = request.stop
    if (request.jsonMode === true) body.response_format = { type: 'json_object' }

    if (request.tools !== undefined && request.tools.length > 0 && !prompted) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
      body.tool_choice = 'auto'
    }

    // Some compatible servers reject an unknown field, so usage in a stream is
    // requested only where the preset says the server understands it.
    if (streaming && preset.streamUsage === true) {
      body.stream_options = { include_usage: true }
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
      const { capabilities, prompted } = checkRequest(request, modelId)

      const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.chat), {
        method: 'POST',
        headers: headers(false),
        body: buildBody(request, modelId, capabilities, prompted, false),
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')

      const choices = asArray(payload.choices)
      const choice = choices === null ? null : asRecord(choices[0])
      if (choice === null) throw new ProviderError('malformed_response')
      const message = asRecord(choice.message)
      if (message === null) throw new ProviderError('malformed_response')

      const text = textOfContent(message.content)
      let parts: AssistantPart[]
      if (prompted) {
        parts = promptedParts(text)
      } else {
        parts = text.length > 0 ? [{ type: 'text', text }] : []
        parts.push(...nativeToolCalls(message))
      }
      if (parts.length === 0) throw new ProviderError('malformed_response')

      const answered = prompted
        ? parts.some((part) => part.type === 'tool_call')
          ? 'tool_call'
          : 'stop'
        : finishReason(asString(choice.finish_reason))

      return {
        providerId,
        modelId: asString(payload.model) ?? modelId,
        cloud,
        usage: usageOf(payload),
        finishReason: answered,
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
    const { capabilities, prompted } = checkRequest(request, modelId)
    refuseWhenUnsupported(!capabilities.streaming)
    if (isAborted(ctx)) throw new ProviderError('aborted')

    const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.chat), {
      method: 'POST',
      headers: headers(true),
      body: buildBody(request, modelId, capabilities, prompted, true),
      secretHeaders,
    })
    await assertOk(response)

    const parts: AssistantPart[] = []
    const openCalls = new Map<number, OpenToolCall>()
    let reportedModel = modelId
    let inTokens = 0
    let outTokens = 0
    let finish: string | null = null
    let promptedText = ''

    for await (const event of readSse(response)) {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      if (event.data === '[DONE]') break
      if (event.data.length === 0) continue

      const payload = sseJson(event.data)
      if (payload === null) continue

      const streamError = asRecord(payload.error)
      if (streamError !== null) throw new ProviderError(classifyStreamError(streamError))

      reportedModel = asString(payload.model) ?? reportedModel

      const usage = asRecord(payload.usage)
      if (usage !== null) {
        inTokens = asNonNegativeInteger(usage.prompt_tokens) ?? inTokens
        outTokens = asNonNegativeInteger(usage.completion_tokens) ?? outTokens
      }

      const choices = asArray(payload.choices)
      // A usage-only chunk has no choices; it is information, not a failure.
      if (choices === null || choices.length === 0) continue
      const choice = asRecord(choices[0])
      if (choice === null) continue

      const delta = asRecord(choice.delta)
      if (delta !== null) {
        const chunk =
          typeof delta.content === 'string' ? delta.content : textOfContent(delta.content)

        if (chunk.length > 0) {
          // A prompted model's raw reply is JSON, not an answer: buffering it
          // keeps the wire format out of the caller's text.
          promptedText += chunk
          if (!prompted) {
            parts.push({ type: 'text', text: chunk })
            yield { type: 'text', text: chunk }
          }
        }

        const deltas = asArray(delta.tool_calls)
        if (!prompted && deltas !== null) {
          for (const entry of deltas) {
            const record = asRecord(entry)
            if (record === null) continue
            const index = asNonNegativeInteger(record.index) ?? openCalls.size
            const open = openCalls.get(index) ?? { id: null, name: null, buffer: '' }

            open.id = asString(record.id) ?? open.id
            const fn = asRecord(record.function)
            if (fn !== null) {
              open.name = asString(fn.name) ?? open.name
              if (typeof fn.arguments === 'string') open.buffer += fn.arguments
            }
            openCalls.set(index, open)
          }
        }
      }

      const reason = asString(choice.finish_reason)
      if (reason !== null) finish = reason
    }

    let finalParts: AssistantPart[]
    let answered: FinishReason

    if (prompted) {
      finalParts = promptedParts(promptedText)
      answered = finalParts.some((part) => part.type === 'tool_call') ? 'tool_call' : 'stop'
      for (const part of finalParts) {
        if (part.type === 'text') yield { type: 'text', text: part.text }
      }
    } else {
      const ordered = [...openCalls.entries()].sort((left, right) => left[0] - right[0])
      for (const [index, open] of ordered) {
        if (open.id === null || open.name === null) throw new ProviderError('malformed_response')
        const argumentsJson = open.buffer.length > 0 ? open.buffer : '{}'
        yield { type: 'tool_call', index, id: open.id, name: open.name, argumentsJson }
        parts.push({
          type: 'tool_call',
          id: open.id,
          name: open.name,
          arguments: parseArgumentsJson(argumentsJson),
        })
      }
      finalParts = mergeTextParts(parts)
      // No finish reason means the stream was cut short; saying "error" is more
      // honest than reporting a clean stop the provider never sent.
      answered = finish === null ? 'error' : finishReason(finish)
    }

    if (finalParts.length === 0) throw new ProviderError('malformed_response')

    yield {
      type: 'done',
      result: {
        providerId,
        modelId: reportedModel,
        cloud,
        usage: { in: inTokens, out: outTokens },
        finishReason: answered,
        parts: finalParts,
      },
    }
  }

  const embed = async (request: EmbedRequest, ctx: CallContext): Promise<EmbedResult> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const modelId = resolveModel(request.modelId)
      const capabilities = capabilitiesOf(modelId)
      const path = preset.paths.embeddings

      refuseWhenUnsupported(!capabilities.embeddings || path === null)
      if (path === null) throw new ProviderError('unsupported')

      const response = await deps.transport.request(ctx, joinUrl(baseUrl, path), {
        method: 'POST',
        headers: headers(false),
        body: { model: modelId, input: request.inputs },
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')
      const data = asArray(payload.data)
      if (data === null) throw new ProviderError('malformed_response')

      const ordered: { index: number; vector: number[] }[] = []
      for (const entry of data) {
        const record = asRecord(entry)
        if (record === null) continue

        const raw = asArray(record.embedding)
        if (raw === null || raw.length === 0) throw new ProviderError('malformed_response')

        const vector: number[] = []
        for (const value of raw) {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new ProviderError('malformed_response')
          }
          vector.push(value)
        }
        ordered.push({ index: asNonNegativeInteger(record.index) ?? ordered.length, vector })
      }

      ordered.sort((left, right) => left.index - right.index)
      const vectors = ordered.map((entry) => entry.vector)
      // One vector per input, in input order: a shorter list would silently
      // pair inputs with the wrong vectors downstream.
      if (vectors.length !== request.inputs.length) throw new ProviderError('malformed_response')

      return {
        providerId,
        modelId,
        cloud,
        usage: { in: usageOf(payload).in, out: 0 },
        vectors,
      }
    } catch (error) {
      throw asProviderError(error)
    }
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
