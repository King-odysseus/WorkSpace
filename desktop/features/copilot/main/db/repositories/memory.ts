/*
 * The memory items the assistant keeps for one business.
 *
 * The plan's rule (section 11) is that memory is what the assistant has been told
 * or has concluded, and that a person can always take it back. This file is where
 * that rule becomes columns, and three choices here are worth knowing before
 * reading the SQL.
 *
 * Remove is a tombstone. The row stays with `deleted_at` set, so an item is gone
 * from every read at once, and the row that held it is still there to explain what
 * was removed and when. Nothing in this file issues a DELETE. `listRemoved` is the
 * one read that sees tombstones, and it exists so a sentence a person took back
 * cannot be learned again from the message it was first taken from.
 *
 * An edit locks the item. `edit` writes the new wording, sets `origin` to `user`
 * and sets `locked` to 1, so a later extraction reads the flag and leaves that
 * sentence alone. Without the flag, the next summary would quietly overwrite a
 * correction, and the assistant would look like it forgot what it was told.
 *
 * Every statement is scoped twice. `scope_id` is the person and the server,
 * `business_id` is the business inside that database, and both appear in the WHERE
 * clause of every read and write. Two businesses on one machine are two separate
 * assistants, so a row id on its own must never be enough to reach a row.
 *
 * Text is stored sealed, under a context naming the table and the column, and
 * every row that leaves this file is parsed by `memoryRowSchema` first, so a row
 * that somehow holds garbage is refused here instead of being drawn on a screen.
 */

import type { SqlRow, SqlValue } from '../driver.js'
import {
  memoryKinds,
  memoryRowSchema,
  StorageError,
  type BusinessScope,
  type MemoryKind,
  type MemoryOrigin,
  type MemoryRow,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  fromFlag,
  nullableString,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  toFlag,
  type RepositoryContext,
} from './context.js'

export interface AddMemoryInput {
  kind: MemoryKind
  text: string
  sourceMessageId?: string | null
  origin?: MemoryOrigin
}

export interface ListMemoryOptions {
  kinds?: readonly MemoryKind[]
}

export interface MemoryRepository {
  add (scope: BusinessScope, input: AddMemoryInput): MemoryRow
  list (scope: BusinessScope, options?: ListMemoryOptions): MemoryRow[]
  /**
   * The items this business has been asked to forget, newest removal first.
   *
   * Kept apart from `list` rather than added to it as a flag, so that a listing the
   * screen draws is never a listing that includes what a person took back, and so
   * that the two windows cannot crowd each other out: a business with many
   * removals would otherwise push live items past the cap and weaken the very
   * duplicate checks that read this.
   *
   * A removal is a tombstone, so these rows still hold their wording. That is what
   * lets a caller recognise the sentence and refuse to store it again.
   */
  listRemoved (scope: BusinessScope): MemoryRow[]
  get (scope: BusinessScope, memoryId: string): MemoryRow
  edit (scope: BusinessScope, memoryId: string, text: string): MemoryRow
  remove (scope: BusinessScope, memoryId: string): void
}

const MEMORY_TABLE = 'memory_item'

/** The columns one row needs. `deleted_at` is filtered on, never read back. */
const MEMORY_COLUMNS =
  'id, kind, text_enc, source_message_id, origin, locked, created_at, updated_at'

/**
 * The hard cap on one listing.
 *
 * The screen shows a short list, and a business that has been used for a year can
 * hold thousands of items. A cap keeps one call from turning into an unbounded
 * read that blocks the main process; a caller that needs more than this needs a
 * search, which is a different feature.
 */
const MEMORY_LIST_LIMIT = 200

/**
 * The scope string every row is filed under, from a business scope.
 *
 * `scopeIdOf` validates a `StorageScope` strictly, and a `BusinessScope` carries
 * one extra key, so the two fields it does want are handed over on their own. The
 * business is not lost by this: it is the second half of every WHERE clause below.
 */
function scopeIdFor (scope: BusinessScope): string {
  return scopeIdOf({ serverHost: scope.serverHost, userId: scope.userId })
}

/** A row id as given, or a refusal. A missing id is a bug, not an empty answer. */
function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new StorageError('invalid_request')
  return value
}

/**
 * The kinds a caller asked for, or a refusal, or `null` for "every kind".
 *
 * A kind this build does not know is refused rather than answered with an empty
 * list: a filter that matches nothing and a filter for a kind that does not exist
 * look identical on screen, and only one of them is the caller's mistake.
 */
function requireKinds (value: unknown): MemoryKind[] | null {
  if (value === undefined) return null
  if (!Array.isArray(value)) throw new StorageError('invalid_request')
  const known: readonly string[] = memoryKinds
  const kinds: MemoryKind[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !known.includes(item)) {
      throw new StorageError('invalid_request')
    }
    kinds.push(item as MemoryKind)
  }
  return kinds
}

/**
 * The text a person or a model wrote, refused when it cannot be stored as given.
 *
 * Whitespace only is refused because nobody meant to remember a blank line, and a
 * row holding only spaces would render as an empty card the person cannot explain.
 * The length bound is left to the row schema, which is the one place the shape of
 * a row is stated.
 */
function requireText (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  if (value.trim() === '') throw new StorageError('invalid_request')
  return value
}

export function createMemoryRepository (ctx: RepositoryContext): MemoryRepository {
  // Named once, because the same context must be used to seal and to open. A typo
  // in one of two call sites would produce a row that cannot be read back.
  const textContext = columnContext(MEMORY_TABLE, 'text_enc')

  /** The validated scope, as the two strings every statement binds. */
  function scoped (scope: BusinessScope): { scopeId: string; businessId: string } {
    const validated = requireBusinessScope(scope)
    return { scopeId: scopeIdFor(validated), businessId: validated.businessId }
  }

  /** One stored row, opened and validated. */
  function toRow (row: SqlRow): MemoryRow {
    return memoryRowSchema.parse({
      id: requiredString(row.id),
      kind: requiredString(row.kind),
      text: ctx.cipher.open(textContext, requiredString(row.text_enc)),
      sourceMessageId: nullableString(row.source_message_id),
      origin: requiredString(row.origin),
      // SQLite has no boolean type, so the stored 0 or 1 is read back as one.
      locked: fromFlag(row.locked),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    })
  }

  /**
   * One row by id, inside this scope and this business, or `not_found`.
   *
   * `deleted_at IS NULL` is part of the lookup rather than a check afterwards: a
   * tombstoned item is gone, and a caller asking for it by id is asking for
   * something that no longer exists rather than something it may see.
   */
  function readOne (scope: BusinessScope, memoryId: string): MemoryRow {
    const { scopeId, businessId } = scoped(scope)
    const row = ctx.db
      .prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memory_item
          WHERE id = ? AND scope_id = ? AND business_id = ? AND deleted_at IS NULL`,
      )
      .get(memoryId, scopeId, businessId)
    if (row === undefined) throw new StorageError('not_found')
    return toRow(row)
  }

  /**
   * Run one unit of work, keeping a storage refusal and hiding everything else.
   *
   * A SQLite error message can quote the statement and a bound value, and a bound
   * value here is a person's sentence. Anything that is not already a
   * `StorageError` therefore becomes the fixed `internal_error` token, which is
   * all a screen or a log line may carry.
   */
  function guarded<T> (work: () => T): T {
    try {
      return work()
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return {
    add (scope, input) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const at = ctx.now()

        /*
         * The row is validated before it is written rather than after, so a kind
         * or an origin this build does not know is refused as a bad request
         * instead of being stored and then failing to open on the next read.
         */
        const prospective = memoryRowSchema.safeParse({
          id: ctx.newId(),
          kind: input?.kind,
          text: requireText(input?.text),
          // A row with no source message is the ordinary case for a fact the
          // person typed, so `undefined` and `null` both store as null.
          sourceMessageId: nullableString(input?.sourceMessageId),
          // An extraction always names itself; only a caller that inserts on a
          // person's behalf says `user`.
          origin: input?.origin ?? 'ai',
          locked: false,
          createdAt: at,
          updatedAt: at,
        })
        if (!prospective.success) throw new StorageError('invalid_request')
        const row = prospective.data

        /*
         * The source message, when one is named, must be this business's. The
         * conditional insert does that inside the write rather than as a read
         * beforehand, so the answer cannot change between the check and the row.
         * A memory item pointing at somebody else's message would quote a
         * conversation this business never had, which is the leak this guards.
         */
        const written = ctx.db
          .prepare(
            `INSERT INTO memory_item
               (id, scope_id, business_id, kind, text_enc, source_message_id,
                origin, locked, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE ? IS NULL
                OR EXISTS (
                  SELECT 1 FROM message
                   WHERE id = ? AND scope_id = ? AND business_id = ?
                )`,
          )
          .run(
            row.id,
            scopeId,
            businessId,
            row.kind,
            ctx.cipher.seal(textContext, row.text),
            row.sourceMessageId,
            row.origin,
            // A new item is never locked: only a person's edit takes it out of the
            // extraction's reach.
            toFlag(row.locked),
            row.createdAt,
            row.updatedAt,
            row.sourceMessageId,
            row.sourceMessageId,
            scopeId,
            businessId,
          )

        // Nothing written means the source message is not in this business.
        if (Number(written.changes) === 0) throw new StorageError('not_found')

        // Read back rather than returning `row`: what is returned is then what the
        // database holds, envelope and all, not what this function intended.
        return readOne(scope, row.id)
      })
    },

    list (scope, options) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const params: SqlValue[] = [scopeId, businessId]
        let kindFilter = ''

        const kinds = requireKinds(options?.kinds)
        if (kinds !== null) {
          // No kind asked for means nothing matches. Returning the whole list
          // instead would answer a different question than the one asked.
          if (kinds.length === 0) return []
          kindFilter = ` AND kind IN (${kinds.map(() => '?').join(', ')})`
          params.push(...kinds)
        }
        params.push(MEMORY_LIST_LIMIT)

        const rows = ctx.db
          .prepare(
            `SELECT ${MEMORY_COLUMNS} FROM memory_item
              WHERE scope_id = ? AND business_id = ? AND deleted_at IS NULL${kindFilter}
              ORDER BY created_at DESC, id DESC
              LIMIT ?`,
          )
          .all(...params)
        return rows.map(toRow)
      })
    },

    listRemoved (scope) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const rows = ctx.db
          .prepare(
            `SELECT ${MEMORY_COLUMNS} FROM memory_item
              WHERE scope_id = ? AND business_id = ? AND deleted_at IS NOT NULL
              ORDER BY deleted_at DESC, id DESC
              LIMIT ?`,
          )
          .all(scopeId, businessId, MEMORY_LIST_LIMIT)
        return rows.map(toRow)
      })
    },

    get (scope, memoryId) {
      return guarded(() => readOne(scope, requireId(memoryId)))
    },

    edit (scope, memoryId, text) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(memoryId)
        const newText = requireText(text)

        const result = ctx.db
          .prepare(
            `UPDATE memory_item
                SET text_enc = ?, origin = ?, locked = ?, updated_at = ?
              WHERE id = ? AND scope_id = ? AND business_id = ? AND deleted_at IS NULL`,
          )
          .run(
            ctx.cipher.seal(textContext, newText),
            // The two columns that make this a correction rather than a suggestion:
            // the item now belongs to the person, and it is closed to extraction.
            'user',
            toFlag(true),
            ctx.now(),
            id,
            scopeId,
            businessId,
          )

        // Nothing updated means the id was never this business's, or it is
        // tombstoned. Both are "that item is not here" to the person asking.
        if (Number(result.changes) === 0) throw new StorageError('not_found')
        return readOne(scope, id)
      })
    },

    remove (scope, memoryId) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(memoryId)
        const at = ctx.now()

        const result = ctx.db
          .prepare(
            `UPDATE memory_item
                SET deleted_at = ?, updated_at = ?
              WHERE id = ? AND scope_id = ? AND business_id = ? AND deleted_at IS NULL`,
          )
          .run(at, at, id, scopeId, businessId)

        // An item that was already removed is not removed twice: the second call
        // reports that there is nothing there, rather than quietly succeeding.
        if (Number(result.changes) === 0) throw new StorageError('not_found')
      })
    },
  }
}
