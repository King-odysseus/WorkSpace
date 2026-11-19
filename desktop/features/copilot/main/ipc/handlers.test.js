'use strict'

/*
 * The registration point, tested through the bundle Electron actually loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and the tests read that
 * file rather than the TypeScript source, so what is proven here is the same
 * CommonJS the main process requires.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const ipc = require('../../../../build/main/ipc.cjs')
const { isSanitizedProbeResult } = require('../../shared/probe-contract.js')

const { registerCopilotIpc, CHANNEL_NAMES, contractInfo, contractInfoResultSchema } = ipc

const PAGE = 'file:///opt/app/renderer/index.html'
const OTHER_PAGE = 'file:///opt/app/other/index.html'

/** Just enough of ipcMain to see which channels were registered. */
function fakeIpcMain () {
  const handlers = new Map()
  return {
    handle (channel, listener) { handlers.set(channel, listener) },
    removeHandler (channel) { handlers.delete(channel) },
    handlerFor (channel) { return handlers.get(channel) },
    channels () { return [...handlers.keys()] },
  }
}

/**
 * A fake IPC event. `parent` is null for the window's own frame and set for a
 * subframe, which is what `senderFrame.parent` means in Electron.
 */
function eventFrom ({ id = 7, url = PAGE, parent = null } = {}) {
  return { sender: { id }, senderFrame: { url, parent } }
}

/** A raw probe outcome: wider than the contract, so the bridge must narrow it. */
function outcome (action) {
  return {
    action,
    status: 'ok',
    errorCode: null,
    httpStatus: 200,
    cleanupHttpStatus: null,
    durationMs: 5,
    checkedAt: '2026-11-14T09:00:00.000Z',
    workspaceCount: 1,
    workspaceId: 7,
    taskCreated: null,
    taskDeleted: null,
  }
}

function harness ({ trust = true } = {}) {
  const ipcMain = fakeIpcMain()
  const calls = []
  const warnings = []

  const bridge = registerCopilotIpc({
    ipcMain,
    runProbe: async action => {
      calls.push(action)
      return outcome(action)
    },
    log: { warn: message => warnings.push(message) },
  })

  if (trust) bridge.trust(7, PAGE)

  return {
    bridge,
    ipcMain,
    calls,
    warnings,
    status: ipcMain.handlerFor('copilot:contract:info'),
    probe: ipcMain.handlerFor('copilot:probe:run'),
  }
}

test('registration registers exactly the two channels', () => {
  const { ipcMain, bridge } = harness()

  assert.deepEqual([...ipcMain.channels()].sort(), ['copilot:contract:info', 'copilot:probe:run'])
  assert.deepEqual(Object.keys(bridge).sort(), ['dispose', 'forget', 'isTrustedSender', 'trust'])
  // Frozen, so nothing wired later can swap a handler or hand out the trust map.
  assert.equal(Object.isFrozen(bridge), true)
})

test('it fails fast on an unusable ipcMain or runner', () => {
  const ipcMain = fakeIpcMain()

  assert.throws(() => registerCopilotIpc({}), TypeError)
  assert.throws(() => registerCopilotIpc({ ipcMain: { handle: 1 } }), TypeError)
  assert.throws(() => registerCopilotIpc({ ipcMain, runProbe: 'no' }), TypeError)
  // A refused registration must not leave half a surface registered.
  assert.deepEqual(ipcMain.channels(), [])
})

test('the status channel refuses an untrusted sender', async () => {
  const { status, warnings } = harness({ trust: false })

  assert.deepEqual(await status(eventFrom(), {}), { ok: false, reason: 'untrusted_sender' })
  assert.deepEqual(await status(eventFrom(), { url: 'https://evil.example' }), { ok: false, reason: 'untrusted_sender' })

  // Trust is checked before the request is read, so no payload reaches a log.
  assert.equal(warnings.length, 2)
  assert.equal(warnings.some(message => message.includes('evil.example')), false)
})

test('the status channel refuses a different frame, a subframe, another window and a dead sender', async () => {
  const { status } = harness()

  const refusals = [
    ['another document', eventFrom({ url: OTHER_PAGE })],
    ['a subframe', eventFrom({ parent: {} })],
    ['a second window', eventFrom({ id: 8 })],
    ['a sender whose frame is gone', { sender: { id: 7 } }],
    ['an event with no sender', { senderFrame: { url: PAGE, parent: null } }],
  ]

  for (const [label, event] of refusals) {
    assert.deepEqual(await status(event, {}), { ok: false, reason: 'untrusted_sender' }, label)
  }
})

test('the status channel answers a trusted sender with the contract value', async () => {
  const { status } = harness()

  const reply = await status(eventFrom(), {})

  assert.deepEqual(reply, { ok: true, value: { contractVersion: 1, channels: CHANNEL_NAMES } })
  assert.deepEqual(reply.value, contractInfo())
  // The handler parses its own reply, so this is also the shape it promised.
  assert.equal(contractInfoResultSchema.safeParse(reply).success, true)
})

test('the status channel rejects a payload it did not ask for', async () => {
  const { status } = harness()

  assert.equal((await status(eventFrom(), {})).ok, true)

  const refusals = [
    ['a smuggled url', { url: 'https://evil.example' }],
    ['a smuggled channel', { channel: 'copilot:probe:run' }],
    ['a string request', 'payload'],
    ['a null request', null],
    ['an undefined request', undefined],
  ]

  for (const [label, request] of refusals) {
    assert.deepEqual(await status(eventFrom(), request), { ok: false, reason: 'invalid_request' }, label)
  }
})

test('trust refuses a page that is not a local file', async () => {
  const { bridge, status } = harness({ trust: false })

  assert.throws(() => bridge.trust(7, 'https://evil.example'), TypeError)
  // The refused trust left no entry behind, so the window is still nobody.
  assert.deepEqual(await status(eventFrom(), {}), { ok: false, reason: 'untrusted_sender' })
  assert.throws(() => bridge.trust('seven', 'file:///x.html'), TypeError)
})

test('the probe channel answers through the same registration point', async () => {
  const { probe, calls } = harness()

  const result = await probe(eventFrom(), { action: 'read', confirmWrite: false })

  assert.equal(isSanitizedProbeResult(result), true)
  assert.equal(result.action, 'read')
  assert.equal(result.contractVersion, 1)
  assert.deepEqual(calls, ['read'])

  // probe-ipc.js refuses an unknown key with reason 'unknown_key' and answers
  // the uninformative null, so nothing about the smuggled URL comes back.
  const refused = await probe(eventFrom(), { action: 'read', confirmWrite: false, url: 'https://evil.example' })

  assert.equal(refused, null)
  assert.deepEqual(calls, ['read'])
})

test('dispose removes both channels and forgets trust', async () => {
  const { bridge, ipcMain, status } = harness()

  bridge.dispose()

  assert.deepEqual(ipcMain.channels(), [])
  assert.deepEqual(await status(eventFrom(), {}), { ok: false, reason: 'untrusted_sender' })
})

test('the handlers answer with an envelope instead of throwing', async () => {
  const { status } = harness()

  const cases = [
    ['an event that is not an event', {}, {}],
    ['a request whose getter throws', eventFrom(), { get action () { throw new Error('boom') } }],
    ['a sender with a non-integer id', { sender: { id: 'seven' }, senderFrame: { url: PAGE, parent: null } }, {}],
  ]

  for (const [label, event, request] of cases) {
    // Electron copies a thrown message into the renderer, so a refusal must be data.
    const reply = await status(event, request)
    assert.equal(reply.ok, false, label)
    assert.equal(contractInfoResultSchema.safeParse(reply).success, true, label)
  }
})
