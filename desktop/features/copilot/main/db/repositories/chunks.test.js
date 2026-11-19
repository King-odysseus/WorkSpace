'use strict'

/*
 * Chunks: the text, the keyword index built from digests, and the sealed vectors.
 *
 * Three properties are what this file exists for, and none of them can be seen through
 * a repository read:
 *
 * - The text is sealed. A read through `list` decrypts on the way out and would look
 *   identical whether the column held ciphertext or plaintext, so the proof has to be
 *   the disk: the chunk's own id is found in the files beside the database (which is
 *   what shows the write reached them) and the words of the chunk are found in none of
 *   them.
 * - The index holds digests, not words. `chunk_term` is what makes a chunk findable,
 *   and it would be the whole library in the clear if a word were ever stored there.
 *   The column is therefore read directly and searched for the marker word.
 * - A chunk belongs to one business. Every id that names a document or a chunk comes
 *   from somewhere else, and the answer has to be `not_found` rather than another
 *   business's row: a chunk is document content reached by a second route.
 *
 * The rest is ordinary repository coverage: ordinal order, the page and section a
 * citation points at, the token sum section 10.3 needs, replacement, and the
 * stale-model marking that keeps search working while vectors are rebuilt.
 *
 * The database is a real file, opened and laid out exactly as `documents.test.js`
 * opens it: `openDatabase` is the code that sets the pragmas, runs the migrations and
 * checks the key, and WAL leaves side files that have to be read and removed too.
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
  'databaseKeyFromSecret',
  'createRepositoryContext',
  'createBusinessRepository',
  'createDocumentRepository',
  'createChunkRepository',
  'chunkRowSchema',
  'StorageError',
  'STORAGE_FAILURES',
])

/* One person on one server. Every business and document below is filed under these. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

const LOFT = 'Zuri Lofts'
const BOOKS = 'Tijha Books'

const DOC_NAME = 'Tilley quotation.pdf'

/*
 * A word that appears nowhere else in the fixture, so finding it anywhere outside the
 * sealed column would be unambiguous. Long enough to be indexed, which is the point:
 * it has to be in the data, and in none of the files.
 */
const MARKER = 'kestrelmarker'

/* 16 bytes of a keyed HMAC-SHA256, as hex: what the keyword index stores per word. */
const DIGEST = /^[0-9a-f]{32}$/

/* ------------------------------------------------------------------ *
 * The database and the businesses it holds
 * ------------------------------------------------------------------ */

/**
 * A clock that moves a second at a time.
 *
 * Real time is too coarse to order rows written a microsecond apart, and a chunk's
 * `created_at` is written from this clock, so a stepping one keeps the timestamps
 * distinct rather than repeating the same instant across a whole test.
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-chunks-'))
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
    chunks: api.createChunkRepository(context),
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

function encode (text) {
  return new TextEncoder().encode(text)
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

/** The names of the files holding this string in any encoding SQLite might have used. */
function filesHolding (directory, text) {
  const needles = [Buffer.from(text, 'utf8'), Buffer.from(text, 'utf16le')]
  return filesBeside(directory)
    .filter((file) => needles.some((needle) => file.bytes.includes(needle)))
    .map((file) => file.name)
}

/** A document to hang chunks on: the parent every chunk insert selects from. */
function makeDocument (documents, scope, name, bytes = 'Quotation, revision 1\n') {
  return documents.create(scope, { name, kind: 'txt', source: 'picked', bytes: encode(bytes) })
}

/* ------------------------------------------------------------------ *
 * Writing and reading back
 * ------------------------------------------------------------------ */

test('replaceForDocument stores chunks in ordinal order with their page and section, and list opens the text', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)
  const document = makeDocument(documents, loft, DOC_NAME)

  const written = chunks.replaceForDocument(loft, document.id, [
    { text: 'Terms of the quotation.', page: 1, section: 'Terms', tokens: 6 },
    { text: 'The rent roll for November.', page: 2, section: 'Rent roll', tokens: 7 },
    // A plain text file has neither a page nor a section, and both stay null.
    { text: 'Signed for and on behalf of Zuri Lofts.', page: null, tokens: 9 },
  ])

  assert.equal(written.inserted, 3)

  // One digest row per distinct searchable word, and no more: the count the ingestion
  // report quotes has to be what the index actually holds.
  const termRows = Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_term').get().total)
  assert.equal(written.terms, termRows)
  assert.ok(termRows >= 10, `the index should hold a row per distinct word, saw ${termRows}`)

  const rows = chunks.list(loft, document.id)

  // Ordinal order is what a citation's "page 2 of the document" depends on, so the
  // sequence is asserted rather than only the set.
  assert.deepEqual(rows.map((row) => row.ordinal), [0, 1, 2])
  assert.equal(new Set(rows.map((row) => row.id)).size, 3)
  assert.equal(rows.every((row) => row.documentId === document.id), true)

  const [first, second, third] = rows

  // The text comes back opened, and with the outer whitespace trimmed on the way in.
  assert.equal(first.text, 'Terms of the quotation.')
  assert.equal(first.page, 1)
  assert.equal(first.section, 'Terms')
  assert.equal(first.tokens, 6)

  assert.equal(second.text, 'The rent roll for November.')
  assert.equal(second.page, 2)
  assert.equal(second.section, 'Rent roll')
  assert.equal(second.tokens, 7)

  assert.equal(third.text, 'Signed for and on behalf of Zuri Lofts.')
  assert.equal(third.page, null)
  assert.equal(third.section, null)
  assert.deepEqual(rows.map((row) => row.tokens), [6, 7, 9])

  // Nothing has embedded these yet, so the row says so rather than claiming a vector.
  assert.deepEqual(rows.map((row) => row.embedModel), [null, null, null])
  assert.deepEqual(rows.map((row) => row.embedState), ['current', 'current', 'current'])

  for (const row of rows) assert.doesNotThrow(() => api.chunkRowSchema.parse(row))

  // One row by id, and nothing for an id that is not there.
  assert.deepEqual(chunks.get(loft, second.id), second)
  assert.equal(chunks.get(loft, 'no-such-chunk'), null)
})

test('tokensForDocument sums the token counts and countForDocument counts the rows', (t) => {
  const { chunks, documents, businesses } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const document = makeDocument(documents, loft, DOC_NAME)
  chunks.replaceForDocument(loft, document.id, [
    { text: 'Terms of the quotation.', page: 1, section: 'Terms', tokens: 12 },
    { text: 'The rent roll for November.', page: 2, section: 'Rent roll', tokens: 9 },
  ])

  assert.equal(chunks.countForDocument(loft, document.id), 2)
  assert.equal(chunks.tokensForDocument(loft, document.id), 21)

  // A document with no chunks yet answers zero rather than null or a driver error:
  // section 10.3's decision reads this before ingestion has run.
  const untouched = makeDocument(documents, loft, 'untouched.pdf')
  assert.equal(chunks.countForDocument(loft, untouched.id), 0)
  assert.equal(chunks.tokensForDocument(loft, untouched.id), 0)

  // A chunk that estimated no tokens is a real row: the sum stays zero and the count
  // does not, so a screen can tell "nothing to read" from "nothing read yet".
  const empty = makeDocument(documents, loft, 'empty.pdf')
  chunks.replaceForDocument(loft, empty.id, [{ text: 'A cover sheet with no words worth counting.', tokens: 0 }])
  assert.equal(chunks.countForDocument(loft, empty.id), 1)
  assert.equal(chunks.tokensForDocument(loft, empty.id), 0)
})

/* ------------------------------------------------------------------ *
 * Replacement
 * ------------------------------------------------------------------ */

test('a second replaceForDocument replaces the old chunks completely', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)
  const document = makeDocument(documents, loft, DOC_NAME)

  const first = chunks.replaceForDocument(loft, document.id, [
    { text: 'The Tilley quotation expires on Friday.', page: 1, section: 'Terms', tokens: 11 },
    { text: 'Signed by the landlord of Zuri Lofts.', page: 2, section: 'Signature', tokens: 8 },
  ])
  assert.equal(first.inserted, 2)

  const firstRows = chunks.list(loft, document.id)
  const firstIds = firstRows.map((row) => row.id)

  // A vector written for the old set, so the replacement's effect on it is observable.
  chunks.putVector(loft, firstIds[0], 'embed-model-1', [1, 0, -2])

  const second = chunks.replaceForDocument(loft, document.id, [
    { text: 'Revision 2 of the quotation, signed on Monday.', page: 1, section: 'Terms', tokens: 10 },
  ])
  assert.equal(second.inserted, 1)

  const after = chunks.list(loft, document.id)
  assert.equal(after.length, 1)
  assert.equal(after[0].ordinal, 0)
  assert.equal(after[0].text, 'Revision 2 of the quotation, signed on Monday.')

  // New rows, not the old ones rewritten: the ids an earlier citation quoted are gone.
  assert.equal(firstIds.includes(after[0].id), false)
  for (const id of firstIds) {
    assert.equal(chunks.get(loft, id), null)
    assert.equal(chunks.getVector(loft, id), null)
  }

  assert.equal(chunks.countForDocument(loft, document.id), 1)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM chunk WHERE document_id = ?').get(document.id).total), 1)
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_vector').get().total), 0)

  // The index belongs to the set it was built from: a word only the first set
  // contained must not still point at a chunk that no longer says it.
  assert.deepEqual(chunks.searchTerms(loft, ['landlord']), [])
  assert.deepEqual(chunks.searchTerms(loft, ['quotation']).map((hit) => hit.chunkId), [after[0].id])

  // And the index rows are the new set's, no leftovers under the document.
  const termRows = Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_term WHERE document_id = ?').get(document.id).total)
  assert.equal(termRows, second.terms)
})

/* ------------------------------------------------------------------ *
 * One business
 * ------------------------------------------------------------------ */

test('replaceForDocument refuses another business\'s document with not_found and writes nothing', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const theirs = makeDocument(documents, books, 'abuja-plans.txt', 'Plans for the Abuja site\n')
  chunks.replaceForDocument(books, theirs.id, [
    { text: 'The Abuja site plans and the Tilley survey.', page: 1, section: 'Plans', tokens: 10 },
  ])

  const before = chunks.list(books, theirs.id)
  const chunkRows = () => Number(db.prepare('SELECT COUNT(*) AS total FROM chunk').get().total)
  const termRows = () => Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_term').get().total)
  const chunksBefore = chunkRows()
  const termsBefore = termRows()

  // The loft business naming the books business's document: from here there is no such
  // document, which is the answer this layer gives everywhere else.
  expectFailure(
    () => chunks.replaceForDocument(loft, theirs.id, [
      { text: 'Written by the wrong business entirely.', page: 1, section: 'Wrong', tokens: 6 },
    ]),
    'not_found',
  )

  // Nothing written, and nothing of the owner's disturbed: neither the rows nor the
  // index changed, which a clear-then-insert would have broken had the clear run wider.
  assert.equal(chunkRows(), chunksBefore)
  assert.equal(termRows(), termsBefore)
  assert.deepEqual(chunks.list(books, theirs.id), before)
  assert.deepEqual(chunks.list(loft, theirs.id), [])
  assert.equal(chunks.countForDocument(loft, theirs.id), 0)
  assert.equal(chunks.tokensForDocument(loft, theirs.id), 0)

  // The refused text is not searchable by either business afterwards.
  assert.deepEqual(chunks.searchTerms(loft, ['wrong']), [])
  assert.deepEqual(chunks.searchTerms(books, ['wrong']), [])

  // A document that does not exist at all answers the same way, so a caller cannot
  // tell "another business's" from "gone" by the failure token.
  expectFailure(
    () => chunks.replaceForDocument(loft, 'no-such-document', [
      { text: 'Nothing for this to belong to.', page: 1, section: 'None', tokens: 4 },
    ]),
    'not_found',
  )
  assert.equal(chunkRows(), chunksBefore)
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('replaceForDocument refuses an empty chunk text and a negative token count', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)
  const document = makeDocument(documents, loft, DOC_NAME)

  chunks.replaceForDocument(loft, document.id, [
    { text: 'The set written before the refusals.', page: 1, section: 'Terms', tokens: 5 },
    { text: 'A second chunk, so a partial write would show.', page: 2, section: 'Notes', tokens: 6 },
  ])
  const before = chunks.list(loft, document.id)

  expectFailure(
    () => chunks.replaceForDocument(loft, document.id, [{ text: '', tokens: 1 }]),
    'invalid_request',
  )
  expectFailure(
    () => chunks.replaceForDocument(loft, document.id, [{ text: '   ', tokens: 1 }]),
    'invalid_request',
  )
  expectFailure(
    () => chunks.replaceForDocument(loft, document.id, [{ text: 'A negative count.', tokens: -1 }]),
    'invalid_request',
  )
  expectFailure(
    () => chunks.replaceForDocument(loft, document.id, [{ text: 'Not a number.', tokens: 1.5 }]),
    'invalid_request',
  )

  // The bad chunk is last, so a loop that wrote as it validated would have committed
  // the first. A refusal is the whole call, not the tail of it.
  expectFailure(
    () => chunks.replaceForDocument(loft, document.id, [
      { text: 'Fine so far.', page: 1, section: 'Terms', tokens: 2 },
      { text: '', page: 2, section: 'Notes', tokens: 3 },
    ]),
    'invalid_request',
  )

  // Rolled back rather than half applied: the set from before the refusals is intact,
  // with its own ids, and the index still points only at it.
  assert.deepEqual(chunks.list(loft, document.id), before)
  assert.equal(chunks.countForDocument(loft, document.id), 2)
  assert.deepEqual(chunks.searchTerms(loft, ['fine']), [])
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM chunk').get().total), 2)

  // Zero tokens is allowed: the refusal is about a negative count, not a small chunk.
  const zero = chunks.replaceForDocument(loft, document.id, [{ text: 'No estimate yet.', tokens: 0 }])
  assert.equal(zero.inserted, 1)
  assert.equal(chunks.tokensForDocument(loft, document.id), 0)
})

/* ------------------------------------------------------------------ *
 * The keyword index
 * ------------------------------------------------------------------ */

test('searchTerms finds the chunk holding a word, and never another business\'s chunk', (t) => {
  const { chunks, documents, businesses } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const mine = makeDocument(documents, loft, DOC_NAME)
  chunks.replaceForDocument(loft, mine.id, [
    { text: 'The Tilley quotation expires on Friday. Friday is the deadline.', page: 1, section: 'Terms', tokens: 12 },
    { text: 'Rent roll for November covers the Abuja site.', page: 2, section: 'Rent roll', tokens: 9 },
  ])

  const theirs = makeDocument(documents, books, 'tilley-notes.txt', 'Tilley is a client of the books business\n')
  chunks.replaceForDocument(books, theirs.id, [
    { text: 'Tilley is a client of the books business.', page: 1, section: 'Clients', tokens: 8 },
  ])

  const ordinalOf = new Map(chunks.list(loft, mine.id).map((row) => [row.id, row.ordinal]))

  const found = chunks.searchTerms(loft, ['tilley'])
  assert.equal(found.length, 1, 'only the loft chunk holds this word')
  assert.equal(found[0].documentId, mine.id)
  assert.equal(ordinalOf.get(found[0].chunkId), 0)
  assert.equal(found[0].score, 1)

  // The same word in the other business's chunk is not a hit here, even though the
  // digest is the same: the scope clause is the whole of that separation.
  assert.equal(chunks.searchTerms(loft, ['tilley']).some((hit) => hit.documentId === theirs.id), false)
  const theirHits = chunks.searchTerms(books, ['tilley'])
  assert.equal(theirHits.length, 1)
  assert.equal(theirHits[0].documentId, theirs.id)

  // Occurrences are what the score is: the second "Friday" in the same chunk counts.
  const friday = chunks.searchTerms(loft, ['friday'])
  assert.equal(friday.length, 1)
  assert.equal(friday[0].score, 2)

  // A query is a word, not a digest and not a case: the caller's spelling is folded the
  // same way the text was.
  assert.deepEqual(chunks.searchTerms(loft, ['TILLEY']), found)
  assert.deepEqual(chunks.searchTerms(loft, ['  Tilley  ']), found)

  // Two words reach two chunks, one each.
  const both = chunks.searchTerms(loft, ['tilley', 'abuja'])
  assert.deepEqual(both.map((hit) => ordinalOf.get(hit.chunkId)).sort(), [0, 1])
})

test('searchTerms answers nothing for an unknown word and for a word shorter than three characters', (t) => {
  const { chunks, documents, businesses } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const document = makeDocument(documents, loft, DOC_NAME)
  chunks.replaceForDocument(loft, document.id, [
    { text: 'The Tilley quotation expires on Friday.', page: 1, section: 'Terms', tokens: 11 },
  ])

  // In no chunk anywhere.
  assert.deepEqual(chunks.searchTerms(loft, ['pomegranate']), [])

  // Below the three-character floor the index holds nothing, by design: "a" and "of"
  // would match everything and rank nothing.
  assert.deepEqual(chunks.searchTerms(loft, ['ab']), [])
  assert.deepEqual(chunks.searchTerms(loft, ['']), [])

  // Nothing asked is nothing found, rather than a query that matches every row.
  assert.deepEqual(chunks.searchTerms(loft, []), [])

  // A short word is skipped, not fatal: the useful half of the query still answers.
  assert.equal(chunks.searchTerms(loft, ['ab', 'tilley']).length, 1)

  // A limit outside what the query can carry is refused rather than passed through.
  expectFailure(() => chunks.searchTerms(loft, ['tilley'], 0), 'invalid_request')
})

/* ------------------------------------------------------------------ *
 * What is on disk
 * ------------------------------------------------------------------ */

test('the chunk text and the keyword index are not readable on disk', (t) => {
  const { chunks, documents, businesses, db, directory, filePath } = openStore(t)
  const { loft } = twoBusinesses(businesses)

  const document = makeDocument(documents, loft, 'survey-notes.txt', 'Survey notes\n')
  const text = `The ${MARKER} report covers the Abuja site.`
  chunks.replaceForDocument(loft, document.id, [
    { text, page: 3, section: 'Site notes', tokens: 8 },
  ])

  const stored = chunks.list(loft, document.id)
  assert.equal(stored.length, 1)

  // The positive controls. Without them this test would pass on a database where the
  // write never happened, or where the word was never indexed.
  assert.equal(stored[0].text, text, 'the marker has to come back out of the store')
  assert.deepEqual(
    chunks.searchTerms(loft, [MARKER]).map((hit) => hit.documentId),
    [document.id],
    'the marker has to be findable, which is what puts it in the index',
  )

  /* ---------------------------------------------------------------- *
   * The two columns, read past the repository
   * ---------------------------------------------------------------- */

  const chunkRow = db.prepare('SELECT text_enc FROM chunk WHERE document_id = ?').get(document.id)
  assert.ok(chunkRow !== undefined, 'the chunk row has to exist')
  const sealedText = String(chunkRow.text_enc)
  assert.match(sealedText, /^v1\.[A-Za-z0-9+/=]+$/, 'the text column holds an envelope, not a sentence')
  assert.equal(sealedText.toLowerCase().includes(MARKER), false, 'the text column must not carry the words')

  // The index: one row per distinct word, each row a digest. A word stored here would
  // be the document library in the clear, which is the whole reason for the digests.
  const terms = db
    .prepare('SELECT term FROM chunk_term WHERE document_id = ?')
    .all(document.id)
    .map((row) => String(row.term))
  assert.ok(terms.length >= 4, `the index should hold a row per distinct word, saw ${terms.length}`)
  assert.deepEqual(terms.filter((term) => term.toLowerCase().includes(MARKER)), [])
  for (const term of terms) assert.match(term, DIGEST)

  /* ---------------------------------------------------------------- *
   * The files themselves
   * ---------------------------------------------------------------- */

  const files = filesBeside(directory)
  assert.ok(files.length >= 1, 'the database file has to exist')

  /*
   * The row really did reach disk: `id` is an ordinary column, so the chunk id is the
   * one piece of this row expected to be found in the clear. Without this the check
   * below would prove nothing about a write that never landed.
   */
  const idOnDisk = files.some((file) => file.bytes.includes(Buffer.from(stored[0].id, 'utf8')))
  assert.ok(
    idOnDisk,
    `no file beside ${path.basename(filePath)} holds the chunk id, so this check would prove nothing`,
  )

  // And the words are in none of them, in either encoding SQLite might have used.
  assert.deepEqual(filesHolding(directory, MARKER), [])
  assert.deepEqual(filesHolding(directory, 'Abuja site.'), [])
})

/* ------------------------------------------------------------------ *
 * Vectors
 * ------------------------------------------------------------------ */

test('putVector stores a vector and getVector returns the same numbers', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)
  const document = makeDocument(documents, loft, DOC_NAME)

  chunks.replaceForDocument(loft, document.id, [
    { text: 'Terms of the quotation.', page: 1, section: 'Terms', tokens: 6 },
    { text: 'The rent roll for November.', page: 2, section: 'Rent roll', tokens: 7 },
  ])
  const [first, second] = chunks.list(loft, document.id)

  // Integers, so float32 represents them exactly and the round trip can be compared
  // without a tolerance hiding a real change.
  const vector = [1, 0, -2, 7]
  chunks.putVector(loft, first.id, 'embed-model-1', vector)

  const read = chunks.getVector(loft, first.id)
  assert.ok(read !== null, 'a stored vector has to come back')
  assert.equal(read.model, 'embed-model-1')
  assert.deepEqual(read.vector, vector)

  // Sealed, not the float bytes: the sealed blob is the envelope's fixed cost plus the
  // vector, and the plain encoding appears nowhere in it.
  const row = db.prepare('SELECT dims, vec_enc FROM chunk_vector WHERE chunk_id = ?').get(first.id)
  assert.ok(row !== undefined, 'the vector row has to exist')
  assert.equal(Number(row.dims), 4)
  const sealed = Buffer.from(row.vec_enc)
  assert.equal(sealed.length, 12 + 16 + vector.length * 4)
  const plain = Buffer.from(new Float32Array(vector).buffer)
  assert.equal(sealed.includes(plain), false, 'the floats must not be readable in the blob')

  // A second write for the same chunk replaces the vector rather than adding a row, and
  // the model moves with it: two models' vectors in one column would be incomparable.
  chunks.putVector(loft, first.id, 'embed-model-2', [3, -4, 0])
  const replaced = chunks.getVector(loft, first.id)
  assert.equal(replaced.model, 'embed-model-2')
  assert.deepEqual(replaced.vector, [3, -4, 0])
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_vector').get().total), 1)

  // A chunk with no vector says so, rather than answering an empty one.
  assert.equal(chunks.getVector(loft, second.id), null)

  // The chunk itself is untouched by any of this: the text does not depend on a vector.
  assert.equal(chunks.get(loft, first.id).text, 'Terms of the quotation.')
  assert.equal(chunks.get(loft, first.id).embedModel, null)
})

test('getVector answers null for another business\'s chunk and putVector for it is refused', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft, books } = twoBusinesses(businesses)

  const theirs = makeDocument(documents, books, 'abuja-plans.txt', 'Plans for the Abuja site\n')
  chunks.replaceForDocument(books, theirs.id, [
    { text: 'The Abuja site plans.', page: 1, section: 'Plans', tokens: 5 },
  ])
  const theirChunk = chunks.list(books, theirs.id)[0]

  chunks.putVector(books, theirChunk.id, 'embed-model-1', [1, 0, -2])
  assert.deepEqual(chunks.getVector(books, theirChunk.id).vector, [1, 0, -2])

  // From the other business this chunk does not exist, so there is no vector to read.
  assert.equal(chunks.getVector(loft, theirChunk.id), null)
  assert.equal(chunks.get(loft, theirChunk.id), null)

  expectFailure(() => chunks.putVector(loft, theirChunk.id, 'embed-model-1', [9, 9, 9]), 'not_found')

  // Refused, and the owner's vector is exactly what it was.
  assert.deepEqual(chunks.getVector(books, theirChunk.id).vector, [1, 0, -2])
  assert.equal(chunks.getVector(books, theirChunk.id).model, 'embed-model-1')
  assert.equal(Number(db.prepare('SELECT COUNT(*) AS total FROM chunk_vector').get().total), 1)

  // A chunk id that is not there at all answers the same way.
  assert.equal(chunks.getVector(loft, 'no-such-chunk'), null)
  expectFailure(() => chunks.putVector(loft, 'no-such-chunk', 'embed-model-1', [1]), 'not_found')
})

test('markVectorsStale marks only the chunks whose stored model differs, and reports how many', (t) => {
  const { chunks, documents, businesses, db } = openStore(t)
  const { loft } = twoBusinesses(businesses)
  const document = makeDocument(documents, loft, DOC_NAME)

  chunks.replaceForDocument(loft, document.id, [
    { text: 'Terms of the quotation.', page: 1, section: 'Terms', tokens: 6 },
    { text: 'The rent roll for November.', page: 2, section: 'Rent roll', tokens: 7 },
    { text: 'Signed for and on behalf of Zuri Lofts.', page: 3, section: 'Signature', tokens: 9 },
  ])
  const [oldest, current, unembedded] = chunks.list(loft, document.id)

  chunks.putVector(loft, oldest.id, 'embed-model-1', [1, 0, -2])
  chunks.putVector(loft, current.id, 'embed-model-2', [1, 0, -2])

  /*
   * `replaceForDocument` writes `embed_model` as null; a later embedding pass is what
   * records the model it used, and no shipped code does that yet. The second half of
   * `markVectorsStale` only has anything to do once that column is set, so this test
   * sets it the way such a pass would.
   */
  const setModel = db.prepare('UPDATE chunk SET embed_model = ? WHERE id = ?')
  setModel.run('embed-model-1', oldest.id)
  setModel.run('embed-model-2', current.id)

  // One of the two vectors was made by the previous model, so exactly one is touched.
  assert.equal(chunks.markVectorsStale(loft, document.id, 'embed-model-2'), 1)

  const after = new Map(chunks.list(loft, document.id).map((row) => [row.id, row]))
  assert.equal(after.get(oldest.id).embedState, 'stale')
  assert.equal(after.get(current.id).embedState, 'current')
  // A chunk with no vector at all is not marked on someone else's rebuild.
  assert.equal(after.get(unembedded.id).embedState, 'current')

  /*
   * Marked, not deleted. The text and its keyword index keep working while the rebuild
   * runs, and the old numbers are still there for the pass that overwrites them.
   */
  assert.deepEqual(chunks.getVector(loft, oldest.id).vector, [1, 0, -2])
  assert.equal(chunks.getVector(loft, oldest.id).model, 'embed-model-1')
  assert.equal(after.get(oldest.id).text, 'Terms of the quotation.')
  assert.equal(chunks.searchTerms(loft, ['quotation']).length, 1)

  // Nothing left to touch a second time.
  assert.equal(chunks.markVectorsStale(loft, document.id, 'embed-model-2'), 0)

  // A current model outside the contract is refused rather than passed to the update.
  expectFailure(() => chunks.markVectorsStale(loft, document.id, ''), 'invalid_request')
})
