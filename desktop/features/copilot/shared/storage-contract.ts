/*
 * The vocabulary of the local database, shared by the main process and the
 * tests that drive it.
 *
 * Two decisions in this file carry most of its weight.
 *
 * First, scope. The plan (section 4.4 and section 14) says a database belongs to
 * one signed-in person on one server, and that every repository function takes
 * both and applies them in the WHERE clause. `scopeKey()` is the single place a
 * scope becomes a string, and it is length prefixed rather than dot-joined for
 * the reason the credential store already had to learn: joining `example.com` +
 * user 7 with dots produces the same name as `example.com.7` + user 8, so two
 * different people would share rows. A length prefix cannot be re-split.
 *
 * Second, ciphertext names. Every column that holds something a person wrote or
 * a model said ends in `_enc` and holds an envelope, never text. The schema
 * itself therefore advertises which columns are readable and which are not, and
 * a query that forgets to decrypt stands out in review instead of looking
 * normal.
 */

import { z } from 'zod'

/**
 * Bumped when a row shape changes in a way a reader must notice. Migrations are
 * numbered separately; this is the shape of the rows they produce.
 */
export const STORAGE_CONTRACT_VERSION = 2

/**
 * The scope of a database: one person, on one server.
 *
 * `serverHost` is the host the session came from, lower-cased, because the same
 * business reached over `Zuri.example.test` and `zuri.example.test` is the same
 * business and must not become two databases.
 */
export const storageScopeSchema = z.strictObject({
  serverHost: z.string().min(1).max(253),
  userId: z.number().int().positive(),
})

export type StorageScope = z.infer<typeof storageScopeSchema>

/**
 * A row that belongs to one business inside an already-scoped database.
 *
 * `businessId` is the assistant's own identifier for the business, not the
 * remote workspace id. The two are linked by `remoteWorkspaceId` on the business
 * row so a remote id changing (a workspace restored from archive) does not move
 * every thread with it.
 */
export const businessScopeSchema = storageScopeSchema.extend({
  businessId: z.string().min(1).max(64),
})

export type BusinessScope = z.infer<typeof businessScopeSchema>

/**
 * A stable, collision-free string for a scope.
 *
 * The host is length prefixed (`11-example.com`) so a host containing the
 * separator cannot impersonate a different person, and the separator between the
 * two halves is `&`, which neither a hostname nor a positive integer can hold.
 */
export function scopeKey (scope: StorageScope): string {
  const host = scope.serverHost.trim().toLowerCase()
  return `${host.length}-${host}&${scope.userId}`
}

/** The key a business's rows are filed under: its scope plus its own id. */
export function businessKey (scope: BusinessScope): string {
  return `${scopeKey(scope)}&${scope.businessId}`
}

/* ------------------------------------------------------------------ *
 * Failures
 * ------------------------------------------------------------------ */

/**
 * The fixed tokens every storage refusal carries.
 *
 * The same rule as the provider layer: a token, never a sentence built from what
 * went wrong, because these strings end up in a log line and a log line must not
 * be able to carry a row's content.
 */
export const STORAGE_FAILURES = Object.freeze([
  /** The database is not open: signed out, or never opened. */
  'closed',
  /** The key did not open the database, or a stored envelope would not open. */
  'bad_key',
  /** This Node/Electron build has no SQLite. Reported rather than worked around. */
  'runtime_unsupported',
  /** A row was expected and is not there, or belongs to someone else. */
  'not_found',
  /** The caller's row cannot be written as given. */
  'invalid_request',
  /** A write was refused by a constraint that should have been impossible. */
  'conflict',
  /** A migration failed; the database is left as it was. */
  'migration_failed',
  /** Anything the code did not anticipate. */
  'internal_error',
] as const)

export type StorageFailure = (typeof STORAGE_FAILURES)[number]

/** One plain sentence per token. Shown to a person, never a stack trace. */
export const STORAGE_FAILURE_MESSAGES: Readonly<Record<StorageFailure, string>> = Object.freeze({
  closed: 'The assistant is not signed in, so there is nothing to read.',
  bad_key: 'This database cannot be opened with the current key.',
  runtime_unsupported: 'This build cannot open the local database.',
  not_found: 'That item is not here.',
  invalid_request: 'That change is not one this screen can make.',
  conflict: 'That change was refused because it would overwrite something else.',
  migration_failed: 'The database could not be prepared. Nothing was changed.',
  internal_error: 'Something went wrong reading the local database.',
})

export class StorageError extends Error {
  readonly failure: StorageFailure

  constructor (failure: StorageFailure) {
    // The fixed sentence is for a developer reading a log. `cause` is
    // deliberately absent: `console.error` prints a cause, and a cause here
    // would be a row's content.
    super(STORAGE_FAILURE_MESSAGES[failure])
    this.name = 'StorageError'
    this.failure = failure
  }
}

/* ------------------------------------------------------------------ *
 * Row shapes
 * ------------------------------------------------------------------ */

/** A business as the database knows it. One remote workspace, one local row. */
export const businessRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  remoteWorkspaceId: z.number().int().positive(),
  name: z.string().min(1).max(120),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  archivedAt: z.string().min(1).max(40).nullable(),
})

export type BusinessRow = z.infer<typeof businessRowSchema>

export const messageRoles = Object.freeze(['user', 'assistant', 'system'] as const)
export type MessageRole = (typeof messageRoles)[number]

/**
 * One message.
 *
 * `provider`, `model` and `cloud` are nullable because a user's own message was
 * not produced by a model. An assistant message that has none of them is a
 * recording of a failure, which is why they are not required: inventing a model
 * name for a reply that never happened would misreport the attribution chip.
 */
export const messageRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  threadId: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  role: z.enum(messageRoles),
  content: z.string().max(200_000),
  provider: z.string().max(60).nullable(),
  model: z.string().max(200).nullable(),
  cloud: z.boolean().nullable(),
  createdAt: z.string().min(1).max(40),
})

export type MessageRow = z.infer<typeof messageRowSchema>

export const threadRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  pinned: z.boolean(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  closedAt: z.string().min(1).max(40).nullable(),
  messageCount: z.number().int().nonnegative(),
})

export type ThreadRow = z.infer<typeof threadRowSchema>

/**
 * The four kinds of remembered item the plan names (section 11).
 *
 * `open_question` is not a lesser kind: an unresolved question is what stops the
 * assistant guessing, so it is stored and shown like the rest.
 */
export const memoryKinds = Object.freeze(['decision', 'fact', 'assumption', 'open_question'] as const)
export type MemoryKind = (typeof memoryKinds)[number]

/** Who put the item there. A user edit always wins over a later extraction. */
export const memoryOrigins = Object.freeze(['ai', 'user'] as const)
export type MemoryOrigin = (typeof memoryOrigins)[number]

export const memoryRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  kind: z.enum(memoryKinds),
  text: z.string().min(1).max(4_000),
  sourceMessageId: z.string().max(64).nullable(),
  origin: z.enum(memoryOrigins),
  locked: z.boolean(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

export type MemoryRow = z.infer<typeof memoryRowSchema>

/**
 * A rolling summary of one thread's history.
 *
 * `coversThroughSeq` is what makes a summary safe to trust: the context builder
 * can skip exactly the messages the summary already accounts for, and a stale
 * summary cannot silently swallow messages it never saw.
 */
export const summaryRowSchema = z.strictObject({
  threadId: z.string().min(1).max(64),
  text: z.string().min(1).max(20_000),
  coversThroughSeq: z.number().int().nonnegative(),
  updatedAt: z.string().min(1).max(40),
})

export type SummaryRow = z.infer<typeof summaryRowSchema>

/** Proposal kinds. Phase 3 only ever creates a draft; nothing executes. */
export const proposalKinds = Object.freeze(['task', 'task_batch', 'email', 'dna_change', 'reassign'] as const)
export type ProposalKind = (typeof proposalKinds)[number]

export const proposalStatuses = Object.freeze(['pending', 'approved', 'rejected', 'expired'] as const)
export type ProposalStatus = (typeof proposalStatuses)[number]

export const proposalRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  threadId: z.string().max(64).nullable(),
  kind: z.enum(proposalKinds),
  status: z.enum(proposalStatuses),
  title: z.string().min(1).max(200),
  /** The draft itself, as the card shows it. Free-form and never executed here. */
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(1).max(120),
  expiresAt: z.string().min(1).max(40).nullable(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

export type ProposalRow = z.infer<typeof proposalRowSchema>

/**
 * An audit entry for something the assistant did locally.
 *
 * It holds what happened and when, never the content of what was read: an audit
 * trail that quoted a conversation would be a second copy of the conversation in
 * a table nobody encrypts by habit.
 */
export const auditOutcomes = Object.freeze(['allowed', 'blocked', 'failed'] as const)
export type StorageAuditOutcome = (typeof auditOutcomes)[number]

export const auditRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  businessId: z.string().max(64).nullable(),
  action: z.string().min(1).max(80),
  outcome: z.enum(auditOutcomes),
  detail: z.string().max(500),
  createdAt: z.string().min(1).max(40),
})

export type AuditRow = z.infer<typeof auditRowSchema>

/* ------------------------------------------------------------------ *
 * Documents and knowledge (Phase 4)
 *
 * The plan's section 8 sketches these tables with plain names, and section 10
 * says what they have to do. Two of its requirements shape every shape below.
 *
 * Section 10.1: a document is in exactly one of four states, and a failure carries
 * a reason a person can read. `failure` is a fixed token rather than the parser's
 * own message for the reason every other refusal in this app is a token - a parser
 * message can quote the file it could not read.
 *
 * Section 10.2: changing the embedding model marks the vectors stale rather than
 * silently mixing two vector spaces, which are not comparable.
 * ------------------------------------------------------------------ */

/** The four states a document moves through (section 10.1). */
export const ingestionStatuses = Object.freeze(['uploaded', 'reading', 'ready', 'failed'] as const)
export type IngestionStatus = (typeof ingestionStatuses)[number]

/**
 * Why an ingestion failed, as a token.
 *
 * `unsupported` and `unreadable` are the two the parsers distinguish: a file this
 * build has no reader for, and a file it has a reader for but which would not open.
 */
export const documentFailures = Object.freeze([
  'unsupported',
  'unreadable',
  'too_large',
  'parse_failed',
  'interrupted',
] as const)
export type DocumentFailure = (typeof documentFailures)[number]

/** The file kinds section 10.1 names a parser for. */
export const documentKinds = Object.freeze([
  'pdf',
  'docx',
  'txt',
  'md',
  'xlsx',
  'csv',
  'pptx',
  'image',
] as const)
export type DocumentKind = (typeof documentKinds)[number]

/** How the file arrived. `folder` is the optional watcher, deferred but reserved. */
export const documentSources = Object.freeze(['picked', 'dropped', 'folder'] as const)
export type DocumentSource = (typeof documentSources)[number]

export const documentRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(260),
  kind: z.enum(documentKinds),
  source: z.enum(documentSources),
  status: z.enum(ingestionStatuses),
  /** A keyed digest of the file's bytes, so an unchanged re-add is recognised. */
  contentDigest: z.string().min(16).max(64),
  byteSize: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative().nullable(),
  failure: z.enum(documentFailures).nullable(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  readyAt: z.string().min(1).max(40).nullable(),
  /** Set when this document was replaced. A non-null value means "not current". */
  replacedBy: z.string().max(64).nullable(),
})

export type DocumentRow = z.infer<typeof documentRowSchema>

/**
 * Where a citation points (section 10.3, "every answer lists the documents and page
 * or section used").
 *
 * `page` and `section` are both nullable because a spreadsheet has sheets rather
 * than pages, and a plain text file has neither. A citation with no location at all
 * is still valid - it names the document - which is why the two are optional rather
 * than the whole thing being.
 */
export const citationLocationSchema = z.strictObject({
  documentId: z.string().min(1).max(64),
  documentName: z.string().min(1).max(260),
  page: z.number().int().nonnegative().nullable(),
  section: z.string().max(300).nullable(),
})

export type CitationLocation = z.infer<typeof citationLocationSchema>

/** Whether a chunk's stored vector is still in the current model's space. */
export const embedStates = Object.freeze(['current', 'stale'] as const)
export type EmbedState = (typeof embedStates)[number]

export const chunkRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  documentId: z.string().min(1).max(64),
  ordinal: z.number().int().nonnegative(),
  text: z.string().min(1).max(40_000),
  page: z.number().int().nonnegative().nullable(),
  section: z.string().max(300).nullable(),
  tokens: z.number().int().nonnegative(),
  embedModel: z.string().max(200).nullable(),
  embedState: z.enum(embedStates),
  createdAt: z.string().min(1).max(40),
})

export type ChunkRow = z.infer<typeof chunkRowSchema>

/** The stages a persisted ingestion job reports, so a screen can say what it is doing. */
export const jobStages = Object.freeze([
  'waiting',
  'reading',
  'extracting',
  'chunking',
  'indexing',
  'done',
  'failed',
] as const)
export type JobStage = (typeof jobStages)[number]

export const jobStatuses = Object.freeze(['queued', 'running', 'done', 'failed'] as const)
export type JobStatus = (typeof jobStatuses)[number]

export const documentJobRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  documentId: z.string().min(1).max(64),
  status: z.enum(jobStatuses),
  stage: z.enum(jobStages),
  /** Whole percent, 0 to 100. A screen shows a bar and a number from this. */
  progress: z.number().int().min(0).max(100),
  attempts: z.number().int().nonnegative(),
  failure: z.enum(documentFailures).nullable(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
  startedAt: z.string().min(1).max(40).nullable(),
  finishedAt: z.string().min(1).max(40).nullable(),
})

export type DocumentJobRow = z.infer<typeof documentJobRowSchema>

/**
 * The nine Business DNA fields of section 10.4.
 *
 * A closed list, because these are rendered as a fixed form and a model that
 * invented a tenth key would produce a field nobody can see or approve.
 */
export const dnaFieldKeys = Object.freeze([
  'mission',
  'vision',
  'long_term_goals',
  'core_values',
  'will_not_do',
  'target_customers',
  'brand_voice',
  'priorities_and_challenges',
  'key_numbers',
] as const)
export type DnaFieldKey = (typeof dnaFieldKeys)[number]

/** Who last set a field. A user edit locks it against later generation. */
export const dnaSources = Object.freeze(['ai', 'user'] as const)
export type DnaSource = (typeof dnaSources)[number]

export const dnaVersionRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  version: z.number().int().positive(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

export type DnaVersionRow = z.infer<typeof dnaVersionRowSchema>

export const dnaFieldRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  key: z.enum(dnaFieldKeys),
  value: z.string().max(8_000),
  source: z.enum(dnaSources),
  locked: z.boolean(),
  updatedAt: z.string().min(1).max(40),
})

export type DnaFieldRow = z.infer<typeof dnaFieldRowSchema>

/** One piece of evidence behind a DNA field: a document, and where in it. */
export const dnaEvidenceRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  fieldId: z.string().min(1).max(64),
  documentId: z.string().min(1).max(64),
  chunkId: z.string().max(64).nullable(),
  page: z.number().int().nonnegative().nullable(),
  quote: z.string().min(1).max(2_000),
  createdAt: z.string().min(1).max(40),
})

export type DnaEvidenceRow = z.infer<typeof dnaEvidenceRowSchema>

/**
 * How a proposed field differs from what is stored.
 *
 * `conflict` is separate from `changed` because section 10.5 treats the two
 * differently: a changed value is an update, a conflict is a value that contradicts
 * a locked one and has to be put to the person rather than applied.
 */
export const dnaChangeKinds = Object.freeze(['added', 'changed', 'conflict'] as const)
export type DnaChangeKind = (typeof dnaChangeKinds)[number]

/** A per-field decision, which is what section 10.4 asks for: approval one field at a time. */
export const dnaDecisions = Object.freeze(['pending', 'approved', 'rejected'] as const)
export type DnaDecision = (typeof dnaDecisions)[number]

export const dnaProposalRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  documentId: z.string().max(64).nullable(),
  status: z.enum(dnaDecisions),
  baseVersion: z.number().int().nonnegative(),
  createdAt: z.string().min(1).max(40),
  updatedAt: z.string().min(1).max(40),
})

export type DnaProposalRow = z.infer<typeof dnaProposalRowSchema>

export const dnaProposalChangeRowSchema = z.strictObject({
  id: z.string().min(1).max(64),
  proposalId: z.string().min(1).max(64),
  key: z.enum(dnaFieldKeys),
  change: z.enum(dnaChangeKinds),
  proposed: z.string().max(8_000),
  previous: z.string().max(8_000).nullable(),
  decision: z.enum(dnaDecisions),
  decidedAt: z.string().min(1).max(40).nullable(),
})

export type DnaProposalChangeRow = z.infer<typeof dnaProposalChangeRowSchema>

/**
 * How retrieval decided what to send, and what it chose (section 10.3).
 *
 * `strategy` is the answer to "Used 3 excerpts" or "Used the full documents".
 * `notice` carries the keyword-only warning of section 10.2 as a token, so the
 * screen can pick its own sentence and a log line never carries one.
 */
export const retrievalStrategies = Object.freeze(['full_documents', 'excerpts', 'keyword_only'] as const)
export type RetrievalStrategy = (typeof retrievalStrategies)[number]

export const retrievalNotices = Object.freeze(['no_embeddings', 'no_documents', 'budget_exceeded'] as const)
export type RetrievalNotice = (typeof retrievalNotices)[number]

export const retrievalExplanationSchema = z.strictObject({
  strategy: z.enum(retrievalStrategies),
  /** How many excerpts were taken. Zero when whole documents were used. */
  excerptCount: z.number().int().nonnegative(),
  budgetTokens: z.number().int().nonnegative(),
  usedTokens: z.number().int().nonnegative(),
  notice: z.enum(retrievalNotices).nullable(),
})

export type RetrievalExplanation = z.infer<typeof retrievalExplanationSchema>

/* ------------------------------------------------------------------ *
 * Ids and timestamps
 * ------------------------------------------------------------------ */

/** A row id: lowercase hex, so it can be compared, sorted and logged safely. */
export const rowIdSchema = z.string().regex(/^[0-9a-f]{8,64}$/)

/** An ISO-8601 instant in UTC, to the millisecond. */
export const timestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
