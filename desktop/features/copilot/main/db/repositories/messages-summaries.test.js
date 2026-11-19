'use strict'

/*
 * The message and summary repositories, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs.
 *
 * The whole point of these two tables is that they are the parts of a
 * conversation that never leave the machine, so the tests are about the three
 * things that could quietly stop being true: the order of a thread, the scope
 * every statement filters by, and the fact that the body is ciphertext in the
 * file. A repository that returned the right rows to the caller but filed them
 * somewhere another business could reach would pass a naive test and fail the
 * person it belongs to.
 *
 * Every test opens a real database in a temp file and closes it again. A file
 * rather than `:memory:` because the ciphertext test reads the stored column
 * straight out of SQLite, which is the only way to see what actually reached
 * disk.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../../build/main/ipc.cjs')

/* One person on one server. Everything below is filed under one of these. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }
const OTHER_USER = { serverHost: 'zuri.example.test', userId: 8 }
const OTHER_SERVER = { serverHost: 'tijha.example.test', userId: 7 }

/* ------------------------------------------------------------------ *
 * The database and the parent rows
 * ------------------------------------------------------------------ */

/**
 * The scope string rows are filed under.
 *
 * Taken from the bundle when it publishes `scopeIdOf`, and otherwise rebuilt from
 * the contract's documented form: the lower-cased host, length prefixed, then the
 * user id. The length prefix is what stops two different scopes producing the
 * same string, so it is repeated exactly rather than approximated.
 *
 * This is only used for the business and thread rows seeded below. The rows under
 * test are filed by the repositories themselves.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-messages-'))
  const filePath = path.join(dir, 'store.db')

  let opened
  try {
    opened = api.openDatabase({
      filePath,
      key: Buffer.from(api.createKeyMaterial(), 'base64'),
      // No vectors: this file is about rows, and loading the extension would only
      // make the test depend on a binary that Phase 3 does not need.
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
 * The subject of this file is the message and summary repositories, so the rows
 * they hang off are seeded with SQL rather than through the business repository:
 * a failure here should only ever mean something is wrong in the code this file
 * is about.
 */
function seedBusiness (store, scope) {
  const id = nextId()
  const now = new Date().toISOString()
  const remoteWorkspaceId = Number.parseInt(id, 16)
  store.db
    .prepare(
      'INSERT INTO business ' +
      '(id, scope_id, remote_workspace_id, name_enc, created_at, updated_at, archived_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      scopeIdFor(scope),
      remoteWorkspaceId,
      store.cipher.seal('business.name_enc', 'Zuri Lofts'),
      now,
      now,
      null,
    )
  return id
}

/** A thread row in one business, in the same shape its own repository writes. */
function seedThread (store, scope, businessId) {
  const id = nextId()
  const now = new Date().toISOString()
  store.db
    .prepare(
      'INSERT INTO thread ' +
      '(id, scope_id, business_id, title_enc, pinned, created_at, updated_at, closed_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      id,
      scopeIdFor(scope),
      businessId,
      store.cipher.seal('thread.title_enc', 'Overdue tasks'),
      0,
      now,
      now,
      null,
    )
  return id
}

/** One business with one thread, which is the least a message can be filed against. */
function seedConversation (store, scope) {
  const businessId = seedBusiness(store, scope)
  const threadId = seedThread(store, scope, businessId)
  return { businessId, threadId, businessScope: { ...scope, businessId } }
}

/** How many messages the whole table holds, read past every repository. */
function storedMessageCount (store) {
  return Number(store.db.prepare('SELECT COUNT(*) AS total FROM message').get().total)
}

/* ------------------------------------------------------------------ *
 * Order
 * ------------------------------------------------------------------ */

test('three appends are numbered one, two, three and list in that order', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)

  const question = messages.append(businessScope, {
    threadId,
    role: 'user',
    content: 'Which tasks are overdue?',
  })
  const reply = messages.append(businessScope, {
    threadId,
    role: 'assistant',
    content: 'Three are overdue.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    cloud: true,
  })
  const followUp = messages.append(businessScope, {
    threadId,
    role: 'user',
    content: 'Show me the oldest one.',
  })

  assert.deepEqual([question.seq, reply.seq, followUp.seq], [1, 2, 3])

  const listed = messages.list(businessScope, threadId)
  assert.deepEqual(listed.map((message) => message.seq), [1, 2, 3])
  assert.deepEqual(listed.map((message) => message.id), [question.id, reply.id, followUp.id])
  assert.deepEqual(listed.map((message) => message.role), ['user', 'assistant', 'user'])
  assert.deepEqual(listed.map((message) => message.content), [
    'Which tasks are overdue?',
    'Three are overdue.',
    'Show me the oldest one.',
  ])

  assert.equal(messages.lastSeq(businessScope, threadId), 3)
  assert.equal(messages.countForThread(businessScope, threadId), 3)
}))

test('a list can start after a sequence number and is bounded by its limit', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)
  for (let index = 1; index <= 5; index += 1) {
    messages.append(businessScope, { threadId, role: 'user', content: `Line ${index}` })
  }

  const seqs = (options) => messages.list(businessScope, threadId, options).map((message) => message.seq)

  assert.deepEqual(seqs({ afterSeq: 2 }), [3, 4, 5])
  // Strictly greater: asking again for the message already drawn does not repeat it.
  assert.deepEqual(seqs({ afterSeq: 3 }), [4, 5])
  assert.deepEqual(seqs({ afterSeq: 0 }), [1, 2, 3, 4, 5])
  assert.deepEqual(seqs({ afterSeq: 5 }), [])

  assert.deepEqual(seqs({ limit: 2 }), [1, 2])
  // A page size of zero is answered with the smallest usable page, not the whole thread.
  assert.deepEqual(seqs({ limit: 0 }), [1])
  assert.deepEqual(seqs({ afterSeq: 2, limit: 1 }), [3])
}))

test('the default list length is two hundred and the ceiling is five hundred', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)
  for (let index = 1; index <= 505; index += 1) {
    messages.append(businessScope, { threadId, role: 'user', content: `Line ${index}` })
  }

  const byDefault = messages.list(businessScope, threadId)
  assert.equal(byDefault.length, 200)
  assert.equal(byDefault[0].seq, 1)
  assert.equal(byDefault[199].seq, 200)

  // More than any screen draws is answered with the ceiling rather than refused.
  assert.equal(messages.list(businessScope, threadId, { limit: 10_000 }).length, 500)
  assert.equal(messages.lastSeq(businessScope, threadId), 505)
}))

/* ------------------------------------------------------------------ *
 * Scope
 * ------------------------------------------------------------------ */

test('a message written in one business is invisible from another', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const otherBusinessScope = { ...SCOPE, businessId: seedBusiness(store, SCOPE) }
  const messages = api.createMessageRepository(store.ctx)

  messages.append(businessScope, {
    threadId,
    role: 'user',
    content: 'Only Zuri Lofts may read this.',
  })

  // The thread id is known and correct: the business is what refuses it.
  assert.deepEqual(messages.list(otherBusinessScope, threadId), [])
  assert.equal(messages.countForThread(otherBusinessScope, threadId), 0)
  assert.equal(messages.lastSeq(otherBusinessScope, threadId), 0)

  // And the row is still exactly where the owning business expects it.
  assert.equal(messages.countForThread(businessScope, threadId), 1)
}))

test('another account on the same machine cannot read the thread even with its id', () => withStore((store) => {
  const { businessId, businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)

  messages.append(businessScope, { threadId, role: 'user', content: 'Salary review notes.' })

  // One scope per signed-in person on one server: a second person, and the same
  // person on a different server, are both somebody else.
  for (const scope of [
    { ...OTHER_USER, businessId },
    { ...OTHER_SERVER, businessId },
  ]) {
    assert.deepEqual(messages.list(scope, threadId), [])
    assert.equal(messages.countForThread(scope, threadId), 0)
    assert.equal(messages.lastSeq(scope, threadId), 0)
  }

  assert.equal(storedMessageCount(store), 1)
}))

test('appending to a thread this database does not have is refused and stores nothing', () => withStore((store) => {
  const { businessScope } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)

  assert.throws(
    () => messages.append(businessScope, { threadId: 'missing-thread', role: 'user', content: 'Hello?' }),
    (error) => {
      assert.ok(error instanceof api.StorageError, 'not a StorageError')
      assert.ok(api.STORAGE_FAILURES.includes(error.failure), String(error.failure))
      /*
       * `not_found`, not the internal token. The insert now selects from `thread`,
       * so a thread id that is not in this business inserts no row at all and the
       * repository can say exactly what happened: from here, that thread does not
       * exist. Reporting a broken app instead would send somebody looking for a
       * corrupt file after an ordinary mistake, and the same answer covers a thread
       * that belongs to another business - see ownership.test.js.
       */
      assert.equal(error.failure, 'not_found')
      return true
    },
  )

  assert.equal(storedMessageCount(store), 0)
}))

/* ------------------------------------------------------------------ *
 * The file itself
 * ------------------------------------------------------------------ */

test('the message body is stored as ciphertext rather than the text that was typed', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)
  const typed = 'Move the Tilley quote to Friday and tell Chidi.'
  const written = messages.append(businessScope, { threadId, role: 'user', content: typed })

  const stored = store.db.prepare('SELECT content_enc FROM message WHERE id = ?').get(written.id)

  assert.equal(typeof stored.content_enc, 'string')
  assert.ok(stored.content_enc.startsWith('v1.'), 'the column does not hold a sealed envelope')
  assert.equal(stored.content_enc.includes(typed), false, 'the column holds the plaintext')
  assert.equal(stored.content_enc.includes('Tilley'), false, 'the column holds a word of the plaintext')

  // The plaintext exists only behind the repository, which is the one place that
  // opens the column with its own context.
  assert.equal(messages.list(businessScope, threadId)[0].content, typed)
}))

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

test('provider, model and cloud come back as written, and a user message keeps a null cloud', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const messages = api.createMessageRepository(store.ctx)

  const question = messages.append(businessScope, {
    threadId,
    role: 'user',
    content: 'Who owns the Tilley quote?',
  })
  const localReply = messages.append(businessScope, {
    threadId,
    role: 'assistant',
    content: 'Tunde does.',
    provider: 'ollama',
    model: 'qwen2.5:7b',
    cloud: false,
  })
  const cloudReply = messages.append(businessScope, {
    threadId,
    role: 'assistant',
    content: 'Tunde does.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    cloud: true,
  })
  const note = messages.append(businessScope, {
    threadId,
    role: 'system',
    content: 'Workspace summary attached.',
  })

  assert.deepEqual(
    messages.list(businessScope, threadId).map((message) => [message.provider, message.model, message.cloud]),
    [
      [null, null, null],
      ['ollama', 'qwen2.5:7b', false],
      ['deepseek', 'deepseek-chat', true],
      [null, null, null],
    ],
  )

  // Null is not false. A typed message has no model behind it, so calling it a
  // local reply would make the attribution chip say something untrue.
  assert.equal(question.cloud, null)
  assert.equal(localReply.cloud, false)
  assert.equal(cloudReply.cloud, true)
  assert.equal(note.cloud, null)
}))

/* ------------------------------------------------------------------ *
 * Summaries
 * ------------------------------------------------------------------ */

test('a summary replaces the stored one when it covers more of the thread', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const summaries = api.createSummaryRepository(store.ctx)

  const first = summaries.upsert(businessScope, {
    threadId,
    text: 'They agreed to move the quote to Friday.',
    coversThroughSeq: 3,
  })
  assert.equal(first.threadId, threadId)
  assert.equal(first.text, 'They agreed to move the quote to Friday.')
  assert.equal(first.coversThroughSeq, 3)
  assert.deepEqual(summaries.get(businessScope, threadId), first)

  const second = summaries.upsert(businessScope, {
    threadId,
    text: 'They agreed to move the quote to Friday and to tell Chidi.',
    coversThroughSeq: 8,
  })
  assert.equal(second.coversThroughSeq, 8)

  const read = summaries.get(businessScope, threadId)
  assert.equal(read.text, 'They agreed to move the quote to Friday and to tell Chidi.')
  assert.equal(read.coversThroughSeq, 8)

  // One summary per thread: replacing it must not leave the old row behind.
  assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS total FROM memory_summary').get().total), 1)
}))

test('a summary that covers less than the stored one cannot rewind it', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const summaries = api.createSummaryRepository(store.ctx)

  summaries.upsert(businessScope, { threadId, text: 'The newer summary.', coversThroughSeq: 8 })

  /*
   * The shape of a late answer: an older request, started when the thread was
   * four messages long, arriving after the newer one already covered eight.
   */
  const stale = summaries.upsert(businessScope, {
    threadId,
    text: 'An older request summarised less of the thread.',
    coversThroughSeq: 4,
  })

  assert.equal(stale.coversThroughSeq, 8)
  assert.equal(stale.text, 'The newer summary.')

  const read = summaries.get(businessScope, threadId)
  assert.equal(read.text, 'The newer summary.')
  assert.equal(read.coversThroughSeq, 8)

  // Equal coverage is accepted: rewording a summary of the same range is an
  // improvement, not a rewind.
  const sameRange = summaries.upsert(businessScope, {
    threadId,
    text: 'The newer summary, reworded for the same range.',
    coversThroughSeq: 8,
  })
  assert.equal(sameRange.text, 'The newer summary, reworded for the same range.')
  assert.equal(sameRange.coversThroughSeq, 8)
}))

test('a summary is not readable from another business', () => withStore((store) => {
  const { businessId, businessScope, threadId } = seedConversation(store, SCOPE)
  const summaries = api.createSummaryRepository(store.ctx)
  summaries.upsert(businessScope, { threadId, text: 'Filed under Zuri Lofts.', coversThroughSeq: 2 })

  const otherBusinessScope = { ...SCOPE, businessId: seedBusiness(store, SCOPE) }

  assert.equal(summaries.get(otherBusinessScope, threadId), null)
  assert.equal(summaries.get({ ...OTHER_USER, businessId }, threadId), null)

  /*
   * And the other business cannot replace it on the way to being told no.
   *
   * It used to be refused by the conflict clause: the upsert reached the existing
   * row, failed the scope condition and answered `conflict`. The row is no longer
   * reachable at all, because the insert is conditional on owning the thread, so
   * the answer is `not_found` - the same answer as any other id this business does
   * not have. That is also what stops the opposite case, where the foreign business
   * got there first and left the owner refused: see ownership.test.js.
   */
  assert.throws(
    () => summaries.upsert(otherBusinessScope, {
      threadId,
      text: 'Not mine to replace.',
      coversThroughSeq: 99,
    }),
    (error) => {
      assert.ok(error instanceof api.StorageError, 'not a StorageError')
      assert.equal(error.failure, 'not_found')
      return true
    },
  )

  assert.equal(summaries.get(businessScope, threadId).text, 'Filed under Zuri Lofts.')
}))

test('a summary can be removed, and a removal from another business removes nothing', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)
  const summaries = api.createSummaryRepository(store.ctx)
  summaries.upsert(businessScope, { threadId, text: 'Filed under Zuri Lofts.', coversThroughSeq: 2 })

  const otherBusinessScope = { ...SCOPE, businessId: seedBusiness(store, SCOPE) }
  summaries.remove(otherBusinessScope, threadId)
  assert.equal(summaries.get(businessScope, threadId).text, 'Filed under Zuri Lofts.')

  summaries.remove(businessScope, threadId)
  assert.equal(summaries.get(businessScope, threadId), null)
  assert.equal(Number(store.db.prepare('SELECT COUNT(*) AS total FROM memory_summary').get().total), 0)
}))

test('a thread with nothing in it has no last sequence number and no summary', () => withStore((store) => {
  const { businessScope, threadId } = seedConversation(store, SCOPE)

  assert.equal(api.createMessageRepository(store.ctx).lastSeq(businessScope, threadId), 0)
  assert.equal(api.createMessageRepository(store.ctx).countForThread(businessScope, threadId), 0)
  assert.equal(api.createSummaryRepository(store.ctx).get(businessScope, threadId), null)
}))
