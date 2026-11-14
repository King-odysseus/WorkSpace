'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CONTRACT_VERSION,
  PROBE_CHANNEL,
  PROBE_RESULT_FIELDS,
  validateProbeRequest,
  sanitizeProbeResult,
  failedProbeResult,
  isSanitizedProbeResult,
} = require('./probe-contract.js')

const READ = Object.freeze({ action: 'read', confirmWrite: false })
const WRITE = Object.freeze({ action: 'write', confirmWrite: true })

test('the contract exposes one channel and two actions', () => {
  assert.equal(PROBE_CHANNEL, 'copilot:probe:run')
  assert.equal(CONTRACT_VERSION, 1)
})

test('a read request and a confirmed write request are accepted', () => {
  const read = validateProbeRequest({ action: 'read', confirmWrite: false })
  assert.deepEqual(read, { ok: true, value: { action: 'read', confirmWrite: false } })

  const write = validateProbeRequest({ action: 'write', confirmWrite: true })
  assert.deepEqual(write, { ok: true, value: { action: 'write', confirmWrite: true } })
})

test('a write is refused unless it was explicitly confirmed', () => {
  assert.equal(validateProbeRequest({ action: 'write', confirmWrite: false }).reason, 'write_not_confirmed')
  assert.equal(validateProbeRequest({ action: 'write' }).reason, 'invalid_confirm_write')
  assert.equal(validateProbeRequest({ action: 'write', confirmWrite: 'yes' }).reason, 'invalid_confirm_write')
})

test('anything that is not a plain object is refused', () => {
  for (const value of [null, undefined, 'read', 7, true, [], ['read'], () => {}, new Date(), new Map()]) {
    assert.deepEqual(validateProbeRequest(value), { ok: false, reason: 'not_a_plain_object' })
  }
  // An inherited property must not stand in for a supplied one.
  assert.equal(validateProbeRequest(Object.create({ action: 'read' })).reason, 'not_a_plain_object')
})

test('the request carries no URL, method, header, body or workspace id', () => {
  // The whole point of the contract: a renderer cannot reach an endpoint of its
  // choosing, so every one of these is rejected rather than ignored.
  const attempts = [
    { action: 'read', confirmWrite: false, url: 'https://example.invalid/api/workspaces/' },
    { action: 'read', confirmWrite: false, path: '/api/workspaces/' },
    { action: 'read', confirmWrite: false, method: 'DELETE' },
    { action: 'read', confirmWrite: false, headers: { cookie: 'sessionid=abc' } },
    { action: 'read', confirmWrite: false, body: '{}' },
    { action: 'read', confirmWrite: false, endpoint: 'workspaces' },
    { action: 'write', confirmWrite: true, workspaceId: 3 },
    { action: 'write', confirmWrite: true, title: 'unapproved task' },
    { action: 'read', confirmWrite: false, csrfToken: 'x' },
    { action: 'read', confirmWrite: false, extra: undefined },
  ]

  for (const attempt of attempts) {
    assert.deepEqual(validateProbeRequest(attempt), { ok: false, reason: 'unknown_key' })
  }
})

test('symbol keys are refused too', () => {
  const request = { action: 'read', confirmWrite: false, [Symbol('url')]: 'https://example.invalid' }
  assert.equal(validateProbeRequest(request).reason, 'unknown_key')
})

test('an unknown or non-string action is refused', () => {
  assert.equal(validateProbeRequest({ action: 'delete', confirmWrite: true }).reason, 'invalid_action')
  assert.equal(validateProbeRequest({ action: 'READ', confirmWrite: false }).reason, 'invalid_action')
  assert.equal(validateProbeRequest({ action: 1, confirmWrite: false }).reason, 'invalid_action')
  assert.equal(validateProbeRequest({ action: ['read'], confirmWrite: false }).reason, 'invalid_action')
})

test('an oversized request is refused', () => {
  // Padding is caught as an unknown key first, so pad through a huge value on a
  // known key to reach the size guard.
  const oversized = { action: 'read', confirmWrite: false, action_: 'x'.repeat(600) }
  assert.equal(validateProbeRequest(oversized).reason, 'unknown_key')

  const withHugeAction = { action: 'read' + 'x'.repeat(600), confirmWrite: false }
  assert.equal(validateProbeRequest(withHugeAction).reason, 'too_large')
})

test('a getter that throws is refused without leaking the error', () => {
  const hostile = {
    action: 'read',
    get confirmWrite () { throw new Error('sessionid=secret') },
  }
  const result = validateProbeRequest(hostile)
  assert.deepEqual(result, { ok: false, reason: 'not_a_plain_object' })
})

test('a validated request is a frozen copy, so later mutation cannot reach the probe', () => {
  const input = { action: 'read', confirmWrite: false }
  const result = validateProbeRequest(input)
  assert.ok(Object.isFrozen(result.value))
  input.action = 'write'
  input.confirmWrite = true
  assert.equal(result.value.action, 'read')
  assert.equal(result.value.confirmWrite, false)
})

test('a sanitized result is rebuilt from the allowlist and drops everything else', () => {
  const internal = {
    action: 'write',
    status: 'ok',
    httpStatus: 201,
    cleanupHttpStatus: 204,
    durationMs: 143.6,
    checkedAt: '2026-11-14T10:11:12.000Z',
    workspaceCount: 1,
    workspaceId: 42,
    taskCreated: true,
    taskDeleted: true,
    // Everything below must not survive.
    cookie: 'sessionid=abc',
    csrfToken: 'csrf-secret',
    email: 'probe@example.invalid',
    password: 'uuid-value',
    requestHeaders: { origin: 'http://127.0.0.1:5183' },
    responseBody: '{"detail":"..."}',
  }

  const result = sanitizeProbeResult(internal)

  assert.deepEqual(Object.keys(result), [...PROBE_RESULT_FIELDS])
  assert.equal(result.status, 'ok')
  assert.equal(result.errorCode, null)
  assert.equal(result.httpStatus, 201)
  assert.equal(result.cleanupHttpStatus, 204)
  assert.equal(result.durationMs, 144)
  assert.equal(result.workspaceCount, 1)
  assert.equal(result.workspaceId, 42)
  assert.equal(result.taskCreated, true)
  assert.equal(result.taskDeleted, true)
  assert.ok(Object.isFrozen(result))

  const flat = JSON.stringify(result)
  for (const leak of ['sessionid', 'csrf-secret', 'probe@example.invalid', 'uuid-value', 'responseBody', 'requestHeaders']) {
    assert.equal(flat.includes(leak), false, `result leaked ${leak}`)
  }
  assert.ok(isSanitizedProbeResult(result))
})

test('a sanitized result never carries a message, only a code from the fixed list', () => {
  const result = sanitizeProbeResult({
    action: 'read',
    status: 'failed',
    errorCode: 'provider_unauthorized: key sk-live-abc rejected',
    message: 'The key was rejected',
  })
  assert.equal(result.errorCode, 'unknown')
  assert.deepEqual(Object.keys(result).includes('message'), false)
})

test('values of the wrong type become null instead of passing through', () => {
  const result = sanitizeProbeResult({
    action: 'read',
    status: 'ok',
    httpStatus: '200',
    cleanupHttpStatus: 2000,
    durationMs: -1,
    checkedAt: '14-11-26',
    workspaceCount: -4,
    workspaceId: 0,
    taskCreated: 'true',
    taskDeleted: 1,
  })
  assert.equal(result.httpStatus, null)
  assert.equal(result.cleanupHttpStatus, null)
  assert.equal(result.durationMs, null)
  assert.equal(result.checkedAt, null)
  assert.equal(result.workspaceCount, null)
  assert.equal(result.workspaceId, null)
  assert.equal(result.taskCreated, null)
  assert.equal(result.taskDeleted, null)
})

test('a non-ok status is reported as failed', () => {
  const result = sanitizeProbeResult({ action: 'read', status: 'partial', errorCode: 'network_error' })
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'network_error')
})

test('sanitizing a result with no valid action throws instead of guessing', () => {
  assert.throws(() => sanitizeProbeResult({ status: 'ok' }), TypeError)
  assert.throws(() => sanitizeProbeResult({ action: 'admin', status: 'ok' }), TypeError)
  assert.throws(() => sanitizeProbeResult(null), TypeError)
  assert.throws(() => sanitizeProbeResult('ok'), TypeError)
})

test('failedProbeResult builds a sanitized failure that passes the boundary check', () => {
  const result = failedProbeResult('read', 'not_signed_in')
  assert.equal(result.action, 'read')
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'not_signed_in')
  assert.ok(isSanitizedProbeResult(result))

  const withLeak = failedProbeResult('write', 'http_error', { cookie: 'sessionid=abc', email: 'a@b.c' })
  assert.equal(Object.hasOwn(withLeak, 'cookie'), false)
  assert.equal(Object.hasOwn(withLeak, 'email'), false)
  assert.ok(isSanitizedProbeResult(withLeak))
})

test('the boundary check rejects any extra field or free text', () => {
  const good = failedProbeResult('read', 'network_error')
  assert.ok(isSanitizedProbeResult(good))

  assert.equal(isSanitizedProbeResult({ ...good, note: 'anything' }), false)
  assert.equal(isSanitizedProbeResult({ ...good, contractVersion: 2 }), false)
  assert.equal(isSanitizedProbeResult({ ...good, action: 'delete' }), false)
  assert.equal(isSanitizedProbeResult({ ...good, errorCode: 'see response body' }), false)
  assert.equal(isSanitizedProbeResult({ ...good, checkedAt: 'yesterday' }), false)
  assert.equal(isSanitizedProbeResult({ ...good, httpStatus: 99 }), false)

  const { checkedAt, ...withoutCheckedAt } = good
  assert.equal(isSanitizedProbeResult(withoutCheckedAt), false)
  assert.ok(checkedAt)
})

test('an ok result cannot carry an error code across the boundary', () => {
  const readable = sanitizeProbeResult({ action: 'read', status: 'ok', workspaceCount: 2 })
  assert.ok(isSanitizedProbeResult(readable))
  assert.equal(isSanitizedProbeResult({ ...readable, errorCode: 'http_error' }), false)
})
