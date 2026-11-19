/*
 * Text, Markdown and CSV out of the bytes, as sections a citation can point at.
 *
 * Why these three live together. They are one job done three ways: decode the bytes
 * once, then decide where one section ends and the next begins. Split across three
 * files the decoding, the line-ending rule and the blank-file rule would each be
 * written three times, and a section boundary that moves between readers is a citation
 * that points at the wrong paragraph. Keeping them in one file means the rules are
 * stated once and cannot drift.
 *
 * Why an empty file is a refusal rather than a success with no sections. A text file
 * with nothing in it is far more likely to be the wrong file - a placeholder, a lock
 * file, a zero-byte export - than a document somebody wrote and expects an answer
 * about. Returning success would store a document that can never produce a chunk, and
 * the person would see a library entry that answers nothing, which reads as a bug in
 * the assistant rather than in the file.
 *
 * Why the decoding is lossy on purpose. `fatal: false` turns bytes that are not UTF-8
 * into replacement characters instead of throwing. A CSV exported from a spreadsheet in
 * a legacy Windows code page is common, and losing the odd accented letter is a far
 * better answer than refusing the whole file. A file that decodes to nothing but
 * replacement characters and control codes is a different matter: that is a binary file
 * wearing a text extension, and it is refused below.
 *
 * Why every section carries a page of `null`. None of these three formats paginate, so
 * a page number here would be invented. A citation for one of these documents names the
 * file and, for markdown, the heading it sits under.
 */

import {
  ExtractionError,
  MAX_INPUT_BYTES,
  SectionAccumulator,
  refuse,
  type ExtractionResult,
} from './types.js'

/**
 * One decoder for the whole module.
 *
 * `TextDecoder` keeps no state between calls to `decode` without `{ stream: true }`, and
 * building one per file would allocate a table of decoding data per document for no
 * benefit.
 */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: false })

/**
 * What a byte the decoder could not make sense of becomes, plus the control characters a
 * text file has no business carrying.
 *
 * A binary file renamed to `.txt` normally decodes to a mix of these: runs of U+FFFD for
 * bytes that are not valid UTF-8, and stray NULs and low control codes for the rest. A
 * real text file has tabs and line breaks and nothing else from that range, so the two
 * ranges below are exactly what nobody typed.
 */
const UNREADABLE_CHARACTERS = /[\uFFFD\u0000-\u0008\u000E-\u001F\u007F]/gu

/** An ATX heading: one to six hashes, then a space, then text that is not blank. */
const ATX_HEADING = /^(#{1,6})[ \t]+(\S.*)$/u

/** A closing run of hashes (`## Notes ##`), which is punctuation and not part of the name. */
const CLOSING_HASHES = /[ \t]+#+$/u

/** The two setext underlines, tested against the line with outer whitespace removed. */
const SETEXT_EQUALS = /^=+$/u
const SETEXT_DASHES = /^-+$/u

/* ------------------------------------------------------------------ *
 * Decoding
 * ------------------------------------------------------------------ */

/**
 * The text with one kind of line ending, and no byte-order mark.
 *
 * A BOM is normally removed by the decoder itself, and this keeps the guarantee rather
 * than depending on that: a leading U+FEFF would otherwise become the first character of
 * the first section, which is a heading that fails to match or a word that fails to
 * index. Line endings are folded to `\n` because every rule below splits on it, and a
 * file written on Windows would otherwise leave a `\r` at the end of every heading - so
 * `# Terms\r` would not match the heading pattern at all.
 *
 * One encoding is deliberately not detected. A `.txt` saved by a Windows editor as
 * "Unicode text" is UTF-16, and decoded as UTF-8 it arrives with a NUL between every
 * character: the ASCII words survive as separate letters and anything accented becomes a
 * replacement character. Guessing the encoding from the first bytes would fix that case
 * and put a second, unreviewed decoder on the widest path in the app, so the format is
 * read as the UTF-8 it is documented to be. A file that decodes to nothing readable is
 * refused rather than trusted.
 */
function normaliseText (text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return withoutBom.replace(/\r\n?/g, '\n')
}

/**
 * Refuse a file that carries nothing to read.
 *
 * Two shapes arrive here. A file that is empty or only whitespace produced no text at
 * all. And a binary file renamed to `.txt` decodes to replacement characters and control
 * codes, because none of its bytes were UTF-8 text. Checking for those characters rather
 * than for emptiness alone catches the second, and stripping them before the test means a
 * mostly readable file keeps its content: one bad byte from an old code page is not a
 * reason to refuse a document that still says something.
 */
function requireReadable (text: string): void {
  if (text.replace(UNREADABLE_CHARACTERS, '').trim() === '') refuse('parse_failed')
}

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

/** The whole file as one section. Nothing in it claims a structure to split on. */
function extractPlainText (text: string): ExtractionResult {
  const accumulator = new SectionAccumulator()
  accumulator.push({ page: null, section: null, text })
  return finish(accumulator)
}

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

/**
 * The heading text of an ATX line, or `null` when the line is not one.
 *
 * A hash run with no space after it is not a heading, in this reader or in CommonMark:
 * `#1 priority` is a sentence somebody wrote, and treating it as a heading would drop
 * that line from the body and name a section `1 priority`.
 */
function atxHeading (line: string): string | null {
  const match = ATX_HEADING.exec(line)
  if (match === null) return null
  // `(\S.*)` guarantees content, so the fallback is for the type checker, not a case.
  const text = (match[2] ?? '').trim().replace(CLOSING_HASHES, '').trim()
  return text === '' ? null : text
}

/**
 * Where the paragraph that a setext underline would attach to begins.
 *
 * A setext heading is the paragraph immediately above the underline, so that paragraph
 * has to be found from the end: the last line has to be ordinary text, and the block
 * runs back to the blank line before it. Answering `lines.length` means there is no
 * paragraph to attach to, which is how "a rule below a blank line" is told apart from a
 * heading without a second rule being needed anywhere else.
 */
function lastParagraphStart (lines: readonly string[]): number {
  let index = lines.length - 1
  while (index >= 0) {
    const line = lines[index]
    if (line === undefined || line.trim() === '') return index + 1
    index -= 1
  }
  return 0
}

/**
 * Markdown as one section per heading, plus whatever precedes the first one.
 *
 * How a run of dashes is decided, because it is the one genuinely ambiguous line in
 * markdown. `---` is a setext underline when a paragraph line sits directly above it; it
 * is a thematic break when the line above is blank, when there is no line above (the
 * first line of the file), or when the line above is itself a heading - a heading is
 * already complete and cannot be underlined. A break is punctuation rather than content,
 * so it is dropped; a run of equals with nothing to underline is kept as text, because
 * dropping something that is not a rule would lose words the author wrote.
 *
 * A setext heading whose underline is followed immediately by body text is still a
 * heading. That is the CommonMark rule, and it is the common shape in real files
 * (`Installation` / `------------` / `Run the installer.`), so the missing blank line
 * after the underline is not read as a sign that the author meant a rule.
 *
 * Two shapes are deliberately not special-cased, and both are stated here rather than
 * discovered later. YAML front matter - `---` at the top, a `title:` line, a closing
 * `---` - is read as ordinary text, so its closing dashes become a setext heading named
 * after the last front-matter line. And a rule written with spaces between its dashes
 * (`- - -`) matches neither underline pattern, so it stays in the text as written.
 * Neither appears in a business document often, and guessing wrong would move a section
 * boundary, which is worse than leaving the words where the author put them.
 */
function extractMarkdown (text: string): ExtractionResult {
  const accumulator = new SectionAccumulator()
  const lines = text.split('\n')

  let buffer: string[] = []
  let section: string | null = null

  // Everything buffered belongs to the section that was in force while it was read.
  const flush = (): void => {
    if (buffer.length === 0) return
    accumulator.push({ page: null, section, text: buffer.join('\n') })
    buffer = []
  }

  for (const line of lines) {
    const heading = atxHeading(line)
    if (heading !== null) {
      flush()
      section = heading
      // The heading line is not repeated in the body: the section name already carries
      // it, and a chunk that began with it again would be chunked under its own heading.
      continue
    }

    const trimmed = line.trim()
    const underlines = SETEXT_EQUALS.test(trimmed) || SETEXT_DASHES.test(trimmed)
    if (underlines) {
      const start = lastParagraphStart(buffer)
      if (start < buffer.length) {
        const headingText = buffer.slice(start).join(' ').trim()
        // The paragraph above the underline becomes the heading, and whatever came
        // before it is pushed under the section that was in force.
        buffer = buffer.slice(0, start)
        flush()
        section = headingText
        continue
      }
      if (SETEXT_DASHES.test(trimmed)) continue
      // A run of equals with nothing above it to underline is text, so it is kept.
    }

    buffer.push(line)
  }

  flush()
  return finish(accumulator)
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

/**
 * How many of one character appear outside quoted values on the line.
 *
 * Quoted values have to be skipped rather than counted: a header of `name;"Total, naira"`
 * contains a comma that has nothing to do with the delimiter, and counting it would make
 * a semicolon file look comma-separated - the exact mistake that turns every row into one
 * column.
 */
function unquotedCount (line: string, character: string): number {
  let count = 0
  let inQuotes = false

  for (let at = 0; at < line.length; at += 1) {
    const current = line.charAt(at)
    if (inQuotes) {
      if (current !== '"') continue
      // A doubled quote is an escaped quote and does not close the value.
      if (line.charAt(at + 1) === '"') {
        at += 1
        continue
      }
      inQuotes = false
      continue
    }
    if (current === '"') {
      inQuotes = true
      continue
    }
    if (current === character) count += 1
  }

  return count
}

/**
 * The field separator this file uses.
 *
 * The first line decides, because a header row is the most reliable statement of the
 * shape of a table and every later check would be confused by quoted values holding
 * newlines. A comma wins whenever one appears outside quotes, since a comma-separated
 * file is by far the common export; a semicolon is what a European spreadsheet writes
 * when the comma is already its decimal separator, and a tab is what a copy out of a
 * grid produces. Falling back to a comma when none of the three appears gives the same
 * one-column answer a spreadsheet would give, rather than a guess.
 */
function detectDelimiter (firstLine: string): string {
  if (unquotedCount(firstLine, ',') > 0) return ','
  if (unquotedCount(firstLine, ';') > 0) return ';'
  if (unquotedCount(firstLine, '\t') > 0) return '\t'
  return ','
}

/**
 * The rows of a delimited file, each as its list of fields.
 *
 * RFC 4180 as far as it goes: a value may be quoted, a quoted value may hold the
 * delimiter, a newline and a doubled quote standing for one quote. Two lenient choices
 * are deliberate. A quote only opens a value at the start of a field, so a stray inch
 * mark inside a name (`6" wall`) stays a character instead of swallowing every row after
 * it. And a quote inside an unquoted field stays literal for the same reason: malformed
 * input should cost the row it appears in, not the rest of the file.
 */
function parseDelimited (text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let at = 0; at < text.length; at += 1) {
    const current = text.charAt(at)

    if (inQuotes) {
      if (current === '"') {
        if (text.charAt(at + 1) === '"') {
          field += '"'
          at += 1
          continue
        }
        inQuotes = false
        continue
      }
      field += current
      continue
    }

    if (current === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (current === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (current === '"' && field === '') {
      inQuotes = true
      continue
    }
    field += current
  }

  // The last field and row are only ended by the end of the file, not by a newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/**
 * CSV as one section, one line per row, fields joined by a tab.
 *
 * A tab rather than a comma because the text is now prose for a reader and a search
 * index, and the field boundary is still visible: re-emitting the delimiter would make a
 * quoted comma indistinguishable from a column break. An entirely empty row is dropped,
 * which is what a trailing newline and a sparse export both produce, and a row that held
 * only whitespace goes with it - neither is a line anybody wrote.
 */
function extractCsv (text: string): ExtractionResult {
  const breakAt = text.indexOf('\n')
  const firstLine = breakAt < 0 ? text : text.slice(0, breakAt)
  const delimiter = detectDelimiter(firstLine)

  const lines: string[] = []
  for (const row of parseDelimited(text, delimiter)) {
    if (row.every((field) => field.trim() === '')) continue
    lines.push(row.join('\t'))
  }

  const accumulator = new SectionAccumulator()
  accumulator.push({ page: null, section: null, text: lines.join('\n') })
  return finish(accumulator)
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * The result for a format with no paging, refusing a file that produced no text.
 *
 * The ceiling check on the way out is the accumulator's, but "accepted nothing at all"
 * is only visible here: a CSV of nothing but commas passes the readable check - it is
 * not whitespace - and would otherwise succeed with an empty section list, which is the
 * same dead document the blank-file rule exists to prevent.
 */
function finish (accumulator: SectionAccumulator): ExtractionResult {
  if (accumulator.length === 0) refuse('parse_failed')
  return accumulator.result(0)
}

function extract (bytes: Uint8Array, kind: 'txt' | 'md' | 'csv'): ExtractionResult {
  if (!(bytes instanceof Uint8Array)) refuse('unreadable')
  /*
   * The size is checked before anything decodes a byte. Decoding first and refusing
   * later would mean the ceiling only existed on paper: the string would already have
   * been allocated, at twice the size of the file for text that is not ASCII.
   */
  if (bytes.length > MAX_INPUT_BYTES) refuse('too_large')

  const text = normaliseText(UTF8_DECODER.decode(bytes))
  requireReadable(text)

  switch (kind) {
    case 'txt':
      return extractPlainText(text)
    case 'md':
      return extractMarkdown(text)
    case 'csv':
      return extractCsv(text)
    default:
      // A caller outside TypeScript can still name a kind this file does not read.
      return refuse('unsupported')
  }
}

/**
 * The text of a plain text, markdown or CSV file.
 *
 * Never throws anything but `ExtractionError`. A decoder surprise, a `RangeError` from a
 * slice or a stack overflow on a pathological file all become `parse_failed`, so the
 * caller has one kind of failure to handle and no document-shaped string can reach a
 * log line through an error message.
 */
export function extractText (bytes: Uint8Array, kind: 'txt' | 'md' | 'csv'): ExtractionResult {
  try {
    return extract(bytes, kind)
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    refuse('parse_failed')
  }
}
