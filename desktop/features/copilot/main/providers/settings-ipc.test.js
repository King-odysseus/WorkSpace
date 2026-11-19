'use strict'

/*
 * The Models channel surface, tested through the bundle Electron actually loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven is the same
 * CommonJS the main process registers. Four rules, one group of tests each:
 *
 * - Only the contract's request channels exist, each registered once, and
 *   dispose() removes every one of them.
 * - A sender that is not a trusted local view is refused before its payload is
 *   read, and a request the schema refuses never reaches the service.
 * - A service refusal keeps its own token. Anything else becomes the fixed
 *   `internal_error` token, and neither a message nor a host crosses the bridge.
 * - A reply is validated before it leaves, so a service bug fails here instead
 *   of drawing a broken screen.
 *
 * One rule has no counterpart on the access channel and is tested on its own:
 * the secret handed to `saveCredential` crosses this layer byte for byte. A layer
 * that trimmed, encoded or reordered a key would store something other than the
 * key the person pasted.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const {
  registerProviderIpc,
  ProviderSettingsError,
  PROVIDER_CHANNELS,
  PROVIDER_REQUEST_CHANNELS,
} = api

/** A preset this build really has, so a valid request stays valid. */
const PRESET = 'openai'

/** A single-use pass, in the only alphabet the contract accepts. */
const NONCE = '0123456789abcdef0123456789abcdef'

/** Far enough ahead to be a positive integer, which is all the contract asks. */
const EXPIRES_AT = 1_800_000_000_000

/** A string that may appear nowhere outside the process boundary. */
const CANARY = 'sk-canary-7c41d9'

/**
 * What a trusted view's event looks like: the shell bridge marks it, and that
 * mark is the only thing the trusted-sender check reads.
 */
const TRUSTED_EVENT = Object.freeze({ sender: { id: 1 }, trusted: true })

/** Any other window. No mark means not trusted, which is the default answer. */
const UNTRUSTED_EVENT = Object.freeze({ sender: { id: 2 } })

/** One catalogue entry, shaped the way the service describes one. */
function catalogEntry () {
  return {
    id: PRESET,
    providerId: `openai-compatible:${PRESET}`,
    label: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4.1',
    requiresKey: true,
    local: false,
    needsBaseUrl: false,
  }
}

/**
 * Signed out: the catalogue is still listed, because it is this build's own data,
 * while every configured entry has gone with the account.
 */
function signedOutState () {
  return { version: 1, signedIn: false, catalog: [catalogEntry()], providers: [] }
}

/** Signed in with one entry whose key is stored. The state the screen draws. */
function configuredState () {
  return {
    version: 1,
    signedIn: true,
    catalog: [catalogEntry()],
    providers: [
      {
        presetId: PRESET,
        providerId: `openai-compatible:${PRESET}`,
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        defaultModel: 'gpt-4.1',
        local: false,
        requiresKey: true,
        hasCredential: true,
        fingerprint: 'cdef',
      },
    ],
  }
}

/**
 * A stand-in for Electron's ipcMain: handlers are stored so a test can call one
 * the way a renderer would, and every handle() and removeHandler() call is
 * recorded in order, since a Map alone would hide a channel registered twice and
 * a removal of a channel that was never there.
 */
function fakeIpcMain () {
  const handlers = new Map()
  const registered = []
  const removed = []
  return {
    handle (channel, listener) { registered.push(channel); handlers.set(channel, listener) },
    removeHandler (channel) { handlers.delete(channel); removed.push(channel) },
    handlerFor (channel) { return handlers.get(channel) },
    channels () { return [...handlers.keys()] },
    registrations () { return [...registered] },
    removals () { return [...removed] },
  }
}

/** The trusted-view registry: broadcasts are recorded, never sent anywhere. */
function fakeViews () {
  const sent = []
  return {
    sent,
    /*
     * The registry answers from the event's mark rather than from a flag set when
     * it was built, which is what makes an untrusted sender the ordinary case for
     * a window that never signed in.
     */
    isTrustedSender: event => event && event.trusted === true,
    broadcast (channel, payload) { sent.push({ channel, payload }) },
  }
}

/**
 * A service that answers validly by default and records what it was asked.
 *
 * Every answer is overridable so a test can make one method refuse, throw, or
 * return something the contract cannot draw, without a mocking library and
 * without either of those behaviours leaking into the next test.
 */
function fakeService (overrides = {}) {
  const calls = []

  const answers = {
    readState: () => configuredState(),
    saveProvider: () => configuredState(),
    removeProvider: () => signedOutState(),
    beginCredential: () => ({ nonce: NONCE, expiresAt: EXPIRES_AT }),
    saveCredential: () => ({ presetId: PRESET, fingerprint: 'cdef' }),
    testConnection: async () => ({ ok: true, modelCount: 2, cloud: true }),
    listModels: async () => ({ presetId: PRESET, cloud: true, models: [] }),
    discoverLocal: async () => ({ candidates: [] }),
    ...overrides,
  }

  return {
    calls,
    readState () {
      calls.push({ method: 'readState', args: [] })
      return answers.readState()
    },
    saveProvider (presetId, baseUrl, defaultModel) {
      calls.push({ method: 'saveProvider', args: [presetId, baseUrl, defaultModel] })
      return answers.saveProvider(presetId, baseUrl, defaultModel)
    },
    removeProvider (presetId) {
      calls.push({ method: 'removeProvider', args: [presetId] })
      return answers.removeProvider(presetId)
    },
    beginCredential (presetId) {
      calls.push({ method: 'beginCredential', args: [presetId] })
      return answers.beginCredential(presetId)
    },
    saveCredential (presetId, nonce, secret) {
      calls.push({ method: 'saveCredential', args: [presetId, nonce, secret] })
      return answers.saveCredential(presetId, nonce, secret)
    },
    /*
     * The three that are a network call in the real service are async here too,
     * so a test that makes one throw exercises the rejection path the handler's
     * await actually sees.
     */
    async testConnection (presetId) {
      calls.push({ method: 'testConnection', args: [presetId] })
      return await answers.testConnection(presetId)
    },
    async listModels (presetId) {
      calls.push({ method: 'listModels', args: [presetId] })
      return await answers.listModels(presetId)
    },
    async discoverLocal () {
      calls.push({ method: 'discoverLocal', args: [] })
      return await answers.discoverLocal()
    },
  }
}

/** Register the surface over the fakes, with a logger that keeps its messages. */
function harness ({ service = fakeService() } = {}) {
  const ipcMain = fakeIpcMain()
  const views = fakeViews()
  const warnings = []

  const bridge = registerProviderIpc({
    ipcMain,
    service,
    views,
    log: { warn: message => warnings.push(message) },
  })

  /** Call one registered handler the way a renderer's invoke would. */
  async function call (channel, request, event = TRUSTED_EVENT) {
    const handler = ipcMain.handlerFor(channel)
    assert.equal(typeof handler, 'function', `${channel} is registered`)
    return await handler(event, request)
  }

  return { ipcMain, views, service, bridge, warnings, call }
}

/** A well-formed request for every channel, built per call so nothing is shared. */
function validRequests () {
  return {
    [PROVIDER_CHANNELS.readState]: {},
    [PROVIDER_CHANNELS.saveProvider]: { presetId: PRESET, baseUrl: '', defaultModel: '' },
    [PROVIDER_CHANNELS.removeProvider]: { presetId: PRESET },
    [PROVIDER_CHANNELS.beginCredential]: { presetId: PRESET },
    [PROVIDER_CHANNELS.saveCredential]: { presetId: PRESET, nonce: NONCE, secret: CANARY },
    [PROVIDER_CHANNELS.testConnection]: { presetId: PRESET },
    [PROVIDER_CHANNELS.listModels]: { presetId: PRESET },
    [PROVIDER_CHANNELS.discoverLocal]: {},
  }
}

/** The calls a service recorded for one method. */
function callsFor (service, method) {
  return service.calls.filter(entry => entry.method === method)
}

/** The fixed refusal every failure path answers with. */
function refused (reason) {
  return { ok: false, reason }
}

test('every request channel is registered exactly once and the push channel is not', () => {
  const { ipcMain, bridge } = harness()

  const requestChannels = [...PROVIDER_REQUEST_CHANNELS]

  /*
   * The contract's request list is the source of truth, so every other channel
   * name is a push channel. A push channel registered as a handler would let a
   * page ask for something the main process is supposed to send unasked.
   */
  const pushChannels = Object.values(PROVIDER_CHANNELS)
    .filter(channel => !requestChannels.includes(channel))
  assert.deepEqual(pushChannels, [PROVIDER_CHANNELS.stateChanged])

  // Sorted deep equality fails on a duplicate, so this is "exactly once".
  assert.deepEqual(ipcMain.registrations().sort(), [...requestChannels].sort())
  assert.deepEqual(ipcMain.channels().sort(), [...requestChannels].sort())
  for (const channel of requestChannels) {
    assert.equal(typeof ipcMain.handlerFor(channel), 'function', `${channel} has a handler`)
  }

  // Nothing at all is registered on the push channel.
  assert.equal(ipcMain.registrations().includes(PROVIDER_CHANNELS.stateChanged), false)

  // One method to push, one to tear down: nothing that names a channel.
  assert.deepEqual(Object.keys(bridge).sort(), ['dispose', 'publishState'])
  assert.equal(Object.isFrozen(bridge), true)
})

test('an untrusted sender is refused before its request is looked at', async () => {
  const { service, call } = harness()
  const requests = validRequests()

  /*
   * Well-formed requests on purpose: the sender check comes first, so a refusal
   * that said `invalid_request` would be the wrong refusal for the right reason.
   * An unmarked event, an empty one and no event at all are all "not trusted".
   */
  for (const channel of PROVIDER_REQUEST_CHANNELS) {
    for (const event of [UNTRUSTED_EVENT, {}, null]) {
      const reply = await call(channel, requests[channel], event)
      assert.deepEqual(reply, refused('untrusted_sender'), channel)
    }
  }

  assert.deepEqual(service.calls, [], 'no part of the service was touched')
})

test('a malformed request is refused on every channel and never reaches the service', async () => {
  const { service, call } = harness()

  // A preset id is a name, not a path and not an address. The bound is there so
  // a stored entry cannot be made arbitrarily long either.
  const longPreset = 'a'.repeat(65)

  const bad = [
    // readState takes an empty object and nothing else, so an unknown key is a
    // rejection rather than something quietly stripped.
    { channel: PROVIDER_CHANNELS.readState, request: null, why: 'no body' },
    { channel: PROVIDER_CHANNELS.readState, request: 'state', why: 'a string' },
    { channel: PROVIDER_CHANNELS.readState, request: [], why: 'an array' },
    { channel: PROVIDER_CHANNELS.readState, request: { workspaceId: 4 }, why: 'an unknown field' },
    { channel: PROVIDER_CHANNELS.readState, request: { admin: true }, why: 'a claim about the caller' },

    // saveProvider names a preset and an endpoint. A missing field is a refusal,
    // not an empty string filled in for the caller.
    { channel: PROVIDER_CHANNELS.saveProvider, request: 'openai', why: 'a string' },
    { channel: PROVIDER_CHANNELS.saveProvider, request: { presetId: PRESET, baseUrl: '' }, why: 'a missing field' },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: PRESET, baseUrl: '', defaultModel: '', extra: 1 },
      why: 'an unknown field',
    },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: '../../etc', baseUrl: '', defaultModel: '' },
      why: 'a path as a preset id',
    },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: 'https://models.example.test', baseUrl: '', defaultModel: '' },
      why: 'an address as a preset id',
    },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: longPreset, baseUrl: '', defaultModel: '' },
      why: 'an over-long preset id',
    },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: PRESET, baseUrl: 'x'.repeat(501), defaultModel: '' },
      why: 'an over-long endpoint',
    },

    { channel: PROVIDER_CHANNELS.removeProvider, request: {}, why: 'no preset' },
    { channel: PROVIDER_CHANNELS.removeProvider, request: { presetId: '../../etc' }, why: 'a path as a preset id' },
    { channel: PROVIDER_CHANNELS.removeProvider, request: { presetId: PRESET, extra: 1 }, why: 'an unknown field' },

    { channel: PROVIDER_CHANNELS.beginCredential, request: 'openai', why: 'a string' },
    { channel: PROVIDER_CHANNELS.beginCredential, request: { presetId: longPreset }, why: 'an over-long preset id' },
    { channel: PROVIDER_CHANNELS.beginCredential, request: { presetId: '' }, why: 'an empty preset id' },
    { channel: PROVIDER_CHANNELS.beginCredential, request: { presetId: PRESET, scope: 2 }, why: 'an account' },

    /*
     * The pass is hex and nothing else. A nonce that is not hex is a nonce the
     * entry boundary would reject later, so it is refused here instead.
     */
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: PRESET, nonce: 'Z'.repeat(32), secret: CANARY },
      why: 'a non-hex nonce',
    },
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: PRESET, nonce: 'abc', secret: CANARY },
      why: 'a short nonce',
    },
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: PRESET, nonce: NONCE, secret: '' },
      why: 'an empty secret',
    },
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: PRESET, nonce: NONCE },
      why: 'no secret',
    },
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: PRESET, nonce: NONCE, secret: 'x'.repeat(4097) },
      why: 'an over-long secret',
    },

    { channel: PROVIDER_CHANNELS.testConnection, request: { presetId: PRESET, nonce: NONCE }, why: 'an unknown field' },
    { channel: PROVIDER_CHANNELS.testConnection, request: null, why: 'no body' },

    { channel: PROVIDER_CHANNELS.listModels, request: { presetId: PRESET, baseUrl: '' }, why: 'an unknown field' },
    { channel: PROVIDER_CHANNELS.listModels, request: { presetId: 7 }, why: 'a number as a preset id' },

    /*
     * Discovery decides its own addresses. A page that could pass a base URL
     * would be choosing where a request goes, which is the one thing this
     * channel exists to keep out of the renderer.
     */
    {
      channel: PROVIDER_CHANNELS.discoverLocal,
      request: { baseUrl: 'https://models.example.test' },
      why: 'an address',
    },
    { channel: PROVIDER_CHANNELS.discoverLocal, request: 42, why: 'a number' },
  ]

  for (const { channel, request, why } of bad) {
    assert.deepEqual(await call(channel, request), refused('invalid_request'), `${channel} refused ${why}`)
  }

  assert.deepEqual(service.calls, [], 'nothing was asked of the service')
})

test('a valid readState answers with the service state, as it arrives over the bridge', async () => {
  const { service, call } = harness()

  const reply = await call(PROVIDER_CHANNELS.readState, {})

  // The parsed shape, not the object the service holds. What a renderer receives
  // is JSON, so the round trip is what is compared.
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), { ok: true, value: configuredState() })
  assert.deepEqual(callsFor(service, 'readState'), [{ method: 'readState', args: [] }])
})

test('a service refusal keeps its own token and its sentence is not forwarded', async () => {
  const thrown = new ProviderSettingsError('missing_credential')
  const service = fakeService({
    testConnection: async () => { throw thrown },
  })
  const { call, warnings } = harness({ service })

  const reply = await call(PROVIDER_CHANNELS.testConnection, { presetId: PRESET })

  // The screen draws a missing key differently from a broken app, so a generic
  // token here would send the person looking for the wrong problem.
  assert.deepEqual(reply, refused('missing_credential'))
  assert.notDeepEqual(reply, refused('internal_error'))

  // The fixed sentence is for a developer reading a log, never the page.
  const text = JSON.stringify(reply)
  for (const forbidden of ['needs a key', thrown.message]) {
    assert.equal(text.includes(forbidden), false, `the reply does not carry "${forbidden}"`)
  }
  // The token is what is recorded, which is the only thing safe to write down.
  assert.ok(
    warnings.some(message => message.includes('missing_credential')),
    'the refusal is recorded by its token',
  )
})

test('a service that throws answers with a fixed token and leaks nothing', async () => {
  const service = fakeService({
    testConnection: async () => {
      throw new Error(`dial https://models.example.test/v1/models failed with ${CANARY}`)
    },
  })
  const { call, warnings } = harness({ service })

  const reply = await call(PROVIDER_CHANNELS.testConnection, { presetId: PRESET })

  assert.deepEqual(reply, refused('internal_error'))

  // The thrown text names a real host and a secret. Neither may cross the
  // process boundary, and the log line names only the error's type.
  const text = JSON.stringify(reply)
  for (const forbidden of [CANARY, 'models.example.test', 'dial']) {
    assert.equal(text.includes(forbidden), false, `the reply does not carry ${forbidden}`)
  }
  assert.equal(warnings.some(message => message.includes(CANARY)), false, 'nor does the log')
  // A log line that named the host would be the same leak in a different file.
  assert.equal(warnings.some(message => message.includes('models.example.test')), false)
})

test('a state the contract refuses is never answered as a success', async () => {
  /*
   * The service is the only thing that can produce a state this wrong, and a
   * renderer draws whatever it is handed. Validating here means a service bug is
   * a refusal on one call instead of a broken screen the person cannot leave.
   */
  const nextVersion = fakeService({ readState: () => ({ version: 2 }) })
  const noPresetId = fakeService({
    saveProvider: () => ({
      version: 1,
      signedIn: true,
      catalog: [catalogEntry()],
      providers: [{ providerId: `openai-compatible:${PRESET}` }],
    }),
  })

  const first = harness({ service: nextVersion })
  const reply = await first.call(PROVIDER_CHANNELS.readState, {})
  assert.deepEqual(reply, refused('internal_error'))
  assert.ok(
    first.warnings.some(message => message.includes('contract')),
    'the breach is reported',
  )

  const second = harness({ service: noPresetId })
  const broken = await second.call(PROVIDER_CHANNELS.saveProvider, {
    presetId: PRESET,
    baseUrl: '',
    defaultModel: '',
  })
  assert.deepEqual(broken, refused('internal_error'))
  // Every warning names the surface, so one log line cannot be mistaken for
  // another channel's.
  assert.ok(
    second.warnings.every(message => message.includes('zuricopilot providers:')),
    'every warning names the surface',
  )
})

test('publishState broadcasts the current state once on the push channel', () => {
  const { views, bridge, service, ipcMain } = harness()

  bridge.publishState()

  // Exactly one push, on the one channel a page may listen to, carrying what the
  // service holds rather than a state the bridge assembled itself.
  assert.deepEqual(views.sent, [{ channel: PROVIDER_CHANNELS.stateChanged, payload: configuredState() }])
  assert.equal(callsFor(service, 'readState').length, 1)

  /*
   * The destination is the shell bridge's trusted-view registry, and it is the
   * only way this module can send anything: there is no handler on the push
   * channel and no webContents list to reach a page that has no preload.
   */
  assert.deepEqual(views.sent.map(entry => entry.channel), [PROVIDER_CHANNELS.stateChanged])
  assert.equal(ipcMain.registrations().includes(PROVIDER_CHANNELS.stateChanged), false)
})

test('a secret is forwarded to the service unmodified', async () => {
  const { service, call, views } = harness()

  /*
   * A key pasted from a provider's page usually carries whitespace. Trimming it
   * here would store a different key than the one on the clipboard, and the
   * failure would arrive later as an unexplained refusal from the provider. The
   * store is the layer that decides what to trim, not this one.
   */
  const secret = ` ${CANARY}\n`
  const reply = await call(PROVIDER_CHANNELS.saveCredential, { presetId: PRESET, nonce: NONCE, secret })

  // The exact arguments: the preset, the pass and the key, byte for byte.
  assert.deepEqual(callsFor(service, 'saveCredential'), [
    { method: 'saveCredential', args: [PRESET, NONCE, secret] },
  ])

  // The reply is the fingerprint and the entry it belongs to, never the key.
  assert.deepEqual(reply, { ok: true, value: { presetId: PRESET, fingerprint: 'cdef' } })
  for (const text of [JSON.stringify(reply), JSON.stringify(views.sent)]) {
    assert.equal(text.includes(CANARY), false, 'the key does not come back')
  }
})

test('dispose removes every request channel handler', () => {
  const { ipcMain, bridge } = harness()

  bridge.dispose()

  // Every channel that could be asked, and no channel that could not.
  assert.deepEqual(ipcMain.removals().sort(), [...PROVIDER_REQUEST_CHANNELS].sort())
  assert.equal(ipcMain.removals().includes(PROVIDER_CHANNELS.stateChanged), false)
  assert.deepEqual(ipcMain.channels(), [])
  for (const channel of PROVIDER_REQUEST_CHANNELS) {
    assert.equal(ipcMain.handlerFor(channel), undefined, `${channel} is gone`)
  }
})

test('a reply that outlives its account crosses the bridge as stale, not as a list', async () => {
  /*
   * The one case that needs the real service behind this layer rather than a
   * stand-in. The refusal is decided after the provider answers, and what the page
   * must receive is that refusal. A fake service could only prove this layer
   * repeats a token it was handed, which the test above already covers.
   */
  const scopeRef = { current: { serverHost: 'zuri.example.test', userId: 7 } }

  /* Real store, real entry boundary, unencrypted keychain: the same arrangement
   * the service's own tests use, so nothing here is faked that could fail open. */
  const keychain = api.createKeychain({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: text => Buffer.from(text, 'utf8'),
      decryptString: bytes => bytes.toString('utf8'),
    },
  })
  const credentials = api.createCredentialStore({ keychain })
  const entry = api.createCredentialEntry({ store: credentials })

  let release
  let started
  const begun = new Promise(resolve => { started = resolve })
  const transport = {
    calls: [],
    async request (ctx, url, init) {
      transport.calls.push({ ctx, url, init })
      started()
      await new Promise(resolve => { release = resolve })
      return { status: 200, ok: true, text: async () => '', json: async () => ({ data: [] }) }
    },
  }

  const service = api.createProviderSettingsService({
    transport,
    credentials,
    entry,
    scope: () => scopeRef.current,
    log: { warn: () => {} },
  })
  service.saveProvider(PRESET, '', '')
  service.saveCredential(PRESET, service.beginCredential(PRESET).nonce, 'sk-test-0123456789abcdef')

  const { call } = harness({ service })
  const pending = call(PROVIDER_CHANNELS.listModels, { presetId: PRESET })
  await begun

  // The person signs out while the request is still on the wire.
  scopeRef.current = null
  service.forgetAccount()
  release()

  // Nothing about the request that finished is repeated back to the page.
  assert.deepEqual(await pending, { ok: false, reason: 'stale' })
})
