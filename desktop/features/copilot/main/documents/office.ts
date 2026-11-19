/*
 * Text out of DOCX, XLSX and PPTX, from the XML inside the ZIP they already are.
 *
 * Why one file for three formats. All three are the same container holding a small fan
 * of parts, and the hard part is identical: open the archive, follow a relationship to
 * find the part that actually holds the content, then walk XML looking for text runs.
 * Written separately that is three chances to get relationships wrong, and relationships
 * are exactly where these formats punish a reader: `worksheets/sheet1.xml` is not
 * necessarily the first tab, and `slides/slide2.xml` is not necessarily the second
 * slide. Every ordering below therefore comes from the package's own description of
 * itself, never from a file name.
 *
 * Why a hand-written scanner rather than an XML parser. These documents are untrusted
 * input, so this sits on the widest exposure path in the app. A scanner that only knows
 * how to find a tag, its attributes and the text between tags is short enough to read in
 * one sitting, allocates per element rather than per document, and cannot be talked into
 * entity expansion or an external lookup. The one thing it must get right is entities,
 * and they are decoded in exactly one place.
 *
 * Why the text comes back as sections. Section 10.3 has every answer cite the document
 * and the heading, sheet or slide it came from, so the structure is kept rather than
 * flattened: a DOCX gives one section per heading, an XLSX one per sheet, a PPTX one per
 * slide. That is the coarsest grouping that still matches how a person looks something
 * up, and the caller can split further but could never put it back.
 */

import {
  ExtractionError,
  SectionAccumulator,
  refuse,
  type ExtractionResult,
} from './types.js'
import { readZip, zipText, type ZipEntry } from './zip.js'

/* ------------------------------------------------------------------ *
 * A small XML scanner
 * ------------------------------------------------------------------ */

/**
 * One tag, as written.
 *
 * `name` keeps its prefix, because an attribute does and a caller has to be able to name
 * `r:id` without matching a plain `id`. Element matching below uses the local name
 * instead, so a part written with a different prefix still reads.
 */
interface XmlTag {
  name: string
  attributes: Record<string, string>
  closing: boolean
  selfClosing: boolean
}

interface XmlVisitor {
  open: (tag: XmlTag) => void
  close: (name: string) => void
  text: (text: string) => void
}

/** The part of a qualified name after its last colon: `w:p` reads as `p`. */
function localName (name: string): string {
  const colon = name.lastIndexOf(':')
  return colon < 0 ? name : name.slice(colon + 1)
}

function isSpace (character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

/**
 * Where the tag opened at `from` ends, or -1.
 *
 * A `>` inside a quoted attribute value is legal and does appear in these files, so the
 * scan has to know when it is inside quotes. Ending the tag at the first `>` would cut a
 * value in half and leave the rest of the element as text.
 */
function tagEnd (xml: string, from: number): number {
  let quote = ''
  for (let at = from + 1; at < xml.length; at += 1) {
    const character = xml.charAt(at)
    if (quote !== '') {
      if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return at
  }
  return -1
}

/**
 * One tag's name and attributes, from the text between its angle brackets.
 *
 * `null` when there is no name at all, which is what `<>` and a stray `</>` produce.
 * Moving on beats refusing the document: one malformed tag in a two hundred page
 * report should cost that tag, not the report.
 */
function parseTag (source: string): XmlTag | null {
  let at = 0
  const closing = source.charAt(0) === '/'
  if (closing) at += 1
  while (at < source.length && isSpace(source.charAt(at))) at += 1

  let nameEnd = at
  while (nameEnd < source.length) {
    const character = source.charAt(nameEnd)
    if (isSpace(character) || character === '/') break
    nameEnd += 1
  }
  if (nameEnd === at) return null

  const name = source.slice(at, nameEnd)
  at = nameEnd

  const attributes: Record<string, string> = {}
  let selfClosing = false

  while (at < source.length) {
    const character = source.charAt(at)
    if (isSpace(character)) {
      at += 1
      continue
    }
    if (character === '/') {
      selfClosing = true
      at += 1
      continue
    }

    let keyEnd = at
    while (keyEnd < source.length) {
      const candidate = source.charAt(keyEnd)
      if (candidate === '=' || candidate === '/' || isSpace(candidate)) break
      keyEnd += 1
    }
    if (keyEnd === at) {
      // A character that starts neither a name nor a terminator. Stepping over it is
      // the only way to avoid looping on the same position for ever.
      at += 1
      continue
    }

    const key = source.slice(at, keyEnd)
    at = keyEnd
    while (at < source.length && isSpace(source.charAt(at))) at += 1

    if (source.charAt(at) !== '=') {
      // A valueless attribute is legal-shaped XML for the formats that use booleans.
      // Storing it as empty keeps the name addressable without inventing a value.
      attributes[key] = ''
      continue
    }

    at += 1
    while (at < source.length && isSpace(source.charAt(at))) at += 1

    const quote = source.charAt(at)
    if (quote === '"' || quote === "'") {
      at += 1
      const valueEnd = source.indexOf(quote, at)
      const stop = valueEnd < 0 ? source.length : valueEnd
      attributes[key] = decodeEntities(source.slice(at, stop))
      at = stop + 1
      continue
    }

    let valueEnd = at
    while (valueEnd < source.length && !isSpace(source.charAt(valueEnd))) valueEnd += 1
    attributes[key] = decodeEntities(source.slice(at, valueEnd))
    at = valueEnd
  }

  return { name, attributes, closing, selfClosing }
}

/**
 * Walk one XML part, reporting every tag and the text between tags.
 *
 * A self-closing tag is reported as an open followed by a close, with nothing in
 * between. That single decision is why the parsers below have no special case for
 * `<w:t/>` or `<c r="A1"/>`: their state machines are opened and closed by the same
 * visitors either way, so a self-closing element cannot leave a flag set.
 */
function walkXml (xml: string, visit: Partial<XmlVisitor>): void {
  let at = 0

  while (at < xml.length) {
    const lt = xml.indexOf('<', at)
    if (lt < 0) {
      visit.text?.(decodeEntities(xml.slice(at)))
      return
    }
    if (lt > at) visit.text?.(decodeEntities(xml.slice(at, lt)))

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      at = end < 0 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      // CDATA is literal text by definition, so no entity decoding applies to it.
      visit.text?.(xml.slice(lt + 9, end < 0 ? xml.length : end))
      at = end < 0 ? xml.length : end + 3
      continue
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2)
      at = end < 0 ? xml.length : end + 2
      continue
    }
    if (xml.startsWith('<!', lt)) {
      // A doctype or other declaration. Its internal subset may hold a `>` inside
      // brackets, but no Office part ships one, so the first `>` ends it.
      const end = xml.indexOf('>', lt + 2)
      at = end < 0 ? xml.length : end + 1
      continue
    }

    const end = tagEnd(xml, lt)
    if (end < 0) {
      // A `<` that never closes is not a tag. Treating the remainder as text loses one
      // stray character instead of every paragraph after it.
      visit.text?.(decodeEntities(xml.slice(lt)))
      return
    }

    const tag = parseTag(xml.slice(lt + 1, end))
    if (tag !== null) {
      if (tag.closing) visit.close?.(tag.name)
      else {
        visit.open?.(tag)
        if (tag.selfClosing) visit.close?.(tag.name)
      }
    }
    at = end + 1
  }
}

/* ------------------------------------------------------------------ *
 * Entities and attributes
 * ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/**
 * XML text with its entity references replaced, in one pass.
 *
 * One pass rather than a chain of replaces, so `&amp;lt;` becomes the text `&lt;` and
 * not `<`: a document that wants to show an entity has to be able to. Numeric
 * references are decoded because a typed pound sign or a curly quote arrives that way.
 * An unrecognised name is left exactly as it was - deleting it would lose text, and
 * inventing a mapping for an entity this build has never heard of would be worse.
 */
function decodeEntities (text: string): string {
  if (!text.includes('&')) return text
  return text.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole: string, body: string) => {
      if (body.charAt(0) === '#') {
        const hexadecimal = body.charAt(1) === 'x' || body.charAt(1) === 'X'
        const code = Number.parseInt(hexadecimal ? body.slice(2) : body.slice(1), hexadecimal ? 16 : 10)
        // A code point outside Unicode, or a lone surrogate, has no character to be.
        if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return whole
        if (code >= 0xd800 && code <= 0xdfff) return whole
        return String.fromCodePoint(code)
      }
      const known = ENTITIES[body]
      return known === undefined ? whole : known
    },
  )
}

/**
 * An attribute by the name it is written with, falling back to its local name.
 *
 * The exact name is tried first so `r:id` and `id` on the same element cannot be
 * confused, which `p:sldId` genuinely carries. The fallback is there for a writer that
 * prefixes relationships differently, which the namespace rules allow.
 */
function attr (tag: XmlTag, name: string): string | null {
  const direct = tag.attributes[name]
  if (direct !== undefined) return direct
  const local = localName(name)
  for (const [key, value] of Object.entries(tag.attributes)) {
    if (localName(key) === local) return value
  }
  return null
}

/* ------------------------------------------------------------------ *
 * Parts and relationships
 * ------------------------------------------------------------------ */

interface Relationship {
  /** The full type URL. Only its trailing part is read, and only to tell kinds apart. */
  type: string
  target: string
}

/** Every followable relationship in one `.rels` part, keyed by its id. */
function readRelationships (xml: string): Map<string, Relationship> {
  const found = new Map<string, Relationship>()
  walkXml(xml, {
    open: (tag) => {
      if (localName(tag.name) !== 'Relationship') return
      const id = attr(tag, 'Id')
      const target = attr(tag, 'Target')
      // No id means nothing can reach through it; no target means it points nowhere.
      // Neither can be followed, so neither is kept.
      if (id === null || target === null) return
      found.set(id, { type: attr(tag, 'Type') ?? '', target })
    },
  })
  return found
}

/**
 * A part's path inside the archive, resolved from a relationship target.
 *
 * Done by hand rather than with `node:path`: part names always use forward slashes and
 * are always relative to the package root, so on Windows `path.join` would produce
 * `ppt\slides\slide1.xml` and no archive entry would ever match.
 */
function partPath (base: string, target: string): string {
  const decoded = decodePartPath(target)
  if (decoded.startsWith('/')) return resolvePartPath(decoded.slice(1))
  return resolvePartPath(`${base}/${decoded}`)
}

/** `..` and `.` segments removed, so a target and an entry name can be compared. */
function resolvePartPath (path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/**
 * A target with its percent-escapes removed.
 *
 * A part whose name contains a space is written as `my%20part.xml` in the target but
 * stored under its real name in the archive, so the escape has to come off before the
 * two can match.
 */
function decodePartPath (target: string): string {
  if (!target.includes('%')) return target
  try {
    return decodeURIComponent(target)
  } catch {
    // A `%` that is not an escape. The raw target is what the writer meant closely
    // enough to try, and refusing a whole workbook over punctuation in one part name
    // would be the worse answer.
    return target
  }
}

/** The directory of a part path, or '' at the root. */
function dirOf (path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

/** The last segment of a part path. */
function nameOf (path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

/**
 * Styles that begin a new section.
 *
 * Word's built-in heading styles are `Heading1` to `Heading9`, and a document's opening
 * line is usually `Title`. Matching all of them is what a reader expects of "the heading
 * this text sits under"; matching only the first three would put a Heading4 paragraph in
 * the section above it.
 */
const HEADING_STYLE = /^(?:title|subtitle|heading[1-9])$/i

/**
 * Word's main document part.
 *
 * Text inside `<w:t>` is document text; `<w:instrText>` (field instructions) and
 * `<w:delText>` (text removed in a tracked change) are deliberately not matched, because
 * neither is a word the person wrote to be read.
 */
export function extractDocx (bytes: Uint8Array): ExtractionResult {
  return guarded(() => {
    const archive = readZip(bytes)
    const xml = zipText(archive, 'word/document.xml')

    const accumulator = new SectionAccumulator()
    let section: string | null = null
    let lines: string[] = []
    let paragraph: string[] = []
    let inText = false
    let nextParagraphHeading = false

    const flush = (): void => {
      if (lines.length === 0) return
      accumulator.push({ page: null, section, text: lines.join('\n') })
      lines = []
    }

    walkXml(xml, {
      open: (tag) => {
        const name = localName(tag.name)
        if (name === 'p') {
          paragraph = []
          return
        }
        if (name === 'pStyle') {
          const style = attr(tag, 'w:val')
          if (style !== null && HEADING_STYLE.test(style)) nextParagraphHeading = true
          return
        }
        if (name === 't') {
          inText = true
          return
        }
        if (name === 'tab') {
          paragraph.push('\t')
          return
        }
        if (name === 'br') paragraph.push('\n')
      },
      close: (name) => {
        const local = localName(name)
        if (local === 't') {
          inText = false
          return
        }
        if (local !== 'p') return

        const text = paragraph.join('').trim()
        paragraph = []
        // A heading style on an empty paragraph must not carry to the next one, so the
        // flag is cleared whichever way this paragraph goes.
        const heading = nextParagraphHeading
        nextParagraphHeading = false
        if (text === '') return

        if (heading) {
          flush()
          section = text
          // The heading line is part of what it heads. Dropping it would lose the one
          // sentence a heading-only section still has.
          lines = [text]
          return
        }
        lines.push(text)
      },
      text: (text) => {
        if (inText) paragraph.push(text)
      },
    })

    flush()
    // A DOCX has no fixed pages; pagination belongs to whatever renders it.
    return finished(accumulator, 0)
  })
}

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

const SPREADSHEET_MAIN = 'xl'

interface SheetRef {
  name: string
  /** The relationship this sheet's part is reached through. */
  relId: string
}

/**
 * The workbook's tabs, in the order it declares them.
 *
 * The `r:id` is required rather than guessed at. A missing one is a workbook that named
 * a tab it did not describe, and the only alternative is to assume `sheetN.xml` by
 * position - which is precisely the assumption that shows one workbook's numbers under
 * another workbook's sheet name.
 */
function readSheetRefs (xml: string): SheetRef[] {
  const sheets: SheetRef[] = []
  walkXml(xml, {
    open: (tag) => {
      if (localName(tag.name) !== 'sheet') return
      const relId = attr(tag, 'r:id')
      if (relId === null) refuse('parse_failed')
      // A tab with no name is still a tab; the position is a better label than nothing,
      // and a section is a citation target that should not be empty.
      sheets.push({ name: attr(tag, 'name') ?? `Sheet ${sheets.length + 1}`, relId })
    },
  })
  return sheets
}

/**
 * The text of every `<si>` or `<is>` item in a part, in order.
 *
 * Both kinds of item hold the same shape: optional `<t>` runs, plus `<rPh>` phonetic
 * hints that spell out how the value is pronounced. The hints are a Japanese and Chinese
 * input aid, never part of the value, so a cell whose value is `Abuja` must not read
 * `AbujaAbuja` because a pronunciation was stored beside it.
 */
function readStringItems (xml: string): string[] {
  const items: string[] = []
  let current: string[] | null = null
  let phonetic = 0
  let inText = false

  walkXml(xml, {
    open: (tag) => {
      const name = localName(tag.name)
      if (name === 'si' || name === 'is') {
        current = []
        return
      }
      if (name === 'rPh') {
        phonetic += 1
        return
      }
      if (name === 't') inText = true
    },
    close: (name) => {
      const local = localName(name)
      if (local === 'si' || local === 'is') {
        // A self-closing item arrives as an open and a close, which is an empty string:
        // a real shared-string entry that means "nothing".
        if (current !== null) items.push(current.join(''))
        current = null
        return
      }
      if (local === 'rPh') {
        if (phonetic > 0) phonetic -= 1
        return
      }
      if (local === 't') inText = false
    },
    text: (text) => {
      if (inText && phonetic === 0 && current !== null) current.push(text)
    },
  })

  return items
}

/** A cell as it is being assembled: its pieces arrive as separate tags. */
interface CellState {
  column: number
  /** The `t` attribute, lower-cased, or '' for the default numeric form. */
  type: string
  stored: string[]
  inline: string[]
  inValue: boolean
  inText: boolean
  phonetic: number
}

/**
 * The 0-based column of a cell reference such as `B2`, or null when it names none.
 *
 * A reference past the last column a worksheet can hold is not a reference, so the
 * caller falls back to the position after the previous cell rather than building an
 * array sixteen thousand entries wide from a typo.
 */
function columnOf (reference: string | null): number | null {
  if (reference === null) return null
  let column = 0
  let letters = 0
  for (let at = 0; at < reference.length; at += 1) {
    const code = reference.charCodeAt(at)
    const upper = code >= 65 && code <= 90 ? code : code >= 97 && code <= 122 ? code - 32 : 0
    if (upper === 0) break
    column = column * 26 + (upper - 64)
    letters += 1
    if (column > 16_384) return null
  }
  return letters === 0 ? null : column - 1
}

/** What a finished cell contributes, once its type says how to read the stored value. */
function cellValue (cell: CellState, shared: string[]): string {
  const stored = cell.stored.join('').trim()

  if (cell.type === 's') {
    const index = Number.parseInt(stored, 10)
    // An index into a table that has no such row is a broken workbook. One blank cell is
    // an honest answer for it; refusing the sheet would lose the rows that are fine.
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) return ''
    const text = shared[index]
    return text === undefined ? '' : text.trim()
  }

  if (cell.type === 'inlinestr') return cell.inline.join('').trim()

  if (cell.type === 'b') return stored === '1' ? 'TRUE' : stored === '0' ? 'FALSE' : stored

  // A formula's cached string (`str`), a date's serial (`d`), an error token (`e`) and a
  // plain number all read as the text the file stored.
  return stored
}

/**
 * One worksheet's rows, as lines of tab-separated cells.
 *
 * Cells are placed by their `r` reference rather than by the order they arrive, so a row
 * with a gap reads on screen the way it reads in the sheet: `B5` alone produces a line
 * that starts with a tab. Losing the gap would line a number up under the wrong heading.
 */
function readSheetLines (xml: string, shared: string[]): string[] {
  const lines: string[] = []
  let cells: string[] = []
  let nextColumn = 0
  let cell: CellState | null = null

  const finishCell = (): void => {
    const building = cell
    if (building === null) return
    const value = cellValue(building, shared)
    if (value !== '') cells[building.column] = value
    nextColumn = building.column + 1
    cell = null
  }

  const finishRow = (): void => {
    if (cells.length > 0) lines.push(cells.join('\t'))
    cells = []
    nextColumn = 0
  }

  walkXml(xml, {
    open: (tag) => {
      const name = localName(tag.name)
      if (name === 'row') {
        cells = []
        nextColumn = 0
        cell = null
        return
      }
      if (name === 'c') {
        cell = {
          column: columnOf(attr(tag, 'r')) ?? nextColumn,
          type: (attr(tag, 't') ?? '').toLowerCase(),
          stored: [],
          inline: [],
          inValue: false,
          inText: false,
          phonetic: 0,
        }
        return
      }
      if (cell === null) return
      if (name === 'v') {
        cell.inValue = true
        return
      }
      if (name === 't') {
        cell.inText = true
        return
      }
      if (name === 'rPh') cell.phonetic += 1
    },
    close: (name) => {
      const local = localName(name)
      if (local === 'c') {
        finishCell()
        return
      }
      if (local === 'row') {
        finishRow()
        return
      }
      if (cell === null) return
      if (local === 'v') {
        cell.inValue = false
        return
      }
      if (local === 't') {
        cell.inText = false
        return
      }
      if (local === 'rPh' && cell.phonetic > 0) cell.phonetic -= 1
    },
    text: (text) => {
      if (cell === null) return
      if (cell.inValue) {
        cell.stored.push(text)
        return
      }
      if (cell.inText && cell.phonetic === 0) cell.inline.push(text)
    },
  })

  return lines
}

/**
 * A workbook, one section per tab and one line per non-empty row.
 *
 * `pageCount` is the number of tabs rather than the number of sheets that yielded text:
 * a person comparing the app's count with the workbook's tab bar expects the same
 * number, and an empty tab is still a tab.
 */
export function extractXlsx (bytes: Uint8Array): ExtractionResult {
  return guarded(() => {
    const archive = readZip(bytes)
    const workbook = zipText(archive, 'xl/workbook.xml')
    const relationships = readRelationships(zipText(archive, 'xl/_rels/workbook.xml.rels'))

    // Optional: a workbook that has never held a piece of text has no such part, and
    // `zipText` would refuse one that is merely absent rather than broken.
    const shared = archive.has('xl/sharedStrings.xml')
      ? readStringItems(zipText(archive, 'xl/sharedStrings.xml'))
      : []

    const sheets = readSheetRefs(workbook)
    const accumulator = new SectionAccumulator()

    for (const sheet of sheets) {
      const relationship = relationships.get(sheet.relId)
      // The workbook named a part it did not describe, so the tab cannot be opened and
      // the file is not the workbook it claims to be.
      if (relationship === undefined) refuse('parse_failed')

      // A chartsheet and a dialog sheet are tabs with no cells. Reading their XML as a
      // worksheet would turn a drawing into a table, so they are skipped rather than
      // guessed at.
      if (relationship.type.endsWith('/chartsheet')) continue
      if (relationship.type.endsWith('/dialogsheet')) continue

      const part = partPath(SPREADSHEET_MAIN, relationship.target)
      const lines = readSheetLines(zipText(archive, part), shared)
      if (lines.length === 0) continue
      accumulator.push({ page: null, section: sheet.name, text: lines.join('\n') })
    }

    return finished(accumulator, sheets.length)
  })
}

/* ------------------------------------------------------------------ *
 * PPTX
 * ------------------------------------------------------------------ */

const PRESENTATION_MAIN = 'ppt'

/** The slide relationship ids, in the order the deck shows them. */
function readSlideOrder (xml: string): string[] {
  const order: string[] = []
  walkXml(xml, {
    open: (tag) => {
      if (localName(tag.name) !== 'sldId') return
      const relId = attr(tag, 'r:id')
      if (relId === null) refuse('parse_failed')
      order.push(relId)
    },
  })
  return order
}

/**
 * A slide's or notes page's paragraphs, in order, with empty ones dropped.
 *
 * `<a:fld>` is a field placeholder: a slide number, a date, a footer. Its `<a:t>` holds
 * generated text rather than something the author typed, so reading it would put a
 * stray "1" at the end of every notes page. `<a:br/>` is a line break inside one
 * paragraph and is kept as one, because that is how it is shown.
 */
function readSlideParagraphs (xml: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let inText = false
  let inField = false

  walkXml(xml, {
    open: (tag) => {
      const name = localName(tag.name)
      if (name === 'fld') {
        inField = true
        return
      }
      if (name === 'p') {
        current = []
        return
      }
      if (name === 't') {
        inText = true
        return
      }
      if (name === 'br') {
        current.push('\n')
      }
      // No `a:tab` case: in DrawingML that element is a tab *stop* in `<a:tabLst>`, and
      // a literal tab inside text lives in the run's own `<a:t>`. Reading it as a
      // character would put a tab at the start of every paragraph with custom stops.
    },
    close: (name) => {
      const local = localName(name)
      if (local === 'fld') {
        inField = false
        return
      }
      if (local === 't') {
        inText = false
        return
      }
      if (local !== 'p') return

      const text = current.join('').trim()
      current = []
      if (text !== '') paragraphs.push(text)
    },
    text: (text) => {
      if (inText && !inField) current.push(text)
    },
  })

  return paragraphs
}

/**
 * The notes page for one slide, found through the slide's own relationships.
 *
 * Matching by file name is what would tie the wrong notes to a slide: a deck edited and
 * saved has notes pages whose numbers no longer follow its slides, and a notes page's
 * relationship is the only thing that says which slide it belongs to. A slide with no
 * notes relationship has no notes, whatever files happen to sit in the archive.
 */
function readSlideNotes (archive: Map<string, ZipEntry>, slidePart: string): string {
  const relsPart = `${dirOf(slidePart)}/_rels/${nameOf(slidePart)}.rels`
  if (!archive.has(relsPart)) return ''

  const relationships = readRelationships(zipText(archive, relsPart))
  for (const relationship of relationships.values()) {
    if (!relationship.type.endsWith('/notesSlide')) continue
    const notesPart = partPath(dirOf(slidePart), relationship.target)
    // A relationship that points at a part the archive does not hold describes a file
    // that has lost its notes. The slide is still worth reading, so only the notes go.
    if (!archive.has(notesPart)) return ''
    return readSlideParagraphs(zipText(archive, notesPart)).join('\n')
  }
  return ''
}

/**
 * A deck, one section per slide, with that slide's notes appended.
 *
 * Slide order comes from `p:sldIdLst` and nowhere else. `slides/slide1.xml` is the first
 * slide only until somebody reorders the deck, and then it is not.
 */
export function extractPptx (bytes: Uint8Array): ExtractionResult {
  return guarded(() => {
    const archive = readZip(bytes)
    const presentation = zipText(archive, 'ppt/presentation.xml')
    const relationships = readRelationships(zipText(archive, 'ppt/_rels/presentation.xml.rels'))

    const order = readSlideOrder(presentation)
    const accumulator = new SectionAccumulator()

    for (const [position, relId] of order.entries()) {
      const relationship = relationships.get(relId)
      // The deck declares a slide it has no part for. Refusing beats delivering a deck
      // with a hole in it under a count that says otherwise.
      if (relationship === undefined) refuse('parse_failed')

      const slidePart = partPath(PRESENTATION_MAIN, relationship.target)
      const body = readSlideParagraphs(zipText(archive, slidePart)).join('\n')
      const notes = readSlideNotes(archive, slidePart)

      const parts: string[] = []
      if (body !== '') parts.push(body)
      if (notes !== '') parts.push('Notes:', notes)

      accumulator.push({
        page: null,
        section: `Slide ${position + 1}`,
        text: parts.join('\n'),
      })
    }

    return finished(accumulator, order.length)
  })
}

/* ------------------------------------------------------------------ *
 * The two rules every parser shares
 * ------------------------------------------------------------------ */

/**
 * The finished result, or a refusal when nothing was read at all.
 *
 * An Office file with no text anywhere is far more likely to be a file whose extension
 * is wrong than a genuinely blank document, and reporting success would let the caller
 * chunk nothing and then show an empty answer as though it had read the document.
 */
function finished (accumulator: SectionAccumulator, pageCount: number): ExtractionResult {
  const result = accumulator.result(pageCount)
  if (result.sections.length === 0) refuse('parse_failed')
  return result
}

/**
 * Run one parser, keeping the promise that it throws only `ExtractionError`.
 *
 * A `StorageError`-style token is what a screen can render, and an unexpected message
 * can quote the document it was reading. Anything that is not already a refusal is
 * therefore reported as one, so a future edit inside a parser cannot turn a bad file
 * into a raw stack trace on a person's screen.
 */
function guarded (work: () => ExtractionResult): ExtractionResult {
  try {
    return work()
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    refuse('parse_failed')
  }
}
