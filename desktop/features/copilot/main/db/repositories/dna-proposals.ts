/*
 * The proposed changes to Business DNA, and the decision each one waits on.
 *
 * Section 10.4 asks for approval one field at a time, and that is the reason this is
 * two tables rather than one. The proposal row says what was drafted, from which
 * document and against which version; every change row carries one field with its
 * own decision and the moment that decision was made. Approving `brand_voice` while
 * turning down `key_numbers` therefore has somewhere to live, and a half-decided
 * proposal stays a record of what has been settled so far instead of an edit in
 * flight. Nothing here writes to `dna` or `dna_field`: `approved` hands the caller
 * the wording to apply, and applying it is the caller's work.
 *
 * `previous_enc` is stored beside `proposed_enc` on purpose. A conflict means
 * nothing without the value it contradicts, and the pair has to stay comparable
 * after the field itself has moved on to whatever a later generation wrote.
 *
 * Every statement is scoped twice, by `scope_id` (the person and the server) and by
 * `business_id`, and both text columns are sealed under a context naming the table
 * and the column, so a value copied into the wrong column fails to open instead of
 * reading back as a plausible answer. Every row that leaves this file is parsed by
 * the contract's schema first, because a schema error quotes the value it refused
 * and that value is what a person said about their own business.
 */

import type { SqlRow, SqlValue } from '../driver.js'
import {
  dnaChangeKinds,
  dnaDecisions,
  dnaFieldKeys,
  dnaProposalChangeRowSchema,
  dnaProposalRowSchema,
  StorageError,
  type BusinessScope,
  type DnaChangeKind,
  type DnaDecision,
  type DnaFieldKey,
  type DnaProposalChangeRow,
  type DnaProposalRow,
} from '../../../shared/storage-contract.js'
import {
  columnContext,
  nullableInteger,
  nullableString,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'

export interface DnaProposalChangeInput {
  key: DnaFieldKey
  change: DnaChangeKind
  proposed: string
  previous?: string | null
}

export interface DnaProposalDetail {
  proposal: DnaProposalRow
  changes: DnaProposalChangeRow[]
}

export interface DnaProposalRepository {
  /** Create a pending proposal with one change per field. */
  create: (scope: BusinessScope, input: { documentId?: string | null; baseVersion: number; changes: DnaProposalChangeInput[] }) => DnaProposalDetail
  get: (scope: BusinessScope, proposalId: string) => DnaProposalDetail | null
  list: (scope: BusinessScope, options?: { status?: DnaDecision; limit?: number }) => DnaProposalRow[]
  /** Decide one field of a proposal. Only a pending change can be decided. */
  decide: (scope: BusinessScope, changeId: string, decision: Exclude<DnaDecision, 'pending'>) => DnaProposalChangeRow
  /** The changes approved and not yet applied, for the caller to write into DNA. */
  approved: (scope: BusinessScope, proposalId: string) => DnaProposalChangeRow[]
  /** Mark the proposal itself approved or rejected once its fields are decided. */
  settle: (scope: BusinessScope, proposalId: string) => DnaProposalRow
}

/** The columns a proposal row needs. */
const PROPOSAL_COLUMNS = 'id, document_id, status, base_version, created_at, updated_at'

/** The columns a change row needs. `proposed_enc` and `previous_enc` are opened. */
const CHANGE_COLUMNS =
  'id, proposal_id, key, change, proposed_enc, previous_enc, decision, decided_at'

const PROPOSED_CONTEXT = columnContext('dna_proposal_change', 'proposed_enc')
const PREVIOUS_CONTEXT = columnContext('dna_proposal_change', 'previous_enc')

/* The bounds the row schemas enforce, restated where a write can still be refused. */
const MAX_VALUE = 8_000
const MAX_ID = 64

/** The hard cap on one listing, for the same reason the memory list has one. */
const LIST_LIMIT = 200

/*
 * The proposal row, filed only if the business belongs to this account.
 *
 * A named document already proves ownership, because `documentInScope` matches the
 * document's scope and business as well as its id. A proposal drafted from a
 * conversation instead of a file names no document, and then nothing else in this
 * function would ask whose business it is: the foreign key only proves the id exists,
 * so a second account holding another person's business id could write here. Selecting
 * the row from `business` under both the id and the scope closes that for both cases.
 */
const INSERT_PROPOSAL_SQL = `
INSERT INTO dna_proposal
  (id, scope_id, business_id, document_id, status, base_version, created_at, updated_at)
SELECT ?, ?, business.id, ?, ?, ?, ?, ?
FROM business
WHERE business.id = ? AND business.scope_id = ?
`

const INSERT_CHANGE_SQL = `
INSERT INTO dna_proposal_change
  (id, scope_id, business_id, proposal_id, key, change, proposed_enc, previous_enc,
   decision, decided_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const PROPOSAL_BY_ID_SQL = `
SELECT ${PROPOSAL_COLUMNS}
FROM dna_proposal
WHERE id = ? AND scope_id = ? AND business_id = ?
`

const CHANGES_OF_PROPOSAL_SQL = `
SELECT ${CHANGE_COLUMNS}
FROM dna_proposal_change
WHERE proposal_id = ? AND scope_id = ? AND business_id = ?
ORDER BY key ASC, id ASC
`

const CHANGE_BY_ID_SQL = `
SELECT ${CHANGE_COLUMNS}
FROM dna_proposal_change
WHERE id = ? AND scope_id = ? AND business_id = ?
`

const APPROVED_CHANGES_SQL = `
SELECT ${CHANGE_COLUMNS}
FROM dna_proposal_change
WHERE proposal_id = ? AND scope_id = ? AND business_id = ? AND decision = 'approved'
ORDER BY key ASC, id ASC
`

const DECIDE_CHANGE_SQL = `
UPDATE dna_proposal_change
   SET decision = ?, decided_at = ?
 WHERE id = ? AND scope_id = ? AND business_id = ? AND decision = 'pending'
`

const SETTLE_PROPOSAL_SQL = `
UPDATE dna_proposal
   SET status = ?, updated_at = ?
 WHERE id = ? AND scope_id = ? AND business_id = ?
`

const DOCUMENT_IN_SCOPE_SQL = `
SELECT id FROM document
 WHERE id = ? AND scope_id = ? AND business_id = ?
`

/** One validated input, after the shape of the call has been settled. */
interface PlannedChange {
  key: DnaFieldKey
  change: DnaChangeKind
  proposed: string
  previous: string | null
}

/** A row id as given, or a refusal. A missing id is a bug, not an empty answer. */
function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * An optional row id: absent and null both mean "this proposal came from no file".
 *
 * A proposal drafted from a conversation instead of a document is a real case, so the
 * absence is allowed. An empty string is not: it looks like a name and would then be
 * stored as a document id nothing can ever match.
 */
function requireOptionalId (value: unknown): string | null {
  if (value === undefined || value === null) return null
  return requireId(value)
}

/**
 * The version the draft was made against.
 *
 * Refused when it is not a whole number at least zero, because the column is what the
 * staleness check reads later: a fractional or negative version would compare as
 * "different from current" forever and quietly mark every draft stale.
 */
function requireBaseVersion (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** A field key the contract knows, or `invalid_request`. */
function requireFieldKey (value: unknown): DnaFieldKey {
  if (typeof value !== 'string' || !(dnaFieldKeys as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as DnaFieldKey
}

/** How a proposed value differs, or `invalid_request`. */
function requireChangeKind (value: unknown): DnaChangeKind {
  if (typeof value !== 'string' || !(dnaChangeKinds as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as DnaChangeKind
}

/**
 * A field's wording as it can be stored.
 *
 * Trimmed first, because a model can return a trailing newline and a field ending in
 * one is a field the form shows with an empty last line. The length is then checked
 * against the bound the row schema enforces, so an oversized value is refused as the
 * caller's mistake rather than stored and then refused on the way back out.
 */
function requireValue (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_VALUE) throw new StorageError('invalid_request')
  return trimmed
}

/**
 * The value a change replaces, or `null` for "there was nothing there".
 *
 * An empty previous value and no previous value say the same thing, and the column
 * allows only one of them, so both land as NULL. That keeps the first-write case
 * (`added`) from looking like a change from an empty field.
 */
function requirePrevious (value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed.length > MAX_VALUE) throw new StorageError('invalid_request')
  return trimmed === '' ? null : trimmed
}

/**
 * The fields a proposal asks about, validated in one place before anything is written.
 *
 * A key given twice is refused rather than resolved to the last one. The table is
 * unique on (proposal, key), so the second value could not be stored as asked; and a
 * caller that produced two drafts for one field has a bug worth seeing rather than
 * having half of it silently dropped. An empty list is refused for the same reason: a
 * proposal with no fields asks nobody anything and could never be settled.
 */
function requireChanges (value: unknown): PlannedChange[] {
  if (!Array.isArray(value) || value.length === 0) throw new StorageError('invalid_request')
  const items: unknown[] = value
  const seen = new Set<string>()
  const planned: PlannedChange[] = []

  for (const item of items) {
    const input = (item ?? {}) as { key?: unknown; change?: unknown; proposed?: unknown; previous?: unknown }
    const key = requireFieldKey(input.key)
    if (seen.has(key)) throw new StorageError('invalid_request')
    seen.add(key)
    planned.push({
      key,
      change: requireChangeKind(input.change),
      proposed: requireValue(input.proposed),
      previous: requirePrevious(input.previous),
    })
  }

  return planned
}

/**
 * The decision a caller may record.
 *
 * `pending` is not a decision a person makes, so accepting it here would let a caller
 * undo an approval by writing the row back to where it started. Anything else is the
 * caller's mistake, and the UPDATE below only ever matches a pending row.
 */
function requireDecision (value: unknown): Exclude<DnaDecision, 'pending'> {
  if (value !== 'approved' && value !== 'rejected') throw new StorageError('invalid_request')
  return value
}

/** A status a caller may filter by, or `null` for "every status". */
function requireStatus (value: unknown): DnaDecision | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !(dnaDecisions as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as DnaDecision
}

/** How many rows one listing may return: the caller's cap, or the table's own. */
function requireLimit (value: unknown): number {
  if (value === undefined) return LIST_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new StorageError('invalid_request')
  }
  return Math.min(value, LIST_LIMIT)
}

/**
 * One stored proposal as the contract's shape.
 *
 * The candidate is built first and validated second. Building it is where a malformed
 * column becomes the fixed internal token; only a row the schema turns down reaches
 * the catch, and that row's content must not travel in the error.
 */
function toProposalRow (row: SqlRow): DnaProposalRow {
  const baseVersion = nullableInteger(row.base_version)
  if (baseVersion === null) throw new StorageError('internal_error')

  const candidate = {
    id: requiredString(row.id),
    documentId: nullableString(row.document_id),
    status: requiredString(row.status),
    baseVersion,
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  }

  try {
    return dnaProposalRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

/**
 * One stored change as the contract's shape, both values opened.
 *
 * A schema error can quote the value it refused, and here that value is what a person
 * said about their own business, so it is replaced with the internal token.
 */
function toChangeRow (ctx: RepositoryContext, row: SqlRow): DnaProposalChangeRow {
  const previousEnc = nullableString(row.previous_enc)
  const candidate = {
    id: requiredString(row.id),
    proposalId: requiredString(row.proposal_id),
    key: requiredString(row.key),
    change: requiredString(row.change),
    proposed: ctx.cipher.open(PROPOSED_CONTEXT, requiredString(row.proposed_enc)),
    previous: previousEnc === null ? null : ctx.cipher.open(PREVIOUS_CONTEXT, previousEnc),
    decision: requiredString(row.decision),
    decidedAt: nullableString(row.decided_at),
  }

  try {
    return dnaProposalChangeRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

export function createDnaProposalRepository (ctx: RepositoryContext): DnaProposalRepository {
  const insertProposal = ctx.db.prepare(INSERT_PROPOSAL_SQL)
  const insertChange = ctx.db.prepare(INSERT_CHANGE_SQL)
  const proposalById = ctx.db.prepare(PROPOSAL_BY_ID_SQL)
  const changesOfProposal = ctx.db.prepare(CHANGES_OF_PROPOSAL_SQL)
  const changeById = ctx.db.prepare(CHANGE_BY_ID_SQL)
  const approvedChanges = ctx.db.prepare(APPROVED_CHANGES_SQL)
  const decideChange = ctx.db.prepare(DECIDE_CHANGE_SQL)
  const settleProposal = ctx.db.prepare(SETTLE_PROPOSAL_SQL)
  const documentInScope = ctx.db.prepare(DOCUMENT_IN_SCOPE_SQL)

  /** The validated scope, as the two strings every statement binds. */
  function scoped (scope: BusinessScope): { scopeId: string; businessId: string } {
    const validated = requireBusinessScope(scope)
    return { scopeId: scopeIdOf(validated), businessId: validated.businessId }
  }

  /**
   * Run one unit of work, keeping a storage refusal and hiding everything else.
   *
   * A SQLite error message can quote the statement and a bound value, and a bound
   * value here is a sentence about someone's business. Anything that is not already a
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

  /**
   * The refusal rules of `guarded`, plus all-or-nothing.
   *
   * Used where several rows only make sense together. A proposal written without its
   * changes, or a change whose proposal was never written, would each leave a card a
   * person cannot act on and no later call can repair.
   */
  function inTransaction<T> (work: () => T): T {
    ctx.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      ctx.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        ctx.db.exec('ROLLBACK')
      } catch {
        // A rollback that fails leaves nothing written, which is the aim anyway.
      }
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  /** One proposal row inside this scope and business, or `null`. */
  function readProposal (scopeId: string, businessId: string, proposalId: string): DnaProposalRow | null {
    const row = proposalById.get(proposalId, scopeId, businessId)
    return row === undefined ? null : toProposalRow(row)
  }

  /** Every change of one proposal, in field-key order so a screen draws a stable list. */
  function readChanges (scopeId: string, businessId: string, proposalId: string): DnaProposalChangeRow[] {
    return changesOfProposal.all(proposalId, scopeId, businessId).map((row) => toChangeRow(ctx, row))
  }

  return {
    create (scope, input) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)

        /*
         * Everything is validated before the first row is written, so a bad key or an
         * empty value is the caller's refusal rather than a proposal that exists and
         * cannot be drawn. `status` is never taken from the caller: a proposal that
         * arrived already approved would be a decision nobody made.
         */
        const documentId = requireOptionalId(input?.documentId)
        const baseVersion = requireBaseVersion(input?.baseVersion)
        const planned = requireChanges(input?.changes)
        const at = ctx.now()
        const proposalId = ctx.newId()

        /*
         * The proposal, its document check and its changes land together or not at
         * all. A proposal row with no changes is a card a person cannot act on, and a
         * change row whose proposal was never written would be unreachable. The
         * document is checked inside the transaction so it cannot be removed between
         * the check and the row that names it.
         */
        return inTransaction(() => {
          if (documentId !== null) {
            if (documentInScope.get(documentId, scopeId, businessId) === undefined) {
              throw new StorageError('not_found')
            }
          }

          const inserted = insertProposal.run(
            proposalId, scopeId, documentId, 'pending', baseVersion, at, at,
            // The parent business: same id, same account, or nothing is written.
            businessId, scopeId,
          )
          if (Number(inserted.changes) !== 1) throw new StorageError('not_found')

          for (const change of planned) {
            insertChange.run(
              ctx.newId(),
              scopeId,
              businessId,
              proposalId,
              change.key,
              change.change,
              ctx.cipher.seal(PROPOSED_CONTEXT, change.proposed),
              change.previous === null ? null : ctx.cipher.seal(PREVIOUS_CONTEXT, change.previous),
              'pending',
              null,
            )
          }

          // Read back, so what is returned is the stored rows rather than the draft
          // this function believed it wrote. Rows just written and then not visible
          // mean a broken write, so that is an internal error and not `not_found`.
          const proposal = readProposal(scopeId, businessId, proposalId)
          if (proposal === null) throw new StorageError('internal_error')
          return { proposal, changes: readChanges(scopeId, businessId, proposalId) }
        })
      })
    },

    get (scope, proposalId) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(proposalId)

        const proposal = readProposal(scopeId, businessId, id)
        // A proposal in another business is not a proposal with no changes: it is not
        // here at all, and `null` is what the screen draws as "nothing to decide".
        if (proposal === null) return null
        return { proposal, changes: readChanges(scopeId, businessId, id) }
      })
    },

    list (scope, options) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)

        const status = requireStatus(options?.status)
        const limit = requireLimit(options?.limit)

        const params: SqlValue[] = [scopeId, businessId]
        let statusFilter = ''
        if (status !== null) {
          statusFilter = ' AND status = ?'
          params.push(status)
        }
        params.push(limit)

        const rows = ctx.db
          .prepare(
            `SELECT ${PROPOSAL_COLUMNS} FROM dna_proposal
              WHERE scope_id = ? AND business_id = ?${statusFilter}
              ORDER BY created_at DESC, id DESC
              LIMIT ?`,
          )
          .all(...params)
        return rows.map((row) => toProposalRow(row))
      })
    },

    /*
     * Record one field's decision.
     *
     * `AND decision = 'pending'` is the whole guard, and it is in the statement rather
     * than in a read before it. Two windows can show the same card, and the second
     * click must not replace the first person's answer: the row is the record of what
     * they decided, so a decided row stays decided. Nothing updated means the change is
     * not in this business or has already been settled, and both leave the caller with
     * "there is nothing of yours here to decide".
     */
    decide (scope, changeId, decision) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(changeId)
        const value = requireDecision(decision)

        const result = decideChange.run(value, ctx.now(), id, scopeId, businessId)
        if (Number(result.changes) !== 1) throw new StorageError('conflict')

        const row = changeById.get(id, scopeId, businessId)
        if (row === undefined) throw new StorageError('not_found')
        return toChangeRow(ctx, row)
      })
    },

    /*
     * The wording a person approved, for the caller to write into DNA.
     *
     * Only approved changes are returned, so applying this list cannot carry a field
     * nobody agreed to. Rejecting a change leaves it stored as the reason the field was
     * not written, which is why this reads by decision rather than by proposal status.
     */
    approved (scope, proposalId) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(proposalId)

        return approvedChanges.all(id, scopeId, businessId).map((row) => toChangeRow(ctx, row))
      })
    },

    /*
     * Close the proposal once its fields are decided.
     *
     * A single pending field is enough to refuse: settling is the end of the decisions,
     * not a shortcut past them, and a proposal closed early could never be completed.
     * The read and the write below need no transaction of their own, because a decided
     * change cannot become undecided again: the decisions can only accumulate, so the one
     * state that is safe to close on cannot change between the two statements.
     *
     * "Approved" is decided by the presence of one approved field, not by unanimity. A
     * proposal where a person kept one field and turned down the rest has produced
     * something to apply, and marking it rejected would throw that away.
     */
    settle (scope, proposalId) {
      return guarded(() => {
        const { scopeId, businessId } = scoped(scope)
        const id = requireId(proposalId)

        if (readProposal(scopeId, businessId, id) === null) throw new StorageError('not_found')

        const changes = readChanges(scopeId, businessId, id)
        if (changes.some((row) => row.decision === 'pending')) throw new StorageError('conflict')

        const status: Exclude<DnaDecision, 'pending'> =
          changes.every((row) => row.decision === 'rejected') ? 'rejected' : 'approved'

        const result = settleProposal.run(status, ctx.now(), id, scopeId, businessId)
        if (Number(result.changes) !== 1) throw new StorageError('conflict')

        const settled = readProposal(scopeId, businessId, id)
        if (settled === null) throw new StorageError('internal_error')
        return settled
      })
    },
  }
}
