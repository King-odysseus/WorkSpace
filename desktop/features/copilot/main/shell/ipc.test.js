'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const shell = require('../../../../build/main/ipc.cjs')

const CHROME_PAGE = 'file:///app/build/renderer/index.html#chrome'
const COPILOT_PAGE = 'file:///app/build/renderer/index.html#copilot'

/**
 * A stand-in for Electron's ipcMain: it records the handlers so the test can
 * call one the way a renderer would, and it records removals so the dispose test
 * can prove the channels are gone.
 */
function fakeIpcMain () {
  const handlers = new Map()
  const removed = []
  return {
    handlers,
    removed,
    handle (channel, listener) { handlers.set(channel, listener) },
    removeHandler (channel) {
      removed.push(channel)
      handlers.delete(channel)
    },
  }
}

function fakeContents (id) {
  return { id, sent: [], send (channel, payload) { this.sent.push({ channel, payload }) } }
}

function fakeEvent (contents, url, options = {}) {
  return {
    sender: contents,
    senderFrame: options.noFrame ? null : { url, parent: options.subframe ? {} : null },
  }
}

function state (overrides = {}) {
  return { mode: 'workspace', dockOpen: false, maximized: false, theme: 'light', platform: 'win32', ...overrides }
}

/** A bridge whose actions record what they were asked to do. */
function registered () {
  const ipcMain = fakeIpcMain()
  const calls = []
  const current = state()
  const bridge = shell.registerShellIpc({
    ipcMain,
    log: { warn: () => {} },
    actions: {
      getState: () => { calls.push('getState'); return current },
      setMode: mode => { calls.push(`setMode:${mode}`); return state({ mode }) },
      toggleDock: () => { calls.push('toggleDock'); return state({ dockOpen: true }) },
      windowAction: action => { calls.push(`windowAction:${action}`); return state() },
    },
  })
  const chrome = fakeContents(1)
  const copilot = fakeContents(2)
  bridge.trust(chrome, CHROME_PAGE)
  bridge.trust(copilot, COPILOT_PAGE)
  return { ipcMain, bridge, calls, chrome, copilot }
}

function invoke (ipcMain, channel, event, request) {
  const handler = ipcMain.handlers.get(channel)
  assert.ok(handler, `${channel} is registered`)
  return handler(event, request)
}

test('every shell channel is registered, and nothing else', () => {
  const { ipcMain } = registered()
  assert.deepEqual([...ipcMain.handlers.keys()].sort(), Object.values(shell.SHELL_CHANNELS).sort())
})

test('an untrusted sender gets nothing and is not acted on', () => {
  const { ipcMain, calls, chrome } = registered()
  const stranger = fakeContents(99)

  const answer = invoke(ipcMain, shell.SHELL_CHANNELS.setMode, fakeEvent(stranger, CHROME_PAGE), { mode: 'copilot' })

  assert.equal(answer, null)
  assert.deepEqual(calls, [], 'no part of the shell moved')
  assert.equal(chrome.sent.length, 0)
})

test('a trusted window speaking from the wrong page is refused', () => {
  const { ipcMain, calls, chrome } = registered()

  // The chrome view registered #chrome, so a frame claiming #copilot is not it.
  const answer = invoke(ipcMain, shell.SHELL_CHANNELS.state, fakeEvent(chrome, COPILOT_PAGE), {})

  assert.equal(answer, null)
  assert.deepEqual(calls, [])
})

test('a subframe or a frame-less sender is refused', () => {
  const { ipcMain, calls, chrome } = registered()

  assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.state, fakeEvent(chrome, CHROME_PAGE, { subframe: true }), {}), null)
  assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.state, fakeEvent(chrome, CHROME_PAGE, { noFrame: true }), {}), null)
  assert.deepEqual(calls, [])
})

test('a trusted view can read the state and move the shell', () => {
  const { ipcMain, calls, chrome } = registered()

  assert.deepEqual(invoke(ipcMain, shell.SHELL_CHANNELS.state, fakeEvent(chrome, CHROME_PAGE), {}), state())
  assert.deepEqual(invoke(ipcMain, shell.SHELL_CHANNELS.setMode, fakeEvent(chrome, CHROME_PAGE), { mode: 'copilot' }),
    state({ mode: 'copilot' }))
  assert.deepEqual(invoke(ipcMain, shell.SHELL_CHANNELS.toggleDock, fakeEvent(chrome, CHROME_PAGE), {}),
    state({ dockOpen: true }))
  assert.deepEqual(invoke(ipcMain, shell.SHELL_CHANNELS.window, fakeEvent(chrome, CHROME_PAGE), { action: 'close' }), state())

  assert.deepEqual(calls, ['getState', 'setMode:copilot', 'toggleDock', 'windowAction:close'])
})

test('an invented mode or window action never reaches the actions', () => {
  const { ipcMain, calls, chrome } = registered()

  const bad = [
    { mode: 'browser' },
    { mode: 'workspace', extra: true },
    {},
    null,
    'workspace',
  ]
  for (const request of bad) {
    assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.setMode, fakeEvent(chrome, CHROME_PAGE), request), null)
  }
  for (const request of [{ action: 'quit' }, {}, null]) {
    assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.window, fakeEvent(chrome, CHROME_PAGE), request), null)
  }
  assert.deepEqual(calls, [])
})

test('one state is pushed to every trusted view and to nobody else', () => {
  const { bridge, chrome, copilot } = registered()
  const stranger = fakeContents(7)

  bridge.publish(state({ mode: 'copilot' }))

  assert.deepEqual(chrome.sent, [{ channel: shell.SHELL_STATE_PUSH_CHANNEL, payload: state({ mode: 'copilot' }) }])
  assert.deepEqual(copilot.sent, [{ channel: shell.SHELL_STATE_PUSH_CHANNEL, payload: state({ mode: 'copilot' }) }])
  assert.equal(stranger.sent.length, 0)
})

test('a state the contract refuses is not pushed', () => {
  const { bridge, chrome } = registered()

  bridge.publish({ mode: 'browser', dockOpen: false, maximized: false, theme: 'light', platform: 'win32' })

  assert.equal(chrome.sent.length, 0)
})

test('a view that is closing does not break the push', () => {
  const { bridge, chrome } = registered()
  chrome.send = () => { throw new Error('closed') }
  const other = fakeContents(3)
  bridge.trust(other, CHROME_PAGE)

  bridge.publish(state())

  assert.equal(other.sent.length, 1, 'the surviving view still hears it')
})

test('forgetting a view stops its pushes and its requests', () => {
  const { ipcMain, bridge, chrome } = registered()

  bridge.forget(chrome)
  bridge.publish(state())

  assert.equal(chrome.sent.length, 0)
  assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.state, fakeEvent(chrome, CHROME_PAGE), {}), null)
})

test('dispose removes every handler', () => {
  const { ipcMain, bridge } = registered()

  bridge.dispose()

  assert.deepEqual([...ipcMain.removed].sort(), Object.values(shell.SHELL_CHANNELS).sort())
  assert.equal(ipcMain.handlers.size, 0)
})

test('a shell page is a local file with the exact hash that was trusted', () => {
  assert.equal(shell.isSameShellPage(CHROME_PAGE, CHROME_PAGE), true)
  assert.equal(shell.isSameShellPage(COPILOT_PAGE, CHROME_PAGE), false, 'the hash is part of the identity')
  assert.equal(shell.isSameShellPage('https://example.test/app/index.html#chrome', CHROME_PAGE), false,
    'a network page is never the shell')
  assert.equal(shell.isSameShellPage('file:///app/build/renderer/other.html#chrome', CHROME_PAGE), false)
  assert.equal(shell.isSameShellPage('file:///app/build/renderer/index.html', CHROME_PAGE), false,
    'no hash is not the chrome')
  assert.equal(shell.isSameShellPage('not a url', CHROME_PAGE), false)
})

test('trust refuses a page that is not a local file, and a contents with no id', () => {
  const ipcMain = fakeIpcMain()
  const bridge = shell.registerShellIpc({
    ipcMain,
    log: { warn: () => {} },
    actions: {
      getState: () => state(),
      setMode: mode => state({ mode }),
      toggleDock: () => state(),
      windowAction: () => state(),
    },
  })

  assert.throws(() => bridge.trust(fakeContents(4), 'https://example.test/index.html#chrome'), /local files/)
  assert.throws(() => bridge.trust({ send () {} }, CHROME_PAGE), /webContents/)
})

test('an action that throws answers with a refusal instead of a stack', () => {
  const ipcMain = fakeIpcMain()
  const bridge = shell.registerShellIpc({
    ipcMain,
    log: { warn: () => {} },
    actions: {
      getState: () => state(),
      setMode: () => { throw new Error('window gone') },
      toggleDock: () => state(),
      windowAction: () => state(),
    },
  })
  const chrome = fakeContents(5)
  bridge.trust(chrome, CHROME_PAGE)

  assert.equal(invoke(ipcMain, shell.SHELL_CHANNELS.setMode, fakeEvent(chrome, CHROME_PAGE), { mode: 'copilot' }), null)
})
