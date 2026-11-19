'use strict'

/*
 * The access channel surface, tested through the bundle Electron actually loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven is the same
 * CommonJS the main process registers. Four rules, one group of tests each:
 *
 * - Only the contract's channels exist, each registered once, and dispose()
 *   removes every one plus the controller subscription.
 * - A sender that is not a trusted local view is refused before its payload is
 *   read, and a request the schema refuses never reaches the controller.
 * - An impossible reply, or a controller that throws, becomes the fixed
 *   `internal_error` token: no message, address or secret is forwarded.
 * - State moves one way only: the bridge pushes what the controller holds after
 *   validating it, and a disposed bridge stops pushing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const access = require('../../../../build/main/ipc.cjs')

const { registerAccessIpc, ACCESS_CHANNELS, ACCESS_STATE_PUSH_CHANNEL } = access

/** What an IPC event looks like here: the trusted-sender check is stubbed. */
const EVENT = Object.freeze({ sender: { id: 1 } })

/** A locked state: nobody signed in yet. */
function lockedState () {
  return {
    version: 1,
    status: 'locked',
    reason: 'signed_out',
    identity: null,
    workspaces: [],
    selectedWorkspaceId: null,
  }
}

/** A ready state: one owner, one workspace, already selected. */
function readyState () {
  return {
    version: 1,
    status: 'ready',
    reason: null,
    identity: { id: 1, name: 'Ada Obi' },
    workspaces: [{ id: 4, name: 'Zuri', role: 'owner', granted: true }],
    selectedWorkspaceId: 4,
  }
}

/**
 * A stand-in for Electron's ipcMain: handlers are stored so a test can call one
 * the way a renderer would, and every handle() call is recorded in order, since
 * a Map alone would hide a channel registered twice.
 */
function fakeIpcMain () {
  const handlers = new Map()
  const registered = []
  return {
    handle (channel, listener) { registered.push(channel); handlers.set(channel, listener) },
    removeHandler (channel) { handlers.delete(channel) },
    handlerFor (channel) { return handlers.get(channel) },
    channels () { return [...handlers.keys()] },
    registrations () { return [...registered] },
  }
}

/** The trusted-view registry: broadcasts are recorded, never sent anywhere. */
function fakeViews ({ trusted = true } = {}) {
  const sent = []
  return {
    sent,
    isTrustedSender: () => trusted,
    broadcast (channel, payload) { sent.push({ channel, payload }) },
  }
}

/**
 * A controller that answers validly by default and records what it was asked.
 *
 * `emit` delivers a transition the way the real store does: subscribe returns an
 * unsubscribe that removes the listener, so one removed by dispose() is never
 * called again. That is what makes the dispose assertion mean something.
 */
function fakeController (overrides = {}) {
  const calls = []
  const listeners = []
  const subscription = { unsubscribed: false }

  const answers = {
    getState: () => lockedState(),
    refresh: async () => ({ ok: true, value: readyState() }),
    selectWorkspace: async () => ({ ok: true, value: readyState() }),
    listManagers: async () => ({ ok: true, value: { workspaceId: 4, members: [] } }),
    setPermission: async () => ({ ok: true, value: { workspaceId: 4, userId: 9, granted: true } }),
    signOut: async () => ({ ok: true, value: lockedState() }),
    ...overrides,
  }

  const controller = {
    calls,
    listeners,
    subscription,
    subscribe (listener) {
      listeners.push(listener)
      return () => { subscription.unsubscribed = true }
    },
    getState () {
      calls.push({ method: 'getState', args: [] })
      return answers.getState()
    },
    emit () {
      if (subscription.unsubscribed) return
      for (const listener of listeners) listener()
    },
  }

  for (const method of ['refresh', 'selectWorkspace', 'listManagers', 'setPermission', 'signOut']) {
    controller[method] = (...args) => {
      calls.push({ method, args })
      return answers[method](...args)
    }
  }

  return controller
}

/** Register the surface over the fakes, with a logger that keeps its messages. */
function harness ({ trusted = true, controller } = {}) {
  const ipcMain = fakeIpcMain()
  const views = fakeViews({ trusted })
  const warnings = []
  const activeController = controller ?? fakeController()

  const bridge = registerAccessIpc({
    ipcMain,
    controller: activeController,
    views,
    log: { warn: message => warnings.push(message) },
  })

  return { ipcMain, views, controller: activeController, bridge, warnings }
}

/** Call one registered handler the way a renderer's invoke would. */
async function invoke (ipcMain, channel, request, event = EVENT) {
  const handler = ipcMain.handlerFor(channel)
  assert.equal(typeof handler, 'function', `${channel} is registered`)
  return handler(event, request)
}

/** The calls a controller recorded for one method. */
function callsFor (controller, method) {
  return controller.calls.filter(call => call.method === method)
}

/** The fixed refusal every failure path answers with. */
function refused (reason) {
  return { ok: false, reason }
}

test('every access channel is registered exactly once and dispose clears them all', () => {
  const { ipcMain, controller, bridge } = harness()

  const names = Object.values(ACCESS_CHANNELS)
  // Sorted deep equality fails on a duplicate, so this is "exactly once".
  assert.deepEqual(ipcMain.registrations().sort(), [...names].sort())
  assert.deepEqual(ipcMain.channels().sort(), [...names].sort())
  for (const channel of names) {
    assert.equal(typeof ipcMain.handlerFor(channel), 'function', `${channel} has a handler`)
  }

  // One method to push, one to tear down: nothing that names a channel.
  assert.deepEqual(Object.keys(bridge).sort(), ['dispose', 'publishState'])
  assert.equal(Object.isFrozen(bridge), true)
  assert.equal(controller.listeners.length, 1, 'the surface subscribes once')
  assert.equal(controller.subscription.unsubscribed, false)

  bridge.dispose()

  assert.deepEqual(ipcMain.channels(), [])
  assert.equal(controller.subscription.unsubscribed, true)
  for (const channel of names) {
    assert.equal(ipcMain.handlerFor(channel), undefined, `${channel} is gone`)
  }
})

test('an untrusted sender is refused before its request is looked at', async () => {
  const { ipcMain, controller } = harness({ trusted: false })

  // Malformed as well as untrusted: the sender check comes first, so the answer
  // must not be `invalid_request`.
  const reply = await invoke(ipcMain, ACCESS_CHANNELS.readState, { workspaceId: 4, admin: true })

  assert.deepEqual(reply, refused('untrusted_sender'))
  assert.deepEqual(controller.calls, [], 'no part of the controller was touched')
})

test('a malformed request is refused and never reaches the controller', async () => {
  const { ipcMain, controller } = harness()

  // One table for the three request shapes: an empty body, one workspace id,
  // and a permission. An unknown key is a rejection, not a silent strip.
  const bad = [
    { channel: ACCESS_CHANNELS.readState, request: null },
    { channel: ACCESS_CHANNELS.readState, request: 'state' },
    { channel: ACCESS_CHANNELS.readState, request: [] },
    { channel: ACCESS_CHANNELS.readState, request: { workspaceId: 4 } },
    { channel: ACCESS_CHANNELS.signOut, request: { admin: true } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: { workspaceId: 4, admin: true } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: { workspaceId: '4' } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: { workspaceId: 0 } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: { workspaceId: -4 } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: { workspaceId: 4.5 } },
    { channel: ACCESS_CHANNELS.selectWorkspace, request: {} },
    { channel: ACCESS_CHANNELS.listManagers, request: { workspaceIds: [4] } },
    { channel: ACCESS_CHANNELS.setPermission, request: { workspaceId: 4, userId: 9, granted: 'yes' } },
    { channel: ACCESS_CHANNELS.setPermission, request: { workspaceId: 4, userId: 9 } },
    { channel: ACCESS_CHANNELS.setPermission, request: { workspaceId: 4, userId: 9, granted: true, extra: 1 } },
  ]

  for (const { channel, request } of bad) {
    assert.deepEqual(await invoke(ipcMain, channel, request), refused('invalid_request'), channel)
  }

  assert.deepEqual(controller.calls, [], 'nothing was asked of the controller')
})

test('a well-formed request reaches the controller with the parsed values', async () => {
  const { ipcMain, controller } = harness()

  await invoke(ipcMain, ACCESS_CHANNELS.selectWorkspace, { workspaceId: 4 })
  await invoke(ipcMain, ACCESS_CHANNELS.listManagers, { workspaceId: 4 })
  await invoke(ipcMain, ACCESS_CHANNELS.setPermission, { workspaceId: 4, userId: 9, granted: true })

  // The ids arrive as arguments, not as the request object: the handler reads
  // the parsed fields, so the controller never sees the raw payload.
  assert.deepEqual(callsFor(controller, 'selectWorkspace'), [{ method: 'selectWorkspace', args: [4] }])
  assert.deepEqual(callsFor(controller, 'listManagers'), [{ method: 'listManagers', args: [4] }])
  assert.deepEqual(callsFor(controller, 'setPermission'), [{ method: 'setPermission', args: [4, 9, true] }])
})

test('a reply the contract refuses becomes internal_error', async () => {
  // The wrong status and no version: a state the renderer could not draw.
  const controller = fakeController({ refresh: async () => ({ ok: true, value: { status: 'nonsense' } }) })
  const { ipcMain, warnings } = harness({ controller })

  const reply = await invoke(ipcMain, ACCESS_CHANNELS.refresh, {})

  assert.deepEqual(reply, refused('internal_error'))
  // The breach is reported, never forwarded. The refusal path warns twice, once
  // for the contract breach and once for the token it answered with, so the
  // assertion is about the message rather than the count.
  assert.ok(warnings.some(message => message.includes('contract')), 'the breach is reported')
  assert.ok(
    warnings.every(message => message.includes('zuricopilot access:')),
    'every warning names the surface',
  )
})

test('a controller that throws answers with a fixed token and leaks nothing', async () => {
  const controller = fakeController({
    refresh: () => { throw new Error('boom https://workspace.example.com token=abc123') },
  })
  const { ipcMain, warnings } = harness({ controller })

  const reply = await invoke(ipcMain, ACCESS_CHANNELS.refresh, {})

  assert.deepEqual(reply, refused('internal_error'))
  // The thrown text names a real host and a secret. Neither may cross the
  // process boundary, and the log line names only the error's type.
  const text = JSON.stringify(reply)
  for (const forbidden of ['boom', 'https://', 'token=']) {
    assert.equal(text.includes(forbidden), false, `the reply does not carry ${forbidden}`)
  }
  assert.equal(warnings.some(message => message.includes('boom')), false, 'nor does the log')
})

test('a successful call passes the controller reply through unchanged', async () => {
  const controller = fakeController({ getState: () => readyState() })
  const { ipcMain } = harness({ controller })

  assert.deepEqual(await invoke(ipcMain, ACCESS_CHANNELS.readState, {}), { ok: true, value: readyState() })
  assert.deepEqual(await invoke(ipcMain, ACCESS_CHANNELS.refresh, {}), { ok: true, value: readyState() })
})

test('a refresh asked for by a page is never marked automatic', async () => {
  const { ipcMain, controller } = harness()

  await invoke(ipcMain, ACCESS_CHANNELS.refresh, {})

  // Automatic means "the main process asked by itself", and it is the one kind of
  // refresh that cannot clear a sign-out. A page must not be able to borrow that
  // rule, nor to switch it off by asking for an automatic read of its own.
  assert.deepEqual(callsFor(controller, 'refresh'), [{ method: 'refresh', args: [] }])
})

test('a sign-out the server refused is reported in the log and passed through', async () => {
  const controller = fakeController({ signOut: async () => ({ ok: false, reason: 'network' }) })
  const { ipcMain, warnings } = harness({ controller })

  const reply = await invoke(ipcMain, ACCESS_CHANNELS.signOut, {})

  // The panel that asked is replaced by the locked screen the moment the lock
  // lands, so the failure has nowhere to be shown. The token is the whole message
  // here: no address, no server text.
  assert.deepEqual(reply, refused('network'))
  assert.ok(
    warnings.some(message => message.includes('server call failed') && message.includes('network')),
    'the failure is recorded once',
  )
})

test('publishState broadcasts the current state on the push channel', () => {
  const { views, bridge } = harness()

  bridge.publishState()

  assert.deepEqual(views.sent, [{ channel: ACCESS_STATE_PUSH_CHANNEL, payload: lockedState() }])
})

test('a state the contract refuses is not broadcast', () => {
  const controller = fakeController({ getState: () => ({ ...lockedState(), status: 'nonsense' }) })
  const { views, bridge, warnings } = harness({ controller })

  bridge.publishState()

  assert.deepEqual(views.sent, [], 'nothing half-shaped reached a view')
  assert.equal(warnings.length, 1)
})

test('a controller transition pushes automatically and stops after dispose', () => {
  const { views, controller, bridge } = harness()

  // One transition, delivered the way the store delivers it.
  controller.emit()
  assert.deepEqual(views.sent, [{ channel: ACCESS_STATE_PUSH_CHANNEL, payload: lockedState() }])

  bridge.dispose()
  // The store removes the listener on unsubscribe, so a disposed surface hears
  // nothing more even if a transition is published afterwards.
  controller.emit()

  assert.equal(views.sent.length, 1, 'no push after dispose')
})
