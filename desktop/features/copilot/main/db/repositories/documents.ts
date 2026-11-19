/*
 * Documents, their encrypted copies, and the two operations that keep the rest of
 * the knowledge tables honest: replace and delete.
 *
 * Why the file itself is stored here. Section 10.1 has the app read files locally and
 * never upload them, and criterion 2 of this task says the copies stay encrypted. A
 * row that merely recorded a path would leave the original sitting in the clear in a
 * documents folder, and would break the moment the person moved or deleted it. So the
 * bytes are sealed into `document_blob` under the same key as everything else, and
 * `readBytes` is the only way back to them. Ingestion in the next step reads from
 * here, not from the filesystem.
 *
 * Why replace keeps the old row. A citation written before a replace names a
 * document id, and an answer shown last week must still resolve. So the old row is
 * marked `replaced_by` rather than deleted, while everything that carries its
 * content - chunks, their terms, their vectors, and the DNA evidence that quotes it -
 * is removed. The row that remains holds a name and a status and nothing readable
 * from the document's body, which is what `replaced_at` means in the plan's table.
 *
 * Why every statement repeats the scope and the business. Same rule as every other
 * repository here: isolation is structural. A statement without `business_id` in the
 * WHERE clause is a statement that works correctly until the first person has two
 * businesses.
 */

import type { SqlRow } from '../driver.js'
import {
  columnContext,
  nullableInteger,
  nullableString,
  requireBusinessScope,
  requiredString,
  scopeIdOf,
  type RepositoryContext,
} from './context.js'
import {
  documentFailures,
  documentKinds,
  documentSources,
  documentRowSchema,
  ingestionStatuses,
  StorageError,
  type BusinessScope,
  type DocumentFailure,
  type DocumentKind,
  type DocumentRow,
  type DocumentSource,
  type IngestionStatus,
} from '../../../shared/storage-contract.js'

export interface CreateDocumentInput {
  name: string
  kind: DocumentKind
  source: DocumentSource
  /** The file's bytes. Sealed here; the caller keeps no second copy. */
  bytes: Uint8Array
}

export interface ListDocumentsOptions {
  status?: IngestionStatus
  /** Leave out documents that were replaced. */
  currentOnly?: boolean
  limit?: number
}

export interface DocumentRepository {
  create: (scope: BusinessScope, input: CreateDocumentInput) => DocumentRow
  get: (scope: BusinessScope, documentId: string) => DocumentRow | null
  list: (scope: BusinessScope, options?: ListDocumentsOptions) => DocumentRow[]
  /** The sealed copy, opened. `null` when there is no such document here. */
  readBytes: (scope: BusinessScope, documentId: string) => Uint8Array | null
  /** An unchanged re-add of a file already in this business. */
  findByDigest: (scope: BusinessScope, contentDigest: string) => DocumentRow | null
  markReading: (scope: BusinessScope, documentId: string) => DocumentRow
  markReady: (scope: BusinessScope, documentId: string, pageCount: number) => DocumentRow
  markFailed: (scope: BusinessScope, documentId: string, failure: DocumentFailure) => DocumentRow
  /** Point `oldDocumentId` at its replacement and drop the old content. */
  replace: (scope: BusinessScope, oldDocumentId: string, newDocumentId: string) => DocumentRow
  remove: (scope: BusinessScope, documentId: string) => void
}

const COLUMNS = [
  'id',
  'name_enc',
  'kind',
  'source',
  'status',
  'content_digest',
  'byte_size',
  'page_count',
  'failure',
  'created_at',
  'updated_at',
  'ready_at',
  'replaced_by',
].join(', ')

const NAME_CONTEXT = columnContext('document', 'name_enc')
const BLOB_CONTEXT = columnContext('document_blob', 'data_enc')
const DIGEST_CONTEXT = 'document.content_digest'

/* The bounds the row schema enforces, restated where a write can still be refused. */
const MAX_NAME = 260
/** 200 MB. A bound, not a policy: it keeps a mistake from filling the disk. */
const MAX_BYTES = 200 * 1024 * 1024

function requireName (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_NAME) throw new StorageError('invalid_request')
  return trimmed
}

function oneOf<T extends string> (allowed: readonly T[], value: unknown): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as T
}

function requireBytes (value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_BYTES) {
    throw new StorageError('invalid_request')
  }
  return value
}

function requirePageCount (value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_request')
  }
  return value
}

function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** A stored row as the contract's shape, name opened. */
function toDocumentRow (ctx: RepositoryContext, row: SqlRow): DocumentRow {
  const candidate = {
    id: requiredString(row.id),
    name: ctx.cipher.open(NAME_CONTEXT, requiredString(row.name_enc)),
    kind: requiredString(row.kind),
    source: requiredString(row.source),
    status: requiredString(row.status),
    contentDigest: requiredString(row.content_digest),
    byteSize: Number(row.byte_size),
    pageCount: nullableInteger(row.page_count),
    failure: nullableString(row.failure),
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
    readyAt: nullableString(row.ready_at),
    replacedBy: nullableString(row.replaced_by),
  }

  try {
    return documentRowSchema.parse(candidate)
  } catch {
    // A schema error can quote the value it refused, and that value is a file name.
    throw new StorageError('internal_error')
  }
}

export function createDocumentRepository (ctx: RepositoryContext): DocumentRepository {
  /*
   * The row is selected from `business` rather than written from `VALUES`.
   *
   * The foreign key on `business_id` proves a business with that id exists somewhere in
   * this file, not that it belongs to the account asking. A business scope is only
   * shape-checked before it reaches here, so without this condition a second account
   * that knew another person's business id could file a document under it and then read
   * it back as its own. Selecting from `business` under both the id and the scope makes
   * the write impossible rather than unlikely, and the row count below turns that into
   * the same `not_found` any unknown id receives.
   */
  const insertDocument = ctx.db.prepare(`
    INSERT INTO document
      (id, scope_id, business_id, name_enc, kind, source, status, content_digest,
       byte_size, page_count, failure, created_at, updated_at, ready_at, replaced_by)
    SELECT ?, ?, business.id, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL
    FROM business
    WHERE business.id = ? AND business.scope_id = ?
  `)

  const insertBlob = ctx.db.prepare(`
    INSERT INTO document_blob (document_id, scope_id, business_id, data_enc, byte_size, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const selectOne = ctx.db.prepare(`
    SELECT ${COLUMNS} FROM document
    WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  const selectBlob = ctx.db.prepare(`
    SELECT data_enc FROM document_blob
    WHERE document_id = ? AND scope_id = ? AND business_id = ?
  `)

  const selectByDigest = ctx.db.prepare(`
    SELECT ${COLUMNS} FROM document
    WHERE content_digest = ? AND scope_id = ? AND business_id = ? AND replaced_by IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `)

  const updateStatus = ctx.db.prepare(`
    UPDATE document
    SET status = ?, failure = ?, updated_at = ?
    WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  const updateReady = ctx.db.prepare(`
    UPDATE document
    SET status = 'ready', failure = NULL, page_count = ?, ready_at = ?, updated_at = ?
    WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  const updateReplaced = ctx.db.prepare(`
    UPDATE document
    SET replaced_by = ?, updated_at = ?
    WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  const deleteDocument = ctx.db.prepare(`
    DELETE FROM document WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  /*
   * The four content tables, cleared for one document.
   *
   * Written out rather than left to `ON DELETE CASCADE` for the reason the migration
   * states: a cascade only helps if the delete that triggered it was already scoped,
   * and here the delete that has to happen is "this document's content", not "this
   * document's row". Order is children first so a foreign key can never object.
   */
  const clearTerms = ctx.db.prepare(
    'DELETE FROM chunk_term WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  const clearVectors = ctx.db.prepare(
    'DELETE FROM chunk_vector WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  const clearChunks = ctx.db.prepare(
    'DELETE FROM chunk WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  const clearEvidence = ctx.db.prepare(
    'DELETE FROM dna_evidence WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )

  function readOne (scopeId: string, businessId: string, documentId: string): DocumentRow | null {
    const row = selectOne.get(documentId, scopeId, businessId)
    return row === undefined ? null : toDocumentRow(ctx, row)
  }

  function requireOne (scopeId: string, businessId: string, documentId: string): DocumentRow {
    const row = readOne(scopeId, businessId, documentId)
    // The same answer this layer gives for any id the caller cannot see: from here,
    // a document in another business does not exist.
    if (row === null) throw new StorageError('not_found')
    return row
  }

  function create (scope: BusinessScope, input: CreateDocumentInput): DocumentRow {
    const valid = requireBusinessScope(scope)
    const name = requireName(input?.name)
    const kind = oneOf(documentKinds, input?.kind)
    const source = oneOf(documentSources, input?.source)
    const bytes = requireBytes(input?.bytes)

    const scopeId = scopeIdOf(valid)
    const id = ctx.newId()
    const now = ctx.now()
    const sealedName = ctx.cipher.seal(NAME_CONTEXT, name)
    const sealedBytes = ctx.cipher.sealBytes(BLOB_CONTEXT, bytes)
    const digest = ctx.cipher.keyedDigest(DIGEST_CONTEXT, bytes)

    /*
     * The row and its copy land together or not at all. A document row with no blob
     * is a file the screen lists and ingestion then cannot read, which reads as a
     * corrupt document rather than a failed upload.
     */
    ctx.db.exec('BEGIN IMMEDIATE')
    try {
      const inserted = insertDocument.run(
        id, scopeId, sealedName, kind, source, 'uploaded', digest,
        bytes.length, now, now,
        // The parent business: same id, same account, or nothing is written.
        valid.businessId, scopeId,
      )
      // No business means this id is not this account's. The refusal also stops the
      // blob below, so a refused upload leaves neither the row nor the file behind.
      if (Number(inserted.changes) !== 1) throw new StorageError('not_found')
      insertBlob.run(id, scopeId, valid.businessId, sealedBytes, bytes.length, now)
      ctx.db.exec('COMMIT')
    } catch (error) {
      try {
        ctx.db.exec('ROLLBACK')
      } catch {
        // A rollback that fails leaves nothing written, which is the aim anyway.
      }
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }

    return requireOne(scopeId, valid.businessId, id)
  }

  function get (scope: BusinessScope, documentId: string): DocumentRow | null {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    try {
      return readOne(scopeIdOf(valid), valid.businessId, id)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function list (scope: BusinessScope, options: ListDocumentsOptions = {}): DocumentRow[] {
    const valid = requireBusinessScope(scope)
    const status = options.status === undefined ? null : oneOf(ingestionStatuses, options.status)
    const limit = options.limit === undefined ? 200 : options.limit
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new StorageError('invalid_request')
    }

    const clauses = ['scope_id = ?', 'business_id = ?']
    const params: Array<string | number> = [scopeIdOf(valid), valid.businessId]
    if (status !== null) {
      clauses.push('status = ?')
      params.push(status)
    }
    if (options.currentOnly === true) clauses.push('replaced_by IS NULL')
    params.push(limit)

    try {
      const rows = ctx.db
        .prepare(`SELECT ${COLUMNS} FROM document WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
        .all(...params)
      return rows.map((row) => toDocumentRow(ctx, row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function readBytes (scope: BusinessScope, documentId: string): Uint8Array | null {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    try {
      const row = selectBlob.get(id, scopeIdOf(valid), valid.businessId)
      if (row === undefined) return null
      return ctx.cipher.openBytes(BLOB_CONTEXT, row.data_enc as Uint8Array)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function findByDigest (scope: BusinessScope, contentDigest: string): DocumentRow | null {
    const valid = requireBusinessScope(scope)
    if (typeof contentDigest !== 'string' || contentDigest === '') {
      throw new StorageError('invalid_request')
    }
    try {
      const row = selectByDigest.get(contentDigest, scopeIdOf(valid), valid.businessId)
      return row === undefined ? null : toDocumentRow(ctx, row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function markReading (scope: BusinessScope, documentId: string): DocumentRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    const scopeId = scopeIdOf(valid)
    try {
      requireOne(scopeId, valid.businessId, id)
      updateStatus.run('reading', null, ctx.now(), id, scopeId, valid.businessId)
      return requireOne(scopeId, valid.businessId, id)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function markReady (scope: BusinessScope, documentId: string, pageCount: number): DocumentRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    const pages = requirePageCount(pageCount)
    const scopeId = scopeIdOf(valid)
    try {
      requireOne(scopeId, valid.businessId, id)
      const now = ctx.now()
      updateReady.run(pages, now, now, id, scopeId, valid.businessId)
      return requireOne(scopeId, valid.businessId, id)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function markFailed (scope: BusinessScope, documentId: string, failure: DocumentFailure): DocumentRow {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    const reason = oneOf(documentFailures, failure)
    const scopeId = scopeIdOf(valid)
    try {
      requireOne(scopeId, valid.businessId, id)
      updateStatus.run('failed', reason, ctx.now(), id, scopeId, valid.businessId)
      return requireOne(scopeId, valid.businessId, id)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function replace (scope: BusinessScope, oldDocumentId: string, newDocumentId: string): DocumentRow {
    const valid = requireBusinessScope(scope)
    const oldId = requireId(oldDocumentId)
    const newId = requireId(newDocumentId)
    const scopeId = scopeIdOf(valid)

    if (oldId === newId) throw new StorageError('invalid_request')

    ctx.db.exec('BEGIN IMMEDIATE')
    try {
      requireOne(scopeId, valid.businessId, oldId)
      // The replacement has to be this business's too, or a caller could point one
      // business's document at another's and then read its content through it.
      requireOne(scopeId, valid.businessId, newId)

      clearTerms.run(oldId, scopeId, valid.businessId)
      clearVectors.run(oldId, scopeId, valid.businessId)
      clearChunks.run(oldId, scopeId, valid.businessId)
      // Evidence that quoted the old text would now cite words that are no longer in
      // the library, so it goes with them.
      clearEvidence.run(oldId, scopeId, valid.businessId)
      updateReplaced.run(newId, ctx.now(), oldId, scopeId, valid.businessId)
      ctx.db.exec('COMMIT')
    } catch (error) {
      try {
        ctx.db.exec('ROLLBACK')
      } catch {
        // Nothing was committed, which is the state we want.
      }
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }

    return requireOne(scopeId, valid.businessId, oldId)
  }

  function remove (scope: BusinessScope, documentId: string): void {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    const scopeId = scopeIdOf(valid)

    ctx.db.exec('BEGIN IMMEDIATE')
    try {
      requireOne(scopeId, valid.businessId, id)
      clearTerms.run(id, scopeId, valid.businessId)
      clearVectors.run(id, scopeId, valid.businessId)
      clearChunks.run(id, scopeId, valid.businessId)
      clearEvidence.run(id, scopeId, valid.businessId)
      // The blob goes with the row by cascade; deleted last so the content above is
      // already gone if this fails halfway.
      deleteDocument.run(id, scopeId, valid.businessId)
      ctx.db.exec('COMMIT')
    } catch (error) {
      try {
        ctx.db.exec('ROLLBACK')
      } catch {
        // Nothing was committed.
      }
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { create, get, list, readBytes, findByDigest, markReading, markReady, markFailed, replace, remove }
}
