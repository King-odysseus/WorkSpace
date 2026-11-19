'use strict'

/*
 * The provider registry, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * Two different things are asserted.
 *
 * 1. A person's choice becomes exactly one provider, or a fixed token. Every
 *    preset in the catalogue is exercised, because this loop is the only place
 *    the catalogue and the two adapter factories are checked against each other:
 *    a preset no factory accepts would otherwise ship and fail the first time
 *    someone selected it.
 *
 * 2. Nothing about a request survives a failure. A provider URL may carry a key
 *    in its query string and a transport error may name the host it could not
 *    reach, so the message checks look for a canary instead of only asserting
 *    the failure token.
 *
 * No test opens a socket. The guard is a hand-written object and the transport is
 * handed to the code under test, so a request that escaped either would fail
 * rather than reach the network.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const CANARY = 'sk-canary-7c41d9'
const CUSTOM_BASE_URL = 'https://models.example.test/v1'

/** Resolve a preset, failing the test rather than a later assertion when absent. */
function presetOrFail (presetId) {
  const preset = api.findPreset(presetId)
  assert.ok(preset, `${presetId} is missing from the catalogue`)
  return preset
}

/** A config that is valid for the preset it names. */
function configFor (preset) {
  return {
    presetId: preset.id,
    credential: preset.requiresKey ? 'test-key' : null,
    // The custom entry is the only one with no endpoint of its own.
    baseUrl: preset.baseUrl.length === 0 ? CUSTOM_BASE_URL : undefined,
  }
}

/** A transport that records every call and answers with one fake model list. */
function fakeTransport () {
  const calls = []
  const transport = {
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({ data: [{ id: 'm-1' }] }),
        json: async () => ({ data: [{ id: 'm-1' }] }),
      }
    },
  }
  return { transport, calls }
}

/** A context for one provider, built the way the app builds one. */
function ctxFor (provider, signal) {
  return api.createCallContext(
    { businessId: 1, providerId: provider.id, userId: 1, purpose: 'model_list' },
    signal,
  )
}

/** A guard that records its arguments and returns one fixed response. */
function recordingGuard (result) {
  const calls = []
  const guard = {
    async fetch (ctx, url, init) {
      calls.push({ ctx, url, init })
      return result
    },
  }
  return { guard, calls }
}

/** A response shaped the way both the guard and the transport hand one back. */
function guardedResponse () {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null },
    text: async () => JSON.stringify({ data: [{ id: 'm-1' }] }),
    json: async () => ({ data: [{ id: 'm-1' }] }),
    url: 'https://models.example.test/v1/models',
  }
}

/** Assert a synchronous throw is a ProviderError carrying the expected token. */
function expectProviderError (fn, failure, label) {
  assert.throws(
    fn,
    (error) => {
      assert.ok(error instanceof api.ProviderError, `${label}: not a ProviderError`)
      assert.equal(error.failure, failure, `${label}: wrong failure token`)
      return true
    },
    label,
  )
}

/* ------------------------------------------------------------------ *
 * Building a provider
 * ------------------------------------------------------------------ */

test('every preset builds one provider whose id is the id the ledger will use', () => {
  assert.ok(api.PROVIDER_PRESETS.length > 0, 'the catalogue is empty')

  for (const preset of api.PROVIDER_PRESETS) {
    const { transport, calls } = fakeTransport()
    const provider = api.createProvider(configFor(preset), { transport })

    assert.equal(provider.id, api.providerIdFor(preset), `id for ${preset.id}`)
    if (preset.kind === 'anthropic') {
      assert.equal(provider.id, 'anthropic')
    } else if (preset.kind === 'ollama') {
      // Its own protocol, so its own id: a ledger entry filed under the
      // compatible kind would claim a wire format it does not speak.
      assert.equal(provider.id, 'ollama')
    } else {
      assert.ok(provider.id.startsWith('openai-compatible:'), `id for ${preset.id}`)
    }

    // The whole contract, so a factory that returned a partial object is caught
    // here rather than by the first feature that calls the missing method.
    for (const method of ['listModels', 'chat', 'stream', 'embed', 'countTokens', 'testConnection']) {
      assert.equal(typeof provider[method], 'function', `${method} on ${preset.id}`)
    }

    // Building a provider is bookkeeping. Nothing may be dialled yet.
    assert.equal(calls.length, 0, `${preset.id} opened a request while being built`)
  }
})

test('a key-requiring preset refuses a blank key before the transport is touched', () => {
  const keyPresets = api.PROVIDER_PRESETS.filter((preset) => preset.requiresKey)
  assert.ok(keyPresets.length > 0, 'the catalogue must contain a key-requiring preset')

  for (const preset of keyPresets) {
    for (const credential of [null, '', '   ']) {
      const { transport, calls } = fakeTransport()
      const label = `${preset.id} with ${JSON.stringify(credential)}`

      expectProviderError(
        () => api.createProvider(
          {
            presetId: preset.id,
            credential,
            baseUrl: preset.baseUrl.length === 0 ? CUSTOM_BASE_URL : undefined,
          },
          { transport },
        ),
        'provider_unauthorized',
        label,
      )

      // The point: a missing key is known before a socket exists.
      assert.equal(calls.length, 0, `${label}: reached the transport without a key`)
    }
  }
})

test('a preset that takes no key accepts a null credential', () => {
  for (const presetId of ['lmstudio', 'custom']) {
    const preset = presetOrFail(presetId)
    assert.equal(preset.requiresKey, false, `${presetId} must not require a key`)

    const { transport } = fakeTransport()
    const provider = api.createProvider(
      {
        presetId,
        credential: null,
        baseUrl: presetId === 'custom' ? CUSTOM_BASE_URL : undefined,
      },
      { transport },
    )

    assert.equal(provider.id, api.providerIdFor(preset), `id for ${presetId}`)
  }
})

test('an unknown preset and a custom entry with no endpoint are internal errors', () => {
  const { transport, calls } = fakeTransport()

  assert.throws(
    () => api.createProvider({ presetId: 'no-such-provider', credential: 'test-key' }, { transport }),
    (error) => {
      assert.ok(error instanceof api.ProviderError)
      assert.equal(error.failure, 'internal_error')
      // The id came from the caller. A failure that echoed it would be a message
      // about the caller's data rather than about this app.
      assert.equal(error.message.includes('no-such-provider'), false)
      return true
    },
  )

  for (const baseUrl of [undefined, '', '   ']) {
    expectProviderError(
      () => api.createProvider({ presetId: 'custom', credential: null, baseUrl }, { transport }),
      'internal_error',
      `custom with ${JSON.stringify(baseUrl)}`,
    )
  }

  assert.equal(calls.length, 0, 'a refused config must not reach the transport')
})

/* ------------------------------------------------------------------ *
 * The summaries the renderer receives
 * ------------------------------------------------------------------ */

test('preset summaries are safe to send over IPC and frozen against a caller', () => {
  const summaries = api.providerPresetSummaries()

  assert.equal(summaries.length, api.PROVIDER_PRESETS.length)
  assert.equal(new Set(summaries.map((summary) => summary.id)).size, summaries.length, 'duplicate preset ids')
  assert.equal(Object.isFrozen(summaries), true)
  // No argument, so the list is available before any key is stored.
  assert.equal(api.providerPresetSummaries.length, 0)

  // Only the loopback entries are local. The custom entry has no endpoint until
  // one is typed, and "unknown" must never be presented as "local".
  assert.deepEqual(
    summaries.filter((summary) => summary.local).map((summary) => summary.id),
    ['lmstudio', 'ollama'],
  )

  const fields = ['baseUrl', 'defaultModel', 'id', 'kind', 'label', 'local', 'providerId', 'requiresKey']
  for (const summary of summaries) {
    assert.equal(Object.isFrozen(summary), true, `${summary.id} is not frozen`)
    assert.deepEqual(Object.keys(summary).sort(), fields, `${summary.id} has unexpected fields`)
    const preset = presetOrFail(summary.id)
    assert.equal(summary.providerId, api.providerIdFor(preset), `provider id for ${summary.id}`)
  }

  // JSON is what actually crosses IPC, so the serialized form is what must be
  // clean. `requiresKey` is safe: it describes the key requirement, not a key.
  const serialized = JSON.stringify(summaries)
  for (const forbidden of ['credential', 'apiKey', 'key']) {
    assert.equal(serialized.includes(forbidden), false, `the payload contains "${forbidden}"`)
  }

  // Mutating what a caller received must not reach the next caller.
  assert.throws(() => { summaries[0].label = 'tampered' }, TypeError, 'an entry is not frozen')
  assert.throws(() => { summaries.push(summaries[0]) }, TypeError, 'the array is not frozen')
  assert.deepEqual(api.providerPresetSummaries(), summaries)
})

/* ------------------------------------------------------------------ *
 * The guarded transport
 * ------------------------------------------------------------------ */

test('the guarded transport adds the call context and returns the guard response', async () => {
  const expected = guardedResponse()
  const { guard, calls } = recordingGuard(expected)
  const transport = api.createGuardedTransport(guard, () => true)
  const provider = { id: 'openai-compatible:deepseek' }
  const ctx = ctxFor(provider)

  const returned = await transport.request(ctx, 'https://api.deepseek.com/v1/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CANARY}` },
    body: { data: [{ id: 'm-1' }] },
    secretHeaders: ['Authorization'],
  })

  assert.equal(returned, expected, 'the response must be passed through, not re-wrapped')
  assert.equal(calls.length, 1)

  const [call] = calls
  assert.equal(call.url, 'https://api.deepseek.com/v1/models')
  assert.equal(call.ctx.businessId, 1)
  assert.equal(call.ctx.userId, 1)
  assert.equal(call.ctx.purpose, 'model_list')
  assert.equal(call.ctx.providerId, 'openai-compatible:deepseek')
  assert.equal(call.ctx.localOnly, true)
  assert.equal(call.init.method, 'POST')
  assert.deepEqual(call.init.headers, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${CANARY}`,
  })
  assert.deepEqual(call.init.body, { data: [{ id: 'm-1' }] })
  assert.deepEqual(call.init.secretHeaders, ['Authorization'])
})

test('a guard failure becomes a fixed token with nothing from the request attached', async () => {
  const url = `https://models.example.test/v1/chat?api_key=${CANARY}`
  const provider = { id: 'openai-compatible:custom' }
  const ctx = ctxFor(provider)

  const cases = [
    ['a refusal', () => new api.EgressBlockedError('local_only'), 'egress_blocked'],
    ['a dead socket', () => new api.EgressTransportError('ECONNREFUSED'), 'network'],
    ['a cancellation', () => new DOMException(`cancelled ${CANARY}`, 'AbortError'), 'aborted'],
    ['an unknown fault', () => new Error(`request to ${url} failed with ${CANARY}`), 'internal_error'],
  ]

  for (const [label, thrown, failure] of cases) {
    let asked = 0
    const guard = {
      async fetch () {
        asked += 1
        throw thrown()
      },
    }
    const transport = api.createGuardedTransport(guard, () => false)

    await assert.rejects(
      transport.request(ctx, url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${CANARY}` },
        body: { canary: CANARY },
      }),
      (error) => {
        assert.ok(error instanceof api.ProviderError, `${label}: not a ProviderError`)
        assert.equal(error.failure, failure, `${label}: wrong failure token`)
        assert.equal(
          error.message,
          api.PROVIDER_FAILURE_MESSAGES[failure],
          `${label}: the message is not the fixed sentence`,
        )

        // Anything that names the request is a leak, the host included.
        for (const leaked of [CANARY, 'canary', 'models.example.test', url]) {
          assert.equal(error.message.includes(leaked), false, `${label}: the message contains "${leaked}"`)
        }

        // A cause would be printed by console.error beside the message.
        assert.equal(error.cause, undefined, `${label}: the original error was attached`)
        return true
      },
    )

    assert.equal(asked, 1, `${label}: the guard was not the thing that failed`)
  }
})

test('an already aborted context is refused before the guard is asked', async () => {
  const { guard, calls } = recordingGuard(guardedResponse())
  const transport = api.createGuardedTransport(guard, () => true)

  const controller = new AbortController()
  controller.abort()

  const ctx = ctxFor({ id: 'anthropic' }, controller.signal)

  await assert.rejects(
    transport.request(ctx, 'https://api.anthropic.com/v1/messages', { method: 'POST' }),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )

  assert.equal(calls.length, 0, 'an aborted call must not reach the guard')
})

test('the local-only policy is asked on every call, not once when the transport was built', async () => {
  const { guard, calls } = recordingGuard(guardedResponse())
  let asked = 0
  const transport = api.createGuardedTransport(guard, () => {
    asked += 1
    // A business can change its policy while the app is running, so the two
    // calls below must see two answers from the same transport.
    return asked === 1
  })

  const ctx = ctxFor({ id: 'openai-compatible:openai' })
  const url = 'https://api.openai.com/v1/models'

  await transport.request(ctx, url, { method: 'GET' })
  await transport.request(ctx, url, { method: 'GET' })

  assert.equal(asked, 2, 'the policy must be consulted once per call')
  assert.equal(calls[0].ctx.localOnly, true)
  assert.equal(calls[1].ctx.localOnly, false)
})
