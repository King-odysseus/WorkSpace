'use strict'

/*
 * DNA proposals and their per-field decisions, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS the
 * main process runs.
 *
 * A proposal exists so that a change to Business DNA can be agreed one field at a time
 * (section 10.4). That makes four things worth proving, and none of them would show up
 * as a broken screen.
 *
 * A field decided twice. The row is the record of what a person answered, so the second
 * answer has to be refused rather than written over the first. If `decide` lost its
 * `decision = 'pending'` guard, an approval would silently become a rejection and the
 * screen would look perfectly ordinary.
 *
 * A proposal closed early. Settling while a field is still open would end the decisions
 * with one still to make, and no later call could complete a proposal that is already
 * closed. The refusal is the feature.
 *
 * What gets applied. `approved` is what the caller writes into DNA, so it must never
 * carry a field nobody agreed to; a rejected change counts as an answer, not a yes.
 *
 * Two businesses on one machine. The most valuable test here is the last one: it hands
 * the repository a real proposal id and a real change id belonging to another business,
 * in the same database and under the same account. The only thing that refuses them is
 * the pair of conditions every statement carries, so each refusal test also checks that
 * nothing was written.
 *
 * Every test opens a real database in a temp file and closes it again, because one test
 * reads the stored wording straight out of SQLite, which is the only way to see what
 * actually reached disk.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

/*
 * A missing factory is a wiring gap, and saying so once beats a per-test guess. The
 * bundle is built from `main/ipc/index.ts`, which has to re-export this repository
 * (`export * from '../db/repositories/dna-proposals.js'`) for anything below to reach it.
 */
for (const name of ['openDatabase', 'createRepositoryContext', 'createDnaProposalRepository']) {
  assert.equal(typeof api[name], 'function', `${name} is not exported by the main bundle`)
}

/* One person on one server, and the two businesses the leak is aimed between. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/** 32 bytes of one repeated value: a throwaway key for a throwaway file. */
const KEY = Buffer.alloc(32, 5)

/** A refusal is the storage layer's own token, never a driver message. */
function refusal (failure) {
  return (error) => {
    assert.equal(error && error.name, 'StorageError', `not a StorageError: ${String(error)}`)
    assert.equal(error.failure, failure)
    return true
  }
}

/**
 * The scope string rows are filed under.
 *
 * Taken from the bundle when it publishes `scopeIdOf`, and otherwise rebuilt from the
 * contract's documented form: the lower-cased host, length prefixed, then the user id.
 * Only the business and document rows seeded below use this. The rows under test are
 * filed by the repository itself.
 */
function scopeIdFor (scope) {
  if (typeof api.scopeIdOf === 'function') return api.scopeIdOf(scope)
  const host = scope.serverHost.trim().toLowerCase()
  return `${host.length}-${host}&${scope.userId}`
}

let idCounter = 0

/** A row id in the shape the contract asks for: lowercase hex. */
function nextId () {
  idCounter += 1
  return idCounter.toString(16).padStart(8, '0')
}

/** One open database in its own temp directory, ready to be disposed of. */
function openStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-dna-proposals-'))
  const filePath = path.join(dir, 'store.db')

  let opened
  try {
    opened = api.openDatabase({
      filePath,
      key: KEY,
      // No vectors: this file is about rows, and loading the extension would only make
      // the test depend on a platform binary it does not test.
      vectorExtensionPath: null,
    })
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }

  return {
    filePath,
    db: opened.db,
    cipher: opened.cipher,
    ctx: api.createRepositoryContext(opened.db, opened.cipher),
    dispose () {
      opened.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Run one body against a fresh database, and take the file away afterwards. */
function withStore (body) {
  const store = openStore()
  try {
    return body(store)
  } finally {
    store.dispose()
  }
}

/* ------------------------------------------------------------------ *
 * The rows a proposal hangs off, written straight from the schema
 * ------------------------------------------------------------------ */

/*
 * Seeded with SQL rather than through their own repositories: the subject of this file
 * is the proposal repository, and a failure here should only ever mean something is
 * wrong in the code this file is about. The shapes are the ones those repositories
 * write.
 */

function seedBusiness (store, name) {
  const id = nextId()
  const now = new Date().toISOString()
  store.db
    .prepare(
      'INSERT INTO business ' +
      '(id, scope_id, remote_workspace_id, name_enc, created_at, updated_at, archived_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      scopeIdFor(SCOPE),
      Number.parseInt(id, 16),
      store.cipher.seal('business.name_enc', name),
      now,
      now,
      null,
    )
  return id
}

function seedDocument (store, businessId, name) {
  const id = nextId()
  const now = new Date().toISOString()
  store.db
    .prepare(
      'INSERT INTO document ' +
      '(id, scope_id, business_id, name_enc, kind, source, status, content_digest, ' +
      'byte_size, page_count, failure, created_at, updated_at, ready_at, replaced_by) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      scopeIdFor(SCOPE),
      businessId,
      store.cipher.seal('document.name_enc', name),
      'txt',
      'picked',
      'ready',
      store.cipher.keyedDigest('document.content_digest', name),
      512,
      4,
      null,
      now,
      now,
      now,
      null,
    )
  return id
}

/**
 * One account with two businesses and the repository under test.
 *
 * Two businesses rather than one because the rule being tested is a leak between them:
 * one person, one database, two sets of rows that must never meet. Both share a scope
 * id, so `business_id` is the only thing standing between them, which is exactly the
 * condition the last test is aimed at.
 */
function fixture (store) {
  const zuriId = seedBusiness(store, 'Zuri Lofts')
  const tijhaId = seedBusiness(store, 'Tijha Consult')

  return {
    proposals: api.createDnaProposalRepository(store.ctx),
    scope: { ...SCOPE, businessId: zuriId },
    otherScope: { ...SCOPE, businessId: tijhaId },
  }
}

/** How many proposals the whole table holds, read past the repository. */
function storedProposalCount (store) {
  return Number(store.db.prepare('SELECT COUNT(*) AS total FROM dna_proposal').get().total)
}

/** How many changes the whole table holds, read past the repository. */
function storedChangeCount (store) {
  return Number(store.db.prepare('SELECT COUNT(*) AS total FROM dna_proposal_change').get().total)
}

/** The one field list most of these tests start from. */
function twoFields () {
  return [
    { key: 'mission', change: 'changed', proposed: 'Keep Abuja lofts liveable.' },
    { key: 'brand_voice', change: 'added', proposed: 'Plain and direct.' },
  ]
}

/** The change for one field, found by key rather than by position in the list. */
function changeFor (detail, key) {
  const row = detail.changes.find((entry) => entry.key === key)
  assert.ok(row, `the proposal has no ${key} change`)
  return row
}

/* ------------------------------------------------------------------ *
 * Creating
 * ------------------------------------------------------------------ */

test('a proposal is stored pending, with one pending change per field', () => withStore((store) => {
  const { proposals, scope } = fixture(store)

  const detail = proposals.create(scope, {
    baseVersion: 3,
    changes: [
      {
        key: 'mission',
        change: 'changed',
        proposed: '  Keep Abuja lofts liveable.  ',
        previous: 'Keep the lights on.',
      },
      { key: 'brand_voice', change: 'added', proposed: 'Plain and direct.' },
    ],
  })

  // Never taken from the caller: a proposal that arrived approved would be a decision
  // nobody made.
  assert.equal(detail.proposal.status, 'pending')
  assert.equal(detail.proposal.baseVersion, 3)
  assert.equal(detail.proposal.documentId, null)

  // Trimmed on the way in, in field-key order, and nothing decided yet.
  assert.deepEqual(
    detail.changes.map((row) => [row.key, row.change, row.proposed, row.previous, row.decision, row.decidedAt]),
    [
      ['brand_voice', 'added', 'Plain and direct.', null, 'pending', null],
      ['mission', 'changed', 'Keep Abuja lofts liveable.', 'Keep the lights on.', 'pending', null],
    ],
  )

  // What reached disk is sealed, so reading the file without the key shows nothing.
  const stored = store.db
    .prepare('SELECT proposed_enc, previous_enc FROM dna_proposal_change WHERE proposal_id = ?')
    .all(detail.proposal.id)
  assert.equal(stored.length, 2)
  const atRest = stored.map((row) => `${row.proposed_enc} ${row.previous_enc}`).join(' ')
  assert.equal(atRest.includes('Abuja'), false)
  assert.equal(atRest.includes('Plain and direct'), false)
  assert.equal(atRest.includes('lights'), false)
}))

test('create refuses a field key, a change kind or a value it cannot store', () => withStore((store) => {
  const { proposals, scope } = fixture(store)

  const bad = (changes) => () => proposals.create(scope, { baseVersion: 1, changes })

  assert.throws(bad([{ key: 'revenue', change: 'added', proposed: 'Some.' }]),
    refusal('invalid_request'))
  assert.throws(bad([{ key: 'mission', change: 'reworded', proposed: 'Some.' }]),
    refusal('invalid_request'))
  assert.throws(bad([{ key: 'mission', change: 'added', proposed: '   ' }]),
    refusal('invalid_request'))
  assert.throws(bad([{ key: 'mission', change: 'added', proposed: 'a'.repeat(8_001) }]),
    refusal('invalid_request'))

  /*
   * Two drafts for one field are refused rather than resolved to the last one: the table
   * is unique on (proposal, key) so the first would have to be dropped, and a caller
   * that produced both has a bug worth seeing.
   */
  assert.throws(bad([
    { key: 'mission', change: 'added', proposed: 'One.' },
    { key: 'mission', change: 'changed', proposed: 'Two.' },
  ]), refusal('invalid_request'))

  // Nothing was stored, so a refusal is not half a proposal left behind.
  assert.equal(storedProposalCount(store), 0)
  assert.equal(storedChangeCount(store), 0)
}))

test('create refuses a document from another business, and stores nothing', () => withStore((store) => {
  const { proposals, scope, otherScope } = fixture(store)
  const theirs = seedDocument(store, otherScope.businessId, 'their-lease.txt')

  assert.throws(() => proposals.create(scope, {
    documentId: theirs,
    baseVersion: 1,
    changes: [{ key: 'mission', change: 'added', proposed: 'Keep Abuja lofts liveable.' }],
  }), refusal('not_found'))

  assert.equal(storedProposalCount(store), 0)
  assert.equal(storedChangeCount(store), 0)

  // The same shape of id is accepted inside its own business, so the refusal above was
  // about ownership rather than about the id being unknown.
  const mine = seedDocument(store, scope.businessId, 'our-lease.txt')
  const detail = proposals.create(scope, {
    documentId: mine,
    baseVersion: 1,
    changes: [{ key: 'mission', change: 'added', proposed: 'Keep Abuja lofts liveable.' }],
  })
  assert.equal(detail.proposal.documentId, mine)
}))

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

test('list returns this business\'s proposals and filters by status', () => withStore((store) => {
  const { proposals, scope } = fixture(store)

  // One proposal taken all the way, so there is a status other than pending to filter by.
  const closed = proposals.create(scope, {
    baseVersion: 1,
    changes: [{ key: 'mission', change: 'added', proposed: 'Keep Abuja lofts liveable.' }],
  })
  proposals.decide(scope, changeFor(closed, 'mission').id, 'approved')
  proposals.settle(scope, closed.proposal.id)

  const open = proposals.create(scope, { baseVersion: 1, changes: twoFields() })

  const all = proposals.list(scope).map((row) => row.id).sort()
  assert.deepEqual(all, [closed.proposal.id, open.proposal.id].sort())

  assert.deepEqual(proposals.list(scope, { status: 'pending' }).map((row) => row.id),
    [open.proposal.id])
  assert.deepEqual(proposals.list(scope, { status: 'approved' }).map((row) => row.id),
    [closed.proposal.id])
  assert.deepEqual(proposals.list(scope, { status: 'rejected' }), [])

  // The cap is the caller's while it is smaller than the table's own.
  assert.equal(proposals.list(scope, { limit: 1 }).length, 1)

  assert.throws(() => proposals.list(scope, { status: 'settled' }), refusal('invalid_request'))
  assert.throws(() => proposals.list(scope, { limit: 0 }), refusal('invalid_request'))
}))

/* ------------------------------------------------------------------ *
 * Deciding one field
 * ------------------------------------------------------------------ */

test('decide approves one change and records when it was decided', () => withStore((store) => {
  const { proposals, scope } = fixture(store)
  const detail = proposals.create(scope, { baseVersion: 1, changes: twoFields() })

  const decided = proposals.decide(scope, changeFor(detail, 'mission').id, 'approved')

  assert.equal(decided.key, 'mission')
  assert.equal(decided.decision, 'approved')
  assert.match(decided.decidedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)

  // The other field is untouched, and the proposal itself is still open: a field
  // decision is not the end of the proposal.
  const after = proposals.get(scope, detail.proposal.id)
  assert.deepEqual(
    after.changes.map((row) => [row.key, row.decision, row.decidedAt === null]),
    [
      ['brand_voice', 'pending', true],
      ['mission', 'approved', false],
    ],
  )
  assert.equal(after.proposal.status, 'pending')
}))

test('a decided change cannot be decided a second time', () => withStore((store) => {
  const { proposals, scope } = fixture(store)
  const detail = proposals.create(scope, { baseVersion: 1, changes: twoFields() })
  const id = changeFor(detail, 'mission').id

  const first = proposals.decide(scope, id, 'approved')

  // The row is the record of what a person answered, so the second answer is refused
  // rather than written over the first.
  assert.throws(() => proposals.decide(scope, id, 'rejected'), refusal('conflict'))
  assert.throws(() => proposals.decide(scope, id, 'approved'), refusal('conflict'))

  // "Pending" is not a decision a person can make; accepting it would let a caller
  // reopen a settled field.
  assert.throws(() => proposals.decide(scope, id, 'pending'), refusal('invalid_request'))

  const after = proposals.get(scope, detail.proposal.id)
  assert.equal(after.changes[1].decision, 'approved')
  assert.equal(after.changes[1].decidedAt, first.decidedAt)
}))

/* ------------------------------------------------------------------ *
 * Closing the proposal
 * ------------------------------------------------------------------ */

test('settle refuses while any field is still open', () => withStore((store) => {
  const { proposals, scope } = fixture(store)
  const detail = proposals.create(scope, { baseVersion: 1, changes: twoFields() })

  proposals.decide(scope, changeFor(detail, 'mission').id, 'approved')

  assert.throws(() => proposals.settle(scope, detail.proposal.id), refusal('conflict'))
  assert.equal(proposals.get(scope, detail.proposal.id).proposal.status, 'pending')
}))

test('settle approves a mixed proposal and rejects one nobody kept', () => withStore((store) => {
  const { proposals, scope } = fixture(store)

  /*
   * One kept, one turned down. The approved field is something to apply, so marking the
   * proposal rejected here would throw away the half a person agreed to.
   */
  const mixed = proposals.create(scope, { baseVersion: 1, changes: twoFields() })
  proposals.decide(scope, changeFor(mixed, 'mission').id, 'approved')
  proposals.decide(scope, changeFor(mixed, 'brand_voice').id, 'rejected')
  assert.equal(proposals.settle(scope, mixed.proposal.id).status, 'approved')

  const refused = proposals.create(scope, { baseVersion: 1, changes: twoFields() })
  proposals.decide(scope, changeFor(refused, 'mission').id, 'rejected')
  proposals.decide(scope, changeFor(refused, 'brand_voice').id, 'rejected')
  assert.equal(proposals.settle(scope, refused.proposal.id).status, 'rejected')
}))

test('approved returns only the fields a person approved', () => withStore((store) => {
  const { proposals, scope } = fixture(store)
  const detail = proposals.create(scope, {
    baseVersion: 1,
    changes: [
      { key: 'mission', change: 'changed', proposed: 'Keep Abuja lofts liveable.' },
      { key: 'brand_voice', change: 'changed', proposed: 'Plain and direct.' },
      { key: 'core_values', change: 'added', proposed: 'Do the work properly.' },
    ],
  })

  assert.deepEqual(proposals.approved(scope, detail.proposal.id), [])

  proposals.decide(scope, changeFor(detail, 'mission').id, 'approved')
  proposals.decide(scope, changeFor(detail, 'brand_voice').id, 'rejected')
  proposals.decide(scope, changeFor(detail, 'core_values').id, 'approved')

  // In field-key order, and with the wording the caller will write into DNA.
  assert.deepEqual(
    proposals.approved(scope, detail.proposal.id).map((row) => [row.key, row.proposed]),
    [
      ['core_values', 'Do the work properly.'],
      ['mission', 'Keep Abuja lofts liveable.'],
    ],
  )
}))

/* ------------------------------------------------------------------ *
 * Between two businesses
 * ------------------------------------------------------------------ */

test('one business cannot read or decide another business\'s proposal', () => withStore((store) => {
  const { proposals, scope, otherScope } = fixture(store)

  const theirs = proposals.create(otherScope, { baseVersion: 1, changes: twoFields() })
  const theirChange = changeFor(theirs, 'mission')

  // A real proposal, in the same database, under the same account: the business is the
  // only thing keeping the two apart.
  assert.equal(proposals.get(scope, theirs.proposal.id), null)
  assert.equal(proposals.get(otherScope, theirs.proposal.id).proposal.id, theirs.proposal.id)

  assert.throws(() => proposals.decide(scope, theirChange.id, 'approved'), refusal('conflict'))
  assert.throws(() => proposals.settle(scope, theirs.proposal.id), refusal('not_found'))
  assert.deepEqual(proposals.approved(scope, theirs.proposal.id), [])
  assert.deepEqual(proposals.list(scope), [])

  // Nothing of theirs moved: the refusals wrote nothing at all.
  const untouched = proposals.get(otherScope, theirs.proposal.id)
  assert.equal(untouched.proposal.status, 'pending')
  assert.equal(changeFor(untouched, 'mission').decision, 'pending')
  assert.equal(changeFor(untouched, 'mission').decidedAt, null)
}))
