/*
 * The one seam through which a scanned page could ever become text.
 *
 * Why this is a seam and not an implementation. Reading text out of a picture needs an
 * optical character recognition engine, which means either a native binary or a trained
 * model shipped with the app. That is a dependency, and this project does not add
 * dependencies without asking. So the shape is defined here, the answer is honest by
 * default, and the day an engine is approved it plugs in without touching any parser.
 *
 * Why "no engine" is a first-class answer rather than an error. A scanned page and a
 * blank page look identical to a reader that only understands a text layer. Saying "no
 * engine" lets the ingestion path tell a person "this page is a picture and cannot be
 * read" instead of handing them a document that silently has nothing in it. The two are
 * completely different things to the person holding the file.
 *
 * Why the engine is registered rather than imported. A parser that imported an engine
 * directly could not be run in a build where the engine is absent, which is exactly the
 * build that has to keep working. Registration keeps the dependency at the edge.
 */

/** What an engine must do: image bytes in, the words on the page out. */
export interface OcrEngine {
  /** A short name, recorded with the extracted text so a result can be explained. */
  readonly name: string
  /**
   * Read one page.
   *
   * Rejects when the page cannot be read. The caller turns any rejection into the fixed
   * `unreadable` token, so an engine's error text - which can quote what it was looking
   * at - never travels further.
   */
  read: (image: Uint8Array) => Promise<string>
}

let registered: OcrEngine | null = null

/**
 * Offer an engine to the app.
 *
 * Deliberately a plain setter with no runtime check beyond the shape: there is exactly
 * one call site today (nothing), and the only plausible future caller is the app's own
 * start-up after an approval. A registry with priorities would be machinery for a
 * choice nobody has to make yet.
 */
export function registerOcrEngine (engine: OcrEngine | null): void {
  registered = engine
}

/** The engine this build can use, or null. */
export function currentOcrEngine (): OcrEngine | null {
  return registered
}

/**
 * Whether a scanned page can be read at all in this build.
 *
 * Callers use this to choose their wording before they start, rather than discovering
 * it halfway through a document and reporting a failure for something predictable.
 */
export function ocrAvailable (): boolean {
  return registered !== null
}
