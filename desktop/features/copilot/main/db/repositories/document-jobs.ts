/*
 * The ingestion job for a document: what is running, how far it got, and why it
 * stopped.
 *
 * Why a job cannot be created for a document this business does not have. The row is
 * selected *from `document`* rather than inserted from a list of values. A plain
 * insert would leave the foreign key as the only check, and that check is happy with
 * any document id that exists anywhere in the file - including one belonging to
 * another business on the same account. Sending the insert through a select that also
 * names the scope and the business means a job can only be created for a document
 * this caller could open, and the row count then turns "no such document" into the
 * same `not_found` answer every other id the caller does not own receives.
 *
 * Why progress cannot go backwards. A worker reports progress as it reads, extracts,
 * chunks and indexes, and two reports can arrive out of order: a slow call about page
 * four answering after a fast one about page nine. Writing them in arrival order
 * would rewind the bar a person is watching and make a job that is nearly finished
 * look as though it started over. The update therefore only lands when the arriving
 * number is at least the stored one, and equal is accepted because a later stage
 * reporting the same percentage is genuine progress.
 *
 * Why every write reads back. SQLite does not say which of several conditions in a
 * WHERE clause stopped an update, and the caller needs to know whether the job is
 * missing or the number it sent was stale. The read also turns a refused write into
 * the row this business should keep, so nobody is told a change happened that did
 * not. Nothing in this table is sealed - it is a queue, not content - so the read
 * needs no cipher and the mapper takes the row alone.
 */

import type { SqlRow } from '../driver.js'
import {
  requireBusinessScope,
  requiredString,
  nullableString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'
import {
  StorageError,
  documentFailures,
  documentJobRowSchema,
  jobStages,
  type BusinessScope,
  type DocumentFailure,
  type DocumentJobRow,
  type JobStage,
} from '../../../shared/storage-contract.js'

export interface DocumentJobRepository {
  /** Create a queued job for a document. Refuses a document in another business. */
  create: (scope: BusinessScope, documentId: string) => DocumentJobRow
  get: (scope: BusinessScope, jobId: string) => DocumentJobRow | null
  /** The newest job for one document, or null. */
  latestFor: (scope: BusinessScope, documentId: string) => DocumentJobRow | null
  /** Jobs that are queued or running, oldest first. What a restart must resume. */
  listPending: (scope: BusinessScope, limit?: number) => DocumentJobRow[]
  /** Move to running and count the attempt. */
  start: (scope: BusinessScope, jobId: string) => DocumentJobRow
  /** Record progress. Progress must never go backwards; refuse a lower value. */
  progress: (scope: BusinessScope, jobId: string, input: { stage: JobStage; progress: number }) => DocumentJobRow
  complete: (scope: BusinessScope, jobId: string) => DocumentJobRow
  fail: (scope: BusinessScope, jobId: string, failure: DocumentFailure) => DocumentJobRow
}

/** The columns the contract's row shape reads, so the mapper cannot drift. */
const JOB_COLUMNS = `
  id, document_id, status, stage, progress, attempts, failure,
  created_at, updated_at, started_at, finished_at
`

/*
 * The insert takes its parent from `document`, so the document id, the scope and the
 * business are bound twice: once as the row's own values, then as the condition the
 * select has to match.
 */
const CREATE_SQL = `
INSERT INTO document_job (
  id, scope_id, business_id, document_id, status, stage, progress, attempts,
  failure, created_at, updated_at, started_at, finished_at
)
SELECT ?, ?, ?, ?, 'queued', 'waiting', 0, 0, NULL, ?, ?, NULL, NULL
FROM document
WHERE document.id = ? AND document.scope_id = ? AND document.business_id = ?
`

const SELECT_SQL = `
SELECT ${JOB_COLUMNS}
FROM document_job
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/*
 * `created_at` is a millisecond timestamp, so two jobs for one document can share it.
 * `rowid` is the insertion order and is what settles that tie, so "newest" means the
 * last one written rather than whichever the query planner happened to return.
 */
const LATEST_SQL = `
SELECT ${JOB_COLUMNS}
FROM document_job
WHERE document_id = ? AND scope_id = ? AND business_id = ?
ORDER BY created_at DESC, rowid DESC
LIMIT 1
`

const PENDING_SQL = `
SELECT ${JOB_COLUMNS}
FROM document_job
WHERE scope_id = ? AND business_id = ? AND status IN ('queued', 'running')
ORDER BY created_at ASC, rowid ASC
LIMIT ?
`

/*
 * `COALESCE` is what makes the start time the first one: a job that is started again
 * after an interruption keeps the moment it first ran, so the elapsed time a screen
 * shows does not reset while the attempt count climbs.
 */
const START_SQL = `
UPDATE document_job
SET status = 'running',
    stage = 'reading',
    attempts = attempts + 1,
    started_at = COALESCE(started_at, ?),
    updated_at = ?
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/*
 * The trailing condition is the whole guard: the update is skipped when the stored
 * progress is already past the number being reported. The stage moves with it, so a
 * stale report cannot push the label ahead of a bar that refused to move.
 */
const PROGRESS_SQL = `
UPDATE document_job
SET stage = ?, progress = ?, updated_at = ?
WHERE id = ? AND scope_id = ? AND business_id = ? AND progress <= ?
`

/*
 * `failure` is cleared: a job that failed an earlier attempt and finished on a retry
 * would otherwise report "done" while still carrying the token for what went wrong,
 * and a screen would draw both at once.
 */
const COMPLETE_SQL = `
UPDATE document_job
SET status = 'done',
    stage = 'done',
    progress = 100,
    failure = NULL,
    finished_at = ?,
    updated_at = ?
WHERE id = ? AND scope_id = ? AND business_id = ?
`

const FAIL_SQL = `
UPDATE document_job
SET status = 'failed',
    stage = 'failed',
    failure = ?,
    finished_at = ?,
    updated_at = ?
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/* How many pending jobs one read returns, and the ceiling a caller can ask for. */
const DEFAULT_PENDING_LIMIT = 200
const MAX_LIMIT = 500

/** An id as the row schema allows it, or `invalid_request`. */
function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** A stage the contract names, or `invalid_request`. */
function requireStage (value: unknown): JobStage {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const stage = jobStages.find((candidate) => candidate === value)
  if (stage === undefined) throw new StorageError('invalid_request')
  return stage
}

/** A failure token the contract names, or `invalid_request`. */
function requireFailure (value: unknown): DocumentFailure {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const failure = documentFailures.find((candidate) => candidate === value)
  if (failure === undefined) throw new StorageError('invalid_request')
  return failure
}

/**
 * A whole percent, 0 to 100.
 *
 * A fractional or out-of-range number would not fail on the way in - the column is
 * an INTEGER, so the engine keeps whatever it is handed - it would fail later as a
 * bar drawn past its end. So it is refused here, where the caller can be told.
 */
function requireProgress (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** How many pending jobs to read: bounded, because this list is drawn, not exported. */
function requireLimit (value: unknown): number {
  if (value === undefined) return DEFAULT_PENDING_LIMIT
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * One stored row as the contract's job shape.
 *
 * The candidate object is built first and validated second, on purpose: `requiredString`
 * is what turns a column that is not text into the fixed internal token, and the
 * schema check afterwards is the only thing standing between a hand-edited row and a
 * screen that trusts its values. Counts are converted because SQLite returns integers
 * as numbers or bigints depending on the driver path, and the shape wants numbers.
 */
function toDocumentJobRow (row: SqlRow): DocumentJobRow {
  const candidate: unknown = {
    id: requiredString(row.id),
    documentId: requiredString(row.document_id),
    status: requiredString(row.status),
    stage: requiredString(row.stage),
    progress: Number(row.progress),
    attempts: Number(row.attempts),
    failure: nullableString(row.failure),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
  }

  try {
    return documentJobRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

export function createDocumentJobRepository (ctx: RepositoryContext): DocumentJobRepository {
  const createStatement = ctx.db.prepare(CREATE_SQL)
  const selectStatement = ctx.db.prepare(SELECT_SQL)
  const latestStatement = ctx.db.prepare(LATEST_SQL)
  const pendingStatement = ctx.db.prepare(PENDING_SQL)
  const startStatement = ctx.db.prepare(START_SQL)
  const progressStatement = ctx.db.prepare(PROGRESS_SQL)
  const completeStatement = ctx.db.prepare(COMPLETE_SQL)
  const failStatement = ctx.db.prepare(FAIL_SQL)

  function readScoped (jobId: string, scopeId: string, businessId: string): DocumentJobRow | null {
    const row = selectStatement.get(jobId, scopeId, businessId)
    return row === undefined ? null : toDocumentJobRow(row)
  }

  function create (scope: BusinessScope, documentId: string): DocumentJobRow {
    const valid = requireBusinessScope(scope)
    const document = requireId(documentId)
    const jobId = requireId(ctx.newId())
    const scopeId = scopeIdOf(valid)
    const at = ctx.now()

    try {
      const result = createStatement.run(
        jobId,
        scopeId,
        valid.businessId,
        document,
        at,
        at,
        // The parent document must be in this scope and this business, or nothing
        // is inserted.
        document,
        scopeId,
        valid.businessId,
      )

      if (Number(result.changes) !== 1) throw new StorageError('not_found')

      const row = readScoped(jobId, scopeId, valid.businessId)
      if (row === null) throw new StorageError('internal_error')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function get (scope: BusinessScope, jobId: string): DocumentJobRow | null {
    const valid = requireBusinessScope(scope)
    const id = requireId(jobId)

    try {
      return readScoped(id, scopeIdOf(valid), valid.businessId)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function latestFor (scope: BusinessScope, documentId: string): DocumentJobRow | null {
    const valid = requireBusinessScope(scope)
    const document = requireId(documentId)

    try {
      const row = latestStatement.get(document, scopeIdOf(valid), valid.businessId)
      return row === undefined ? null : toDocumentJobRow(row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function listPending (scope: BusinessScope, limit?: number): DocumentJobRow[] {
    const valid = requireBusinessScope(scope)
    const size = requireLimit(limit)

    try {
      return pendingStatement
        .all(scopeIdOf(valid), valid.businessId, size)
        .map((row) => toDocumentJobRow(row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function start (scope: BusinessScope, jobId: string): DocumentJobRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(jobId)
    const scopeId = scopeIdOf(valid)
    const at = ctx.now()

    try {
      startStatement.run(at, at, id, scopeId, valid.businessId)

      const row = readScoped(id, scopeId, valid.businessId)
      if (row === null) throw new StorageError('not_found')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function progress (
    scope: BusinessScope,
    jobId: string,
    input: { stage: JobStage; progress: number },
  ): DocumentJobRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(jobId)
    const stage = requireStage(input?.stage)
    const value = requireProgress(input?.progress)
    const scopeId = scopeIdOf(valid)
    const at = ctx.now()

    try {
      progressStatement.run(stage, value, at, id, scopeId, valid.businessId, value)

      const row = readScoped(id, scopeId, valid.businessId)

      /*
       * Nothing back means this is not a job of this business. A row that comes back
       * below the number just sent is the rewind the statement refused: the stored
       * value is the truth and the caller's report was stale, almost certainly an
       * earlier attempt answering late. Either way the caller is told, and the row
       * that is kept is the one the business already had.
       */
      if (row === null) throw new StorageError('not_found')
      if (row.progress !== value) throw new StorageError('invalid_request')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function complete (scope: BusinessScope, jobId: string): DocumentJobRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(jobId)
    const scopeId = scopeIdOf(valid)
    const at = ctx.now()

    try {
      completeStatement.run(at, at, id, scopeId, valid.businessId)

      const row = readScoped(id, scopeId, valid.businessId)
      if (row === null) throw new StorageError('not_found')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function fail (scope: BusinessScope, jobId: string, failure: DocumentFailure): DocumentJobRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(jobId)
    const reason = requireFailure(failure)
    const scopeId = scopeIdOf(valid)
    const at = ctx.now()

    try {
      failStatement.run(reason, at, at, id, scopeId, valid.businessId)

      const row = readScoped(id, scopeId, valid.businessId)
      if (row === null) throw new StorageError('not_found')
      return row
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { create, get, latestFor, listPending, start, progress, complete, fail }
}
