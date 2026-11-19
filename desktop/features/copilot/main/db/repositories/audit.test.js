'use strict'

/*
 * The audit repository, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proved here is the
 * CommonJS the main process runs.
 *
 * Every test opens a real database file in a temporary directory and closes it
 * again. That is deliberate: the interesting behaviour is not the JavaScript
 * around the rows, it is what SQLite actually stores. A fake connection could
 * agree with this file about scoping and ordering while the shipped statement
 * did something else, and the ciphertext test in particular has nothing to read
 * at all without a real row on a real page.
 *
 * What is worth proving, one group each:
 *
 * - An event written once is read back whole, with its action, outcome and
 *   detail, and a business-bound entry keeps its business id under the name the
 *   contract uses.
 * - Rows are scoped: another account on the same server and the same account on
 *   another server both see nothing.
 * - A read returns the recent past, newest first, inside the size it was asked
 *   for and inside the cap it was not.
 * - The detail is ciphertext in the table, not text next to the words that
 *   describe the event.
 * - A request that cannot be written as given is refused with the token the
 *   screen knows, and leaves no row behind.
 * - A database failure is reported as the storage layer's own token rather than
 *   as the driver's message, because that message can quote a bound value.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const api = require('../../../../../build/main/ipc.cjs')

/** The 32 key bytes the database is opened with. Not a credential: just key material. */
const KEY = randomBytes(32)

/** The person these tests are signed in as, on one server. */
const SERVER = 'zuri.example.test'
const USER = 7
const SCOPE = { serverHost: SERVER, userId: USER }

/**
 * A fresh database file in its own directory, and the repository over it.
 *
 * No clock and no id generator are injected: the ones the app builds are what a
 * real row carries, and the ordering test needs whatever those produce.
 */
function openHarness () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-audit-'))
  const filePath = path.join(dir, 'assistant.db')
  const opened = api.openDatabase({ filePath, key: KEY, vectorExtensionPath: null })
  const repository = api.createAuditRepository(
    api.createRepositoryContext(opened.db, opened.cipher),
  )

  return {
    dir,
    filePath,
    opened,
    repository,

    /** How many rows the table really holds, whatever the scope filter says. */
    rowCount () {
      const row = opened.db.prepare('SELECT COUNT(*) AS count FROM audit_entry').get()
      return Number(row.count)
    },

    /** Close the handle, then remove the file and its WAL companions. */
    close () {
      opened.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** A refusal is the storage layer's token, not a Zod error and not a driver message. */
function isStorageRefusal (failure) {
  return (error) => {
    assert.equal(error.name, 'StorageError', `not a StorageError: ${String(error)}`)
    assert.equal(error.failure, failure)
    return true
  }
}

/* ------------------------------------------------------------------ *
 * Writing and reading an entry
 * ------------------------------------------------------------------ */

test('an entry that was written once is read back with its action, outcome and detail', () => {
  const harness = openHarness()
  try {
    const written = harness.repository.record(SCOPE, {
      action: 'provider.test',
      outcome: 'allowed',
      detail: 'channel=providers cloud=true models=2',
    })

    // The id is this module's own, and it is hex so it sorts and logs safely.
    assert.match(written.id, /^[0-9a-f]{16,64}$/)
    assert.equal(written.action, 'provider.test')
    assert.equal(written.outcome, 'allowed')
    assert.equal(written.detail, 'channel=providers cloud=true models=2')
    // A person-wide event has no business, and that is a value rather than a gap.
    assert.equal(written.businessId, null)
    assert.equal(Number.isNaN(Date.parse(written.createdAt)), false, written.createdAt)

    const listed = harness.repository.list(SCOPE)
    assert.equal(listed.length, 1)
    assert.deepEqual(listed[0], written)
  } finally {
    harness.close()
  }
})

test('an entry for a business keeps its business id under the contract field name', () => {
  const harness = openHarness()
  try {
    const written = harness.repository.record(SCOPE, {
      action: 'memory.remember',
      outcome: 'allowed',
      detail: 'kind=decision',
      businessId: 'biz-zuri-lofts',
    })
    assert.equal(written.businessId, 'biz-zuri-lofts')

    const [listed] = harness.repository.list(SCOPE)
    // The column is `business_id` and the row field is `businessId`: a reader
    // that returned the column name would draw an undefined id on the screen.
    assert.equal(listed.businessId, 'biz-zuri-lofts')
    assert.equal(Object.hasOwn(listed, 'business_id'), false)
  } finally {
    harness.close()
  }
})

test('an entry with no detail is stored with an empty note rather than a missing one', () => {
  const harness = openHarness()
  try {
    const written = harness.repository.record(SCOPE, { action: 'app.start', outcome: 'allowed' })
    assert.equal(written.detail, '')
    assert.equal(harness.repository.list(SCOPE)[0].detail, '')
  } finally {
    harness.close()
  }
})

/* ------------------------------------------------------------------ *
 * Scoping
 * ------------------------------------------------------------------ */

test('another account on the same server sees none of these entries', () => {
  const harness = openHarness()
  try {
    harness.repository.record(SCOPE, { action: 'provider.test', outcome: 'allowed' })

    assert.deepEqual(harness.repository.list({ serverHost: SERVER, userId: 8 }), [])
    // The row is there; the filter is what hid it, which is the point.
    assert.equal(harness.rowCount(), 1)
  } finally {
    harness.close()
  }
})

test('the same account on another server sees none of these entries', () => {
  const harness = openHarness()
  try {
    harness.repository.record(SCOPE, { action: 'provider.test', outcome: 'allowed' })

    assert.deepEqual(harness.repository.list({ serverHost: 'other.example.test', userId: USER }), [])
    assert.equal(harness.rowCount(), 1)
  } finally {
    harness.close()
  }
})

test('the same server in different case is the same scope, because a host is not case sensitive', () => {
  const harness = openHarness()
  try {
    harness.repository.record(SCOPE, { action: 'provider.test', outcome: 'allowed' })

    // Two spellings of one host must not become two databases, or a person
    // signing in after typing the address differently would see an empty trail.
    assert.equal(harness.repository.list({ serverHost: 'ZURI.example.test', userId: USER }).length, 1)
  } finally {
    harness.close()
  }
})

/* ------------------------------------------------------------------ *
 * Ordering and page size
 * ------------------------------------------------------------------ */

test('list returns the newest entries first', () => {
  const harness = openHarness()
  try {
    for (let index = 0; index < 5; index += 1) {
      harness.repository.record(SCOPE, { action: `entry.${index}`, outcome: 'allowed' })
    }

    const listed = harness.repository.list(SCOPE)
    assert.deepEqual(
      listed.map((row) => row.action),
      ['entry.4', 'entry.3', 'entry.2', 'entry.1', 'entry.0'],
    )
  } finally {
    harness.close()
  }
})

test('list returns no more entries than the limit asked for', () => {
  const harness = openHarness()
  try {
    for (let index = 0; index < 5; index += 1) {
      harness.repository.record(SCOPE, { action: `entry.${index}`, outcome: 'allowed' })
    }

    const listed = harness.repository.list(SCOPE, { limit: 3 })
    assert.equal(listed.length, 3)
    // The limit takes the newest end of the trail, not an arbitrary three.
    assert.deepEqual(listed.map((row) => row.action), ['entry.4', 'entry.3', 'entry.2'])
  } finally {
    harness.close()
  }
})

test('a limit outside one to two hundred is clamped rather than refused', () => {
  const harness = openHarness()
  try {
    for (let index = 0; index < 3; index += 1) {
      harness.repository.record(SCOPE, { action: `entry.${index}`, outcome: 'allowed' })
    }

    // Too small still reads one row: an empty page would look like an empty
    // trail, which is a different and more alarming answer.
    assert.equal(harness.repository.list(SCOPE, { limit: 0 }).length, 1)
    assert.equal(harness.repository.list(SCOPE, { limit: -3 }).length, 1)
    // A fraction is a page size that was computed rather than chosen.
    assert.equal(harness.repository.list(SCOPE, { limit: 2.7 }).length, 2)
    // Too large reads what exists rather than refusing the screen.
    assert.equal(harness.repository.list(SCOPE, { limit: 10_000 }).length, 3)
    // And no option at all is the default page, which holds all three here.
    assert.equal(harness.repository.list(SCOPE).length, 3)
  } finally {
    harness.close()
  }
})

/* ------------------------------------------------------------------ *
 * What the file actually holds
 * ------------------------------------------------------------------ */

test('the detail is ciphertext in the table, never the sentence that was written', () => {
  const harness = openHarness()
  try {
    const detail = 'channel=providers failure=network count=2'
    harness.repository.record(SCOPE, {
      action: 'provider.test',
      outcome: 'failed',
      detail,
    })

    const rows = harness.opened.db.prepare('SELECT action, outcome, detail_enc FROM audit_entry').all()
    assert.equal(rows.length, 1)

    const stored = String(rows[0].detail_enc)
    // The envelope prefix is what `isEnvelope` and the cipher both key off.
    assert.ok(stored.startsWith('v1.'), stored.slice(0, 8))
    assert.equal(stored.includes(detail), false)
    // Not even one word of it: a leak that kept a field name would still be a leak.
    assert.equal(stored.includes('network'), false)
    assert.equal(stored.includes('providers'), false)

    /*
     * The action and the outcome are readable on purpose. They are the trail's
     * query vocabulary and the only way a screen can group or filter it; the
     * detail, which is where a caller could put something private, is the sealed
     * column.
     */
    assert.equal(rows[0].action, 'provider.test')
    assert.equal(rows[0].outcome, 'failed')

    // And the repository still hands the detail back, because it holds the key.
    assert.equal(harness.repository.list(SCOPE)[0].detail, detail)
  } finally {
    harness.close()
  }
})

/* ------------------------------------------------------------------ *
 * Requests that cannot be written
 * ------------------------------------------------------------------ */

test('an action that is empty or longer than eighty characters is refused and writes nothing', () => {
  const harness = openHarness()
  try {
    for (const action of ['', '   ', 'a'.repeat(81)]) {
      assert.throws(
        () => harness.repository.record(SCOPE, { action, outcome: 'allowed' }),
        isStorageRefusal('invalid_request'),
        `action ${JSON.stringify(action)}`,
      )
    }

    assert.deepEqual(harness.repository.list(SCOPE), [])
    assert.equal(harness.rowCount(), 0)
  } finally {
    harness.close()
  }
})

test('a detail longer than five hundred characters is refused and writes nothing', () => {
  const harness = openHarness()
  try {
    assert.throws(
      () => harness.repository.record(SCOPE, {
        action: 'provider.test',
        outcome: 'allowed',
        detail: 'd'.repeat(501),
      }),
      isStorageRefusal('invalid_request'),
    )

    assert.deepEqual(harness.repository.list(SCOPE), [])
    assert.equal(harness.rowCount(), 0)

    // Exactly at the cap is a sentence worth keeping, and it is accepted whole
    // rather than shortened, which is what makes the cap a refusal elsewhere.
    const atCap = harness.repository.record(SCOPE, {
      action: 'provider.test',
      outcome: 'allowed',
      detail: 'd'.repeat(500),
    })
    assert.equal(atCap.detail.length, 500)
    assert.equal(harness.rowCount(), 1)
  } finally {
    harness.close()
  }
})

test('an outcome that is not one of the three is refused rather than stored', () => {
  const harness = openHarness()
  try {
    for (const outcome of ['maybe', '', 'ALLOWED', null, 7]) {
      assert.throws(
        () => harness.repository.record(SCOPE, { action: 'provider.test', outcome }),
        isStorageRefusal('invalid_request'),
        `outcome ${JSON.stringify(outcome)}`,
      )
    }

    assert.equal(harness.rowCount(), 0)
  } finally {
    harness.close()
  }
})

test('a scope that is not one person on one server is refused before any row is read', () => {
  const harness = openHarness()
  try {
    harness.repository.record(SCOPE, { action: 'provider.test', outcome: 'allowed' })

    for (const scope of [null, {}, { serverHost: '', userId: USER }, { serverHost: SERVER, userId: 0 }]) {
      assert.throws(
        () => harness.repository.list(scope),
        isStorageRefusal('invalid_request'),
        `scope ${JSON.stringify(scope)}`,
      )
    }
  } finally {
    harness.close()
  }
})

/* ------------------------------------------------------------------ *
 * A database that will not answer
 * ------------------------------------------------------------------ */

test('a database failure is reported as an internal error, not as the driver message', () => {
  const harness = openHarness()
  try {
    harness.opened.close()

    // A closed handle is the ordinary way this happens in the app: the window is
    // still open when the account ends. The driver's own text stays inside this
    // layer, because it can name the statement that failed.
    assert.throws(
      () => harness.repository.list(SCOPE),
      isStorageRefusal('internal_error'),
    )
    assert.throws(
      () => harness.repository.record(SCOPE, { action: 'provider.test', outcome: 'allowed' }),
      isStorageRefusal('internal_error'),
    )
  } finally {
    harness.close()
  }
})
