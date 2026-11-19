'use strict'

/*
 * Opening, preparing and closing the local database, tested through the bundle
 * Electron loads.
 *
 * These are the promises `openDatabase` makes, in the order it makes them:
 *
 * - The pragmas first, so a laptop lid closing cannot tear the page around a
 *   sealed column.
 * - The key check before anything personal, so the wrong profile is told no
 *   before a migration can touch somebody else's database.
 * - One transaction per migration, so a failure leaves the database on the
 *   previous version and the next launch resumes instead of redoing work that
 *   already succeeded.
 * - A database written by a newer build refused rather than guessed at.
 * - The vector extension reported, never fatal: chat and memory work without it.
 *
 * The machine that runs the plain suite has no `node:sqlite`, and the storage
 * layer says so with `runtime_unsupported` instead of pretending. Every test
 * below is therefore skipped, with that reason, when `sqliteIsAvailable()` is
 * false rather than failing on a runtime that cannot open a database at all.
 *
 * Each test works in its own directory under the OS temp folder, and the whole
 * directory goes away in the cleanup hook below. Nothing here reads or writes a
 * database that belongs to anyone.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

/** A fixed instant, so a row written by one test reads the same in the next run. */
const NOW = '2026-11-16T09:00:00.000Z'

/* ------------------------------------------------------------------ *
 * The runtime question, asked once
 * ------------------------------------------------------------------ */

/**
 * Why this file cannot run, or `false` when it can.
 *
 * A missing export is thrown rather than skipped: a bundle that does not publish
 * the storage surface would skip every test below and look like a clean run.
 */
const NO_SQLITE = (() => {
  if (typeof api.openDatabase !== 'function' || typeof api.sqliteIsAvailable !== 'function') {
    throw new Error('build/main/ipc.cjs does not publish the storage surface; rebuild the main bundle first')
  }
  if (api.sqliteIsAvailable()) return false
  return 'this runtime has no node:sqlite, so no database can be opened; run these tests under Electron'
})()

/** Register a test that is skipped, with the reason stated, when there is no SQLite. */
function storageTest (name, body) {
  test(name, (t) => {
    if (NO_SQLITE !== false) return t.skip(NO_SQLITE)
    return body(t)
  })
}

/* ------------------------------------------------------------------ *
 * Files that clean themselves up
 * ------------------------------------------------------------------ */

/** The database directories this run made, removed once at the end. */
const madeDirectories = []

/** A path to a database file in a directory of its own, so tests cannot collide. */
function freshDatabasePath () {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-db-'))
  madeDirectories.push(directory)
  return path.join(directory, 'copilot.db')
}

/*
 * On Windows a file that a test forgot to close stays locked, which is why the
 * removal retries. A failure here after a leaked handle is worth seeing rather
 * than being swallowed, so nothing about it is caught.
 */
test.after(() => {
  for (const directory of madeDirectories) {
    // Recursive, because the journal (`-wal`) and shared-memory (`-shm`) siblings
    // live beside the database and must go with it.
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
  madeDirectories.length = 0
})

/** Every file in a database's directory, main file and journal alike. */
function filesBeside (filePath) {
  const directory = path.dirname(filePath)
  return fs.readdirSync(directory).map((name) => ({
    name,
    bytes: fs.readFileSync(path.join(directory, name)),
  }))
}

/** The first column of the row a pragma answers with. */
function pragmaValue (db, pragma) {
  // The pragma name is a literal in this file, never a value from a row or a
  // screen, so building the statement here is safe.
  const row = db.prepare('PRAGMA ' + pragma).get()
  if (row === undefined) return undefined
  const values = Object.values(row)
  return values.length > 0 ? values[0] : undefined
}

/** The versions recorded in the bookkeeping table, oldest first. */
function recordedVersions (db) {
  return db
    .prepare('SELECT version FROM schema_migration ORDER BY version ASC')
    .all()
    .map((row) => Number(row.version))
}

/** A fresh 32-byte key, as the cipher takes it. */
function newKey () {
  return api.databaseKeyFromSecret(api.createKeyMaterial())
}

/** A refusal validator, so every throw below is the storage error it claims to be. */
function storageFailure (expected) {
  return (error) => {
    assert.ok(error instanceof api.StorageError, 'the refusal is not a StorageError: ' + error)
    assert.equal(error.failure, expected)
    return true
  }
}

/** A migration this file controls, so a failure can be arranged on purpose. */
function migration (version, name, sql) {
  return { version, name, sql }
}

/* ------------------------------------------------------------------ *
 * A fresh database, and a reopen
 * ------------------------------------------------------------------ */

storageTest('a fresh file is created with the schema, the key check and the shipped version', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  assert.equal(fs.existsSync(filePath), false, 'the file existed before the open')

  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })

  try {
    // The shipped migration list, not a fixture: the real schema is what a person
    // gets on the first launch. Written as the list rather than a count, so adding a
    // migration is a deliberate edit to this line and never a silent pass.
    assert.deepEqual(opened.appliedMigrations, [1, 2])
    assert.equal(opened.version, api.LATEST_MIGRATION_VERSION)
    assert.deepEqual(recordedVersions(opened.db), [1, 2])

    // `created` rather than `verified`: this file had no key check to compare
    // against, so one was written.
    assert.equal(opened.keyCheck, 'created')

    assert.equal(fs.existsSync(filePath), true)
    // Every table the migrations promise, so a migration that half-ran and recorded
    // itself as successful is caught here rather than at the first read.
    const tables = [
      'meta',
      'business',
      'thread',
      'message',
      'memory_item',
      'memory_summary',
      'proposal',
      'audit_entry',
      // Version 2: documents and the knowledge tables.
      'document',
      'document_blob',
      'document_job',
      'chunk',
      'chunk_term',
      'chunk_vector',
      'dna',
      'dna_field',
      'dna_evidence',
      'dna_proposal',
      'dna_proposal_change',
    ]
    for (const table of tables) {
      const found = opened.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table)
      assert.ok(found !== undefined, 'the schema has no ' + table + ' table')
    }

    // The cipher is handed over with the handle, over the same key.
    assert.equal(typeof opened.cipher.seal, 'function')
    assert.equal(typeof opened.close, 'function')
  } finally {
    opened.close()
  }
})

storageTest('reopening with the same key verifies it and runs no migration again', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const first = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  assert.equal(first.keyCheck, 'created')
  first.close()

  const second = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    // Nothing was pending, so nothing ran. A migration re-run here would either
    // fail on a table that exists or quietly redo work that already happened.
    assert.deepEqual(second.appliedMigrations, [])
    assert.equal(second.keyCheck, 'verified')
    assert.equal(second.version, api.LATEST_MIGRATION_VERSION)
    assert.deepEqual(recordedVersions(second.db), [1, 2])

    // And the schema the first open created is still the one in use.
    const found = second.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message'")
      .get()
    assert.ok(found !== undefined, 'the schema did not survive the reopen')
  } finally {
    second.close()
  }
})

storageTest('reopening with a different key refuses the file and leaves it readable', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const first = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  first.close()

  // A second person on one machine, or the same person after a key rotation that
  // did not reach this file.
  assert.throws(
    () => api.openDatabase({ filePath, key: newKey(), vectorExtensionPath: null }),
    storageFailure('bad_key'),
  )

  /*
   * The refusal happens at the key check, before a migration runs, so the file is
   * exactly as the owner left it. Proving that needs the real key.
   */
  const owner = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    assert.equal(owner.keyCheck, 'verified')
    assert.deepEqual(owner.appliedMigrations, [])
  } finally {
    owner.close()
  }
})

storageTest('rows written before a close are there after a reopen', () => {
  const filePath = freshDatabasePath()
  const key = newKey()
  const plaintext = 'a row that must survive a restart'

  const first = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    first.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?)')
      .run('probe', first.cipher.seal('meta.probe', plaintext))
  } finally {
    first.close()
  }

  const second = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    const row = second.db.prepare('SELECT value FROM meta WHERE key = ?').get('probe')
    assert.ok(row !== undefined, 'the row was not there after the reopen')
    assert.equal(second.cipher.open('meta.probe', row.value), plaintext)

    // The key check row is still the one the first open wrote, which is the other
    // thing a reopen has to read.
    const stored = second.db.prepare('SELECT value FROM meta WHERE key = ?').get('key_check')
    assert.equal(second.cipher.canOpen(api.KEY_CHECK_CONTEXT, stored.value), true)
  } finally {
    second.close()
  }
})

/* ------------------------------------------------------------------ *
 * Migrations that fail, and a database that is ahead
 * ------------------------------------------------------------------ */

storageTest('a migration that fails leaves the database on the previous version', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const good = migration(1, 'probe-one', 'CREATE TABLE probe_one (id TEXT PRIMARY KEY);')

  /*
   * Migration 2 creates its table, writes a row and then fails. Rollback is the
   * only thing that can remove the table it already created, so this is what
   * separates a real transaction from a runner that merely stopped early.
   */
  const bad = migration(2, 'probe-two', [
    'CREATE TABLE probe_two (id TEXT PRIMARY KEY);',
    "INSERT INTO probe_two (id) VALUES ('x');",
    "INSERT INTO a_table_that_does_not_exist (id) VALUES (1);",
  ].join('\n'))

  assert.throws(
    () => api.openDatabase({ filePath, key, migrations: [good, bad], vectorExtensionPath: null }),
    storageFailure('migration_failed'),
  )

  // Migration 1 committed before migration 2 ran, so the next launch resumes from
  // version 1 rather than starting over.
  const reopened = api.openDatabase({ filePath, key, migrations: [good], vectorExtensionPath: null })
  try {
    assert.deepEqual(reopened.appliedMigrations, [])
    assert.equal(reopened.keyCheck, 'verified')
    assert.deepEqual(recordedVersions(reopened.db), [1])

    const survived = reopened.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe_one'")
      .get()
    assert.ok(survived !== undefined, 'the migration that succeeded was rolled back too')

    const rolledBack = reopened.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'probe_two'")
      .get()
    // The table version 2 created before it failed is gone, which is what makes
    // "nothing was changed" true rather than hopeful.
    assert.equal(rolledBack, undefined, 'the failed migration left its table behind')
  } finally {
    reopened.close()
  }
})

storageTest('a database written by a newer build is refused rather than guessed at', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const first = migration(1, 'probe-one', 'CREATE TABLE probe_one (id TEXT PRIMARY KEY);')
  const second = migration(2, 'probe-two', 'CREATE TABLE probe_two (id TEXT PRIMARY KEY);')

  // A build that knows two migrations ran both of them.
  const ahead = api.openDatabase({ filePath, key, migrations: [first, second], vectorExtensionPath: null })
  try {
    assert.deepEqual(ahead.appliedMigrations, [1, 2])
    assert.equal(ahead.version, 2)
  } finally {
    ahead.close()
  }

  // This build only knows version 1. Rolling backwards would mean inventing what
  // version 2 did to the rows, so the open is refused instead.
  assert.throws(
    () => api.openDatabase({ filePath, key, migrations: [first], vectorExtensionPath: null }),
    storageFailure('migration_failed'),
  )

  // The refusal repeated is the same refusal: the open did not consume or rewrite
  // anything on its way to saying no.
  assert.throws(
    () => api.openDatabase({ filePath, key, migrations: [first], vectorExtensionPath: null }),
    storageFailure('migration_failed'),
  )

  /*
   * And the newer schema is still on disk. `probe_two` is the effect version 2
   * had, so its name surviving in the file is the cheap, honest way to see that
   * the refused opens left the database alone.
   */
  const files = filesBeside(filePath)
  assert.ok(
    files.some((file) => file.bytes.includes(Buffer.from('probe_two', 'utf8'))),
    'the newer schema is no longer in the file, so the refusal rewrote it',
  )
})

/* ------------------------------------------------------------------ *
 * What the handle is set up to do
 * ------------------------------------------------------------------ */

storageTest('the pragmas that make an interrupted write survivable are in effect', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    // WAL is what lets a read happen while a write is in flight, and what keeps a
    // torn write from corrupting the page around a sealed column.
    assert.equal(String(pragmaValue(opened.db, 'journal_mode')).toLowerCase(), 'wal')

    // Foreign keys are per connection and off by default in SQLite, so a database
    // that forgot this would keep orphaned rows after a cascade was expected.
    assert.equal(String(pragmaValue(opened.db, 'foreign_keys')), '1')
  } finally {
    opened.close()
  }
})

storageTest('closing twice is not a failure', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  opened.close()

  // A window closing and a sign-out both close the database, and neither can be
  // sure the other did not get there first.
  assert.doesNotThrow(() => opened.close())
  assert.doesNotThrow(() => opened.close())

  // The file is still a database the owner can open, so the second close did not
  // take anything with it.
  const reopened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  try {
    assert.equal(reopened.keyCheck, 'verified')
  } finally {
    reopened.close()
  }
})

/* ------------------------------------------------------------------ *
 * What the file holds
 * ------------------------------------------------------------------ */

storageTest('the file on disk holds ciphertext, not the plaintext that was written', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  const marker = 'plaintext-marker-no-disk-4f1c'
  const businessName = 'Zuri Lofts ' + marker
  const scopeId = api.scopeKey({ serverHost: 'zuri.example.test', userId: 7 })

  const opened = api.openDatabase({ filePath, key, vectorExtensionPath: null })
  let sealed
  try {
    sealed = opened.cipher.seal('business.name_enc', businessName)
    opened.db
      .prepare(
        'INSERT INTO business (id, scope_id, remote_workspace_id, name_enc, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('b0001', scopeId, 1, sealed, NOW, NOW)
  } finally {
    opened.close()
  }

  /*
   * Every file in the directory, not just the main one. A write lives in the
   * `-wal` journal until the last connection closes, and that close folds the
   * journal into the main file and removes it, so scanning all of them makes the
   * check independent of when it runs.
   */
  const files = filesBeside(filePath)

  // The positive control: the sealed value is on disk, so a missing plaintext
  // below is not the result of looking in the wrong file.
  assert.ok(
    files.some((file) => file.bytes.includes(Buffer.from(sealed, 'utf8'))),
    'no file holds the sealed value, so the plaintext check proves nothing',
  )

  for (const file of files) {
    assert.equal(
      file.bytes.includes(Buffer.from(businessName, 'utf8')),
      false,
      file.name + ' holds the plaintext',
    )
    assert.equal(
      file.bytes.includes(Buffer.from(marker, 'utf8')),
      false,
      file.name + ' holds the marker',
    )
  }
})

/* ------------------------------------------------------------------ *
 * The vector extension
 * ------------------------------------------------------------------ */

storageTest('the vector extension is reported, and a build without it still opens', () => {
  const filePath = freshDatabasePath()
  const key = newKey()

  // The same question `openDatabase` asks when no path is injected.
  const extensionPath = api.resolveVectorExtensionPath()
  assert.ok(
    extensionPath === null || typeof extensionPath === 'string',
    'the resolver answered with neither a path nor null: ' + extensionPath,
  )

  const opened = api.openDatabase({ filePath, key })
  try {
    if (extensionPath === null) {
      // The ordinary state on a partial install. Chat and memory work without
      // vectors, so this is a fact to report rather than a reason to refuse.
      assert.deepEqual(opened.vector, { loaded: false, version: null })
    } else {
      /*
       * A path that resolves but will not load is a torn install: the package is
       * there and its platform binary is not usable. That is worth failing on
       * rather than reporting as "no vectors available".
       */
      assert.equal(opened.vector.loaded, true, 'the extension resolved to ' + extensionPath + ' but did not load')
      assert.equal(typeof opened.vector.version, 'string')
      assert.ok(opened.vector.version.length > 0, 'the extension loaded and reported no version')
    }

    // Either way the open succeeded, which is the promise: vectors are never
    // fatal for the database itself.
    assert.equal(opened.version, api.LATEST_MIGRATION_VERSION)
    assert.deepEqual(opened.appliedMigrations, [1, 2])
  } finally {
    opened.close()
  }
})
