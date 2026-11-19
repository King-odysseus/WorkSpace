/*
 * The proposals the assistant drafts for a person to approve or reject.
 *
 * A proposal is a record of something the assistant suggests, not something the
 * assistant did. Nothing in this file executes anything, and nothing outside it may
 * treat a row here as having happened: the row says what was drafted, what a person
 * decided, and when. The plan puts the acting on an approval in a later phase, and
 * keeping that gap explicit is the reason `setStatus` exists as its own method
 * rather than a completion step.
 *
 * Two choices worth knowing before reading the SQL.
 *
 * The draft is sealed twice over, `title_enc` and `payload_enc`, because a payload
 * is a task body or an email a person is about to send. Both are opened with a
 * context naming the table and the column, so a payload copied into a title fails
 * to open instead of returning a plausible wrong answer.
 *
 * `idempotency_key` is filled at creation from the same id generator, so a retried
 * creation can be recognised by the caller that caused it. It is stored in clear
 * text on purpose: it is an identifier, not content, and a retry check has to be
 * able to find it without the key that opens the database.
 *
 * Every statement is scoped twice, by `scope_id` (the person and the server) and by
 * `business_id`, and every row that leaves this file is parsed by
 * `proposalRowSchema` before it is returned.
 */

import type { SqlRow, SqlValue } from '../driver.js'
import {
  proposalRowSchema,
  proposalStatuses,
  StorageError,
  type BusinessScope,
  type ProposalKind,
  type ProposalRow,
  type ProposalStatus,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  nullableString,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'

export interface CreateProposalInput {
  kind: ProposalKind
  title: string
  payload: Record<string, unknown>
  threadId?: string | null
  expiresAt?: string | null
}

export interface ListProposalOptions {
  status?: ProposalStatus
}

export interface ProposalRepository {
  create (scope: BusinessScope, input: CreateProposalInput): ProposalRow
  get (scope: BusinessScope, proposalId: string): ProposalRow
  list (scope: BusinessScope, options?: ListProposalOptions): ProposalRow[]
  setStatus (scope: BusinessScope, proposalId: string, status: ProposalStatus): ProposalRow
  update (scope: BusinessScope, proposalId: string, draft: EditProposalInput): ProposalRow
}

/**
 * What a person may change about a draft that is still waiting on them.
 *
 * The same three fields the drafting pass is allowed to produce, and no others. An
 * assignee, a project or a task id is not accepted here for the reason it is not
 * accepted there: a draft that named a real record would be a draft a later phase
 * could execute by accident.
 */
export interface EditProposalInput {
  readonly title: string
  readonly notes?: string
  readonly dueHint?: string
}

const PROPOSAL_TABLE = 'proposal'

/** Every column a row needs. There is no tombstone on this table. */
const PROPOSAL_COLUMNS =
  'id, thread_id, kind, status, title_enc, payload_enc, idempotency_key, expires_at, created_at, updated_at'

/** The hard cap on one listing, for the same reason the memory list has one. */
const PROPOSAL_LIST_LIMIT = 200

/**
 * The scope string every row is filed under, from a business scope.
 *
 * `scopeIdOf` validates a `StorageScope` strictly, and a `BusinessScope` carries
 * one extra key, so the two fields it wants are handed over on their own. The
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

/** The card's heading, refused when it could not be drawn as one. */
function requireTitle (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  if (value.trim() === '') throw new StorageError('invalid_request')
  return value
}

export function createProposalRepository (ctx: RepositoryContext): ProposalRepository {
  // Sealed once, opened with the same two strings. The pair must not drift.
  const titleContext = columnContext(PROPOSAL_TABLE, 'title_enc')
  const payloadContext = columnContext(PROPOSAL_TABLE, 'payload_enc')

  /** The validated scope, as the two strings every statement binds. */
  function scoped (scope: BusinessScope): { scopeId: string; businessId: string } {
    const validated = requireBusinessScope(scope)
    return { scopeId: scopeIdFor(validated), businessId: validated.businessId }
  }

  /** One stored row, opened and validated. */
  function toRow (row: SqlRow): ProposalRow {
    /*
     * A payload that will not parse is a row this build cannot draw. Letting
     * `JSON.parse` throw here means the caller's `guarded` wrapper reports
     * `internal_error`, which is the honest answer: the bytes are ours and they
     * are wrong.
     */
    const payload: unknown = JSON.parse(
      ctx.cipher.open(payloadContext, requiredString(row.payload_enc)),
    )
    return proposalRowSchema.parse({
      id: requiredString(row.id),
      threadId: nullableString(row.thread_id),
      kind: requiredString(row.kind),
      status: requiredString(row.status),
      title: ctx.cipher.open(titleContext, requiredString(row.title_enc)),
      payload,
      idempotencyKey: requiredString(row.idempotency_key),
      expiresAt: nullableString(row.expires_at),
      createdAt: requiredString(row.created_at),
      updatedAt: requiredString(row.updated_at),
    })
  }

  /** One row by id, inside this scope and this business, or `not_found`. */
  function readOne (scope: BusinessScope, proposalId: string): ProposalRow {
    const { scopeId, businessId } = scoped(scope)
    const row = ctx.db
      .prepare(
        `SELECT ${PROPOSAL_COLUMNS} FROM proposal
          WHERE id = ? AND scope_id = ? AND business_id = ?`,
      )
      .get(proposalId, scopeId, businessId)
    if (row === undefined) throw new StorageError('not_found')
    return toRow(row)
  }

  /**
   * Run one unit of work, keeping a storage refusal and hiding everything else.
   *
   * A SQLite error message can quote the statement and a bound value, and a bound
   * value here is a draft someone wrote. Anything that is not already a
   * `StorageError` therefore becomes the fixed `internal_error` token.
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
    create (scope, input) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const at = ctx.now()

        /*
         * Validated before it is written, so an unknown kind or an empty title is
         * refused as a bad request rather than stored and then failing to open on
         * the next read. `status` is never taken from the caller: a proposal that
         * arrived already approved would be a decision nobody made.
         */
        const prospective = proposalRowSchema.safeParse({
          id: ctx.newId(),
          threadId: nullableString(input?.threadId),
          kind: input?.kind,
          status: 'pending',
          title: requireTitle(input?.title),
          payload: input?.payload,
          idempotencyKey: ctx.newId(),
          expiresAt: nullableString(input?.expiresAt),
          createdAt: at,
          updatedAt: at,
        })
        if (!prospective.success) throw new StorageError('invalid_request')
        const row = prospective.data

        /*
         * A proposal may name the thread it was drafted in. That thread has to be
         * one of this business's, and the conditional insert checks it inside the
         * write: a proposal card quoting another business's conversation would
         * show text this business cannot see.
         */
        const written = ctx.db
          .prepare(
            `INSERT INTO proposal
               (id, scope_id, business_id, thread_id, kind, status, title_enc,
                payload_enc, idempotency_key, expires_at, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE ? IS NULL
                OR EXISTS (
                  SELECT 1 FROM thread
                   WHERE id = ? AND scope_id = ? AND business_id = ?
                )`,
          )
          .run(
            row.id,
            scopeId,
            businessId,
            row.threadId,
            row.kind,
            row.status,
            ctx.cipher.seal(titleContext, row.title),
            ctx.cipher.seal(payloadContext, JSON.stringify(row.payload)),
            row.idempotencyKey,
            row.expiresAt,
            row.createdAt,
            row.updatedAt,
            row.threadId,
            row.threadId,
            scopeId,
            businessId,
          )

        // Nothing written means the thread named is not in this business.
        if (Number(written.changes) === 0) throw new StorageError('not_found')

        // Read back, so what is returned is the stored row rather than the draft
        // this function believed it wrote.
        return readOne(scope, row.id)
      })
    },

    get (scope, proposalId) {
      return guarded(() => readOne(scope, requireId(proposalId)))
    },

    list (scope, options) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const params: SqlValue[] = [scopeId, businessId]
        let statusFilter = ''

        const status = options?.status
        if (status !== undefined) {
          statusFilter = ' AND status = ?'
          params.push(status)
        }
        params.push(PROPOSAL_LIST_LIMIT)

        const rows = ctx.db
          .prepare(
            `SELECT ${PROPOSAL_COLUMNS} FROM proposal
              WHERE scope_id = ? AND business_id = ?${statusFilter}
              ORDER BY created_at DESC, id DESC
              LIMIT ?`,
          )
          .all(...params)
        return rows.map(toRow)
      })
    },

    /*
     * Record a decision.
     *
     * This is the whole of what approval means in this phase: the row now says a
     * person approved it or turned it down. Nothing is sent, nothing is created and
     * no task is closed, because a status column is a record and not an action. A
     * later phase reads `approved` and performs the work, which is why this method
     * only ever writes `status` and `updated_at` and leaves the draft alone.
     */
    setStatus (scope, proposalId, status) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(proposalId)
        // Checked here rather than left to the next read: a status this build does
        // not know would be stored and then make the row impossible to draw.
        if (!proposalStatuses.includes(status)) throw new StorageError('invalid_request')

        const result = ctx.db
          .prepare(
            `UPDATE proposal
                SET status = ?, updated_at = ?
              WHERE id = ? AND scope_id = ? AND business_id = ?`,
          )
          .run(status, ctx.now(), id, scopeId, businessId)

        // Nothing updated means the id was never this business's. That is "that
        // item is not here", not a decision that was recorded somewhere else.
        if (Number(result.changes) === 0) throw new StorageError('not_found')
        return readOne(scope, id)
      })
    },

    /*
     * Change a draft that has not been decided yet.
     *
     * Three things are deliberate here.
     *
     * 1. Only a pending row may be edited. Once a person has approved or turned a
     *    draft down, the row is the record of what they decided; letting the wording
     *    change afterwards would leave a decision attached to text nobody saw when
     *    they made it. The `status = 'pending'` in the WHERE clause is what enforces
     *    that, so a stale card in another window cannot rewrite a settled one.
     *
     * 2. The payload is rebuilt from the three named fields rather than merged from
     *    whatever the caller sent. A merge would be the one place a field could
     *    survive from an earlier write, and the card would then show something the
     *    edit never touched.
     *
     * 3. Ownership, status and the id are all in the same statement. Checking the row
     *    first and then writing it leaves a gap where another window could decide it
     *    in between, and the write would land on a row that had just been settled.
     */
    update (scope, proposalId, draft) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(proposalId)

        const title = draft.title.trim()
        // The row schema would refuse these on the way back out, and a row that
        // cannot be read is worse than a refusal that names the problem.
        if (title.length === 0 || title.length > 200) throw new StorageError('invalid_request')

        const payload: Record<string, unknown> = { title }
        const notes = draft.notes?.trim() ?? ''
        if (notes.length > 0) payload.notes = notes
        const dueHint = draft.dueHint?.trim() ?? ''
        if (dueHint.length > 0) payload.dueHint = dueHint

        const result = ctx.db
          .prepare(
            `UPDATE proposal
                SET title_enc = ?, payload_enc = ?, updated_at = ?
              WHERE id = ? AND scope_id = ? AND business_id = ? AND status = 'pending'`,
          )
          .run(
            ctx.cipher.seal(titleContext, title),
            ctx.cipher.seal(payloadContext, JSON.stringify(payload)),
            ctx.now(),
            id,
            scopeId,
            businessId,
          )

        /*
         * No row changed for one of two reasons, and neither is worth telling apart:
         * the draft is not in this business, or it has already been decided. Both
         * mean "there is nothing of yours here to edit", which is what the screen
         * needs to know so it can reload and draw the settled card instead.
         */
        if (Number(result.changes) === 0) throw new StorageError('not_found')
        return readOne(scope, id)
      })
    },
  }
}
