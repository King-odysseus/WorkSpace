'use strict'

/*
 * The Anthropic adapter against the shared contract, plus the things the
 * contract cannot see from the outside: the exact wire body, the header that
 * carries the key, and the promise that no provider text reaches a failure.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

const MODEL = 'claude-sonnet-4-5'

const CHAT = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  content: [{ type: 'text', text: 'Hello!' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 11, output_tokens: 4 },
}

const MODELS = {
  data: [
    { id: MODEL, display_name: 'Claude Sonnet 4.5', type: 'model' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', type: 'model' },
  ],
  has_more: false,
}

const STREAM = [
  'event: message_start',
  `data: {"type":"message_start","message":{"id":"msg_1","model":"${MODEL}","usage":{"input_tokens":12,"output_tokens":0}}}`,
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"!"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"lookup","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"x\\"}"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":1}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":7}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n')

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

/** A transport that records what the adapter asked for. */
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

function makeProvider (fetchImpl, overrides = {}) {
  const transport = contractTransport(fetchImpl)
  const provider = api.createAnthropicProvider(
    {
      preset: api.findPreset('anthropic'),
      credential: 'test-key',
      defaultModel: MODEL,
      ...overrides,
    },
    { transport },
  )
  return { provider, transport }
}

function ctxFor (provider, signal) {
  return api.createCallContext(
    { businessId: 1, providerId: provider.id, userId: 1, purpose: 'chat_strategy' },
    signal,
  )
}

function chatRequest (overrides = {}) {
  return {
    modelId: MODEL,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say hello.' }] }],
    ...overrides,
  }
}

async function drain (iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

function subject () {
  return {
    name: 'anthropic',
    capabilities: api.resolveCapabilities(api.findPreset('anthropic'), MODEL),
    create: (fetchImpl) => makeProvider(fetchImpl).provider,
    chatRequest: chatRequest(),
    fixtures: { models: MODELS, chat: CHAT, stream: STREAM },
  }
}

for (const contractCase of api.providerContractCases(subject())) {
  test(`contract: ${contractCase.name}`, async () => {
    await contractCase.run()
  })
}

test('chat sends the Messages wire shape, with the key in x-api-key', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))

  const result = await provider.chat(
    chatRequest({
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'Be brief.' }] },
        { role: 'user', parts: [{ type: 'text', text: 'Say hello.' }] },
      ],
    }),
    ctxFor(provider),
  )

  assert.equal(transport.calls.length, 1)
  const call = transport.calls[0]
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.headers['x-api-key'], 'test-key')
  assert.ok(call.init.headers['anthropic-version'])
  assert.equal(call.init.body.model, MODEL)
  assert.ok(call.init.body.max_tokens > 0)
  assert.equal(call.init.body.system, 'Be brief.')
  assert.equal(call.init.body.messages[0].role, 'user')
  assert.deepEqual(call.init.body.messages[0].content, [{ type: 'text', text: 'Say hello.' }])
  assert.equal(result.providerId, 'anthropic')
  assert.equal(result.parts[0].text, 'Hello!')
  assert.deepEqual(result.usage, { in: 11, out: 4 })
})

test('native tools send the definition as input_schema', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))
  const tool = {
    name: 'lookup',
    description: 'Find a record.',
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  }

  await provider.chat(chatRequest({ tools: [tool] }), ctxFor(provider))

  assert.deepEqual(transport.calls[0].init.body.tools, [
    { name: 'lookup', description: 'Find a record.', input_schema: tool.parameters },
  ])
})

test('a tool_use reply becomes one tool_call part with parsed arguments', async () => {
  const reply = {
    ...CHAT,
    content: [{ type: 'tool_use', id: 'toolu_9', name: 'lookup', input: { q: 'x' } }],
    stop_reason: 'tool_use',
  }
  const { provider } = makeProvider(async () => response(200, reply))

  const result = await provider.chat(chatRequest(), ctxFor(provider))

  assert.deepEqual(result.parts, [
    { type: 'tool_call', id: 'toolu_9', name: 'lookup', arguments: { q: 'x' } },
  ])
  assert.equal(result.finishReason, 'tool_call')
})

test('a streamed reply yields text deltas, a tool call and one done', async () => {
  const { provider } = makeProvider(async () => response(200, STREAM))

  const deltas = await drain(provider.stream(chatRequest(), ctxFor(provider)))

  assert.deepEqual(
    deltas.filter((delta) => delta.type === 'text').map((delta) => delta.text),
    ['Hello', '!'],
  )
  const call = deltas.find((delta) => delta.type === 'tool_call')
  assert.equal(call.name, 'lookup')
  assert.equal(call.argumentsJson, '{"q":"x"}')
  const done = deltas[deltas.length - 1]
  assert.equal(done.type, 'done')
  assert.equal(done.result.finishReason, 'tool_call')
  assert.deepEqual(done.result.usage, { in: 12, out: 7 })
})

test('embed refuses without a request, because Anthropic has no embeddings', async () => {
  const { provider, transport } = makeProvider(async () => response(200, MODELS))

  await assert.rejects(
    () => provider.embed({ modelId: 'text-embedding-3-small', inputs: ['hello'] }, ctxFor(provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'unsupported',
  )
  assert.equal(transport.calls.length, 0)
})

test('jsonMode is refused before the request', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))

  await assert.rejects(
    () => provider.chat(chatRequest({ jsonMode: true }), ctxFor(provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'unsupported',
  )
  assert.equal(transport.calls.length, 0)
})

test('an image part becomes a base64 image block', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))

  await provider.chat(
    {
      modelId: MODEL,
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', mediaType: 'image/png', data: 'AAAA' },
          ],
        },
      ],
    },
    ctxFor(provider),
  )

  assert.deepEqual(transport.calls[0].init.body.messages[0].content, [
    { type: 'text', text: 'What is this?' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
  ])
})

test('a cancelled call never reaches the transport', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))
  const ctx = ctxFor(provider, AbortSignal.abort())

  await assert.rejects(
    () => provider.chat(chatRequest(), ctx),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  await assert.rejects(
    () => provider.listModels(ctx),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  await assert.rejects(
    () => drain(provider.stream(chatRequest(), ctx)),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  assert.equal(transport.calls.length, 0)
})

test('an abort during the transport maps to aborted', async () => {
  const abort = new DOMException('The operation was aborted.', 'AbortError')
  const { provider } = makeProvider(async () => {
    throw abort
  })

  await assert.rejects(
    () => provider.chat(chatRequest(), ctxFor(provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  // A stream begins lazily, so the same failure has to surface there too.
  await assert.rejects(
    () => drain(provider.stream(chatRequest(), ctxFor(provider))),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
})

test('a provider body never escapes through the failure', async () => {
  const body = JSON.stringify({
    error: {
      message: `bad key sk-live-secret at https://provider.example/v1/messages ${api.CONTRACT_CANARY}`,
    },
  })
  const { provider } = makeProvider(async () => response(500, body))

  const error = await provider.chat(chatRequest(), ctxFor(provider)).then(
    () => null,
    (caught) => caught,
  )

  assert.ok(error instanceof api.ProviderError)
  assert.equal(error.failure, 'provider_unavailable')
  const text = `${String(error)} ${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`
  for (const marker of ['canary-7f31d0', 'sk-live-secret', 'provider.example', 'api.anthropic.com']) {
    assert.equal(text.includes(marker), false, `failure leaked ${marker}`)
  }
  assert.equal(error.cause, undefined)
})

test('a body that is not the expected shape is malformed_response', async () => {
  const notJson = makeProvider(async () => response(200, 'not json'))
  await assert.rejects(
    () => notJson.provider.chat(chatRequest(), ctxFor(notJson.provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )

  const emptyContent = makeProvider(async () => response(200, { content: [] }))
  await assert.rejects(
    () => emptyContent.provider.chat(chatRequest(), ctxFor(emptyContent.provider)),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )
})

test('countTokens stays local and testConnection reports a rejection', async () => {
  const { provider, transport } = makeProvider(async () => response(200, MODELS))

  assert.ok((await provider.countTokens(chatRequest())) > 0)
  assert.equal(transport.calls.length, 0)

  const rejected = makeProvider(async () => response(401, { error: { type: 'authentication_error' } }))
  const result = await rejected.provider.testConnection(ctxFor(rejected.provider))
  assert.deepEqual(result, { ok: false, failure: 'provider_unauthorized' })

  const healthy = makeProvider(async () => response(200, MODELS))
  const connected = await healthy.provider.testConnection(ctxFor(healthy.provider))
  assert.deepEqual(connected, { ok: true, modelCount: 2 })
})

test('the adapter has no network door of its own', () => {
  const source = fs
    .readFileSync(path.join(__dirname, 'anthropic.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  assert.equal(/\bfetch\s*\(/.test(source), false, 'adapter calls fetch directly')
  assert.equal(/\brequire\s*\(/.test(source), false, 'adapter requires a network module')
  assert.equal(/node:https?/.test(source), false, 'adapter imports an http module')
  assert.equal(/console\./.test(source), false, 'adapter logs')
})
