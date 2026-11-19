/*
 * Reading a document: from sealed bytes to indexed passages, with a job that survives a
 * crash and a person watching a progress bar.
 *
 * Why the job is persisted rather than held in memory. Ingestion is the one operation
 * where the app can genuinely be interrupted - the window closed, the machine sleeping,
 * a sign-out - in the middle of a file that took a while to read. A job that lived only
 * in memory would leave a document stuck at `reading` for ever, with no way for the next
 * start to know anything had been running. So every stage writes to `document_job`, and
 * `resumePending` is the other half of that promise.
 *
 * Why a restart cannot duplicate chunks. The final write is
 * `chunks.replaceForDocument`, which clears the document's chunks, their index and their
 * vectors and then inserts the new set in one transaction. Running the whole pipeline
 * twice therefore leaves one set, not two - which is what makes "just start it again"
 * a safe recovery rather than something that needs a repair step.
 *
 * Why progress is reported through a guard that reads first. `jobs.progress` refuses a
 * value lower than the one already stored, because a late report from an earlier attempt
 * must not rewind the bar. A resumed job that starts again at ten percent after having
 * reached sixty would therefore throw on its first report. This file asks what is stored
 * and stays quiet unless it has something newer to say, which keeps the bar rising and
 * keeps a resumed run from failing on its own bookkeeping.
 *
 * Why every stage asks whether the account is still the one that started. A sign-out
 * closes the database, so a write after that throws - but a throw caught at the wrong
 * level becomes an error message under a new person's account, describing the previous
 * person's file. `isCurrent` is the cheaper, more honest answer: stop, write nothing,
 * report that the work belonged to a session that has ended.
 *
 * What this does NOT do. The parsing still runs on the main process's thread, yielding
 * between stages rather than inside a parser. A dedicated worker thread needs a second
 * build entry point, which is a change to how the app is packaged, so it is recorded as
 * deferred rather than done quietly here. The stages below still yield between
 * themselves, so a large file does not freeze the window for the whole pipeline.
 */

import type { BusinessScope, DocumentFailure } from '../../shared/storage-contract.js'
import { StorageError } from '../../shared/storage-contract.js'
import type { ChunkRepository } from '../db/repositories/chunks.js'
import type { DocumentJobRepository } from '../db/repositories/document-jobs.js'
import type { DocumentRepository } from '../db/repositories/documents.js'
import { detectKind } from './kinds.js'
import { ocrAvailable } from './ocr.js'
import { summariseExtraction, extractDocument } from './extract.js'
import { chunkSections, type ChunkingOptions, type DocumentChunk } from './chunk.js'
import type { ExtractionFailure } from './types.js'

export interface IngestionRepositories {
  documents: DocumentRepository
  chunks: ChunkRepository
  jobs: DocumentJobRepository
}

export interface IngestionOptions {
  /** Stops the pipeline between stages. Never interrupts a parser mid-read. */
  signal?: AbortSignal
  /**
   * Whether the session that started this work is still the one in front of the person.
   *
   * Called before every write. Absent means "assume it is", which is what a test wants.
   */
  isCurrent?: () => boolean
  chunking?: Partial<ChunkingOptions>
}

export type IngestionOutcomeStatus = 'ready' | 'failed' | 'cancelled' | 'stale'

export interface IngestionOutcome {
  documentId: string
  jobId: string | null
  status: IngestionOutcomeStatus
  failure: DocumentFailure | null
  /** Passages stored. Zero unless the status is `ready`. */
  chunks: number
  pageCount: number
  /**
   * Pages that were pictures and could not be read.
   *
   * Reported rather than stored: nothing in the document row holds a per-page list, and
   * inventing a column for it before the screen that shows it exists would be a schema
   * change made blind. The screen says "some pages could not be read" from this.
   */
  ocrPending: number[]
}

export interface IngestionService {
  /** Read one document. Safe to call again after an interruption. */
  ingest: (scope: BusinessScope, documentId: string, options?: IngestionOptions) => Promise<IngestionOutcome>
  /** Every job left unfinished, oldest first. What a start-up calls. */
  resumePending: (scope: BusinessScope, options?: IngestionOptions) => Promise<IngestionOutcome[]>
}

/** A token this pipeline reports for a stage. The job schema accepts only these. */
type Stage = 'reading' | 'extracting' | 'chunking' | 'indexing'

/** Where each stage sits on the bar. Rising, because the repository refuses a rewind. */
const STAGE_PROGRESS: Readonly<Record<Stage, number>> = Object.freeze({
  reading: 10,
  extracting: 30,
  chunking: 60,
  indexing: 85,
})

/** Turn a parser's token into the document row's token. */
function documentFailure (failure: ExtractionFailure): DocumentFailure {
  return failure
}

/**
 * Build the ingestion pipeline over three repositories.
 *
 * Taken as an argument rather than imported, so a test can drive it against a real
 * database in a temporary folder without an Electron window, and so the stage order can
 * be observed without a model provider being involved.
 */
export function createIngestion (repos: IngestionRepositories): IngestionService {
  /** True when the pipeline should stop before its next write. */
  function stopped (options: IngestionOptions): IngestionOutcomeStatus | null {
    if (options.signal?.aborted === true) return 'cancelled'
    if (options.isCurrent !== undefined && !options.isCurrent()) return 'stale'
    return null
  }

  /**
   * Report a stage, skipping it when the bar is already further along.
   *
   * A resumed run reaches `reading` on a job that previously died during `indexing`.
   * Writing ten percent would be refused by the repository, and an exception there
   * would abort a document that was about to succeed.
   */
  function report (
    scope: BusinessScope,
    jobId: string,
    stage: Stage,
    options: IngestionOptions,
  ): void {
    if (stopped(options) !== null) return
    const current = repos.jobs.get(scope, jobId)
    if (current === null) return
    if (current.progress >= STAGE_PROGRESS[stage]) return
    try {
      repos.jobs.progress(scope, jobId, { stage, progress: STAGE_PROGRESS[stage] })
    } catch (error) {
      // Only the "this number is stale" refusal is expected here, and it is the case the
      // caller does not need to hear about. Anything else is a real problem.
      if (!(error instanceof StorageError) || error.failure !== 'invalid_request') throw error
    }
  }

  /** Give up on a document for a reason of its own: job failed, document failed. */
  function abandon (
    scope: BusinessScope,
    documentId: string,
    jobId: string,
    failure: DocumentFailure,
    options: IngestionOptions,
  ): IngestionOutcome {
    if (stopped(options) === null) {
      repos.documents.markFailed(scope, documentId, failure)
      repos.jobs.fail(scope, jobId, failure)
    }
    return {
      documentId,
      jobId,
      status: 'failed',
      failure,
      chunks: 0,
      pageCount: 0,
      ocrPending: [],
    }
  }

  /**
   * Stop because the session ended, or because the person pressed stop.
   *
   * The two are deliberately different. A cancellation belongs to the person still
   * looking at the screen, so the document is marked `interrupted` and they see a file
   * that needs another go. A sign-out does not: the next person to open this business
   * should not find a failure recorded against a document they never asked about, and a
   * write after the database has closed would throw anyway. So only a cancellation
   * writes, and a sign-out writes nothing at all.
   */
  function stoppedOutcome (
    scope: BusinessScope,
    documentId: string,
    jobId: string,
    reason: IngestionOutcomeStatus,
    options: IngestionOptions,
  ): IngestionOutcome {
    const stillOurs = options.isCurrent === undefined || options.isCurrent()
    if (reason === 'cancelled' && stillOurs) {
      repos.documents.markFailed(scope, documentId, 'interrupted')
      repos.jobs.fail(scope, jobId, 'interrupted')
    }
    return {
      documentId,
      jobId,
      status: reason,
      failure: reason === 'cancelled' ? 'interrupted' : null,
      chunks: 0,
      pageCount: 0,
      ocrPending: [],
    }
  }

  async function ingest (
    scope: BusinessScope,
    documentId: string,
    options: IngestionOptions = {},
  ): Promise<IngestionOutcome> {
    const document = repos.documents.get(scope, documentId)
    // A document this business does not hold is not an ingestion failure; it is an id
    // that is not here. Reporting it as `stale` would suggest a session problem.
    if (document === null) throw new StorageError('not_found')

    /*
     * A replaced document is not read again.
     *
     * `replace` deliberately removes the old document's chunks, their index and the
     * citations that quoted it, while keeping the row so an older answer can still
     * resolve its id. Re-ingesting that row would put all of it back - the content the
     * replace was asked to remove - and the person would find a file they replaced still
     * answering questions. Its stored copy is still present, so this has to be a guard
     * rather than a check that the bytes are missing.
     */
    if (document.replacedBy !== null) throw new StorageError('not_found')

    /*
     * An already-ready document is left alone. This is what makes a second click
     * harmless, and it also stops a resume sweep from re-reading a file that finished
     * just before the interruption.
     */
    if (document.status === 'ready') {
      return {
        documentId,
        jobId: null,
        status: 'ready',
        failure: null,
        chunks: repos.chunks.countForDocument(scope, documentId),
        pageCount: document.pageCount ?? 0,
        ocrPending: [],
      }
    }

    /*
     * Reuse an unfinished job rather than creating a second one. Two rows for one run
     * would let a restart resume the same document twice and report two bars for one
     * file.
     */
    const unfinished = repos.jobs.latestFor(scope, documentId)
    const job = unfinished !== null && (unfinished.status === 'queued' || unfinished.status === 'running')
      ? unfinished
      : repos.jobs.create(scope, documentId)

    const stopEarly = stopped(options)
    if (stopEarly !== null) return stoppedOutcome(scope, documentId, job.id, stopEarly, options)

    repos.jobs.start(scope, job.id)
    repos.documents.markReading(scope, documentId)

    report(scope, job.id, 'reading', options)

    const bytes = repos.documents.readBytes(scope, documentId)
    if (bytes === null) return abandon(scope, documentId, job.id, 'unreadable', options)

    /*
     * The stored `kind` was decided from the extension at upload. Checking the bytes
     * again here is what stops a file renamed to `.pdf` from reaching the PDF parser and
     * being reported as a corrupt PDF rather than an unsupported file.
     */
    const detected = detectKind(document.name, bytes)
    if (detected === null || detected !== document.kind) {
      return abandon(scope, documentId, job.id, 'unsupported', options)
    }

    const stopReading = stopped(options)
    if (stopReading !== null) return stoppedOutcome(scope, documentId, job.id, stopReading, options)

    report(scope, job.id, 'extracting', options)

    let extraction
    try {
      extraction = await extractDocument(document.kind, bytes)
    } catch (error) {
      if (!(error instanceof StorageError) && 'failure' in Object(error)) {
        return abandon(scope, documentId, job.id, documentFailure((error as { failure: ExtractionFailure }).failure), options)
      }
      throw error
    }

    const stopExtracting = stopped(options)
    if (stopExtracting !== null) return stoppedOutcome(scope, documentId, job.id, stopExtracting, options)

    const summary = summariseExtraction(extraction)

    /*
     * A document whose every page is a picture has not been read. Filing it as ready
     * with nothing in it is the failure mode this whole result shape exists to prevent:
     * the person would search for a phrase they can see on the page and find nothing,
     * with no explanation.
     */
    if (summary.entirelyUnread) {
      return abandon(scope, documentId, job.id, ocrAvailable() ? 'unreadable' : 'unsupported', options)
    }

    report(scope, job.id, 'chunking', options)

    const chunks = chunkSections(extraction.sections, options.chunking)
    if (chunks.length === 0) return abandon(scope, documentId, job.id, 'parse_failed', options)

    const stopChunking = stopped(options)
    if (stopChunking !== null) return stoppedOutcome(scope, documentId, job.id, stopChunking, options)

    report(scope, job.id, 'indexing', options)

    // The one write that lands content, and the only one that needs to be all-or-nothing:
    // it clears the previous set first, so a rerun replaces rather than duplicates.
    repos.chunks.replaceForDocument(scope, documentId, chunks.map(toChunkInput))

    const stopAfterIndexing = stopped(options)
    if (stopAfterIndexing !== null) {
      return stoppedOutcome(scope, documentId, job.id, stopAfterIndexing, options)
    }

    /*
     * Page count comes from the parser where the format has pages, and from what was
     * actually read where it does not. A spreadsheet reporting zero would make a screen
     * say "0 pages" about a document with four sheets.
     */
    const pageCount = extraction.pageCount > 0 ? extraction.pageCount : countDistinctSections(chunks)
    repos.documents.markReady(scope, documentId, pageCount)
    const completed = repos.jobs.complete(scope, job.id)

    return {
      documentId,
      jobId: completed.id,
      status: 'ready',
      failure: null,
      chunks: chunks.length,
      pageCount,
      ocrPending: summary.ocrPending,
    }
  }

  async function resumePending (
    scope: BusinessScope,
    options: IngestionOptions = {},
  ): Promise<IngestionOutcome[]> {
    const outcomes: IngestionOutcome[] = []
    for (const job of repos.jobs.listPending(scope)) {
      if (stopped(options) !== null) break
      /*
       * Each document is attempted independently. One corrupt file must not stop the
       * queue behind it, because the person waiting on the fourth file has no way to
       * know the third was the reason nothing happened.
       */
      try {
        outcomes.push(await ingest(scope, job.documentId, options))
      } catch (error) {
        if (error instanceof StorageError && error.failure === 'not_found') continue
        throw error
      }
    }
    return outcomes
  }

  return { ingest, resumePending }
}

/** The repository's input shape, so the chunker stays free of storage concerns. */
function toChunkInput (chunk: DocumentChunk): { text: string; page: number | null; section: string | null; tokens: number } {
  return { text: chunk.text, page: chunk.page, section: chunk.section, tokens: chunk.tokens }
}

/**
 * How many distinct locations a document without paging spans.
 *
 * A DOCX has headings and no pages; a spreadsheet has sheets. Counting the distinct
 * section names gives the screen a number that means "how many places this document has"
 * rather than a misleading zero.
 */
function countDistinctSections (chunks: DocumentChunk[]): number {
  const names = new Set<string>()
  for (const chunk of chunks) {
    if (chunk.section !== null) names.add(chunk.section)
  }
  return names.size
}
