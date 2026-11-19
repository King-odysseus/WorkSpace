/*
 * The one place this app touches a SQLite engine.
 *
 * The engine is Node's built-in `node:sqlite`, which Electron's main process has
 * had since Node 22 and which needs no package at all. That is deliberate: the
 * plan's dependency list asked for an encrypted driver, and the answer here is to
 * use the engine that ships with the runtime and encrypt in the application
 * instead (see `cipher.ts`), so the only dependency this phase adds is the vector
 * extension the owner approved.
 *
 * The module is written against a narrow interface rather than a concrete class
 * for two reasons. A test can hand in a fake to prove what the connection layer
 * does when a migration fails, and the interface is small enough that a future
 * engine swap is one file rather than every repository.
 *
 * `node:sqlite` is loaded lazily. A build of Node or Electron without it must fail
 * with a token the app can show, not with a require-time crash that takes the whole
 * main process down before any window exists.
 */

import { StorageError } from '../../shared/storage-contract.js'

/** A value SQLite accepts as a bound parameter. */
export type SqlValue = string | number | bigint | null | Uint8Array

/** Anything SQLite can return for one column. */
export type SqlRow = Record<string, unknown>

export interface SqlStatement {
  run: (...params: SqlValue[]) => { changes: number | bigint }
  get: (...params: SqlValue[]) => SqlRow | undefined
  all: (...params: SqlValue[]) => SqlRow[]
}

export interface SqlDatabase {
  exec: (sql: string) => void
  prepare: (sql: string) => SqlStatement
  /** Load a native extension. Only called when extension loading was enabled. */
  loadExtension: (path: string) => void
  close: () => void
}

/**
 * Opens one database file.
 *
 * `allowExtension` is a creation-time flag in `node:sqlite` and cannot be turned
 * on later, which is why it is part of the open call rather than something the
 * connection layer asks for afterwards.
 */
export type SqlDriver = (filePath: string, options: { allowExtension: boolean }) => SqlDatabase

interface NodeSqliteDatabase {
  exec (sql: string): void
  prepare (sql: string): SqlStatement
  loadExtension (path: string): void
  close (): void
}

interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { allowExtension?: boolean }) => NodeSqliteDatabase
}

/**
 * Find the built-in engine, or say plainly that this runtime has none.
 *
 * `require` is used rather than a static import because a static import of a
 * missing built-in fails while the module graph is loading, before any error
 * handling can exist. Every Electron main process has it; a bare older Node
 * during a test run does not, and that must be an ordinary, reportable answer.
 */
export function loadSqliteDriver (): SqlDriver {
  let module: NodeSqliteModule
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    module = require('node:sqlite') as NodeSqliteModule
  } catch {
    throw new StorageError('runtime_unsupported')
  }
  if (typeof module?.DatabaseSync !== 'function') throw new StorageError('runtime_unsupported')

  const { DatabaseSync } = module
  return (filePath, options) => {
    const db = new DatabaseSync(filePath, { allowExtension: options.allowExtension })
    return {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      loadExtension: (path) => db.loadExtension(path),
      close: () => db.close(),
    }
  }
}

/** True when this runtime can open a database at all, without opening one. */
export function sqliteIsAvailable (): boolean {
  try {
    loadSqliteDriver()
    return true
  } catch {
    return false
  }
}
