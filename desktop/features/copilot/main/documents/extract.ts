/*
 * One door into the parsers.
 *
 * Why a dispatcher rather than each caller choosing. The document's stored `kind` is a
 * claim made from the file's extension at upload time, and a wrong claim should be
 * caught once, in one place, rather than in five call sites that each have to remember
 * to check it. Everything downstream - the ingestion stages, the tests, a future
 * re-index button - asks for "this kind of file" and gets the same answer.
 *
 * Why this is async even though only one branch waits. Reading a picture waits on an
 * optical character recognition engine, which is asynchronous; the other branches
 * finish immediately. Making the whole door async keeps one signature, so a caller
 * never has to know which formats happen to be slow this build. The alternative is a
 * sync door that quietly cannot do images, which is a trap for whoever wires the engine
 * up later.
 *
 * Why an unknown error becomes `parse_failed`. The parsers are written to refuse with a
 * token, but a parser is the code that reads hostile bytes, and one unexpected throw
 * there must not become a raw stack trace on a screen - nor a message quoting the file.
 * The token is the only thing that leaves.
 */

import type { DocumentKind } from '../../shared/storage-contract.js'
import { ExtractionError, MAX_INPUT_BYTES, refuse, type ExtractionResult } from './types.js'
import { currentOcrEngine } from './ocr.js'
import { extractPdf } from './pdf.js'
import { extractDocx, extractPptx, extractXlsx } from './office.js'
import { extractText } from './text.js'

/** What a caller gets told about a result that read no text at all. */
export interface ExtractionSummary {
  /** Characters of text found, so a caller can tell "empty" from "unreadable". */
  characters: number
  /** Pages that are pictures rather than text, and so were not read. */
  ocrPending: number[]
  /** True when every page this format has is a picture. */
  entirelyUnread: boolean
}

/**
 * Read one document.
 *
 * Refuses with `unsupported` for an image when no engine is installed, rather than
 * returning an empty result - an image with no engine genuinely cannot be read, and an
 * empty document is a different fact.
 */
export async function extractDocument (kind: DocumentKind, bytes: Uint8Array): Promise<ExtractionResult> {
  if (bytes.length === 0) refuse('unreadable')
  if (bytes.length > MAX_INPUT_BYTES) refuse('too_large')

  try {
    switch (kind) {
      case 'pdf':
        return extractPdf(bytes)
      case 'docx':
        return extractDocx(bytes)
      case 'xlsx':
        return extractXlsx(bytes)
      case 'pptx':
        return extractPptx(bytes)
      case 'txt':
      case 'md':
      case 'csv':
        return extractText(bytes, kind)
      case 'image':
        return await extractImage(bytes)
      default: {
        /*
         * `kind` is a union of eight literals, so this arm is unreachable unless the
         * contract grows a ninth without a parser. Saying `unsupported` is then the
         * exactly right answer rather than a type error at runtime.
         */
        return refuse('unsupported')
      }
    }
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    throw new ExtractionError('parse_failed')
  }
}

/**
 * A single picture.
 *
 * The page count is 1 and the location is unset: a photograph of a receipt has no
 * page numbers, and inventing "page 1" for it would put a citation on screen that
 * points at a page the person cannot turn to.
 */
async function extractImage (bytes: Uint8Array): Promise<ExtractionResult> {
  const engine = currentOcrEngine()
  // No engine means no reading. Reported as a page needing OCR so the caller can say
  // which document, rather than failing with a message that names no location.
  if (engine === null) return { sections: [], pageCount: 1, ocrPending: [1] }

  let text: string
  try {
    text = await engine.read(bytes)
  } catch {
    // The engine's own message can quote what it was looking at, so it stops here.
    throw new ExtractionError('unreadable')
  }

  const trimmed = text.trim()
  // An engine that returns nothing has read a picture with no words in it. That is an
  // empty document, not a successful read.
  if (trimmed === '') return { sections: [], pageCount: 1, ocrPending: [1] }
  return { sections: [{ page: null, section: null, text: trimmed }], pageCount: 1, ocrPending: [] }
}

/**
 * Judge a result before the caller decides what to tell the person.
 *
 * Kept here rather than in the ingestion so the rule is testable on its own: a document
 * whose every page is a picture is not "read successfully with no text", it is
 * unreadable in this build, and the difference is what stops a scan from being filed as
 * an empty file.
 */
export function summariseExtraction (result: ExtractionResult): ExtractionSummary {
  const characters = result.sections.reduce((total, section) => total + section.text.length, 0)
  const pages = Math.max(result.pageCount, result.ocrPending.length)
  return {
    characters,
    ocrPending: result.ocrPending,
    entirelyUnread: characters === 0 && result.ocrPending.length > 0 && result.ocrPending.length >= pages,
  }
}
