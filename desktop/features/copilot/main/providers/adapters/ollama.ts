/*
 * The native adapter for a model server a person runs themselves.
 *
 * Ollama is the one provider in Phase 2 that is normally on this machine, and it
 * does not speak the OpenAI chat-completions shape. It has its own four routes,
 * and each differs from the compatible one in a way that would break a shim
 * built by transliteration:
 *
 *   POST /api/chat      one turn, or a stream of newline-separated JSON objects
 *   GET  /api/tags      the models already pulled onto this machine
 *   POST /api/embed     one vector per input, in input order
 *   POST /api/generate  the route that loads or unloads a model via `keep_alive`
 *
 * Four decisions follow, and each is a place a copy of the compatible adapter
 * would have gone wrong.
 *
 * 1. A stream is newline-delimited JSON, not server-sent events. There is no
 *    `data:` prefix and no blank line between objects, so `parseSse` would read
 *    an entire Ollama stream as zero events and return an empty answer that
 *    looked successful. Lines are parsed here, and a line that is not an object
 *    is a `malformed_response` rather than something skipped: a half-read stream
 *    would otherwise be reported to the person as a complete reply.
 *
 * 2. A tool call's `arguments` arrives as a JSON object, not a string. The
 *    compatible protocol streams it as text fragments that have to be joined and
 *    parsed; here it is already decoded, so it is taken as-is. Reading it both
 *    ways would turn a real argument object into the string "[object Object]".
 *
 * 3. A tool call has no id. Ollama does not invent one, and a call with an
 *    invented identity could not be answered reliably, so one is derived from
 *    the model, the turn and the position in it. It is stable within a reply and
 *    never claims to be the provider's.
 *
 * 4. Cloud or local is the endpoint's answer, never the provider's name. An
 *    "Ollama" entry pointed at a public host sends content to the cloud, and
 *    section 7.3 asks for exactly that distinction. `endpointIsCloud` decides it
 *    from the base URL the person configured, including a custom one.
 *
 * Nothing here installs anything or downloads a model. Discovery asks a running
 * server what it already has; an absent server is an ordinary answer.
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
import type { ProviderPreset } from '../presets.js'
import { providerIdFor } from '../presets.js'
import { isAborted, type ProviderTransport, type ProviderTransportResponse } from '../transport.js'
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
  readJson,
  readText,
  streamLines,
} from '../wire.js'

export interface OllamaOptions {
  readonly preset: ProviderPreset
  /** Null for a bare local server. A reverse proxy in front of one may want one. */
  readonly credential: string | null
  readonly baseUrl?: string
  readonly defaultModel?: string
  /**
   * How long a model stays resident after a call, in Ollama's own notation
   * ("5m", "1h") or as seconds. -1 keeps it loaded for ever, 0 unloads it.
   *
   * Unset means the server's own default, which is five minutes. Sending no
   * field at all is different from sending the default back, so it is omitted.
   */
  readonly keepAlive?: string | number
}

type WireMessage = Record<string, unknown>

function asProviderError(error: unknown): ProviderError {
  return error instanceof ProviderError ? error : new ProviderError(toProviderFailure(error))
}

/**
 * Ollama's reason for stopping, as the contract's five tokens.
 *
 * A reply carrying tool calls is reported as `tool_call` whatever the server
 * said, because the caller has to run the tool before the turn can finish.
 */
function finishReason(doneReason: string | null, hasToolCalls: boolean): FinishReason {
  const token = (doneReason ?? '').toLowerCase()
  if (token === 'length') return 'length'
  if (token === 'content_filter') return 'content_filter'
  return hasToolCalls ? 'tool_call' : 'stop'
}

/** Tokens in and out, from the two counters Ollama reports. Never invented. */
function usageOf(payload: Record<string, unknown>): { in: number; out: number } {
  return {
    in: asNonNegativeInteger(payload.prompt_eval_count) ?? 0,
    out: asNonNegativeInteger(payload.eval_count) ?? 0,
  }
}

/** Text from a message's content field, which is a plain string here. */
function textOfContent(content: unknown): string {
  return asString(content) ?? ''
}

/**
 * Turn a failure Ollama reported inside a 200 response into a token.
 *
 * The body is `{"error": "model \"x\" not found"}`, and the message is the only
 * field carrying the reason. Its words are matched by the shared classifier, and
 * the text itself is dropped: it can quote the request, which can carry a key.
 * Underscores are substituted for spaces so the classifier's own tokens match.
 */
function ollamaFailure(record: Record<string, unknown>): ProviderError {
  const message = asString(record.error) ?? ''
  return new ProviderError(classifyStreamError({ type: message.replace(/\s+/g, '_') }))
}

/* ------------------------------------------------------------------ *
 * Messages on the wire
 * ------------------------------------------------------------------ */

/**
 * One neutral turn as the messages this protocol accepts.
 *
 * Text parts are joined into the single `content` string the protocol expects,
 * images become bare base64 entries in `images`, and a tool result becomes a
 * `tool` turn. `isError` has no field here: it is dropped rather than folded
 * into the content, because rewriting a failed result as prose would change what
 * the model reads. A tool turn with no content can become nothing at all, and
 * refusing it here would fail a call the server would have accepted.
 */
function wireMessages(message: ChatMessage): WireMessage[] {
  const text = message.parts
    .filter((part): part is Extract<ChatMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')

  const images = message.parts
    .filter((part): part is Extract<ChatMessage['parts'][number], { type: 'image' }> => part.type === 'image')
    .map((part) => part.data)

  const calls = message.parts.filter((part) => part.type === 'tool_call')
  const results = message.parts.filter((part) => part.type === 'tool_result')

  if (message.role === 'tool') {
    return results.map((result) => ({ role: 'tool', content: result.content }))
  }

  const wire: WireMessage = { role: message.role, content: text }
  if (images.length > 0) wire.images = images

  if (calls.length > 0) {
    wire.tool_calls = calls.map((call) => ({
      function: { name: call.name, arguments: call.arguments },
    }))
  }

  return [wire]
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

/**
 * The id given to a tool call the provider did not name.
 *
 * It is built from the model and the position, so two calls in one reply are
 * distinguishable and a call is never confused with another reply's. The prefix
 * says it is the app's, so nothing downstream mistakes it for the provider's.
 */
function localToolCallId(modelId: string, index: number): string {
  return `ollama_${modelId}_${index}`
}

/**
 * Read the tool calls of a completed reply.
 *
 * `arguments` is already an object here - that is the difference from the
 * compatible protocol - and is passed through untouched so the caller validates
 * it against the tool's own schema.
 */
function nativeToolCalls(
  message: Record<string, unknown>,
  modelId: string,
): AssistantPart[] {
  const list = asArray(message.tool_calls)
  if (list === null) return []

  const parts: AssistantPart[] = []
  for (const entry of list) {
    const record = asRecord(entry)
    if (record === null) continue
    const fn = asRecord(record.function)
    if (fn === null) continue

    const name = asString(fn.name)
    // A call with no name cannot be answered, and cannot be guessed at.
    if (name === null || name.length === 0) throw new ProviderError('malformed_response')

    const given = asString(record.id)
    const id = given !== null && given.length > 0 ? given : localToolCallId(modelId, parts.length)

    parts.push({
      type: 'tool_call',
      id,
      name,
      arguments: fn.arguments === undefined ? {} : fn.arguments,
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
function promptedParts(text: string, modelId: string): AssistantPart[] {
  const parsed = parseJsonReply(text)
  if (!parsed.ok) throw new ProviderError('schema_mismatch')

  const record = asRecord(parsed.value)
  if (record === null) throw new ProviderError('schema_mismatch')

  const tool = asString(record.tool)
  if (tool !== null) {
    const args = asRecord(record.arguments)
    if (args === null) throw new ProviderError('schema_mismatch')
    return [{ type: 'tool_call', id: localToolCallId(modelId, 0), name: tool, arguments: args }]
  }

  if (typeof record.answer === 'string') return [{ type: 'text', text: record.answer }]
  throw new ProviderError('schema_mismatch')
}

/* ------------------------------------------------------------------ *
 * The stream
 * ------------------------------------------------------------------ */

/**
 * Every object in a newline-delimited body.
 *
 * A blank line is skipped because a trailing newline is ordinary. Anything else
 * that is not a JSON object is refused rather than ignored: a stream that
 * silently dropped a broken line would report a shorter answer than the model
 * gave, with no sign that anything was lost.
 */
function ndjsonObjects(text: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const record = ndjsonRecord(rawLine)
    if (record !== null) records.push(record)
  }
  return records
}

/** One line as a record, or null for a blank line. A broken line is a refusal. */
function ndjsonRecord(rawLine: string): Record<string, unknown> | null {
  const line = rawLine.trim()
  if (line.length === 0) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    throw new ProviderError('malformed_response')
  }
  const record = asRecord(parsed)
  if (record === null) throw new ProviderError('malformed_response')
  return record
}

/**
 * The records of a reply, handed on as they arrive.
 *
 * This protocol answers a stream with newline-delimited JSON, so the events are
 * lines and the deltas are the fragments inside them. Reading the whole body
 * first would answer correctly and would show the person nothing until the model
 * had finished, which is the one thing a streaming mode exists to avoid.
 *
 * A transport that can only offer a whole body takes the same route one record at
 * a time, so a recorded fixture and a live server are read by the same code.
 */
async function* ndjsonRecords (
  response: ProviderTransportResponse,
): AsyncGenerator<Record<string, unknown>> {
  const bytes = response.bytes
  if (typeof bytes === 'function') {
    for await (const line of streamLines(bytes())) {
      const record = ndjsonRecord(line)
      if (record !== null) yield record
    }
    return
  }

  for (const record of ndjsonObjects(await readText(response))) yield record
}

/* ------------------------------------------------------------------ *
 * The adapter
 * ------------------------------------------------------------------ */

export interface OllamaProvider extends AIProvider {
  /**
   * Ask the server to keep a model resident, or to let it go.
   *
   * Outside the neutral interface on purpose: no hosted provider has a resident
   * model to manage, so adding it there would ask every adapter to implement a
   * concept that does not exist for it.
   */
  loadModel (modelId: string, ctx: CallContext): Promise<boolean>
  unloadModel (modelId: string, ctx: CallContext): Promise<boolean>
}

export function createOllamaProvider(
  options: OllamaOptions,
  deps: { readonly transport: ProviderTransport },
): OllamaProvider {
  const preset = options.preset
  const providerId = providerIdFor(preset)
  const baseUrl = (options.baseUrl ?? preset.baseUrl).trim()
  // The destination, not the provider's name (section 7.3).
  const cloud = endpointIsCloud(baseUrl)
  const learned = new Map<string, ProviderCapabilities>()

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json',
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

  /** The keep-alive field, present only when the person configured one. */
  const keepAliveField = (): Record<string, unknown> =>
    options.keepAlive === undefined ? {} : { keep_alive: options.keepAlive }

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

    // Ollama groups sampling controls under `options`, and `num_predict` is its
    // name for the output budget. A compatible body's `max_tokens` is ignored
    // here, which is why the field is not reused.
    const sampling: Record<string, unknown> = {
      num_predict: outputBudget(request.maxOutputTokens, capabilities),
    }
    if (request.temperature !== undefined) sampling.temperature = request.temperature
    if (request.stop !== undefined) sampling.stop = request.stop

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: streaming,
      options: sampling,
      ...keepAliveField(),
    }

    if (request.jsonMode === true) body.format = 'json'

    if (request.tools !== undefined && request.tools.length > 0 && !prompted) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }

    return body
  }

  /** The reply parts of one completed message, refusing one that says nothing. */
  const partsOf = (
    message: Record<string, unknown>,
    modelId: string,
    prompted: boolean,
  ): AssistantPart[] => {
    const text = textOfContent(message.content)
    const parts = prompted ? promptedParts(text, modelId) : nativeToolCalls(message, modelId)
    if (parts.length > 0) {
      // A prompted reply's text is the JSON envelope, never the answer itself.
      if (!prompted && text.length > 0) return [{ type: 'text', text }, ...parts]
      return parts
    }
    if (text.length > 0) return [{ type: 'text', text }]
    throw new ProviderError('malformed_response')
  }

  const listModels = async (ctx: CallContext): Promise<ModelInfo[]> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.models), {
        method: 'GET',
        headers: headers(),
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
        headers: headers(),
        body: buildBody(request, modelId, capabilities, prompted, false),
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')
      if (payload.error !== undefined) throw ollamaFailure(payload)

      const message = asRecord(payload.message)
      if (message === null) throw new ProviderError('malformed_response')

      const parts = partsOf(message, modelId, prompted)

      return {
        providerId,
        modelId,
        cloud,
        usage: usageOf(payload),
        finishReason: finishReason(asString(payload.done_reason), parts.some((part) => part.type === 'tool_call')),
        parts,
      }
    } catch (error) {
      throw asProviderError(error)
    }
  }

  const streamCall = async function* (
    request: ChatRequest,
    ctx: CallContext,
  ): AsyncIterable<ChatDelta> {
    if (isAborted(ctx)) throw new ProviderError('aborted')
    const modelId = resolveModel(request.modelId)
    const { capabilities, prompted } = checkRequest(request, modelId)
    if (!capabilities.streaming) throw new ProviderError('unsupported')

    let response: ProviderTransportResponse
    try {
      response = await deps.transport.request(ctx, joinUrl(baseUrl, preset.paths.chat), {
        method: 'POST',
        headers: headers(),
        body: buildBody(request, modelId, capabilities, prompted, true),
        secretHeaders,
      })
      await assertOk(response)
    } catch (error) {
      throw asProviderError(error)
    }

    let text = ''
    const calls: AssistantPart[] = []
    let usage = { in: 0, out: 0 }
    let reason: FinishReason = 'stop'

    try {
      for await (const record of ndjsonRecords(response)) {
        if (isAborted(ctx)) throw new ProviderError('aborted')
        if (record.error !== undefined) throw ollamaFailure(record)

        const message = asRecord(record.message)
        const chunk = message === null ? '' : textOfContent(message.content)
        if (chunk.length > 0) {
          text += chunk
          // A prompted reply is the JSON envelope itself, not an answer the
          // person may read. Streaming it would show them `{"tool":...` one
          // fragment at a time, so it is held until the envelope is complete.
          if (!prompted) yield { type: 'text', text: chunk }
        }

        if (message !== null) {
          for (const part of nativeToolCalls(message, modelId)) {
            calls.push(part)
            if (part.type !== 'tool_call') continue
            yield {
              type: 'tool_call',
              index: calls.length - 1,
              id: part.id,
              name: part.name,
              argumentsJson: JSON.stringify(part.arguments ?? {}),
            }
          }
        }

        if (record.done === true) {
          usage = usageOf(record)
          reason = finishReason(asString(record.done_reason), calls.length > 0)
        }
      }

      /*
       * The final delta is the only place a caller learns usage and attribution,
       * so one is always sent. A server that ended its stream without saying so
       * leaves the counts at zero, which the ledger labels as an estimate rather
       * than reporting a figure nobody measured.
       */
      let parts: AssistantPart[]
      if (prompted) {
        parts = promptedParts(text, modelId)
        if (calls.length > 0) parts = [...parts, ...calls]
        reason = parts.some((part) => part.type === 'tool_call') ? 'tool_call' : reason
      } else {
        parts = []
        if (text.length > 0) parts.push({ type: 'text', text })
        parts.push(...calls)
      }
      if (parts.length === 0) throw new ProviderError('malformed_response')

      yield {
        type: 'done',
        result: { providerId, modelId, cloud, usage, finishReason: reason, parts },
      }
    } catch (error) {
      throw asProviderError(error)
    }
  }

  const embed = async (request: EmbedRequest, ctx: CallContext): Promise<EmbedResult> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const modelId = resolveModel(request.modelId)
      refuseWhenUnsupported(!capabilitiesOf(modelId).embeddings)

      // A provider with no embedding route cannot answer this at all.
      const embeddingsPath = preset.paths.embeddings
      if (embeddingsPath === null) throw new ProviderError('unsupported')

      const response = await deps.transport.request(ctx, joinUrl(baseUrl, embeddingsPath), {
        method: 'POST',
        headers: headers(),
        body: { model: modelId, input: request.inputs, ...keepAliveField() },
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')
      if (payload.error !== undefined) throw ollamaFailure(payload)

      const raw = asArray(payload.embeddings)
      if (raw === null || raw.length !== request.inputs.length) {
        throw new ProviderError('malformed_response')
      }

      const vectors: number[][] = []
      for (const entry of raw) {
        const vector = asArray(entry)
        // One vector per input, each a non-empty list of finite numbers. A short
        // or ragged answer would silently misalign every later comparison.
        if (vector === null || vector.length === 0) throw new ProviderError('malformed_response')
        if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
          throw new ProviderError('malformed_response')
        }
        vectors.push(vector as number[])
      }

      return {
        providerId,
        modelId,
        cloud,
        usage: { in: asNonNegativeInteger(payload.prompt_eval_count) ?? 0, out: 0 },
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
      return { ok: false, failure: asProviderError(error).failure }
    }
  }

  /**
   * Ask the server to have a model resident, or to let it go.
   *
   * This is the route that makes keep-alive a usable feature rather than a
   * setting: `keep_alive: 0` unloads a model immediately, and loading one before
   * a first call turns a slow first turn into a fast one. No prompt is sent, so
   * nothing is generated and nothing is charged.
   */
  const setKeepAlive = async (
    modelId: string,
    keepAlive: string | number,
    ctx: CallContext,
  ): Promise<boolean> => {
    try {
      if (isAborted(ctx)) throw new ProviderError('aborted')
      const model = modelId.trim()
      if (model.length === 0) throw new ProviderError('model_not_found')

      // A provider with no load route simply has no resident model to manage.
      const loadPath = preset.paths.load
      if (loadPath === undefined) throw new ProviderError('unsupported')

      const response = await deps.transport.request(ctx, joinUrl(baseUrl, loadPath), {
        method: 'POST',
        headers: headers(),
        body: { model, keep_alive: keepAlive, stream: false },
        secretHeaders,
      })
      await assertOk(response)

      const payload = asRecord(await readJson(response))
      if (payload === null) throw new ProviderError('malformed_response')
      if (payload.error !== undefined) throw ollamaFailure(payload)
      // The server answers 200 with `done: true` only once the model is resident
      // (or released). Anything else means the request was accepted but not
      // acted on, which a caller must not read as success.
      return payload.done === true
    } catch (error) {
      throw asProviderError(error)
    }
  }

  return {
    id: providerId,
    listModels,
    chat,
    stream: streamCall,
    embed,
    countTokens,
    testConnection,
    loadModel: (modelId: string, ctx: CallContext) =>
      setKeepAlive(modelId, options.keepAlive ?? preset.keepAlive ?? '5m', ctx),
    unloadModel: (modelId: string, ctx: CallContext) => setKeepAlive(modelId, 0, ctx),
  }
}
