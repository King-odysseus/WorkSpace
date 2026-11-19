/*
 * Chunks, and the two indexes that make them findable without storing them twice.
 *
 * Why the keyword index is digests rather than SQLite's full-text search. FTS5 stores
 * every indexed word in the clear. For a conversation that would be bad; for a
 * business's document library it would be the entire library, sitting unencrypted in
 * the database file and in the journal, which is precisely what section 7.2 forbids
 * and what criterion 2 of this task is about. So `chunk_term` holds one row per
 * distinct word per chunk, and the word is replaced by a keyed digest: searching
 * digests the query the same way and looks for equal digests. What leaks is that two
 * chunks share a word and roughly how often; what does not leak is any word.
 *
 * Why the vector is a sealed BLOB rather than a `sqlite-vec` row. A float array is a
 * reversible encoding of meaning: anyone with the numbers can say which of two
 * documents is more like "pricing". So the vector is sealed with the same key as the
 * text it encodes. The extension is still loaded at open time and its status
 * recorded, so an index over non-personal data could use it later.
 *
 * Why the terms are computed here rather than accepted from the caller. The index has
 * to match the text exactly, or a replaced chunk leaves digests behind that point at
 * words no longer in the document. Deriving them from the text in the same call that
 * writes the text makes the two impossible to disagree.
 *
 * Why changing the embedding model marks rather than deletes. Vectors from two models
 * are not comparable - cosine similarity between them is noise - so mixing them would
 * silently return confident nonsense. Marking them `stale` keeps the text and its
 * keyword index working while a rebuild runs.
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
  chunkRowSchema,
  embedStates,
  StorageError,
  type BusinessScope,
  type ChunkRow,
  type EmbedState,
} from '../../../shared/storage-contract.js'

export interface ChunkInput {
  text: string
  page?: number | null
  section?: string | null
  tokens: number
}

export interface ReplaceChunksResult {
  inserted: number
  /** Distinct digests written to the keyword index, for the phase report. */
  terms: number
}

export interface ScoredChunk {
  chunkId: string
  documentId: string
  /** How many of the searched words this chunk contains, weighted by occurrences. */
  score: number
}

export interface ChunkRepository {
  /** Replace every chunk of one document. Used by every ingestion run. */
  replaceForDocument: (scope: BusinessScope, documentId: string, chunks: ChunkInput[]) => ReplaceChunksResult
  list: (scope: BusinessScope, documentId: string) => ChunkRow[]
  get: (scope: BusinessScope, chunkId: string) => ChunkRow | null
  /** Total tokens across a document's chunks, which section 10.3's decision needs. */
  tokensForDocument: (scope: BusinessScope, documentId: string) => number
  countForDocument: (scope: BusinessScope, documentId: string) => number
  putVector: (scope: BusinessScope, chunkId: string, model: string, vector: number[]) => void
  getVector: (scope: BusinessScope, chunkId: string) => { model: string; vector: number[] } | null
  /** Mark every vector of a document as being from an old model. */
  markVectorsStale: (scope: BusinessScope, documentId: string, currentModel: string) => number
  /** Keyword search over the digest index. Words, not digests: hashing happens here. */
  searchTerms: (scope: BusinessScope, words: string[], limit?: number) => ScoredChunk[]
}

const COLUMNS = 'id, document_id, ordinal, text_enc, page, section_enc, tokens, embed_model, embed_state, created_at'
const TEXT_CONTEXT = columnContext('chunk', 'text_enc')
const SECTION_CONTEXT = columnContext('chunk', 'section_enc')
const VECTOR_CONTEXT = columnContext('chunk_vector', 'vec_enc')
const TERM_CONTEXT = 'chunk.term'

/**
 * The words this build treats as searchable.
 *
 * Three characters minimum: below that the index fills with "a", "of" and "it", which
 * match everything and rank nothing. Unicode-aware rather than ASCII so a name with an
 * accent indexes as one word instead of splitting into pieces.
 */
const WORD_PATTERN = /[\p{L}\p{N}]{3,}/gu
/** A ceiling on distinct words per chunk, so one pathological file cannot explode the index. */
const MAX_TERMS_PER_CHUNK = 4_000
const MAX_CHUNKS_PER_DOCUMENT = 20_000
const MAX_TEXT = 40_000
const MAX_SECTION = 300

function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > 64) {
    throw new StorageError('invalid_request')
  }
  return value
}

function requireText (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_TEXT) throw new StorageError('invalid_request')
  return trimmed
}

function requireCount (value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw new StorageError('invalid_request')
  }
  return value
}

function requireSection (value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (trimmed.length > MAX_SECTION) throw new StorageError('invalid_request')
  return trimmed
}

/** Every distinct searchable word in a piece of text, with how often it appears. */
export function searchableTerms (text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of text.toLowerCase().matchAll(WORD_PATTERN)) {
    const word = match[0]
    const seen = counts.get(word) ?? 0
    if (seen === 0 && counts.size >= MAX_TERMS_PER_CHUNK) continue
    counts.set(word, seen + 1)
  }
  return counts
}

function toChunkRow (ctx: RepositoryContext, row: SqlRow): ChunkRow {
  const section = nullableString(row.section_enc)
  const candidate = {
    id: requiredString(row.id),
    documentId: requiredString(row.document_id),
    ordinal: Number(row.ordinal),
    text: ctx.cipher.open(TEXT_CONTEXT, requiredString(row.text_enc)),
    page: nullableInteger(row.page),
    section: section === null ? null : ctx.cipher.open(SECTION_CONTEXT, section),
    tokens: Number(row.tokens),
    embedModel: nullableString(row.embed_model),
    embedState: requiredString(row.embed_state),
    createdAt: requiredString(row.created_at),
  }

  try {
    return chunkRowSchema.parse(candidate)
  } catch {
    // A schema error can quote the text it refused, and that text is document content.
    throw new StorageError('internal_error')
  }
}

export function createChunkRepository (ctx: RepositoryContext): ChunkRepository {
  /*
   * The chunk is inserted by selecting from `document`, so a chunk can only exist for
   * a document in this scope and this business. A plain VALUES insert would make the
   * unique (document_id, ordinal) the only thing in the way, and another business
   * that knew a document id could write content into it.
   */
  const insertChunk = ctx.db.prepare(`
    INSERT INTO chunk
      (id, scope_id, business_id, document_id, ordinal, text_enc, page, section_enc,
       tokens, embed_model, embed_state, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', ?
    FROM document
    WHERE document.id = ? AND document.scope_id = ? AND document.business_id = ?
      AND document.replaced_by IS NULL
  `)

  const insertTerm = ctx.db.prepare(`
    INSERT INTO chunk_term (chunk_id, scope_id, business_id, document_id, term, occurrences)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  const insertVector = ctx.db.prepare(`
    INSERT INTO chunk_vector (chunk_id, scope_id, business_id, document_id, model, dims, vec_enc, created_at)
    SELECT ?, ?, ?, document_id, ?, ?, ?, ?
    FROM chunk
    WHERE chunk.id = ? AND chunk.scope_id = ? AND chunk.business_id = ?
    ON CONFLICT (chunk_id) DO UPDATE SET
      model = excluded.model,
      dims = excluded.dims,
      vec_enc = excluded.vec_enc,
      created_at = excluded.created_at
    WHERE chunk_vector.scope_id = excluded.scope_id
      AND chunk_vector.business_id = excluded.business_id
  `)

  const selectOne = ctx.db.prepare(`
    SELECT ${COLUMNS} FROM chunk
    WHERE id = ? AND scope_id = ? AND business_id = ?
  `)

  const selectVector = ctx.db.prepare(`
    SELECT model, dims, vec_enc FROM chunk_vector
    WHERE chunk_id = ? AND scope_id = ? AND business_id = ?
  `)

  const clearTerms = ctx.db.prepare(
    'DELETE FROM chunk_term WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  const clearVectors = ctx.db.prepare(
    'DELETE FROM chunk_vector WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  const clearChunks = ctx.db.prepare(
    'DELETE FROM chunk WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )
  /*
   * Evidence that quotes this document's passages.
   *
   * `dna_evidence.chunk_id` carries no foreign key - the migration leaves it off so a
   * citation can survive a rebuild of the chunk it names - so deleting a chunk does not
   * take its quote with it. Without this statement a replaced document keeps citations
   * that point at passages which no longer exist: on screen that is an answer citing a
   * page it cannot show, and on disk it is the old wording kept in a quote under a
   * chunk the document no longer contains.
   *
   * Cleared first, before the chunks, so the children of the rows being deleted are
   * already gone if a later migration adds the foreign key. Scoped like every other
   * statement here: another business's evidence names its own document and is untouched.
   */
  const clearEvidence = ctx.db.prepare(
    'DELETE FROM dna_evidence WHERE document_id = ? AND scope_id = ? AND business_id = ?',
  )

  const tokensFor = ctx.db.prepare(`
    SELECT COALESCE(SUM(tokens), 0) AS total FROM chunk
    WHERE document_id = ? AND scope_id = ? AND business_id = ?
  `)

  const countFor = ctx.db.prepare(`
    SELECT COUNT(*) AS n FROM chunk
    WHERE document_id = ? AND scope_id = ? AND business_id = ?
  `)

  function list (scope: BusinessScope, documentId: string): ChunkRow[] {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    try {
      const rows = ctx.db
        .prepare(`SELECT ${COLUMNS} FROM chunk
                  WHERE document_id = ? AND scope_id = ? AND business_id = ?
                  ORDER BY ordinal ASC`)
        .all(id, scopeIdOf(valid), valid.businessId)
      return rows.map((row) => toChunkRow(ctx, row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function replaceForDocument (
    scope: BusinessScope,
    documentId: string,
    chunks: ChunkInput[],
  ): ReplaceChunksResult {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    if (!Array.isArray(chunks)) throw new StorageError('invalid_request')
    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) throw new StorageError('invalid_request')

    const scopeId = scopeIdOf(valid)
    const now = ctx.now()

    ctx.db.exec('BEGIN IMMEDIATE')
    try {
      // Clear first: an ingestion rerun must not collide with the ordinals it is about
      // to write, and a replaced document must not keep a stale index alive.
      clearTerms.run(id, scopeId, valid.businessId)
      clearVectors.run(id, scopeId, valid.businessId)
      // The quotes that cited the passages being replaced go with them.
      clearEvidence.run(id, scopeId, valid.businessId)
      clearChunks.run(id, scopeId, valid.businessId)

      let inserted = 0
      let termsWritten = 0

      for (const [index, chunk] of chunks.entries()) {
        const ordinal = requireCount(index, MAX_CHUNKS_PER_DOCUMENT - 1)
        const text = requireText(chunk?.text)
        const tokens = requireCount(chunk?.tokens, MAX_TEXT)
        const section = requireSection(chunk?.section)
        const page = chunk?.page === null || chunk?.page === undefined
          ? null
          : requireCount(chunk.page, 1_000_000)

        const chunkId = ctx.newId()
        const result = insertChunk.run(
          chunkId, scopeId, valid.businessId, id, ordinal,
          ctx.cipher.seal(TEXT_CONTEXT, text),
          page,
          section === null ? null : ctx.cipher.seal(SECTION_CONTEXT, section),
          tokens, null, now,
          // The parent document: same scope, same business, not replaced.
          id, scopeId, valid.businessId,
        )
        if (Number(result.changes) !== 1) {
          // No parent means this document is not one this business owns. From here it
          // does not exist, which is the answer this layer gives everywhere else.
          throw new StorageError('not_found')
        }
        inserted += 1

        for (const [word, occurrences] of searchableTerms(text)) {
          insertTerm.run(
            chunkId, scopeId, valid.businessId, id,
            ctx.cipher.keyedDigest(TERM_CONTEXT, word),
            occurrences,
          )
          termsWritten += 1
        }
      }

      ctx.db.exec('COMMIT')
      return { inserted, terms: termsWritten }
    } catch (error) {
      try {
        ctx.db.exec('ROLLBACK')
      } catch {
        // Nothing committed, which is the state we want.
      }
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function get (scope: BusinessScope, chunkId: string): ChunkRow | null {
    const valid = requireBusinessScope(scope)
    const id = requireId(chunkId)
    try {
      const row = selectOne.get(id, scopeIdOf(valid), valid.businessId)
      return row === undefined ? null : toChunkRow(ctx, row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function tokensForDocument (scope: BusinessScope, documentId: string): number {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    try {
      const row = tokensFor.get(id, scopeIdOf(valid), valid.businessId)
      return row === undefined ? 0 : Number(row.total)
    } catch {
      throw new StorageError('internal_error')
    }
  }

  function countForDocument (scope: BusinessScope, documentId: string): number {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    try {
      const row = countFor.get(id, scopeIdOf(valid), valid.businessId)
      return row === undefined ? 0 : Number(row.n)
    } catch {
      throw new StorageError('internal_error')
    }
  }

  /** float32 little-endian, sealed. Fixed width so the reader can just divide. */
  function encodeVector (vector: number[]): Uint8Array {
    const floats = new Float32Array(vector)
    return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)
  }

  function putVector (scope: BusinessScope, chunkId: string, model: string, vector: number[]): void {
    const valid = requireBusinessScope(scope)
    const id = requireId(chunkId)
    if (typeof model !== 'string' || model === '' || model.length > 200) {
      throw new StorageError('invalid_request')
    }
    if (!Array.isArray(vector) || vector.length === 0 || vector.length > 8_192) {
      throw new StorageError('invalid_request')
    }
    const numbers: number[] = []
    for (const value of vector) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new StorageError('invalid_request')
      numbers.push(value)
    }

    const scopeId = scopeIdOf(valid)
    try {
      const sealed = ctx.cipher.sealBytes(VECTOR_CONTEXT, encodeVector(numbers))
      const result = insertVector.run(
        id, scopeId, valid.businessId, model, numbers.length, sealed, ctx.now(),
        // The parent chunk: same scope, same business.
        id, scopeId, valid.businessId,
      )
      // A replace that hit nothing means the chunk id was not this business's. The
      // upsert reports zero changes in that case too, so the read-back decides.
      if (Number(result.changes) === 0) {
        const exists = selectOne.get(id, scopeId, valid.businessId)
        if (exists === undefined) throw new StorageError('not_found')
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function getVector (scope: BusinessScope, chunkId: string): { model: string; vector: number[] } | null {
    const valid = requireBusinessScope(scope)
    const id = requireId(chunkId)
    try {
      const row = selectVector.get(id, scopeIdOf(valid), valid.businessId)
      if (row === undefined) return null
      const bytes = ctx.cipher.openBytes(VECTOR_CONTEXT, row.vec_enc as Uint8Array)
      const dims = Number(row.dims)
      // A sealed blob whose length disagrees with its recorded width is a row that
      // was written by something else; reading it as floats would invent numbers.
      if (!Number.isInteger(dims) || bytes.byteLength !== dims * 4) {
        throw new StorageError('internal_error')
      }
      const floats = new Float32Array(bytes.buffer, bytes.byteOffset, dims)
      return { model: requiredString(row.model), vector: Array.from(floats) }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function markVectorsStale (scope: BusinessScope, documentId: string, currentModel: string): number {
    const valid = requireBusinessScope(scope)
    const id = requireId(documentId)
    if (typeof currentModel !== 'string' || currentModel === '') throw new StorageError('invalid_request')
    try {
      /*
       * Counted off the chunk's own state, not off the vector's model. A vector row
       * records which model produced it and must keep saying so - that is what makes a
       * rebuild able to tell what it is replacing - so a query keyed on the vector
       * would count the same stale vector on every call. The chunk's `embed_state` is
       * the one place that answers "is this current", and once it is stale a second
       * sweep has nothing left to do.
       *
       * A chunk is stale when the model recorded for it differs, or when it carries a
       * vector made by a different model than the one now configured (a chunk whose
       * own model column was never filled in but whose vector came from an older
       * pass). A chunk with neither is left alone: someone else's rebuild is not a
       * reason to mark a document that was never embedded.
       */
      const result = ctx.db
        .prepare(`UPDATE chunk SET embed_state = 'stale'
                  WHERE document_id = ? AND scope_id = ? AND business_id = ?
                    AND embed_state = 'current'
                    AND (
                      (embed_model IS NOT NULL AND embed_model <> ?)
                      OR EXISTS (
                        SELECT 1 FROM chunk_vector v
                        WHERE v.chunk_id = chunk.id AND v.model <> ?
                      )
                    )`)
        .run(id, scopeIdOf(valid), valid.businessId, currentModel, currentModel)
      return Number(result.changes)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function searchTerms (scope: BusinessScope, words: string[], limit = 20): ScoredChunk[] {
    const valid = requireBusinessScope(scope)
    if (!Array.isArray(words)) throw new StorageError('invalid_request')
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new StorageError('invalid_request')
    }

    /*
     * The words are digested here, so a caller cannot pass a digest it computed under a
     * different key - and so the digest never leaves this module.
     */
    const digests: string[] = []
    for (const word of words) {
      if (typeof word !== 'string') throw new StorageError('invalid_request')
      const trimmed = word.trim().toLowerCase()
      if (trimmed.length < 3) continue
      const digest = ctx.cipher.keyedDigest(TERM_CONTEXT, trimmed)
      if (!digests.includes(digest)) digests.push(digest)
    }
    if (digests.length === 0) return []

    const placeholders = digests.map(() => '?').join(', ')
    try {
      const rows = ctx.db
        .prepare(`SELECT chunk_id, document_id, SUM(occurrences) AS score
                  FROM chunk_term
                  WHERE scope_id = ? AND business_id = ? AND term IN (${placeholders})
                  GROUP BY chunk_id, document_id
                  ORDER BY score DESC, chunk_id ASC
                  LIMIT ?`)
        .all(scopeIdOf(valid), valid.businessId, ...digests, limit)
      return rows.map((row) => ({
        chunkId: requiredString(row.chunk_id),
        documentId: requiredString(row.document_id),
        score: Number(row.score),
      }))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return {
    replaceForDocument,
    list,
    get,
    tokensForDocument,
    countForDocument,
    putVector,
    getVector,
    markVectorsStale,
    searchTerms,
  }
}

/** Re-exported so a caller can read a stored state without importing the contract. */
export function isEmbedState (value: unknown): value is EmbedState {
  return typeof value === 'string' && (embedStates as readonly string[]).includes(value)
}
