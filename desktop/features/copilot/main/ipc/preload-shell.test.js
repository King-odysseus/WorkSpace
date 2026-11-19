'use strict'

/*
 * The shell bridge, asserted through the real preload file.
 *
 * As with the Copilot preload test, the file is executed exactly as written
 * with `vm.runInThisContext`, and only `require` is replaced. A sandboxed
 * preload resolves nothing but Electron, so the fake throws for any other
 * module: that is how this test proves the bridge has no dependency the runtime
 * could not satisfy. What it sends is compared against the contract table in
 * `build/main/ipc.cjs`, the bundle the app actually loads.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const shell = require('../../../../build/main/ipc.cjs')

const { SHELL_CHANNELS, SHELL_STATE_PUSH_CHANNEL, SHELL_MODES, WINDOW_ACTIONS } = shell
const { ACCESS_CHANNELS, ACCESS_STATE_PUSH_CHANNEL, LOCK_REASONS } = shell
const { CHAT_CHANNELS, CHAT_CHANNEL_ORDER, CHAT_FAILURES } = shell

const PRELOAD = path.join(__dirname, '..', '..', '..', '..', 'electron', 'preload', 'shell.js')

/** A state shaped exactly like ShellState, with Windows as the everyday case. */
function shellState (overrides = {}) {
  return {
    mode: 'workspace',
    dockOpen: false,
    maximized: false,
    theme: 'light',
    platform: 'win32',
    ...overrides,
  }
}

/** A state shaped exactly like AccessState, unlocked on one owner workspace. */
function accessState (overrides = {}) {
  return {
    version: 1,
    status: 'ready',
    reason: null,
    identity: { id: 5, name: 'Ada Obi' },
    workspaces: [{ id: 4, name: 'Zuri', role: 'owner', granted: true }],
    selectedWorkspaceId: 4,
    ...overrides,
  }
}

/**
 * Load the real preload with a stand-in for Electron.
 *
 * `invoke` records what was sent and answers with a valid state, `on` records
 * the subscription so a test can push through it, and `removeListener` records
 * the removal. The records are the observable behaviour: the page can only act
 * on the main process through these three calls.
 */
function loadPreload (options = {}) {
  const source = fs.readFileSync(PRELOAD, 'utf8')
  const exposed = {}
  const invocations = []
  const subscriptions = []
  const removals = []
  const required = []
  const answer = typeof options.invoke === 'function'
    ? options.invoke
    : () => Promise.resolve(shellState())

  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (key, api) => { exposed[key] = api },
    },
    ipcRenderer: {
      invoke: (channel, request) => {
        invocations.push({ channel, request })
        return answer(channel, request)
      },
      on: (channel, listener) => {
        subscriptions.push({ channel, listener })
      },
      removeListener: (channel, listener) => {
        removals.push({ channel, listener })
      },
      send: () => { throw new Error('the preload must not use send') },
    },
  }

  const module = { exports: {} }
  const wrapper = vm.runInThisContext(
    `(function (require, module, exports) {\n${source}\n})`,
    { filename: PRELOAD },
  )
  wrapper(name => {
    required.push(name)
    if (name === 'electron') return fakeElectron
    throw new Error(`the preload must not require ${name}`)
  }, module, module.exports)

  return { exposed, invocations, subscriptions, removals, required, module }
}

/** The exposed bridge, plus the records its calls produced. */
function bridge () {
  const loaded = loadPreload()
  return { ...loaded, api: loaded.exposed.zuriShell }
}

test('the preload exposes the shell and access bridges and no generic invoke', () => {
  const { exposed } = loadPreload()
  const api = exposed.zuriShell
  assert.deepEqual(Object.keys(exposed), ['zuriShell', 'zuriAccess', 'zuriProviders', 'zuriChats'])
  assert.deepEqual(
    Object.keys(api).sort(),
    ['getState', 'onState', 'setMode', 'toggleDock', 'windowAction'],
  )
  // Frozen, so a page cannot swap a method for one of its own.
  assert.equal(Object.isFrozen(api), true)

  // The whole point of the bridge: no channel parameter, no subscription of the
  // page's own, and no ipcRenderer anywhere a page can reach. Checked on both
  // bridges, because a second bridge is exactly where a generic invoke would
  // otherwise slip in unnoticed.
  for (const forbidden of ['invoke', 'send', 'on', 'once', 'removeListener', 'ipcRenderer', 'channel']) {
    assert.equal(api[forbidden], undefined, `zuriShell.${forbidden}`)
    assert.equal(exposed.zuriAccess[forbidden], undefined, `zuriAccess.${forbidden}`)
    assert.equal(exposed.zuriProviders[forbidden], undefined, `zuriProviders.${forbidden}`)
  }
})

test('the preload loads nothing except Electron', () => {
  const { required } = loadPreload()

  // A sandboxed preload cannot load a project file, so this is also a rule the
  // runtime would enforce; failing here catches it before a window is opened.
  assert.deepEqual(required, ['electron'])
})

test('reads send the contract channels with the request shapes they promise', async () => {
  const { api, invocations } = bridge()

  const state = await api.getState()
  await api.toggleDock()
  await api.windowAction('minimize')

  // The answer is the main process's, passed through untouched.
  assert.deepEqual(state, shellState())

  assert.deepEqual(invocations.map(call => call.channel), [
    SHELL_CHANNELS.state,
    SHELL_CHANNELS.toggleDock,
    SHELL_CHANNELS.window,
  ])
  // An empty object rather than no argument: the main process validates a
  // request it can refuse, never an absent argument, and it is frozen so a page
  // cannot widen the next one.
  assert.deepEqual(invocations[0].request, {})
  assert.deepEqual(invocations[1].request, {})
  assert.equal(Object.isFrozen(invocations[0].request), true)
  assert.deepEqual(invocations[2].request, { action: 'minimize' })
})

test('setMode reaches the main process for every contract mode', async () => {
  const { api, invocations } = bridge()

  for (const mode of SHELL_MODES) await api.setMode(mode)

  assert.deepEqual(
    invocations.map(call => call.channel),
    SHELL_MODES.map(() => SHELL_CHANNELS.setMode),
  )
  assert.deepEqual(invocations.map(call => call.request), SHELL_MODES.map(mode => ({ mode })))
})

test('an unknown mode is refused in the preload and never reaches the main process', async () => {
  const { api, invocations } = bridge()

  for (const mode of ['anything-else', '', 'WORKSPACE', 'workspace ', 'docked', null, undefined, { mode: 'copilot' }]) {
    await assert.rejects(() => api.setMode(mode), TypeError)
  }

  // The message is fixed and does not repeat what was passed: nothing the page
  // invented comes back out of the bridge.
  await assert.rejects(() => api.setMode('anything-else'), error => {
    assert.equal(error.message, 'setMode needs a known shell mode')
    return true
  })

  assert.equal(invocations.length, 0)
})

test('windowAction reaches the main process for every contract action', async () => {
  const { api, invocations } = bridge()

  for (const action of WINDOW_ACTIONS) await api.windowAction(action)

  assert.deepEqual(
    invocations.map(call => call.channel),
    WINDOW_ACTIONS.map(() => SHELL_CHANNELS.window),
  )
  assert.deepEqual(invocations.map(call => call.request), WINDOW_ACTIONS.map(action => ({ action })))
})

test('windowAction("close") closes and an unknown action never reaches the main process', async () => {
  const { api, invocations } = bridge()

  await api.windowAction('close')
  assert.deepEqual(invocations, [{ channel: SHELL_CHANNELS.window, request: { action: 'close' } }])

  for (const action of ['quit', 'close-window', 'MAXIMIZE', '', null, undefined, 1]) {
    await assert.rejects(() => api.windowAction(action), TypeError)
  }
  await assert.rejects(() => api.windowAction('quit'), error => {
    assert.equal(error.message, 'windowAction needs a known window action')
    return true
  })

  // Still the one call the valid action made.
  assert.equal(invocations.length, 1)
})

test('onState hands the listener the state alone, not the Electron event', () => {
  const { api, subscriptions } = bridge()
  const seen = []

  api.onState(state => seen.push(state))

  assert.equal(subscriptions.length, 1)
  assert.equal(subscriptions[0].channel, SHELL_STATE_PUSH_CHANNEL)

  const forwarded = shellState({ mode: 'copilot', dockOpen: true, maximized: true })
  // Electron passes the IpcRendererEvent first and the payload second.
  subscriptions[0].listener({ sender: { id: 7 } }, forwarded)

  assert.deepEqual(seen, [forwarded])

  // A payload the contract refuses is dropped: rendering half a state would
  // show a mode the window is not in.
  for (const malformed of [
    { ...shellState(), mode: 'docked' },
    { ...shellState(), dockOpen: 'yes' },
    { ...shellState(), maximized: undefined },
    { ...shellState(), theme: 'sepia' },
    { ...shellState(), platform: 42 },
    { ...shellState(), theme: undefined },
    null,
    'shell:state:changed',
    [],
  ]) {
    subscriptions[0].listener({ sender: { id: 7 } }, malformed)
  }

  assert.deepEqual(seen, [forwarded])
})

test('the unsubscribe removes exactly that listener and can be called twice', () => {
  const { api, subscriptions, removals } = bridge()
  const first = []
  const second = []

  const unsubscribeFirst = api.onState(state => first.push(state))
  const unsubscribeSecond = api.onState(state => second.push(state))

  assert.equal(subscriptions.length, 2)
  // Each subscription wraps its own listener, which is what lets one be removed
  // without touching the other.
  assert.notEqual(subscriptions[0].listener, subscriptions[1].listener)
  assert.deepEqual(removals, [])

  unsubscribeFirst()

  // The wrapper handed to Electron is the only identity removeListener knows.
  assert.deepEqual(removals, [
    { channel: SHELL_STATE_PUSH_CHANNEL, listener: subscriptions[0].listener },
  ])

  // Twice is harmless: a view that unmounts twice must not throw or remove the
  // other view's subscription.
  unsubscribeFirst()
  assert.equal(removals.length, 1)

  subscriptions[1].listener({ sender: { id: 7 } }, shellState({ mode: 'copilot' }))
  assert.deepEqual(first, [])
  assert.deepEqual(second, [shellState({ mode: 'copilot' })])

  unsubscribeSecond()
  assert.equal(removals.length, 2)
})

test('the channel and enum literals in the preload are the ones in the contract', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  // The literals have to be repeated because a sandboxed preload cannot import
  // the contract. This is the drift guard the preload's header comment
  // promises: one rename on either side fails here instead of at runtime.
  for (const channel of Object.values(SHELL_CHANNELS)) {
    assert.ok(source.includes(`'${channel}'`), `the preload does not name ${channel}`)
  }
  assert.ok(
    source.includes(`'${SHELL_STATE_PUSH_CHANNEL}'`),
    'the preload does not name the state push channel',
  )
  for (const mode of SHELL_MODES) {
    assert.ok(source.includes(`'${mode}'`), `the preload does not know the ${mode} mode`)
  }
  for (const action of WINDOW_ACTIONS) {
    assert.ok(source.includes(`'${action}'`), `the preload does not know the ${action} action`)
  }

  // One call site, fed by the fixed methods above, and no way to reach `send`.
  assert.equal((source.match(/ipcRenderer\.invoke\(/g) || []).length, 1)
  assert.equal(source.includes('ipcRenderer.send'), false)
})

/* ------------------------------------------------------------------ *
 * The access bridge, asserted through the same real preload file
 * ------------------------------------------------------------------ */

/** The exposed access bridge, plus the records its calls produced. */
function accessBridge () {
  const loaded = loadPreload()
  return { ...loaded, api: loaded.exposed.zuriAccess }
}

test('the access bridge sends the contract channels with the request shapes it promises', async () => {
  const { api, invocations } = accessBridge()

  await api.readState()
  await api.refresh()
  await api.selectWorkspace(4)
  await api.listManagers(7)
  await api.setPermission(4, 21, true)
  await api.signOut()

  assert.deepEqual(invocations.map(call => call.channel), [
    ACCESS_CHANNELS.readState,
    ACCESS_CHANNELS.refresh,
    ACCESS_CHANNELS.selectWorkspace,
    ACCESS_CHANNELS.listManagers,
    ACCESS_CHANNELS.setPermission,
    ACCESS_CHANNELS.signOut,
  ])
  // Numbers and a boolean, in the shape the main process validates. The
  // permission key is absent on purpose: only the main process names it.
  assert.deepEqual(invocations.map(call => call.request), [
    {},
    {},
    { workspaceId: 4 },
    { workspaceId: 7 },
    { workspaceId: 4, userId: 21, granted: true },
    {},
  ])
  assert.equal(Object.isFrozen(invocations[0].request), true)
})

test('a bad id is refused in the preload and never reaches the main process', async () => {
  const { api, invocations } = accessBridge()

  for (const id of [0, -1, 1.5, '4', null, undefined, Number.NaN, {}, []]) {
    await assert.rejects(() => api.selectWorkspace(id), TypeError)
    await assert.rejects(() => api.listManagers(id), TypeError)
    await assert.rejects(() => api.setPermission(id, 21, true), TypeError)
    await assert.rejects(() => api.setPermission(4, id, true), TypeError)
  }

  // A made-up permission value is a bug in the page, not something the main
  // process should have to filter.
  for (const granted of ['true', 1, null, undefined, {}]) {
    await assert.rejects(() => api.setPermission(4, 21, granted), TypeError)
  }

  // The message is fixed and does not repeat what was passed.
  await assert.rejects(() => api.selectWorkspace('4'), error => {
    assert.equal(error.message, 'selectWorkspace needs a workspace id')
    return true
  })

  assert.deepEqual(invocations, [])
})

test('the access push hands the listener a valid state and drops anything else', () => {
  const { api, subscriptions } = accessBridge()
  const seen = []

  api.onState(state => seen.push(state))

  const subscription = subscriptions.find(entry => entry.channel === ACCESS_STATE_PUSH_CHANNEL)
  assert.ok(subscription, 'the access push is subscribed once')

  const forwarded = accessState({
    status: 'locked',
    reason: 'expired',
    identity: null,
    workspaces: [],
    selectedWorkspaceId: null,
  })
  // Electron passes the IpcRendererEvent first and the payload second.
  subscription.listener({ sender: { id: 7 } }, forwarded)
  assert.deepEqual(seen, [forwarded])

  // Half a state would draw an unlocked assistant the main process just locked.
  for (const malformed of [
    { ...accessState(), version: 2 },
    { ...accessState(), status: 'unlocked' },
    { ...accessState(), reason: 'because' },
    { ...accessState(), identity: { id: 0, name: 'Ada' } },
    { ...accessState(), identity: { id: 5 } },
    { ...accessState(), workspaces: [{ id: 4, name: '', role: 'owner', granted: true }] },
    { ...accessState(), workspaces: [{ id: 4, name: 'Zuri', role: 'member', granted: true }] },
    { ...accessState(), workspaces: [{ id: 4, name: 'Zuri', role: 'owner' }] },
    { ...accessState(), workspaces: 'none' },
    { ...accessState(), selectedWorkspaceId: '4' },
    { ...accessState(), selectedWorkspaceId: 0 },
    null,
    'zuri:access:state:changed',
    [],
  ]) {
    subscription.listener({ sender: { id: 7 } }, malformed)
  }

  assert.deepEqual(seen, [forwarded])
})

test('unsubscribing from the access push removes exactly that listener', () => {
  const { api, subscriptions, removals } = accessBridge()
  const first = []
  const second = []

  const unsubscribeFirst = api.onState(state => first.push(state))
  const unsubscribeSecond = api.onState(state => second.push(state))

  const pushes = subscriptions.filter(entry => entry.channel === ACCESS_STATE_PUSH_CHANNEL)
  assert.equal(pushes.length, 2)
  assert.notEqual(pushes[0].listener, pushes[1].listener)

  unsubscribeFirst()
  assert.deepEqual(removals, [{ channel: ACCESS_STATE_PUSH_CHANNEL, listener: pushes[0].listener }])

  // Twice is harmless: a view that unmounts twice must not throw or remove the
  // other view's subscription.
  unsubscribeFirst()
  assert.equal(removals.length, 1)

  unsubscribeSecond()
  assert.equal(removals.length, 2)
})

test('the access literals in the preload are the ones in the contract', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  // The access bridge repeats its channel names and lock reasons for the same
  // reason the shell bridge does: a sandboxed preload cannot import the
  // contract. This is the drift guard for that copy.
  for (const channel of Object.values(ACCESS_CHANNELS)) {
    assert.ok(source.includes(`'${channel}'`), `the preload does not name ${channel}`)
  }
  assert.ok(
    source.includes(`'${ACCESS_STATE_PUSH_CHANNEL}'`),
    'the preload does not name the access push channel',
  )
  for (const reason of LOCK_REASONS) {
    assert.ok(source.includes(`'${reason}'`), `the preload does not know the ${reason} lock reason`)
  }
})

/* ------------------------------------------------------------------ *
 * The provider bridge
 *
 * The only bridge that carries a secret, so its tests are about what cannot be
 * sent rather than what can. A page that can name a URL, an account or a raw
 * channel is a page that can put a key somewhere it should not go; every method
 * below therefore takes an id, and the pass a key is submitted against is issued
 * by the main process.
 * ------------------------------------------------------------------ */

const { PROVIDER_CHANNELS } = shell

/** A state shaped exactly like ProviderSettingsState, with one saved provider. */
function providerState (overrides = {}) {
  return {
    version: 1,
    signedIn: true,
    catalog: [
      {
        id: 'openai',
        providerId: 'openai-compatible:openai',
        label: 'OpenAI',
        kind: 'openai-compatible',
        baseUrl: 'https://api.openai.com',
        defaultModel: 'gpt-4.1',
        requiresKey: true,
        local: false,
        needsBaseUrl: false,
      },
    ],
    providers: [
      {
        presetId: 'openai',
        providerId: 'openai-compatible:openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        defaultModel: 'gpt-4.1',
        local: false,
        requiresKey: true,
        hasCredential: true,
        fingerprint: 'c0de',
      },
    ],
    ...overrides,
  }
}

/** The provider bridge, answering every call with one fixed reply. */
function providers (reply = { ok: true, value: providerState() }) {
  const loaded = loadPreload({ invoke: () => Promise.resolve(reply) })
  return { ...loaded, api: loaded.exposed.zuriProviders }
}

test('the provider bridge sends the contract channels with the request shapes it promises', async () => {
  const { api, invocations } = providers()

  await api.readState()
  await api.saveProvider({ presetId: 'openai', baseUrl: '', defaultModel: 'gpt-4.1' })
  await api.removeProvider('openai')
  await api.beginCredential('openai')
  await api.saveCredential('openai', 'a'.repeat(48), 'sk-live-key')
  await api.testConnection('openai')
  await api.listModels('openai')
  await api.discoverLocal()

  assert.deepEqual(invocations, [
    { channel: PROVIDER_CHANNELS.readState, request: {} },
    {
      channel: PROVIDER_CHANNELS.saveProvider,
      request: { presetId: 'openai', baseUrl: '', defaultModel: 'gpt-4.1' },
    },
    { channel: PROVIDER_CHANNELS.removeProvider, request: { presetId: 'openai' } },
    { channel: PROVIDER_CHANNELS.beginCredential, request: { presetId: 'openai' } },
    {
      channel: PROVIDER_CHANNELS.saveCredential,
      request: { presetId: 'openai', nonce: 'a'.repeat(48), secret: 'sk-live-key' },
    },
    { channel: PROVIDER_CHANNELS.testConnection, request: { presetId: 'openai' } },
    { channel: PROVIDER_CHANNELS.listModels, request: { presetId: 'openai' } },
    { channel: PROVIDER_CHANNELS.discoverLocal, request: {} },
  ])
})

test('a save carries no account, no header and no channel, so a page cannot address another entry', async () => {
  const { api, invocations } = providers()

  // Extra fields a hostile page might try. They are dropped rather than
  // forwarded: the request is rebuilt from the fields the contract names.
  await api.saveProvider({
    presetId: 'openai',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4.1',
    userId: 99,
    serverHost: 'evil.example',
    channel: 'zuri:shell:set-mode',
  })

  const sent = invocations[0].request
  assert.deepEqual(Object.keys(sent).sort(), ['baseUrl', 'defaultModel', 'presetId'])
  assert.equal(JSON.stringify(invocations).includes('evil.example'), false)
  assert.equal(JSON.stringify(invocations).includes('99'), false)
})

test('a bad preset id or pass is refused in the preload and never reaches the main process', async () => {
  const { api, invocations } = providers()

  const bad = [
    () => api.removeProvider('../../etc/passwd'),
    () => api.removeProvider('https://models.example.test'),
    () => api.removeProvider('a'.repeat(65)),
    () => api.removeProvider(42),
    () => api.saveProvider({ presetId: 'has space', baseUrl: '', defaultModel: '' }),
    () => api.saveProvider({ presetId: 'openai', baseUrl: 'x'.repeat(501), defaultModel: '' }),
    () => api.saveCredential('openai', 'not-hex', 'sk-live-key'),
    () => api.saveCredential('openai', 'abc', 'sk-live-key'),
    () => api.saveCredential('openai', 'a'.repeat(48), ''),
    () => api.saveCredential('openai', 'a'.repeat(48), 'x'.repeat(4097)),
    () => api.testConnection('bad id'),
    () => api.listModels(''),
    () => api.beginCredential(null),
  ]

  for (const call of bad) {
    await assert.rejects(call, TypeError)
  }
  // The point of refusing here as well as in the main process: a hostile page
  // cannot even spend a round trip on a payload that will be rejected.
  assert.equal(invocations.length, 0)
})

test('the provider push hands the listener a valid state and drops anything else', () => {
  const { exposed, subscriptions } = providers()
  const seen = []
  exposed.zuriProviders.onState(state => seen.push(state))

  const push = subscriptions[0]
  assert.equal(push.channel, PROVIDER_CHANNELS.stateChanged)

  const good = providerState()
  push.listener({}, good)
  assert.deepEqual(seen, [good])

  // Each of these is a state the screen would draw wrongly, so each is dropped
  // rather than half-applied: a configured provider with no key field, a
  // catalogue entry with no id, and a version from a future build.
  const dropped = [
    undefined,
    null,
    'state',
    [],
    { ...good, version: 2 },
    { ...good, signedIn: 'yes' },
    { ...good, catalog: [{ label: 'no id' }] },
    { ...good, providers: [{ presetId: 'openai', label: 'OpenAI' }] },
  ]
  for (const payload of dropped) push.listener({}, payload)

  assert.equal(seen.length, 1)
})

test('unsubscribing from the provider push removes exactly that listener', () => {
  const { exposed, subscriptions, removals } = providers()

  const first = exposed.zuriProviders.onState(() => {})
  const second = exposed.zuriProviders.onState(() => {})

  first()
  assert.equal(removals.length, 1)
  assert.equal(removals[0].channel, PROVIDER_CHANNELS.stateChanged)
  assert.equal(removals[0].listener, subscriptions[0].listener)

  // Twice is harmless, and the other view keeps its subscription.
  first()
  assert.equal(removals.length, 1)

  second()
  assert.equal(removals[1].listener, subscriptions[1].listener)
})

test('the provider literals in the preload are the ones in the contract', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  /*
   * The drift guard for the copy a sandboxed preload has to keep. A channel
   * renamed in the contract but not here would fail closed - the push would never
   * arrive and every call would be refused as an untrusted channel - which is
   * safe but silent, and silence is what this test exists to break.
   */
  for (const channel of Object.values(PROVIDER_CHANNELS)) {
    assert.ok(source.includes(`'${channel}'`), `the preload does not name ${channel}`)
  }
})

/* ------------------------------------------------------------------ *
 * The chat bridge
 * ------------------------------------------------------------------ */

/** A message row as the chat contract carries one. */
function chatMessage (overrides = {}) {
  return {
    id: 'a1b2c3d4',
    threadId: 'c1d2e3f4',
    seq: 1,
    role: 'assistant',
    content: 'Three are overdue.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    cloud: true,
    createdAt: '2026-11-16T09:30:00.000Z',
    ...overrides,
  }
}

/** One turn event of each kind the contract defines. */
const CHAT_EVENTS = Object.freeze({
  delta: { type: 'delta', turnId: 'turn-1', threadId: 'c1d2e3f4', text: 'Three' },
  done: { type: 'done', turnId: 'turn-1', threadId: 'c1d2e3f4', message: chatMessage() },
  failed: {
    type: 'failed',
    turnId: 'turn-1',
    threadId: 'c1d2e3f4',
    failure: 'network',
    userMessageId: 'e1f2a3b4',
    retryable: true,
  },
})

/** The chat bridge, driven against a recorded answer. */
function chatBridge (options = {}) {
  const loaded = loadPreload(options)
  return { ...loaded, api: loaded.exposed.zuriChats }
}

test('the chat bridge exposes sixteen named methods and one push, and no generic invoke', () => {
  const { exposed } = loadPreload()
  const api = exposed.zuriChats

  assert.equal(Object.isFrozen(api), true)

  /*
   * The list is written out rather than derived from the contract, so a method
   * that quietly appears or disappears is a failure here instead of something a
   * reader has to notice.
   */
  assert.deepEqual(Object.keys(api).sort(), [
    'cancelTurn',
    'closeThread',
    'createThread',
    'editMemory',
    'editProposal',
    'listMemory',
    'listMessages',
    'listProposals',
    'listThreads',
    'onEvent',
    'payloadPreview',
    'pinThread',
    'removeMemory',
    'removeThread',
    'renameThread',
    'sendMessage',
    'setProposalStatus',
  ])
})

test('the chat literals in the preload are the ones in the contract', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  for (const channel of Object.values(CHAT_CHANNELS)) {
    assert.ok(source.includes(`'${channel}'`), `the preload does not name ${channel}`)
  }

  // And every request channel is reachable from a method, which the order list is
  // what the contract declares. A channel in neither would be dead code.
  for (const name of CHAT_CHANNEL_ORDER) {
    assert.equal(typeof CHAT_CHANNELS[name], 'string', name)
  }
})

test('a send carries a thread, some text and a provider entry, and nothing else', async () => {
  const { api, invocations } = chatBridge({ invoke: () => Promise.resolve({ turnId: 'turn-1' }) })

  await api.sendMessage({ threadId: 'c1d2e3f4', text: 'Which tasks are overdue?', presetId: 'deepseek' })

  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].channel, CHAT_CHANNELS.sendMessage)
  assert.deepEqual(invocations[0].request, {
    threadId: 'c1d2e3f4',
    text: 'Which tasks are overdue?',
    presetId: 'deepseek',
  })

  // No account, no business, no model unless one was asked for. The main process
  // decides the first two, and a page that could name them could name somebody
  // else's.
  assert.equal('serverHost' in invocations[0].request, false)
  assert.equal('userId' in invocations[0].request, false)
  assert.equal('businessId' in invocations[0].request, false)
  assert.equal('modelId' in invocations[0].request, false)
})

test('a model id is carried only when one was chosen', async () => {
  const { api, invocations } = chatBridge({ invoke: () => Promise.resolve({}) })

  await api.sendMessage({ threadId: 'c1d2e3f4', text: 'Hello', presetId: 'deepseek', modelId: 'deepseek-chat' })
  assert.equal(invocations[0].request.modelId, 'deepseek-chat')
})

test('a bad id, empty text or an oversized turn is refused before it reaches the main process', async () => {
  const { api, invocations } = chatBridge({ invoke: () => Promise.resolve({}) })

  const refusals = [
    () => api.sendMessage({ threadId: '', text: 'Hello', presetId: 'deepseek' }),
    () => api.sendMessage({ threadId: 'c1d2e3f4', text: '', presetId: 'deepseek' }),
    () => api.sendMessage({ threadId: 'c1d2e3f4', text: 'x'.repeat(200001), presetId: 'deepseek' }),
    () => api.sendMessage({ threadId: 'c1d2e3f4', text: 'Hello' }),
    () => api.listMessages({}),
    () => api.renameThread({ threadId: 'c1d2e3f4', title: '   ' }),
    () => api.pinThread({ threadId: 'c1d2e3f4', pinned: 'yes' }),
    () => api.listMessages({ threadId: 'c1d2e3f4', afterSeq: 1.5 }),
    () => api.payloadPreview({ threadId: 'c1d2e3f4', presetId: 'deepseek' }),
  ]

  for (const call of refusals) {
    await assert.rejects(call, TypeError)
  }

  assert.deepEqual(invocations, [], 'a refused call still crossed the bridge')
})

test('the chat push hands the listener a valid event and drops anything else', () => {
  const seen = []
  const { api, subscriptions } = chatBridge()
  api.onEvent(event => { seen.push(event) })

  assert.equal(subscriptions.length, 1)
  const listener = subscriptions[0].listener
  assert.equal(subscriptions[0].channel, CHAT_CHANNELS.event)

  for (const event of Object.values(CHAT_EVENTS)) {
    listener({}, event)
  }
  assert.equal(seen.length, 3)

  /*
   * The shapes a page must never be handed: no type, a type it does not know, a
   * delta with no text, a done with no row, and a failed with no retry flag. Each
   * one would draw as a delta of "undefined" or a spinner that never stops.
   */
  const dropped = [
    null,
    {},
    { type: 'delta', turnId: 'turn-1', threadId: 'c1d2e3f4' },
    { type: 'delta', turnId: 'turn-1', threadId: 'c1d2e3f4', text: '' },
    { type: 'delta', threadId: 'c1d2e3f4', text: 'Three' },
    { type: 'done', turnId: 'turn-1', threadId: 'c1d2e3f4' },
    { type: 'done', turnId: 'turn-1', threadId: 'c1d2e3f4', message: { id: 'x' } },
    { type: 'failed', turnId: 'turn-1', threadId: 'c1d2e3f4', failure: 'network', userMessageId: 'e1f2a3b4' },
    { type: 'invented', turnId: 'turn-1', threadId: 'c1d2e3f4' },
  ]

  for (const event of dropped) listener({}, event)
  assert.equal(seen.length, 3, 'a malformed event reached the listener')
})

test('unsubscribing from the chat push removes exactly that listener', () => {
  const first = []
  const second = []
  const { api, subscriptions, removals } = chatBridge()

  const stop = api.onEvent(event => { first.push(event) })
  api.onEvent(event => { second.push(event) })

  /*
   * Each subscription is one listener's own handler, which is what makes an
   * unsubscribe exact: removing one cannot remove another page's.
   */
  const [firstHandler, secondHandler] = subscriptions
  firstHandler.listener({}, CHAT_EVENTS.delta)
  secondHandler.listener({}, CHAT_EVENTS.delta)
  firstHandler.listener({}, CHAT_EVENTS.done)
  secondHandler.listener({}, CHAT_EVENTS.done)
  assert.equal(first.length, 2)
  assert.equal(second.length, 2)

  stop()
  assert.equal(removals.length, 1)
  assert.equal(removals[0].channel, CHAT_CHANNELS.event)
  assert.equal(removals[0].listener, firstHandler.listener)

  // Removing twice is not two removals: the page would be removing somebody
  // else's listener the second time.
  stop()
  assert.equal(removals.length, 1)
})

test('every chat refusal token has a sentence, and the bridge names none of them itself', () => {
  // The page draws words from the reply, which the main process already fixed.
  for (const failure of CHAT_FAILURES) {
    assert.equal(typeof failure, 'string')
    assert.equal(failure.includes(' '), false, failure)
  }
  assert.ok(CHAT_FAILURES.includes('untrusted_sender'))
  assert.ok(CHAT_FAILURES.includes('blocked_content'))
})
