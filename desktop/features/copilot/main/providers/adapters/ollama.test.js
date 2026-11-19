'use strict'

/*
 * The native adapter for a server on this machine, against the shared contract.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * Most of the file is the shared suite, run twice: once for a chat model and
 * once for an embedding model, because the two have different capabilities and a
 * suite that only ever saw one would never exercise the refusals. The rest is
 * this protocol's own ground, which the compatible adapters do not share:
 *
 * - A stream is newline-delimited JSON. Reading it as server-sent events yields
 *   zero events, which is a successful-looking empty answer, so one test proves
 *   the text of a real stream arrives.
 * - A tool call's arguments are already an object. One test proves they are not
 *   stringified into "[object Object]".
 * - `keep_alive` is the only thing that makes a local model stay resident, so one
 *   test proves it is sent when configured and omitted when not.
 * - Cloud or local is the endpoint's answer. One test points the same preset at a
 *   public host and proves the answer changes, because the provider name did not.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../../build/main/ipc.cjs')

const MODEL = 'qwen2.5:7b'
const EMBED_MODEL = 'nomic-embed-text'
const LOCAL_BASE = 'http://127.0.0.1:11434'

/* `/api/tags`, as a server that has one chat model and one embedding model. */
const TAGS = {
  models: [
    {
      name: MODEL,
      model: MODEL,
      modified_at: '2026-01-02T03:04:05.000Z',
      size: 4_700_000_000,
      digest: 'a1b2c3',
      details: {
        format: 'gguf',
        family: 'qwen2',
        families: ['qwen2'],
        parameter_size: '7.6B',
        quantization_level: 'Q4_K_M',
      },
    },
    {
      name: EMBED_MODEL,
      model: EMBED_MODEL,
      size: 274_000_000,
      digest: 'd4e5f6',
      details: {
        format: 'gguf',
        family: 'nomic-bert',
        families: ['nomic-bert'],
        parameter_size: '137M',
        quantization_level: 'F16',
      },
    },
  ],
}

/* `/api/chat` without streaming. */
const CHAT = {
  model: MODEL,
  created_at: '2026-01-02T03:04:05.000Z',
  message: { role: 'assistant', content: 'Hello!' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 26,
  eval_count: 4,
}

/* The same reply as `/api/chat` sends it with `stream: true`: one object per line. */
const STREAM = [
  `{"model":"${MODEL}","message":{"role":"assistant","content":"Hel"},"done":false}`,
  `{"model":"${MODEL}","message":{"role":"assistant","content":"lo!"},"done":false}`,
  `{"model":"${MODEL}","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":26,"eval_count":4}`,
].join('\n')

/* `/api/embed`, one vector per input. */
const EMBED = { model: EMBED_MODEL, embeddings: [[0.1, 0.2, 0.3]], prompt_eval_count: 5 }

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

/** A transport that records every call and answers through the given function. */
function recordingTransport (fetchImpl) {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      return fetchImpl(url, { signal: ctx.signal, method: init.method, headers: init.headers, body: init.body })
    },
  }
}

function makeProvider (fetchImpl, overrides = {}) {
  const preset = api.findPreset('ollama')
  const transport = recordingTransport(fetchImpl)
  const provider = api.createOllamaProvider(
    {
      preset,
      // A bare local server takes no key, which is the normal case.
      credential: overrides.credential === undefined ? null : overrides.credential,
      baseUrl: overrides.baseUrl,
      defaultModel: overrides.defaultModel ?? MODEL,
      keepAlive: overrides.keepAlive,
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

/* ------------------------------------------------------------------ *
 * The shared contract, for a chat model
 * ------------------------------------------------------------------ */

const CHAT_SUBJECT = {
  name: 'ollama (chat)',
  capabilities: api.resolveCapabilities(api.findPreset('ollama'), MODEL),
  create: (fetchImpl) => makeProvider(fetchImpl).provider,
  chatRequest: chatRequest(MODEL),
  fixtures: { models: TAGS, chat: CHAT, stream: STREAM },
}

for (const contractCase of api.providerContractCases(CHAT_SUBJECT)) {
  test(contractCase.name, async () => {
    await contractCase.run()
  })
}

/* ------------------------------------------------------------------ *
 * The shared contract, for an embedding model
 *
 * A chat model declares no embeddings and an embedding model declares no
 * streaming, so the two subjects together cover both refusals. One subject alone
 * would leave half of the capability contract untested.
 * ------------------------------------------------------------------ */

const EMBED_SUBJECT = {
  name: 'ollama (embeddings)',
  capabilities: api.resolveCapabilities(api.findPreset('ollama'), EMBED_MODEL),
  create: (fetchImpl) =>
    makeProvider(fetchImpl, { defaultModel: EMBED_MODEL }).provider,
  chatRequest: chatRequest(EMBED_MODEL),
  fixtures: { models: TAGS, chat: CHAT, embed: EMBED },
}

for (const contractCase of api.providerContractCases(EMBED_SUBJECT)) {
  test(contractCase.name, async () => {
    await contractCase.run()
  })
}

test('the embedding subject really is the one that declares embeddings', () => {
  // Without this the two suites above could both be testing a chat model, and
  // the embed case would silently never run.
  assert.equal(CHAT_SUBJECT.capabilities.embeddings, false)
  assert.equal(CHAT_SUBJECT.capabilities.streaming, true)
  assert.equal(EMBED_SUBJECT.capabilities.embeddings, true)
  assert.equal(EMBED_SUBJECT.capabilities.streaming, false)
})

/* ------------------------------------------------------------------ *
 * Discovery through /api/tags
 * ------------------------------------------------------------------ */

test('a model list reports every installed model, with its own capabilities', async () => {
  const { provider, transport } = makeProvider(async () => response(200, TAGS))
  const models = await provider.listModels(ctxFor(provider))

  assert.equal(transport.calls[0].url, `${LOCAL_BASE}/api/tags`)
  assert.equal(transport.calls[0].init.method, 'GET')
  assert.deepEqual(models.map((model) => model.id), [MODEL, EMBED_MODEL])

  const [chatModel, embedModel] = models
  assert.equal(chatModel.providerId, 'ollama')
  // The chat model is not an embedding model, and says so rather than leaving it
  // to the caller to assume.
  assert.equal(chatModel.capabilities.embeddings, false)
  assert.equal(chatModel.capabilities.streaming, true)
  // The family the server published decides this, not the model's name.
  assert.equal(embedModel.capabilities.embeddings, true)
  assert.equal(embedModel.capabilities.tools, 'none')
})

test('a model list the server reports capabilities for overrides the family guess', async () => {
  // A newer server publishes the list itself. A chat model in a bert family that
  // declares tool support must be believed over the family rule.
  const declared = {
    models: [
      {
        name: 'custom-chat',
        model: 'custom-chat',
        details: { family: 'nomic-bert' },
        capabilities: ['completion', 'tools', 'vision'],
      },
    ],
  }

  const { provider } = makeProvider(async () => response(200, declared))
  const [model] = await provider.listModels(ctxFor(provider))

  assert.equal(model.capabilities.embeddings, false)
  assert.equal(model.capabilities.tools, 'native')
  assert.equal(model.capabilities.vision, true)
})

test('a server with nothing pulled answers with an empty list rather than failing', async () => {
  const { provider } = makeProvider(async () => response(200, { models: [] }))
  assert.deepEqual(await provider.listModels(ctxFor(provider)), [])
})

test('an install with no model chosen refuses clearly instead of dialling an empty name', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT), { defaultModel: '' })

  await assert.rejects(() => provider.chat(chatRequest(undefined), ctxFor(provider)), (error) => {
    assert.equal(error.failure, 'model_not_found')
    return true
  })
  // Nothing was sent: a request with no model would have failed at the server
  // with a message that names an empty string.
  assert.equal(transport.calls.length, 0)
})

/* ------------------------------------------------------------------ *
 * The wire format this protocol uses
 * ------------------------------------------------------------------ */

test('a streamed reply arrives as text, not as zero server-sent events', async () => {
  const { provider } = makeProvider(async () => response(200, STREAM))
  const deltas = await drain(provider.stream(chatRequest(MODEL), ctxFor(provider)))

  const text = deltas.filter((delta) => delta.type === 'text').map((delta) => delta.text)
  assert.deepEqual(text, ['Hel', 'lo!'])

  const done = deltas[deltas.length - 1]
  assert.equal(done.type, 'done')
  assert.deepEqual(done.result.parts, [{ type: 'text', text: 'Hello!' }])
  assert.deepEqual(done.result.usage, { in: 26, out: 4 })
  assert.equal(done.result.finishReason, 'stop')
  assert.equal(done.result.cloud, false)
})

test('a broken line in a stream is refused rather than silently skipped', async () => {
  const broken = [
    `{"model":"${MODEL}","message":{"role":"assistant","content":"Hel"},"done":false}`,
    'this is not json',
  ].join('\n')

  const { provider } = makeProvider(async () => response(200, broken))
  await assert.rejects(
    () => drain(provider.stream(chatRequest(MODEL), ctxFor(provider))),
    (error) => {
      assert.equal(error.failure, 'malformed_response')
      return true
    },
  )
})

test('the request body uses this protocol\'s field names, not the compatible ones', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))
  await provider.chat(chatRequest(MODEL, { maxOutputTokens: 64, temperature: 0.2, jsonMode: true }), ctxFor(provider))

  const body = transport.calls[0].init.body
  assert.equal(transport.calls[0].url, `${LOCAL_BASE}/api/chat`)
  assert.equal(body.model, MODEL)
  assert.equal(body.stream, false)
  // `num_predict` and `options` are this protocol's names. A compatible body's
  // `max_tokens` would be ignored by the server without an error, so a prompt
  // budget would silently stop applying.
  assert.equal(body.options.num_predict, 64)
  assert.equal(body.options.temperature, 0.2)
  assert.equal(body.max_tokens, undefined)
  assert.equal(body.format, 'json')
})

test('a tool result becomes a tool turn, and a tool call keeps its arguments as an object', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))
  await provider.chat(
    chatRequest(MODEL, {
      messages: [
        { role: 'system', parts: [{ type: 'text', text: 'Be brief.' }] },
        {
          role: 'assistant',
          parts: [{ type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: { city: 'Lagos' } }],
        },
        { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'call_1', content: '31C', isError: false }] },
        { role: 'user', parts: [{ type: 'text', text: 'What is this?' }] },
      ],
    }),
    ctxFor(provider),
  )

  const messages = transport.calls[0].init.body.messages
  assert.deepEqual(messages[0], { role: 'system', content: 'Be brief.' })
  // Arguments are an object here, which is the whole difference from the
  // compatible protocol: stringifying them would send "[object Object]".
  assert.deepEqual(messages[1].tool_calls, [
    { function: { name: 'get_weather', arguments: { city: 'Lagos' } } },
  ])
  assert.deepEqual(messages[2], { role: 'tool', content: '31C' })
})

test('an image is refused for a model that declares no vision', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))

  await assert.rejects(
    () =>
      provider.chat(
        chatRequest(MODEL, {
          messages: [
            {
              role: 'user',
              parts: [
                { type: 'text', text: 'What is this?' },
                { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
              ],
            },
          ],
        }),
        ctxFor(provider),
      ),
    (error) => {
      assert.equal(error.failure, 'unsupported')
      return true
    },
  )
  // Refused before it was sent, not answered with a server error.
  assert.equal(transport.calls.length, 0)
})

test('a model list that declares vision lets an image travel as bare bytes', async () => {
  // The capability comes from the server's own list, so this proves both the
  // promotion and that a `data:` prefix is never added to the bytes.
  const declaring = {
    models: [{ name: MODEL, model: MODEL, capabilities: ['completion', 'vision'] }],
  }
  const calls = []
  const transport = recordingTransport(async (url, init) => {
    calls.push({ url, init })
    return url.endsWith('/api/tags') ? response(200, declaring) : response(200, CHAT)
  })
  const provider = api.createOllamaProvider(
    { preset: api.findPreset('ollama'), credential: null, defaultModel: MODEL },
    { transport },
  )

  await provider.listModels(ctxFor(provider))
  await provider.chat(
    chatRequest(MODEL, {
      messages: [
        {
          role: 'user',
          parts: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
          ],
        },
      ],
    }),
    ctxFor(provider),
  )

  const sent = calls.find((call) => call.url.endsWith('/api/chat'))
  // Bare base64: a `data:` prefix would be read as part of the bytes.
  assert.deepEqual(sent.init.body.messages[0].images, ['iVBORw0KGgo='])
})

test('a reply with a tool call reports it as a tool call and stops there', async () => {
  const toolReply = {
    model: MODEL,
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'get_weather', arguments: { city: 'Lagos' } } }],
    },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 20,
    eval_count: 7,
  }

  const { provider } = makeProvider(async () => response(200, toolReply))
  const result = await provider.chat(chatRequest(MODEL), ctxFor(provider))

  assert.equal(result.finishReason, 'tool_call')
  const call = result.parts.find((part) => part.type === 'tool_call')
  assert.equal(call.name, 'get_weather')
  assert.deepEqual(call.arguments, { city: 'Lagos' })
  // The provider names no id, so one is derived and marked as the app's own.
  assert.ok(call.id.startsWith('ollama_'), call.id)
})

test('a prompted model is asked for JSON, and its envelope is never shown as the answer', async () => {
  const envelope = { model: MODEL, message: { role: 'assistant', content: '{"answer":"Lagos"}' }, done: true, done_reason: 'stop' }
  const { provider, transport } = makeProvider(async () => response(200, envelope))

  const tool = { name: 'get_weather', description: 'Look up weather', parameters: { type: 'object', properties: {} } }
  const result = await provider.chat(chatRequest(MODEL, { tools: [tool] }), ctxFor(provider))

  // The instruction is inserted where the model reads it, and the tools are not
  // also sent natively: both at once would ask the same question twice.
  const messages = transport.calls[0].init.body.messages
  assert.equal(messages[0].role, 'system')
  assert.ok(messages[0].content.includes('get_weather'))
  assert.equal(transport.calls[0].init.body.tools, undefined)

  // The person sees the answer, never the envelope around it.
  assert.deepEqual(result.parts, [{ type: 'text', text: 'Lagos' }])
})

test('a prompted reply that is not one of the two shapes is a schema mismatch', async () => {
  const envelope = { model: MODEL, message: { role: 'assistant', content: 'Lagos, probably' }, done: true, done_reason: 'stop' }
  const { provider } = makeProvider(async () => response(200, envelope))

  const tool = { name: 'get_weather', description: 'Look up weather', parameters: { type: 'object', properties: {} } }
  await assert.rejects(
    () => provider.chat(chatRequest(MODEL, { tools: [tool] }), ctxFor(provider)),
    (error) => {
      assert.equal(error.failure, 'schema_mismatch')
      return true
    },
  )
})

test('a prompted stream holds its JSON envelope back until it is complete', async () => {
  const lines = [
    { message: { role: 'assistant', content: '{"ans' }, done: false },
    { message: { role: 'assistant', content: 'wer":"Lagos"}' }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 9, eval_count: 3 },
  ]
  const stream = lines.map((line) => JSON.stringify(line)).join('\n')

  const { provider } = makeProvider(async () => response(200, stream))
  const tool = { name: 'get_weather', description: 'Look up weather', parameters: { type: 'object', properties: {} } }
  const deltas = await drain(provider.stream(chatRequest(MODEL, { tools: [tool] }), ctxFor(provider)))

  // No text delta at all: the envelope is not an answer a person may read.
  assert.deepEqual(deltas.filter((delta) => delta.type === 'text'), [])
  const done = deltas[deltas.length - 1]
  assert.deepEqual(done.result.parts, [{ type: 'text', text: 'Lagos' }])
})

/* ------------------------------------------------------------------ *
 * Keep-alive
 * ------------------------------------------------------------------ */

test('keep-alive is sent when it was configured, and left out when it was not', async () => {
  const configured = makeProvider(async () => response(200, CHAT), { keepAlive: '30m' })
  await configured.provider.chat(chatRequest(MODEL), ctxFor(configured.provider))
  assert.equal(configured.transport.calls[0].init.body.keep_alive, '30m')

  const plain = makeProvider(async () => response(200, CHAT))
  await plain.provider.chat(chatRequest(MODEL), ctxFor(plain.provider))
  // Absent, not the default: sending the default back would pin a person to a
  // value they never chose when a later build changes it.
  assert.equal('keep_alive' in plain.transport.calls[0].init.body, false)
})

test('a model is loaded with a keep-alive and released with zero', async () => {
  const loaded = { model: MODEL, created_at: '2026-01-02T03:04:05.000Z', done: true, done_reason: 'load' }
  const { provider, transport } = makeProvider(async () => response(200, loaded), { keepAlive: '10m' })

  assert.equal(await provider.loadModel(MODEL, ctxFor(provider)), true)
  assert.equal(transport.calls[0].url, `${LOCAL_BASE}/api/generate`)
  assert.deepEqual(transport.calls[0].init.body, { model: MODEL, keep_alive: '10m', stream: false })

  assert.equal(await provider.unloadModel(MODEL, ctxFor(provider)), true)
  // Zero is the only value that releases a model immediately.
  assert.equal(transport.calls[1].init.body.keep_alive, 0)
})

test('a load that the server accepted but did not act on is not reported as success', async () => {
  // 200 with no `done` is the server saying it took the request, not that the
  // model is resident. A caller that trusted the status alone would report a warm
  // model that is not warm.
  const { provider } = makeProvider(async () => response(200, { model: MODEL }))
  assert.equal(await provider.loadModel(MODEL, ctxFor(provider)), false)
})

/* ------------------------------------------------------------------ *
 * Cloud or local comes from the destination
 * ------------------------------------------------------------------ */

test('the same preset reports local at its own address and cloud anywhere else', async () => {
  const local = makeProvider(async () => response(200, TAGS))
  const localModels = await local.provider.listModels(ctxFor(local.provider))
  assert.ok(localModels.every((model) => model.cloud === false))

  /*
   * A person may point this entry at a public host, and then the content leaves
   * the machine. Section 7.3 asks for that to be decided by the address, so the
   * provider's name must not be able to overrule it.
   */
  const remote = makeProvider(async () => response(200, TAGS), { baseUrl: 'https://models.example.com' })
  const remoteModels = await remote.provider.listModels(ctxFor(remote.provider))
  assert.ok(remoteModels.every((model) => model.cloud === true))
})

test('the catalogue marks the entry local from its address, not its name', () => {
  const ollama = api.providerPresetSummaries().find((summary) => summary.id === 'ollama')
  assert.equal(ollama.local, true)
  assert.equal(ollama.requiresKey, false)
  assert.equal(ollama.providerId, 'ollama')
})

test('a custom endpoint is cloud however it is named', () => {
  const custom = api.providerPresetSummaries().find((summary) => summary.id === 'custom')
  assert.equal(custom.local, false)
})

test('a redirect is surfaced as a failure rather than followed by the adapter', async () => {
  /*
   * The adapter builds one request and neither follows a redirect nor dials a
   * second host: re-checking a hop belongs to the guard, which is where a hop
   * that was never classified would have to be decided. This proves the adapter
   * does not take that decision into its own hands by quietly chasing a 3xx.
   */
  const { provider, transport } = makeProvider(async () => response(302, ''))

  await assert.rejects(
    () => provider.chat(chatRequest(MODEL), ctxFor(provider)),
    (error) => {
      assert.equal(typeof error.failure, 'string')
      return true
    },
  )
  assert.equal(transport.calls.length, 1)
})

/* ------------------------------------------------------------------ *
 * Safety of failure
 * ------------------------------------------------------------------ */

test('an error reported inside a 200 stream is a safe failure', async () => {
  const body = `{"error":"model requires more system memory than is available"}\n`
  const { provider } = makeProvider(async () => response(200, body))

  await assert.rejects(
    () => drain(provider.stream(chatRequest(MODEL), ctxFor(provider))),
    (error) => {
      assert.equal(typeof error.failure, 'string')
      // The server's sentence names the model and the machine; only a token may
      // travel onward.
      assert.equal(String(error.message).includes('memory'), false)
      return true
    },
  )
})

test('a missing model is reported as a missing model, not a generic failure', async () => {
  const { provider } = makeProvider(async () =>
    response(404, { error: `model "${MODEL}" not found` }),
  )

  await assert.rejects(() => provider.chat(chatRequest(MODEL), ctxFor(provider)), (error) => {
    assert.equal(error.failure, 'model_not_found')
    return true
  })
})

test('a cancelled call never reaches the network', async () => {
  const { provider, transport } = makeProvider(async () => response(200, CHAT))
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(() => provider.chat(chatRequest(MODEL), ctxFor(provider, controller.signal)), (error) => {
    assert.equal(error.failure, 'aborted')
    return true
  })
  await assert.rejects(() => provider.listModels(ctxFor(provider, controller.signal)))
  assert.equal(transport.calls.length, 0)
})

test('an embedding reply with the wrong number of vectors is refused', async () => {
  // Two vectors for one input would misalign every later comparison, and a
  // caller would have no way to notice.
  const { provider } = makeProvider(async () =>
    response(200, { model: EMBED_MODEL, embeddings: [[0.1], [0.2]] }),
    { defaultModel: EMBED_MODEL },
  )

  await assert.rejects(
    () => provider.embed({ inputs: ['hello'] }, ctxFor(provider)),
    (error) => {
      assert.equal(error.failure, 'malformed_response')
      return true
    },
  )
})
