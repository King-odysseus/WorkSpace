'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PROBE_CHANNEL,
  PROBE_RESULT_FIELDS,
  isSanitizedProbeResult,
} = require('../../shared/probe-contract.js')
const {
  REFUSAL_ALREADY_RUNNING,
  REFUSAL_UNTRUSTED_SENDER,
  isSameFilePage,
  registerProbeIpc,
} = require('./probe-ipc.js')
const { debugPageUrl } = require('../../../../electron/debug-window.js')

const PAGE = debugPageUrl()
const OTHER_PAGE = 'file:///C:/somewhere-else/debug.html'

/** Just enough of ipcMain to see which channels were registered. */
function fakeIpcMain () {
  const handlers = new Map()
  return {
    handle (channel, handler) { handlers.set(channel, handler) },
    removeHandler (channel) { handlers.delete(channel) },
    handlerFor (channel) { return handlers.get(channel) },
    channels () { return [...handlers.keys()] },
  }
}

/**
 * A fake IPC event. `parent` is null for the window's own frame and set for a
 * subframe, which is what `senderFrame.parent` means in Electron.
 */
function eventFrom ({ id = 1, url = PAGE, parent = null } = {}) {
  return { sender: { id }, senderFrame: { url, parent } }
}

function readRequest (overrides = {}) {
  return { action: 'read', confirmWrite: false, ...overrides }
}

function writeRequest (overrides = {}) {
  return { action: 'write', confirmWrite: true, ...overrides }
}

function outcome (action) {
  const write = action === 'write'
  return {
    action,
    status: 'ok',
    errorCode: null,
    httpStatus: write ? 201 : 200,
    cleanupHttpStatus: write ? 200 : null,
    durationMs: 5,
    checkedAt: '2026-11-14T09:00:00.000Z',
    workspaceCount: 2,
    workspaceId: 7,
    taskCreated: write ? true : null,
    taskDeleted: write ? true : null,
  }
}

function harness (options = {}) {
  const ipcMain = fakeIpcMain()
  const calls = []
  const warnings = []
  const runProbe = options.runProbe || (async action => {
    calls.push(action)
    return outcome(action)
  })

  const bridge = registerProbeIpc({
    ipcMain,
    runProbe,
    log: { warn: message => warnings.push(message) },
  })

  const trustedId = options.trustedId === undefined ? 1 : options.trustedId
  if (options.trust !== false) bridge.trust(trustedId, PAGE)

  return { ipcMain, bridge, handler: ipcMain.handlerFor(PROBE_CHANNEL), calls, warnings }
}

test('registers the one contract channel and nothing else', () => {
  const { ipcMain } = harness()

  assert.deepEqual(ipcMain.channels(), [PROBE_CHANNEL])
})

test('a read from the trusted page runs once and comes back sanitized', async () => {
  const { handler, calls } = harness()

  const result = await handler(eventFrom(), readRequest())

  assert.ok(isSanitizedProbeResult(result))
  assert.deepEqual(Object.keys(result).sort(), [...PROBE_RESULT_FIELDS].sort())
  assert.equal(result.action, 'read')
  assert.equal(result.status, 'ok')
  assert.deepEqual(calls, ['read'])
})

test('a write from the trusted page runs once and carries the confirmation', async () => {
  const { handler, calls } = harness()

  const result = await handler(eventFrom(), writeRequest())

  assert.ok(isSanitizedProbeResult(result))
  assert.equal(result.taskCreated, true)
  assert.equal(result.taskDeleted, true)
  assert.deepEqual(calls, ['write'])
})

test('a sender that was never trusted is refused before the probe is touched', async () => {
  const { handler, calls, warnings } = harness({ trust: false })

  assert.equal(await handler(eventFrom(), readRequest()), null)
  assert.deepEqual(calls, [])
  assert.equal(warnings.length, 1)
  assert.ok(warnings[0].includes(REFUSAL_UNTRUSTED_SENDER))
})

test('a trusted window that navigated somewhere else is refused', async () => {
  const { handler, calls } = harness()

  for (const url of ['https://evil.example/probe', OTHER_PAGE, 'file:///C:/etc/passwd', 'about:blank', '']) {
    assert.equal(await handler(eventFrom({ url }), readRequest()), null, `refusing ${url}`)
  }
  assert.deepEqual(calls, [])
})

test('a subframe inside the trusted page is refused: only the view itself may ask', async () => {
  const { handler, calls } = harness()

  const subframe = eventFrom({ parent: { url: PAGE } })

  assert.equal(await handler(subframe, readRequest()), null)
  assert.deepEqual(calls, [])
})

test('a sender with no frame, or an unknown shape, is refused', async () => {
  const { handler, calls } = harness()

  assert.equal(await handler({ sender: { id: 1 } }, readRequest()), null)
  assert.equal(await handler({ sender: { id: 1 }, senderFrame: null }, readRequest()), null)
  assert.equal(await handler(null, readRequest()), null)
  assert.equal(await handler({}, readRequest()), null)
  assert.equal(await handler({ sender: { id: '1' }, senderFrame: { url: PAGE, parent: null } }, readRequest()), null)
  assert.deepEqual(calls, [])
})

test('a request carrying anything the contract does not name is refused, not partly honoured', async () => {
  const { handler, calls, warnings } = harness()

  const refused = [
    ['a smuggled URL', readRequest({ url: 'https://evil.example/api' })],
    ['a smuggled method', readRequest({ method: 'DELETE' })],
    ['a smuggled body', readRequest({ body: '{"title":"x"}' })],
    ['a smuggled workspace id', readRequest({ workspaceId: 99 })],
    ['an unknown action', { action: 'delete', confirmWrite: true }],
    ['a write without its confirmation', { action: 'write', confirmWrite: false }],
    ['a stringly typed confirmation', { action: 'write', confirmWrite: 'true' }],
    ['a missing confirmation', { action: 'read' }],
    ['a string request', 'read'],
    ['an array request', ['read']],
    ['a null request', null],
    ['an oversized request', readRequest({ padding: 'x'.repeat(4096) })],
  ]

  for (const [label, request] of refused) {
    assert.equal(await handler(eventFrom(), request), null, label)
  }
  assert.deepEqual(calls, [])
  // Every refusal is logged by reason, and the request itself is never echoed.
  assert.equal(warnings.length, refused.length)
  assert.equal(warnings.some(message => message.includes('evil.example')), false)
})

test('a probe that throws comes back as a fixed code, not as an error message', async () => {
  const { handler, warnings } = harness({
    runProbe: async () => {
      throw new Error('connect ECONNREFUSED https://workspace.example.test/api/auth/me/')
    },
  })

  const result = await handler(eventFrom(), readRequest())

  assert.ok(isSanitizedProbeResult(result))
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'unknown')
  const serialised = JSON.stringify(result)
  assert.equal(serialised.includes('ECONNREFUSED'), false)
  assert.equal(serialised.includes('workspace.example.test'), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].includes('ECONNREFUSED'), false)
})

test('a result wider than the contract is narrowed before it leaves', async () => {
  const { handler } = harness({
    runProbe: async action => ({
      ...outcome(action),
      // What a careless probe could hand over: session material and a raw body.
      cookie: 'sessionid=secret-value',
      csrfToken: 'csrf-secret-value',
      body: { email: 'person@example.test' },
    }),
  })

  const result = await handler(eventFrom(), readRequest())

  assert.ok(isSanitizedProbeResult(result))
  assert.deepEqual(Object.keys(result).sort(), [...PROBE_RESULT_FIELDS].sort())
  const serialised = JSON.stringify(result)
  for (const secret of ['sessionid', 'csrf', 'person@example.test', 'cookie', 'body']) {
    assert.equal(serialised.includes(secret), false, `leaked ${secret}`)
  }
})

test('a result the sanitizer cannot read is answered with a sanitized failure', async () => {
  const cases = [
    ['not an object', 'ok'],
    ['no action', { status: 'ok' }],
    ['an unknown action', { action: 'delete', status: 'ok' }],
    ['null', null],
  ]

  for (const [label, value] of cases) {
    const { handler } = harness({ runProbe: async () => value })
    const result = await handler(eventFrom(), readRequest())

    assert.ok(isSanitizedProbeResult(result), label)
    assert.equal(result.status, 'failed', label)
    assert.equal(result.errorCode, 'unknown', label)
  }
})

test('a second request is refused while one is running', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const calls = []
  const { handler, warnings } = harness({
    runProbe: async action => {
      calls.push(action)
      await gate
      return outcome(action)
    },
  })

  const first = handler(eventFrom(), readRequest())
  const second = await handler(eventFrom(), writeRequest())

  assert.equal(second, null)
  release()
  assert.ok(isSanitizedProbeResult(await first))
  assert.deepEqual(calls, ['read'])
  assert.ok(warnings.some(message => message.includes(REFUSAL_ALREADY_RUNNING)))
})

test('trust is refused for anything that is not a local file', () => {
  const { bridge } = harness({ trust: false })

  for (const url of ['https://workspace.example.test/probe', 'http://localhost:5183/', 'not a url', '']) {
    assert.throws(() => bridge.trust(1, url), TypeError, `refusing ${url}`)
  }
  assert.throws(() => bridge.trust(null, PAGE), TypeError)
  assert.throws(() => bridge.trust({}, PAGE), TypeError)
})

test('forgetting a window or disposing removes its access', async () => {
  const { bridge, handler, ipcMain, calls } = harness()

  assert.ok(bridge.isTrustedSender(eventFrom()))
  bridge.forget(1)
  assert.equal(bridge.isTrustedSender(eventFrom()), false)
  assert.equal(await handler(eventFrom(), readRequest()), null)
  assert.deepEqual(calls, [])

  bridge.trust(1, PAGE)
  bridge.dispose()
  assert.deepEqual(ipcMain.channels(), [])
  assert.equal(await handler(eventFrom(), readRequest()), null)
})

test('a registration without ipcMain or a runner is a programming error', () => {
  assert.throws(() => registerProbeIpc({ runProbe: async () => ({}) }), TypeError)
  assert.throws(() => registerProbeIpc({ ipcMain: fakeIpcMain() }), TypeError)
})

test('the page comparison is exact about the file and refuses anything not local', () => {
  assert.equal(isSameFilePage(PAGE, PAGE), true)
  // A query or fragment does not change which document this is.
  assert.equal(isSameFilePage(`${PAGE}?reload=1`, PAGE), true)
  assert.equal(isSameFilePage(PAGE.replace('debug.html', 'debug.html.bak'), PAGE), false)
  assert.equal(isSameFilePage(OTHER_PAGE, PAGE), false)
  assert.equal(isSameFilePage('https://example.test/debug.html', PAGE), false)
  assert.equal(isSameFilePage(PAGE, 'https://example.test/debug.html'), false)
  assert.equal(isSameFilePage('not a url', PAGE), false)
  assert.equal(isSameFilePage(undefined, PAGE), false)
})
