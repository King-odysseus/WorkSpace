'use strict'

/*
 * Business DNA, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS the
 * main process runs.
 *
 * Three things in this repository can be wrong without any screen noticing, and each
 * has its own group below.
 *
 * A version is a snapshot. If a write merged into the last version instead of adding
 * one, nothing would look broken until somebody wanted the earlier wording back, and
 * by then it would be gone. The first two tests read the version number and the field
 * list, so a merge shows up immediately.
 *
 * A person's own wording must survive generation. `editField` locks the field, and the
 * later write has to leave it alone *and* carry it into the new version: dropping it
 * would leave the newest version - the one every screen reads - with a blank where
 * they had written something, which is silent data loss rather than a visible failure.
 *
 * A citation must be real. The most valuable test in this file is the one that hands
 * `addEvidence` a document id belonging to another business: it is a real id, in the
 * same database, and the only thing that refuses it is the guard inside the insert. A
 * refusal that left a row behind would be worse than no guard at all, so each refusal
 * test also counts the rows.
 *
 * Every test opens a real database in a temp file and closes it again. A file rather
 * than `:memory:` because one test reads the stored quote straight out of SQLite, which
 * is the only way to see what actually reached disk.
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
 * (`export * from '../db/repositories/dna.js'`) for anything below to reach it.
 */
for (const name of ['openDatabase', 'createRepositoryContext', 'createDnaRepository']) {
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
 * Only the business, document and chunk rows seeded below use this. The rows under
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

/** One open database in its own temp directory, ready to be disposed of. */
function openStore () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-dna-'))
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
 * The rows DNA hangs off, written straight from the schema
 * ------------------------------------------------------------------ */

/*
 * Seeded with SQL rather than through their own repositories: the subject of this file
 * is the DNA repository, and a failure here should only ever mean something is wrong in
 * the code this file is about. The shapes are the ones those repositories write.
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

function seedDocument (store, scope, name) {
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
      scope.businessId,
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

function seedChunk (store, scope, documentId, ordinal) {
  const id = nextId()
  const now = new Date().toISOString()
  store.db
    .prepare(
      'INSERT INTO chunk ' +
      '(id, scope_id, business_id, document_id, ordinal, text_enc, page, section_enc, ' +
      'tokens, embed_model, embed_state, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      scopeIdFor(scope),
      scope.businessId,
      documentId,
      ordinal,
      store.cipher.seal('chunk.text_enc', 'The landlord maintains the common areas.'),
      1,
      null,
      8,
      null,
      'current',
      now,
    )
  return id
}

/**
 * One account with two businesses and the repository under test.
 *
 * Two businesses rather than one because the rule being tested is a leak between them:
 * one person, one database, two sets of rows that must never meet.
 */
function fixture (store) {
  const zuriId = seedBusiness(store, SCOPE)
  const tijhaId = seedBusiness(store, SCOPE)

  return {
    dna: api.createDnaRepository(store.ctx),
    scope: { ...SCOPE, businessId: zuriId },
    otherScope: { ...SCOPE, businessId: tijhaId },
  }
}

/** How many citations the whole table holds, read past the repository. */
function storedEvidenceCount (store) {
  return Number(store.db.prepare('SELECT COUNT(*) AS total FROM dna_evidence').get().total)
}

/* ------------------------------------------------------------------ *
 * Versions
 * ------------------------------------------------------------------ */

test('the first write is version 1 and carries every field it was given', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  const snapshot = dna.writeVersion(scope, [
    { key: 'mission', value: '  Keep Abuja lofts liveable.  ' },
    { key: 'brand_voice', value: 'Plain and direct.' },
  ])

  assert.equal(snapshot.version.version, 1)
  // Trimmed on the way in, generated by default, and never locked by a generation.
  assert.deepEqual(
    snapshot.fields.map((row) => [row.key, row.value, row.source, row.locked]),
    [
      ['brand_voice', 'Plain and direct.', 'ai', false],
      ['mission', 'Keep Abuja lofts liveable.', 'ai', false],
    ],
  )

  const current = dna.current(scope)
  assert.equal(current.version.id, snapshot.version.id)
  assert.deepEqual(current.fields.map((row) => row.id), snapshot.fields.map((row) => row.id))
}))

test('a second write lands version 2, and the read is of version 2', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  const first = dna.writeVersion(scope, [{ key: 'mission', value: 'First mission' }])
  const second = dna.writeVersion(scope, [{ key: 'vision', value: 'First vision' }])

  assert.equal(first.version.version, 1)
  assert.equal(second.version.version, 2)

  const current = dna.current(scope)
  assert.equal(current.version.version, 2)
  assert.equal(current.version.id, second.version.id)

  /*
   * The second version holds what the second write said, not a merge with the first.
   * That is the whole reason a version exists: the earlier wording is still readable
   * through its own version row rather than being overwritten.
   */
  assert.deepEqual(current.fields.map((row) => [row.key, row.value]), [['vision', 'First vision']])
}))

/* ------------------------------------------------------------------ *
 * A person's edit, and what a later generation may do with it
 * ------------------------------------------------------------------ */

test('an edit is the person\'s own wording, so it is locked and marked as theirs', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  const written = dna.writeVersion(scope, [{ key: 'mission', value: 'A generated mission' }])
  assert.equal(written.fields[0].locked, false)

  const edited = dna.editField(scope, 'mission', '  Our own mission  ')

  assert.equal(edited.key, 'mission')
  assert.equal(edited.value, 'Our own mission')
  assert.equal(edited.source, 'user')
  assert.equal(edited.locked, true)

  // An edit corrects the newest version rather than drafting another one.
  const current = dna.current(scope)
  assert.equal(current.version.version, 1)
  assert.deepEqual(current.fields.map((row) => [row.key, row.value, row.locked]), [
    ['mission', 'Our own mission', true],
  ])
}))

test('a later write does not overwrite a locked field', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  dna.writeVersion(scope, [{ key: 'mission', value: 'A generated mission' }])
  dna.editField(scope, 'mission', 'Our own mission')

  const second = dna.writeVersion(scope, [
    { key: 'mission', value: 'A model rewrote it' },
    { key: 'vision', value: 'A generated vision' },
  ])

  const stored = second.fields.find((row) => row.key === 'mission')
  assert.equal(stored.value, 'Our own mission')
  assert.equal(stored.source, 'user')
  assert.equal(stored.locked, true)

  // Read through the single-field reader as well: that is the call the form makes.
  assert.equal(dna.field(scope, 'mission').value, 'Our own mission')
}))

test('the new version still carries the locked field, beside what was generated', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  dna.writeVersion(scope, [{ key: 'mission', value: 'A generated mission' }])
  dna.editField(scope, 'mission', 'Our own mission')

  const second = dna.writeVersion(scope, [{ key: 'vision', value: 'A generated vision' }])

  /*
   * The locked key was not in the second write at all. It still has to be in version 2,
   * because every screen renders the newest version: dropping it would show an empty
   * mission where the person had written one.
   */
  assert.deepEqual(second.fields.map((row) => [row.key, row.value, row.locked]), [
    ['mission', 'Our own mission', true],
    ['vision', 'A generated vision', false],
  ])
}))

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('a write refuses a key this build does not know, and stores nothing', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  assert.throws(
    () => dna.writeVersion(scope, [{ key: 'headcount', value: '3' }]),
    refusal('invalid_request'),
  )
  assert.equal(dna.current(scope), null)
}))

test('a write refuses a blank or oversized value, and stores nothing', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  assert.throws(
    () => dna.writeVersion(scope, [{ key: 'mission', value: '   ' }]),
    refusal('invalid_request'),
  )
  assert.throws(
    () => dna.writeVersion(scope, [{ key: 'mission', value: 'x'.repeat(8_001) }]),
    refusal('invalid_request'),
  )

  // The same key twice cannot be stored either, and refusing beats keeping the last.
  assert.throws(
    () => dna.writeVersion(scope, [
      { key: 'mission', value: 'One mission' },
      { key: 'mission', value: 'Another mission' },
    ]),
    refusal('invalid_request'),
  )

  assert.equal(dna.current(scope), null)
}))

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

test('a quote is stored against a field and read back', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  const field = dna.writeVersion(scope, [{ key: 'will_not_do', value: 'No evictions.' }]).fields[0]
  const documentId = seedDocument(store, scope, 'Service agreement')
  const chunkId = seedChunk(store, scope, documentId, 0)

  const evidence = dna.addEvidence(scope, field.id, {
    documentId,
    chunkId,
    page: 4,
    quote: '  the landlord maintains the common areas  ',
  })

  assert.equal(evidence.fieldId, field.id)
  assert.equal(evidence.documentId, documentId)
  assert.equal(evidence.chunkId, chunkId)
  assert.equal(evidence.page, 4)
  assert.equal(evidence.quote, 'the landlord maintains the common areas')

  const listed = dna.evidenceFor(scope, field.id)
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, evidence.id)
  assert.equal(listed[0].quote, 'the landlord maintains the common areas')

  // What reached disk is the envelope, not the sentence.
  const stored = store.db
    .prepare('SELECT quote_enc FROM dna_evidence WHERE id = ?')
    .get(evidence.id)
  assert.equal(stored.quote_enc.includes('common areas'), false)
}))

test('a document or a field from another business cannot be cited, and nothing is written', () => withStore((store) => {
  const { dna, scope, otherScope } = fixture(store)

  const field = dna.writeVersion(scope, [{ key: 'mission', value: 'Our mission' }]).fields[0]
  const otherField = dna.writeVersion(otherScope, [{ key: 'mission', value: 'Their mission' }]).fields[0]
  const ourDocument = seedDocument(store, scope, 'Our lease')
  const foreignDocument = seedDocument(store, otherScope, 'Their contract')

  const before = storedEvidenceCount(store)

  /*
   * Every id below is real and belongs to this person, and the two businesses are in
   * the same database: the only thing standing between them and a citation is the guard
   * inside the insert.
   */
  assert.throws(
    () => dna.addEvidence(scope, field.id, { documentId: foreignDocument, quote: 'not ours' }),
    refusal('not_found'),
  )
  assert.throws(
    () => dna.addEvidence(scope, otherField.id, { documentId: ourDocument, quote: 'their field, our scope' }),
    refusal('not_found'),
  )

  assert.equal(storedEvidenceCount(store), before)
  assert.deepEqual(dna.evidenceFor(scope, field.id), [])
}))

test('a chunk from a different document cannot be cited, and nothing is written', () => withStore((store) => {
  const { dna, scope } = fixture(store)

  const field = dna.writeVersion(scope, [{ key: 'mission', value: 'Our mission' }]).fields[0]
  const documentId = seedDocument(store, scope, 'Lease')
  const otherDocumentId = seedDocument(store, scope, 'Invoice')
  const chunkOfOtherDocument = seedChunk(store, scope, otherDocumentId, 0)

  const before = storedEvidenceCount(store)

  /*
   * The chunk exists, is in this business and is in this person's file. It is not in the
   * document being cited, so the citation would quote a sentence that document does not
   * contain, which reads just as convincingly as a true one.
   */
  assert.throws(
    () => dna.addEvidence(scope, field.id, {
      documentId,
      chunkId: chunkOfOtherDocument,
      quote: 'a sentence from somewhere else',
    }),
    refusal('not_found'),
  )

  assert.equal(storedEvidenceCount(store), before)
  assert.deepEqual(dna.evidenceFor(scope, field.id), [])
}))

/* ------------------------------------------------------------------ *
 * Between businesses
 * ------------------------------------------------------------------ */

test('one business cannot see another business\'s DNA', () => withStore((store) => {
  const { dna, scope, otherScope } = fixture(store)

  dna.writeVersion(scope, [{ key: 'mission', value: 'Zuri mission' }])

  assert.equal(dna.current(otherScope), null)
  assert.equal(dna.field(otherScope, 'mission'), null)

  // A write in the other business starts its own history at version 1.
  const theirs = dna.writeVersion(otherScope, [{ key: 'mission', value: 'Tijha mission' }])
  assert.equal(theirs.version.version, 1)

  assert.equal(dna.field(scope, 'mission').value, 'Zuri mission')
  assert.equal(dna.field(otherScope, 'mission').value, 'Tijha mission')
}))
