/*
 * Opening, preparing and closing the local database.
 *
 * The order of work in `openDatabase` is the whole design, so it is stated once
 * here rather than being rediscovered:
 *
 * 1. Open the file and set the pragmas that make a crash survivable. WAL and
 *    `synchronous = FULL` are the pair that matters: a laptop lid closing is the
 *    normal way this database gets interrupted, and the point of `_enc` columns is
 *    lost if a torn write can corrupt the row around them.
 * 2. Create the two bookkeeping tables if they are absent. Nothing personal is
 *    stored yet, so this step is safe to repeat and safe on a wrong key.
 * 3. Verify the key against the stored check envelope. A wrong key stops here,
 *    before a single migration runs, so a person who signs into the wrong profile
 *    cannot mutate somebody else's database on the way to being told no.
 * 4. Apply pending migrations, each inside its own transaction, recording the
 *    version in that same transaction. A migration that fails leaves the database
 *    exactly as the previous version left it, and everything already applied stays.
 * 5. Load the vector extension, if this build has one. A missing extension is
 *    reported, never fatal: chat and memory work without vectors, and Phase 4 is
 *    where retrieval starts to need them.
 */

import type { Migration } from './migrations/index.js'
import { LATEST_MIGRATION_VERSION, MIGRATIONS } from './migrations/index.js'
import {
  createFieldCipher,
  KEY_CHECK_CONTEXT,
  KEY_CHECK_PLAINTEXT,
  type FieldCipher,
} from './cipher.js'
import { loadSqliteDriver, type SqlDatabase, type SqlDriver } from './driver.js'
import { StorageError } from '../../shared/storage-contract.js'

/** Bootstrap DDL. Deliberately not a migration: it must exist before one can be recorded. */
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS schema_migration (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

export interface StorageLogger {
  warn (message: string): void
}

export interface VectorStatus {
  loaded: boolean
  version: string | null
}

export interface OpenDatabaseOptions {
  filePath: string
  /** The 32 key bytes, already unwrapped from the keychain by the caller. */
  key: Buffer
  /** Injected by tests; production uses the built-in engine. */
  driver?: SqlDriver
  /** Injected by tests; production uses the numbered list. */
  migrations?: readonly Migration[]
  /**
   * The loadable extension to try. `undefined` means "ask the installed package",
   * and `null` means "do not try" (a test that only cares about rows).
   */
  vectorExtensionPath?: string | null
  now?: () => string
  logger?: StorageLogger
}

export interface OpenDatabase {
  db: SqlDatabase
  cipher: FieldCipher
  appliedMigrations: number[]
  version: number
  vector: VectorStatus
  /** `created` on a fresh database, `verified` on a reopen. Provenance for the report. */
  keyCheck: 'created' | 'verified'
  close: () => void
}

function isoNow (now: (() => string) | undefined): string {
  if (now !== undefined) return now()
  return new Date().toISOString()
}

/**
 * Ask the installed package where its binary is.
 *
 * The `sqlite-vec` package resolves the right file per platform. Requiring it
 * lazily keeps the module loadable on a machine where the optional platform
 * package did not install, which is an ordinary state on a partial install and
 * must not stop the app from opening a database.
 */
export function resolveVectorExtensionPath (logger?: StorageLogger): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('sqlite-vec') as { getLoadablePath?: () => string }
    if (typeof mod?.getLoadablePath !== 'function') return null
    return mod.getLoadablePath()
  } catch (error) {
    logger?.warn('zuricopilot storage: vector extension unavailable')
    return null
  }
}

function loadVector (db: SqlDatabase, path: string | null): VectorStatus {
  if (path === null) return { loaded: false, version: null }
  try {
    db.loadExtension(path)
    const row = db.prepare('SELECT vec_version() AS v').get()
    const version = typeof row?.v === 'string' ? row.v : null
    return { loaded: version !== null, version }
  } catch {
    // A binary that will not load is a Phase 4 problem, not a Phase 3 one, so it
    // is reported rather than thrown. The alternative is an app that refuses to
    // open because a vector index is missing.
    return { loaded: false, version: null }
  }
}

/** The versions already recorded, oldest first. */
function appliedVersions (db: SqlDatabase): number[] {
  const rows = db.prepare('SELECT version FROM schema_migration ORDER BY version ASC').all()
  return rows
    .map((row) => Number(row.version))
    .filter((version) => Number.isInteger(version) && version > 0)
}

function readMeta (db: SqlDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return typeof row?.value === 'string' ? row.value : null
}

function writeMeta (db: SqlDatabase, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

/**
 * Run the pending migrations, one transaction each.
 *
 * Per migration rather than one transaction for all of them: a failure on the
 * fourth should leave the first three applied and recorded, so the next launch
 * resumes instead of redoing work that already succeeded.
 */
function applyMigrations (
  db: SqlDatabase,
  pending: readonly Migration[],
  now: () => string,
): number[] {
  const applied: number[] = []
  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, now())
      db.exec('COMMIT')
      applied.push(migration.version)
    } catch {
      // Roll back, then report the version that failed rather than the SQL: the
      // statement text is code, but the thrown message from a database driver can
      // quote a bound value, and a bound value here is a person's row.
      try {
        db.exec('ROLLBACK')
      } catch {
        // A rollback that itself fails leaves the database on the previous
        // version, which is the state we were aiming for anyway.
      }
      throw new StorageError('migration_failed')
    }
  }
  return applied
}

export function openDatabase (options: OpenDatabaseOptions): OpenDatabase {
  const filePath = options?.filePath
  if (typeof filePath !== 'string' || filePath === '') throw new StorageError('invalid_request')
  const now = () => isoNow(options.now)
  const logger = options.logger

  const driver = options.driver ?? loadSqliteDriver()
  const db = driver(filePath, { allowExtension: true })

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      db.close()
    } catch {
      // Closing a handle that is already gone is not a failure worth surfacing.
    }
  }

  try {
    /*
     * Pragma order matters: `journal_mode` has to be set before the first write,
     * and `foreign_keys` is per connection, so both go here rather than in a
     * migration where they would only apply to whichever connection ran it.
     */
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(BOOTSTRAP_SQL)

    const cipher = createFieldCipher(options.key)

    // Step 3: the key check, before anything personal can be touched.
    const stored = readMeta(db, 'key_check')
    let keyCheck: 'created' | 'verified'
    if (stored === null) {
      writeMeta(db, 'key_check', cipher.seal(KEY_CHECK_CONTEXT, KEY_CHECK_PLAINTEXT))
      keyCheck = 'created'
    } else if (!cipher.canOpen(KEY_CHECK_CONTEXT, stored)) {
      throw new StorageError('bad_key')
    } else {
      keyCheck = 'verified'
    }

    // Step 4: refuse a database written by a newer build rather than guessing.
    const known = options.migrations ?? MIGRATIONS
    const latest = known.reduce((highest, m) => Math.max(highest, m.version), 0)
    const already = appliedVersions(db)
    const newestApplied = already.length === 0 ? 0 : Math.max(...already)
    if (newestApplied > latest || (latest > LATEST_MIGRATION_VERSION && newestApplied > LATEST_MIGRATION_VERSION)) {
      throw new StorageError('migration_failed')
    }

    const pending = known
      .filter((migration) => !already.includes(migration.version))
      .sort((left, right) => left.version - right.version)

    const appliedMigrations = applyMigrations(db, pending, now)

    // Step 5: vectors, reported not fatal.
    const vectorPath = options.vectorExtensionPath === undefined
      ? resolveVectorExtensionPath(logger)
      : options.vectorExtensionPath
    const vector = loadVector(db, vectorPath)

    const version = appliedMigrations.length > 0
      ? Math.max(...appliedMigrations)
      : newestApplied

    return { db, cipher, appliedMigrations, version, vector, keyCheck, close }
  } catch (error) {
    // Any failure on the way up leaves an open handle behind otherwise, and a
    // leaked handle on Windows keeps the file locked against the next attempt.
    close()
    if (error instanceof StorageError) throw error
    throw new StorageError('internal_error')
  }
}
