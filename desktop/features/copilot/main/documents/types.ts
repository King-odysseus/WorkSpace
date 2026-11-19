/*
 * The shapes every local parser answers to, and the one place the limits live.
 *
 * Why a parser returns sections rather than a string. Section 10.3 has every answer
 * list the document and the page or section it came from, so provenance has to survive
 * extraction. A parser that joined everything into one string would throw away the
 * only thing a citation needs, and no later step could get it back. So text comes back
 * as ordered sections, each carrying the page number (for paged formats) or the
 * heading, sheet or slide name (for the rest) - or both, which a PDF with headings
 * inside it genuinely has.
 *
 * Why the section text is capped rather than trusted. A document is untrusted input.
 * A decompression bomb or a single 50 MB spreadsheet cell should end as a readable
 * failure with a bounded amount of work done, not as an exhausted heap. Every parser
 * checks its own total against `MAX_EXTRACTED_CHARS`, and the shared readers refuse a
 * file that expands past `MAX_EXPANDED_BYTES`.
 *
 * Why OCR is a declared gap rather than a silent empty page. A scanned page has no
 * text layer at all, so a text-only reader produces an empty section that looks like
 * a document with nothing in it. The result therefore counts pages that need OCR
 * separately, and the caller decides what to tell the person. Without an approved
 * engine installed, those pages are reported, never invented.
 */

/** One run of text with the location it came from. */
export interface ExtractedSection {
  /** 1-based page number for a paged format, otherwise null. */
  page: number | null
  /** The heading, sheet or slide this text sits under, otherwise null. */
  section: string | null
  text: string
}

export interface ExtractionResult {
  sections: ExtractedSection[]
  /** Pages, or slides, the format declares - 0 when the format has no paging. */
  pageCount: number
  /**
   * 1-based page numbers that hold an image instead of a text layer.
   *
   * Reported so the caller can say which pages were not read, rather than drawing an
   * empty answer for a scan the app cannot see into.
   */
  ocrPending: number[]
}

/**
 * The largest file this build will try to read, in bytes.
 *
 * 200 MB, matching the bound the document repository already enforces at upload. A
 * second, lower bound here would be a bound nobody could reason about; keeping them
 * equal means "it uploaded" and "it can be read" are the same question.
 */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024

/**
 * The most text one extraction may produce, in characters.
 *
 * 8 million characters is roughly 2 million tokens - far more than any context window
 * this build sends, but enough that a genuine 200-page report fits. The point is not
 * to fit a model; it is to keep one hostile file from turning into an unbounded
 * string that is then copied several more times on the way to being chunked.
 */
export const MAX_EXTRACTED_CHARS = 8_000_000

/**
 * The most a single archive, formula blob or compressed stream may expand to, in
 * bytes.
 *
 * A zip bomb is small on disk and enormous in memory. This is the ceiling applied
 * before decompression output is trusted, per archive entry and per stream.
 */
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024

/** Entries a single ZIP archive may hold. A DOCX has dozens; a bomb has millions. */
export const MAX_ZIP_ENTRIES = 5_000

/**
 * The most decoded content one PDF page may contribute, in bytes.
 *
 * The per-stream ceiling above is not enough on its own. A page's `/Contents` may legally
 * be an array, and nothing stops an array from naming the same stream a hundred times: each
 * name would decode that stream again in full, and only the finished page would look too
 * big. So the same number is spent across the whole page instead of being restarted for
 * each piece of it, and a page is refused once its allowance runs out.
 */
export const MAX_PAGE_DECODED_BYTES = MAX_EXPANDED_BYTES

/** The shapes a parser can fail in, as fixed tokens a screen can translate. */
export const extractionFailures = Object.freeze([
  /** This build has no reader for the file's kind. */
  'unsupported',
  /** The file would not open, or is not what its extension claims. */
  'unreadable',
  /** The file or its expansion is past the bounds above. */
  'too_large',
  /** The file opened but its contents did not make sense. */
  'parse_failed',
] as const)

export type ExtractionFailure = (typeof extractionFailures)[number]

/**
 * A parser's refusal.
 *
 * Carries a token and nothing else. A parser sees the document's own bytes, so an
 * error message built from what it was reading can quote the file - and that message
 * ends up in a log line and on a screen. The token is the only part allowed out.
 */
export class ExtractionError extends Error {
  readonly failure: ExtractionFailure

  constructor (failure: ExtractionFailure) {
    super(`document extraction failed: ${failure}`)
    this.name = 'ExtractionError'
    this.failure = failure
  }
}

/** Raise a parser refusal. */
export function refuse (failure: ExtractionFailure): never {
  throw new ExtractionError(failure)
}

/**
 * Accumulates sections while enforcing the total-text ceiling.
 *
 * Shared so every parser applies the same rule at the same moment. Collecting into a
 * plain array and checking at the end would mean the ceiling was enforced only after
 * the whole hostile document had already been held in memory.
 */
export class SectionAccumulator {
  private readonly sections: ExtractedSection[] = []
  private chars = 0

  push (section: ExtractedSection): void {
    const text = section.text.trim()
    // An empty run is not a citation target and not worth a chunk.
    if (text === '') return
    this.chars += text.length
    if (this.chars > MAX_EXTRACTED_CHARS) refuse('too_large')
    this.sections.push({ page: section.page, section: section.section, text })
  }

  /** How much text has been accepted so far, for a parser's own progress reports. */
  get length (): number {
    return this.chars
  }

  result (pageCount: number, ocrPending: number[] = []): ExtractionResult {
    return {
      sections: this.sections,
      pageCount,
      // Sorted and de-duplicated: a caller listing "pages not read" must not have to
      // reason about the order a parser happened to notice them in.
      ocrPending: [...new Set(ocrPending)].sort((a, b) => a - b),
    }
  }
}
