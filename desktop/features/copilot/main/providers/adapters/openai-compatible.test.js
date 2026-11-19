'use strict'

/*
 * One adapter, seven configurations, one shared contract.
 *
 * The suite runs against every preset because the differences between the
 * services are data. A broken base URL, a key header that is applied twice, or a
 * capability default that is wrong for one service would otherwise only show up
 * when a person configured that service.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

const CHAT = {
  id: 'chatcmpl_1',
  object: 'chat.completion',
  model: 'gpt-4.1',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Hello!' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 4 },
}

const MODELS = {
  object: 'list',
  data: [
    { id: 'gpt-4.1', object: 'model' },
    { id: 'text-embedding-3-small', object: 'model' },
  ],
}

const STREAM = [
  'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"Hel"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"lo!"},"finish_reason":null}]}',
  '',
  'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  '',
  'data: {"id":"chatcmpl_1","object":"chat.completion.chunk","model":"gpt-4.1","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":4}}',
  '',
  'data: [DONE]',
  '',
].join('\n')

const EMBED = {
  object: 'list',
  data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
  usage: { prompt_tokens: 2 },
}

/** The seven services this adapter is configured for, and how to reach them. */
const PRESETS = [
  { id: 'openai', credential: 'test-key' },
  { id: 'deepseek', credential: 'test-key' },
  { id: 'kimi', credential: 'test-key' },
  { id: 'together', credential: 'test-key' },
  { id: 'openrouter', credential: 'test-key' },
  {
    id: 'lmstudio',
    credential: null,
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
  },
  { id: 'custom', credential: null, baseUrl: 'https://models.example.test/v1', defaultModel: 'local-model' },
]

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

function contractTransport (fetchImpl) {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      return fetchImpl(url, {
        signal: ctx.signal,
        method: init.method,
        headers: init.headers,
        body: init.body,
      })
    },
  }
}

function makeProvider (presetId, fetchImpl, overrides = {}) {
  const preset = api.findPreset(presetId)
  const transport = contractTransport(fetchImpl)
  const provider = api.createOpenAiCompatibleProvider(
    {
      preset,
      credential: overrides.credential === undefined ? 'test-key' : overrides.credential,
      baseUrl: overrides.baseUrl,
      defaultModel: overrides.defaultModel ?? preset.defaultModel,
    },
    { transport },
  )
  return { provider, transport, preset }
}

function ctxFor (provider, signal) {
  return api.createCallContext(
    { businessId: 1, providerId: provider.id, userId: 1, purpose: 'chat_strategy' },
    signal,
  )
}

function chatRequest (modelId, overrides = {}) {
  return {
    modelId,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say hello.' }] }],
    ...overrides,
  }
}

async function drain (iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

function contractSubject (entry) {
  const preset = api.findPreset(entry.id)
  const defaultModel = entry.defaultModel ?? preset.defaultModel
  return {
    name: `openai-compatible:${entry.id}`,
    capabilities: api.resolveCapabilities(preset, defaultModel),
    create: (fetchImpl) => makeProvider(entry.id, fetchImpl, entry).provider,
    chatRequest: chatRequest(defaultModel),
    fixtures: { models: MODELS, chat: CHAT, stream: STREAM },
  }
}

for (const entry of PRESETS) {
  for (const contractCase of api.providerContractCases(contractSubject(entry))) {
    test(`contract ${entry.id}: ${contractCase.name}`, async () => {
      await contractCase.run()
    })
  }
}

/* ------------------------------------------------------------------ *
 * Embeddings are a capability, not a preset
 * ------------------------------------------------------------------ */

const EMBEDDING_MODEL = 'BAAI/bge-large-en-v1.5'

const EMBEDDING_SUBJECT = {
  name: 'openai-compatible:together (embeddings)',
  capabilities: api.resolveCapabilities(api.findPreset('together'), EMBEDDING_MODEL),
  create: (fetchImpl) =>
    makeProvider('together', fetchImpl, { defaultModel: EMBEDDING_MODEL }).provider,
  chatRequest: chatRequest(EMBEDDING_MODEL),
  fixtures: { models: MODELS, chat: CHAT, embed: EMBED },
}

for (const contractCase of api.providerContractCases(EMBEDDING_SUBJECT)) {
  test(`contract together embeddings: ${contractCase.name}`, async () => {
    await contractCase.run()
  })
}

/* ------------------------------------------------------------------ *
 * The wire differences are configuration
 * ------------------------------------------------------------------ */

test('each preset dials its own path and attaches its own auth style', async () => {
  const expectations = [
    {
      id: 'openai',
      url: 'https://api.openai.com/v1/chat/completions',
      authorization: 'Bearer test-key',
      tokenField: 'max_completion_tokens',
    },
    {
      id: 'deepseek',
      url: 'https://api.deepseek.com/v1/chat/completions',
      authorization: 'Bearer test-key',
      tokenField: 'max_tokens',
    },
    {
      id: 'lmstudio',
      url: 'http://127.0.0.1:1234/v1/chat/completions',
      authorization: null,
      tokenField: 'max_tokens',
    },
  ]

  for (const expected of expectations) {
    const { provider, transport } = makeProvider(expected.id, async () => response(200, CHAT), {
      credential: expected.id === 'lmstudio' ? null : 'test-key',
      baseUrl: expected.id === 'lmstudio' ? 'http://127.0.0.1:1234/v1' : undefined,
      defaultModel: expected.id === 'lmstudio' ? 'local-model' : undefined,
    })

    await provider.chat(chatRequest('local-model'), ctxFor(provider))

    const call = transport.calls[0]
    assert.equal(call.url, expected.url, `${expected.id} dialled the wrong URL`)
    assert.equal(call.init.headers.authorization ?? call.init.headers.Authorization ?? null, expected.authorization)
    assert.ok(call.init.body[expected.tokenField] > 0, `${expected.id} used the wrong token field`)
    assert.equal(call.init.body[expected.tokenField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'], undefined)
  }
})

test('every network method goes through the transport, with the provider id', async () => {
  const preset = api.findPreset('together')
  const chatModel = preset.defaultModel
  const { provider, transport } = makeProvider('together', async (url, init) => {
    if (url.endsWith('/models')) return response(200, MODELS)
    if (url.endsWith('/embeddings')) return response(200, EMBED)
    if (init.body !== null && init.body !== undefined && init.body.stream === true) {
      return response(200, STREAM)
    }
    return response(200, CHAT)
  })

  await provider.listModels(ctxFor(provider))
  await provider.chat(chatRequest(chatModel), ctxFor(provider))
  await drain(provider.stream(chatRequest(chatModel), ctxFor(provider)))
  await provider.embed({ modelId: EMBEDDING_MODEL, inputs: ['hello'] }, ctxFor(provider))
  await provider.testConnection(ctxFor(provider))

  assert.equal(transport.calls.length, 5)
  for (const call of transport.calls) {
    assert.equal(call.ctx.providerId, provider.id)
  }
})

test('a cancelled call of any kind makes no request', async () => {
  const chatModel = api.findPreset('together').defaultModel
  const { provider, transport } = makeProvider('together', async () => response(200, CHAT))
  const ctx = ctxFor(provider, AbortSignal.abort())

  await assert.rejects(() => provider.listModels(ctx))
  await assert.rejects(() => provider.chat(chatRequest(chatModel), ctx))
  await assert.rejects(() => drain(provider.stream(chatRequest(chatModel), ctx)))
  await assert.rejects(() => provider.embed({ modelId: EMBEDDING_MODEL, inputs: ['hi'] }, ctx))

  const connection = await provider.testConnection(ctx)
  assert.deepEqual(connection, { ok: false, failure: 'aborted' })
  assert.equal(transport.calls.length, 0)
})

test('refusals happen before any request', async () => {
  const cases = [
    {
      id: 'openai',
      run: (provider, ctx) => provider.embed({ modelId: 'gpt-4.1', inputs: ['hi'] }, ctx),
    },
    {
      id: 'lmstudio',
      run: (provider, ctx) => provider.chat(chatRequest('local-model', { jsonMode: true }), ctx),
      overrides: { credential: null, baseUrl: 'http://127.0.0.1:1234/v1', defaultModel: 'local-model' },
    },
    {
      id: 'deepseek',
      run: (provider, ctx) =>
        provider.chat(
          chatRequest('deepseek-chat', {
            messages: [
              { role: 'user', parts: [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
            ],
          }),
          ctx,
        ),
    },
    {
      id: 'deepseek',
      run: (provider, ctx) =>
        provider.chat(
          chatRequest('deepseek-reasoner', {
            tools: [{ name: 'lookup', description: 'x', parameters: { type: 'object' } }],
          }),
          ctx,
        ),
    },
  ]

  for (const entry of cases) {
    const { provider, transport } = makeProvider(
      entry.id,
      async () => response(200, CHAT),
      entry.overrides ?? {},
    )
    await assert.rejects(
      () => entry.run(provider, ctxFor(provider)),
      (error) => error instanceof api.ProviderError && error.failure === 'unsupported',
    )
    assert.equal(transport.calls.length, 0)
  }
})

/* ------------------------------------------------------------------ *
 * Capabilities come from the preset and from the probe
 * ------------------------------------------------------------------ */

test('OpenRouter model metadata becomes model capabilities', async () => {
  const payload = {
    data: [
      {
        id: 'vendor/model-x',
        context_length: 64000,
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['tools', 'response_format'],
        top_provider: { max_completion_tokens: 4096 },
      },
    ],
  }
  const { provider } = makeProvider('openrouter', async () => response(200, payload))

  const models = await provider.listModels(ctxFor(provider))

  assert.deepEqual(models[0].capabilities, {
    contextWindow: 64000,
    maxOutput: 4096,
    tools: 'native',
    vision: true,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  })
})

test('LM Studio model types become capability differences', async () => {
  const payload = {
    data: [
      { id: 'nomic-embed', type: 'embeddings' },
      { id: 'qwen2.5-7b-instruct', type: 'llm' },
    ],
  }
  const { provider } = makeProvider('lmstudio', async () => response(200, payload), {
    credential: null,
    defaultModel: 'local-model',
  })

  const models = await provider.listModels(ctxFor(provider))

  assert.equal(models[0].capabilities.embeddings, true)
  assert.equal(models[0].capabilities.streaming, false)
  assert.equal(models[0].capabilities.tools, 'none')
  assert.equal(models[1].capabilities.embeddings, false)
  assert.equal(models[1].capabilities.streaming, true)
})

test('an unknown model still gets the preset defaults', async () => {
  const payload = { data: [{ id: 'brand-new-model' }] }
  const { provider } = makeProvider('deepseek', async () => response(200, payload))

  const models = await provider.listModels(ctxFor(provider))

  assert.equal(models[0].capabilities.contextWindow, 64000)
  assert.equal(models[0].capabilities.vision, false)
})

/* ------------------------------------------------------------------ *
 * Errors and redaction
 * ------------------------------------------------------------------ */

test('provider bodies never escape through a failure', async () => {
  const body = JSON.stringify({
    error: {
      message: `bad key sk-live-secret at https://provider.example/v1/chat/completions ${api.CONTRACT_CANARY}`,
    },
  })
  const { provider } = makeProvider('openai', async () => response(500, body))

  const error = await provider.chat(chatRequest('gpt-4.1'), ctxFor(provider)).then(
    () => null,
    (caught) => caught,
  )

  assert.ok(error instanceof api.ProviderError)
  assert.equal(error.failure, 'provider_unavailable')
  const text = `${String(error)} ${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`
  for (const marker of ['canary-7f31d0', 'sk-live-secret', 'provider.example', 'api.openai.com']) {
    assert.equal(text.includes(marker), false, `failure leaked ${marker}`)
  }
  assert.equal(error.cause, undefined)
})

test('a rejected status becomes the token the person can act on', async () => {
  const cases = [
    { status: 400, body: 'maximum context length exceeded', failure: 'context_too_long' },
    { status: 400, body: 'model not found: gpt-9', failure: 'model_not_found' },
    { status: 401, body: 'invalid api key', failure: 'provider_unauthorized' },
    { status: 429, body: 'slow down', failure: 'provider_rate_limited' },
  ]

  for (const entry of cases) {
    const { provider } = makeProvider('openai', async () => response(entry.status, entry.body))
    await assert.rejects(
      () => provider.chat(chatRequest('gpt-4.1'), ctxFor(provider)),
      (error) => error instanceof api.ProviderError && error.failure === entry.failure,
    )
  }
})

test('a body that is not the expected shape is malformed_response', async () => {
  const notJson = makeProvider('openai', async () => response(200, 'not json'))
  await assert.rejects(
    () => notJson.provider.chat(chatRequest('gpt-4.1'), ctxFor(notJson.provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )

  const badArguments = {
    ...CHAT,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{oops' } }],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
  const broken = makeProvider('openai', async () => response(200, badArguments))
  await assert.rejects(
    () => broken.provider.chat(chatRequest('gpt-4.1'), ctxFor(broken.provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )

  const shortEmbedding = makeProvider('together', async () => response(200, EMBED), {
    defaultModel: EMBEDDING_MODEL,
  })
  await assert.rejects(
    () =>
      shortEmbedding.provider.embed(
        { modelId: EMBEDDING_MODEL, inputs: ['one', 'two'] },
        ctxFor(shortEmbedding.provider),
      ),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )
})

/* ------------------------------------------------------------------ *
 * Tools, native and prompted
 * ------------------------------------------------------------------ */

test('native tools are sent and parsed', async () => {
  const reply = {
    ...CHAT,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
  const tool = {
    name: 'lookup',
    description: 'Find a record.',
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  }
  const { provider, transport } = makeProvider('openai', async () => response(200, reply))

  const result = await provider.chat(chatRequest('gpt-4.1', { tools: [tool] }), ctxFor(provider))

  assert.deepEqual(transport.calls[0].init.body.tools, [
    { type: 'function', function: { name: 'lookup', description: 'Find a record.', parameters: tool.parameters } },
  ])
  assert.equal(transport.calls[0].init.body.tool_choice, 'auto')
  assert.deepEqual(result.parts, [
    { type: 'tool_call', id: 'call_1', name: 'lookup', arguments: { q: 'x' } },
  ])
  assert.equal(result.finishReason, 'tool_call')
})

test('a model without native tools is asked for one JSON object instead', async () => {
  const tool = {
    name: 'lookup',
    description: 'Find a record.',
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
  }
  const callReply = {
    ...CHAT,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '{"tool":"lookup","arguments":{"q":"x"}}' },
        finish_reason: 'stop',
      },
    ],
  }

  const prompting = makeProvider('lmstudio', async () => response(200, callReply), {
    credential: null,
    defaultModel: 'local-model',
  })
  const result = await prompting.provider.chat(
    chatRequest('local-model', { tools: [tool] }),
    ctxFor(prompting.provider),
  )

  const body = prompting.transport.calls[0].init.body
  const instruction = body.messages.find((message) => message.role === 'system')
  assert.ok(instruction.content.includes('lookup'), 'the tool was not named in the prompt')
  assert.equal(body.tools, undefined, 'the native tool protocol must not be sent')
  assert.deepEqual(result.parts, [
    { type: 'tool_call', id: 'prompted_1', name: 'lookup', arguments: { q: 'x' } },
  ])
  assert.equal(result.finishReason, 'tool_call')

  const answerReply = {
    ...CHAT,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '{"answer":"Hi"}' },
        finish_reason: 'stop',
      },
    ],
  }
  const answering = makeProvider('lmstudio', async () => response(200, answerReply), {
    credential: null,
    defaultModel: 'local-model',
  })
  const answered = await answering.provider.chat(
    chatRequest('local-model', { tools: [tool] }),
    ctxFor(answering.provider),
  )
  assert.deepEqual(answered.parts, [{ type: 'text', text: 'Hi' }])

  const refusing = makeProvider(
    'lmstudio',
    async () =>
      response(200, {
        ...CHAT,
        choices: [
          { index: 0, message: { role: 'assistant', content: 'not json' }, finish_reason: 'stop' },
        ],
      }),
    { credential: null, defaultModel: 'local-model' },
  )
  await assert.rejects(
    () => refusing.provider.chat(chatRequest('local-model', { tools: [tool] }), ctxFor(refusing.provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'schema_mismatch',
  )
})

test('a prompted stream hides the wire JSON and yields the answer once', async () => {
  const reply = [
    'data: {"choices":[{"index":0,"delta":{"content":"{\\"answer\\":\\"Hi\\"}"},"finish_reason":null}]}',
    '',
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  const { provider } = makeProvider('lmstudio', async () => response(200, reply), {
    credential: null,
    defaultModel: 'local-model',
  })

  const deltas = await drain(
    provider.stream(
      chatRequest('local-model', {
        tools: [{ name: 'lookup', description: 'x', parameters: { type: 'object' } }],
      }),
      ctxFor(provider),
    ),
  )

  assert.deepEqual(
    deltas.filter((delta) => delta.type === 'text').map((delta) => delta.text),
    ['Hi'],
  )
  const done = deltas[deltas.length - 1]
  assert.equal(done.result.finishReason, 'stop')
})

/* ------------------------------------------------------------------ *
 * Streaming, cancellation and the local methods
 * ------------------------------------------------------------------ */

test('a streamed reply assembles into a done result with usage', async () => {
  const { provider } = makeProvider('openai', async () => response(200, STREAM))

  const deltas = await drain(provider.stream(chatRequest('gpt-4.1'), ctxFor(provider)))

  assert.deepEqual(
    deltas.filter((delta) => delta.type === 'text').map((delta) => delta.text),
    ['Hel', 'lo!'],
  )
  const done = deltas[deltas.length - 1]
  assert.equal(done.type, 'done')
  assert.equal(done.result.parts[0].text, 'Hello!')
  assert.deepEqual(done.result.usage, { in: 11, out: 4 })
  assert.equal(done.result.finishReason, 'stop')
})

test('an aborted transport maps to aborted', async () => {
  const abort = Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })
  const { provider } = makeProvider('openai', async () => {
    throw abort
  })

  await assert.rejects(
    () => provider.chat(chatRequest('gpt-4.1'), ctxFor(provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  // A stream begins lazily, so the same failure has to surface there too.
  await assert.rejects(
    () => drain(provider.stream(chatRequest('gpt-4.1'), ctxFor(provider))),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
})

test('countTokens is local and testConnection reports a rejection', async () => {
  const { provider, transport } = makeProvider('openai', async () => response(200, MODELS))

  assert.ok((await provider.countTokens(chatRequest('gpt-4.1'))) > 0)
  assert.equal(transport.calls.length, 0)

  const rejected = makeProvider('openai', async () =>
    response(401, { error: { message: 'invalid api key', type: 'invalid_request_error' } }),
  )
  assert.deepEqual(await rejected.provider.testConnection(ctxFor(rejected.provider)), {
    ok: false,
    failure: 'provider_unauthorized',
  })

  const healthy = makeProvider('openai', async () => response(200, MODELS))
  assert.deepEqual(await healthy.provider.testConnection(ctxFor(healthy.provider)), {
    ok: true,
    modelCount: 2,
  })
})

test('the adapter has no network door and no hard-coded service', () => {
  const source = fs
    .readFileSync(path.join(__dirname, 'openai-compatible.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  assert.equal(/\bfetch\s*\(/.test(source), false, 'adapter calls fetch directly')
  assert.equal(/\brequire\s*\(/.test(source), false, 'adapter requires a network module')
  assert.equal(/node:https?/.test(source), false, 'adapter imports an http module')
  assert.equal(/console\./.test(source), false, 'adapter logs')
  for (const host of [
    'api.openai.com',
    'api.deepseek.com',
    'api.moonshot.ai',
    'api.together.xyz',
    'openrouter.ai',
    '127.0.0.1',
  ]) {
    assert.equal(source.includes(host), false, `adapter hard-codes ${host}`)
  }
})
