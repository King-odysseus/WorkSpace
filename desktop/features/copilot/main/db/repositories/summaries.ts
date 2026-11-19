/*
 * The rolling summary of one thread, and the one rule that keeps it honest.
 *
 * Why a stale summary is refused rather than accepted. A summary is produced by a
 * model call that takes seconds, and two of them can be in flight for the same
 * thread: one asked for when the thread reached message four, another when it
 * reached message nine. The older request can answer last. Letting it write would
 * rewind `covers_through_seq` from nine to four, and the context builder would
 * then re-send messages five to nine that the newer summary had already folded
 * away, or worse, skip four messages the rewind left uncovered. So the update
 * only lands when the arriving summary covers at least as much as the stored one,
 * and equal coverage is accepted because rewording a summary of the same range is
 * an improvement rather than a rewind.
 *
 * Why the update is scoped inside the conflict clause. `thread_id` is the primary
 * key, so a conflict can only be resolved by updating the existing row. That row
 * belongs to one business on one server, and a caller that names a thread id it
 * does not own must not be able to replace its text on the way to being told no.
 * The two extra conditions say exactly that, and the read-back afterwards turns a
 * refused write into `conflict` instead of a row this scope cannot see.
 *
 * Why the text is sealed. `text_enc` is a paraphrase of a private conversation;
 * it is the same material as the messages it summarises, so it is encrypted with
 * its own column context and cannot be opened as a message body or a thread
 * title.
 */

import type { SqlRow } from '../driver.js'
import {
  columnContext,
  nullableInteger,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'
import {
  StorageError,
  summaryRowSchema,
  type BusinessScope,
  type SummaryRow,
} from '../../../shared/storage-contract.js'

export interface UpsertSummaryInput {
  threadId: string
  text: string
  coversThroughSeq: number
}

export interface SummaryRepository {
  upsert (scope: BusinessScope, input: UpsertSummaryInput): SummaryRow
  get (scope: BusinessScope, threadId: string): SummaryRow | null
  remove (scope: BusinessScope, threadId: string): void
}

/** The columns the contract's row shape reads, so the mapper cannot drift. */
const SUMMARY_COLUMNS = 'thread_id, text_enc, covers_through_seq, updated_at'

/** The context for the one column that holds the summary itself. */
const TEXT_CONTEXT = columnContext('memory_summary', 'text_enc')

/* The bounds the row schema enforces, restated where a write can still be refused. */
const MAX_TEXT = 20_000

/**
 * One summary per thread, written or replaced by coverage.
 *
 * The row is selected *from `thread`*, so a summary can only be created for a
 * thread that exists in this scope and this business. A plain `VALUES` insert
 * would make the primary key the only thing standing in the way, and `thread_id`
 * is one column: another business that knew an id could claim the row first, and
 * the owner would then be the one refused by the conflict clause below.
 *
 * The trailing two parameters belong to the conflict clause, not to the insert:
 * they are what stops a caller from another scope or another business updating a
 * row it can see the id of.
 */
const UPSERT_SQL = `
INSERT INTO memory_summary (thread_id, scope_id, business_id, text_enc, covers_through_seq, updated_at)
SELECT ?, ?, ?, ?, ?, ?
FROM thread
WHERE thread.id = ? AND thread.scope_id = ? AND thread.business_id = ?
ON CONFLICT (thread_id) DO UPDATE SET
  text_enc = excluded.text_enc,
  covers_through_seq = excluded.covers_through_seq,
  updated_at = excluded.updated_at
WHERE excluded.covers_through_seq >= memory_summary.covers_through_seq
  AND memory_summary.scope_id = ?
  AND memory_summary.business_id = ?
`

const SELECT_SQL = `
SELECT ${SUMMARY_COLUMNS}
FROM memory_summary
WHERE thread_id = ? AND scope_id = ? AND business_id = ?
`

const DELETE_SQL = `
DELETE FROM memory_summary
WHERE thread_id = ? AND scope_id = ? AND business_id = ?
`

/** A thread id as the schema allows it, or `invalid_request`. */
function requireThreadId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** The summary body, checked against the row schema's own bounds before the write. */
function requireSummaryText (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_TEXT) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * The sequence a summary is allowed to claim it has covered.
 *
 * A negative or fractional number would make the coverage comparison in the
 * upsert meaningless, so it is refused here rather than stored and compared.
 */
function requireCoverage (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * The `scope_id` a row is filed under, taken from a business scope.
 *
 * The business is not part of it: `scope_id` says whose file a row is in, and
 * `business_id` says which business inside that file. The two fields are named
 * explicitly because the scope schema is strict and refuses the extra
 * `businessId` key rather than ignoring it, so handing the business scope
 * straight to `scopeIdOf` would be refused before any statement ran.
 */
function scopeIdOfBusiness (scope: BusinessScope): string {
  return scopeIdOf({ serverHost: scope.serverHost, userId: scope.userId })
}

/**
 * One stored row as the contract's summary shape, text opened.
 *
 * The candidate object is built first and validated second, on purpose: building
 * it is where a column that will not open raises `bad_key`, and that answer must
 * reach the caller unchanged. Only a row the schema turns down becomes the fixed
 * internal token, because a schema error can quote the value it refused and this
 * value is a paraphrase of a private conversation.
 */
function toSummaryRow (ctx: RepositoryContext, row: SqlRow): SummaryRow {
  const covers = nullableInteger(row.covers_through_seq)
  if (covers === null) throw new StorageError('internal_error')

  const candidate = {
    threadId: requiredString(row.thread_id),
    text: ctx.cipher.open(TEXT_CONTEXT, requiredString(row.text_enc)),
    coversThroughSeq: covers,
    updatedAt: requiredString(row.updated_at),
  }

  try {
    return summaryRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

export function createSummaryRepository (ctx: RepositoryContext): SummaryRepository {
  const upsertStatement = ctx.db.prepare(UPSERT_SQL)
  const selectStatement = ctx.db.prepare(SELECT_SQL)
  const deleteStatement = ctx.db.prepare(DELETE_SQL)

  function readScoped (threadId: string, scopeId: string, businessId: string): SummaryRow | null {
    const row = selectStatement.get(threadId, scopeId, businessId)
    return row === undefined ? null : toSummaryRow(ctx, row)
  }

  function upsert (scope: BusinessScope, input: UpsertSummaryInput): SummaryRow {
    const valid = requireBusinessScope(scope)
    const threadId = requireThreadId(input?.threadId)
    const text = requireSummaryText(input?.text)
    const covers = requireCoverage(input?.coversThroughSeq)

    const scopeId = scopeIdOfBusiness(valid)
    const sealed = ctx.cipher.seal(TEXT_CONTEXT, text)

    try {
      upsertStatement.run(
        threadId,
        scopeId,
        valid.businessId,
        sealed,
        covers,
        ctx.now(),
        // The parent thread must be in this scope and this business, or nothing
        // is inserted.
        threadId,
        scopeId,
        valid.businessId,
        scopeId,
        valid.businessId,
      )

      /*
       * Reading back is what makes the answer true rather than optimistic. If the
       * conflict clause refused the update because the incoming summary covered
       * less, the stored row comes back unchanged, which is the summary this
       * scope should keep.
       *
       * Nothing coming back is the other case: no row was inserted, because this
       * thread is not one of this business's threads. `not_found` is the honest
       * answer - from here that thread does not exist - and it is the same answer
       * this repository gives for any id the caller does not own.
       */
      const row = readScoped(threadId, scopeId, valid.businessId)
      if (row === null) throw new StorageError('not_found')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function get (scope: BusinessScope, threadId: string): SummaryRow | null {
    const valid = requireBusinessScope(scope)
    const thread = requireThreadId(threadId)

    try {
      return readScoped(thread, scopeIdOfBusiness(valid), valid.businessId)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function remove (scope: BusinessScope, threadId: string): void {
    const valid = requireBusinessScope(scope)
    const thread = requireThreadId(threadId)

    try {
      deleteStatement.run(thread, scopeIdOfBusiness(valid), valid.businessId)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { upsert, get, remove }
}
