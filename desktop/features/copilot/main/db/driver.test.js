'use strict'

/*
 * The one module that touches SQLite, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven is the same
 * CommonJS the main process runs. The surface arrives through the build entry's
 * re-export of `main/db/driver.ts`; if a test fails with "api.loadSqliteDriver is
 * not a function", the missing re-export is the fault.
 *
 * The engine is Node's built-in `node:sqlite`, which Electron's main process has
 * and a bare `node` build may not. On a machine without it the honest answer is a
 * skip with a reason, not a red suite: there is no engine to drive, and pretending
 * otherwise would make every other storage test look flaky. The first test runs
 * everywhere, because "can this build say whether it has an engine" is a question
 * that must never crash a main process.
 *
 * What is worth proving when the engine is there:
 *
 * - Opening an in-memory database and reading one row works at all, so a driver
 *   that returned a wrapper around nothing would fail here.
 * - A write reports how many rows it changed, and a lookup that finds nothing is
 *   `undefined` rather than an empty object. The repositories tell "absent" from
 *   "present but empty" from exactly that distinction.
 * - `loadExtension` reaches the engine. A stub that accepted a path and did
 *   nothing would look identical to a working one until Phase 4 needed vectors, so
 *   a path the engine cannot load has to throw. The file used below exists and is
 *   not a library, which makes the refusal an answer from SQLite rather than from
 *   a missing-file check.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/**
 * Whether this runtime has the engine, and why not when it does not.
 *
 * Two different absences are kept apart on purpose. A build with no
 * `node:sqlite` is a machine fact and an ordinary skip. A bundle that does not
 * publish `sqliteIsAvailable` at all is a defect in this build, and folding the
 * two together would let a missing surface read as "no engine here" and skip the
 * three tests that would have noticed. Calling an undefined function would also
 * throw out of this file's top level and take every test with it, so the surface
 * is checked by type before it is called.
 */
function noEngineReason () {
  if (typeof api.sqliteIsAvailable !== 'function') {
    return 'the bundle does not publish sqliteIsAvailable, so there is no engine to ask about'
  }
  try {
    if (api.sqliteIsAvailable() === true) return false
  } catch {
    return 'sqliteIsAvailable threw instead of answering, so the engine is not known'
  }
  return 'this Node build has no node:sqlite, so there is no engine to drive'
}

/** False when the engine is there, otherwise the plain reason each test carries. */
const noEngine = noEngineReason()

/**
 * An in-memory database, closed by the caller.
 *
 * The driver is asserted rather than assumed: an engine this build reports as
 * available but a driver it cannot publish would otherwise throw a TypeError
 * from inside the helper, which reads like a test bug instead of the missing
 * surface it is.
 */
function memoryDatabase (allowExtension) {
  assert.equal(
    typeof api.loadSqliteDriver,
    'function',
    'the bundle does not publish loadSqliteDriver, so no database can be opened',
  )
  const open = api.loadSqliteDriver()
  return open(':memory:', { allowExtension })
}

/* ------------------------------------------------------------------ *
 * Everywhere, engine or not
 * ------------------------------------------------------------------ */

test('this build can say whether it has a SQLite engine without opening one', () => {
  assert.equal(
    typeof api.sqliteIsAvailable,
    'function',
    'the bundle does not publish sqliteIsAvailable',
  )

  let answer
  assert.doesNotThrow(() => { answer = api.sqliteIsAvailable() }, 'it threw instead of answering')
  assert.equal(typeof answer, 'boolean')

  // Asking twice is the ordinary case - a screen asks, then a repository opens -
  // so it must stay an answer rather than something that can only be asked once.
  assert.equal(api.sqliteIsAvailable(), answer)
})

/* ------------------------------------------------------------------ *
 * With the engine
 * ------------------------------------------------------------------ */

test('an in-memory database answers a query and closes cleanly', { skip: noEngine }, () => {
  const db = memoryDatabase(false)
  try {
    const row = db.prepare('SELECT 1 AS one').get()

    assert.ok(row, 'SELECT 1 returned no row')
    // Compared as a number because a driver may hand back a bigint for an integer
    // column; what is under test is the value, not its width.
    assert.equal(Number(row.one), 1)
  } finally {
    // Closing is part of the contract this test covers, so it is not in a teardown
    // hook where a failure would only be reported against the next test.
    db.close()
  }
})

test('a write reports how many rows it changed, and a missing row reads as undefined', { skip: noEngine }, () => {
  const db = memoryDatabase(false)
  try {
    db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
    const insert = db.prepare('INSERT INTO note (body) VALUES (?)')

    const written = insert.run('first')
    assert.equal(Number(written.changes), 1)

    // The other half of the same promise: an update matching nothing reports zero
    // rather than a row count nobody can use.
    const updated = db.prepare('UPDATE note SET body = ? WHERE id = ?').run('second', 999)
    assert.equal(Number(updated.changes), 0)

    // A row that is not there is `undefined`, not null and not an empty object,
    // because the repositories tell "absent" from "present but empty" this way.
    assert.equal(db.prepare('SELECT body FROM note WHERE id = ?').get(999), undefined)

    // And a row that is there still reads back, so the case above is not passing
    // because every lookup answers undefined.
    const present = db.prepare('SELECT body FROM note WHERE body = ?').get('first')
    assert.equal(present.body, 'first')
  } finally {
    db.close()
  }
})

test('loading an extension the engine cannot load throws, so the call is wired rather than stubbed', { skip: noEngine }, () => {
  const db = memoryDatabase(true)
  try {
    /*
     * This file exists and is definitively not a shared library, so an engine that
     * really attempts the load refuses it. A path that does not exist would also
     * throw, but it could throw from a wrapper that merely checked for a file
     * instead of calling SQLite, which would prove nothing about the engine.
     */
    const notALibrary = __filename

    assert.throws(
      () => db.loadExtension(notALibrary),
      (error) => error instanceof Error,
      'loading a file that is not an extension returned quietly',
    )
  } finally {
    db.close()
  }
})