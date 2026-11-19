'use strict'

/*
 * The IPC contract's own test. It loads the bundled main process, the same file
 * Electron requires, so what is tested is what ships, and it puts the typed
 * zod schemas next to the Phase 0 runtime validator they were written from.
 *
 * The question behind most of these tests is one: can a window name something
 * the main process never offered? Channels, request keys and reply keys are all
 * closed sets here, so the answer has to stay no.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  CHANNELS,
  CHANNEL_NAMES,
  CONTRACT_VERSION,
  PROBE_CHANNEL,
  PROBE_RESULT_FIELDS,
  contractInfo,
  contractInfoRequestSchema,
  contractInfoResultSchema,
  contractInfoValueSchema,
  probeRequestSchema,
  probeResultSchema,
} = require('../../../build/main/ipc.cjs')

const {
  validateProbeRequest,
  sanitizeProbeResult,
  isSanitizedProbeResult,
} = require('./probe-contract.js')

const PRELOAD = path.join(__dirname, '..', '..', '..', 'electron', 'preload', 'copilot.js')

test('the channel table is closed and publishes exactly two names', () => {
  // Names are what the rest of the surface is measured against, so they must be
  // the values of the one table, listed in table order.
  assert.deepEqual([...CHANNEL_NAMES], Object.values(CHANNELS))
  assert.deepEqual([...CHANNEL_NAMES], ['copilot:contract:info', 'copilot:probe:run'])

  // The probe channel is the Phase 0 constant itself, not a second copy of the
  // string, so a rename in one place cannot leave a handler unreachable.
  assert.equal(CHANNELS.probeRun, PROBE_CHANNEL)
  assert.equal(CHANNELS.probeRun, 'copilot:probe:run')

  // Frozen, so page code cannot extend the set of channels it was handed.
  assert.ok(Object.isFrozen(CHANNELS))
  assert.ok(Object.isFrozen(CHANNEL_NAMES))
})

test('every channel name is a namespaced token, never a URL', () => {
  for (const name of CHANNEL_NAMES) {
    assert.match(name, /^copilot:[a-z]+(:[a-z]+)*$/, `${name} is not a namespaced token`)
    // A renderer is handed these strings. A URL-shaped one would invite it to
    // treat a channel as a destination.
    for (const forbidden of ['http', '://', '..', ' ']) {
      assert.equal(name.includes(forbidden), false, `${name} contains ${forbidden}`)
    }
  }
})

test('a read and a confirmed write parse, an unconfirmed write does not', () => {
  assert.equal(probeRequestSchema.safeParse({ action: 'read', confirmWrite: false }).success, true)
  assert.equal(probeRequestSchema.safeParse({ action: 'write', confirmWrite: true }).success, true)
  // The confirmation is the only thing standing between a renderer and the one
  // write the probe performs, so it is never implicit.
  assert.equal(probeRequestSchema.safeParse({ action: 'write', confirmWrite: false }).success, false)
})

test('the request schema rejects unknown keys, wrong types and oversized input', () => {
  const rejected = [
    { action: 'read', confirmWrite: false, url: 'https://evil.example' },
    { action: 'read' },
    { action: 'delete', confirmWrite: true },
    { action: 'write', confirmWrite: 'yes' },
    null,
    [],
    'read',
    { action: 'read' + 'x'.repeat(600), confirmWrite: false },
  ]

  for (const value of rejected) {
    const label = value === null ? 'null' : JSON.stringify(value)
    assert.equal(probeRequestSchema.safeParse(value).success, false, `accepted ${label}`)
  }
})

test('the request schema and the Phase 0 validator agree on every case', () => {
  // This is the drift guard: the schema is the typed face of
  // validateProbeRequest, and the probe handler still runs the validator. If the
  // two ever disagree about what a request is, one of them is lying to a caller.
  const cases = [
    { action: 'read', confirmWrite: false },
    { action: 'write', confirmWrite: true },
    { action: 'write', confirmWrite: false },
    { action: 'read', confirmWrite: false, url: 'https://evil.example' },
    { action: 'read', confirmWrite: false, workspaceId: 3 },
    { action: 'read' },
    { action: 'delete', confirmWrite: true },
    { action: 1, confirmWrite: false },
    { action: 'write', confirmWrite: 'yes' },
    null,
    [],
    'read',
  ]

  for (const value of cases) {
    const label = value === null ? 'null' : JSON.stringify(value)
    assert.equal(
      probeRequestSchema.safeParse(value).success,
      validateProbeRequest(value).ok,
      `schema and validator disagree about ${label}`,
    )
  }
})

test('the result schema declares exactly the sanitizer fields, in order', () => {
  // Key order is part of the check because the sanitizer builds the object in
  // this order and a reader compares the two lists by eye.
  assert.deepEqual(Object.keys(probeResultSchema.shape), [...PROBE_RESULT_FIELDS])
})

test('the result schema accepts what the sanitizer builds and rejects a widened copy', () => {
  // durationMs arrives as 12.4 and the sanitizer rounds it to an integer, which
  // is the reason the schema can demand an int.
  const valid = sanitizeProbeResult({
    action: 'read',
    status: 'ok',
    httpStatus: 200,
    durationMs: 12.4,
    checkedAt: new Date().toISOString(),
    workspaceCount: 2,
  })

  assert.equal(probeResultSchema.safeParse(valid).success, true)
  assert.equal(isSanitizedProbeResult(valid), true)

  // A cookie smuggled onto a result is a rejection on both sides, not a strip.
  const withCookie = { ...valid, cookie: 'sessionid=abc' }
  assert.equal(probeResultSchema.safeParse(withCookie).success, false)
  assert.equal(isSanitizedProbeResult(withCookie), false)

  // Bounds and vocabulary the schema adds on top of a matching key set.
  assert.equal(probeResultSchema.safeParse({ ...valid, httpStatus: 99 }).success, false)
  assert.equal(probeResultSchema.safeParse({ ...valid, errorCode: 'boom' }).success, false)
})

test('the status call takes nothing and its reply is exact', () => {
  assert.equal(contractInfoRequestSchema.safeParse({}).success, true)

  const rejectedRequests = [
    { url: 'https://evil.example' },
    { channel: 'copilot:probe:run' },
    undefined,
    null,
    [],
  ]
  for (const value of rejectedRequests) {
    // An empty strict object: every one of these is a payload the call has no
    // field for, so it is refused rather than ignored.
    assert.equal(contractInfoRequestSchema.safeParse(value).success, false, `accepted ${JSON.stringify(value)}`)
  }

  assert.deepEqual(contractInfo(), {
    contractVersion: CONTRACT_VERSION,
    channels: ['copilot:contract:info', 'copilot:probe:run'],
  })
  assert.equal(contractInfoValueSchema.safeParse(contractInfo()).success, true)

  // The reply is an envelope so a refusal travels as data, and neither branch
  // may grow a field or invent a reason token.
  assert.equal(contractInfoResultSchema.safeParse({ ok: true, value: contractInfo(), extra: 1 }).success, false)
  assert.equal(contractInfoResultSchema.safeParse({ ok: false, reason: 'nope' }).success, false)
  assert.equal(contractInfoResultSchema.safeParse({ ok: false, reason: 'untrusted_sender' }).success, true)
})

test('the sandboxed preload repeats the same channel literals', () => {
  const source = fs.readFileSync(PRELOAD, 'utf8')

  // A sandboxed preload cannot import a project file, so the channel strings
  // live in the preload as literals. This is the drift check that keeps the
  // repeated copies equal to the table the main process registers.
  for (const name of CHANNEL_NAMES) {
    assert.ok(source.includes(`'${name}'`), `the preload does not name ${name}`)
  }
})
