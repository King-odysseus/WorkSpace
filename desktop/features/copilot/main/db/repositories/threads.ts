/*
 * The threads table: the conversations inside one business.
 *
 * Four decisions carry this file.
 *
 * 1. A thread belongs to a business as well as a scope, and every statement names
 *    both. The foreign key in the schema proves only that the business id exists
 *    somewhere, not that it belongs to the person asking, so `create` confirms the
 *    business is in this scope before a row is filed under it. Without that check a
 *    caller holding a business id from another account could attach threads to a
 *    row it cannot read, which is nonsense the database would happily store.
 *
 * 2. The list is one query, and the message count comes from a correlated subquery
 *    rather than a second round trip per row. A list of twenty conversations is
 *    the common case, and twenty round trips per keystroke is the shape of bug
 *    that is only noticed once the database is on a slow disk.
 *
 * 3. Search happens in memory, after decryption, and must keep doing so. Titles are
 *    stored as ciphertext (`title_enc`), so `LIKE '%word%'` can only ever match the
 *    envelope: it would return nothing for every search, quietly, and the tempting
 *    "optimisation" of moving the filter into SQL is a broken feature rather than a
 *    faster one. An index on a column that holds ciphertext cannot help either,
 *    which is why the cap below is what keeps the decrypt bounded.
 *
 * 4. The list is capped at 200 rows in SQL, before the search filter runs. A person
 *    scrolls the newest conversations, so the cap is applied where it is cheap and
 *    the search sees that same window. Raising it means decrypting more titles on
 *    every keystroke, which is the cost this cap exists to bound.
 */

import type { SqlRow } from '../driver.js'
import {
  StorageError,
  threadRowSchema,
  type BusinessScope,
  type ThreadRow,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  fromFlag,
  nullableInteger,
  nullableString,
  requiredString,
  requireBusinessScope,
  scopeIdOf,
  toFlag,
  type RepositoryContext,
} from './context.js'

/** One thread as the caller creates it. A missing title gets the placeholder. */
export interface ThreadInput {
  title: string
  pinned?: boolean
}

/** How to narrow a list. Search is a substring of the title, ignoring case. */
export interface ThreadListOptions {
  search?: string
}

export interface ThreadRepository {
  create (scope: BusinessScope, input: ThreadInput): ThreadRow
  get (scope: BusinessScope, threadId: string): ThreadRow
  find (scope: BusinessScope, threadId: string): ThreadRow | null
  list (scope: BusinessScope, options?: ThreadListOptions): ThreadRow[]
  setPinned (scope: BusinessScope, threadId: string, pinned: boolean): ThreadRow
  rename (scope: BusinessScope, threadId: string, title: string): ThreadRow
  touch (scope: BusinessScope, threadId: string): void
  close (scope: BusinessScope, threadId: string): ThreadRow
  remove (scope: BusinessScope, threadId: string): void
}

/** The row schema's own bounds, restated where a bad write can be stopped early. */
const MAX_TITLE_LENGTH = 200
const MAX_ID_LENGTH = 64

/**
 * The most rows one list returns, newest first, before any search filter.
 *
 * A cap rather than paging: the sidebar shows recent conversations, and a page the
 * person never scrolls to is a page that costs decrypt work on every keystroke.
 */
const MAX_ROWS = 200

/**
 * What a thread is called before anything has been said in it.
 *
 * Titles are encrypted, so the database cannot default the column: a SQL DEFAULT
 * would put a plaintext empty string in a column that holds envelopes. The
 * placeholder is chosen here, sealed like any other title.
 */
const PLACEHOLDER_TITLE = 'New conversation'

/**
 * The columns and the count every read shares.
 *
 * `message_count` repeats the scope inside the subquery rather than relying on the
 * outer WHERE: `m.scope_id = t.scope_id` is what keeps a message row from another
 * account (or a row copied by hand) out of this thread's count.
 */
const SELECT_THREADS = [
  'SELECT t.id, t.title_enc, t.pinned, t.created_at, t.updated_at, t.closed_at,',
  '       (SELECT COUNT(*) FROM message m',
  '         WHERE m.thread_id = t.id AND m.scope_id = t.scope_id) AS message_count',
  '  FROM thread t',
  ' WHERE t.scope_id = ? AND t.business_id = ?',
].join('\n')

/**
 * Run one database step, turning anything unexpected into a fixed token.
 *
 * A driver error message can quote a bound parameter, and a bound parameter here
 * is a conversation title, so nothing it says may travel. `StorageError` is passed
 * through: the cipher's `bad_key` and this file's own `not_found` are answers.
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

/** The caller's new thread, validated and defaulted before a row is written. */
function requireInput (input: unknown): { title: string; pinned: boolean } {
  if (typeof input !== 'object' || input === null) throw new StorageError('invalid_request')
  const candidate = input as { title?: unknown; pinned?: unknown }

  if (typeof candidate.title !== 'string') throw new StorageError('invalid_request')
  const trimmed = candidate.title.trim()
  const title = trimmed === '' ? PLACEHOLDER_TITLE : trimmed
  if (title.length > MAX_TITLE_LENGTH) throw new StorageError('invalid_request')

  if (candidate.pinned !== undefined && typeof candidate.pinned !== 'boolean') {
    throw new StorageError('invalid_request')
  }

  return { title, pinned: candidate.pinned === true }
}

/**
 * The needle a search looks for, lower-cased, or null for "no filter".
 *
 * Whitespace alone is not a search: it would filter to the titles containing a
 * space, which is nearly all of them, and read on screen as a filter that did
 * nothing.
 */
function searchNeedle (options: ThreadListOptions | undefined): string | null {
  const raw: unknown = options
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object') throw new StorageError('invalid_request')

  const search = (raw as { search?: unknown }).search
  if (search === undefined) return null
  if (typeof search !== 'string') throw new StorageError('invalid_request')

  const needle = search.trim().toLowerCase()
  return needle === '' ? null : needle
}

/** One stored row as the rest of the app sees it, with the title opened. */
function toRow (ctx: RepositoryContext, row: SqlRow): ThreadRow {
  return threadRowSchema.parse({
    id: requiredString(row.id),
    title: ctx.cipher.open(columnContext('thread', 'title_enc'), requiredString(row.title_enc)),
    pinned: fromFlag(row.pinned),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
    closedAt: nullableString(row.closed_at),
    messageCount: nullableInteger(row.message_count) ?? 0,
  })
}

export function createThreadRepository (ctx: RepositoryContext): ThreadRepository {
  /** The row for this id in this scope and this business, or null. */
  function rowOrNull (scope: BusinessScope, scopeId: string, threadId: string): ThreadRow | null {
    return guard(() => {
      const row = ctx.db
        .prepare(`${SELECT_THREADS}\n   AND t.id = ?`)
        .get(scopeId, scope.businessId, threadId)
      return row === undefined ? null : toRow(ctx, row)
    })
  }

  /** The same read, made a refusal. A row in another scope is simply not here. */
  function getThread (scope: BusinessScope, scopeId: string, threadId: string): ThreadRow {
    const found = rowOrNull(scope, scopeId, threadId)
    if (found === null) throw new StorageError('not_found')
    return found
  }

  function create (scope: BusinessScope, input: ThreadInput): ThreadRow {
    const scoped = requireBusinessScope(scope)
    const wanted = requireInput(input)
    const scopeId = scopeIdOf(scoped)

    return guard(() => {
      /*
       * The foreign key proves the id exists, not that it belongs to this scope,
       * so the business is confirmed here. A missing business is `not_found`
       * rather than the constraint error SQLite would produce, because "that is
       * not one of yours" is the honest answer and the one the caller can act on.
       */
      const owner = ctx.db
        .prepare('SELECT id FROM business WHERE id = ? AND scope_id = ?')
        .get(scoped.businessId, scopeId)
      if (owner === undefined) throw new StorageError('not_found')

      const now = ctx.now()
      const id = ctx.newId()
      ctx.db
        .prepare(
          'INSERT INTO thread (id, scope_id, business_id, title_enc, pinned, created_at, updated_at, closed_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
        )
        .run(
          id,
          scopeId,
          scoped.businessId,
          ctx.cipher.seal(columnContext('thread', 'title_enc'), wanted.title),
          toFlag(wanted.pinned),
          now,
          now,
        )

      return getThread(scoped, scopeId, id)
    })
  }

  function get (scope: BusinessScope, threadId: string): ThreadRow {
    const scoped = requireBusinessScope(scope)
    return getThread(scoped, scopeIdOf(scoped), requireId(threadId))
  }

  function find (scope: BusinessScope, threadId: string): ThreadRow | null {
    const scoped = requireBusinessScope(scope)
    return rowOrNull(scoped, scopeIdOf(scoped), requireId(threadId))
  }

  function list (scope: BusinessScope, options?: ThreadListOptions): ThreadRow[] {
    const scoped = requireBusinessScope(scope)
    const scopeId = scopeIdOf(scoped)
    const needle = searchNeedle(options)

    return guard(() => {
      const rows = ctx.db
        .prepare(`${SELECT_THREADS}\n ORDER BY t.pinned DESC, t.updated_at DESC\n LIMIT ?`)
        .all(scopeId, scoped.businessId, MAX_ROWS)

      const listed = rows.map((row) => toRow(ctx, row))
      if (needle === null) return listed
      // In memory on purpose. See the header: a SQL `LIKE` would compare against
      // the envelope and silently match nothing.
      return listed.filter((thread) => thread.title.toLowerCase().includes(needle))
    })
  }

  function setPinned (scope: BusinessScope, threadId: string, pinned: boolean): ThreadRow {
    const scoped = requireBusinessScope(scope)
    if (typeof pinned !== 'boolean') throw new StorageError('invalid_request')
    const id = requireId(threadId)
    const scopeId = scopeIdOf(scoped)

    return guard(() => {
      // Pinning is a deliberate act by the person, so it also counts as recency:
      // within the pinned group the order follows their last choice rather than
      // the last time a reply arrived.
      const result = ctx.db
        .prepare(
          'UPDATE thread SET pinned = ?, updated_at = ? WHERE id = ? AND scope_id = ? AND business_id = ?',
        )
        .run(toFlag(pinned), ctx.now(), id, scopeId, scoped.businessId)

      if (Number(result.changes) === 0) throw new StorageError('not_found')
      return getThread(scoped, scopeId, id)
    })
  }

  /**
   * A new name for a conversation.
   *
   * Written here rather than by the caller because the title is a sealed column:
   * only a repository holding the cipher can produce one. A rename is not
   * activity, so `updated_at` is left alone - moving a renamed thread to the top
   * of the sidebar would reorder the list every time somebody fixed a typo.
   */
  function rename (scope: BusinessScope, threadId: string, title: string): ThreadRow {
    const scoped = requireBusinessScope(scope)
    const id = requireId(threadId)
    if (typeof title !== 'string') throw new StorageError('invalid_request')
    const trimmed = title.trim()
    if (trimmed === '' || trimmed.length > MAX_TITLE_LENGTH) throw new StorageError('invalid_request')
    const scopeId = scopeIdOf(scoped)

    return guard(() => {
      const result = ctx.db
        .prepare('UPDATE thread SET title_enc = ? WHERE id = ? AND scope_id = ? AND business_id = ?')
        .run(ctx.cipher.seal(columnContext('thread', 'title_enc'), trimmed), id, scopeId, scoped.businessId)

      // Nothing updated means the id is not in this business, which is the same
      // answer as reading it: not here.
      if (Number(result.changes) === 0) throw new StorageError('not_found')
      return getThread(scoped, scopeId, id)
    })
  }

  /*
   * A message was added, so the thread moves to the top of the list. Deliberately
   * silent when nothing matched: a reply that arrives for a thread the person just
   * deleted is ordinary, and turning it into a refusal would surface as an error
   * for something the person already chose.
   */
  function touch (scope: BusinessScope, threadId: string): void {
    const scoped = requireBusinessScope(scope)
    const id = requireId(threadId)
    const scopeId = scopeIdOf(scoped)

    guard(() => {
      ctx.db
        .prepare('UPDATE thread SET updated_at = ? WHERE id = ? AND scope_id = ? AND business_id = ?')
        .run(ctx.now(), id, scopeId, scoped.businessId)
    })
  }

  /*
   * Closing leaves `updated_at` alone on purpose: a finished conversation should
   * not jump above the one the person is still having just because it was closed.
   */
  function close (scope: BusinessScope, threadId: string): ThreadRow {
    const scoped = requireBusinessScope(scope)
    const id = requireId(threadId)
    const scopeId = scopeIdOf(scoped)

    return guard(() => {
      const result = ctx.db
        .prepare(
          'UPDATE thread SET closed_at = ? WHERE id = ? AND scope_id = ? AND business_id = ?',
        )
        .run(ctx.now(), id, scopeId, scoped.businessId)

      if (Number(result.changes) === 0) throw new StorageError('not_found')
      return getThread(scoped, scopeId, id)
    })
  }

  /*
   * A delete that already happened is the state the caller wanted, so a second
   * remove is not an error. Nothing can leak through the silence: the statement
   * names the scope and the business, so a foreign id deletes nothing.
   */
  function remove (scope: BusinessScope, threadId: string): void {
    const scoped = requireBusinessScope(scope)
    const id = requireId(threadId)
    const scopeId = scopeIdOf(scoped)

    guard(() => {
      ctx.db
        .prepare('DELETE FROM thread WHERE id = ? AND scope_id = ? AND business_id = ?')
        .run(id, scopeId, scoped.businessId)
    })
  }

  return Object.freeze({ create, get, find, list, setPinned, rename, touch, close, remove })
}
