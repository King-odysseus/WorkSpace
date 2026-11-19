'use strict'

/*
 * Finding a model server that is already running on this machine.
 *
 * The interesting cases are all the unhappy ones. A machine with no local models
 * is the ordinary case, and the failure this file exists to prevent is a screen
 * that reports "no local models" by throwing, or that reports a server as off
 * because a different program happens to be listening on its port.
 *
 * Every test therefore states what is listening: nothing, something that refuses,
 * something that is unwell, or something that is not a model server at all. The
 * adapter's own contract is covered next door; what is proven here is that two
 * probes can be asked at once and each answers for itself.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const OLLAMA = 'http://127.0.0.1:11434'
const LMSTUDIO = 'http://127.0.0.1:1234'
const MODEL = 'qwen2.5:7b'

const TAGS = { models: [{ name: MODEL, model: MODEL, details: { family: 'qwen2' } }] }
const LM_STUDIO_MODELS = { data: [{ id: 'local-model', object: 'model' }] }

function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

/** A transport that answers per origin, and records what was asked. */
function transportBy (answers) {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      calls.push({ url, init })
      const answer = answers[new URL(url).origin]
      if (answer === undefined) throw new Error('no answer prepared for the origin of ' + url)
      return typeof answer === 'function' ? await answer(url, init) : answer
    },
  }
}

function ctx () {
  return api.createCallContext(
    { businessId: 1, providerId: 'ollama', userId: 1, purpose: 'chat_strategy' },
    undefined,
  )
}

test('the two addresses probed are the default ports of the two servers', () => {
  assert.deepEqual(
    api.LOCAL_CANDIDATES.map((candidate) => candidate.baseUrl),
    [OLLAMA, LMSTUDIO],
  )
  assert.deepEqual(
    api.LOCAL_CANDIDATES.map((candidate) => candidate.presetId),
    ['ollama', 'lmstudio'],
  )
})

test('both servers running are both reported, each with its own models', async () => {
  const transport = transportBy({ [OLLAMA]: response(200, TAGS), [LMSTUDIO]: response(200, LM_STUDIO_MODELS) })
  const found = await api.detectLocalProviders({ transport, ctx: ctx() })

  assert.equal(found.length, 2)
  assert.deepEqual(found.map((entry) => entry.reachable), [true, true])
  assert.deepEqual(found[0].models.map((model) => model.id), [MODEL])
  assert.deepEqual(found[1].models.map((model) => model.id), ['local-model'])
  // Each model carries the classification its own endpoint implies.
  assert.ok(found[0].models.every((model) => model.cloud === false))
})

test('a machine with neither server running answers twice and throws nothing', async () => {
  const refused = () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' })
  }
  const transport = transportBy({ [OLLAMA]: refused, [LMSTUDIO]: refused })

  const found = await api.detectLocalProviders({ transport, ctx: ctx() })

  assert.equal(found.length, 2)
  // Nothing listening is an ordinary answer, not a crash and not an error screen.
  assert.deepEqual(found.map((entry) => entry.reachable), [false, false])
  assert.deepEqual(found.map((entry) => entry.failure), ['network', 'network'])
  assert.deepEqual(found.map((entry) => entry.models), [[], []])
})

test('a server that is unwell is reported as unwell, not as absent', async () => {
  const transport = transportBy({
    [OLLAMA]: response(500, 'kaboom'),
    [LMSTUDIO]: response(401, { error: 'key required' }),
  })

  const found = await api.detectLocalProviders({ transport, ctx: ctx() })

  // A refused connection and a failing server are different things to a person:
  // one is turned off, the other needs looking at.
  assert.equal(found[0].reachable, false)
  assert.equal(found[0].failure, 'provider_unavailable')
  assert.equal(found[1].reachable, false)
  assert.equal(found[1].failure, 'provider_unauthorized')
})

test('something else listening on the port is not mistaken for a model server', async () => {
  const transport = transportBy({
    [OLLAMA]: response(200, '<html><body>router admin</body></html>'),
    [LMSTUDIO]: response(200, '{"unexpected":true}'),
  })

  const found = await api.detectLocalProviders({ transport, ctx: ctx() })

  assert.deepEqual(found.map((entry) => entry.reachable), [false, false])
  // An unreadable body is its own answer, so a person is not told their server is
  // switched off when it is really something else on that port.
  assert.equal(found[0].failure, 'malformed_response')
  assert.equal(found[1].failure, 'malformed_response')
})

test('one server failing does not abandon the other', async () => {
  const transport = transportBy({
    [OLLAMA]: () => {
      throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    },
    [LMSTUDIO]: response(200, LM_STUDIO_MODELS),
  })

  const found = await api.detectLocalProviders({ transport, ctx: ctx() })
  assert.equal(found[0].reachable, false)
  assert.equal(found[1].reachable, true)
  assert.equal(found[1].models.length, 1)
})

test('results stay in candidate order however quickly each answers', async () => {
  // The first address answers slowly and the second immediately. A caller that
  // received them in completion order would see rows swap between refreshes.
  const transport = transportBy({
    [OLLAMA]: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return response(200, TAGS)
    },
    [LMSTUDIO]: response(200, LM_STUDIO_MODELS),
  })

  const found = await api.detectLocalProviders({ transport, ctx: ctx() })
  assert.deepEqual(found.map((entry) => entry.presetId), ['ollama', 'lmstudio'])
})

test('a cancelled detection sends nothing and says so', async () => {
  const transport = transportBy({ [OLLAMA]: response(200, TAGS), [LMSTUDIO]: response(200, LM_STUDIO_MODELS) })
  const controller = new AbortController()
  controller.abort()

  const cancelled = api.createCallContext(
    { businessId: 1, providerId: 'ollama', userId: 1, purpose: 'chat_strategy' },
    controller.signal,
  )
  const found = await api.detectLocalProviders({ transport, ctx: cancelled })

  assert.deepEqual(found.map((entry) => entry.failure), ['aborted', 'aborted'])
  assert.equal(transport.calls.length, 0)
})

test('a probe is a real request, so it carries the address it dialled and no secret', async () => {
  const transport = transportBy({ [OLLAMA]: response(200, TAGS), [LMSTUDIO]: response(200, LM_STUDIO_MODELS) })
  await api.detectLocalProviders({ transport, ctx: ctx() })

  for (const call of transport.calls) {
    assert.equal(call.init.method, 'GET')
    // No credential is sent to a default local port, and none could be: the
    // probe is built with a null credential on purpose.
    const headerNames = Object.keys(call.init.headers).map((name) => name.toLowerCase())
    assert.equal(headerNames.includes('authorization'), false)
  }
})

test('a candidate pointed at a public host reports cloud models', async () => {
  // Detection classifies from the address, like every other call. A "local"
  // candidate configured somewhere else is not local.
  const transport = transportBy({ 'https://models.example.com': response(200, TAGS) })

  const [found] = await api.detectLocalProviders({
    transport,
    ctx: ctx(),
    candidates: [{ presetId: 'ollama', baseUrl: 'https://models.example.com', label: 'Ollama' }],
  })

  assert.equal(found.reachable, true)
  assert.equal(found.models[0].cloud, true)
})
