'use strict'

/*
 * The memory and proposal repositories, driven against a real database file.
 *
 * These tests open a database in a temporary folder rather than handing the
 * repositories a fake connection, and that is the point of the file. Three of the
 * properties the plan asks for are properties of the SQL and of the cipher, not of
 * a JavaScript object:
 *
 * - A row belonging to one business or one signed-in person is invisible from
 *   another. That is a WHERE clause, so it can only be proved by a query that has
 *   real rows to filter.
 * - A removed memory item is a tombstone. Proving that needs the row to still be
 *   in the table after the call.
 * - Text a person typed is ciphertext at rest. That is a claim about the bytes on
 *   disk, so the test reads the stored column directly instead of trusting the
 *   value that came back through the repository.
 *
 * The business and thread rows the fixtures need are inserted by hand, because the
 * business and thread repositories are another part of this phase, and a fixture
 * that went through them would fail for two reasons at once. The name and title are
 * sealed with the same cipher, so the inserted rows are rows the real code could
 * have written.
 *
 * The database is opened once for the whole file and each test makes its own
 * business, so the tests do not share rows and their order does not matter.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/*
 * The bundle Electron loads, for the same reason every other main-process test
 * requires it: a test against a second compilation proves nothing about the code
 * that ships.
 */
const api = require('../../../../../build/main/ipc.cjs')

/*
 * A missing factory here means the main-process entry does not export the storage
 * layer yet, which is a wiring gap and not a repository bug. Saying so once, at
 * load, is clearer than the "not a function" every test would otherwise report.
 */
for (const name of [
  'openDatabase',
  'createRepositoryContext',
  'createMemoryRepository',
  'createProposalRepository',
]) {
  assert.equal(typeof api[name], 'function', `${name} is not exported by the main bundle`)
}

const SERVER = 'zuri.example.test'
const USER = 7
const OTHER_USER = 8

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-memory-'))
const databasePath = path.join(tempDir, 'tijha.sqlite')

/*
 * 32 bytes of one repeated value: a throwaway key for a throwaway file. It is not
 * a secret, it is never stored anywhere, and the folder is deleted with the file.
 */
const key = Buffer.alloc(32, 7)

const opened = api.openDatabase({ filePath: databasePath, key, vectorExtensionPath: null })
const context = api.createRepositoryContext(opened.db, opened.cipher)

const memory = api.createMemoryRepository(context)
const proposals = api.createProposalRepository(context)

test.after(() => {
  opened.close()
  fs.rmSync(tempDir, { recursive: true, force: true })
})

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

let sequence = 0

/** A fresh 16 character hex id, so every fixture row is distinct. */
function newId () {
  sequence += 1
  return sequence.toString(16).padStart(16, '0')
}

/**
 * The scope string every row is filed under, spelled the way the contract spells
 * it: the host is length prefixed, so a host containing the separator cannot
 * impersonate another person.
 *
 * Written out here instead of imported, so the fixture row and the repository's
 * WHERE clause are two independent statements of the same rule. If one of them
 * changes, the tests that compare them fail instead of agreeing on a mistake.
 */
function scopeId (userId) {
  const host = SERVER.trim().toLowerCase()
  return `${host.length}-${host}&${userId}`
}

/**
 * One business row, and the scope that reads it.
 *
 * The business row has to exist before anything else does: memory and proposals
 * both carry a foreign key to it, and the connection turns foreign keys on.
 */
function createBusiness (userId = USER) {
  const id = newId()
  const at = new Date().toISOString()
  // `sequence` is this row's number, so the remote id is unique inside the scope.
  const remoteWorkspaceId = sequence
  const name = opened.cipher.seal('business.name_enc', 'Zuri Lofts')
  opened.db
    .prepare(
      `INSERT INTO business
         (id, scope_id, remote_workspace_id, name_enc, created_at, updated_at, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(id, scopeId(userId), remoteWorkspaceId, name, at, at)
  return { serverHost: SERVER, userId, businessId: id }
}

/** One thread row, which a proposal may point at. */
function createThread (scope) {
  const id = newId()
  const at = new Date().toISOString()
  const title = opened.cipher.seal('thread.title_enc', 'Planning')
  opened.db
    .prepare(
      `INSERT INTO thread
         (id, scope_id, business_id, title_enc, pinned, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, NULL)`,
    )
    .run(id, scopeId(scope.userId), scope.businessId, title, at, at)
  return id
}

/** The refusal a caller sees when a row is not theirs, or is no longer there. */
function notFound (error) {
  // The name matters: it says the refusal came from the storage layer rather than
  // from the engine underneath it. The token is what a screen would draw.
  assert.equal(error && error.name, 'StorageError', `not a StorageError: ${String(error)}`)
  assert.equal(error.failure, 'not_found')
  return true
}

/** One stored column, read straight from the table rather than through a row. */
function rawColumn (table, column, id) {
  const row = opened.db.prepare(`SELECT ${column} FROM ${table} WHERE id = ?`).get(id)
  assert.ok(row, `${table} has no row ${id}`)
  return row[column]
}

/* ------------------------------------------------------------------ *
 * Memory
 * ------------------------------------------------------------------ */

test('an added memory item is listed with its kind, and a removed one is gone from both reads', () => {
  const scope = createBusiness()

  const added = memory.add(scope, {
    kind: 'decision',
    text: 'Weekly planning happens on Monday morning.',
  })

  // An extraction is the ordinary author, and nothing it writes is locked.
  assert.equal(added.kind, 'decision')
  assert.equal(added.text, 'Weekly planning happens on Monday morning.')
  assert.equal(added.origin, 'ai')
  assert.equal(added.locked, false)
  assert.equal(added.sourceMessageId, null)

  const listed = memory.list(scope)
  assert.deepEqual(listed.map(row => row.id), [added.id])
  assert.deepEqual(listed.map(row => row.kind), ['decision'])

  // A live item is not a removal, so the removals read is empty until one is made.
  assert.deepEqual(memory.listRemoved(scope), [])

  memory.remove(scope, added.id)

  // A removal is a tombstone, so it disappears from the list and from a lookup by
  // id alike, and the row itself is still in the table for the audit trail.
  assert.deepEqual(memory.list(scope), [])
  assert.throws(() => memory.get(scope, added.id), notFound)

  /*
   * The removals read is the one place the tombstone is still visible, and it holds the
   * wording on purpose: recognising the sentence is what stops a later extraction pass
   * storing it again. It is a separate read rather than an extra row in `list` so that a
   * screen drawing the panel never shows what the person took back.
   */
  const removed = memory.listRemoved(scope)
  assert.deepEqual(removed.map(row => row.id), [added.id])
  assert.equal(removed[0].text, 'Weekly planning happens on Monday morning.')
  assert.equal(removed[0].kind, 'decision')
})

test('an edit replaces the wording, marks the item as the person\'s, and locks it', () => {
  const scope = createBusiness()
  const added = memory.add(scope, { kind: 'fact', text: 'The pilot starts in March.' })

  const edited = memory.edit(scope, added.id, 'The pilot starts in April.')

  assert.equal(edited.id, added.id)
  assert.equal(edited.text, 'The pilot starts in April.')
  // The two facts a later extraction reads before it writes over a correction.
  assert.equal(edited.origin, 'user')
  assert.equal(edited.locked, true)

  // Read again rather than trusting the returned value: the lock has to be in the
  // row, not only in the answer to this one call.
  const stored = memory.get(scope, added.id)
  assert.equal(stored.text, 'The pilot starts in April.')
  assert.equal(stored.origin, 'user')
  assert.equal(stored.locked, true)
})

test('memory from one business is invisible inside another business', () => {
  const first = createBusiness()
  const second = createBusiness()
  const added = memory.add(first, { kind: 'decision', text: 'Invoices go out on the first.' })

  assert.deepEqual(memory.list(second), [])
  assert.throws(() => memory.get(second, added.id), notFound)
  assert.throws(() => memory.edit(second, added.id, 'Invoices go out on the fifth.'), notFound)
  assert.throws(() => memory.remove(second, added.id), notFound)

  // The row is still readable by the business that owns it, so the refusals above
  // were about the business and not about the row having gone missing.
  assert.equal(memory.get(first, added.id).text, 'Invoices go out on the first.')
})

test('a second signed-in person cannot read a memory id from the first', () => {
  const owner = createBusiness(USER)
  const added = memory.add(owner, {
    kind: 'assumption',
    text: 'The client wants the same logo as last year.',
  })

  // The same business id, reached by a different person: this is the shape a
  // shared machine produces, and it must not open the first person's rows.
  const otherPerson = { ...owner, userId: OTHER_USER }

  assert.deepEqual(memory.list(otherPerson), [])
  assert.throws(() => memory.get(otherPerson, added.id), notFound)

  // A removal from the wrong scope changes nothing at all.
  assert.throws(() => memory.remove(otherPerson, added.id), notFound)
  assert.equal(memory.get(owner, added.id).text, 'The client wants the same logo as last year.')
})

test('memory text is ciphertext in the row the database holds', () => {
  const scope = createBusiness()
  const text = 'The retainer is reviewed every June.'

  const added = memory.add(scope, { kind: 'fact', text })
  const stored = rawColumn('memory_item', 'text_enc', added.id)

  assert.equal(typeof stored, 'string')
  assert.equal(stored.startsWith('v1.'), true, 'the column does not hold an envelope')
  assert.equal(stored.includes(text), false, 'the column quotes the sentence')
  assert.equal(stored.includes('retainer'), false, 'the column quotes a word of the sentence')

  // And the same row opens back into the sentence the person wrote.
  assert.equal(memory.get(scope, added.id).text, text)
})

test('a listing filtered by kind returns only that kind', () => {
  const scope = createBusiness()
  const decision = memory.add(scope, { kind: 'decision', text: 'Deposits are taken up front.' })
  memory.add(scope, { kind: 'fact', text: 'The studio is in Abuja.' })
  memory.add(scope, { kind: 'open_question', text: 'Who signs the release form?' })

  const decisions = memory.list(scope, { kinds: ['decision'] })
  assert.deepEqual(decisions.map(row => row.id), [decision.id])
  assert.equal(decisions.every(row => row.kind === 'decision'), true)

  const twoKinds = memory.list(scope, { kinds: ['fact', 'open_question'] })
  assert.deepEqual(twoKinds.map(row => row.kind).sort(), ['fact', 'open_question'])

  // No filter still means every kind, so the filter narrowed the answer rather
  // than the listing only ever working when one is given.
  assert.equal(memory.list(scope).length, 3)
})

/* ------------------------------------------------------------------ *
 * Proposals
 * ------------------------------------------------------------------ */

test('a proposal starts pending, keeps its draft, and records a rejection', () => {
  const scope = createBusiness()
  const thread = createThread(scope)
  const payload = { taskTitle: 'Send the June invoice', dueDate: '2026-06-30', assigneeId: 4 }

  const created = proposals.create(scope, {
    kind: 'task',
    title: 'Send the June invoice',
    payload,
    threadId: thread,
  })

  // Nothing a caller sends can make a proposal arrive already decided.
  assert.equal(created.status, 'pending')
  assert.equal(created.kind, 'task')
  assert.equal(created.threadId, thread)
  assert.equal(typeof created.idempotencyKey, 'string')
  assert.ok(created.idempotencyKey.length > 0, 'no idempotency key was stored')

  // The draft survives the seal and the JSON round trip unchanged.
  assert.deepEqual(proposals.get(scope, created.id).payload, payload)

  const rejected = proposals.setStatus(scope, created.id, 'rejected')

  assert.equal(rejected.status, 'rejected')
  // A decision changes the decision, not the draft: the card can still show what
  // was turned down.
  assert.equal(rejected.title, 'Send the June invoice')
  assert.deepEqual(rejected.payload, payload)
  assert.equal(proposals.get(scope, created.id).status, 'rejected')

  assert.deepEqual(
    proposals.list(scope, { status: 'rejected' }).map(row => row.id),
    [created.id],
  )
  assert.deepEqual(proposals.list(scope, { status: 'pending' }), [])
})

test('a proposal from one business is not found inside another', () => {
  const first = createBusiness()
  const second = createBusiness()

  const created = proposals.create(first, {
    kind: 'email',
    title: 'Follow up on the June invoice',
    payload: { subject: 'June invoice' },
  })

  assert.deepEqual(proposals.list(second), [])
  assert.throws(() => proposals.get(second, created.id), notFound)
  assert.throws(() => proposals.setStatus(second, created.id, 'approved'), notFound)

  // The attempted approval from the wrong business changed nothing.
  assert.equal(proposals.get(first, created.id).status, 'pending')

  // Nor can another business rewrite the wording of a draft it does not own.
  assert.throws(
    () => proposals.update(second, created.id, { title: 'Not mine to rewrite' }),
    notFound,
  )
  assert.equal(proposals.get(first, created.id).title, 'Follow up on the June invoice')
})

test('editing a pending draft rewrites only the three fields a card draws', () => {
  const scope = createBusiness()
  const created = proposals.create(scope, {
    kind: 'task',
    title: 'Send the June invoice',
    payload: { title: 'Send the June invoice', assigneeId: 'user-3', taskId: 'task-9' },
  })

  const edited = proposals.update(scope, created.id, {
    title: 'Send the June invoice and a reminder',
    notes: '  Ask for the signed copy.  ',
    dueHint: 'Friday',
  })

  assert.equal(edited.id, created.id)
  assert.equal(edited.title, 'Send the June invoice and a reminder')
  // The payload is rebuilt from the named fields rather than merged, so a key the
  // card never draws cannot survive an edit. A merge would leave `assigneeId` here
  // and the card would look as though the app had agreed to an owner.
  assert.deepEqual(edited.payload, {
    title: 'Send the June invoice and a reminder',
    notes: 'Ask for the signed copy.',
    dueHint: 'Friday',
  })
  // Nothing but a decision changes the status.
  assert.equal(edited.status, 'pending')

  // An empty note removes the note rather than storing an empty one.
  const cleared = proposals.update(scope, created.id, {
    title: 'Send the June invoice and a reminder',
    notes: '   ',
  })
  assert.deepEqual(Object.keys(cleared.payload).sort(), ['title'])

  // The new wording is ciphertext in the row the database holds.
  assert.notEqual(rawColumn('proposal', 'title_enc', created.id), edited.title)
})

test('a draft that has already been decided cannot be edited afterwards', () => {
  const scope = createBusiness()
  const created = proposals.create(scope, {
    kind: 'task',
    title: 'Send the June invoice',
    payload: { title: 'Send the June invoice' },
  })

  proposals.setStatus(scope, created.id, 'approved')

  /*
   * The row is the record of what somebody decided. Letting the wording change
   * afterwards would leave an approval attached to text that was not on screen when
   * it was given, which is why the refusal is here rather than in the screen.
   */
  assert.throws(
    () => proposals.update(scope, created.id, { title: 'Something else entirely' }),
    notFound,
  )

  const unchanged = proposals.get(scope, created.id)
  assert.equal(unchanged.title, 'Send the June invoice')
  assert.deepEqual(unchanged.payload, { title: 'Send the June invoice' })
  assert.equal(unchanged.status, 'approved')
})

test('a proposal title and its draft are ciphertext in the row the database holds', () => {
  const scope = createBusiness()
  const title = 'Move the standup to Thursday'
  const payload = { memo: 'The team is out on Wednesday afternoon' }

  const created = proposals.create(scope, { kind: 'dna_change', title, payload })

  const storedTitle = rawColumn('proposal', 'title_enc', created.id)
  const storedPayload = rawColumn('proposal', 'payload_enc', created.id)

  for (const [column, value] of [['title_enc', storedTitle], ['payload_enc', storedPayload]]) {
    assert.equal(typeof value, 'string', `${column} is not a string`)
    assert.equal(value.startsWith('v1.'), true, `${column} does not hold an envelope`)
  }

  assert.equal(storedTitle.includes(title), false, 'the title column quotes the title')
  assert.equal(
    storedPayload.includes('Wednesday'),
    false,
    'the payload column quotes the draft',
  )

  // And the row opens back into what the assistant drafted.
  const read = proposals.get(scope, created.id)
  assert.equal(read.title, title)
  assert.deepEqual(read.payload, payload)
})
