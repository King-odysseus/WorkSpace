'use strict'

/*
 * The ingestion job queue, driven against a real database.
 *
 * Three rules in this repository cannot be checked by reading a return value, so they
 * are measured here instead:
 *
 * - a job can only be created for a document the same business holds. The guard lives
 *   inside the insert, as a select over `document`, so the only way to know it works
 *   is to try it and then count the rows;
 * - progress never goes backwards. A report that arrives out of order has to be
 *   refused *and* leave the stored row exactly as it was, because a refusal that
 *   arrives after the write is not a refusal;
 * - a job in one business is invisible in another. Same database file, same signed-in
 *   person, two businesses: that is the leak this file is aimed at, so it is asserted
 *   through every method rather than only through `get`.
 *
 * `listPending` is the fourth: it is what a restart reads to know what to resume, so
 * the oldest first order and the finished work being left out are both stated here.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

/*
 * The names this file needs from the bundle.
 *
 * The bundle only publishes what `features/copilot/main/ipc/index.ts` re-exports, so a
 * missing name is reported as the wiring step it is instead of surfacing as
 * "undefined is not a function" in every test at once.
 */
function requireBundle (names) {
  const missing = names.filter((name) => api[name] === undefined)
  assert.deepEqual(
    missing,
    [],
    `desktop/features/copilot/main/ipc/index.ts must re-export ${missing.join(', ')}`,
  )
}

requireBundle([
  'openDatabase',
  'createKeyMaterial',
  'createRepositoryContext',
  'createDocumentJobRepository',
  'StorageError',
  'STORAGE_FAILURES',
])

/* One person on one server. Everything below is filed under one of these. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/* ------------------------------------------------------------------ *
 * The database and the parent rows
 * ------------------------------------------------------------------ */

/**
 * The scope string rows are filed under.
 *
 * Taken from the bundle when it publishes `scopeIdOf`, and otherwise rebuilt from the
 * contract's documented form: the lower-cased host, length prefixed, then the user id.
 * The length prefix is what stops two different scopes producing the same string, so
 * it is repeated exactly rather than approximated.
 *
 * This is only used for the business and document rows seeded below. The rows under
 * test are filed by the repository itself.
 */
function scopeIdFor (scope) {
  if (typeof api.scopeIdOf === 'function') return api.scopeIdOf(scope)
  const host = scope.serverHost.trim().toLowerCase()
  return `${host.length}-${host}&${scope.userId}`
}

/** A row id in the shape the contract asks for: lowercase hex. */
let idCounter = 0
function nextId () {
  idCounter += 1
  return idCounter.toString(16).padStart(8, '0')
}

/**
 * A clock that moves a second at a time.
 *
 * Real time is too coarse to order rows that are written a microsecond apart, and
 * "oldest first" is one of the things this file has to prove. A clock that steps means
 * the order under test comes from the data rather than from whichever row used up a
 * timestamp first.
 */
function steppingClock () {
  let ticks = 0
  return () => {
    ticks += 1
    return new Date(Date.UTC(2026, 10, 17, 9, 0, 0) + ticks * 1000).toISOString()
  }
}

/** One open database in its own temp directory, ready to be disposed of. */
function openStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-jobs-'))
  const filePath = path.join(dir, 'store.db')

  let opened
  try {
    opened = api.openDatabase({
      filePath,
      key: Buffer.from(api.createKeyMaterial(), 'base64'),
      // No vectors: this file is about rows, and loading the extension would only
      // make the test depend on a platform binary it does not exercise.
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
    ctx: api.createRepositoryContext(opened.db, opened.cipher, { now: steppingClock() }),
    dispose () {
      opened.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Run one body against a fresh database, and take the file away afterwards. */
async function withStore (body) {
  const store = openStore()
  try {
    return await body(store)
  } finally {
    store.dispose()
  }
}

/**
 * A business row, written straight from the schema.
 *
 * The subject of this file is the job repository, so the rows it hangs off are seeded
 * with SQL rather than through the business and document repositories: a failure here
 * should only ever mean something is wrong in the code this file is about.
 */
function seedBusiness (store, scope) {
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
      scopeIdFor(scope),
      Number.parseInt(id, 16),
      store.cipher.seal('business.name_enc', 'Zuri Lofts'),
      now,
      now,
      null,
    )
  return id
}

/** A document row in one business, in the same shape its own repository writes. */
function seedDocument (store, scope, businessId) {
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
      scopeIdFor(scope),
      businessId,
      store.cipher.seal('document.name_enc', 'Tilley quote.pdf'),
      'pdf',
      'picked',
      'uploaded',
      // A digest only has to be unique per file; nothing in this file opens it.
      id.padEnd(32, '0'),
      1024,
      null,
      null,
      now,
      now,
      null,
      null,
    )
  return id
}

/** One business with one document: the least a job can be filed against. */
function seedLibrary (store, scope) {
  const businessId = seedBusiness(store, scope)
  const documentId = seedDocument(store, scope, businessId)
  return { businessId, documentId, businessScope: { ...scope, businessId } }
}

/** How many jobs the whole table holds, read past every repository. */
function storedJobCount (store) {
  return Number(store.db.prepare('SELECT COUNT(*) AS total FROM document_job').get().total)
}

/** Assert that a call refuses with a `StorageError`, optionally the named token. */
function expectFailure (work, token) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof api.StorageError, `expected a StorageError, got ${error && error.name}`)
    assert.ok(
      api.STORAGE_FAILURES.includes(error.failure),
      `"${error.failure}" is not one of the storage failure tokens`,
    )
    if (token !== undefined) assert.equal(error.failure, token)
    return true
  })
}

/* ------------------------------------------------------------------ *
 * Creating a job
 * ------------------------------------------------------------------ */

test('a created job is queued at zero and is the document\'s latest', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)

  const created = jobs.create(businessScope, documentId)

  assert.equal(created.documentId, documentId)
  assert.equal(created.status, 'queued')
  assert.equal(created.stage, 'waiting')
  assert.equal(created.progress, 0)
  assert.equal(created.attempts, 0)
  assert.equal(created.failure, null)
  assert.equal(created.startedAt, null)
  assert.equal(created.finishedAt, null)

  // Read back through a second path, so an object built in memory cannot pass this.
  assert.deepEqual(jobs.latestFor(businessScope, documentId), created)
  assert.deepEqual(jobs.get(businessScope, created.id), created)
  assert.equal(storedJobCount(store), 1)
}))

test('a job cannot be created for a document that is not in this business', () => withStore((store) => {
  const zuri = seedLibrary(store, SCOPE)
  const books = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)

  // An id that matches nothing at all.
  expectFailure(() => jobs.create(zuri.businessScope, 'no-such-document'), 'not_found')

  // A real document id, named from a business that does not hold it.
  expectFailure(() => jobs.create(books.businessScope, zuri.documentId), 'not_found')

  /*
   * The count is the half that matters. `not_found` thrown after a row had landed
   * would leave a job queued against another business's document.
   */
  assert.equal(storedJobCount(store), 0)
}))

/* ------------------------------------------------------------------ *
 * Running it
 * ------------------------------------------------------------------ */

test('start counts an attempt, moves the stage and keeps the first start time', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)

  const started = jobs.start(businessScope, created.id)
  assert.equal(started.status, 'running')
  assert.equal(started.stage, 'reading')
  assert.equal(started.attempts, 1)
  assert.notEqual(started.startedAt, null)

  /*
   * A second start is what a restart after an interruption does. The attempt count is
   * meant to climb - that is how a screen warns a file keeps failing - while the start
   * time stays at the first run, so the elapsed time is not reset while it climbs.
   */
  const again = jobs.start(businessScope, created.id)
  assert.equal(again.attempts, 2)
  assert.equal(again.startedAt, started.startedAt)
  assert.deepEqual(jobs.get(businessScope, created.id), again)
}))

test('progress moves forward and is stored', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)
  jobs.start(businessScope, created.id)

  const chunking = jobs.progress(businessScope, created.id, { stage: 'chunking', progress: 40 })
  assert.equal(chunking.progress, 40)
  assert.equal(chunking.stage, 'chunking')
  assert.equal(chunking.status, 'running')
  assert.deepEqual(jobs.get(businessScope, created.id), chunking)

  // The same percentage with a later stage is real progress, not a repeat: indexing
  // forty percent of the way through is a different screen from chunking there.
  const indexing = jobs.progress(businessScope, created.id, { stage: 'indexing', progress: 40 })
  assert.equal(indexing.stage, 'indexing')
  assert.equal(indexing.progress, 40)
  assert.deepEqual(jobs.get(businessScope, created.id), indexing)
}))

test('a report that would rewind progress is refused and changes nothing', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)
  jobs.start(businessScope, created.id)
  const advanced = jobs.progress(businessScope, created.id, { stage: 'indexing', progress: 60 })

  // The slow call about an early page answering after the fast one about a late page.
  expectFailure(
    () => jobs.progress(businessScope, created.id, { stage: 'extracting', progress: 20 }),
    'invalid_request',
  )

  /*
   * The stage is asserted too, because the statement moves the label and the bar
   * together. A refused report that still advanced the stage would show "indexing"
   * over a bar that had not moved.
   */
  const kept = jobs.get(businessScope, created.id)
  assert.deepEqual(kept, advanced)
  assert.equal(kept.stage, 'indexing')
  assert.equal(kept.progress, 60)
}))

test('progress outside nought to a hundred is refused', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)
  jobs.start(businessScope, created.id)

  for (const refused of [101, -1, 50.5]) {
    expectFailure(
      () => jobs.progress(businessScope, created.id, { stage: 'chunking', progress: refused }),
      'invalid_request',
    )
  }

  // A stage the contract does not name is refused for the same reason: the column is
  // free text and the row shape would only catch it on the way back out.
  expectFailure(
    () => jobs.progress(businessScope, created.id, { stage: 'summarising', progress: 10 }),
    'invalid_request',
  )

  assert.equal(jobs.get(businessScope, created.id).progress, 0)
}))

/* ------------------------------------------------------------------ *
 * Finishing it
 * ------------------------------------------------------------------ */

test('complete sets done, full progress and a finished time', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)
  jobs.start(businessScope, created.id)
  jobs.progress(businessScope, created.id, { stage: 'indexing', progress: 90 })

  const done = jobs.complete(businessScope, created.id)
  assert.equal(done.status, 'done')
  assert.equal(done.stage, 'done')
  assert.equal(done.progress, 100)
  assert.equal(done.failure, null)
  assert.notEqual(done.finishedAt, null)
  assert.deepEqual(jobs.get(businessScope, created.id), done)

  // Nothing left to resume, so the restart list no longer holds it.
  assert.deepEqual(jobs.listPending(businessScope), [])
}))

test('fail stores the token and the failed status', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const created = jobs.create(businessScope, documentId)
  jobs.start(businessScope, created.id)

  const failed = jobs.fail(businessScope, created.id, 'too_large')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.stage, 'failed')
  assert.equal(failed.failure, 'too_large')
  assert.notEqual(failed.finishedAt, null)
  assert.deepEqual(jobs.get(businessScope, created.id), failed)

  // A token outside the contract is refused rather than stored, because the row shape
  // would turn it into an internal error on every later read.
  expectFailure(() => jobs.fail(businessScope, created.id, 'went_wrong'), 'invalid_request')
  assert.equal(jobs.get(businessScope, created.id).failure, 'too_large')
}))

/* ------------------------------------------------------------------ *
 * What a restart reads
 * ------------------------------------------------------------------ */

test('listPending holds the unfinished jobs, oldest first, up to the limit', () => withStore((store) => {
  const { businessScope, documentId } = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)

  const first = jobs.create(businessScope, documentId)
  const second = jobs.create(businessScope, documentId)
  const third = jobs.create(businessScope, documentId)
  const fourth = jobs.create(businessScope, documentId)

  // One running, one finished: only the first belongs in the restart list.
  jobs.start(businessScope, second.id)
  jobs.complete(businessScope, first.id)
  jobs.fail(businessScope, fourth.id, 'unreadable')

  const pending = jobs.listPending(businessScope)
  assert.deepEqual(pending.map((row) => row.id), [second.id, third.id])
  assert.deepEqual(pending.map((row) => row.status), ['running', 'queued'])

  // The oldest of the two is the one a restart has to pick up first.
  assert.deepEqual(jobs.listPending(businessScope, 1).map((row) => row.id), [second.id])

  // A limit that asks for nothing, or for more than this read is allowed to return,
  // is refused rather than silently clamped.
  expectFailure(() => jobs.listPending(businessScope, 0), 'invalid_request')
  expectFailure(() => jobs.listPending(businessScope, 501), 'invalid_request')
}))

/* ------------------------------------------------------------------ *
 * Between two businesses
 * ------------------------------------------------------------------ */

test('a job in one business is invisible in another', () => withStore((store) => {
  const zuri = seedLibrary(store, SCOPE)
  const books = seedLibrary(store, SCOPE)
  const jobs = api.createDocumentJobRepository(store.ctx)
  const job = jobs.create(zuri.businessScope, zuri.documentId)

  /*
   * Both businesses are in one database file, which is the point: one signed-in
   * person, two businesses, and every method has to keep them apart. `not_found` is
   * the answer rather than `null` for the writes, because from here the job does not
   * exist and saying so is the same answer any unknown id gets.
   */
  assert.equal(jobs.get(books.businessScope, job.id), null)
  assert.equal(jobs.latestFor(books.businessScope, zuri.documentId), null)
  assert.deepEqual(jobs.listPending(books.businessScope), [])

  expectFailure(() => jobs.start(books.businessScope, job.id), 'not_found')
  expectFailure(
    () => jobs.progress(books.businessScope, job.id, { stage: 'chunking', progress: 50 }),
    'not_found',
  )
  expectFailure(() => jobs.complete(books.businessScope, job.id), 'not_found')
  expectFailure(() => jobs.fail(books.businessScope, job.id, 'unreadable'), 'not_found')

  // Untouched by all of that, which is the half a thrown error alone cannot prove.
  assert.deepEqual(jobs.get(zuri.businessScope, job.id), job)
}))
