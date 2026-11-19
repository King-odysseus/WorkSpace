'use strict'

/*
 * The document repository, driven against a real database file.
 *
 * This is the table a person's own files are copied into, so the tests here are
 * about four properties rather than method-by-method coverage:
 *
 * - The bytes survive the round trip exactly. A PDF and a spreadsheet are not text,
 *   so the sample file below contains every byte value from 0x00 to 0xFF. A test
 *   that only used ASCII would keep passing if the blob were ever pushed through a
 *   string.
 * - The file is not readable on disk. The row goes into a writable file in the
 *   temporary directory, and nothing stops a reader from opening that file
 *   directly, so the proof has to be the disk itself: look for the plain text in
 *   every file SQLite left behind and find none of it. Every read through the
 *   repository decrypts on the way out and would look correct whether or not the
 *   bytes were sealed.
 * - A document belongs to one business. The scope clause is what makes an id from
 *   another business behave like an id that does not exist, and a test that only
 *   used correctly-scoped ids would never notice if a clause were dropped.
 * - A refusal is a `StorageError` carrying one of the fixed tokens, never a driver
 *   message, because the token is what a screen can act on.
 *
 * The database is a real file rather than an in-memory one: `openDatabase` is the
 * code that prepares a file (pragmas, migrations, the key check), and WAL leaves
 * side files beside it, which is why the whole directory is read and removed.
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
 * The bundle only publishes what `features/copilot/main/ipc/index.ts` re-exports, so
 * a missing name is reported as the wiring step it is instead of surfacing as
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
  'databaseKeyFromSecret',
  'createRepositoryContext',
  'createBusinessRepository',
  'createDocumentRepository',
  'documentRowSchema',
  'StorageError',
  'STORAGE_FAILURES',
])

/* One person on one server. Every business and document below is filed under these. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

const LOFT = 'Zuri Lofts'
const BOOKS = 'Tijha Books'

const DOC_NAME = 'Tilley quotation.pdf'

/* ------------------------------------------------------------------ *
 * The database and the businesses it holds
 * ------------------------------------------------------------------ */

/**
 * A clock that moves a second at a time.
 *
 * Real time is too coarse to order rows written a microsecond apart, and some of
 * these checks read a list that is ordered by `created_at`. A clock that steps means
 * the order comes from the data rather than from whichever row used up a timestamp
 * first.
 */
function steppingClock () {
  let ticks = 0
  return () => {
    ticks += 1
    return new Date(Date.UTC(2026, 10, 17, 9, 0, 0) + ticks * 1000).toISOString()
  }
}

/**
 * A database file of its own, and the repositories over it.
 *
 * A fresh key per test, so a row written by one test cannot be read back by another
 * even if a path were ever reused.
 */
function openStore (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-documents-'))
  const filePath = path.join(directory, 'store.db')

  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  let opened
  try {
    opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  } catch (error) {
    // A failed open leaves nothing to close, but the directory is already there.
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }

  t.after(() => {
    // Close first: on Windows a WAL file that is still open keeps the directory from
    // being removed, and a leaked handle would fail the next run instead.
    opened.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const context = api.createRepositoryContext(opened.db, opened.cipher, { now: steppingClock() })
  return {
    directory,
    filePath,
    db: opened.db,
    documents: api.createDocumentRepository(context),
    businesses: api.createBusinessRepository(context),
  }
}

/** A business scope, which is an account scope plus the business's own id. */
function businessScope (businessId) {
  return { serverHost: SCOPE.serverHost, userId: SCOPE.userId, businessId }
}

/** Two businesses in one database, so a cross-business read has somewhere to fail. */
function twoBusinesses (businesses) {
  const loft = businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: LOFT })
  const books = businesses.upsert(SCOPE, { remoteWorkspaceId: 12, name: BOOKS })
  return { loft: businessScope(loft.id), books: businessScope(books.id) }
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

/** The ids of a set of rows, sorted: a list's order is checked only where it matters. */
function idsOf (rows) {
  return rows.map((row) => row.id).sort()
}

function encode (text) {
  return new TextEncoder().encode(text)
}

function decode (bytes) {
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Every byte value once, then a readable line.
 *
 * All 256 values, because the interesting part is what a text round trip would
 * destroy: 0x00, the invalid UTF-8 lead bytes at 0x80 and up, and 0xFF.
 */
function sampleFile () {
  const bytes = new Uint8Array(256 + 12)
  for (let value = 0; value < 256; value += 1) bytes[value] = value
  bytes.set(encode('%PDF-1.7\n'), 256)
  return bytes
}

/**
 * Every file SQLite left in the directory, read as raw bytes.
 *
 * The side files matter: with WAL the newest writes live in `store.db-wal` until a
 * checkpoint folds them in, so reading only `store.db` could miss the row under test
 * and pass for the wrong reason.
 */
function filesBeside (directory) {
  return fs.readdirSync(directory).map((name) => ({
    name,
    bytes: fs.readFileSync(path.join(directory, name)),
  }))
}

/* ------------------------------------------------------------------ *
 * Create and read back
 * ------------------------------------------------------------------ */

test('create stores the file as uploaded and readBytes gives back exactly the bytes', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const content = sampleFile()
  const created = documents.create(loft, { name: DOC_NAME, kind: 'pdf', source: 'picked', bytes: content })

  assert.equal(created.name, DOC_NAME)
  assert.equal(created.kind, 'pdf')
  assert.equal(created.source, 'picked')
  assert.equal(created.status, 'uploaded')
  assert.equal(created.byteSize, content.length)

  // Nothing has read the file yet, so every field a later step fills is empty.
  assert.equal(created.pageCount, null)
  assert.equal(created.failure, null)
  assert.equal(created.readyAt, null)
  assert.equal(created.replacedBy, null)

  // A keyed digest, not the file: the row carries something a re-add can be compared
  // with, and it has to be the shape the contract states.
  assert.match(created.contentDigest, /^[0-9a-f]{16,64}$/)
  assert.doesNotThrow(() => api.documentRowSchema.parse(created))

  const read = documents.readBytes(loft, created.id)
  assert.ok(read instanceof Uint8Array, 'readBytes must hand back bytes, not a string')
  assert.equal(read.length, content.length)
  assert.deepEqual(Array.from(read), Array.from(content))
})

test('create refuses an empty name, an unknown kind and empty bytes without writing a row', (t) => {
  const { documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const bytes = encode('Rent roll for November\n')
  const base = { name: 'rent-roll.txt', kind: 'txt', source: 'picked', bytes }

  expectFailure(() => documents.create(loft, { ...base, name: '' }), 'invalid_request')
  expectFailure(() => documents.create(loft, { ...base, name: '   ' }), 'invalid_request')
  expectFailure(() => documents.create(loft, { ...base, name: 'a'.repeat(261) }), 'invalid_request')
  expectFailure(() => documents.create(loft, { ...base, kind: 'exe' }), 'invalid_request')
  expectFailure(() => documents.create(loft, { ...base, bytes: new Uint8Array(0) }), 'invalid_request')

  // Counted at the table rather than through `list`, because a refusal that left half
  // a row behind is exactly the kind of row a list might filter out.
  assert.deepEqual(documents.list(loft), [])
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM document').get().total), 0)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM document_blob').get().total), 0)
})

test('readBytes answers null for a document that is not there', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  assert.equal(documents.readBytes(loft, 'no-such-document'), null)
  assert.equal(documents.get(loft, 'no-such-document'), null)

  // A real id, in the same database, belonging to someone else: from this business
  // there is no such document, which is the answer `null` is for.
  const theirs = documents.create(books, { name: 'abuja-plans.pdf', kind: 'pdf', source: 'picked', bytes: encode('Plans\n') })
  assert.equal(documents.readBytes(loft, theirs.id), null)
  assert.equal(documents.get(loft, theirs.id), null)
  assert.equal(decode(documents.readBytes(books, theirs.id)), 'Plans\n')
})

/* ------------------------------------------------------------------ *
 * The digest an unchanged re-add is recognised by
 * ------------------------------------------------------------------ */

test('findByDigest finds a document by the digest of its bytes and finds nothing for another file', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const rentRoll = encode('Rent roll for November\n')
  const supplierList = encode('Supplier list for the Abuja site\n')

  const mine = documents.create(loft, { name: 'rent-roll.txt', kind: 'txt', source: 'picked', bytes: rentRoll })
  const theirs = documents.create(books, { name: 'suppliers.txt', kind: 'txt', source: 'picked', bytes: supplierList })

  // Different files, different digests: without this the next check could pass on a
  // digest that ignored its input.
  assert.notEqual(mine.contentDigest, theirs.contentDigest)

  const found = documents.findByDigest(loft, mine.contentDigest)
  assert.ok(found !== null, 'the digest of a stored file must find it')
  assert.equal(found.id, mine.id)

  // The digest of the other file is in neither business's library here, so it finds
  // nothing: a match on "any document" would return one of the two rows.
  assert.equal(documents.findByDigest(loft, theirs.contentDigest), null)
  assert.equal(documents.findByDigest(books, mine.contentDigest), null)
  assert.equal(documents.findByDigest(books, theirs.contentDigest).id, theirs.id)

  // The digest is taken over the bytes, so the same file arriving a second way carries
  // the same one. That is what lets the caller say "you already have this".
  const again = documents.create(loft, { name: 'rent-roll.txt', kind: 'txt', source: 'dropped', bytes: rentRoll })
  assert.equal(again.contentDigest, mine.contentDigest)
  const either = documents.findByDigest(loft, mine.contentDigest)
  assert.ok(either !== null && either.contentDigest === mine.contentDigest)

  expectFailure(() => documents.findByDigest(loft, ''), 'invalid_request')
})

/* ------------------------------------------------------------------ *
 * The four ingestion states
 * ------------------------------------------------------------------ */

test('markReading and markReady record the status and page count, and markFailed records the reason', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const created = documents.create(loft, { name: DOC_NAME, kind: 'pdf', source: 'picked', bytes: encode('Quotation\n') })

  const reading = documents.markReading(loft, created.id)
  assert.equal(reading.id, created.id)
  assert.equal(reading.status, 'reading')
  assert.equal(reading.pageCount, null)
  assert.equal(reading.failure, null)
  assert.equal(documents.get(loft, created.id).status, 'reading')

  const ready = documents.markReady(loft, created.id, 12)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.pageCount, 12)
  assert.equal(ready.failure, null)
  assert.equal(typeof ready.readyAt, 'string')

  // Stored, not only returned: the next screen reads the row back through `get`.
  const stored = documents.get(loft, created.id)
  assert.equal(stored.status, 'ready')
  assert.equal(stored.pageCount, 12)
  assert.equal(stored.failure, null)
  assert.equal(stored.readyAt, ready.readyAt)

  /*
   * A failed ingestion stores a token, never a parser's sentence: a parser message can
   * quote the file it could not read, and this string ends up in a log line.
   */
  const other = documents.create(loft, { name: 'scan.pdf', kind: 'pdf', source: 'picked', bytes: encode('Scan\n') })
  const failed = documents.markFailed(loft, other.id, 'unsupported')
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure, 'unsupported')
  assert.equal(documents.get(loft, other.id).failure, 'unsupported')

  // A reason outside the contract, or a page count that cannot exist, is refused.
  expectFailure(() => documents.markFailed(loft, other.id, 'parser said no'), 'invalid_request')
  expectFailure(() => documents.markReady(loft, other.id, -1), 'invalid_request')
  assert.equal(documents.get(loft, other.id).failure, 'unsupported')
})

test('markReady and markFailed on another business\'s document are refused and change nothing', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const mine = documents.create(loft, { name: DOC_NAME, kind: 'pdf', source: 'picked', bytes: encode('Quotation\n') })
  const before = documents.get(loft, mine.id)

  expectFailure(() => documents.markReading(books, mine.id), 'not_found')
  expectFailure(() => documents.markReady(books, mine.id, 3), 'not_found')
  expectFailure(() => documents.markFailed(books, mine.id, 'unreadable'), 'not_found')

  // The whole row, so a status, a page count or a timestamp that moved despite the
  // refusal is caught rather than just the status.
  assert.deepEqual(documents.get(loft, mine.id), before)
})

/* ------------------------------------------------------------------ *
 * Replacement
 * ------------------------------------------------------------------ */

test('replace points the old document at its replacement and leaves the old row readable', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const firstContent = encode('Tilley quotation, revision 1\n')
  const secondContent = encode('Tilley quotation, revision 2\n')
  const first = documents.create(loft, { name: 'tilley-quotation.pdf', kind: 'pdf', source: 'picked', bytes: firstContent })
  const second = documents.create(loft, { name: 'tilley-quotation-final.pdf', kind: 'pdf', source: 'picked', bytes: secondContent })

  const replaced = documents.replace(loft, first.id, second.id)

  assert.equal(replaced.id, first.id)
  assert.equal(replaced.replacedBy, second.id)
  assert.equal(documents.get(loft, first.id).replacedBy, second.id)
  assert.equal(documents.get(loft, second.id).replacedBy, null)

  /*
   * Still readable. A citation written against the older revision has to be able to
   * show the words it quoted, so the row and its stored copy both stay.
   */
  const old = documents.get(loft, first.id)
  assert.equal(old.name, 'tilley-quotation.pdf')
  assert.equal(decode(documents.readBytes(loft, first.id)), decode(firstContent))

  // What does change: the old file is no longer what an unchanged re-add matches, and
  // no longer part of the current library.
  assert.equal(documents.findByDigest(loft, first.contentDigest), null)
  assert.deepEqual(idsOf(documents.list(loft, { currentOnly: true })), [second.id])
  assert.deepEqual(idsOf(documents.list(loft)), [first.id, second.id].sort())

  // A document cannot replace itself, and cannot be replaced by another business's
  // document: that would point one business's row at content it may not read.
  expectFailure(() => documents.replace(loft, first.id, first.id), 'invalid_request')
  const theirs = documents.create(books, { name: 'abuja-plans.pdf', kind: 'pdf', source: 'picked', bytes: encode('Plans\n') })
  expectFailure(() => documents.replace(loft, second.id, theirs.id), 'not_found')
  assert.equal(documents.get(loft, second.id).replacedBy, null)
  assert.equal(documents.get(books, theirs.id).replacedBy, null)
})

/* ------------------------------------------------------------------ *
 * The bytes on disk
 * ------------------------------------------------------------------ */

test('the file itself is not readable in the database on disk', (t) => {
  const { documents, businesses, db, directory, filePath } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  /*
   * Two markers, one in the file's content and one in its name, in a form that cannot
   * be mistaken for a byte of SQLite's own structures.
   */
  const marker = 'ZURI-PLAINTEXT-MARKER-9c41f7'
  const nameMarker = 'q7-confidential-supplier-list.txt'
  const content = encode(`Supplier list for the Abuja site\n${marker}\nRent roll attached.\n`)

  const created = documents.create(loft, { name: nameMarker, kind: 'txt', source: 'dropped', bytes: content })

  // The positive control. Without it this test would pass on a database where the
  // write never happened at all.
  const read = documents.readBytes(loft, created.id)
  assert.ok(read !== null, 'the document must be readable back')
  assert.equal(decode(read).includes(marker), true, 'the marker has to come back out of the store')

  // The row is on disk: `id` is an ordinary column, so it is the one piece of this
  // document that is expected to be found in the clear.
  const files = filesBeside(directory)
  assert.ok(files.length >= 1, 'the database file has to exist')
  assert.ok(
    files.some((file) => file.bytes.includes(created.id)),
    `no file beside ${path.basename(filePath)} holds the document id, so this check would prove nothing`,
  )

  /*
   * And the plain text is nowhere in any of them. Every file in the directory, because
   * a write still in the WAL lives beside the database rather than in it; reading only
   * `store.db` would be a check of the wrong file.
   */
  for (const file of files) {
    assert.equal(file.bytes.includes(marker), false, `${file.name} holds the file's text in the clear`)
    assert.equal(file.bytes.includes(nameMarker), false, `${file.name} holds the file's name in the clear`)
  }

  // The stored column, read directly: a repository read decrypts on the way out and
  // would look the same either way, so the untouched column is checked too.
  const row = db.prepare('SELECT data_enc FROM document_blob WHERE document_id = ?').get(created.id)
  assert.ok(row !== undefined, 'the sealed copy has to be filed under the document id')
  const sealed = Buffer.from(row.data_enc)
  assert.ok(sealed.length > content.length, 'the stored copy carries an envelope, so it is longer than the file')
  assert.equal(sealed.includes(marker), false, 'the stored copy must not carry the file text')
  assert.equal(sealed.includes(Buffer.from(content.subarray(0, 16))), false, 'the first bytes of the file must not be on disk in the clear')
})

/* ------------------------------------------------------------------ *
 * Removal
 * ------------------------------------------------------------------ */

test('removing a document from another business is refused and leaves that business\'s row intact', (t) => {
  const { documents, businesses, db } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const content = encode('Supplier list for the Abuja site\n')
  const mine = documents.create(loft, { name: 'suppliers.txt', kind: 'txt', source: 'picked', bytes: content })

  const documentRows = () => Number(db.prepare('SELECT COUNT(*) AS total FROM document').get().total)
  const blobRows = () => Number(db.prepare('SELECT COUNT(*) AS total FROM document_blob').get().total)

  expectFailure(() => documents.remove(books, mine.id), 'not_found')

  // Counted, because a delete that ran with a weaker `WHERE` would raise nothing and
  // still be wrong: the owner's row and its sealed copy both have to be here.
  assert.equal(documentRows(), 1)
  assert.equal(blobRows(), 1)
  assert.equal(documents.get(loft, mine.id).name, 'suppliers.txt')
  assert.equal(decode(documents.readBytes(loft, mine.id)), decode(content))
  assert.deepEqual(idsOf(documents.list(loft)), [mine.id])

  // The same call from the business that owns it removes the row and, through the
  // schema's cascade, the copy filed under it.
  documents.remove(loft, mine.id)
  assert.equal(documents.get(loft, mine.id), null)
  assert.equal(documents.readBytes(loft, mine.id), null)
  assert.equal(documentRows(), 0)
  assert.equal(blobRows(), 0)
  assert.deepEqual(documents.list(loft), [])
})

/* ------------------------------------------------------------------ *
 * Listing
 * ------------------------------------------------------------------ */

test('list shows only this business, honours the status filter and can leave out replaced documents', (t) => {
  const { documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const uploaded = documents.create(loft, { name: 'lease.pdf', kind: 'pdf', source: 'picked', bytes: encode('Lease\n') })
  const ready = documents.create(loft, { name: 'rent-roll.csv', kind: 'csv', source: 'dropped', bytes: encode('month,amount\n') })
  documents.markReady(loft, ready.id, 3)
  const current = documents.create(loft, { name: 'quote.txt', kind: 'txt', source: 'picked', bytes: encode('Quote, revision 2\n') })
  const superseded = documents.create(loft, { name: 'quote-old.txt', kind: 'txt', source: 'picked', bytes: encode('Quote, revision 1\n') })
  documents.replace(loft, superseded.id, current.id)

  const theirs = documents.create(books, { name: 'abuja-plans.pdf', kind: 'pdf', source: 'picked', bytes: encode('Plans\n') })

  // Ordered newest first, which is the order the library screen shows, so the
  // sequence itself is asserted rather than only the set.
  assert.deepEqual(
    documents.list(loft).map((row) => row.id),
    [superseded.id, current.id, ready.id, uploaded.id],
  )
  assert.equal(documents.list(loft).some((row) => row.id === theirs.id), false)

  assert.deepEqual(idsOf(documents.list(loft, { status: 'ready' })), [ready.id])
  assert.deepEqual(
    idsOf(documents.list(loft, { status: 'uploaded' })),
    [uploaded.id, current.id, superseded.id].sort(),
  )
  assert.deepEqual(documents.list(loft, { status: 'failed' }), [])

  // The replaced document is a documented state, not a hidden one: it shows up in the
  // unfiltered list and drops out only when the caller asks for what is current.
  assert.deepEqual(
    idsOf(documents.list(loft, { currentOnly: true })),
    [uploaded.id, ready.id, current.id].sort(),
  )
  assert.deepEqual(idsOf(documents.list(loft, { status: 'ready', currentOnly: true })), [ready.id])

  assert.equal(documents.list(loft, { limit: 2 }).length, 2)
  assert.equal(documents.list(loft, { limit: 4 }).length, 4)

  assert.deepEqual(idsOf(documents.list(books)), [theirs.id])

  // A status outside the four states, and a limit outside the allowed range, are
  // refused rather than silently ignored or passed to the database.
  expectFailure(() => documents.list(loft, { status: 'ingesting' }), 'invalid_request')
  expectFailure(() => documents.list(loft, { limit: 0 }), 'invalid_request')
  expectFailure(() => documents.list(loft, { limit: 501 }), 'invalid_request')
})
