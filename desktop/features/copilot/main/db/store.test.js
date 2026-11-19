'use strict'

/*
 * The lifecycle of the local database, tested through the bundle Electron loads.
 *
 * The repositories next door prove what one scoped query returns. What is only
 * visible from here is the behaviour of the thing that owns the file: one database
 * per person, a sign-out that closes it, and the rule that a slow operation
 * started by one account can never hand its result to the next.
 *
 * That last rule is the reason most of this file exists. Phase 2's provider
 * settings were sent back for exactly this: a reply that arrived after the account
 * changed was returned to whoever was on screen. The same shape of bug here would
 * write one person's conversation into another person's database, so it is tested
 * from three directions rather than one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

const scopeA = { serverHost: 'zuri.example.test', userId: 7 }
const scopeB = { serverHost: 'zuri.example.test', userId: 8 }
const otherServer = { serverHost: 'other.example.test', userId: 7 }

/** A keychain that keeps its entries in memory, with the same shape as the real one. */
function memoryKeychain () {
  const entries = new Map()
  return {
    entries,
    store (name, secret) {
      entries.set(name, secret)
      return { ok: true }
    },
    read (name) {
      return entries.has(name)
        ? { ok: true, secret: entries.get(name) }
        : { ok: false, reason: 'not_found' }
    },
    remove (name) {
      return { ok: entries.delete(name) }
    },
  }
}

/** A directory and a keychain per test, removed afterwards. */
function harness (t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-store-'))
  const keychain = options.keychain ?? memoryKeychain()
  const store = api.createBusinessStore({
    directory,
    keychain,
    // Vectors are Phase 4's concern; asking for them here would make this file
    // depend on an optional platform binary it does not test.
    vectorExtensionPath: null,
    ...options.extra,
  })
  /*
   * One teardown hook, in this order, on purpose. Windows keeps a file locked
   * while a handle is open, so removing the directory before closing the database
   * fails with EPERM. Two separate hooks would depend on their registration order,
   * which is exactly the kind of thing that breaks silently later.
   */
  t.after(() => {
    store.close()
    try {
      fs.rmSync(directory, { recursive: true, force: true })
    } catch {
      // A leftover temp directory is not a test failure; the assertions already
      // ran, and the operating system cleans its own temp folder.
    }
  })
  return { directory, keychain, store }
}

/** One business, created and returned. */
function seedBusiness (store, scope, name = 'Zuri Lofts') {
  store.open(scope)
  return store.repositories(scope).businesses.upsert(scope, { remoteWorkspaceId: 1, name })
}

test('opening creates one database file for the signed-in person', (t) => {
  const { directory, store } = harness(t)

  seedBusiness(store, scopeA)

  assert.equal(store.isOpen(), true)
  assert.deepEqual(store.currentScope(), scopeA)
  const described = store.describe()
  assert.ok(described !== null)
  assert.equal(fs.existsSync(described.filePath), true)
  assert.equal(path.dirname(described.filePath), directory)
})

test('two people on one machine get two files and two keys', (t) => {
  const { store, keychain } = harness(t)

  seedBusiness(store, scopeA, 'Zuri Lofts')
  const fileA = store.describe().filePath
  store.close()

  seedBusiness(store, scopeB, 'Tijha Books')
  const fileB = store.describe().filePath

  // Different files, so one account cannot read the other even by accident.
  assert.notEqual(fileA, fileB)
  // Different keychain entries, so a key from one does not open the other.
  assert.equal(keychain.entries.size, 2)
  assert.notEqual(
    api.databaseKeyName(scopeA),
    api.databaseKeyName(scopeB),
  )

  // And the second account's database holds only its own business.
  const rowsB = store.repositories(scopeB).businesses.list(scopeB)
  assert.deepEqual(rowsB.map((row) => row.name), ['Tijha Books'])
})

test('a server change is a different database from a user change', (t) => {
  const { store } = harness(t)

  seedBusiness(store, scopeA)
  const first = store.describe().filePath
  store.close()
  seedBusiness(store, otherServer)
  const second = store.describe().filePath

  assert.notEqual(first, second)
  assert.notEqual(api.databaseKeyName(scopeA), api.databaseKeyName(otherServer))
})

test('signing out closes the handle and forgets the key in memory', (t) => {
  const { store } = harness(t)
  seedBusiness(store, scopeA)

  store.close()

  assert.equal(store.isOpen(), false)
  assert.equal(store.currentScope(), null)
  assert.equal(store.describe(), null)
  assert.throws(
    () => store.repositories(scopeA),
    (error) => error.failure === 'closed',
  )
})

test('signing back in finds the conversations again, because the key is durable', (t) => {
  const { store } = harness(t)

  seedBusiness(store, scopeA, 'Zuri Lofts')
  const thread = store.repositories(scopeA).threads.create(
    { ...scopeA, businessId: store.repositories(scopeA).businesses.list(scopeA)[0].id },
    { title: 'Q1 hiring plan' },
  )
  store.close()

  // A new store over the same directory and keychain is what a relaunch looks
  // like: the encrypted bytes were on disk, so the row comes back.
  store.open(scopeA)
  const business = store.repositories(scopeA).businesses.list(scopeA)[0]
  const threads = store.repositories(scopeA).threads.list({ ...scopeA, businessId: business.id })

  assert.deepEqual(threads.map((row) => row.id), [thread.id])
  assert.equal(threads[0].title, 'Q1 hiring plan')
})

test('a slow operation started before sign-out cannot hand its result back', async (t) => {
  const { store } = harness(t)
  const business = seedBusiness(store, scopeA)

  let release
  const held = new Promise((resolve) => { release = resolve })
  const pending = store.runScoped(scopeA, async (repos) => {
    await held
    return repos.businesses.list(scopeA)
  })

  // The person signs out while the work is still running.
  store.close()
  release()

  await assert.rejects(pending, (error) => error.failure === 'closed')
  assert.ok(business.id)
})

test('a slow operation survives when the same person stays signed in', async (t) => {
  const { store } = harness(t)
  seedBusiness(store, scopeA)

  // The control for the test above: without it, that refusal could be an
  // always-refuse and every other passing test would still pass.
  const rows = await store.runScoped(scopeA, async (repos) => repos.businesses.list(scopeA))
  assert.equal(rows.length, 1)
})

test('a slow operation is refused when a different account signs in', async (t) => {
  const { store } = harness(t)
  seedBusiness(store, scopeA)

  let release
  const held = new Promise((resolve) => { release = resolve })
  const pending = store.runScoped(scopeA, async (repos) => {
    await held
    return repos.businesses.list(scopeA)
  })

  // A second person signs in on the same machine: the handle is reopened for
  // them, which is a different generation even though a database is open.
  store.open(scopeB)
  release()

  await assert.rejects(pending, (error) => error.failure === 'closed')
})

test('asking the open handle for another account is closed rather than empty', (t) => {
  const { store } = harness(t)
  seedBusiness(store, scopeA)

  // Not "an empty list": a caller that asked the wrong scope has a bug, and a
  // quiet empty answer is how that bug becomes a leak nobody notices.
  assert.throws(
    () => store.repositories(scopeB),
    (error) => error.failure === 'closed',
  )
})

test('a business whose access was withdrawn cannot be used, even though the row remains', (t) => {
  const eligible = { value: true }
  const { store } = harness(t, {
    extra: { isEligible: () => eligible.value },
  })
  const business = seedBusiness(store, scopeA)

  assert.equal(store.requireBusiness(scopeA, business.id).id, business.id)

  eligible.value = false
  assert.throws(
    () => store.requireBusiness(scopeA, business.id),
    (error) => error.failure === 'not_found',
  )

  // The row is still there: withdrawal stops use, it does not delete what the
  // person wrote. Restoring the grant restores access to the same history.
  const rows = store.repositories(scopeA).businesses.list(scopeA)
  assert.equal(rows.length, 1)
  eligible.value = true
  assert.equal(store.requireBusiness(scopeA, business.id).id, business.id)
})

test('an archived business is refused even when it is still eligible', (t) => {
  const { store } = harness(t)
  const business = seedBusiness(store, scopeA)

  store.repositories(scopeA).businesses.archive(scopeA, business.id)

  assert.throws(
    () => store.requireBusiness(scopeA, business.id),
    (error) => error.failure === 'not_found',
  )
})

test('reopening the same person does not churn the handle', (t) => {
  const { store } = harness(t)
  seedBusiness(store, scopeA)
  const first = store.describe().filePath

  store.open(scopeA)

  assert.equal(store.describe().filePath, first)
  // The work done before the second open is still readable, which it would not be
  // if the reopen had gone through a close and a fresh file.
  assert.equal(store.repositories(scopeA).businesses.list(scopeA).length, 1)
})

test('a keychain that refuses to store the key stops the database opening', (t) => {
  const refusing = {
    store: () => ({ ok: false, reason: 'unavailable' }),
    read: () => ({ ok: false, reason: 'not_found' }),
    remove: () => ({ ok: false }),
  }
  const { store } = harness(t, { keychain: refusing })

  // Continuing without a durable key would produce a database nobody can reopen,
  // which reads to the person as data loss at the next launch.
  assert.throws(
    () => store.open(scopeA),
    (error) => error.failure === 'bad_key',
  )
  assert.equal(store.isOpen(), false)
})
