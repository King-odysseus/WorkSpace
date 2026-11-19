'use strict'

/*
 * Two kinds of ownership the knowledge tables have to enforce, both of which failed
 * before this file existed.
 *
 * 1. A business id belongs to one account, not to whoever names it. Every knowledge
 *    table carries a foreign key on `business_id`, and that key proves the id exists
 *    somewhere in the file - it says nothing about whose it is. The repositories
 *    shape-check the scope they are handed and then trust the business id inside it,
 *    so a second account on the same server that knew another person's business id
 *    could file a document, a DNA version or a proposal under it, and then read it
 *    back as its own. Each write is now selected from `business` under both the id and
 *    the account, so the row cannot be written at all.
 *
 * 2. A quote must not outlive the passage it quotes. `dna_evidence.chunk_id` carries
 *    no foreign key, so replacing a document's chunks left the old citations behind:
 *    an answer citing a passage the document no longer contains, and the old wording
 *    still stored in the quote. Replacing the chunks now clears them in the same
 *    transaction.
 *
 * Every refusal below is checked twice: once that it is refused, and once that the
 * table it would have written to is exactly as it was. A guard that raises after the
 * write is not a guard.
 *
 * The file runs under Electron's Node (see scripts/run-tests.mjs) because it opens a
 * real database with `node:sqlite`, which is the engine the shipped app uses.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

/*
 * The names this file needs from the bundle. The bundle only publishes what
 * `main/ipc/index.ts` re-exports, so a missing name is reported as the wiring step it
 * is instead of surfacing as "undefined is not a function" in every test at once.
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
  'createDnaRepository',
  'createDnaProposalRepository',
  'StorageError',
])

/* One server, and the two accounts the leak is aimed between. */
const SERVER = 'zuri.example.test'
const OWNER = 7
const OTHER_ACCOUNT = 8

const DOC_NAME = 'Tilley quotation.pdf'

function encode (text) {
  return new TextEncoder().encode(text)
}

/** A clock that moves a second at a time, so timestamps order rather than tie. */
function steppingClock () {
  let ticks = 0
  return () => {
    ticks += 1
    return new Date(Date.UTC(2026, 10, 17, 9, 0, 0) + ticks * 1000).toISOString()
  }
}

/** One open database in its own temp directory, with every repository over it. */
function openStore (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-ownership-'))
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())

  let opened
  try {
    opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true })
    throw error
  }

  t.after(() => {
    // Close first: on Windows an open WAL file keeps the directory from being removed.
    opened.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const context = api.createRepositoryContext(opened.db, opened.cipher, { now: steppingClock() })
  return {
    db: opened.db,
    businesses: api.createBusinessRepository(context),
    documents: api.createDocumentRepository(context),
    chunks: api.createChunkRepository(context),
    dna: api.createDnaRepository(context),
    proposals: api.createDnaProposalRepository(context),
  }
}

/** The scope one account's rows are filed under, for one business. */
function scopeFor (userId, businessId) {
  return { serverHost: SERVER, userId, businessId }
}

/** A business owned by the given account. Distinct workspace ids, or upsert returns
 * the same row twice and a cross-business test would quietly compare a row with itself. */
function ownBusiness (store, userId, name, remoteWorkspaceId) {
  return store.businesses.upsert({ serverHost: SERVER, userId }, { remoteWorkspaceId, name })
}

/** How many rows a table holds, read past every repository. */
function countRows (db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)
}

/** A refusal is the storage layer's own token, never a driver message. */
function expectFailure (work, token) {
  assert.throws(work, (error) => {
    assert.ok(error instanceof api.StorageError, `expected a StorageError, got ${error && error.name}`)
    assert.equal(error.failure, token)
    return true
  })
}

/* ------------------------------------------------------------------ *
 * 1. A business id is one account's
 * ------------------------------------------------------------------ */

test('a document cannot be filed under another account\'s business, and nothing is written', (t) => {
  const store = openStore(t)
  const business = ownBusiness(store, OWNER, 'Zuri Lofts', 11)

  // The same business id, named by a second account on the same server.
  const intruder = scopeFor(OTHER_ACCOUNT, business.id)
  const before = { documents: countRows(store.db, 'document'), blobs: countRows(store.db, 'document_blob') }

  expectFailure(
    () => store.documents.create(intruder, {
      name: DOC_NAME,
      kind: 'pdf',
      source: 'picked',
      bytes: encode('Quotation for the Tilley refurbishment.'),
    }),
    'not_found',
  )

  /*
   * Both tables, because the row and its sealed copy are written by two statements.
   * A guard placed between them would leave the file behind with no row to reach it.
   */
  assert.equal(countRows(store.db, 'document'), before.documents)
  assert.equal(countRows(store.db, 'document_blob'), before.blobs)
  assert.deepEqual(store.documents.list(intruder), [])
  // And the owner's library is untouched by the attempt.
  assert.deepEqual(store.documents.list(scopeFor(OWNER, business.id)), [])

  // The same call from the account that owns the business still works, so the refusal
  // above was about ownership rather than about documents being unwritable.
  const mine = store.documents.create(scopeFor(OWNER, business.id), {
    name: DOC_NAME,
    kind: 'pdf',
    source: 'picked',
    bytes: encode('Quotation for the Tilley refurbishment.'),
  })
  assert.equal(mine.name, DOC_NAME)
})

test('a DNA version cannot be written into another account\'s business, and nothing is written', (t) => {
  const store = openStore(t)
  const business = ownBusiness(store, OWNER, 'Zuri Lofts', 11)
  const intruder = scopeFor(OTHER_ACCOUNT, business.id)

  expectFailure(
    () => store.dna.writeVersion(intruder, [{ key: 'mission', value: 'Not their business.' }]),
    'not_found',
  )

  assert.equal(countRows(store.db, 'dna'), 0)
  assert.equal(countRows(store.db, 'dna_field'), 0)
  assert.equal(store.dna.current(intruder), null)
})

test('the first version an edit would create is refused for another account\'s business', (t) => {
  /*
   * `editField` writes version 1 when the business has no version yet - the path a
   * person takes by typing into an empty form. It is a separate insert from
   * `writeVersion`, so it needs the same check: the person typing proves nothing about
   * whose business id the screen handed them.
   */
  const store = openStore(t)
  const business = ownBusiness(store, OWNER, 'Zuri Lofts', 11)
  const intruder = scopeFor(OTHER_ACCOUNT, business.id)

  expectFailure(
    () => store.dna.editField(intruder, 'mission', 'Our own mission'),
    'not_found',
  )

  assert.equal(countRows(store.db, 'dna'), 0)
  assert.equal(countRows(store.db, 'dna_field'), 0)

  // The owner typing the same words still creates version 1 and locks the field.
  const edited = store.dna.editField(scopeFor(OWNER, business.id), 'mission', 'Our own mission')
  assert.equal(edited.value, 'Our own mission')
  assert.equal(edited.locked, true)
})

test('a proposal drafted with no document is refused for another account\'s business', (t) => {
  /*
   * A proposal that names a document is already held to the account, because the
   * document is looked up under the scope and the business. A proposal drafted from a
   * conversation names no document, and then nothing else in the create path asks
   * whose business it is - which is exactly the gap this covers.
   */
  const store = openStore(t)
  const business = ownBusiness(store, OWNER, 'Zuri Lofts', 11)
  const intruder = scopeFor(OTHER_ACCOUNT, business.id)

  expectFailure(
    () => store.proposals.create(intruder, {
      baseVersion: 1,
      changes: [{ key: 'mission', change: 'added', proposed: 'Keep Abuja lofts liveable.' }],
    }),
    'not_found',
  )

  assert.equal(countRows(store.db, 'dna_proposal'), 0)
  assert.equal(countRows(store.db, 'dna_proposal_change'), 0)
  assert.deepEqual(store.proposals.list(intruder), [])

  // The owner can still draft one, so the refusal was about ownership.
  const mine = store.proposals.create(scopeFor(OWNER, business.id), {
    baseVersion: 1,
    changes: [{ key: 'mission', change: 'added', proposed: 'Keep Abuja lofts liveable.' }],
  })
  assert.equal(mine.proposal.status, 'pending')
})

/* ------------------------------------------------------------------ *
 * 2. A quote does not outlive the passage it quotes
 * ------------------------------------------------------------------ */

/** One document with a chunk and a DNA field, plus the quote that cites the chunk. */
function seedCitedDocument (store, scope, name) {
  const document = store.documents.create(scope, {
    name,
    kind: 'md',
    source: 'picked',
    bytes: encode(`${name} body text about the Tilley quotation`),
  })
  store.documents.markReady(scope, document.id, 1)
  store.chunks.replaceForDocument(scope, document.id, [
    { text: `${name} says the Tilley quotation is premium work.`, page: 1, section: 'Pricing', tokens: 9 },
  ])
  const chunk = store.chunks.list(scope, document.id)[0]

  const snapshot = store.dna.writeVersion(scope, [
    { key: 'mission', value: 'Premium refurbishment, never discount-led.' },
  ])
  const field = snapshot.fields[0]
  const evidence = store.dna.addEvidence(scope, field.id, {
    documentId: document.id,
    chunkId: chunk.id,
    page: 1,
    quote: 'the Tilley quotation is premium work',
  })

  return { document, chunk, field, evidence }
}

test('replacing a document\'s chunks clears the quotes that cited them, and only that business\'s', (t) => {
  const store = openStore(t)
  const loft = scopeFor(OWNER, ownBusiness(store, OWNER, 'Zuri Lofts', 11).id)
  const books = scopeFor(OWNER, ownBusiness(store, OWNER, 'Tijha Books', 12).id)

  const mine = seedCitedDocument(store, loft, 'loft-brief.md')
  /* A second business in the same account, so a wider delete would show. */
  const theirs = seedCitedDocument(store, books, 'books-brief.md')

  assert.equal(store.dna.evidenceFor(loft, mine.field.id).length, 1)
  assert.equal(store.dna.evidenceFor(books, theirs.field.id).length, 1)

  /*
   * A re-ingestion of the same document: new chunks, new ids. The quote that named the
   * old chunk would otherwise stay on disk as a citation to a passage the document no
   * longer contains, because `dna_evidence.chunk_id` has no foreign key to cascade.
   */
  store.chunks.replaceForDocument(loft, mine.document.id, [
    { text: 'Revision 2 of the loft brief, signed on Monday.', page: 1, section: 'Terms', tokens: 10 },
  ])

  assert.deepEqual(
    store.dna.evidenceFor(loft, mine.field.id),
    [],
    'the quote survived the passage it cited',
  )

  // The DNA field itself survives: the value a person approved is theirs, and only the
  // citation into a replaced passage goes.
  assert.notEqual(store.dna.field(loft, 'mission'), null)

  // And the other business is exactly where it was, quote and all.
  const untouched = store.dna.evidenceFor(books, theirs.field.id)
  assert.equal(untouched.length, 1)
  assert.equal(untouched[0].id, theirs.evidence.id)
  assert.equal(untouched[0].chunkId, theirs.chunk.id)
  assert.equal(countRows(store.db, 'dna_evidence'), 1)
})

test('a refused replacement clears nothing, so an unowned document keeps its quotes', (t) => {
  /*
   * The clearing is inside the same transaction as the insert, so a replacement that is
   * refused for naming another business's document must leave that business's chunks,
   * index and quotes exactly as they were. A delete that ran before the refusal would
   * be a way to destroy another business's evidence using nothing but its id.
   */
  const store = openStore(t)
  const loft = scopeFor(OWNER, ownBusiness(store, OWNER, 'Zuri Lofts', 11).id)
  const books = scopeFor(OWNER, ownBusiness(store, OWNER, 'Tijha Books', 12).id)

  const theirs = seedCitedDocument(store, books, 'books-brief.md')
  const before = {
    chunks: countRows(store.db, 'chunk'),
    terms: countRows(store.db, 'chunk_term'),
    evidence: countRows(store.db, 'dna_evidence'),
  }

  expectFailure(
    () => store.chunks.replaceForDocument(loft, theirs.document.id, [
      { text: 'Written by the wrong business entirely.', page: 1, section: 'Wrong', tokens: 6 },
    ]),
    'not_found',
  )

  assert.equal(countRows(store.db, 'chunk'), before.chunks)
  assert.equal(countRows(store.db, 'chunk_term'), before.terms)
  assert.equal(countRows(store.db, 'dna_evidence'), before.evidence)
  assert.deepEqual(store.dna.evidenceFor(books, theirs.field.id).length, 1)
  assert.equal(store.chunks.list(books, theirs.document.id)[0].text,
    'books-brief.md says the Tilley quotation is premium work.')
})
