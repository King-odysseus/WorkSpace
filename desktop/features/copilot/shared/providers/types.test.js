'use strict'

/*
 * The provider-neutral contract, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * The schemas are the boundary between a feature and a provider, so the tests
 * are about what they refuse as much as what they accept. Four things are worth
 * pinning down:
 *
 * - Unknown keys are rejected, not stripped. Otherwise a caller could smuggle a
 *   provider field (a URL, an auth header) into a request that is only supposed
 *   to describe a conversation.
 * - An image carries base64 bytes and no URL, because a URL part would make a
 *   fetch instruction out of whatever the model or the screen named.
 * - Every reply carries attribution and usage, so the ledger and the screen
 *   cannot be left guessing who answered and what it cost.
 * - A call context refuses an unknown purpose, because the egress guard and the
 *   audit log are indexed by that purpose.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** One complete capability set: the shape every model has to describe. */
function capabilities (overrides = {}) {
  return {
    contextWindow: 200_000,
    maxOutput: 8192,
    tools: 'native',
    vision: true,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
    ...overrides,
  }
}

/** One model, with its own capabilities. */
function model (overrides = {}) {
  return {
    id: 'model-a',
    providerId: 'anthropic',
    label: 'Model A',
    cloud: true,
    capabilities: capabilities(),
    ...overrides,
  }
}

/** One completed reply. */
function reply (overrides = {}) {
  return {
    providerId: 'anthropic',
    modelId: 'model-a',
    cloud: true,
    usage: { in: 12, out: 34 },
    finishReason: 'stop',
    parts: [{ type: 'text', text: 'hello' }],
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * Capabilities
 * ------------------------------------------------------------------ */

test('a capability set round-trips with every field the plan names', () => {
  const parsed = api.providerCapabilitiesSchema.parse(capabilities())

  assert.deepEqual(Object.keys(parsed).sort(), [
    'contextWindow',
    'embeddings',
    'jsonMode',
    'maxOutput',
    'streaming',
    'tools',
    'vision',
    'webSearch',
  ])
  assert.equal(parsed.tools, 'native')
})

test('a capability set with an unknown or missing field is refused', () => {
  // Unknown: a provider-specific flag cannot ride along into a shared contract.
  assert.equal(
    api.providerCapabilitiesSchema.safeParse({ ...capabilities(), brand: 'acme' }).success,
    false,
  )

  const missing = capabilities()
  delete missing.streaming
  assert.equal(api.providerCapabilitiesSchema.safeParse(missing).success, false)

  // A tool mode nobody defined would silently become "no tools" further down.
  assert.equal(
    api.providerCapabilitiesSchema.safeParse(capabilities({ tools: 'sometimes' })).success,
    false,
  )
  // A window of zero would refuse every request, so it is not a valid window.
  assert.equal(
    api.providerCapabilitiesSchema.safeParse(capabilities({ contextWindow: 0 })).success,
    false,
  )
})

test('a model carries its own capabilities and says whether it is cloud', () => {
  const parsed = api.modelInfoSchema.parse(model())

  assert.equal(parsed.cloud, true)
  assert.equal(parsed.capabilities.embeddings, false)

  // The Cloud/Local answer is not optional: an unlabelled model cannot be
  // offered to a local-only business.
  const unlabelled = model()
  delete unlabelled.cloud
  assert.equal(api.modelInfoSchema.safeParse(unlabelled).success, false)
  assert.equal(api.modelInfoSchema.safeParse(model({ providerId: '' })).success, false)
})

/* ------------------------------------------------------------------ *
 * Message parts
 * ------------------------------------------------------------------ */

test('text, tool call and tool result parts round-trip', () => {
  assert.deepEqual(api.textPartSchema.parse({ type: 'text', text: 'hi' }), {
    type: 'text',
    text: 'hi',
  })

  // Tool arguments stay as the model wrote them: validating them is the caller's
  // job, against the tool's own schema.
  const call = api.toolCallPartSchema.parse({
    type: 'tool_call',
    id: 'call-1',
    name: 'search_tasks',
    arguments: { query: 'invoices', limit: 5 },
  })
  assert.deepEqual(call.arguments, { query: 'invoices', limit: 5 })

  const result = api.toolResultPartSchema.parse({
    type: 'tool_result',
    toolCallId: 'call-1',
    content: '{"tasks":[]}',
    isError: false,
  })
  assert.equal(result.toolCallId, 'call-1')
})

test('an image part carries bytes and refuses a URL', () => {
  const image = api.imagePartSchema.parse({
    type: 'image',
    mediaType: 'image/png',
    data: 'iVBORw0KGgo=',
  })
  assert.equal(image.mediaType, 'image/png')

  // The refusal that matters: a URL would turn the payload into a fetch
  // instruction for a host the model named.
  assert.equal(
    api.imagePartSchema.safeParse({
      type: 'image',
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
      url: 'https://example.test/pixel.png',
    }).success,
    false,
  )

  // A media type outside the closed list is refused rather than relabelled.
  assert.equal(
    api.imagePartSchema.safeParse({ type: 'image', mediaType: 'image/tiff', data: 'AAAA' }).success,
    false,
  )
  // Empty bytes are not an image.
  assert.equal(
    api.imagePartSchema.safeParse({ type: 'image', mediaType: 'image/png', data: '' }).success,
    false,
  )
})

test('a part of an unknown type is refused', () => {
  assert.equal(api.messagePartSchema.safeParse({ type: 'audio', data: 'AAAA' }).success, false)
})

/* ------------------------------------------------------------------ *
 * Messages and requests
 * ------------------------------------------------------------------ */

test('a message needs a known role and at least one part', () => {
  assert.equal(
    api.chatMessageSchema.safeParse({ role: 'user', parts: [{ type: 'text', text: 'hi' }] }).success,
    true,
  )
  assert.equal(api.chatMessageSchema.safeParse({ role: 'user', parts: [] }).success, false)
  assert.equal(api.chatMessageSchema.safeParse({ role: 'narrator', parts: [{ type: 'text', text: 'hi' }] }).success, false)
})

test('a chat request accepts tools and limits, and refuses anything else', () => {
  const request = {
    modelId: 'model-a',
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'plan my week' }] }],
    tools: [
      {
        name: 'list_tasks',
        description: 'List the tasks in a workspace.',
        parameters: { type: 'object', properties: { workspaceId: { type: 'number' } } },
      },
    ],
    maxOutputTokens: 1024,
    temperature: 0.2,
    stop: ['\n\n'],
  }

  const parsed = api.chatRequestSchema.parse(request)
  assert.equal(parsed.tools.length, 1)
  // JSON Schema is forwarded verbatim, including keywords this app does not model.
  assert.deepEqual(parsed.tools[0].parameters.properties, { workspaceId: { type: 'number' } })

  // No messages is not a request.
  assert.equal(api.chatRequestSchema.safeParse({ messages: [] }).success, false)
  // An unknown key would be a provider field wearing a request's clothes.
  assert.equal(api.chatRequestSchema.safeParse({ ...request, apiKey: 'sk-live' }).success, false)
  // A temperature outside the range providers document would be refused by them.
  assert.equal(api.chatRequestSchema.safeParse({ ...request, temperature: 9 }).success, false)
  // A zero output limit would ask for nothing.
  assert.equal(api.chatRequestSchema.safeParse({ ...request, maxOutputTokens: 0 }).success, false)
})

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

test('a reply carries provider, model, cloud flag, usage and finish reason', () => {
  const parsed = api.chatResultSchema.parse(reply())

  assert.equal(parsed.providerId, 'anthropic')
  assert.equal(parsed.modelId, 'model-a')
  assert.equal(parsed.cloud, true)
  assert.deepEqual(parsed.usage, { in: 12, out: 34 })
  assert.equal(parsed.finishReason, 'stop')

  // Each of those is load-bearing, so each is required.
  for (const missing of ['providerId', 'modelId', 'cloud', 'usage', 'finishReason']) {
    const without = reply()
    delete without[missing]
    assert.equal(api.chatResultSchema.safeParse(without).success, false, missing)
  }
})

test('usage must be whole and non-negative, and a finish reason must be known', () => {
  assert.equal(api.chatResultSchema.safeParse(reply({ usage: { in: -1, out: 0 } })).success, false)
  assert.equal(api.chatResultSchema.safeParse(reply({ usage: { in: 1.5, out: 0 } })).success, false)
  assert.equal(api.chatResultSchema.safeParse(reply({ finishReason: 'done' })).success, false)
})

test('an assistant reply cannot pretend to be a tool result', () => {
  // A tool result in an assistant reply would be the model answering itself on
  // the app's behalf, so the reply schema cannot express one.
  assert.equal(
    api.chatResultSchema.safeParse(
      reply({ parts: [{ type: 'tool_result', toolCallId: 'call-1', content: 'ok' }] }),
    ).success,
    false,
  )
})

test('a streamed delta is text, a tool call, or the final result', () => {
  assert.equal(api.chatDeltaSchema.safeParse({ type: 'text', text: 'hel' }).success, true)
  assert.equal(
    api.chatDeltaSchema.safeParse({
      type: 'tool_call',
      index: 0,
      id: 'call-1',
      name: 'list_tasks',
      argumentsJson: '{"workspaceId":1}',
    }).success,
    true,
  )
  assert.equal(api.chatDeltaSchema.safeParse({ type: 'done', result: reply() }).success, true)

  // The final delta is the only place attribution arrives, so it must be whole.
  assert.equal(
    api.chatDeltaSchema.safeParse({ type: 'done', result: { modelId: 'model-a' } }).success,
    false,
  )
  assert.equal(api.chatDeltaSchema.safeParse({ type: 'thinking', text: 'hmm' }).success, false)
})

test('an embedding result is one finite vector per input', () => {
  const result = {
    providerId: 'ollama',
    modelId: 'nomic-embed-text',
    cloud: false,
    usage: { in: 4, out: 0 },
    vectors: [
      [0.1, 0.2],
      [0.3, 0.4],
    ],
  }

  assert.equal(api.embedResultSchema.safeParse(result).success, true)
  // A vector that is not a number would poison every similarity it is used in.
  assert.equal(api.embedResultSchema.safeParse({ ...result, vectors: [[0.1, Number.NaN]] }).success, false)
  assert.equal(api.embedResultSchema.safeParse({ ...result, vectors: [[]] }).success, false)
})

test('a connection test answers success or a known failure token, never both', () => {
  assert.equal(api.testResultSchema.safeParse({ ok: true, modelCount: 3 }).success, true)
  assert.equal(api.testResultSchema.safeParse({ ok: false, failure: 'provider_unauthorized' }).success, true)

  // A success with no model count tells the screen nothing to show.
  assert.equal(api.testResultSchema.safeParse({ ok: true }).success, false)
  // An invented failure would be drawn as an empty message.
  assert.equal(api.testResultSchema.safeParse({ ok: false, failure: 'it broke' }).success, false)
  // Both at once is a contradiction, and strictness refuses it.
  assert.equal(
    api.testResultSchema.safeParse({ ok: true, modelCount: 1, failure: 'network' }).success,
    false,
  )
})

/* ------------------------------------------------------------------ *
 * The call context
 * ------------------------------------------------------------------ */

test('a call context is built frozen, keeps its signal, and allows no business yet', () => {
  const controller = new AbortController()
  const ctx = api.createCallContext(
    { businessId: null, providerId: 'ollama', userId: 7, purpose: 'connection_test' },
    controller.signal,
  )

  assert.equal(ctx.businessId, null)
  assert.equal(ctx.signal, controller.signal)
  // Frozen so an adapter cannot widen its own permissions by editing the context
  // the guard will read.
  assert.equal(Object.isFrozen(ctx), true)
})

test('a call context refuses an unknown purpose, a missing provider and extra keys', () => {
  const good = { businessId: 4, providerId: 'anthropic', userId: 7, purpose: 'chat_strategy' }

  assert.equal(api.createCallContext(good).purpose, 'chat_strategy')

  // The purpose indexes the audit log and the guard's policy, so it cannot be free text.
  assert.throws(() => api.createCallContext({ ...good, purpose: 'whatever' }))
  assert.throws(() => api.createCallContext({ ...good, providerId: '' }))
  assert.throws(() => api.createCallContext({ ...good, userId: 0 }))
  assert.throws(() => api.createCallContext({ ...good, businessId: -1 }))
  assert.throws(() => api.createCallContext({ ...good, localOnly: true }))
})

/* ------------------------------------------------------------------ *
 * Safe failures
 * ------------------------------------------------------------------ */

test('a provider error is built from a token and never from a message', () => {
  const error = new api.ProviderError('provider_unauthorized')

  assert.equal(error.failure, 'provider_unauthorized')
  // The text is the table's sentence, so no server body can reach a screen.
  assert.equal(error.message, api.PROVIDER_FAILURE_MESSAGES.provider_unauthorized)
  assert.equal(error.name, 'ProviderError')
  assert.equal(error.retryable, false)

  // Worth retrying or not is part of the contract: a rejected key never is.
  assert.equal(new api.ProviderError('network').retryable, true)
  assert.equal(new api.ProviderError('schema_mismatch').retryable, false)
})

test('a raw failure is reduced to a token, and an abort beats a network error', () => {
  assert.equal(api.toProviderFailure({ status: 401 }), 'provider_unauthorized')
  assert.equal(api.toProviderFailure({ status: 404 }), 'model_not_found')
  assert.equal(api.toProviderFailure({ status: 429 }), 'provider_rate_limited')
  assert.equal(api.toProviderFailure({ status: 503 }), 'provider_unavailable')
  assert.equal(api.toProviderFailure({ status: 400 }), 'provider_rejected')
  assert.equal(api.toProviderFailure({ status: 413 }), 'context_too_long')
  assert.equal(api.toProviderFailure({ code: 'ECONNREFUSED' }), 'network')
  assert.equal(api.toProviderFailure({ name: 'AbortError' }), 'aborted')
  assert.equal(api.toProviderFailure({ code: 'ABORT_ERR' }), 'aborted')
  assert.equal(api.toProviderFailure('not even an error'), 'internal_error')

  // Cancelling also reports as a network error; telling the person to check their
  // connection after they pressed Cancel would be a lie.
  assert.equal(api.toProviderFailure({ name: 'AbortError', code: 'network_error' }), 'aborted')

  // Its own failure passes straight through rather than being re-derived.
  const already = new api.ProviderError('timeout')
  assert.equal(api.toProviderFailure(already), 'timeout')
})

test('every failure token has a sentence that names no host, key or body', () => {
  for (const failure of api.PROVIDER_FAILURES) {
    const sentence = api.PROVIDER_FAILURE_MESSAGES[failure]
    assert.ok(typeof sentence === 'string' && sentence.length > 0, failure)
    assert.equal(/https?:\/\//.test(sentence), false, failure)
    assert.equal(sentence.includes('sk-'), false, failure)
    assert.equal(sentence.includes(failure), false, failure)
  }
})
