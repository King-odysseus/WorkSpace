/*
 * Business DNA: what the assistant knows about a business, as numbered snapshots.
 *
 * A write here is not an update in place. Each one lands a new `dna` row and one
 * field row per value, so a read always names one whole version. That is what makes
 * a rollback possible, and it is what keeps evidence honest: a quote attached to a
 * field of version 3 still sits beside the wording it was quoted for after version 4
 * has been written.
 *
 * Two rules in this file are the reason it exists rather than being a thin insert.
 *
 * A locked field belongs to the person. `editField` is their own wording, so it sets
 * `source = 'user'` and `locked = 1`, and generation may not touch it again. A later
 * `writeVersion` therefore skips any input whose key is locked, and carries the
 * locked row itself into the new version. Carrying it forward matters as much as
 * skipping: dropping the key from the new snapshot would make something the person
 * wrote vanish from the newest version, and every screen reads the newest.
 *
 * Evidence must be real. A citation is only worth something if the document it names
 * is in the same business as the field and the chunk it names belongs to that
 * document. Otherwise a field could cite a quote from another business's file, or
 * from a different document, and the citation would look perfectly ordinary. That
 * check is part of the insert (`INSERT ... SELECT ... WHERE`) rather than a read
 * before it, so there is no window between deciding the document exists and writing
 * the row that names it.
 *
 * Both `scope_id` and `business_id` filter every statement. Both encrypted columns
 * are opened with a context naming their table and column, so a value moved into the
 * wrong column fails to open instead of reading back as a plausible answer.
 */

import type { SqlRow } from '../driver.js'
import {
  dnaEvidenceRowSchema,
  dnaFieldKeys,
  dnaFieldRowSchema,
  dnaSources,
  dnaVersionRowSchema,
  StorageError,
  type BusinessScope,
  type DnaEvidenceRow,
  type DnaFieldKey,
  type DnaFieldRow,
  type DnaSource,
  type DnaVersionRow,
} from '../../../shared/storage-contract.js'
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

export interface DnaFieldInput {
  key: DnaFieldKey
  value: string
  /** 'ai' for generated content, 'user' for a person's own wording. */
  source?: DnaSource
}

export interface DnaEvidenceInput {
  documentId: string
  chunkId?: string | null
  page?: number | null
  quote: string
}

export interface DnaSnapshot {
  version: DnaVersionRow
  fields: DnaFieldRow[]
}

export interface DnaRepository {
  /** A new version carrying every field. Refuses locked keys. */
  writeVersion: (scope: BusinessScope, fields: DnaFieldInput[]) => DnaSnapshot
  /** The newest version and its fields, or null when there is none. */
  current: (scope: BusinessScope) => DnaSnapshot | null
  /** One field of the newest version. */
  field: (scope: BusinessScope, key: DnaFieldKey) => DnaFieldRow | null
  /** A person's own wording: sets source 'user' and locks the field. */
  editField: (scope: BusinessScope, key: DnaFieldKey, value: string) => DnaFieldRow
  addEvidence: (scope: BusinessScope, fieldId: string, input: DnaEvidenceInput) => DnaEvidenceRow
  evidenceFor: (scope: BusinessScope, fieldId: string) => DnaEvidenceRow[]
}

/** The columns a version row needs, so the mapper cannot drift from the schema. */
const VERSION_COLUMNS = 'id, version, created_at, updated_at'

/** The columns a field row needs. */
const FIELD_COLUMNS = 'id, key, value_enc, source, locked, updated_at'

/** The columns an evidence row needs. */
const EVIDENCE_COLUMNS = 'id, field_id, document_id, chunk_id, page, quote_enc, created_at'

/** The context for the one column holding a field's wording. */
const VALUE_CONTEXT = columnContext('dna_field', 'value_enc')

/** The context for the one column holding a quoted sentence. */
const QUOTE_CONTEXT = columnContext('dna_evidence', 'quote_enc')

/* The bounds the row schemas enforce, restated where a write can still be refused. */
const MAX_VALUE = 8_000
const MAX_QUOTE = 2_000
const MAX_ID = 64

const NEWEST_VERSION_SQL = `
SELECT ${VERSION_COLUMNS}
FROM dna
WHERE scope_id = ? AND business_id = ?
ORDER BY version DESC
LIMIT 1
`

const VERSION_BY_ID_SQL = `
SELECT ${VERSION_COLUMNS}
FROM dna
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/*
 * A new version row, filed only if the business is this account's.
 *
 * `dna` carries a foreign key on `business_id`, and that proves the id exists
 * somewhere in the file - not that it belongs to the caller. Selecting the row from
 * `business` under both the id and the scope closes that: a second account holding
 * another person's business id writes nothing, and the row count at both call sites
 * below turns that into `not_found`.
 */
const INSERT_VERSION_SQL = `
INSERT INTO dna (id, scope_id, business_id, version, created_at, updated_at)
SELECT ?, ?, business.id, ?, ?, ?
FROM business
WHERE business.id = ? AND business.scope_id = ?
`

/*
 * A field edited in place changes the version it lives in, so the version's own
 * `updated_at` has to move with it. Leaving it behind would date the newest version
 * from before the person's last edit, and that date is what a screen offers them.
 */
const TOUCH_VERSION_SQL = `
UPDATE dna
SET updated_at = ?
WHERE id = ? AND scope_id = ? AND business_id = ?
`

/* Ordered, so two reads of one version cannot disagree about the order of a form. */
const FIELDS_OF_VERSION_SQL = `
SELECT ${FIELD_COLUMNS}
FROM dna_field
WHERE dna_id = ? AND scope_id = ? AND business_id = ?
ORDER BY key ASC
`

const FIELD_OF_VERSION_SQL = `
SELECT ${FIELD_COLUMNS}
FROM dna_field
WHERE dna_id = ? AND scope_id = ? AND business_id = ? AND key = ?
`

/*
 * One key's newest value, read across every version.
 *
 * Walking the versions in a loop would work and would cost a query per version, which
 * grows with the history of the business. The join lets the version index order the
 * answer instead, and the two `d` conditions keep a field row from being ordered by a
 * version in another scope if one were ever filed under the wrong `dna_id`.
 */
const NEWEST_FIELD_SQL = `
SELECT f.id, f.key, f.value_enc, f.source, f.locked, f.updated_at
FROM dna_field f
JOIN dna d ON d.id = f.dna_id
WHERE f.scope_id = ? AND f.business_id = ? AND f.key = ?
  AND d.scope_id = ? AND d.business_id = ?
ORDER BY d.version DESC
LIMIT 1
`

const INSERT_FIELD_SQL = `
INSERT INTO dna_field (id, scope_id, business_id, dna_id, key, value_enc, source, locked, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`

/*
 * The edit path, in one statement.
 *
 * The trailing two parameters belong to the conflict clause, not to the insert: they
 * are what stops a matching key in another scope or another business from being the
 * row that gets updated.
 */
const UPSERT_FIELD_SQL = `
INSERT INTO dna_field (id, scope_id, business_id, dna_id, key, value_enc, source, locked, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (dna_id, key) DO UPDATE SET
  value_enc = excluded.value_enc,
  source = excluded.source,
  locked = excluded.locked,
  updated_at = excluded.updated_at
WHERE dna_field.scope_id = ? AND dna_field.business_id = ?
`

/*
 * The forged-link guard.
 *
 * The row is selected from `dna_field` and `document` rather than written from
 * `VALUES`, so a field id that is not this business's, or a document id that is not
 * this business's, selects no rows and inserts nothing. The document is named in the
 * WHERE list rather than in a join condition so the six conditions that decide the two
 * halves of the citation read as one clause.
 */
const INSERT_EVIDENCE_SQL = `
INSERT INTO dna_evidence (id, scope_id, business_id, field_id, document_id, chunk_id, page, quote_enc, created_at)
SELECT ?, f.scope_id, f.business_id, f.id, d.id, ?, ?, ?, ?
FROM dna_field f
CROSS JOIN document d
WHERE f.id = ? AND f.scope_id = ? AND f.business_id = ?
  AND d.id = ? AND d.scope_id = ? AND d.business_id = ?
`

/*
 * The same insert, with the chunk held to its document.
 *
 * The inner join fails on its own when the chunk is in another scope, another
 * business, or another document, so the row is never written. A citation that named
 * a chunk of the wrong document would quote a sentence the document does not contain,
 * which is worse than no citation at all.
 */
const INSERT_EVIDENCE_WITH_CHUNK_SQL = `
INSERT INTO dna_evidence (id, scope_id, business_id, field_id, document_id, chunk_id, page, quote_enc, created_at)
SELECT ?, f.scope_id, f.business_id, f.id, d.id, c.id, ?, ?, ?
FROM dna_field f
CROSS JOIN document d
JOIN chunk c ON c.id = ? AND c.scope_id = f.scope_id
  AND c.business_id = f.business_id AND c.document_id = d.id
WHERE f.id = ? AND f.scope_id = ? AND f.business_id = ?
  AND d.id = ? AND d.scope_id = ? AND d.business_id = ?
`

const EVIDENCE_BY_ID_SQL = `
SELECT ${EVIDENCE_COLUMNS}
FROM dna_evidence
WHERE id = ? AND scope_id = ? AND business_id = ?
`

const EVIDENCE_OF_FIELD_SQL = `
SELECT ${EVIDENCE_COLUMNS}
FROM dna_evidence
WHERE field_id = ? AND scope_id = ? AND business_id = ?
ORDER BY created_at ASC, id ASC
`

/** One validated input, after the shape of the call has been settled. */
interface PlannedField {
  key: DnaFieldKey
  value: string
  source: DnaSource
}

/** A field key the contract knows, or `invalid_request`. */
function requireFieldKey (value: unknown): DnaFieldKey {
  if (typeof value !== 'string' || !(dnaFieldKeys as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as DnaFieldKey
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

/** A quoted sentence, held to the same rules as a field value. */
function requireQuote (value: unknown): string {
  if (typeof value !== 'string') throw new StorageError('invalid_request')
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_QUOTE) throw new StorageError('invalid_request')
  return trimmed
}

/**
 * Who a value came from.
 *
 * Absent means generated, which is the common case and the one a caller should not
 * have to spell out. Any other spelling is refused: `source` decides whether a later
 * generation may replace the value, so a typo must not become a third state.
 */
function requireSource (value: unknown): DnaSource {
  if (value === undefined || value === null) return 'ai'
  if (typeof value !== 'string' || !(dnaSources as readonly string[]).includes(value)) {
    throw new StorageError('invalid_request')
  }
  return value as DnaSource
}

/** A row id as given, or a refusal. A missing id is a bug, not an empty answer. */
function requireId (value: unknown): string {
  if (typeof value !== 'string' || value === '' || value.length > MAX_ID) {
    throw new StorageError('invalid_request')
  }
  return value
}

/** An optional row id: absent and null both mean "not named". */
function requireOptionalId (value: unknown): string | null {
  if (value === undefined || value === null) return null
  return requireId(value)
}

/**
 * Where in a document a quote was found, or `null` for a document with no pages.
 *
 * A fractional or negative page would be stored and then refused by the row schema on
 * the way out, which reads as a corrupt row rather than a bad call, so it stops here.
 */
function requirePage (value: unknown): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StorageError('invalid_request')
  }
  return value
}

/**
 * The fields a write asked for, validated in one place before anything is written.
 *
 * A key given twice is refused rather than resolved to the last one. `dna_field` is
 * unique on (version, key), so the second value could not be stored as asked; and a
 * caller that produced two values for one key has a bug worth seeing rather than
 * having half of it silently dropped.
 */
function requireFields (value: unknown): PlannedField[] {
  if (!Array.isArray(value)) throw new StorageError('invalid_request')
  const items: unknown[] = value
  const seen = new Set<string>()
  const planned: PlannedField[] = []

  for (const item of items) {
    const input = (item ?? {}) as { key?: unknown; value?: unknown; source?: unknown }
    const key = requireFieldKey(input.key)
    if (seen.has(key)) throw new StorageError('invalid_request')
    seen.add(key)
    planned.push({ key, value: requireValue(input.value), source: requireSource(input.source) })
  }

  return planned
}

/**
 * One stored version as the contract's shape.
 *
 * The candidate is built first and validated second: building it is where a column
 * that will not open raises `bad_key`, and that answer must reach the caller
 * unchanged. Only a row the schema turns down becomes the fixed internal token.
 */
function toVersionRow (row: SqlRow): DnaVersionRow {
  const version = nullableInteger(row.version)
  if (version === null) throw new StorageError('internal_error')

  const candidate = {
    id: requiredString(row.id),
    version,
    createdAt: requiredString(row.created_at),
    updatedAt: requiredString(row.updated_at),
  }

  try {
    return dnaVersionRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

/**
 * One stored field as the contract's shape, wording opened.
 *
 * A schema error can quote the value it refused, and here that value is what a person
 * said about their own business, so it is replaced with the internal token.
 */
function toFieldRow (ctx: RepositoryContext, row: SqlRow): DnaFieldRow {
  const candidate = {
    id: requiredString(row.id),
    key: requiredString(row.key),
    value: ctx.cipher.open(VALUE_CONTEXT, requiredString(row.value_enc)),
    source: requiredString(row.source),
    locked: fromFlag(row.locked),
    updatedAt: requiredString(row.updated_at),
  }

  try {
    return dnaFieldRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

/** One stored citation as the contract's shape, quote opened. */
function toEvidenceRow (ctx: RepositoryContext, row: SqlRow): DnaEvidenceRow {
  const candidate = {
    id: requiredString(row.id),
    fieldId: requiredString(row.field_id),
    documentId: requiredString(row.document_id),
    chunkId: nullableString(row.chunk_id),
    page: nullableInteger(row.page),
    quote: ctx.cipher.open(QUOTE_CONTEXT, requiredString(row.quote_enc)),
    createdAt: requiredString(row.created_at),
  }

  try {
    return dnaEvidenceRowSchema.parse(candidate)
  } catch {
    throw new StorageError('internal_error')
  }
}

export function createDnaRepository (ctx: RepositoryContext): DnaRepository {
  const newestVersionStatement = ctx.db.prepare(NEWEST_VERSION_SQL)
  const versionByIdStatement = ctx.db.prepare(VERSION_BY_ID_SQL)
  const insertVersionStatement = ctx.db.prepare(INSERT_VERSION_SQL)
  const touchVersionStatement = ctx.db.prepare(TOUCH_VERSION_SQL)
  const fieldsOfVersionStatement = ctx.db.prepare(FIELDS_OF_VERSION_SQL)
  const fieldOfVersionStatement = ctx.db.prepare(FIELD_OF_VERSION_SQL)
  const newestFieldStatement = ctx.db.prepare(NEWEST_FIELD_SQL)
  const insertFieldStatement = ctx.db.prepare(INSERT_FIELD_SQL)
  const upsertFieldStatement = ctx.db.prepare(UPSERT_FIELD_SQL)
  const insertEvidenceStatement = ctx.db.prepare(INSERT_EVIDENCE_SQL)
  const insertEvidenceWithChunkStatement = ctx.db.prepare(INSERT_EVIDENCE_WITH_CHUNK_SQL)
  const evidenceByIdStatement = ctx.db.prepare(EVIDENCE_BY_ID_SQL)
  const evidenceOfFieldStatement = ctx.db.prepare(EVIDENCE_OF_FIELD_SQL)

  function readFieldRows (scopeId: string, businessId: string, dnaId: string): DnaFieldRow[] {
    return fieldsOfVersionStatement
      .all(dnaId, scopeId, businessId)
      .map((row) => toFieldRow(ctx, row))
  }

  function readVersionRow (scopeId: string, businessId: string, dnaId: string): DnaVersionRow {
    const row = versionByIdStatement.get(dnaId, scopeId, businessId)
    // A version just written and then not found is not a missing answer, it is a
    // broken write. Saying `not_found` would send the caller looking in the wrong place.
    if (row === undefined) throw new StorageError('internal_error')
    return toVersionRow(row)
  }

  /**
   * A new version carrying every field.
   *
   * The snapshot is the fields asked for plus the locked ones carried forward. An
   * unlocked key that is not asked for is simply absent from the new version, which is
   * what makes a version a statement rather than a merge with the last one.
   */
  function writeVersion (scope: BusinessScope, fields: DnaFieldInput[]): DnaSnapshot {
    const valid = requireBusinessScope(scope)
    const planned = requireFields(fields)
    const scopeId = scopeIdOf(valid)
    const businessId = valid.businessId
    const now = ctx.now()

    /*
     * One transaction over the read of the current version and the write of the next.
     * The version number is computed from what is stored, so two writes that read
     * before either had written would compute the same number and the unique key would
     * turn the second one into an internal error instead of version 3.
     */
    try {
      ctx.db.exec('BEGIN IMMEDIATE')
      try {
        let number = 1
        const locked = new Map<string, DnaFieldRow>()
        const newest = newestVersionStatement.get(scopeId, businessId)

        if (newest !== undefined) {
          const version = toVersionRow(newest)
          number = version.version + 1
          for (const row of readFieldRows(scopeId, businessId, version.id)) {
            if (row.locked) locked.set(row.key, row)
          }
        }

        const dnaId = ctx.newId()
        const inserted = insertVersionStatement.run(
          dnaId, scopeId, number, now, now,
          // The parent business: same id, same account, or nothing is written.
          businessId, scopeId,
        )
        if (Number(inserted.changes) !== 1) throw new StorageError('not_found')

        for (const input of planned) {
          // A locked key is the person's own wording. The carried row below stands in
          // for it, and writing this input here would replace what they wrote.
          if (locked.has(input.key)) continue
          insertFieldStatement.run(
            ctx.newId(),
            scopeId,
            businessId,
            dnaId,
            input.key,
            ctx.cipher.seal(VALUE_CONTEXT, input.value),
            input.source,
            toFlag(false),
            now,
          )
        }

        for (const row of locked.values()) {
          insertFieldStatement.run(
            ctx.newId(),
            scopeId,
            businessId,
            dnaId,
            row.key,
            ctx.cipher.seal(VALUE_CONTEXT, row.value),
            'user',
            toFlag(true),
            now,
          )
        }

        const snapshot = {
          version: readVersionRow(scopeId, businessId, dnaId),
          fields: readFieldRows(scopeId, businessId, dnaId),
        }
        ctx.db.exec('COMMIT')
        return snapshot
      } catch (error) {
        try {
          ctx.db.exec('ROLLBACK')
        } catch {
          // A rollback that fails leaves nothing written, which is the aim anyway.
        }
        throw error
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function current (scope: BusinessScope): DnaSnapshot | null {
    const valid = requireBusinessScope(scope)

    try {
      const scopeId = scopeIdOf(valid)
      const row = newestVersionStatement.get(scopeId, valid.businessId)
      if (row === undefined) return null
      const version = toVersionRow(row)
      return { version, fields: readFieldRows(scopeId, valid.businessId, version.id) }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function field (scope: BusinessScope, key: DnaFieldKey): DnaFieldRow | null {
    const valid = requireBusinessScope(scope)
    const fieldKey = requireFieldKey(key)

    try {
      const scopeId = scopeIdOf(valid)
      const row = newestFieldStatement.get(
        scopeId,
        valid.businessId,
        fieldKey,
        scopeId,
        valid.businessId,
      )
      return row === undefined ? null : toFieldRow(ctx, row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  /**
   * A person's own wording, written into the newest version.
   *
   * No new version is created for an edit: the newest version is the one every screen
   * reads, and a person correcting a sentence is changing that version rather than
   * recording a draft of it. A business with no version yet gets version 1 from this
   * call, because a person who types into the form before any generation has run has
   * still said something worth keeping.
   */
  function editField (scope: BusinessScope, key: DnaFieldKey, value: string): DnaFieldRow {
    const valid = requireBusinessScope(scope)
    const fieldKey = requireFieldKey(key)
    const text = requireValue(value)
    const scopeId = scopeIdOf(valid)
    const businessId = valid.businessId
    const now = ctx.now()

    try {
      ctx.db.exec('BEGIN IMMEDIATE')
      try {
        const newest = newestVersionStatement.get(scopeId, businessId)
        let dnaId: string

        if (newest === undefined) {
          dnaId = ctx.newId()
          // The first version of a business that has never been written. It is still
          // held to the account check: a person typing into the form proves nothing
          // about whose business id they were handed.
          const inserted = insertVersionStatement.run(
            dnaId, scopeId, 1, now, now,
            businessId, scopeId,
          )
          if (Number(inserted.changes) !== 1) throw new StorageError('not_found')
        } else {
          dnaId = toVersionRow(newest).id
          touchVersionStatement.run(now, dnaId, scopeId, businessId)
        }

        upsertFieldStatement.run(
          ctx.newId(),
          scopeId,
          businessId,
          dnaId,
          fieldKey,
          ctx.cipher.seal(VALUE_CONTEXT, text),
          'user',
          toFlag(true),
          now,
          scopeId,
          businessId,
        )

        const row = fieldOfVersionStatement.get(dnaId, scopeId, businessId, fieldKey)
        if (row === undefined) throw new StorageError('internal_error')
        ctx.db.exec('COMMIT')
        return toFieldRow(ctx, row)
      } catch (error) {
        try {
          ctx.db.exec('ROLLBACK')
        } catch {
          // A rollback that fails leaves nothing written, which is the aim anyway.
        }
        throw error
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function addEvidence (
    scope: BusinessScope,
    fieldId: string,
    input: DnaEvidenceInput,
  ): DnaEvidenceRow {
    const valid = requireBusinessScope(scope)
    const fieldRef = requireId(fieldId)
    const documentRef = requireId(input?.documentId)
    const chunkRef = requireOptionalId(input?.chunkId)
    const pageNumber = requirePage(input?.page)
    const quoteText = requireQuote(input?.quote)
    const scopeId = scopeIdOf(valid)
    const businessId = valid.businessId
    const id = ctx.newId()
    const now = ctx.now()
    const sealed = ctx.cipher.seal(QUOTE_CONTEXT, quoteText)

    try {
      const result = chunkRef === null
        ? insertEvidenceStatement.run(
            id,
            chunkRef,
            pageNumber,
            sealed,
            now,
            fieldRef,
            scopeId,
            businessId,
            documentRef,
            scopeId,
            businessId,
          )
        : insertEvidenceWithChunkStatement.run(
            id,
            pageNumber,
            sealed,
            now,
            chunkRef,
            fieldRef,
            scopeId,
            businessId,
            documentRef,
            scopeId,
            businessId,
          )

      /*
       * Nothing inserted means one of the things this citation names is not in this
       * business: the field, the document, or the chunk as belonging to that document.
       * From here none of them exists, so the answer is the same one this layer gives
       * for any id the caller cannot see, and no row was written to prove otherwise.
       */
      if (Number(result.changes) !== 1) throw new StorageError('not_found')

      const row = evidenceByIdStatement.get(id, scopeId, businessId)
      if (row === undefined) throw new StorageError('internal_error')
      return toEvidenceRow(ctx, row)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  function evidenceFor (scope: BusinessScope, fieldId: string): DnaEvidenceRow[] {
    const valid = requireBusinessScope(scope)
    const fieldRef = requireId(fieldId)

    try {
      const scopeId = scopeIdOf(valid)
      return evidenceOfFieldStatement
        .all(fieldRef, scopeId, valid.businessId)
        .map((row) => toEvidenceRow(ctx, row))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError('internal_error')
    }
  }

  return { writeVersion, current, field, editField, addEvidence, evidenceFor }
}
