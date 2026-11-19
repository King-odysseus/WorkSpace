'use strict'

/*
 * The knowledge tables, driven against a real database file.
 *
 * Two properties of this task cannot be shown by a repository test on its own, so
 * they are shown here across tables and across a reopen:
 *
 * 1. The migration is forward-only and additive. A person who has been using the
 *    assistant already has conversations in this file. Adding documents and DNA must
 *    not touch them, and must not ask them to start over. The only honest way to
 *    check that is to build a database the way the previous build did - with version
 *    1 alone - write real chat rows into it, and then open it with the shipped
 *    migrations. A test that opened a fresh file and looked for the new tables would
 *    pass just as well if the upgrade deleted everything.
 *
 * 2. Replacing or deleting a document invalidates what was derived from it. A
 *    document's chunks, their keyword digests, their vectors and the Business DNA
 *    evidence that quotes them are all copies of its content in another form. If any
 *    one of them survives, a deleted file is still searchable or still cited. The
 *    tests below put a row in each of those tables, remove or replace the document,
 *    and check every one of them is gone - while a second business's rows, which
 *    point at its own document, are untouched.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

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
  'createThreadRepository',
  'createMessageRepository',
  'createDocumentRepository',
  'createChunkRepository',
  'createDnaRepository',
  'MIGRATIONS',
  'LATEST_MIGRATION_VERSION',
  'StorageError',
])

const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

function steppingClock () {
  let ticks = 0
  return () => {
    ticks += 1
    return new Date(Date.UTC(2026, 10, 17, 9, 0, 0) + ticks * 1000).toISOString()
  }
}

/** A directory of its own, removed afterwards even when a test throws. */
function scratchDirectory (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-knowledge-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

function businessScope (businessId) {
  return { serverHost: SCOPE.serverHost, userId: SCOPE.userId, businessId }
}

function encode (text) {
  return new TextEncoder().encode(text)
}

/**
 * Every repository this file needs, over one open database.
 *
 * Built by hand rather than through the store, because the store opens its own file
 * from a keychain and these tests need to open the same path twice with different
 * migration lists.
 */
function repositoriesOver (opened) {
  const context = api.createRepositoryContext(opened.db, opened.cipher, { now: steppingClock() })
  return {
    businesses: api.createBusinessRepository(context),
    threads: api.createThreadRepository(context),
    messages: api.createMessageRepository(context),
    documents: api.createDocumentRepository(context),
    chunks: api.createChunkRepository(context),
    dna: api.createDnaRepository(context),
    db: opened.db,
  }
}

/**
 * The chat repositories alone, for a database that predates the knowledge tables.
 *
 * A repository prepares its statements when it is created, so a document repository
 * over a version 1 file would fail at construction rather than at the call. That is
 * the right behaviour - it is what stops the app reading a table that is not there -
 * and it means this file has to ask only for what the older schema can answer.
 */
function chatRepositoriesOver (opened) {
  const context = api.createRepositoryContext(opened.db, opened.cipher, { now: steppingClock() })
  return {
    businesses: api.createBusinessRepository(context),
    threads: api.createThreadRepository(context),
    messages: api.createMessageRepository(context),
  }
}

function countRows (db, table, where = '', params = []) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params)
  return Number(row.n)
}

/* ------------------------------------------------------------------ *
 * 1. The upgrade keeps the conversations that were already there
 * ------------------------------------------------------------------ */

test('a database from the previous build keeps its chats when the knowledge tables are added', (t) => {
  const directory = scratchDirectory(t)
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())

  /* Built the way the previous build built it: version 1 only. */
  const versionOne = api.MIGRATIONS.filter((migration) => migration.version === 1)
  assert.equal(versionOne.length, 1, 'the shipped list must still contain version 1')

  const first = api.openDatabase({ filePath, key, migrations: versionOne, vectorExtensionPath: null })
  let businessId
  try {
    assert.equal(first.version, 1)
    const repos = chatRepositoriesOver(first)
    const business = repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' })
    businessId = business.id
    const scope = businessScope(businessId)
    const thread = repos.threads.create(scope, { title: 'Tilley quotation' })
    repos.messages.append(scope, { threadId: thread.id, role: 'user', content: 'Move it to Friday.' })
    repos.messages.append(scope, {
      threadId: thread.id,
      role: 'assistant',
      content: 'Moved to Friday.',
      provider: 'deepseek',
      model: 'deepseek-chat',
      cloud: true,
    })

    // The knowledge tables must not exist yet, or the upgrade under test is not one.
    assert.equal(countRows(first.db, "sqlite_master WHERE type = 'table' AND name = 'document'"), 0)
  } finally {
    first.close()
  }

  /* Opened by this build, which knows version 2 as well. */
  const second = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    assert.equal(second.version, api.LATEST_MIGRATION_VERSION)
    assert.deepEqual(second.appliedMigrations, [2], 'only version 2 should have been pending')

    const repos = repositoriesOver(second)
    const scope = businessScope(businessId)
    const threads = repos.threads.list(scope)
    assert.equal(threads.length, 1, 'the conversation was lost in the upgrade')
    assert.equal(threads[0].title, 'Tilley quotation')

    const messages = repos.messages.list(scope, threads[0].id)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].content, 'Move it to Friday.')
    assert.equal(messages[1].content, 'Moved to Friday.')
    assert.equal(messages[1].model, 'deepseek-chat')

    // And the new tables are usable in the same file.
    const document = repos.documents.create(scope, {
      name: 'Tilley quotation.pdf',
      kind: 'pdf',
      source: 'picked',
      bytes: encode('Quotation for the Tilley refurbishment.'),
    })
    assert.equal(repos.documents.list(scope).length, 1)
    assert.equal(document.status, 'uploaded')
  } finally {
    second.close()
  }
})

/* ------------------------------------------------------------------ *
 * 2. Replace and delete reach every copy of the content
 * ------------------------------------------------------------------ */

/** One business's document with a chunk, a vector and a DNA evidence link on it. */
function seedDocument (repos, scope, name) {
  const document = repos.documents.create(scope, {
    name,
    kind: 'md',
    source: 'picked',
    bytes: encode(`${name} body text about the Tilley quotation`),
  })
  repos.documents.markReady(scope, document.id, 1)
  repos.chunks.replaceForDocument(scope, document.id, [
    { text: `${name} says the Tilley quotation is premium work.`, page: 1, section: 'Pricing', tokens: 9 },
  ])
  const chunk = repos.chunks.list(scope, document.id)[0]
  repos.chunks.putVector(scope, chunk.id, 'embed-local-1', [1, 0, -2])

  const snapshot = repos.dna.writeVersion(scope, [
    { key: 'mission', value: 'Premium refurbishment, never discount-led.' },
  ])
  const field = snapshot.fields.find((row) => row.key === 'mission')
  const evidence = repos.dna.addEvidence(scope, field.id, {
    documentId: document.id,
    chunkId: chunk.id,
    page: 1,
    quote: 'the Tilley quotation is premium work',
  })

  return { document, chunk, field, evidence }
}

test('replacing a document clears its chunks, digests, vectors and evidence, and leaves the other business alone', (t) => {
  const directory = scratchDirectory(t)
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  try {
    const repos = repositoriesOver(opened)
    const loft = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' }).id)
    const books = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 12, name: 'Tijha Books' }).id)

    const mine = seedDocument(repos, loft, 'loft-brief.md')
    /* The other business, with its own document, so a cross-business delete has teeth. */
    const theirs = seedDocument(repos, books, 'books-brief.md')

    const before = {
      chunks: countRows(opened.db, 'chunk'),
      terms: countRows(opened.db, 'chunk_term'),
      vectors: countRows(opened.db, 'chunk_vector'),
      evidence: countRows(opened.db, 'dna_evidence'),
    }
    assert.ok(before.chunks >= 2 && before.terms > 0 && before.vectors >= 2 && before.evidence >= 2)

    /* The replacement is a second document in the same business. */
    const replacement = repos.documents.create(loft, {
      name: 'loft-brief-2.md',
      kind: 'md',
      source: 'picked',
      bytes: encode('A newer brief for the loft.'),
    })

    const replaced = repos.documents.replace(loft, mine.document.id, replacement.id)
    assert.equal(replaced.replacedBy, replacement.id, 'the old document must point at its replacement')

    // Its content is gone from every table it was copied into.
    assert.equal(repos.chunks.list(loft, mine.document.id).length, 0, 'chunks survived the replace')
    assert.equal(repos.chunks.get(loft, mine.chunk.id), null, 'the chunk row survived the replace')
    assert.equal(repos.chunks.getVector(loft, mine.chunk.id), null, 'the vector survived the replace')
    assert.equal(repos.dna.evidenceFor(loft, mine.field.id).length, 0, 'the evidence link survived the replace')

    // The other business is exactly where it was, all four tables.
    assert.equal(repos.chunks.list(books, theirs.document.id).length, 1)
    assert.notEqual(repos.chunks.getVector(books, theirs.chunk.id), null)
    assert.equal(repos.dna.evidenceFor(books, theirs.field.id).length, 1)
    assert.equal(repos.documents.get(books, theirs.document.id).replacedBy, null)

    /* And deleting the replacement takes its own rows without touching the other business. */
    repos.documents.remove(loft, replacement.id)
    assert.equal(repos.documents.get(loft, replacement.id), null)
    assert.equal(repos.chunks.list(books, theirs.document.id).length, 1)
    assert.equal(repos.dna.evidenceFor(books, theirs.field.id).length, 1)

    // The terms and vectors of the removed documents are gone; the survivor's remain.
    assert.equal(countRows(opened.db, 'chunk'), countRows(opened.db, 'chunk', 'WHERE business_id = ?', [books.businessId]))
    assert.equal(countRows(opened.db, 'chunk_vector'), 1)
    assert.ok(countRows(opened.db, 'chunk_term') > 0, 'the surviving document lost its keyword index')
  } finally {
    opened.close()
  }
})

test('deleting a document clears the DNA evidence that quoted it', (t) => {
  const directory = scratchDirectory(t)
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  try {
    const repos = repositoriesOver(opened)
    const loft = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' }).id)
    const seeded = seedDocument(repos, loft, 'loft-brief.md')

    assert.equal(repos.dna.evidenceFor(loft, seeded.field.id).length, 1)

    repos.documents.remove(loft, seeded.document.id)

    // The field survives - the value a person approved is theirs - but the citation
    // into a document that no longer exists does not.
    assert.equal(repos.dna.evidenceFor(loft, seeded.field.id).length, 0)
    assert.notEqual(repos.dna.field(loft, 'mission'), null, 'deleting a document removed a DNA field')
    assert.equal(countRows(opened.db, 'dna_evidence'), 0)
  } finally {
    opened.close()
  }
})

test('a replace or delete naming another business\'s document is refused and changes nothing', (t) => {
  const directory = scratchDirectory(t)
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  try {
    const repos = repositoriesOver(opened)
    const loft = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' }).id)
    const books = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 12, name: 'Tijha Books' }).id)

    const theirs = seedDocument(repos, books, 'books-brief.md')
    const mine = repos.documents.create(loft, {
      name: 'loft-brief.md',
      kind: 'md',
      source: 'picked',
      bytes: encode('Mine.'),
    })

    /* Delete the other business's document from this one. */
    assert.throws(
      () => repos.documents.remove(loft, theirs.document.id),
      (error) => error instanceof api.StorageError && error.failure === 'not_found',
    )
    assert.equal(repos.documents.get(books, theirs.document.id).replacedBy, null)
    assert.equal(repos.chunks.list(books, theirs.document.id).length, 1)

    /* Point this business's document at the other business's replacement. */
    assert.throws(
      () => repos.documents.replace(loft, mine.id, theirs.document.id),
      (error) => error instanceof api.StorageError && error.failure === 'not_found',
    )
    assert.equal(repos.documents.get(loft, mine.id).replacedBy, null, 'the refused replace still wrote')

    /* And a chunk cannot be attached to the other business's document. */
    assert.throws(
      () => repos.chunks.replaceForDocument(loft, theirs.document.id, [{ text: 'injected', tokens: 1 }]),
      (error) => error instanceof api.StorageError && error.failure === 'not_found',
    )
    assert.equal(repos.chunks.list(books, theirs.document.id).length, 1)
    assert.equal(repos.chunks.list(books, theirs.document.id)[0].text, 'books-brief.md says the Tilley quotation is premium work.')
  } finally {
    opened.close()
  }
})

test('a document stored under one account cannot be reached from another account on the same server', (t) => {
  /*
   * Every repository test so far uses two businesses of one person, because that is
   * the boundary a repository can be tricked across by passing a wrong id. The
   * account boundary is enforced one level up, by giving each account its own
   * database file - but "one level up" is a design decision, not a guarantee, and a
   * later change that put two accounts in one file would silently turn every scoped
   * repository into the only thing standing between them. So the boundary is checked
   * here as the repositories see it: an account's scope is different, and a row
   * written under another account's scope is not there.
   */
  const directory = scratchDirectory(t)
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  try {
    const repos = repositoriesOver(opened)
    const owner = businessScope(repos.businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' }).id)
    const seeded = seedDocument(repos, owner, 'loft-brief.md')

    /* The same business id, reached by a different account on the same server. */
    const intruder = { serverHost: SCOPE.serverHost, userId: SCOPE.userId + 1, businessId: owner.businessId }

    assert.equal(repos.documents.get(intruder, seeded.document.id), null, 'another account read the document')
    assert.equal(repos.documents.readBytes(intruder, seeded.document.id), null, 'another account read the file')
    assert.equal(repos.chunks.list(intruder, seeded.document.id).length, 0)
    assert.equal(repos.chunks.get(intruder, seeded.chunk.id), null, 'another account read a chunk')
    assert.equal(repos.dna.current(intruder), null, 'another account read the DNA')

    for (const call of [
      () => repos.documents.markReady(intruder, seeded.document.id, 1),
      () => repos.chunks.replaceForDocument(intruder, seeded.document.id, [{ text: 'injected', tokens: 1 }]),
      () => repos.dna.addEvidence(intruder, seeded.field.id, { documentId: seeded.document.id, quote: 'x' }),
    ]) {
      assert.throws(call, (error) => error instanceof api.StorageError && error.failure === 'not_found')
    }

    // And nothing the refusals touched changed the owner's rows.
    assert.equal(repos.chunks.list(owner, seeded.document.id).length, 1)
    assert.equal(repos.chunks.list(owner, seeded.document.id)[0].text,
      'loft-brief.md says the Tilley quotation is premium work.')
    assert.equal(repos.dna.evidenceFor(owner, seeded.field.id).length, 1)
  } finally {
    opened.close()
  }
})
