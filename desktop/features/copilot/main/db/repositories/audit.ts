/*
 * The audit trail: one row per thing the assistant did locally.
 *
 * The rule this table exists to keep, and the one a future caller will be
 * tempted to break while debugging, is that an entry records what happened and
 * never what was read. `detail` is for a short, non-sensitive note about the
 * event: a failure token such as `network`, a channel name, a count of models.
 * It is not a place for a prompt, a reply, a provider response body or a pasted
 * task. A trail that quoted a conversation would be a second copy of that
 * conversation in a table nobody opens with encryption in mind, and the first
 * copy is the one this design went to trouble to protect. So: describe the
 * event, not the data it moved.
 *
 * The detail is still sealed with the column cipher even though it is meant to
 * be harmless. "Meant to be" is a promise this file cannot check, and a caller
 * who gets it wrong then leaves one badly chosen string in one sealed column
 * instead of one plaintext copy in a file. The scope is applied structurally for
 * the same reason: `scope_id` comes from the caller's scope and every statement
 * filters on it, so an entry written by one person is not readable by another on
 * the same machine.
 *
 * The two length caps are refusals rather than truncations. A shortened action
 * names a different event, and a shortened detail loses the token that made it
 * worth writing down, so a caller that overshoots is told so while it can still
 * fix the call. The caps mirror `auditRowSchema`: this file refuses before the
 * write with `invalid_request`, the schema refuses after it with a Zod error.
 */

import type { SqlRow } from '../driver.js'
import {
  auditOutcomes,
  auditRowSchema,
  StorageError,
  type StorageAuditOutcome,
  type AuditRow,
  type StorageScope,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  nullableString,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'

/** The table this repository owns. Named once so the SQL below cannot drift. */
const TABLE = 'audit_entry'

/*
 * The cipher context for the one sealed column, built rather than written out.
 * A detail sealed under one context must not open under another, so the name is
 * produced the same way the reader produces it.
 */
const DETAIL_CONTEXT = columnContext(TABLE, 'detail_enc')

/** The bounds `auditRowSchema` states, so a call is refused before the write. */
const MAX_ACTION = 80
const MAX_DETAIL = 500
const MAX_BUSINESS_ID = 64

/** A person opening this screen wants the recent past, not the whole history. */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** One event to write down. `businessId` is absent for anything not business-bound. */
export interface RecordAuditInput {
  action: string
  outcome: StorageAuditOutcome
  detail?: string
  businessId?: string | null
}

/**
 * How much of the trail to read.
 *
 * `limit` is clamped rather than refused: a screen asking for too much is asking
 * for a bigger page, not making an invalid request, and the cap is what stops a
 * caller from reading the whole table through one call.
 */
export interface ListAuditOptions {
  limit?: number
}

export interface AuditRepository {
  record (scope: StorageScope, input: RecordAuditInput): AuditRow
  list (scope: StorageScope, options?: ListAuditOptions): AuditRow[]
}

/* ------------------------------------------------------------------ *
 * Reading one call's input
 * ------------------------------------------------------------------ */

/** The validated pieces of a record request, before anything is written. */
interface AuditFields {
  action: string
  outcome: StorageAuditOutcome
  detail: string
  businessId: string | null
}

/**
 * A checked input, or `invalid_request`.
 *
 * `input` is typed as one of this module's own shapes, but it also arrives from
 * JavaScript callers and from the main process's own code, so nothing here is
 * assumed to be true because the type says so.
 */
function readInput (input: unknown): AuditFields {
  if (input === null || typeof input !== 'object') throw new StorageError('invalid_request')
  const candidate = input as Record<string, unknown>

  return {
    action: readAction(candidate.action),
    outcome: readOutcome(candidate.outcome),
    detail: readDetail(candidate.detail),
    businessId: readBusinessId(candidate.businessId),
  }
}

function readAction (value: unknown): string {
  // A blank action is a row nobody can act on, and a long one is a row that
  // names an event other than the one that happened.
  if (typeof value !== 'string' || value.trim() === '') throw new StorageError('invalid_request')
  if (value.length > MAX_ACTION) throw new StorageError('invalid_request')
  return value
}

function readOutcome (value: unknown): StorageAuditOutcome {
  const found = auditOutcomes.find(outcome => outcome === value)
  if (found === undefined) throw new StorageError('invalid_request')
  return found
}

function readDetail (value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  if (value.length > MAX_DETAIL) throw new StorageError('invalid_request')
  return value
}

function readBusinessId (value: unknown): string | null {
  if (value === undefined || value === null) return null
  // An empty id is neither "no business" nor a business, so it is refused rather
  // than quietly turned into null and misreported as a person-wide event.
  if (typeof value !== 'string' || value.trim() === '') throw new StorageError('invalid_request')
  if (value.length > MAX_BUSINESS_ID) throw new StorageError('invalid_request')
  return value
}

/** A page size inside the allowed range. A missing or unusable one is the default. */
function clampLimit (value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  const whole = Math.trunc(value)
  if (whole < 1) return 1
  if (whole > MAX_LIMIT) return MAX_LIMIT
  return whole
}

/* ------------------------------------------------------------------ *
 * Reading one stored row
 * ------------------------------------------------------------------ */

/** One row as the contract describes it, with the detail opened. */
function toRow (ctx: RepositoryContext, row: SqlRow): AuditRow {
  // A stored outcome that is not one of the three is a row this build cannot
  // draw, which is an internal fault rather than a bad caller request.
  const outcome = auditOutcomes.find(value => value === row.outcome)
  if (outcome === undefined) throw new StorageError('internal_error')

  return auditRowSchema.parse({
    id: requiredString(row.id),
    businessId: nullableString(row.business_id),
    action: requiredString(row.action),
    outcome,
    detail: ctx.cipher.open(DETAIL_CONTEXT, requiredString(row.detail_enc)),
    createdAt: requiredString(row.created_at),
  })
}

/* ------------------------------------------------------------------ *
 * The repository
 * ------------------------------------------------------------------ */

export function createAuditRepository (ctx: RepositoryContext): AuditRepository {
  /**
   * Write one event down.
   *
   * The caller supplies the event, this file supplies the id and the instant, so
   * two callers cannot disagree about when something happened or share a row id.
   */
  function record (scope: StorageScope, input: RecordAuditInput): AuditRow {
    const scopeId = scopeIdOf(scope)
    const fields = readInput(input)

    try {
      // Built and validated as a row before the write, so what is returned is
      // exactly what a later read will produce rather than a parallel guess.
      const row: AuditRow = auditRowSchema.parse({
        id: ctx.newId(),
        businessId: fields.businessId,
        action: fields.action,
        outcome: fields.outcome,
        detail: fields.detail,
        createdAt: ctx.now(),
      })

      ctx.db
        .prepare(
          `INSERT INTO ${TABLE} (id, scope_id, business_id, action, outcome, detail_enc, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          row.id,
          scopeId,
          row.businessId,
          row.action,
          row.outcome,
          ctx.cipher.seal(DETAIL_CONTEXT, row.detail),
          row.createdAt,
        )

      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      // The driver's message can quote a bound value, and a bound value here is
      // a person's row. The token is the only thing safe to carry out.
      throw new StorageError('internal_error')
    }
  }

  /**
   * The recent trail for one scope, newest first.
   *
   * `rowid` breaks a tie on `created_at`: two events in the same millisecond are
   * ordered by the order they were written, which is the only thing that makes
   * "newest first" true for a burst of rows rather than merely plausible.
   */
  function list (scope: StorageScope, options: ListAuditOptions = {}): AuditRow[] {
    const scopeId = scopeIdOf(scope)
    const limit = clampLimit(options?.limit)

    try {
      const rows = ctx.db
        .prepare(
          `SELECT id, business_id, action, outcome, detail_enc, created_at
             FROM ${TABLE}
            WHERE scope_id = ?
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?`,
        )
        .all(scopeId, limit)

      return rows.map(row => toRow(ctx, row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { record, list }
}
