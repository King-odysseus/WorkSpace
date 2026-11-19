/*
 * The message table: one thread's turn history, written and read under a scope.
 *
 * Why the next sequence number is computed inside the INSERT. A single turn
 * produces at least two appends (what the person typed, then what the model
 * said) and they arrive as separate calls. Reading `MAX(seq)` and then inserting
 * in a second statement leaves a window where both calls read the same maximum
 * and then collide on `UNIQUE (thread_id, seq)`, and the loser fails with a
 * constraint error that has nothing to do with anything the person did. Written
 * as one `INSERT ... SELECT`, SQLite resolves the number while it already holds
 * the write lock, so the second call cannot be overtaken and always sees the
 * first.
 *
 * Why every statement is scoped by both ids. A thread id is not permission to
 * read a thread: ids cross the IPC boundary and end up in log lines, and a
 * second person signing in on this machine shares this one file. `scope_id` and
 * `business_id` in every WHERE clause are the isolation, and
 * `requireBusinessScope` is what turns a missing field into a refusal instead of
 * a query that quietly matches nothing.
 *
 * Why the body is sealed here and nowhere else. `content_enc` is the
 * conversation itself, so it is opened with the cipher context of the exact
 * column it came from. A row copied from another table, or a column read under
 * the wrong name, then fails loudly instead of returning a plausible sentence
 * from somewhere else.
 */

import type { SqlRow } from '../driver.js'
import {
  columnContext,
  fromFlag,
  nullableInteger,
  nullableString,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  toFlag,
  type RepositoryContext,
} from './context.js'
import {
  messageRoles,
  messageRowSchema,
  StorageError,
  type BusinessScope,
  type MessageRole,
  type MessageRow,
} from '../../../shared/storage-contract.js'

export interface AppendMessageInput {
  threadId: string
  role: MessageRole
  content: string
  provider?: string | null
  model?: string | null
  cloud?: boolean | null
}

export interface ListMessageOptions {
  afterSeq?: number
  limit?: number
}

export interface MessageRepository {
  append (scope: BusinessScope, input: AppendMessageInput): MessageRow
  list (scope: BusinessScope, threadId: string, options?: ListMessageOptions): MessageRow[]
  lastSeq (scope: BusinessScope, threadId: string): number
  countForThread (scope: BusinessScope, threadId: string): number
}

/** Every read returns these columns, in one place so the mapper cannot drift. */
const MESSAGE_COLUMNS =
  'id, thread_id, seq, role, content_enc, provider, model, cloud, created_at'

/** The context for the one column that holds a person's words. */
const CONTENT_CONTEXT = columnContext('message', 'content_enc')

/* The bounds the row schema enforces, restated where a write can still be refused. */
const MAX_CONTENT = 200_000
const MAX_PROVIDER = 60
const MAX_MODEL = 200

/* A page is a page: never empty, never more than a screen can scroll usefully. */
const DEFAULT_LIMIT = 200
const MIN_LIMIT = 1
const MAX_LIMIT = 500

/**
 * The next sequence number and the parent's ownership, resolved by the one
 * statement that inserts the row.
 *
 * Two jobs, and doing both here rather than in separate statements is what makes
 * each of them true.
 *
 * The number: an aggregate over an empty range still returns one row, so this
 * SELECT always inserts exactly one message and the first message of a thread is
 * number one. Reading `MAX(seq)` and then inserting in a second statement leaves a
 * window where two appends read the same maximum and collide on
 * `UNIQUE (thread_id, seq)`; resolved inside the insert, SQLite already holds the
 * write lock, so the second call always sees the first.
 *
 * The ownership: the INSERT selects *from `thread`*, not from `message`. A thread
 * id is a value that crosses IPC and comes back from an earlier listing, so naming
 * one is not permission to write into it. Because the row only appears when that
 * thread exists in this scope and this business, a thread id belonging to somebody
 * else inserts nothing at all - and there is no read-then-write window in which the
 * answer could change between the check and the write.
 */
const INSERT_SQL = `
INSERT INTO message (
  id, scope_id, business_id, thread_id, seq, role, content_enc, provider, model, cloud, created_at
)
SELECT ?, ?, ?, ?, COALESCE((
  SELECT MAX(seq) FROM message WHERE scope_id = ? AND business_id = ? AND thread_id = ?
), 0) + 1, ?, ?, ?, ?, ?, ?
FROM thread
WHERE thread.id = ? AND thread.scope_id = ? AND thread.business_id = ?
`

const SELECT_BY_ID_SQL = `
SELECT ${MESSAGE_COLUMNS}
FROM message
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/**
 * The reading order of a conversation: sequence, ascending, always.
 *
 * `seq > ?` rather than `>= ?` is what makes "everything after what I already
 * showed" a single number: a caller that has drawn up to message three asks for
 * 3 and is given four onwards, with no duplicate of three.
 */
const SELECT_RANGE_SQL = `
SELECT ${MESSAGE_COLUMNS}
FROM message
WHERE scope_id = ? AND business_id = ? AND thread_id = ? AND seq > ?
ORDER BY seq ASC
LIMIT ?
`

const SELECT_LAST_SEQ_SQL = `
SELECT COALESCE(MAX(seq), 0) AS last_seq
FROM message
WHERE scope_id = ? AND business_id = ? AND thread_id = ?
`

const SELECT_COUNT_SQL = `
SELECT COUNT(*) AS total
FROM message
WHERE scope_id = ? AND business_id = ? AND thread_id = ?
`

/** A thread id as the schema allows it, or `invalid_request`. */
function requireThreadId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** An optional attribution string, bounded by the column the row schema allows. */
function optionalAttribution (value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || value.length > max) throw new StorageError('invalid_request')
  return value
}

/**
 * The stored 0/1 cloud flag, or null.
 *
 * Null is not "unknown": it is how a person's own message is stored, because no
 * model produced it. Reading it as false would label a typed message as a local
 * reply, and the attribution chip on screen would then say something untrue.
 */
function cloudFromColumn (value: unknown): boolean | null {
  if (value === null || value === undefined) return null
  return fromFlag(value)
}

function cloudToColumn (value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') throw new StorageError('invalid_request')
  return toFlag(value)
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
 * A page size inside the range this table is meant to be read in.
 *
 * A caller passing 0 or a negative number means "as few as possible", not "the
 * whole thread", and a caller passing a million is asking for more than any
 * screen draws. Both are answered with the nearest usable page size rather than
 * an error, because neither is a wrong thing to want.
 */
function clampLimit (value: unknown): number {
  const parsed = nullableInteger(value)
  if (parsed === null) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(parsed)))
}

/**
 * One stored row as the contract's message shape, body opened.
 *
 * The candidate object is built first and validated second, on purpose: building
 * it is where a column that will not open raises `bad_key`, and that answer must
 * reach the caller unchanged. Only a row the schema turns down becomes the fixed
 * internal token, because a schema error can quote the value it refused and this
 * value is a sentence somebody typed.
 */
function toMessageRow (ctx: RepositoryContext, row: SqlRow): MessageRow {
  const seq = nullableInteger(row.seq)
  if (seq === null) throw new StorageError('internal_error')

  const candidate = {
    id: requiredString(row.id),
    threadId: requiredString(row.thread_id),
    seq,
    role: requiredString(row.role),
    content: ctx.cipher.open(CONTENT_CONTEXT, requiredString(row.content_enc)),
    provider: nullableString(row.provider),
    model: nullableString(row.model),
    cloud: cloudFromColumn(row.cloud),
    createdAt: requiredString(row.created_at),
  }

  try {
    return messageRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

export function createMessageRepository (ctx: RepositoryContext): MessageRepository {
  const insertStatement = ctx.db.prepare(INSERT_SQL)
  const selectByIdStatement = ctx.db.prepare(SELECT_BY_ID_SQL)
  const selectRangeStatement = ctx.db.prepare(SELECT_RANGE_SQL)
  const selectLastSeqStatement = ctx.db.prepare(SELECT_LAST_SEQ_SQL)
  const selectCountStatement = ctx.db.prepare(SELECT_COUNT_SQL)

  function append (scope: BusinessScope, input: AppendMessageInput): MessageRow {
    const valid = requireBusinessScope(scope)
    const threadId = requireThreadId(input?.threadId)
    /*
     * The input is checked against the shape the row must have before anything is
     * written. Checking only after the read-back would be too late: by then the
     * row is in the file, and the next reader finds a message it cannot accept
     * and has to call a corrupt database instead of a bad caller.
     */
    const content = input?.content
    if (typeof content !== 'string' || content.length > MAX_CONTENT) {
      throw new StorageError('invalid_request')
    }
    if (!messageRoles.includes(input.role)) throw new StorageError('invalid_request')
    const provider = optionalAttribution(input.provider, MAX_PROVIDER)
    const model = optionalAttribution(input.model, MAX_MODEL)
    const cloud = cloudToColumn(input.cloud)

    const id = ctx.newId()
    const scopeId = scopeIdOfBusiness(valid)
    const sealed = ctx.cipher.seal(CONTENT_CONTEXT, content)

    try {
      const written = insertStatement.run(
        id,
        scopeId,
        valid.businessId,
        threadId,
        // The number is resolved over this scope, this business and this thread.
        scopeId,
        valid.businessId,
        threadId,
        input.role,
        sealed,
        provider,
        model,
        cloud,
        ctx.now(),
        // The parent thread must be in this scope and this business, or the
        // statement inserts nothing.
        threadId,
        scopeId,
        valid.businessId,
      )

      /*
       * Zero rows written means the thread named by the caller is not in this
       * business. Saying so as `not_found` is the same answer this file gives for
       * any other id the caller does not own, and it is honest: from this business
       * that thread does not exist.
       */
      if (Number(written.changes) === 0) throw new StorageError('not_found')

      const row = selectByIdStatement.get(id, scopeId, valid.businessId)
      // A write that just landed and cannot be read back is a contract breach,
      // never an ordinary answer a screen could draw.
      if (row === undefined) throw new StorageError('internal_error')
      return toMessageRow(ctx, row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      /*
       * Anything else here is a driver failure, and its message can quote a bound
       * value - which is a sentence somebody typed - so it becomes the fixed token.
       * A foreign thread id never reaches this branch: it is refused above, before
       * the insert can insert nothing and look like a success.
       */
      throw new StorageError('internal_error')
    }
  }

  function list (
    scope: BusinessScope,
    threadId: string,
    options: ListMessageOptions = {},
  ): MessageRow[] {
    const valid = requireBusinessScope(scope)
    const thread = requireThreadId(threadId)
    // Zero is the same answer as "no cursor": a message is never numbered below
    // one, so `seq > 0` is the whole thread.
    const after = Math.max(0, nullableInteger(options?.afterSeq) ?? 0)
    const limit = clampLimit(options?.limit)

    try {
      const rows = selectRangeStatement.all(scopeIdOfBusiness(valid), valid.businessId, thread, after, limit)
      return rows.map((row) => toMessageRow(ctx, row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function lastSeq (scope: BusinessScope, threadId: string): number {
    const valid = requireBusinessScope(scope)
    const thread = requireThreadId(threadId)

    try {
      const row = selectLastSeqStatement.get(scopeIdOfBusiness(valid), valid.businessId, thread)
      // A thread with nothing in it has no high-water mark, which is zero.
      return nullableInteger(row?.last_seq) ?? 0
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function countForThread (scope: BusinessScope, threadId: string): number {
    const valid = requireBusinessScope(scope)
    const thread = requireThreadId(threadId)

    try {
      const row = selectCountStatement.get(scopeIdOfBusiness(valid), valid.businessId, thread)
      return nullableInteger(row?.total) ?? 0
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { append, list, lastSeq, countForThread }
}
