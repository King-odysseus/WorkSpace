'use strict'

/*
 * The seam between an adapter and the egress guard, exercised together.
 *
 * The adapter tests prove the adapter goes through the transport it is given.
 * This file proves the transport it is given in the app is the guarded one: a
 * request from a real adapter arrives at the guard's `fetch` with the business,
 * the provider, the purpose, the local-only decision and the secret header
 * names, and a refusal from the guard reaches the caller as one token.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const CHAT = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-5',
  content: [{ type: 'text', text: 'Hello!' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 3, output_tokens: 2 },
}

const MODELS = { data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' }] }

function guardedResponse (body) {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

/** A guard whose only job is to record and answer. No sockets. */
function recordingGuard (body) {
  const calls = []
  return {
    calls,
    async fetch (ctx, url, init) {
      calls.push({ ctx, url, init })
      return guardedResponse(body)
    },
  }
}

function build (presetId, guard, options = {}) {
  const transport = api.createGuardedTransport(guard, options.isLocalOnly ?? (() => false))
  return api.createProvider(
    { presetId, credential: options.credential ?? 'test-key', baseUrl: options.baseUrl },
    { transport },
  )
}

function ctxFor (provider, purpose) {
  return api.createCallContext({
    businessId: 7,
    providerId: provider.id,
    userId: 3,
    purpose: purpose ?? 'model_list',
  })
}

test('model discovery reaches the guard with the whole call context', async () => {
  const guard = recordingGuard(MODELS)
  const provider = build('anthropic', guard, { isLocalOnly: () => true })

  const models = await provider.listModels(ctxFor(provider))

  assert.equal(models.length, 1)
  assert.equal(guard.calls.length, 1)
  const call = guard.calls[0]
  assert.equal(call.url, 'https://api.anthropic.com/v1/models')
  assert.deepEqual(call.ctx, {
    businessId: 7,
    providerId: 'anthropic',
    userId: 3,
    purpose: 'model_list',
    localOnly: true,
    signal: undefined,
  })
})

test('a cloud call from a local-only business never leaves', async () => {
  const guard = {
    async fetch () {
      throw new api.EgressBlockedError('local_only')
    },
  }
  const provider = build('anthropic', guard, { isLocalOnly: () => true })

  const error = await provider
    .chat(
      {
        modelId: 'claude-sonnet-4-5',
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
      },
      ctxFor(provider, 'chat_strategy'),
    )
    .then(
      () => null,
      (caught) => caught,
    )

  assert.ok(error instanceof api.ProviderError)
  assert.equal(error.failure, 'egress_blocked')
  assert.equal(String(error).includes('local_only'), false)
})

test('a connection test is a guarded call too', async () => {
  const guard = recordingGuard(MODELS)
  const provider = build('openai', guard)

  const result = await provider.testConnection(ctxFor(provider, 'connection_test'))

  assert.deepEqual(result, { ok: true, modelCount: 1 })
  assert.equal(guard.calls.length, 1)
  assert.equal(guard.calls[0].ctx.purpose, 'connection_test')
  assert.equal(guard.calls[0].ctx.localOnly, false)
})

test('the key header is named as a secret on the way out', async () => {
  const anthropicGuard = recordingGuard(CHAT)
  const anthropic = build('anthropic', anthropicGuard)
  await anthropic.chat(
    {
      modelId: 'claude-sonnet-4-5',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    },
    ctxFor(anthropic, 'chat_strategy'),
  )
  assert.deepEqual(anthropicGuard.calls[0].init.secretHeaders, ['x-api-key'])

  const openaiGuard = recordingGuard({
    ...CHAT,
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })
  const openai = build('openai', openaiGuard)
  await openai.chat(
    {
      modelId: 'gpt-4.1',
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
    },
    ctxFor(openai, 'chat_strategy'),
  )
  assert.deepEqual(openaiGuard.calls[0].init.secretHeaders, ['authorization'])
})

test('the local-only decision is made per call', async () => {
  const guard = recordingGuard(MODELS)
  let answer = true
  const provider = build('openai', guard, { isLocalOnly: () => answer })

  await provider.listModels(ctxFor(provider))
  answer = false
  await provider.listModels(ctxFor(provider))

  assert.equal(guard.calls[0].ctx.localOnly, true)
  assert.equal(guard.calls[1].ctx.localOnly, false)
})
