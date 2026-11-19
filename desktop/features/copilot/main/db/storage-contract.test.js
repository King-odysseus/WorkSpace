'use strict'

/*
 * The storage contract, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs. The surface arrives through the build entry's
 * re-export of `shared/storage-contract.ts`; if a test fails with something like
 * "api.scopeKey is not a function", the missing re-export is the fault, not the
 * schema.
 *
 * Nothing here opens a database. Every case is a schema, a key or an error
 * object, so these tests run on a Node build with no SQLite at all, which is the
 * ordinary state of the machine this suite runs on.
 *
 * Three decisions are worth pinning, and each one has cost something already:
 *
 * - A scope becomes a string in exactly one place, and a host that contains the
 *   separator cannot impersonate a different person. The credential store once
 *   filed two accounts under one name because `example.com` + 7 and
 *   `example.com.7` + 8 joined to the same string, so the test that would have
 *   caught it lives here for the same reason it lives there.
 * - A failure is a token plus one fixed sentence. The token is for a log line and
 *   the sentence is for a person, and neither may stand in for the other.
 * - Rows are strict. An unknown key is refused rather than stripped, because a
 *   caller that could smuggle a field into a row could write a column no
 *   migration created.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/* One instant every fixture shares: the row shapes are under test, not a clock. */
const AT = '2026-11-16T09:30:00.000Z'

/** A scope that is valid in every way, so a rejection below has exactly one reason. */
function scope (overrides = {}) {
  return { serverHost: 'zuri.example.test', userId: 7, ...overrides }
}

/** A business row: one remote workspace, as the database knows it. */
function businessRow (overrides = {}) {
  return {
    id: 'b1a2c3d4',
    remoteWorkspaceId: 12,
    name: 'Zuri Lofts',
    createdAt: AT,
    updatedAt: AT,
    archivedAt: null,
    ...overrides,
  }
}

/** A message row as a person's own message is stored: no provider, no model. */
function messageRow (overrides = {}) {
  return {
    id: 'a1b2c3d4',
    threadId: 'c1d2e3f4',
    seq: 3,
    role: 'user',
    content: 'What is on today?',
    provider: null,
    model: null,
    cloud: null,
    createdAt: AT,
    ...overrides,
  }
}

/** A remembered item, edited by a person rather than extracted. */
function memoryRow (overrides = {}) {
  return {
    id: 'd1e2f3a4',
    kind: 'decision',
    text: 'The lofts viewing is on Friday.',
    sourceMessageId: null,
    origin: 'user',
    locked: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/** A draft proposal. Phase 3 only ever creates a draft; nothing here executes. */
function proposalRow (overrides = {}) {
  return {
    id: 'e1f2a3b4',
    threadId: 'c1d2e3f4',
    kind: 'task',
    status: 'pending',
    title: 'Add a follow-up task for the lofts viewing',
    payload: { title: 'Follow up with the lofts client' },
    idempotencyKey: 'e1f2a3b4-1',
    expiresAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/** An audit entry: what happened, and never the content of what was read. */
function auditRow (overrides = {}) {
  return {
    id: 'f1a2b3c4',
    businessId: null,
    action: 'memory.write',
    outcome: 'allowed',
    detail: '',
    createdAt: AT,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * Turning a scope into a key
 * ------------------------------------------------------------------ */

test('a scope key is stable and does not care how the host was capitalised', () => {
  const mixedCase = api.scopeKey({ serverHost: 'Zuri.Example.Test', userId: 7 })
  const lowerCase = api.scopeKey({ serverHost: 'zuri.example.test', userId: 7 })

  // The same business reached over a differently-cased host is the same business,
  // and must not become two databases.
  assert.equal(mixedCase, lowerCase)

  // Stable means two calls answer the same string: a key that moved between calls
  // would file every write under a new name.
  assert.equal(api.scopeKey({ serverHost: 'zuri.example.test', userId: 7 }), lowerCase)

  // Padding is the same host reached by a copy-paste, not a different one.
  assert.equal(api.scopeKey({ serverHost: '  zuri.example.test  ', userId: 7 }), lowerCase)

  // Two people on one server are still separated, which is the point of the key.
  assert.notEqual(api.scopeKey({ serverHost: 'zuri.example.test', userId: 8 }), lowerCase)
})

test('a scope key cannot be forged by putting the separator inside the host', () => {
  /*
   * The collision the credential store once had: joining host and user id with a
   * dot made these two strings identical, so two people shared one name. This
   * test exists so it cannot come back.
   */
  const honest = api.scopeKey({ serverHost: 'example.com', userId: 7 })
  const dottedHost = api.scopeKey({ serverHost: 'example.com.7', userId: 8 })
  assert.notEqual(dottedHost, honest)

  // The same trick with the separator the key really uses.
  const separatorHost = api.scopeKey({ serverHost: 'example.com&7', userId: 8 })
  assert.notEqual(separatorHost, honest)
  assert.notEqual(separatorHost, dottedHost)
})

test('a business key separates two businesses and two scopes', () => {
  const first = api.businessKey({ ...scope(), businessId: 'biz-a' })
  const second = api.businessKey({ ...scope(), businessId: 'biz-b' })
  assert.notEqual(first, second)

  // The same business id on another server is another database's row.
  const otherServer = api.businessKey({
    serverHost: 'other.example.test',
    userId: 7,
    businessId: 'biz-a',
  })
  assert.notEqual(otherServer, first)

  // And the same id for another person on the same server, which is the pair the
  // scope key exists to keep apart.
  const otherPerson = api.businessKey({
    serverHost: 'zuri.example.test',
    userId: 8,
    businessId: 'biz-a',
  })
  assert.notEqual(otherPerson, first)

  // A business key is its scope plus its own id, so it cannot lose the scope.
  assert.ok(first.startsWith(api.scopeKey(scope())))
})

/* ------------------------------------------------------------------ *
 * What a scope must say
 * ------------------------------------------------------------------ */

test('a scope must name a server and a real user id, and nothing else', () => {
  assert.equal(api.storageScopeSchema.safeParse(scope()).success, true)

  const refused = [
    ['no server at all', { userId: 7 }],
    ['an empty server', { serverHost: '', userId: 7 }],
    ['user zero', { serverHost: 'zuri.example.test', userId: 0 }],
    ['a negative user', { serverHost: 'zuri.example.test', userId: -1 }],
    ['a fractional user', { serverHost: 'zuri.example.test', userId: 7.5 }],
    ['a user sent as text', { serverHost: 'zuri.example.test', userId: '7' }],
    ['an unknown field', { ...scope(), admin: true }],
  ]

  for (const [why, value] of refused) {
    assert.equal(
      api.storageScopeSchema.safeParse(value).success,
      false,
      `the scope accepted ${why}`,
    )
  }
})

test('a business scope must name a business', () => {
  const valid = { ...scope(), businessId: 'biz-a' }
  assert.equal(api.businessScopeSchema.safeParse(valid).success, true)

  const refused = [
    ['no business', scope()],
    ['an empty business', { ...scope(), businessId: '' }],
  ]

  for (const [why, value] of refused) {
    assert.equal(
      api.businessScopeSchema.safeParse(value).success,
      false,
      `the scope accepted ${why}`,
    )
  }
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('every failure token builds an error whose message is its own sentence', () => {
  for (const failure of api.STORAGE_FAILURES) {
    const error = new api.StorageError(failure)

    assert.equal(error.message, api.STORAGE_FAILURE_MESSAGES[failure], failure)
    assert.equal(error.name, 'StorageError', failure)
    assert.equal(error.failure, failure)
    assert.ok(error instanceof Error, `${failure} is not an Error`)

    // No cause, on purpose: `console.error` prints a cause, and a cause here
    // would be a row's content.
    assert.equal(Object.hasOwn(error, 'cause'), false, `${failure} carries a cause`)
    assert.equal(error.cause, undefined)

    // It survives being thrown and caught as the class it says it is, which is
    // how every repository reports a refusal to its caller.
    try {
      throw error
    } catch (caught) {
      assert.ok(caught instanceof api.StorageError, failure)
      assert.equal(caught.failure, failure)
      assert.equal(caught.message, api.STORAGE_FAILURE_MESSAGES[failure])
    }
  }
})

test('every failure token has a sentence a person could read, with no identifier in it', () => {
  // The list is fixed at build time because it is used as a lookup key; a token
  // added without a sentence would be a missing message on a screen.
  assert.ok(Object.isFrozen(api.STORAGE_FAILURES), 'the token list is not frozen')
  assert.ok(api.STORAGE_FAILURES.length > 0, 'the contract lists no failures')

  for (const failure of api.STORAGE_FAILURES) {
    const message = api.STORAGE_FAILURE_MESSAGES[failure]

    assert.equal(typeof message, 'string', `${failure} has no sentence`)
    assert.ok(message.trim().length > 1, `${failure} has an empty sentence`)

    // An identifier on screen is a bug report the person cannot file.
    assert.equal(message.includes('_'), false, `${failure} carries an identifier`)
    assert.equal(message.includes(failure), false, `${failure} carries its own token`)
  }
})

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

test('a business row accepts one workspace and refuses a row the screen cannot draw', () => {
  const row = businessRow()
  assert.deepEqual(api.businessRowSchema.parse(row), row)

  const refused = [
    ['an unknown field', { ...row, colour: 'green' }],
    ['a negative remote workspace', { ...row, remoteWorkspaceId: -12 }],
    ['a null name', { ...row, name: null }],
  ]

  for (const [why, value] of refused) {
    assert.equal(
      api.businessRowSchema.safeParse(value).success,
      false,
      `the row accepted ${why}`,
    )
  }
})

test('a message row lets a person\'s own message have no model, and refuses a role that does not exist', () => {
  const user = messageRow()

  // `cloud: null` is the normal state for a message a model did not produce, so it
  // is accepted rather than treated as a gap to fill in.
  assert.equal(api.messageRowSchema.safeParse(user).success, true)
  assert.deepEqual(api.messageRowSchema.parse(user), user)

  // A reply records what answered it, so the same schema accepts the filled-in
  // row. A reply that never happened keeps them null, which is why they are
  // nullable in the first place.
  const assistant = messageRow({
    role: 'assistant',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cloud: true,
    seq: 4,
  })
  assert.equal(api.messageRowSchema.safeParse(assistant).success, true)

  assert.equal(api.messageRowSchema.safeParse(messageRow({ role: 'robot' })).success, false)
})

test('a memory row accepts the four kinds the plan names and refuses a made-up one', () => {
  // Written out rather than read from the list, so a kind that quietly appears or
  // disappears is a failure here instead of something a reader has to notice.
  assert.deepEqual([...api.memoryKinds].sort(), [
    'assumption',
    'decision',
    'fact',
    'open_question',
  ])

  for (const kind of api.memoryKinds) {
    const row = memoryRow({ kind })
    assert.equal(api.memoryRowSchema.safeParse(row).success, true, `the row refused ${kind}`)
    assert.deepEqual(api.memoryRowSchema.parse(row), row)
  }

  assert.equal(api.memoryRowSchema.safeParse(memoryRow({ kind: 'gossip' })).success, false)
})

test('a proposal row accepts each status a proposal can hold and refuses an invented one', () => {
  // The kind travels with the status on the same row, so both lists are walked.
  for (const kind of api.proposalKinds) {
    const row = proposalRow({ kind })
    assert.equal(api.proposalRowSchema.safeParse(row).success, true, `the row refused ${kind}`)
  }

  for (const status of api.proposalStatuses) {
    const row = proposalRow({ status })
    assert.equal(api.proposalRowSchema.safeParse(row).success, true, `the row refused ${status}`)
    assert.deepEqual(api.proposalRowSchema.parse(row), row)
  }

  assert.equal(api.proposalRowSchema.safeParse(proposalRow({ status: 'maybe' })).success, false)
})

test('an audit row accepts each outcome the trail records', () => {
  for (const outcome of api.auditOutcomes) {
    const row = auditRow({ outcome })
    assert.equal(api.auditRowSchema.safeParse(row).success, true, `the row refused ${outcome}`)
    assert.deepEqual(api.auditRowSchema.parse(row), row)
  }

  // The trail records what happened, never a verdict invented for it.
  assert.equal(api.auditRowSchema.safeParse(auditRow({ outcome: 'ignored' })).success, false)
})
