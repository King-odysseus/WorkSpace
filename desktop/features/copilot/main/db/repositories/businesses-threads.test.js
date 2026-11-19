'use strict'

/*
 * The business and thread repositories, driven against a real database file.
 *
 * These two tables are where the assistant's own data starts, so the tests here
 * are about the properties that hold the rest of Phase 3 up rather than about
 * method-by-method coverage:
 *
 * - A thread belongs to one business and one account, and neither a wrong
 *   business id nor a wrong scope can reach it. The foreign key in the schema
 *   does not give that: it only proves an id exists somewhere, which is why
 *   `create` checks the business is in the caller's scope and every read names
 *   both. A test that only used correctly-scoped ids would never notice if one of
 *   those clauses were dropped.
 * - The plain text of a name or a title never reaches a column. That is checked
 *   by reading the raw column with a direct statement, because every read through
 *   the repository decrypts on the way out and would look identical either way.
 * - Search works at all. Titles are ciphertext, so a `LIKE` over the stored value
 *   matches nothing, silently; the case-insensitive in-memory filter is the
 *   behaviour these tests pin.
 * - A refusal is a `StorageError` carrying one of the fixed tokens, never a
 *   driver message, because the token is what a screen can act on.
 *
 * The database is a real file in the OS temp directory rather than an in-memory
 * one: `openDatabase` is the code that prepares a file (pragmas, migrations, the
 * key check), and a fake would prove only that the calls were made. WAL leaves two
 * side files beside the database, so the whole directory is removed on the way out.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

const SCOPE_A = { serverHost: 'a.test', userId: 1 }
const SCOPE_B = { serverHost: 'a.test', userId: 2 }

/* The plain text that must never be found in a column. */
const BUSINESS_NAME = 'Zuri Lofts'
const THREAD_TITLE = 'Invoice wording for the Lagos branch'

/**
 * The names these tests need from the bundle.
 *
 * The bundle only publishes what `features/copilot/main/ipc/index.ts` re-exports,
 * so a missing name is reported as the wiring step it is instead of surfacing as
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
  'createRepositoryContext',
  'createBusinessRepository',
  'createThreadRepository',
  'createKeyMaterial',
  'databaseKeyFromSecret',
  'StorageError',
  'STORAGE_FAILURES',
])

/**
 * A database file of its own, and the two repositories over it.
 *
 * A fresh key per test, so a row written by one test cannot be read back by
 * another even if a path were ever reused.
 */
function openStore (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuri-repositories-'))
  const filePath = path.join(dir, 'copilot.db')

  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  t.after(() => {
    // Close first: on Windows a WAL file that is still open keeps the directory
    // from being removed, and a leaked handle would fail the next run instead.
    opened.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const context = api.createRepositoryContext(opened.db, opened.cipher)
  return {
    db: opened.db,
    cipher: opened.cipher,
    businesses: api.createBusinessRepository(context),
    threads: api.createThreadRepository(context),
  }
}

/** A business scope, which is an account scope plus the business's own id. */
function businessScope (scope, businessId) {
  return { serverHost: scope.serverHost, userId: scope.userId, businessId }
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
 * Businesses
 * ------------------------------------------------------------------ */

test('two businesses in one scope are both listed and each is fetched by its own id', (t) => {
  const { businesses } = openStore(t)

  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const books = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 12, name: 'Tijha Books' })

  const listed = businesses.list(SCOPE_A)
  assert.deepEqual(listed.map((row) => row.id).sort(), [loft.id, books.id].sort())
  assert.deepEqual(listed.map((row) => row.name).sort(), ['Tijha Books', BUSINESS_NAME])

  // Two ids, two rows: a list that returned the first row twice would still pass
  // a length check, so the ids and the remote ids are compared too.
  assert.equal(businesses.get(SCOPE_A, loft.id).name, BUSINESS_NAME)
  assert.equal(businesses.get(SCOPE_A, loft.id).remoteWorkspaceId, 11)
  assert.equal(businesses.get(SCOPE_A, books.id).name, 'Tijha Books')
  assert.equal(businesses.get(SCOPE_A, books.id).remoteWorkspaceId, 12)
  assert.notEqual(loft.id, books.id)
})

test('upserting the same remote workspace twice keeps one row and updates the name', (t) => {
  const { businesses } = openStore(t)

  const first = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const again = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: 'Zuri Lofts Lagos' })

  assert.equal(again.id, first.id)
  assert.equal(again.name, 'Zuri Lofts Lagos')
  assert.equal(again.createdAt, first.createdAt)
  assert.equal(again.remoteWorkspaceId, 11)
  assert.deepEqual(businesses.list(SCOPE_A).map((row) => row.remoteWorkspaceId), [11])

  // The row is archived, then the workspace is mentioned again: a restored
  // workspace has to come back usable, or every thread attached to it is stuck
  // behind a flag nothing clears.
  const archived = businesses.archive(SCOPE_A, first.id)
  assert.equal(typeof archived.archivedAt, 'string')
  assert.equal(businesses.get(SCOPE_A, first.id).archivedAt, archived.archivedAt)

  const restored = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: 'Zuri Lofts Lagos' })
  assert.equal(restored.id, first.id)
  assert.equal(restored.archivedAt, null)
})

test('renaming a business changes its name and leaves its remote id alone', (t) => {
  const { businesses } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })

  const renamed = businesses.rename(SCOPE_A, loft.id, 'Zuri Lofts Ikeja')

  assert.equal(renamed.id, loft.id)
  assert.equal(renamed.name, 'Zuri Lofts Ikeja')
  assert.equal(renamed.remoteWorkspaceId, 11)
  assert.equal(businesses.get(SCOPE_A, loft.id).name, 'Zuri Lofts Ikeja')
})

/* ------------------------------------------------------------------ *
 * Scope and business isolation
 * ------------------------------------------------------------------ */

test('a thread created in one business never appears in another business', (t) => {
  const { businesses, threads } = openStore(t)

  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const books = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 12, name: 'Tijha Books' })
  const loftScope = businessScope(SCOPE_A, loft.id)
  const booksScope = businessScope(SCOPE_A, books.id)

  const inLoft = threads.create(loftScope, { title: THREAD_TITLE })

  assert.deepEqual(threads.list(booksScope), [])
  assert.equal(threads.find(booksScope, inLoft.id), null)

  // The id is real and belongs to the same account, so only the business clause
  // can be what refuses this read.
  expectFailure(() => threads.get(booksScope, inLoft.id), 'not_found')
  expectFailure(() => threads.setPinned(booksScope, inLoft.id, true), 'not_found')
  expectFailure(() => threads.close(booksScope, inLoft.id), 'not_found')

  // And the owner is unaffected by any of it.
  assert.equal(threads.get(loftScope, inLoft.id).title, THREAD_TITLE)
  assert.equal(threads.list(loftScope).length, 1)
})

test('two accounts on one server cannot see each other\'s businesses or threads', (t) => {
  const { businesses, threads } = openStore(t)

  const mine = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const myThread = threads.create(businessScope(SCOPE_A, mine.id), { title: THREAD_TITLE })

  // The second person is on the same server, and the workspace id is the same
  // number, yet nothing is visible: the scope is part of the row's identity.
  assert.deepEqual(businesses.list(SCOPE_B), [])
  expectFailure(() => businesses.get(SCOPE_B, mine.id), 'not_found')
  expectFailure(() => businesses.rename(SCOPE_B, mine.id, 'Not mine'), 'not_found')

  // Naming a business id from another account when creating a thread is refused
  // rather than filed under a row the caller cannot read.
  expectFailure(
    () => threads.create(businessScope(SCOPE_B, mine.id), { title: 'Hijack' }),
    'not_found',
  )
  expectFailure(() => threads.get(businessScope(SCOPE_B, mine.id), myThread.id), 'not_found')

  // The same workspace, seen by the other person, is a second row with a second id.
  const yours = businesses.upsert(SCOPE_B, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  assert.notEqual(yours.id, mine.id)
  assert.deepEqual(businesses.list(SCOPE_A).map((row) => row.id), [mine.id])
  assert.deepEqual(businesses.list(SCOPE_B).map((row) => row.id), [yours.id])
  expectFailure(() => businesses.get(SCOPE_A, yours.id), 'not_found')
  assert.deepEqual(threads.list(businessScope(SCOPE_B, yours.id)), [])
})

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

test('an untitled thread is stored under a readable placeholder rather than an empty title', (t) => {
  const { businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)

  const blank = threads.create(scope, { title: '   ' })
  const untitled = threads.create(scope, { title: '' })

  assert.equal(blank.title, 'New conversation')
  assert.equal(untitled.title, 'New conversation')
  assert.equal(blank.pinned, false)
  assert.equal(blank.closedAt, null)
  assert.equal(blank.messageCount, 0)
})

test('search finds a thread by a word in its title, ignoring case', (t) => {
  const { businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)

  threads.create(scope, { title: THREAD_TITLE })
  threads.create(scope, { title: 'Paint colours for the hallway' })

  assert.deepEqual(
    threads.list(scope, { search: 'INVOICE' }).map((row) => row.title),
    [THREAD_TITLE],
  )
  assert.deepEqual(
    threads.list(scope, { search: 'lagos' }).map((row) => row.title),
    [THREAD_TITLE],
  )

  // No match is an empty list, not "everything": a search that silently fell back
  // to the unfiltered list would look like a filter that did nothing.
  assert.deepEqual(threads.list(scope, { search: 'nothing matches this' }), [])

  // Whitespace alone is not a search, and neither is no options at all.
  assert.equal(threads.list(scope, { search: '   ' }).length, 2)
  assert.equal(threads.list(scope, {}).length, 2)
  assert.equal(threads.list(scope).length, 2)
})

test('pinning a thread puts it first in the list, and unpinning releases it', (t) => {
  const { businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)

  const oldest = threads.create(scope, { title: 'Rent roll for November' })
  threads.create(scope, { title: 'Paint colours for the hallway' })
  threads.create(scope, { title: 'Invoice wording for the Lagos branch' })

  // The pin is the leading sort key, so the oldest thread being first cannot be
  // an accident of the timestamps.
  const pinned = threads.setPinned(scope, oldest.id, true)
  assert.equal(pinned.pinned, true)

  const listed = threads.list(scope)
  assert.equal(listed.length, 3)
  assert.equal(listed[0].id, oldest.id)
  assert.equal(listed[0].pinned, true)

  threads.setPinned(scope, oldest.id, false)
  assert.equal(threads.list(scope).every((row) => row.pinned === false), true)
})

test('touching, closing and removing act on the row they name and nothing else', (t) => {
  const { db, cipher, businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)

  const kept = threads.create(scope, { title: THREAD_TITLE })
  const removed = threads.create(scope, { title: 'Paint colours for the hallway' })

  /*
   * A clock is injected for these three, because the default one may not advance
   * between two calls inside one test: without it, "touch moved the time" would
   * pass on a no-op write.
   */
  const later = api.createRepositoryContext(db, cipher, {
    now: () => '2099-01-01T00:00:00.000Z',
  })
  const clocked = api.createThreadRepository(later)

  clocked.touch(scope, kept.id)
  assert.equal(threads.get(scope, kept.id).updatedAt, '2099-01-01T00:00:00.000Z')

  const closed = clocked.close(scope, kept.id)
  assert.equal(closed.closedAt, '2099-01-01T00:00:00.000Z')
  assert.equal(closed.id, kept.id)

  clocked.remove(scope, removed.id)
  assert.deepEqual(threads.list(scope).map((row) => row.id), [kept.id])
  assert.equal(threads.find(scope, removed.id), null)

  // A second remove is not an error: the state the caller wanted already holds.
  clocked.remove(scope, removed.id)
})

test('a listed thread reports how many messages it holds, counted within its own scope', (t) => {
  requireBundle(['scopeKey'])

  const { db, cipher, businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)

  const busy = threads.create(scope, { title: THREAD_TITLE })
  const quiet = threads.create(scope, { title: 'Paint colours for the hallway' })

  const insert = db.prepare(
    'INSERT INTO message (id, scope_id, business_id, thread_id, seq, role, content_enc, provider, model, cloud, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const at = '2026-11-16T10:00:00.000Z'
  const body = cipher.seal('message.content_enc', 'a message body')

  insert.run('a1'.repeat(16), api.scopeKey(SCOPE_A), loft.id, busy.id, 1, 'user', body, null, null, null, at)
  insert.run('b2'.repeat(16), api.scopeKey(SCOPE_A), loft.id, busy.id, 2, 'assistant', body, 'deepseek', 'deepseek-chat', 1, at)
  insert.run('c3'.repeat(16), api.scopeKey(SCOPE_A), loft.id, quiet.id, 1, 'user', body, null, null, null, at)

  /*
   * A fourth row that points at the busy thread but is filed under the other
   * account. It is written by hand because no repository would produce it, and it
   * is the only way to prove the count's own scope clause is doing something.
   */
  insert.run('d4'.repeat(16), api.scopeKey(SCOPE_B), loft.id, busy.id, 3, 'user', body, null, null, null, at)

  const counted = new Map(threads.list(scope).map((row) => [row.id, row.messageCount]))
  assert.equal(counted.get(busy.id), 2)
  assert.equal(counted.get(quiet.id), 1)
  assert.equal(threads.get(scope, busy.id).messageCount, 2)
})

/* ------------------------------------------------------------------ *
 * What is on disk
 * ------------------------------------------------------------------ */

test('names and titles are stored as ciphertext, never as the text that was typed', (t) => {
  const { db, businesses, threads } = openStore(t)

  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const thread = threads.create(businessScope(SCOPE_A, loft.id), { title: THREAD_TITLE })

  // Read the column directly. Every read through the repository decrypts on the
  // way out, so only the raw value can show whether the plain text reached disk.
  const storedName = db.prepare('SELECT name_enc FROM business WHERE id = ?').get(loft.id).name_enc
  const storedTitle = db.prepare('SELECT title_enc FROM thread WHERE id = ?').get(thread.id).title_enc

  const pairs = [
    { stored: storedName, plaintext: BUSINESS_NAME, column: 'business.name_enc' },
    { stored: storedTitle, plaintext: THREAD_TITLE, column: 'thread.title_enc' },
  ]

  for (const { stored, plaintext, column } of pairs) {
    assert.equal(typeof stored, 'string', `${column} is not a string`)
    assert.equal(stored.includes(plaintext), false, `${column} carries the plain text`)
    // The envelope's own prefix, so a future format change fails here rather than
    // in whichever screen reads the row first.
    assert.ok(stored.startsWith('v1.'), `${column} is not a v1 envelope`)
  }

  // And the text does come back out through the repository, which is the half a
  // check for "not plaintext" alone would never prove.
  assert.equal(businesses.get(SCOPE_A, loft.id).name, BUSINESS_NAME)
  assert.equal(threads.get(businessScope(SCOPE_A, loft.id), thread.id).title, THREAD_TITLE)

  /*
   * Two threads with the same title must not share a stored value. If they did,
   * the column would be a deterministic hash of the title: searchable by anyone
   * holding the file, which is exactly what sealing it was meant to prevent.
   */
  const twin = threads.create(businessScope(SCOPE_A, loft.id), { title: THREAD_TITLE })
  const twinTitle = db.prepare('SELECT title_enc FROM thread WHERE id = ?').get(twin.id).title_enc
  assert.notEqual(twinTitle, storedTitle)
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('every refusal is a StorageError carrying one of the fixed failure tokens', (t) => {
  const { businesses, threads } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })
  const scope = businessScope(SCOPE_A, loft.id)
  const thread = threads.create(scope, { title: THREAD_TITLE })

  /* An id that is well formed and belongs to nobody: the answer is "not here". */
  const absent = 'f'.repeat(32)
  expectFailure(() => businesses.get(SCOPE_A, absent), 'not_found')
  expectFailure(() => businesses.rename(SCOPE_A, absent, 'Anything'), 'not_found')
  expectFailure(() => businesses.archive(SCOPE_A, absent), 'not_found')
  expectFailure(() => threads.get(scope, absent), 'not_found')
  expectFailure(() => threads.setPinned(scope, absent, true), 'not_found')
  expectFailure(() => threads.close(scope, absent), 'not_found')

  /*
   * Requests a screen should never send. Each is refused before a statement is
   * built, so none of them can write a row first and fail afterwards.
   */
  expectFailure(() => businesses.list({ serverHost: 'a.test' }), 'invalid_request')
  expectFailure(() => businesses.upsert(SCOPE_A, { remoteWorkspaceId: 0, name: 'No' }), 'invalid_request')
  expectFailure(() => businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: '   ' }), 'invalid_request')
  expectFailure(() => businesses.rename(SCOPE_A, loft.id, ''), 'invalid_request')
  expectFailure(() => threads.list({ serverHost: 'a.test', userId: 1 }), 'invalid_request')
  expectFailure(() => threads.create(scope, { title: 'x'.repeat(201) }), 'invalid_request')
  expectFailure(() => threads.create(scope, { title: THREAD_TITLE, pinned: 'yes' }), 'invalid_request')
  expectFailure(() => threads.setPinned(scope, thread.id, 'yes'), 'invalid_request')

  // Nothing above changed a row: the thread and the business are as they were.
  assert.equal(businesses.list(SCOPE_A).length, 1)
  assert.equal(businesses.get(SCOPE_A, loft.id).name, BUSINESS_NAME)
  assert.equal(threads.get(scope, thread.id).title, THREAD_TITLE)
  assert.equal(threads.list(scope).length, 1)
})

test('a refusal never repeats a row\'s text or a driver message', (t) => {
  const { businesses } = openStore(t)
  const loft = businesses.upsert(SCOPE_A, { remoteWorkspaceId: 11, name: BUSINESS_NAME })

  // The name is in the row this read cannot find in another scope, so a refusal
  // built from what it looked up would be the leak this check is for.
  try {
    businesses.get(SCOPE_B, loft.id)
    assert.fail('the read should have been refused')
  } catch (error) {
    assert.equal(error instanceof api.StorageError, true)
    assert.equal(error.message.includes(BUSINESS_NAME), false)
    assert.equal(error.message.includes('SQLITE'), false)
    assert.equal(error.message.includes('constraint'), false)
  }
})
