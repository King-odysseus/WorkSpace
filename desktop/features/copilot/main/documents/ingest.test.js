'use strict'

/*
 * Ingestion, driven against a real database file in a temporary folder.
 *
 * The properties here cannot be shown by a parser test, because they are about what is
 * left behind after something goes wrong:
 *
 * 1. A restart resumes rather than duplicates. The pipeline's last write replaces a
 *    document's chunks, so running it twice must leave one set. The test seeds an older
 *    set first and then resumes, which is the state an interruption actually leaves.
 * 2. A cancelled run leaves a document marked failed rather than stuck at `reading`. A
 *    stuck document is invisible: it never appears in a "needs attention" list and it
 *    never becomes ready, so the person simply has a file that does nothing.
 * 3. A run that outlives its account writes nothing. Writing after a sign-out would put
 *    one person's document into the next person's library.
 * 4. A document whose pages are all pictures ends as `unsupported`, not as a ready
 *    document with no text in it.
 *
 * This file opens a real database, so `scripts/run-tests.mjs` runs it under Electron's
 * Node - the same engine the shipped app uses. Under plain Node the engine is absent and
 * every test here would report a missing feature rather than a missing runtime.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')
const fixtures = require('./fixtures/build.cjs')

for (const name of [
  'openDatabase',
  'createKeyMaterial',
  'databaseKeyFromSecret',
  'createRepositoryContext',
  'createBusinessRepository',
  'createDocumentRepository',
  'createChunkRepository',
  'createDocumentJobRepository',
  'createIngestion',
]) {
  assert.equal(typeof api[name], 'function', `${name} must be exported by the main bundle`)
}

const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/**
 * A directory of its own.
 *
 * The folder is NOT registered for removal here. On Windows an open database keeps a
 * handle on its folder, so removing it before the close fails with EPERM - and an after
 * hook that throws turns a passing test into a failing one for a reason that has nothing
 * to do with the code under test. The caller registers one hook that closes and then
 * removes, in that order.
 */
function scratchDirectory () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-ingest-'))
}

/**
 * One open database with the three repositories ingestion needs.
 *
 * Built by hand rather than through the app's store, so a test can drive the pipeline
 * without an Electron window or a keychain: the subject here is the pipeline, and a
 * failure should only ever mean the pipeline is wrong.
 */
function openLibrary (t) {
  const directory = scratchDirectory()
  const filePath = path.join(directory, 'store.db')
  const key = api.databaseKeyFromSecret(api.createKeyMaterial())
  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  // Close first, then remove: the order is the whole point of this hook.
  t.after(() => {
    opened.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const ctx = api.createRepositoryContext(opened.db, opened.cipher)
  const businesses = api.createBusinessRepository(ctx)
  const business = businesses.upsert(SCOPE, { remoteWorkspaceId: 11, name: 'Zuri Lofts' })
  const scope = { ...SCOPE, businessId: business.id }

  const documents = api.createDocumentRepository(ctx)
  const chunks = api.createChunkRepository(ctx)
  const jobs = api.createDocumentJobRepository(ctx)

  return {
    businesses,
    scope,
    documents,
    chunks,
    jobs,
    ingestion: api.createIngestion({ documents, chunks, jobs }),
  }
}

function encode (text) {
  return new TextEncoder().encode(text)
}

test('a text document is read, chunked and marked ready with its job finished', (t) => {
  const library = openLibrary(t)
  const text = Array.from({ length: 80 }, (_, index) =>
    `Paragraph ${index}. The rear elevation of the Tilley building needs repointing before winter.`).join('\n\n')

  const document = library.documents.create(library.scope, {
    name: 'survey.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode(text),
  })

  return library.ingestion.ingest(library.scope, document.id).then((outcome) => {
    assert.equal(outcome.status, 'ready')
    assert.equal(outcome.failure, null)
    assert.ok(outcome.chunks >= 2, `expected several passages, got ${outcome.chunks}`)

    const stored = library.documents.get(library.scope, document.id)
    assert.equal(stored.status, 'ready')
    assert.notEqual(stored.readyAt, null, 'a ready document records when it became ready')
    assert.equal(stored.failure, null)

    assert.equal(library.chunks.countForDocument(library.scope, document.id), outcome.chunks)
    assert.ok(library.chunks.tokensForDocument(library.scope, document.id) > 0)

    const job = library.jobs.latestFor(library.scope, document.id)
    assert.equal(job.status, 'done')
    assert.equal(job.progress, 100)
    assert.equal(job.attempts, 1)
    assert.equal(job.finishedAt !== null, true)
    // Every passage must be findable by the word it contains, which is what proves the
    // keyword index was written and not only the text.
    assert.ok(library.chunks.searchTerms(library.scope, ['repointing']).length > 0)
  })
})

test('a resumed job replaces its chunks rather than adding a second set', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'brief.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('The stairwell needs painting. The stairwell needs painting twice over.'),
  })

  /*
   * The state an interruption leaves: a job that was started and never finished, and a
   * partial set of chunks already indexed. A resume that appended would leave both sets,
   * so the person would get the same passage cited twice with two chunk ids.
   */
  const abandoned = library.jobs.create(library.scope, document.id)
  library.jobs.start(library.scope, abandoned.id)
  library.chunks.replaceForDocument(library.scope, document.id, [
    { text: 'Text from the run that died halfway.', page: 1, section: null, tokens: 10 },
  ])
  assert.equal(library.chunks.countForDocument(library.scope, document.id), 1)

  const outcomes = await library.ingestion.resumePending(library.scope)

  assert.equal(outcomes.length, 1, 'the pending job must be the one resumed')
  assert.equal(outcomes[0].status, 'ready')

  const stored = library.chunks.list(library.scope, document.id)
  assert.equal(
    stored.some((chunk) => chunk.text.includes('died halfway')),
    false,
    'the abandoned run\'s chunk survived the resume',
  )
  assert.equal(stored.length, outcomes[0].chunks, 'a resumed run must leave exactly one set of chunks')
  assert.equal(library.jobs.latestFor(library.scope, document.id).status, 'done')
})

test('ingesting an already-ready document twice leaves the chunk count alone', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'quote.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('The quotation for the Tilley refurbishment expires on Friday.'),
  })

  const first = await library.ingestion.ingest(library.scope, document.id)
  const second = await library.ingestion.ingest(library.scope, document.id)

  assert.equal(first.status, 'ready')
  assert.equal(second.status, 'ready')
  assert.equal(second.chunks, first.chunks)
  assert.equal(library.chunks.countForDocument(library.scope, document.id), first.chunks)
})

test('a cancelled run marks the document interrupted rather than leaving it reading', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'long.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('The rear elevation needs repointing. '.repeat(200)),
  })

  const controller = new AbortController()
  controller.abort()

  const outcome = await library.ingestion.ingest(library.scope, document.id, { signal: controller.signal })

  assert.equal(outcome.status, 'cancelled')
  assert.equal(outcome.chunks, 0)

  const stored = library.documents.get(library.scope, document.id)
  assert.equal(stored.status, 'failed', 'a cancelled document must not stay at reading')
  assert.equal(stored.failure, 'interrupted')
  assert.equal(library.chunks.countForDocument(library.scope, document.id), 0)
})

test('a run that outlives its account writes no content, and leaves the job resumable', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'private.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('The Tilley quotation is premium work. '.repeat(50)),
  })

  /*
   * The first two checks pass and the third fails, which is the shape of a sign-out
   * arriving mid-run: the pipeline is allowed to start, and must stop before its next
   * write rather than finishing under a new person's account.
   */
  let calls = 0
  const isCurrent = () => {
    calls += 1
    return calls <= 2
  }

  const outcome = await library.ingestion.ingest(library.scope, document.id, { isCurrent })

  assert.equal(outcome.status, 'stale')
  assert.equal(outcome.chunks, 0)
  assert.equal(library.chunks.countForDocument(library.scope, document.id), 0, 'no content may be written')

  const after = library.documents.get(library.scope, document.id)
  /*
   * Not marked failed. A failure recorded on behalf of a session that has ended would be
   * a red row about a document the next person never asked about. The document stays mid
   * read, which is the one resting state that is honest about what happened.
   */
  assert.notEqual(after.status, 'failed')
  assert.notEqual(after.status, 'ready')
  assert.equal(after.failure, null)

  // And it is recoverable: the pending job is exactly what a restart resumes.
  assert.equal(library.jobs.latestFor(library.scope, document.id).status, 'running')

  const recovered = await library.ingestion.resumePending(library.scope)
  assert.equal(recovered.length, 1)
  assert.equal(recovered[0].status, 'ready')
  assert.ok(library.chunks.countForDocument(library.scope, document.id) > 0)
  assert.equal(library.documents.get(library.scope, document.id).status, 'ready')
})

test('a replaced document cannot be re-ingested, and the replacement reads on its own', async (t) => {
  const library = openLibrary(t)
  const first = library.documents.create(library.scope, {
    name: 'quotation-v1.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('Revision one of the quotation says the work costs 1200.'),
  })
  await library.ingestion.ingest(library.scope, first.id)
  assert.ok(library.chunks.countForDocument(library.scope, first.id) > 0)

  const second = library.documents.create(library.scope, {
    name: 'quotation-v2.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('Revision two of the quotation says the work costs 1500.'),
  })
  library.documents.replace(library.scope, first.id, second.id)

  // `replace` has already cleared the old content; that is the state being protected.
  assert.equal(library.chunks.countForDocument(library.scope, first.id), 0)

  /*
   * The guard under test. The old document's bytes are still stored - the row is kept so
   * an older citation resolves - so without this check a resume sweep would read them
   * again and put back exactly what the replace removed.
   */
  await assert.rejects(
    () => library.ingestion.ingest(library.scope, first.id),
    (error) => error instanceof api.StorageError && error.failure === 'not_found',
  )
  assert.equal(library.chunks.countForDocument(library.scope, first.id), 0, 'the replaced content came back')

  const outcome = await library.ingestion.ingest(library.scope, second.id)
  assert.equal(outcome.status, 'ready')
  assert.match(
    library.chunks.list(library.scope, second.id).map((chunk) => chunk.text).join(' '),
    /1500/,
  )
})

test('a file renamed to look like a document is refused as unsupported', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'really-text.pdf',
    kind: 'pdf',
    source: 'picked',
    bytes: encode('This is plainly not a PDF and has no PDF header at all.'),
  })

  const outcome = await library.ingestion.ingest(library.scope, document.id)

  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.failure, 'unsupported')
  assert.equal(library.documents.get(library.scope, document.id).failure, 'unsupported')
  assert.equal(library.chunks.countForDocument(library.scope, document.id), 0)
})

test('a scanned document ends as unsupported, not as a ready document with no text', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'scanned-lease.pdf',
    kind: 'pdf',
    source: 'picked',
    bytes: fixtures.buildScannedPdf(2),
  })

  const outcome = await library.ingestion.ingest(library.scope, document.id)

  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.failure, 'unsupported')
  // The specific wrong answer: status ready, zero chunks, and a person searching for a
  // phrase they can see on the page.
  assert.notEqual(library.documents.get(library.scope, document.id).status, 'ready')
  assert.equal(library.chunks.countForDocument(library.scope, document.id), 0)
})

test('a 200-page PDF is read in one run and keeps its page numbers', async (t) => {
  const library = openLibrary(t)
  const document = library.documents.create(library.scope, {
    name: 'site-report.pdf',
    kind: 'pdf',
    source: 'picked',
    bytes: fixtures.buildLargePdf(200),
  })

  const submitted = Date.now()
  const outcome = await library.ingestion.ingest(library.scope, document.id)
  const elapsed = Date.now() - submitted

  assert.equal(outcome.status, 'ready')
  assert.equal(outcome.pageCount, 200)
  assert.ok(outcome.chunks >= 200, `expected at least one passage per page, got ${outcome.chunks}`)

  const pages = new Set(library.chunks.list(library.scope, document.id).map((chunk) => chunk.page))
  assert.equal(pages.size, 200, 'every page must appear in the citations')
  assert.equal(library.documents.get(library.scope, document.id).pageCount, 200)

  // A bound on the work rather than a benchmark: 200 pages must not take minutes.
  assert.ok(elapsed < 20_000, `200 pages took ${elapsed}ms`)
})

test('a document in another business cannot be ingested from this one', async (t) => {
  const library = openLibrary(t)
  const books = library.businesses.upsert(SCOPE, { remoteWorkspaceId: 12, name: 'Tijha Books' })
  const theirScope = { ...SCOPE, businessId: books.id }

  const theirs = library.documents.create(theirScope, {
    name: 'books-stock.txt',
    kind: 'txt',
    source: 'picked',
    bytes: encode('Stock count for the Abuja shop.'),
  })

  /*
   * The id is real and belongs to the same person, so the only thing refusing this is the
   * business on the scope. Reporting it as a failed document would be wrong: from here
   * there is no such document, which is the answer every other repository gives.
   */
  await assert.rejects(
    () => library.ingestion.ingest(library.scope, theirs.id),
    (error) => error instanceof api.StorageError && error.failure === 'not_found',
  )
  assert.equal(library.chunks.countForDocument(theirScope, theirs.id), 0)
  assert.equal(library.documents.get(theirScope, theirs.id).status, 'uploaded')

  // And a resume sweep in this business must not pick up the other business's job.
  assert.deepEqual(await library.ingestion.resumePending(library.scope), [])
})
