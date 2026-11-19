/*
 * The businesses table: one local row per workspace the assistant has seen.
 *
 * A "business" here is the local handle on a remote workspace. Three decisions
 * are worth stating, because each of them looks arbitrary until the next change
 * touches it.
 *
 * 1. The row is keyed on the remote workspace id, not created on demand. The web
 *    app's workspace is the identity a person knows ("Zuri Lofts"), and it is the
 *    only one the assistant is given when it starts talking. `upsert` is therefore
 *    the write path: the first mention inserts a row, every mention after that
 *    refreshes the name it was told. Nothing here invents a second way to create a
 *    business, so there is no state where two rows claim the same workspace.
 *
 * 2. An archived business is a flag, not a deletion. `upsert` clears that flag,
 *    because a workspace that was archived on the web app and later restored is the
 *    same workspace, and asking the person to set it up again would leave every
 *    thread they had with it attached to a row nothing can reach.
 *
 * 3. Every read is mapped through `businessRowSchema` before it is returned. These
 *    are the rows a screen draws and a context builder quotes, so a column renamed
 *    in a migration must fail here, loudly, rather than reach a screen as a
 *    plausible wrong answer.
 *
 * Scope is not a convention this file is trusted to remember: every statement
 * carries `scope_id` in the WHERE clause, and `scopeIdOf()` turns a malformed scope
 * into a refusal before a statement is built.
 */

import type { SqlRow } from '../driver.js'
import {
  businessRowSchema,
  StorageError,
  type BusinessRow,
  type StorageScope,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  nullableInteger,
  nullableString,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'

/** One workspace as the caller describes it. The local id is generated below. */
export interface BusinessInput {
  remoteWorkspaceId: number
  name: string
}

export interface BusinessRepository {
  upsert (scope: StorageScope, input: BusinessInput): BusinessRow
  get (scope: StorageScope, businessId: string): BusinessRow
  find (scope: StorageScope, businessId: string): BusinessRow | null
  list (scope: StorageScope): BusinessRow[]
  rename (scope: StorageScope, businessId: string, name: string): BusinessRow
  archive (scope: StorageScope, businessId: string): BusinessRow
}

/** The row schema's own bounds, restated where a bad write can be stopped early. */
const MAX_NAME_LENGTH = 120
const MAX_ID_LENGTH = 64

/** The columns this file maps, named once so a mapper cannot drift from a query. */
const COLUMNS = 'id, remote_workspace_id, name_enc, created_at, updated_at, archived_at'

/**
 * Run one database step, turning anything unexpected into a fixed token.
 *
 * A driver error message can quote a bound parameter, and a bound parameter here
 * is a person's row, so nothing it says may travel. `StorageError` is passed
 * through: the cipher's `bad_key` and this file's own `not_found` are answers a
 * caller acts on, not accidents.
 */
function guard<T> (work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('internal_error')
  }
}

/** A row id as this table can hold one, or `invalid_request`. */
function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID_LENGTH) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * A name as it may be stored: trimmed, non-empty, and inside the row schema.
 *
 * Trimming is not cosmetic. A name of spaces passes `typeof === 'string'` and
 * would draw as an unnamed business on every list, which reads as a bug in the
 * screen rather than a bad write.
 */
function requireName (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) throw new StorageError('invalid_request')
  return trimmed
}

/** The caller's description, validated before any row is touched. */
function requireInput (input: unknown): BusinessInput {
  if (typeof input !== 'object' || input === null) throw new StorageError('invalid_request')
  const candidate = input as { remoteWorkspaceId?: unknown; name?: unknown }

  const remoteWorkspaceId = candidate.remoteWorkspaceId
  if (
    typeof remoteWorkspaceId !== 'number' ||
    !Number.isInteger(remoteWorkspaceId) ||
    remoteWorkspaceId < 1
  ) {
    throw new StorageError('invalid_request')
  }

  return { remoteWorkspaceId, name: requireName(candidate.name) }
}

/** One stored row as the rest of the app sees it, with the name opened. */
function toRow (ctx: RepositoryContext, row: SqlRow): BusinessRow {
  return businessRowSchema.parse({
    id: requiredString(row.id),
    remoteWorkspaceId: nullableInteger(row.remote_workspace_id),
    name: ctx.cipher.open(columnContext('business', 'name_enc'), requiredString(row.name_enc)),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
    archivedAt: nullableString(row.archived_at),
  })
}

export function createBusinessRepository (ctx: RepositoryContext): BusinessRepository {
  /** The row for this id in this scope, or null. Every read goes through here. */
  function rowOrNull (scopeId: string, businessId: string): BusinessRow | null {
    return guard(() => {
      const row = ctx.db
        .prepare(`SELECT ${COLUMNS} FROM business WHERE id = ? AND scope_id = ?`)
        .get(businessId, scopeId)
      return row === undefined ? null : toRow(ctx, row)
    })
  }

  /** The same read, made a refusal. A row in another scope is simply not here. */
  function requireRow (scopeId: string, businessId: string): BusinessRow {
    const found = rowOrNull(scopeId, businessId)
    if (found === null) throw new StorageError('not_found')
    return found
  }

  function upsert (scope: StorageScope, input: BusinessInput): BusinessRow {
    const scopeId = scopeIdOf(scope)
    const wanted = requireInput(input)

    return guard(() => {
      const existing = ctx.db
        .prepare('SELECT id FROM business WHERE scope_id = ? AND remote_workspace_id = ?')
        .get(scopeId, wanted.remoteWorkspaceId)

      const now = ctx.now()
      const sealed = ctx.cipher.seal(columnContext('business', 'name_enc'), wanted.name)

      if (existing === undefined) {
        const id = ctx.newId()
        ctx.db
          .prepare(
            'INSERT INTO business (id, scope_id, remote_workspace_id, name_enc, created_at, updated_at, archived_at) ' +
              'VALUES (?, ?, ?, ?, ?, ?, NULL)',
          )
          .run(id, scopeId, wanted.remoteWorkspaceId, sealed, now, now)
        return requireRow(scopeId, id)
      }

      const id = requiredString(existing.id)
      // `archived_at` is cleared here rather than in a separate restore call: a
      // workspace the assistant is being told about again is one it may write to.
      ctx.db
        .prepare(
          'UPDATE business SET name_enc = ?, updated_at = ?, archived_at = NULL WHERE id = ? AND scope_id = ?',
        )
        .run(sealed, now, id, scopeId)
      return requireRow(scopeId, id)
    })
  }

  function get (scope: StorageScope, businessId: string): BusinessRow {
    return requireRow(scopeIdOf(scope), requireId(businessId))
  }

  function find (scope: StorageScope, businessId: string): BusinessRow | null {
    return rowOrNull(scopeIdOf(scope), requireId(businessId))
  }

  /*
   * Archived rows are listed. Archiving is something the person did on the web
   * app, and hiding it here would make a restore impossible to see: the row comes
   * back with a name and an archive stamp, which is a fact the screen can state.
   */
  function list (scope: StorageScope): BusinessRow[] {
    const scopeId = scopeIdOf(scope)
    return guard(() => {
      const rows = ctx.db
        .prepare(`SELECT ${COLUMNS} FROM business WHERE scope_id = ? ORDER BY updated_at DESC`)
        .all(scopeId)
      return rows.map((row) => toRow(ctx, row))
    })
  }

  function rename (scope: StorageScope, businessId: string, name: string): BusinessRow {
    const scopeId = scopeIdOf(scope)
    const id = requireId(businessId)
    const wanted = requireName(name)

    return guard(() => {
      const result = ctx.db
        .prepare('UPDATE business SET name_enc = ?, updated_at = ? WHERE id = ? AND scope_id = ?')
        .run(ctx.cipher.seal(columnContext('business', 'name_enc'), wanted), ctx.now(), id, scopeId)

      // Zero changed rows means the id is not in this scope, which is the same
      // answer as a read of it: not here, and never a silent success.
      if (Number(result.changes) === 0) throw new StorageError('not_found')
      return requireRow(scopeId, id)
    })
  }

  function archive (scope: StorageScope, businessId: string): BusinessRow {
    const scopeId = scopeIdOf(scope)
    const id = requireId(businessId)

    return guard(() => {
      const now = ctx.now()
      const result = ctx.db
        .prepare('UPDATE business SET archived_at = ?, updated_at = ? WHERE id = ? AND scope_id = ?')
        .run(now, now, id, scopeId)

      if (Number(result.changes) === 0) throw new StorageError('not_found')
      return requireRow(scopeId, id)
    })
  }

  return Object.freeze({ upsert, get, find, list, rename, archive })
}
