'use strict'

/*
 * The provider settings service, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * The catalogue, the credential store and the guarded transport are each covered
 * next door. What is worth proving here is what only the seam between them can
 * get wrong:
 *
 * - A provider that needs a key refuses before the network, so a person is not
 *   told "the provider turned it down" when nothing was ever sent.
 * - A key reaches the wire but never reaches a screen: the state carries at most
 *   four characters of it, and never the key itself.
 * - A nonce is single use and bound to the account that asked for it.
 * - Configuration belongs to one account on one server. Two people on one
 *   machine share a keychain, and neither may be shown the other's rows.
 * - Remove is the one action that must not leave a secret behind.
 * - A machine with no local server is an ordinary answer, not a failure.
 *
 * No test opens a socket and none encrypts anything: the transport answers from
 * a table and `safeStorage` is the identity function, which is the whole point
 * of both being injected.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const HOST = 'zuri.example.test'
const USER = 7
const SCOPE = { serverHost: HOST, userId: USER }
const OTHER_SCOPE = { serverHost: HOST, userId: 8 }

/* Long enough that the visible tail is a tail rather than the short-key mask. */
const KEY = 'sk-ant-api03-7f3c9b1e4d5a'
const OTHER_KEY = 'sk-ant-api03-2b8e6f0c7a91'

const ANTHROPIC = 'https://api.anthropic.com'
const OLLAMA = 'http://127.0.0.1:11434'
const LMSTUDIO = 'http://127.0.0.1:1234'

/* One model is all a list needs to be readable, and one is all a count needs. */
const ANTHROPIC_MODELS = {
  data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', type: 'model' }],
}

/** A response shaped the way the adapters read one. */
function response (status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  }
}

/**
 * A transport that answers per origin from a table and records every call.
 *
 * An origin with no prepared answer throws, so a test that asserts "nothing was
 * sent" cannot pass by the request quietly succeeding somewhere else.
 */
function transportBy (answers) {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      const answer = answers[new URL(url).origin]
      if (answer === undefined) throw new Error('no answer prepared for the origin of ' + url)
      return typeof answer === 'function' ? await answer(url, init) : answer
    },
  }
}

/** A transport whose every call fails the way a dead socket fails. */
function deadTransport () {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      // `code` is what separates "the provider could not be reached" from an
      // internal error, so it is part of the fixture rather than decoration.
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' })
    },
  }
}

/**
 * A transport whose answers are held open until the test releases them.
 *
 * The account-change rule is only visible in the gap between asking and
 * answering, so these fixtures make that gap explicit: `begun` resolves once a
 * request has been sent, and `release` lets every held request answer. `pending`
 * drains whatever is held at that moment, because discovery asks two hosts at
 * once and one release should settle both.
 */
function heldTransport (answer) {
  const calls = []
  const pending = []
  let started
  const begun = new Promise(resolve => { started = resolve })
  return {
    calls,
    begun,
    release () {
      for (const resolve of pending.splice(0)) resolve()
    },
    async request (ctx, url, init) {
      calls.push({ ctx, url, init })
      started()
      await new Promise(resolve => { pending.push(resolve) })
      return answer
    },
  }
}

/**
 * A safeStorage that does not encrypt, in the same sense as a test double.
 *
 * The bytes are the buffer. Faked here rather than at the credential store
 * because every promise this file makes about a key (partitioned by account,
 * removable, forgotten on sign-out) is a promise the real store keeps, and a
 * fake store would keep them on its behalf.
 */
function identitySafeStorage () {
  return {
    isEncryptionAvailable: () => true,
    encryptString: plainText => Buffer.from(plainText, 'utf8'),
    decryptString: encrypted => encrypted.toString('utf8'),
  }
}

/** The real store and the real entry boundary over that fake keychain. */
function security () {
  const keychain = api.createKeychain({ safeStorage: identitySafeStorage() })
  const credentials = api.createCredentialStore({ keychain })
  const entry = api.createCredentialEntry({ store: credentials })
  return { keychain, credentials, entry }
}

/** The service over one transport, one scope reader and an optional file. */
function makeService (options = {}) {
  const transport = options.transport ?? transportBy({})
  const store = options.security ?? security()
  const scopeRef = options.scopeRef ?? { current: { serverHost: HOST, userId: USER } }
  const log = { lines: [], warn (message) { log.lines.push(String(message)) } }
  const service = api.createProviderSettingsService({
    transport,
    credentials: store.credentials,
    entry: store.entry,
    scope: () => scopeRef.current,
    persistence: options.persistence,
    log,
  })
  return {
    service,
    transport,
    scopeRef,
    log,
    keychain: store.keychain,
    credentials: store.credentials,
    entry: store.entry,
  }
}

/**
 * A persistence object that behaves like a file.
 *
 * The record is serialized on the way in and parsed on the way out, so a service
 * cannot keep a live reference to the map it thinks it wrote and a test cannot
 * pass by sharing memory with it.
 */
function memoryFile () {
  const file = {
    writes: 0,
    records: null,
    load: () => (file.records === null ? null : JSON.parse(file.records)),
    save: (records) => {
      file.writes += 1
      file.records = JSON.stringify(records)
      return true
    },
  }
  return file
}

/** One configured entry out of a state, named rather than positional. */
function entryFor (state, presetId) {
  const found = state.providers.find(provider => provider.presetId === presetId)
  assert.ok(found, presetId + ' is not in the state')
  return found
}

test('a provider that needs a key refuses before the network rather than after it', async () => {
  const { service, transport } = makeService()

  await assert.rejects(() => service.listModels('anthropic'), error => {
    assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
    assert.equal(error.failure, 'missing_credential')
    return true
  })

  // The point of failing here: a person is told to enter a key, and no request
  // was spent discovering the same thing with an empty header.
  assert.equal(transport.calls.length, 0)
})

test('a saved key makes the connection test answer, and is shown only as its tail', async () => {
  const transport = transportBy({ [ANTHROPIC]: response(200, ANTHROPIC_MODELS) })
  const { service, log } = makeService({ transport })

  service.saveProvider('anthropic', '', '')
  const challenge = service.beginCredential('anthropic')
  // A nonce is a hex token; anything else would have been refused at the
  // boundary instead of reaching the store.
  assert.match(challenge.nonce, /^[a-f0-9]{16,}$/)

  const saved = service.saveCredential('anthropic', challenge.nonce, KEY)
  assert.equal(saved.presetId, 'anthropic')
  assert.equal(saved.fingerprint, KEY.slice(-4))
  assert.ok(saved.fingerprint.length <= 4)
  assert.notEqual(saved.fingerprint, KEY)

  assert.deepEqual(await service.testConnection('anthropic'), {
    ok: true,
    modelCount: 1,
    cloud: true,
  })

  const [call] = transport.calls
  assert.equal(call.url, ANTHROPIC + '/v1/models')
  assert.equal(call.init.method, 'GET')
  // The key travels in the header the preset names and never in the address,
  // which is the half of a request that ends up in logs and audit rows.
  assert.equal(call.init.headers['x-api-key'], KEY)
  assert.equal(call.url.includes(KEY), false)

  const entry = entryFor(service.readState(), 'anthropic')
  assert.equal(entry.hasCredential, true)
  assert.equal(entry.fingerprint, KEY.slice(-4))
  assert.ok(entry.fingerprint.length <= 4)

  // Nothing that was logged along that whole path may quote the key: these lines
  // are what a support log is made of.
  assert.equal(log.lines.some(line => line.includes(KEY)), false)
})

test('a nonce that was never issued is refused and stores nothing', () => {
  const { service, credentials } = makeService()
  service.saveProvider('anthropic', '', '')

  // Well formed hex, so the boundary refuses it for being unknown rather than
  // for being malformed, which is the replay this test is about.
  const neverIssued = 'f'.repeat(48)

  assert.throws(() => service.saveCredential('anthropic', neverIssued, KEY), error => {
    assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
    assert.ok(api.PROVIDER_SETTINGS_FAILURES.includes(error.failure), String(error.failure))
    // The refusal may not quote the key it was asked to store.
    assert.equal(error.message.includes(KEY), false)
    return true
  })

  assert.deepEqual(credentials.describe(SCOPE, 'anthropic'), { ok: false, reason: 'not_found' })
  assert.equal(entryFor(service.readState(), 'anthropic').hasCredential, false)
})

test('signed out, the catalogue is still listed and no configured entry is', () => {
  const scopeRef = { current: null }
  const { service } = makeService({ scopeRef })

  const state = service.readState()
  assert.equal(state.signedIn, false)
  assert.deepEqual(state.providers, [])
  // The catalogue is this build's own data and holds nothing about a person, so
  // a signed-out screen can still explain what exists.
  assert.ok(state.catalog.length > 0)
  assert.equal(state.catalog.length, api.PROVIDER_PRESETS.length)
  assert.equal(state.catalog.some(entry => entry.needsBaseUrl), true)

  // Nothing that needs an account is defaulted to somebody: it is refused.
  assert.throws(() => service.saveProvider('anthropic', '', ''), error => {
    assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
    assert.equal(error.failure, 'not_signed_in')
    return true
  })
})

test('two accounts on one machine keep their own keys and their own entries', async () => {
  const scopeRef = { current: SCOPE }
  const transport = transportBy({ [ANTHROPIC]: response(200, ANTHROPIC_MODELS) })
  const { service, credentials } = makeService({ scopeRef, transport })

  service.saveProvider('anthropic', '', '')
  service.saveCredential('anthropic', service.beginCredential('anthropic').nonce, KEY)

  // A second person signs in on the same machine and shares the same keychain.
  scopeRef.current = OTHER_SCOPE
  assert.deepEqual(service.readState().providers, [])
  assert.deepEqual(credentials.describe(OTHER_SCOPE, 'anthropic'), { ok: false, reason: 'not_found' })

  service.saveProvider('anthropic', '', 'claude-haiku-4-5')
  const otherSaved = service.saveCredential(
    'anthropic',
    service.beginCredential('anthropic').nonce,
    OTHER_KEY,
  )
  assert.equal(otherSaved.fingerprint, OTHER_KEY.slice(-4))
  assert.notEqual(otherSaved.fingerprint, KEY.slice(-4))

  const otherState = service.readState()
  assert.equal(otherState.providers.length, 1)
  assert.equal(entryFor(otherState, 'anthropic').defaultModel, 'claude-haiku-4-5')
  assert.equal(entryFor(otherState, 'anthropic').fingerprint, OTHER_KEY.slice(-4))

  // Back to the first person: their row and their key are untouched by the
  // second one having saved their own.
  scopeRef.current = SCOPE
  const firstState = service.readState()
  assert.equal(firstState.providers.length, 1)
  assert.equal(entryFor(firstState, 'anthropic').defaultModel, 'claude-sonnet-4-5')
  assert.equal(entryFor(firstState, 'anthropic').fingerprint, KEY.slice(-4))
  assert.deepEqual(credentials.read(SCOPE, 'anthropic'), { ok: true, secret: KEY })
})

test('a base URL that is not http or https is refused and stores nothing', () => {
  const { service } = makeService()

  assert.throws(() => service.saveProvider('anthropic', 'ftp://x', ''), error => {
    assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
    assert.equal(error.failure, 'invalid_request')
    return true
  })

  // A refused save must not leave a half-configured row behind for the screen to
  // draw as if it had worked.
  assert.deepEqual(service.readState().providers, [])
})

test('the custom entry cannot be saved without an endpoint', () => {
  const { service } = makeService()

  for (const baseUrl of ['', '   ']) {
    assert.throws(() => service.saveProvider('custom', baseUrl, ''), error => {
      assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
      assert.equal(error.failure, 'invalid_request')
      return true
    }, 'custom with ' + JSON.stringify(baseUrl))
  }

  assert.deepEqual(service.readState().providers, [])
})

test('removing a provider deletes its configuration and its key', () => {
  const { service, credentials } = makeService()
  service.saveProvider('anthropic', '', '')
  service.saveCredential('anthropic', service.beginCredential('anthropic').nonce, KEY)
  assert.equal(credentials.describe(SCOPE, 'anthropic').ok, true)

  const state = service.removeProvider('anthropic')

  assert.deepEqual(state.providers, [])
  // The key goes with it. A secret kept behind an entry nobody can see is the
  // one outcome a Remove button must never produce.
  assert.deepEqual(credentials.describe(SCOPE, 'anthropic'), { ok: false, reason: 'not_found' })
})

test('a configuration outlives the service that wrote it', () => {
  const file = memoryFile()
  const first = makeService({ persistence: file })
  first.service.saveProvider('deepseek', '', 'deepseek-reasoner')

  assert.ok(file.writes > 0, 'nothing was written to the disk')
  const written = Object.values(JSON.parse(file.records)).flat()
  assert.deepEqual(written, [
    { presetId: 'deepseek', baseUrl: '', defaultModel: 'deepseek-reasoner' },
  ])

  /*
   * A restart is a new service over the same file. The configuration is not a
   * secret and is not filed with one, so it comes back with no credential: the
   * key was never on this side of the store.
   */
  const second = makeService({ persistence: file })
  const state = second.service.readState()

  assert.deepEqual(
    state.providers.map(provider => [provider.presetId, provider.defaultModel]),
    [['deepseek', 'deepseek-reasoner']],
  )
  assert.equal(state.providers[0].baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(state.providers[0].hasCredential, false)
})

test('a machine with no local server is two ordinary answers, not a failure', async () => {
  const refused = () => {
    throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1'), { code: 'ECONNREFUSED' })
  }
  const transport = transportBy({ [OLLAMA]: refused, [LMSTUDIO]: refused })
  const { service } = makeService({ transport })

  const found = await service.discoverLocal()

  assert.equal(found.candidates.length, 2)
  assert.deepEqual(found.candidates.map(candidate => candidate.presetId), ['ollama', 'lmstudio'])
  assert.deepEqual(found.candidates.map(candidate => candidate.reachable), [false, false])
  assert.deepEqual(found.candidates.map(candidate => candidate.failure), ['network', 'network'])
  assert.deepEqual(found.candidates.map(candidate => candidate.models), [[], []])

  // Both were asked, and neither carried a key: a default local port takes none,
  // and detection is built with a null credential on purpose.
  assert.equal(transport.calls.length, 2)
  for (const call of transport.calls) {
    assert.equal(call.init.method, 'GET')
    // Header names are compared in one case: looking for the exact spelling the
    // preset happens to use would pass just as well if a key were sent under
    // another one, which is the mistake this line is meant to catch.
    const names = Object.keys(call.init.headers).map(name => name.toLowerCase())
    assert.equal(names.includes('authorization'), false)
  }
})

test('a transport that cannot reach anything answers a failure instead of throwing', async () => {
  const transport = deadTransport()
  const { service } = makeService({ transport })
  service.saveProvider('anthropic', '', '')
  service.saveCredential('anthropic', service.beginCredential('anthropic').nonce, KEY)

  // The screen draws the failure token; an exception here would be an unhandled
  // rejection in the main process instead of a sentence on the page.
  assert.deepEqual(await service.testConnection('anthropic'), { ok: false, failure: 'network' })
  assert.equal(transport.calls.length, 1)
})

test('signing out forgets the live key, so the next call asks for one again', async () => {
  const transport = transportBy({ [ANTHROPIC]: response(200, ANTHROPIC_MODELS) })
  const { service } = makeService({ transport })
  service.saveProvider('anthropic', '', '')
  service.saveCredential('anthropic', service.beginCredential('anthropic').nonce, KEY)
  assert.deepEqual(await service.testConnection('anthropic'), {
    ok: true,
    modelCount: 1,
    cloud: true,
  })

  service.forgetAccount()

  await assert.rejects(() => service.listModels('anthropic'), error => {
    assert.ok(error instanceof api.ProviderSettingsError, 'not a ProviderSettingsError')
    assert.equal(error.failure, 'missing_credential')
    return true
  })

  // Sign-out is not deletion: the row is still listed, without a key, so the
  // person is asked to type it again rather than to set the provider up again.
  const entry = entryFor(service.readState(), 'anthropic')
  assert.equal(entry.hasCredential, false)
  assert.equal(entry.fingerprint, null)

  // And nothing new was sent to learn it.
  assert.equal(transport.calls.length, 1)
})

/* ------------------------------------------------------------------ *
 * A reply that outlives the account that asked for it
 *
 * A provider takes seconds to answer. These tests hold that answer open, end
 * the account underneath it, and then release it, which is the only way to see
 * the question "does this reply still belong to anybody here".
 * ------------------------------------------------------------------ */

/** A configured, keyed provider whose requests the caller will hold open. */
function heldProvider (answer) {
  const transport = heldTransport(answer)
  const harness = makeService({ transport })
  harness.service.saveProvider('anthropic', '', '')
  harness.service.saveCredential(
    'anthropic',
    harness.service.beginCredential('anthropic').nonce,
    KEY,
  )
  return { transport, ...harness }
}

test('a model list that arrives after a sign-out is refused rather than returned', async () => {
  const { service, scopeRef, transport } = heldProvider(response(200, ANTHROPIC_MODELS))

  // Caught rather than awaited directly, so a refusal that lands before the
  // assertions is a value to inspect instead of an unhandled rejection.
  const pending = service.listModels('anthropic').catch(error => error)
  await transport.begun

  // The person signs out while the request is still on the wire.
  scopeRef.current = null
  service.forgetAccount()
  transport.release()

  const error = await pending
  assert.ok(error instanceof api.ProviderSettingsError, 'the list was returned instead of refused')
  assert.equal(error.failure, 'stale')
})

test('a model list that arrives after a different account signs in is refused', async () => {
  const { service, scopeRef, transport } = heldProvider(response(200, ANTHROPIC_MODELS))

  const pending = service.listModels('anthropic').catch(error => error)
  await transport.begun

  // A second person signs in on the same machine and shares the same keychain.
  scopeRef.current = OTHER_SCOPE
  service.forgetAccount()
  transport.release()

  const error = await pending
  assert.ok(error instanceof api.ProviderSettingsError, 'the list was returned instead of refused')
  assert.equal(error.failure, 'stale')

  // The list that arrived was the first person's, and the second person's state
  // does not carry it either.
  assert.deepEqual(service.readState().providers, [])
})

test('a connection test that outlives its account answers stale rather than a count', async () => {
  const { service, scopeRef, transport } = heldProvider(response(200, ANTHROPIC_MODELS))

  const pending = service.testConnection('anthropic').catch(error => error)
  await transport.begun

  scopeRef.current = null
  service.forgetAccount()
  transport.release()

  const error = await pending
  assert.ok(error instanceof api.ProviderSettingsError, 'a connection result was returned instead of a refusal')
  assert.equal(error.failure, 'stale')
})

test('local discovery that arrives after a sign-out is refused', async () => {
  const transport = heldTransport(response(200, { models: [], data: [] }))
  const { service, scopeRef } = makeService({ transport })

  const pending = service.discoverLocal().catch(error => error)
  await transport.begun

  scopeRef.current = null
  service.forgetAccount()
  transport.release()

  const error = await pending
  assert.ok(error instanceof api.ProviderSettingsError, 'the discovery result was returned instead of refused')
  assert.equal(error.failure, 'stale')
})

test('a reply that arrives while the same account is signed in is still returned', async () => {
  const { service, transport } = heldProvider(response(200, ANTHROPIC_MODELS))

  const pending = service.listModels('anthropic').catch(error => error)
  await transport.begun
  transport.release()

  // Nothing ended, so nothing is stale. Without this the check above could be an
  // always-refuse and every other test would still pass.
  const listed = await pending
  assert.equal(listed.presetId, 'anthropic')
  assert.equal(listed.models.length, 1)
})
