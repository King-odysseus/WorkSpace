/*
 * What every repository is handed, and the two rules they all follow.
 *
 * A repository is a thin, scoped view over tables. It is not a place for business
 * logic, and it deliberately has no method that can read across scopes: the
 * scoping here is structural rather than a convention each file is trusted to
 * remember.
 *
 * The two rules:
 *
 * 1. Every statement puts `scope_id` in the WHERE clause, and every statement that
 *    touches business data also puts `business_id` there. `requireScope()` and
 *    `requireBusinessScope()` below are what turn a missing field into a refusal
 *    instead of a query that quietly matches nothing.
 * 2. Text is sealed and opened through the cipher with a context naming the table
 *    and column. The context is the reason a row copied from one column to another
 *    fails loudly instead of decrypting into a plausible wrong answer.
 */

import { randomBytes } from 'node:crypto'

import type { FieldCipher } from '../cipher.js'
import type { SqlDatabase } from '../driver.js'
import {
  businessScopeSchema,
  scopeKey,
  StorageError,
  storageScopeSchema,
  type BusinessScope,
  type StorageScope,
} from '../../../shared/storage-contract.js'

export interface RepositoryContext {
  db: SqlDatabase
  cipher: FieldCipher
  now: () => string
  newId: () => string
}

/** A row id: 16 random bytes in hex, which sorts and logs safely. */
export function defaultNewId (): string {
  return randomBytes(16).toString('hex')
}

export function createRepositoryContext (
  db: SqlDatabase,
  cipher: FieldCipher,
  options: { now?: () => string; newId?: () => string } = {},
): RepositoryContext {
  return {
    db,
    cipher,
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId ?? defaultNewId,
  }
}

/**
 * A validated scope, or `invalid_request`.
 *
 * Anything reaching a repository has already crossed IPC, so this is the second
 * check rather than the first. It exists because a repository is also called by
 * the main process's own code and by tests, and "the caller was validated earlier"
 * is exactly the assumption that stops being true.
 */
export function requireScope (scope: unknown): StorageScope {
  const parsed = storageScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StorageError('invalid_request')
  return parsed.data
}

export function requireBusinessScope (scope: unknown): BusinessScope {
  const parsed = businessScopeSchema.safeParse(scope)
  if (!parsed.success) throw new StorageError('invalid_request')
  return parsed.data
}

/**
 * The scope string every row in this database is filed under.
 *
 * It takes either scope shape and keeps only the two fields that name the
 * database. A business scope carries a `businessId` as well, and the scope schema
 * is strict, so passing the whole object straight to `scopeKey` would refuse a
 * perfectly good business scope. Narrowing here means the business id cannot
 * accidentally become part of the database's identity: one person's threads all
 * live in one file, whichever business they belong to.
 */
export function scopeIdOf (scope: StorageScope | BusinessScope): string {
  const candidate = scope as { serverHost?: unknown; userId?: unknown } | null | undefined
  const parsed = storageScopeSchema.safeParse({
    serverHost: candidate?.serverHost,
    userId: candidate?.userId,
  })
  if (!parsed.success) throw new StorageError('invalid_request')
  return scopeKey(parsed.data)
}

/** The cipher context for one column. Kept in one place so it cannot drift. */
export function columnContext (table: string, column: string): string {
  return `${table}.${column}`
}

/** SQLite has no boolean type; 0 and 1 are the only two answers it stores. */
export function toFlag (value: boolean): number {
  return value ? 1 : 0
}

/** Read a stored flag, treating anything that is not 1 as false. */
export function fromFlag (value: unknown): boolean {
  return Number(value) === 1
}

/** A string column, or `null`. Used for the nullable provider fields. */
export function nullableString (value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** An integer column, or `null`. */
export function nullableInteger (value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** A column that must be a string, or the row is unusable. */
export function requiredString (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('internal_error')
  return value
}
