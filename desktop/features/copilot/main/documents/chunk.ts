/*
 * Turning an extracted document into the passages that will be indexed and cited.
 *
 * Why a chunk never crosses a page or a heading. Section 10.3 has every answer cite the
 * page or section it came from. A chunk holding the end of page 4 and the start of page
 * 5 has two true answers and no way to choose between them, so the citation would be
 * either half wrong or hedged into uselessness. Splitting at those boundaries costs a
 * few short chunks and buys citations that can be trusted.
 *
 * Why the sizes are what they are. The plan asks for roughly 500 to 800 tokens with
 * overlap. Below about 500 a passage carries too little surrounding context for a model
 * to answer from without guessing; above about 800 it starts crowding other passages out
 * of the context window while still being cited as one location. Overlap exists because
 * a sentence that answers a question often straddles a boundary, and without it both
 * halves of that sentence are separately unhelpful.
 *
 * Why overlap never crosses a boundary either. The overlap is a copy of the previous
 * chunk's tail, so an overlap taken across a page break would put page 4's words into a
 * chunk citing page 5 - exactly the problem the first rule exists to prevent.
 *
 * Why an over-long sentence is split at all. A real document occasionally contains a
 * paragraph, table dump or legal clause with no full stop for thousands of characters.
 * Left whole it becomes one chunk far past the ceiling, so it is cut at word boundaries
 * rather than allowed to be unindexable.
 */

import { estimateTextTokens } from '../../shared/providers/tokens.js'
import type { ExtractedSection } from './types.js'

/** One passage, as the chunk repository stores it. */
export interface DocumentChunk {
  text: string
  page: number | null
  section: string | null
  tokens: number
}

export interface ChunkingOptions {
  /** Where a chunk closes if nothing forces it earlier. */
  targetTokens: number
  /** The ceiling one chunk may reach before it is closed regardless. */
  maxTokens: number
  /** How much of the previous chunk is repeated at the start of the next. */
  overlapTokens: number
}

export const DEFAULT_CHUNKING: Readonly<ChunkingOptions> = Object.freeze({
  targetTokens: 650,
  maxTokens: 800,
  overlapTokens: 80,
})

/** Paragraph, then sentence, then a hard cut: the three ways text is divided. */
const PARAGRAPH_BREAK = /\n\s*\n+/
const SENTENCE_BREAK = /(?<=[.!?])\s+|\n/

/**
 * Divide one section into the smallest sensible pieces.
 *
 * Paragraphs first, because a table row or a bullet should stay whole; then sentences,
 * because a long paragraph is still a single thought only up to its full stops. Pieces
 * longer than the ceiling are cut at a space near the limit rather than mid-word, since
 * a keyword index built from half-words finds nothing.
 */
function splitUnits (text: string, maxTokens: number): string[] {
  const limit = Math.max(1, maxTokens) * 4
  const units: string[] = []

  for (const paragraph of text.split(PARAGRAPH_BREAK)) {
    const trimmed = paragraph.trim()
    if (trimmed === '') continue

    for (const sentence of trimmed.split(SENTENCE_BREAK)) {
      const piece = sentence.trim()
      if (piece === '') continue

      if (piece.length <= limit) {
        units.push(piece)
        continue
      }

      /*
       * Cut a run with no sentence break at all. `slice` from the last space before the
       * limit keeps whole words; the `indexOf` guard covers a run of characters with no
       * space in it, which would otherwise never advance.
       */
      let rest = piece
      while (rest.length > limit) {
        const cut = rest.lastIndexOf(' ', limit)
        const at = cut > 0 ? cut : limit
        units.push(rest.slice(0, at).trim())
        rest = rest.slice(at).trim()
      }
      if (rest !== '') units.push(rest)
    }
  }

  return units
}

/**
 * The tail of a chunk, up to a token budget, starting at a word boundary.
 *
 * Starting at a word boundary matters: an overlap taken from the middle of a word
 * produces a chunk whose first characters are a fragment, which then indexes a word that
 * appears nowhere in the document.
 */
function overlapTail (text: string, overlapTokens: number): string {
  const budget = Math.max(0, overlapTokens) * 4
  if (budget === 0) return ''

  // Never take more than the chunk has; a chunk shorter than the overlap budget is
  // repeated whole rather than producing a negative index.
  const sliced = text.length <= budget ? text : text.slice(text.length - budget)
  const space = sliced.indexOf(' ')
  if (text.length > budget && space >= 0) return sliced.slice(space + 1).trim()
  return sliced.trim()
}

/**
 * Chunk every section of one document, in document order.
 *
 * Returns chunks carrying the section's page and heading, so the caller can store them
 * without re-deriving where each passage belongs.
 */
export function chunkSections (
  sections: ExtractedSection[],
  options: Partial<ChunkingOptions> = {},
): DocumentChunk[] {
  const settings: ChunkingOptions = { ...DEFAULT_CHUNKING, ...options }
  if (settings.maxTokens < 1) throw new Error('chunking needs a positive maxTokens')
  if (settings.targetTokens > settings.maxTokens) {
    throw new Error('chunking target cannot exceed the maximum')
  }

  const chunks: DocumentChunk[] = []

  for (const section of sections) {
    const units = splitUnits(section.text, settings.maxTokens)
    if (units.length === 0) continue

    let parts: string[] = []
    let tokens = 0
    let previousText = ''

    const close = (): void => {
      if (parts.length === 0) return
      const text = parts.join(' ').trim()
      if (text === '') {
        parts = []
        tokens = 0
        return
      }
      chunks.push({ text, page: section.page, section: section.section, tokens: estimateTextTokens(text) })
      previousText = text
      parts = []
      tokens = 0
    }

    for (const unit of units) {
      const unitTokens = estimateTextTokens(unit)

      /*
       * Close before adding when the unit would break the ceiling - but only if there is
       * something to close. A single unit larger than the ceiling has already been cut
       * by `splitUnits`, so this cannot loop with an empty `parts`.
       */
      if (tokens > 0 && tokens + unitTokens > settings.maxTokens) close()

      if (tokens === 0 && previousText !== '') {
        const tail = overlapTail(previousText, settings.overlapTokens)
        /*
         * The overlap is only added when the unit still fits under the ceiling with it.
         * Without this check a chunk of a long paragraph would arrive at the ceiling and
         * then the overlap would push it past - so `maxTokens` would be a target for the
         * new text rather than a bound on what is actually stored and sent.
         */
        if (tail !== '' && unitTokens + estimateTextTokens(tail) <= settings.maxTokens) {
          parts.push(tail)
          tokens += estimateTextTokens(tail)
        }
      }

      parts.push(unit)
      tokens += unitTokens

      if (tokens >= settings.targetTokens) close()
    }

    close()
  }

  return chunks
}
