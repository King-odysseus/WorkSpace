'use strict'

/*
 * The ownership rules, driven against a real database.
 *
 * Everything here exists because two of them were wrong. A repository could be
 * handed a *thread id* it had been told about by somebody else and write a row
 * into it: `append` and the summary upsert both took the parent id on trust, so
 * one business could put a message in another business's conversation, and could
 * create the summary row for it first, which left the owner refused by their own
 * conflict clause. The same shape was open on the two other places that quote a
 * parent: a remembered item naming a message, and a proposal naming a thread.
 *
 * The fix moved each check inside the write rather than before it, so there is no
 * window between deciding and writing. These tests therefore assert two things at
 * once, and the second is the one that matters:
 *
 * - the call is refused, with the fixed token the rest of this layer uses; and
 * - the table still holds exactly what it held before, because a refusal that
 *   arrives after a row has landed is not a refusal.
 *
 * The last group covers the store itself: a key is only minted when there is
 * provably nothing to lose, and a grant withdrawn mid-call is refused before its
 * result is handed back.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const api = require('../../../../build/main/ipc.cjs')

/* A missing factory is a wiring gap, and saying so once beats a per-test guess. */
for (const name of [
  'openDatabase',
  'createRepositoryContext',
  'createBusinessRepository',
  'createThreadRepository',
  'createMessageRepository',
  'createSummaryRepository',
  'createMemoryRepository',
  'createProposalRepository',
  'createBusinessStore',
]) {
  assert.equal(typeof api[name], 'function', `${name} is not exported by the main bundle`)
}

/** 32 bytes of one repeated value: a throwaway key for a throwaway file. */
const KEY = Buffer.alloc(32, 3)

/** One person on one server, and the two businesses the misuse is aimed across. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/** A refusal is the storage layer's own token, never a driver message. */
function refusal (failure) {
  return (error) => {
    assert.equal(error && error.name, 'StorageError', `not a StorageError: ${String(error)}`)
    assert.equal(error.failure, failure)
    return true
  }
}

/** Every table count, so a test can prove nothing moved rather than only that it threw. */
function counts (opened) {
  const tables = ['business', 'thread', 'message', 'memory_item', 'memory_summary', 'proposal']
  const result = {}
  for (const table of tables) {
    result[table] = Number(opened.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total)
  }
  return result
}

/**
 * One open database with its repositories, independent of the store.
 *
 * The store is exercised separately at the bottom of this file. Using the bare
 * repositories here keeps these cases about the SQL and nothing else.
 */
function openHarness () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-ownership-'))
  const opened = api.openDatabase({
    filePath: path.join(dir, 'store.db'),
    key: KEY,
    // No vectors: this file is about rows, and loading the extension would make it
    // depend on a platform binary it does not test.
    vectorExtensionPath: null,
  })
  const ctx = api.createRepositoryContext(opened.db, opened.cipher)

  return {
    dir,
    opened,
    repositories: {
      businesses: api.createBusinessRepository(ctx),
      threads: api.createThreadRepository(ctx),
      messages: api.createMessageRepository(ctx),
      summaries: api.createSummaryRepository(ctx),
      memory: api.createMemoryRepository(ctx),
      proposals: api.createProposalRepository(ctx),
    },
    close () {
      opened.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Two businesses in one account, each with one thread.
 *
 * Two is the whole point: one database, one signed-in person, and the leak this
 * file is about is between the businesses rather than between accounts.
 */
function twoBusinesses (harness) {
  const { businesses, threads } = harness.repositories
  const zuri = businesses.upsert(SCOPE, { remoteWorkspaceId: 1, name: 'Zuri Lofts' })
  const tijha = businesses.upsert(SCOPE, { remoteWorkspaceId: 2, name: 'Tijha Books' })

  const zuriScope = { ...SCOPE, businessId: zuri.id }
  const tijhaScope = { ...SCOPE, businessId: tijha.id }
  const zuriThread = threads.create(zuriScope, { title: 'Overdue tasks' })

  return { zuriScope, tijhaScope, zuriThread }
}

/** Run one body against a fresh database, and take the file away afterwards. */
function withHarness (body) {
  const harness = openHarness()
  try {
    return body(harness)
  } finally {
    harness.close()
  }
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

test('a message cannot be appended into another business\'s thread, and nothing is written', () => {
  withHarness((harness) => {
    const { zuriScope, tijhaScope, zuriThread } = twoBusinesses(harness)
    const { messages } = harness.repositories

    const before = counts(harness.opened)

    // The thread id is real and was probably quoted to this business by a screen
    // that had it in a URL. Naming it is not permission to write into it.
    assert.throws(
      () => messages.append(tijhaScope, { threadId: zuriThread.id, role: 'user', content: 'Not mine.' }),
      refusal('not_found'),
    )

    // The refusal is only useful if the row is not there. A sequence number taken
    // from the wrong thread would also have corrupted the owner's ordering.
    assert.deepEqual(counts(harness.opened), before)
    assert.equal(messages.countForThread(zuriScope, zuriThread.id), 0)
    assert.deepEqual(messages.list(zuriScope, zuriThread.id), [])

    // And the owner is unaffected: the first message is still number one.
    const mine = messages.append(zuriScope, { threadId: zuriThread.id, role: 'user', content: 'Mine.' })
    assert.equal(mine.seq, 1)
    assert.equal(mine.threadId, zuriThread.id)
  })
})

/* ------------------------------------------------------------------ *
 * Summaries
 * ------------------------------------------------------------------ */

test('another business cannot claim the summary row for a thread it does not own', () => {
  withHarness((harness) => {
    const { zuriScope, tijhaScope, zuriThread } = twoBusinesses(harness)
    const { summaries } = harness.repositories

    const before = counts(harness.opened)

    /*
     * The exact denial this was sent back for. `thread_id` is the primary key and
     * the upsert used a plain VALUES insert, so a foreign business could create the
     * row first; the owner's later write then hit the conflict clause, failed its
     * own scope condition, and was reported to the owner as unusable.
     */
    assert.throws(
      () => summaries.upsert(tijhaScope, {
        threadId: zuriThread.id,
        text: 'Their version of a conversation they never had.',
        coversThroughSeq: 9,
      }),
      refusal('not_found'),
    )

    assert.deepEqual(counts(harness.opened), before)
    assert.equal(summaries.get(zuriScope, zuriThread.id), null)

    // The owner's first summary is accepted, and is not blocked by anyone.
    const mine = summaries.upsert(zuriScope, {
      threadId: zuriThread.id,
      text: 'They agreed to move the quote to Friday.',
      coversThroughSeq: 2,
    })
    assert.equal(mine.text, 'They agreed to move the quote to Friday.')
    assert.equal(summaries.get(tijhaScope, zuriThread.id), null)
  })
})

/* ------------------------------------------------------------------ *
 * Remembered items
 * ------------------------------------------------------------------ */

test('a remembered item cannot name a message from another business', () => {
  withHarness((harness) => {
    const { zuriScope, tijhaScope, zuriThread } = twoBusinesses(harness)
    const { messages, memory } = harness.repositories

    const source = messages.append(zuriScope, {
      threadId: zuriThread.id,
      role: 'user',
      content: 'Move the Tilley quote to Friday.',
    })

    const before = counts(harness.opened)

    // Provenance pointing into another business would let one business quote the
    // other's conversation through the "where this came from" link.
    assert.throws(
      () => memory.add(tijhaScope, { kind: 'fact', text: 'A fact.', sourceMessageId: source.id }),
      refusal('not_found'),
    )
    assert.deepEqual(counts(harness.opened), before)

    // The owning business may name its own message, and that link survives.
    const mine = memory.add(zuriScope, {
      kind: 'fact',
      text: 'The quote moves to Friday.',
      sourceMessageId: source.id,
    })
    assert.equal(mine.sourceMessageId, source.id)

    // A fact the person typed names no message, which is the ordinary case and
    // must not be caught by the check.
    const typed = memory.add(zuriScope, { kind: 'decision', text: 'Invoices go out on the first.' })
    assert.equal(typed.sourceMessageId, null)
  })
})

/* ------------------------------------------------------------------ *
 * Proposals
 * ------------------------------------------------------------------ */

test('a proposal cannot name a thread from another business, and a threadless one is still allowed', () => {
  withHarness((harness) => {
    const { zuriScope, tijhaScope, zuriThread } = twoBusinesses(harness)
    const { proposals } = harness.repositories

    const before = counts(harness.opened)

    assert.throws(
      () => proposals.create(tijhaScope, {
        kind: 'task',
        title: 'Send the invoice',
        payload: { title: 'Send the invoice' },
        threadId: zuriThread.id,
      }),
      refusal('not_found'),
    )
    assert.deepEqual(counts(harness.opened), before)

    const mine = proposals.create(zuriScope, {
      kind: 'task',
      title: 'Send the invoice',
      payload: { title: 'Send the invoice' },
      threadId: zuriThread.id,
    })
    assert.equal(mine.threadId, zuriThread.id)

    // A proposal drafted outside a conversation is normal, so `null` must pass the
    // same statement rather than being treated as a missing parent.
    const loose = proposals.create(zuriScope, { kind: 'email', title: 'Follow up', payload: {} })
    assert.equal(loose.threadId, null)
  })
})

/* ------------------------------------------------------------------ *
 * The key behind the file
 * ------------------------------------------------------------------ */

/** A keychain that keeps its entries in memory, with the shape of the real one. */
function memoryKeychain () {
  const entries = new Map()
  return {
    entries,
    store (name, secret) {
      entries.set(name, secret)
      return { ok: true }
    },
    read (name) {
      return entries.has(name) ? { ok: true, secret: entries.get(name) } : { ok: false, reason: 'not_found' }
    },
    remove (name) {
      return { ok: entries.delete(name) }
    },
  }
}

/** A directory and a cleanup hook, for the store cases below. */
function storeHarness (t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-ownership-store-'))
  t.after(() => {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
    } catch {
      // A leftover temp directory is not a test failure.
    }
  })
  return { directory, ...options }
}

test('a key is never minted over one that exists but could not be read', (t) => {
  const { directory } = storeHarness(t, {})

  const writes = []
  const unreadable = {
    store (name, secret) {
      writes.push(name)
      return { ok: true }
    },
    read () {
      // A locked or unavailable keychain, or a ciphertext this machine can no
      // longer decrypt. All of these mean a key exists.
      return { ok: false, reason: 'decrypt_failed' }
    },
    remove () {
      return { ok: true }
    },
  }

  const store = api.createBusinessStore({ directory, keychain: unreadable, vectorExtensionPath: null })
  t.after(() => store.close())

  // Minting here would replace the only key that opens conversations already on
  // this disk, and the person would come back to an empty assistant.
  assert.throws(() => store.open(SCOPE), refusal('bad_key'))
  assert.deepEqual(writes, [], 'a replacement key was written over an unreadable one')
  assert.equal(store.isOpen(), false)
})

test('a database file with no key behind it is refused rather than treated as new', (t) => {
  const { directory } = storeHarness(t, {})

  const first = api.createBusinessStore({ directory, keychain: memoryKeychain(), vectorExtensionPath: null })
  first.open(SCOPE)
  first.repositories(SCOPE).businesses.upsert(SCOPE, { remoteWorkspaceId: 1, name: 'Zuri Lofts' })
  first.close()

  // The key entry is gone - a cleared keychain, or a different machine profile -
  // but the file is still there and still holds rows.
  const second = api.createBusinessStore({ directory, keychain: memoryKeychain(), vectorExtensionPath: null })
  t.after(() => second.close())

  assert.throws(() => second.open(SCOPE), refusal('bad_key'))
  assert.equal(second.isOpen(), false)
})

/* ------------------------------------------------------------------ *
 * Access withdrawn while the app is open
 * ------------------------------------------------------------------ */

test('a withdrawn workspace is refused by the repositories, not only by requireBusiness', (t) => {
  const { directory } = storeHarness(t, {})

  const revoked = new Set()
  const store = api.createBusinessStore({
    directory,
    keychain: memoryKeychain(),
    vectorExtensionPath: null,
    isEligible: (_scope, remoteWorkspaceId) => !revoked.has(remoteWorkspaceId),
  })
  t.after(() => store.close())

  store.open(SCOPE)
  const business = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 42,
    name: 'Zuri Lofts',
  })
  const businessScope = { ...SCOPE, businessId: business.id }
  const thread = store.repositories(SCOPE).threads.create(businessScope, { title: 'Overdue tasks' })
  store.repositories(SCOPE).messages.append(businessScope, {
    threadId: thread.id,
    role: 'user',
    content: 'Before the grant was withdrawn.',
  })

  revoked.add(42)

  /*
   * Reading straight from `repositories()` used to skip the check entirely: only
   * `requireBusiness` consulted eligibility, so anything that went to a repository
   * with a business id still worked after the grant was gone.
   */
  assert.throws(() => store.repositories(SCOPE).messages.list(businessScope, thread.id), refusal('not_found'))
  assert.throws(() => store.repositories(SCOPE).threads.list(businessScope), refusal('not_found'))
  assert.throws(
    () => store.repositories(SCOPE).messages.append(businessScope, {
      threadId: thread.id,
      role: 'user',
      content: 'After the grant was withdrawn.',
    }),
    refusal('not_found'),
  )
  assert.throws(
    () => store.requireBusiness(SCOPE, business.id),
    refusal('not_found'),
  )
})

test('a reply that outlives its workspace grant is refused before it is handed back', async (t) => {
  const { directory } = storeHarness(t, {})

  const revoked = new Set()
  const store = api.createBusinessStore({
    directory,
    keychain: memoryKeychain(),
    vectorExtensionPath: null,
    isEligible: (_scope, remoteWorkspaceId) => !revoked.has(remoteWorkspaceId),
  })
  t.after(() => store.close())

  store.open(SCOPE)
  const business = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 42,
    name: 'Zuri Lofts',
  })
  const businessScope = { ...SCOPE, businessId: business.id }

  let release
  const pending = store.runScoped(
    SCOPE,
    async () => {
      await new Promise((resolve) => { release = resolve })
      return 'a reply the person may no longer receive'
    },
    { businessId: business.id },
  )

  // The grant is withdrawn while the call is in flight. The account is the same and
  // the handle is the same, so the generation would not have changed and the result
  // would otherwise land on a screen it is no longer allowed to fill.
  revoked.add(42)
  release()

  await assert.rejects(pending, refusal('not_found'))
  assert.deepEqual(businessScope.businessId, business.id)
})
