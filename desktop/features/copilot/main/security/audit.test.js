'use strict'

/*
 * The egress audit trail, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * The acceptance criteria are about what a record refuses to contain, so most of
 * the tests are written around one canary string. The canary is planted wherever
 * a provider URL can carry a key - the query string, the path, the fragment and
 * the userinfo - and again in fields a caller might add by accident. If any of
 * them reaches a record, `JSON.stringify` on that record shows it, and the test
 * fails. That is the whole property: an audit line that stored the URL "for
 * context" would be a plaintext key store.
 *
 * The rest pins the behaviour the guard and the screen depend on: an allow-list
 * of fields (so an extra key is dropped, not copied), frozen records (a record
 * that can be edited is not evidence), a bounded trail (a long session cannot
 * grow without limit), and one log line for a blocked call that names the reason
 * and the provider but never the host.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** A value that must never appear in a record or in a log line. */
const CANARY = 'canary-7f31d0'

/** The only fields a record may have, sorted. */
const RECORD_FIELDS = [
  'at',
  'businessId',
  'cloud',
  'kind',
  'outcome',
  'providerId',
  'purpose',
  'reason',
  'redirects',
  'status',
  'target',
  'userId',
]

/** A complete input, so each test only states what it is about. */
function input (overrides = {}) {
  return {
    outcome: 'allowed',
    providerId: 'ollama',
    purpose: 'chat_strategy',
    userId: 7,
    businessId: 3,
    cloud: false,
    status: 200,
    redirects: 0,
    ...overrides,
  }
}

/** A logger that keeps every line, so a test can prove what was not written. */
function recordingLogger () {
  const lines = []
  return { lines, warn: message => lines.push(String(message)) }
}

/* ------------------------------------------------------------------ *
 * The published surface
 * ------------------------------------------------------------------ */

test('the bundle publishes the audit surface', () => {
  // The tests below load one bundle, so a missing export would fail as
  // "undefined is not a function" somewhere far from the cause.
  for (const name of [
    'AUDIT_OUTCOMES',
    'AUDIT_BLOCK_REASONS',
    'describeTarget',
    'createAuditRecord',
    'createAuditSink',
  ]) {
    assert.notEqual(
      api[name],
      undefined,
      `build/main/ipc.cjs does not export ${name}; ipc/index.ts needs to export '../security/audit.js'`,
    )
  }

  assert.deepEqual([...api.AUDIT_OUTCOMES], ['allowed', 'blocked', 'failed'])
  assert.deepEqual([...api.AUDIT_BLOCK_REASONS], [
    'local_only',
    'unredacted_content',
    'invalid_target',
    'cross_origin_redirect',
    'too_many_redirects',
    'unsafe_scheme',
  ])
})

/* ------------------------------------------------------------------ *
 * The canary tests: the reason this module exists
 * ------------------------------------------------------------------ */

test('a URL target is reduced to scheme, host and port and never carries the key', () => {
  const url = `https://user:${CANARY}@api.example.com:8443/v1/${CANARY}/chat?key=${CANARY}#${CANARY}`

  assert.deepEqual(api.describeTarget(url), {
    scheme: 'https',
    host: 'api.example.com',
    port: 8443,
  })

  const record = api.createAuditRecord(input({ target: url, cloud: true }))

  // Three keys and no more: there is nowhere for a path, a query, a fragment or
  // a userinfo to hide, because the stored type has no field for them.
  assert.deepEqual(Object.keys(record.target).sort(), ['host', 'port', 'scheme'])
  assert.deepEqual(record.target, { scheme: 'https', host: 'api.example.com', port: 8443 })

  const stored = JSON.stringify(record)
  assert.equal(stored.includes(CANARY), false)
  // The key would arrive as `?key=` or `user:`, so both spellings are checked.
  assert.equal(stored.includes('key='), false)
  assert.equal(stored.includes('user:'), false)
})

test('a record is built from an allow-list, so extra fields never reach it', () => {
  const record = api.createAuditRecord({
    ...input({ target: `https://api.example.com/v1/chat?key=${CANARY}` }),
    secret: CANARY,
    apiKey: `sk-${CANARY}`,
    body: JSON.stringify({ message: CANARY }),
    headers: { authorization: `Bearer ${CANARY}` },
  })

  assert.deepEqual(Object.keys(record).sort(), RECORD_FIELDS)
  assert.equal(JSON.stringify(record).includes(CANARY), false)

  // A target handed over as an object is filtered the same way: only the three
  // fields survive, and anything smuggled alongside them is dropped.
  const described = api.createAuditRecord(input({
    target: {
      scheme: 'https',
      host: 'api.example.com',
      port: null,
      query: `?key=${CANARY}`,
      path: `/${CANARY}`,
      userinfo: `user:${CANARY}`,
    },
  }))

  assert.deepEqual(described.target, { scheme: 'https', host: 'api.example.com', port: null })
  assert.equal(JSON.stringify(described).includes(CANARY), false)
})

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

test('describeTarget accepts a URL object as well as a string, and invents no port', () => {
  assert.deepEqual(api.describeTarget(new URL('https://API.Example.COM:8443/x?y=1')), {
    scheme: 'https',
    host: 'api.example.com',
    port: 8443,
  })

  // An explicit default port is dropped by the parser, so it stays null: a
  // record that said 443 would be describing a destination the app never dialled.
  assert.deepEqual(api.describeTarget('https://api.example.com:443/x'), {
    scheme: 'https',
    host: 'api.example.com',
    port: null,
  })

  // The local case the guard exists for: a person's own Ollama.
  assert.deepEqual(api.describeTarget('http://127.0.0.1:11434/api/tags'), {
    scheme: 'http',
    host: '127.0.0.1',
    port: 11434,
  })

  assert.equal(api.describeTarget('https://api.example.com/v1/chat').port, null)
})

test('describeTarget refuses every scheme that is not http or https, and every non-URL', () => {
  for (const value of [
    'ftp://files.example.com/x',
    'file:///c:/x.txt',
    'data:text/plain,hi',
    'ws://api.example.com/socket',
    'javascript:alert(1)',
    '',
    'not a url at all',
    '/v1/chat',
    'api.example.com:8443',
  ]) {
    assert.equal(api.describeTarget(value), null, `expected no target for '${value}'`)
  }

  for (const value of [null, undefined, 42, true, {}, [], Symbol('x'), () => {}]) {
    assert.equal(api.describeTarget(value), null)
  }
})

test('an IPv6 host keeps no brackets and its port is parsed', () => {
  assert.deepEqual(api.describeTarget('http://[::1]:8080/x'), {
    scheme: 'http',
    host: '::1',
    port: 8080,
  })

  assert.deepEqual(api.describeTarget('https://[2001:DB8::1]/v1/chat'), {
    scheme: 'https',
    host: '2001:db8::1',
    port: null,
  })

  const record = api.createAuditRecord(input({ target: 'https://[2001:db8::1]:11434/v1/chat' }))
  assert.equal(record.target.host, '2001:db8::1')
  assert.equal(record.target.port, 11434)
})

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

test('createAuditRecord never throws, whatever it is handed', () => {
  const cyclic = { providerId: 'ollama', purpose: 'quick', userId: 1 }
  cyclic.self = cyclic

  const hostile = {
    get providerId () { throw new Error('providerId is not readable') },
    get userId () { throw new Error('userId is not readable') },
    get target () { throw new Error('target is not readable') },
    purpose: 'quick',
  }

  for (const value of [null, undefined, 42, 'not an object', [], cyclic, hostile, Symbol('x')]) {
    const record = api.createAuditRecord(value)
    assert.equal(record.kind, 'egress')
    assert.equal(typeof record.at, 'number')
    assert.equal(Number.isFinite(record.at), true)
  }

  // A key whose getter refuses is a missing key, not a failure: the record still
  // says nothing it could not read.
  const record = api.createAuditRecord(hostile)
  assert.equal(record.providerId, '')
  assert.equal(record.userId, 0)
  assert.equal(record.target, null)
})

test('an unknown outcome becomes failed and an unknown block reason becomes null', () => {
  const unknown = api.createAuditRecord(input({ outcome: 'sort-of-worked', reason: 'because' }))
  assert.equal(unknown.outcome, 'failed')
  assert.equal(unknown.reason, null)

  // A token the module does not know is not passed through: the screen has no
  // sentence for it and would draw an empty reason.
  assert.equal(api.createAuditRecord(input({ reason: 'local_only' })).reason, 'local_only')

  // Not a string at all is the same answer, not a coercion.
  assert.equal(api.createAuditRecord(input({ outcome: 7 })).outcome, 'failed')
})

test('numbers are normalised: business ids, user ids, statuses and redirects', () => {
  assert.equal(api.createAuditRecord(input({ businessId: 0 })).businessId, null)
  assert.equal(api.createAuditRecord(input({ businessId: 2.5 })).businessId, null)
  assert.equal(api.createAuditRecord(input({ businessId: '3' })).businessId, null)
  assert.equal(api.createAuditRecord(input({ businessId: null })).businessId, null)
  assert.equal(api.createAuditRecord(input({ businessId: 12 })).businessId, 12)

  assert.equal(api.createAuditRecord(input({ userId: 'seven' })).userId, 0)
  assert.equal(api.createAuditRecord(input({ userId: -2 })).userId, 0)
  assert.equal(api.createAuditRecord(input({ userId: 9 })).userId, 9)

  assert.equal(api.createAuditRecord(input({ status: 99 })).status, null)
  assert.equal(api.createAuditRecord(input({ status: 600 })).status, null)
  assert.equal(api.createAuditRecord(input({ status: 429 })).status, 429)

  assert.equal(api.createAuditRecord(input({ redirects: -1 })).redirects, 0)
  assert.equal(api.createAuditRecord(input({ redirects: 1.5 })).redirects, 0)
  assert.equal(api.createAuditRecord(input({ redirects: 2 })).redirects, 2)

  assert.equal(api.createAuditRecord(input({ cloud: 'yes' })).cloud, null)
  assert.equal(api.createAuditRecord(input({ cloud: true })).cloud, true)

  // A name longer than any provider id the app writes is cut rather than carried,
  // so one record cannot be an unbounded string.
  const long = 'p'.repeat(400)
  assert.equal(api.createAuditRecord(input({ providerId: long })).providerId.length, 120)
  assert.equal(api.createAuditRecord(input({ purpose: 17 })).purpose, '')
})

test('a record carries the time it was made and keeps one it was given', () => {
  const before = Date.now()
  const stamp = api.createAuditRecord(input()).at
  assert.ok(stamp >= before && stamp <= Date.now())

  assert.equal(api.createAuditRecord(input({ at: 1234 })).at, 1234)

  // A time that is not a number is not a time: the record is stamped instead of
  // carrying NaN into everything that sorts or displays the trail.
  const odd = api.createAuditRecord(input({ at: 'yesterday' }))
  assert.equal(Number.isFinite(odd.at), true)
})

/* ------------------------------------------------------------------ *
 * The sink
 * ------------------------------------------------------------------ */

test('a sink keeps the most recent records and drops the oldest', () => {
  const sink = api.createAuditSink({ limit: 3 })

  for (const purpose of ['one', 'two', 'three', 'four', 'five']) {
    sink.record(api.createAuditRecord(input({ purpose })))
  }

  assert.equal(sink.size(), 3)
  assert.deepEqual(sink.entries().map(record => record.purpose), ['three', 'four', 'five'])
})

test('entries() hands back a copy, so a caller cannot reorder or empty the trail', () => {
  const sink = api.createAuditSink()
  sink.record(api.createAuditRecord(input()))
  sink.record(api.createAuditRecord(input({ purpose: 'quick' })))

  const first = sink.entries()
  assert.notEqual(first, sink.entries())
  assert.equal(first.length, 2)

  // A caller that truncates or appends to what it got back must not touch the
  // sink's own array.
  first.length = 0
  first.push('junk')
  assert.equal(sink.size(), 2)
  assert.deepEqual(sink.entries().map(record => record.purpose), ['chat_strategy', 'quick'])
})

test('records are frozen, and so is the target they carry', () => {
  const sink = api.createAuditSink()
  const record = api.createAuditRecord(input({
    target: `https://api.example.com:8443/v1/chat?key=${CANARY}`,
  }))

  assert.equal(Object.isFrozen(record), true)
  assert.equal(Object.isFrozen(record.target), true)

  // A record that can be edited afterwards is not evidence, so editing it fails
  // loudly instead of silently rewriting history.
  assert.throws(() => { record.outcome = 'blocked' }, TypeError)
  assert.throws(() => { record.target.host = 'somewhere.else' }, TypeError)

  sink.record(record)
  assert.equal(Object.isFrozen(sink.entries()[0]), true)
})

test('a blocked record names the reason and the provider but never the host', () => {
  const logger = recordingLogger()
  const sink = api.createAuditSink({ log: logger })

  sink.record(api.createAuditRecord(input({
    outcome: 'blocked',
    reason: 'local_only',
    providerId: 'openai-compatible',
    target: `https://user:${CANARY}@secret-host.example:8443/v1/chat?key=${CANARY}`,
    cloud: true,
  })))

  assert.equal(logger.lines.length, 1)
  const line = logger.lines[0]
  assert.ok(line.includes('local_only'), line)
  assert.ok(line.includes('openai-compatible'), line)
  assert.ok(line.includes('chat_strategy'), line)
  // The host is the destination, and the URL it came from can carry a key.
  assert.equal(line.includes('secret-host'), false, line)
  assert.equal(line.includes(CANARY), false, line)

  // An allowed call is the normal case and stays out of the log, or the refusals
  // would be buried in a line per request.
  sink.record(api.createAuditRecord(input({ purpose: 'quick' })))
  assert.equal(logger.lines.length, 1)
})

test('the sink drops anything that is not a record rather than storing junk', () => {
  const sink = api.createAuditSink()

  for (const value of [
    null,
    42,
    'allowed',
    [],
    {},
    { outcome: 'allowed' },
    Object.freeze({ outcome: 'nonsense' }),
    Object.freeze({ providerId: 'ollama' }),
    Object.freeze({ outcome: `allowed ${CANARY}` }),
  ]) {
    sink.record(value)
  }

  assert.equal(sink.size(), 0)
  assert.deepEqual(sink.entries(), [])

  // A record that is not frozen could be edited after it was stored, so it is
  // copied-and-checked or refused; here it is refused.
  const unfrozen = { ...api.createAuditRecord(input()) }
  assert.equal(Object.isFrozen(unfrozen), false)
  sink.record(unfrozen)
  assert.equal(sink.size(), 0)
})

test('a record stored without a time takes the sink clock, not the wall clock', () => {
  const sink = api.createAuditSink({ now: () => 1_700_000_000_000 })

  sink.record(Object.freeze({
    outcome: 'allowed',
    providerId: 'ollama',
    purpose: 'quick',
    userId: 1,
  }))

  assert.equal(sink.size(), 1)
  const [stored] = sink.entries()
  assert.equal(stored.at, 1_700_000_000_000)
  assert.equal(stored.kind, 'egress')
  // The rest is filled in by the same normalisation the constructor uses, so a
  // hand-built entry cannot be shaped differently from a real one.
  assert.equal(stored.businessId, null)
  assert.equal(stored.redirects, 0)
  assert.equal(stored.target, null)
})

test('clear() empties the trail', () => {
  const sink = api.createAuditSink()
  sink.record(api.createAuditRecord(input()))
  assert.equal(sink.size(), 1)

  sink.clear()
  assert.equal(sink.size(), 0)
  assert.deepEqual(sink.entries(), [])
})
