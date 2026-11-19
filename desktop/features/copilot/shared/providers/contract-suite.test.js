'use strict'

/*
 * The shared adapter contract suite, tested against a fake adapter.
 *
 * A contract suite that only ever reports success is worse than no suite: it
 * looks like coverage while checking nothing. So this file proves both
 * directions, and the second direction is the point:
 *
 * - A compliant fake adapter passes every case, both with the optional
 *   capabilities and without them (which exercises the "refuse unsupported"
 *   cases instead of the "do it" cases).
 * - Each deliberately broken variant fails the specific case that exists to
 *   catch it. If someone later weakens a case, one of these assertions goes red
 *   rather than the suite quietly passing a broken adapter.
 *
 * Everything runs through `build/main/ipc.cjs`, the bundle Electron loads, so
 * an adapter's own test file gets the same code from `require`.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** An adapter that claims everything. */
const FULL = {
  contextWindow: 8000,
  maxOutput: 1024,
  tools: 'prompted',
  vision: false,
  webSearch: false,
  streaming: true,
  embeddings: true,
  jsonMode: true,
}

/** An adapter that claims only chat and model discovery. */
const NO_OPTIONALS = { ...FULL, streaming: false, embeddings: false }

/* ------------------------------------------------------------------ *
 * A fake adapter
 *
 * Its wire format is its own, which is the point: the harness supplies the
 * network and the fixture, and the adapter translates between them the way a
 * real one translates to a provider's protocol.
 * ------------------------------------------------------------------ */

function makeAdapter (fetchImpl, capabilities, behaviour = {}) {
  /** One request, read the way an adapter has to: status, then shape. */
  async function read (url, expectedKind, ctx) {
    // Cancellation is checked before the request is built, so an abandoned call
    // never leaves the machine.
    if (!behaviour.ignoreAbort && ctx.signal?.aborted) {
      throw new api.ProviderError('aborted')
    }

    let reply
    try {
      reply = await fetchImpl(url, { signal: ctx.signal })
    } catch (error) {
      if (behaviour.rawErrors) throw error
      throw new api.ProviderError(api.toProviderFailure(error))
    }

    if (reply.status === 401) throw new api.ProviderError('provider_unauthorized')
    if (!reply.ok) throw new api.ProviderError(api.toProviderFailure({ status: reply.status }))

    let body
    try {
      body = await reply.json()
    } catch {
      body = undefined
    }

    const shaped = typeof body === 'object' && body !== null && body.kind === expectedKind
    if (!shaped) {
      // The broken variant a case exists to catch: treating an unreadable body
      // as an empty success instead of a failure.
      if (behaviour.acceptMalformed) return { kind: expectedKind, text: '', models: [] }
      throw new api.ProviderError('malformed_response')
    }
    return body
  }

  const adapter = {
    id: 'fake:test',

    async listModels (ctx) {
      const body = await read('https://fake.test/models', 'models', ctx)
      return body.models.map(model => ({
        id: model.id,
        providerId: adapter.id,
        label: model.label ?? model.id,
        cloud: false,
        capabilities,
      }))
    },

    async chat (request, ctx) {
      const body = await read('https://fake.test/chat', 'chat', ctx)
      const result = {
        providerId: behaviour.wrongProvider ?? adapter.id,
        modelId: 'model-a',
        cloud: false,
        usage: { in: 3, out: 2 },
        finishReason: 'stop',
        parts: [{ type: 'text', text: body.text }],
      }
      if (behaviour.dropUsage) delete result.usage
      return result
    },

    async *stream (request, ctx) {
      if (!capabilities.streaming && !behaviour.streamEvenIfUnsupported) {
        throw new api.ProviderError('unsupported')
      }
      if (!behaviour.ignoreAbort && ctx.signal?.aborted) {
        throw new api.ProviderError('aborted')
      }

      const reply = await fetchImpl('https://fake.test/stream', { signal: ctx.signal })
      const text = await reply.text()

      yield { type: 'text', text }
      yield {
        type: 'done',
        result: {
          providerId: adapter.id,
          modelId: 'model-a',
          cloud: false,
          usage: { in: 1, out: 1 },
          finishReason: 'stop',
          parts: [{ type: 'text', text }],
        },
      }
    },

    async embed (request, ctx) {
      if (!capabilities.embeddings) {
        if (!behaviour.embedEvenIfUnsupported) throw new api.ProviderError('unsupported')
        return {
          providerId: adapter.id,
          modelId: 'model-a',
          cloud: false,
          usage: { in: 1, out: 0 },
          vectors: request.inputs.map(() => [0.5]),
        }
      }

      await read('https://fake.test/embed', 'embed', ctx)
      return {
        providerId: adapter.id,
        modelId: 'model-a',
        cloud: false,
        usage: { in: 2, out: 0 },
        vectors: request.inputs.map(() => [0.5, 0.6]),
      }
    },

    async countTokens (request) {
      if (behaviour.countOnNetwork) {
        await adapter.listModels(
          api.createCallContext({ businessId: 1, providerId: adapter.id, userId: 1, purpose: 'model_list' }),
        )
      }
      return api.estimateChatTokens(request)
    },

    async testConnection (ctx) {
      try {
        const models = await adapter.listModels(ctx)
        return { ok: true, modelCount: models.length }
      } catch (error) {
        // A refusal is a value here: the screen draws it beside the button.
        if (error instanceof api.ProviderError) return { ok: false, failure: error.failure }
        return { ok: false, failure: 'internal_error' }
      }
    },
  }

  return adapter
}

/* ------------------------------------------------------------------ *
 * Subjects
 * ------------------------------------------------------------------ */

function subject (options = {}) {
  const capabilities = { ...FULL, ...(options.capabilities ?? {}) }
  return {
    name: options.name ?? 'fake',
    capabilities,
    fixtures: {
      models: { kind: 'models', models: [{ id: 'model-a', label: 'Model A' }] },
      chat: { kind: 'chat', text: 'hello' },
      stream: 'hello',
      embed: { kind: 'embed' },
    },
    create (fetchImpl) {
      const adapter = makeAdapter(fetchImpl, capabilities, options.behaviour ?? {})
      return options.wrap ? options.wrap(adapter) : adapter
    },
  }
}

/** Run the whole suite for one subject and return what failed. */
async function failuresFor (options) {
  return api.collectContractFailures(api.providerContractCases(subject(options)))
}

/** Assert that one named case failed, and say which ones did if it did not. */
function expectFailed (failures, name) {
  const names = failures.map(failure => failure.name)
  assert.ok(
    names.includes(name),
    `expected '${name}' to fail; failing cases were: ${names.length === 0 ? 'none' : names.join(' | ')}`,
  )
}

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test('a compliant adapter passes every case, with its optional capabilities', async () => {
  const failures = await failuresFor({ capabilities: FULL })

  assert.deepEqual(failures, [])
})

test('a compliant adapter that offers no streaming or embeddings also passes', async () => {
  // This is the other half of the suite: the same subject shape, but the
  // "refuse what you cannot do" cases run instead of the "do it" cases.
  const failures = await failuresFor({ name: 'chat-only', capabilities: NO_OPTIONALS })

  assert.deepEqual(failures, [])
})

test('the suite covers the facets the plan names, by case', async () => {
  const names = api.providerContractCases(subject()).map(contractCase => contractCase.name)

  // Each of these exists because a facet of section 9 was otherwise unchecked.
  for (const expected of [
    'lists models that carry their own capabilities',
    'reports attribution and usage with every reply',
    'streams deltas and ends with the final result',
    'returns one vector per input',
    'counts tokens locally without touching the network',
    'tests a working connection without throwing',
    'reports a rejected key as a failure, not a throw',
    'turns an unreadable reply into a safe failure',
    'turns a transport error into a safe failure',
    'refuses a call that was cancelled before it started',
    'turns an aborted transport into a safe failure',
  ]) {
    assert.ok(names.includes(expected), `the suite has no case for '${expected}'`)
  }

  // A duplicate name would hide one case behind another in any list of failures.
  assert.equal(new Set(names).size, names.length)
  assert.ok(names.length >= 12)
})

test('a subject that offers no streaming is asked to refuse it, not to skip it', async () => {
  const names = api
    .providerContractCases(subject({ capabilities: NO_OPTIONALS }))
    .map(contractCase => contractCase.name)

  assert.ok(names.includes('refuses to stream when it declares no streaming'))
  assert.ok(names.includes('refuses embeddings when it declares none'))
  // ...and the cases that would call an operation it does not have are gone.
  assert.equal(names.includes('streams deltas and ends with the final result'), false)
  assert.equal(names.includes('returns one vector per input'), false)
})

/* ------------------------------------------------------------------ *
 * Broken adapters
 *
 * One variant per rule, so a case that stops checking shows up here.
 * ------------------------------------------------------------------ */

test('an adapter that drops usage fails the attribution case', async () => {
  const failures = await failuresFor({ behaviour: { dropUsage: true } })

  expectFailed(failures, 'reports attribution and usage with every reply')
})

test('an adapter that reports the wrong provider fails the attribution case', async () => {
  const failures = await failuresFor({ behaviour: { wrongProvider: 'someone-else' } })

  expectFailed(failures, 'reports attribution and usage with every reply')
})

test('an adapter that accepts an unreadable reply fails the malformed case', async () => {
  const failures = await failuresFor({ behaviour: { acceptMalformed: true } })

  expectFailed(failures, 'turns an unreadable reply into a safe failure')
})

test('an adapter that forwards transport text fails the safe-error cases', async () => {
  const failures = await failuresFor({ behaviour: { rawErrors: true } })

  expectFailed(failures, 'turns a transport error into a safe failure')

  // The harness must not become the leak: its own failure text describes the
  // error by type, so the canary inside the transport error stays out of it.
  const transportFailure = failures.find(failure => failure.name === 'turns a transport error into a safe failure')
  assert.equal(transportFailure.message.includes(api.CONTRACT_CANARY), false)
  assert.equal(transportFailure.message.toLowerCase().includes('https://'), false)
})

test('an adapter that ignores a cancelled context fails the cancellation case', async () => {
  const failures = await failuresFor({ behaviour: { ignoreAbort: true } })

  expectFailed(failures, 'refuses a call that was cancelled before it started')
})

test('an adapter that estimates tokens over the network fails the token case', async () => {
  const failures = await failuresFor({ behaviour: { countOnNetwork: true } })

  expectFailed(failures, 'counts tokens locally without touching the network')
})

test('an adapter that streams without declaring it fails the unsupported case', async () => {
  const failures = await failuresFor({
    capabilities: NO_OPTIONALS,
    behaviour: { streamEvenIfUnsupported: true },
  })

  expectFailed(failures, 'refuses to stream when it declares no streaming')
})

test('an adapter that embeds without declaring it fails the unsupported case', async () => {
  const failures = await failuresFor({
    capabilities: NO_OPTIONALS,
    behaviour: { embedEvenIfUnsupported: true },
  })

  expectFailed(failures, 'refuses embeddings when it declares none')
})

test('a failing case reports the adapter name and the reason', async () => {
  const failures = await failuresFor({ name: 'broken-fake', behaviour: { dropUsage: true } })

  const failure = failures.find(entry => entry.name === 'reports attribution and usage with every reply')
  assert.ok(failure)
  // A person reading the failure needs to know which adapter and which rule.
  assert.ok(failure.message.startsWith('broken-fake: '))
  assert.ok(failure.message.includes('usage'))
})
