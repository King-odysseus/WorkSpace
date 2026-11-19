/*
 * A PDF text extractor with no library behind it.
 *
 * Why this is written rather than imported. A PDF reader is the largest parser in this
 * app: it walks attacker-controlled structure, decompresses attacker-controlled streams
 * and turns the result into text that is then sent to a model. The general-purpose
 * packages bring a font engine, a JavaScript interpreter, embedded-file support and a
 * full CMap system, and every one of those is a way in, to do the one thing this build
 * needs. So this file reads the two structures a text layer actually lives in, page
 * dictionaries and content streams, refuses everything it cannot explain, and stays
 * small enough to review in one sitting.
 *
 * What is deliberately out of scope, so nobody has to guess later:
 *
 * - CID and CMap subsets with custom encodings are not decoded. A PDF may map glyph
 *   codes through its own CMap, so the bytes in a string are indices into a subset font
 *   rather than characters. Without that CMap those pages yield imperfect glyph text:
 *   sometimes close to the right words, often nonsense. This is a known limitation of
 *   this build, and it is the reason the extractor never claims a page was read when it
 *   produced nothing.
 * - Object streams (`/Type /ObjStm`) are not unpacked. A PDF that keeps its page
 *   dictionaries inside a compressed object stream is reported as having no pages rather
 *   than being guessed at.
 * - Encryption is detected and refused, never decrypted: this build holds no key for
 *   anyone's file, and an empty result would be a lie about a document the person can
 *   open in any viewer.
 * - Layout is not reconstructed. Headings, columns and tables come out in the order the
 *   content stream drew them, which is the only order a reader without font metrics can
 *   honestly claim.
 *
 * Why the whole file is held as one latin1 string. PDF syntax is bytes, and every
 * structural token is ASCII. Decoding the file as latin1 maps each byte to exactly one
 * character, so a string index is a byte offset and slicing the string and slicing the
 * array agree. A UTF-8 decode would merge multi-byte sequences and every offset after
 * the first binary stream would be wrong. The cost is one string the size of the file,
 * which is bounded by `MAX_INPUT_BYTES` before any of this runs.
 */

import { inflateRawSync, inflateSync } from 'node:zlib'
import {
  ExtractionError,
  MAX_INPUT_BYTES,
  MAX_PAGE_DECODED_BYTES,
  refuse,
  SectionAccumulator,
  type ExtractionResult,
} from './types.js'

const PDF_HEADER = '%PDF-'

/** The characters PDF treats as whitespace, from the specification's delimiter table. */
function isWhitespace (code: number): boolean {
  return code === 0x00 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20
}

/** The bytes that may appear inside a name or a number once it has started. */
function isRegular (code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true
  if (code >= 0x41 && code <= 0x5a) return true
  if (code >= 0x61 && code <= 0x7a) return true
  return code === 0x2b || code === 0x2d || code === 0x2e || code === 0x5f || code === 0x2a || code === 0x23
}

function isNumberStart (code: number): boolean {
  return (code >= 0x30 && code <= 0x39) || code === 0x2b || code === 0x2d || code === 0x2e
}

/** The bytes of a bare keyword. `*` is here because the operators `T*`, `f*` and `W*` need it. */
function isKeywordByte (code: number): boolean {
  if (code >= 0x41 && code <= 0x5a) return true
  if (code >= 0x61 && code <= 0x7a) return true
  return code === 0x2a
}

/**
 * One capture group, as a string.
 *
 * `noUncheckedIndexedAccess` makes every group `string | undefined`, and the regexes
 * below only produce a group when their pattern matched, so a missing one is a bug in
 * this file rather than a fact about the document. Refusing is still the right answer:
 * a wrong offset here would be reported as a corrupt file either way.
 */
function group (match: RegExpExecArray, index: number): string {
  const value = match[index]
  if (value === undefined) refuse('parse_failed')
  return value
}

/** Bytes to a one-character-per-byte string, so offsets are byte offsets. */
function latin1 (bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
}

/*
 * Windows-1252 for the range where it differs from Latin-1.
 *
 * Why this range matters. A `Tf` operator selects a font, and the overwhelming majority
 * of PDFs written by Office, LibreOffice and the common publishing tools leave the font
 * in WinAnsi encoding. That puts the quote marks, the dashes and the bullet in 0x80 to
 * 0x9F, which Latin-1 calls control characters. Reading them as Latin-1 turns "it's" into
 * "it" followed by an invisible control byte, which silently corrupts every apostrophe
 * in the document. The table is written out rather than taken from `TextDecoder` so the
 * output does not depend on which ICU data the runtime happened to ship.
 *
 * Above 0xA0 WinAnsi and Latin-1 agree, apart from 0xAD and the undefined slots, so the
 * byte is used directly there.
 */
const WINDOWS_1252: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]

/** UTF-16BE code units, after a `FE FF` marker. */
function decodeUtf16Be (bytes: string, from: number): string {
  let out = ''
  for (let at = from; at + 1 < bytes.length; at += 2) {
    out += String.fromCharCode((bytes.charCodeAt(at) << 8) | bytes.charCodeAt(at + 1))
  }
  return out
}

/**
 * The bytes of a PDF string as text.
 *
 * Two encodings are handled honestly and the rest fall back to a byte-per-character read.
 * A string that starts with `FE FF` is UTF-16BE by the specification, which is what a
 * document uses for text outside Latin-1. Everything else is read as WinAnsi, above.
 */
function decodePdfBytes (bytes: string): string {
  if (bytes.length >= 2 && bytes.charCodeAt(0) === 0xfe && bytes.charCodeAt(1) === 0xff) {
    return decodeUtf16Be(bytes, 2)
  }

  let out = ''
  for (let at = 0; at < bytes.length; at += 1) {
    const byte = bytes.charCodeAt(at)
    if (byte >= 0x80 && byte <= 0x9f) {
      out += String.fromCharCode(WINDOWS_1252[byte - 0x80] ?? byte)
      continue
    }
    out += String.fromCharCode(byte)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Finding objects
 * ------------------------------------------------------------------ */

interface PdfStream {
  /** The dictionary that precedes the stream data, which is where its filter lives. */
  dict: string
  data: Uint8Array
}

interface PdfObject {
  number: number
  /** Everything between `obj` and either `stream` or `endobj`. */
  dict: string
  stream: PdfStream | null
}

/**
 * The `stream` keyword between `from` and `limit`, with where its data begins.
 *
 * `limit` is the object's own `endobj`: bounding the search to the object keeps a scan of
 * a large file linear, instead of searching the rest of the document for every object
 * that turns out to have no stream.
 *
 * The check on the preceding byte exists because `endstream` contains `stream`. Looking
 * for the keyword alone would find every stream's terminator and read its data as a
 * dictionary.
 */
function findStreamKeyword (text: string, from: number, limit: number): { keywordAt: number; dataStart: number } | null {
  const keyword = 'stream'
  let at = text.indexOf(keyword, from)
  while (at >= 0 && at < limit) {
    const before = at === 0 ? 0x20 : text.charCodeAt(at - 1)
    const after = text.charCodeAt(at + keyword.length)
    if (!isRegular(before) && (after === 0x0a || after === 0x0d)) {
      const skip = after === 0x0d && text.charCodeAt(at + keyword.length + 1) === 0x0a ? 2 : 1
      return { keywordAt: at, dataStart: at + keyword.length + skip }
    }
    at = text.indexOf(keyword, at + 1)
  }
  return null
}

/** `/Length` when the dictionary states it directly. An indirect length is not matched. */
const LENGTH_KEY = /\/Length[\x00\t\n\f\r ]+(\d{1,12})(?![0-9])/

/**
 * Where a stream's data ends and where its terminator sits.
 *
 * The declared length is preferred because it is exact: a compressed stream can contain
 * the bytes `endstream` by coincidence, and trusting the terminator alone would cut the
 * data short there. Falling back to the terminator is for the files that record their
 * length indirectly (`/Length 12 0 R`), which this reader does not resolve.
 */
function streamBounds (text: string, dict: string, dataStart: number): { end: number; endStreamAt: number } | null {
  const declared = LENGTH_KEY.exec(dict)
  if (declared !== null) {
    const end = dataStart + Number(group(declared, 1))
    const tail = end <= text.length ? text.slice(end, end + 32) : ''
    if (/^[\x00\t\n\f\r ]*endstream/.test(tail)) {
      return { end, endStreamAt: text.indexOf('endstream', end) }
    }
  }

  const endStreamAt = text.indexOf('endstream', dataStart)
  if (endStreamAt < 0) return null
  return { end: endStreamAt, endStreamAt }
}

/**
 * Every `N 0 obj ... endobj` block in the file, keyed by object number, in file order.
 *
 * Why a scan rather than the cross-reference table. The table is the authoritative index,
 * and it is also the part most often damaged, written in a newer form this reader does
 * not parse, or stored in a compressed object stream. A scan finds the objects in a file
 * whose xref is useless, which is exactly the file a person brings to support. The price
 * is that object numbers must appear in the order the scan meets them, and that a page
 * tree is not walked: see the notes at the top.
 *
 * Once a stream is recognised the scan jumps over its data. That is what stops a
 * compressed image from being read as a run of objects because its bytes happened to look
 * like `12 0 obj`.
 */
function scanObjects (text: string, bytes: Uint8Array): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>()
  const head = /(\d{1,10})[\x00\t\n\f\r ]+(\d{1,5})[\x00\t\n\f\r ]+obj(?![A-Za-z0-9])/g
  let cursor = 0

  while (cursor < text.length) {
    head.lastIndex = cursor
    const match = head.exec(text)
    if (match === null) break

    const number = Number(group(match, 1))
    const bodyStart = match.index + match[0].length
    const endObjAt = text.indexOf('endobj', bodyStart)
    // Nothing terminates this object any more. Every offset after it would be a guess.
    if (endObjAt < 0) break

    const streamAt = findStreamKeyword(text, bodyStart, endObjAt)
    if (streamAt === null) {
      objects.set(number, { number, dict: text.slice(bodyStart, endObjAt), stream: null })
      cursor = endObjAt + 'endobj'.length
      continue
    }

    const dict = text.slice(bodyStart, streamAt.keywordAt)
    const bounds = streamBounds(text, dict, streamAt.dataStart)
    if (bounds === null) {
      objects.set(number, { number, dict, stream: null })
      break
    }

    objects.set(number, {
      number,
      dict,
      stream: { dict, data: bytes.subarray(streamAt.dataStart, bounds.end) },
    })
    cursor = bounds.endStreamAt + 'endstream'.length
  }

  return objects
}

/* ------------------------------------------------------------------ *
 * Reading dictionaries
 * ------------------------------------------------------------------ */

/** `/Type /Page`, and not `/Type /Pages`, which is the node above a page. */
const PAGE_TYPE = /\/Type[\x00\t\n\f\r ]*\/Page(?![A-Za-z0-9])/
const XREF_TYPE = /\/Type[\x00\t\n\f\r ]*\/XRef(?![A-Za-z0-9])/

/** `/Encrypt` as a key: never as the prefix of a longer name. */
const ENCRYPT_KEY = /\/Encrypt(?![A-Za-z0-9])/

const CONTENTS_KEY = /\/Contents(?![A-Za-z0-9])/
const FILTER_KEY = /\/Filter(?![A-Za-z0-9])/
const REFERENCE = /(\d{1,10})[\x00\t\n\f\r ]+(\d{1,5})[\x00\t\n\f\r ]+R(?![A-Za-z0-9])/g

/** The object numbers named by an indirect reference run, in the order written. */
function referencesIn (fragment: string): number[] {
  const found: number[] = []
  const scan = new RegExp(REFERENCE.source, 'g')
  let match = scan.exec(fragment)
  while (match !== null) {
    found.push(Number(group(match, 1)))
    match = scan.exec(fragment)
  }
  return found
}

/**
 * The objects holding a page's content, in the order they are drawn.
 *
 * `/Contents` is either one reference or an array of them. An array is not decoration:
 * a writer that appends to a page, or that produces a page from several fragments,
 * concatenates the streams in the listed order, so reversing them would put the second
 * half of a sentence before the first.
 */
function contentObjectNumbers (dict: string): number[] {
  const at = CONTENTS_KEY.exec(dict)
  if (at === null) return []

  const rest = dict.slice(at.index + at[0].length).replace(/^[\x00\t\n\f\r ]+/, '')

  if (rest.startsWith('[')) {
    const close = rest.indexOf(']')
    if (close < 0) return []
    return referencesIn(rest.slice(1, close))
  }

  const single = /^(\d{1,10})[\x00\t\n\f\r ]+(\d{1,5})[\x00\t\n\f\r ]+R/.exec(rest)
  if (single === null) return []
  return [Number(group(single, 1))]
}

/**
 * The filters a stream is encoded with, in the order they must be undone.
 *
 * Only the first name is taken when the value is not an array, because the tokens that
 * follow it belong to the next key: reading further would collect `/Length` as a filter.
 */
function streamFilters (dict: string): string[] {
  const at = FILTER_KEY.exec(dict)
  if (at === null) return []

  const rest = dict.slice(at.index + at[0].length).replace(/^[\x00\t\n\f\r ]+/, '')

  if (rest.startsWith('[')) {
    const close = rest.indexOf(']')
    if (close < 0) return []
    const inner = rest.slice(1, close)
    const names: string[] = []
    const scan = /\/([A-Za-z0-9]+)/g
    let match = scan.exec(inner)
    while (match !== null) {
      names.push(group(match, 1))
      match = scan.exec(inner)
    }
    return names
  }

  const single = /^\/([A-Za-z0-9]+)/.exec(rest)
  if (single === null) return []
  return [group(single, 1)]
}

/** The two spellings PDF gives the deflate filter, which is the one a text layer uses. */
function isFlate (name: string): boolean {
  return name === 'FlateDecode' || name === 'Fl'
}

interface Inflated {
  ok: boolean
  value: Uint8Array
  tooLarge: boolean
}

function inflateOnce (work: () => Uint8Array): Inflated {
  try {
    return { ok: true, value: work(), tooLarge: false }
  } catch (error) {
    // Not swallowed: the caller decides between a resource refusal and a corrupt
    // stream, and it needs this one fact to tell them apart.
    return { ok: false, value: new Uint8Array(0), tooLarge: exceededCeiling(error) }
  }
}

/**
 * Whether a failure was the ceiling being reached rather than a corrupt stream.
 *
 * zlib reports a `maxOutputLength` breach as a `RangeError` carrying its own code. The
 * code is checked first and the type second, because a corrupt stream never raises a
 * range error: the distinction decides between `too_large` and `unreadable`, and a
 * version of Node that renames the code must not turn a bomb into a corrupt file.
 */
function exceededCeiling (error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') return true
  return error instanceof RangeError
}

/**
 * A flate stream, expanded under a limit the caller has already spent.
 *
 * `FlateDecode` is zlib-wrapped deflate (RFC 1950), which is what `inflateSync` expects.
 * A handful of writers emit bare deflate instead, so a raw pass is tried second rather
 * than being detected first: detection would mean reading the first two bytes as a
 * header, and a writer that got those wrong is the same problem again.
 *
 * `limit` is what is left of the page's allowance, never a fresh ceiling, so a stream
 * named many times cannot be spent the whole of it on each turn. The limit is applied by
 * zlib itself: checking the result afterwards would be too late, because by then the
 * stream that was meant to be refused is already in memory.
 */
function inflate (data: Uint8Array, limit: number): Uint8Array {
  const options = { maxOutputLength: limit }

  const wrapped = inflateOnce(() => inflateSync(data, options))
  if (wrapped.ok) return withinCeiling(wrapped.value, limit)

  const raw = inflateOnce(() => inflateRawSync(data, options))
  if (raw.ok) return withinCeiling(raw.value, limit)

  // Past the ceiling is a resource refusal the caller can explain to a person; anything
  // else is a stream this build cannot read.
  if (wrapped.tooLarge || raw.tooLarge) refuse('too_large')
  refuse('unreadable')
}

/**
 * A stream that reaches the limit it was given, refused.
 *
 * The limit is enforced by zlib, but a runtime that reported a breach by returning a
 * cut-off buffer instead of raising would otherwise leave a truncated stream looking like
 * a complete one. A content stream anywhere near this size is not a text layer in the
 * first place, so refusing at the boundary costs nothing real.
 */
function withinCeiling (bytes: Uint8Array, limit: number): Uint8Array {
  if (bytes.length >= limit) refuse('too_large')
  return bytes
}

/**
 * A stream's bytes, decoded, or `null` when this build has no reader for its filter.
 *
 * `budget` is what is left of the page's allowance. It is passed down rather than checked
 * here so that a compressed stream is stopped by zlib mid-expansion instead of being
 * expanded in full and then measured.
 *
 * `null` rather than a refusal, because one page behind an LZW or JPEG stream is a broken
 * page, not a broken document: the pages around it can still be read and cited.
 */
function decodeStream (stream: PdfStream, budget: number): Uint8Array | null {
  const filters = streamFilters(stream.dict)
  if (filters.length === 0) {
    // Uncompressed: nothing expands, so the budget is checked against the bytes as they
    // sit in the file rather than after they have been added to the page.
    if (stream.data.length > budget) refuse('too_large')
    return stream.data
  }

  const first = filters[0]
  if (filters.length === 1 && first !== undefined && isFlate(first)) return inflate(stream.data, budget)

  /*
   * LZW, ASCII85, ASCIIHex, RunLength and the image codecs are not filters a text layer
   * is written with by the tools this build supports. A page behind one is skipped rather
   * than guessed at.
   */
  return null
}

/**
 * Whether the document declares an encryption dictionary.
 *
 * Read from the trailer, and from a cross-reference stream for the files that write one
 * instead. Both are dictionaries, so a `/Encrypt` in either is the document's own
 * encryption dictionary rather than bytes that happened to spell it inside a compressed
 * stream. Only when the file has no trailer of either kind does the tail get scanned,
 * which is the last resort for a damaged xref.
 */
function hasEncryptKey (text: string, objects: Map<number, PdfObject>): boolean {
  const trailer = /trailer/g
  let found = false
  let match = trailer.exec(text)
  while (match !== null) {
    found = true
    if (ENCRYPT_KEY.test(text.slice(match.index, match.index + 2_000))) return true
    match = trailer.exec(text)
  }

  for (const object of objects.values()) {
    if (XREF_TYPE.test(object.dict) && ENCRYPT_KEY.test(object.dict)) return true
  }

  if (found) return false
  return ENCRYPT_KEY.test(text.slice(Math.max(0, text.length - 1_024)))
}

/* ------------------------------------------------------------------ *
 * Reading content streams
 * ------------------------------------------------------------------ */

type Operand =
  | { kind: 'string'; text: string }
  | { kind: 'array'; items: Operand[] }
  | { kind: 'other' }

interface ReadResult<T> {
  value: T
  next: number
}

/** The single-character escapes, as byte values. Octal and line continuation are separate. */
const SIMPLE_ESCAPES: Readonly<Record<number, number>> = {
  0x6e: 0x0a, // n
  0x72: 0x0d, // r
  0x74: 0x09, // t
  0x62: 0x08, // b
  0x66: 0x0c, // f
  0x28: 0x28, // (
  0x29: 0x29, // )
  0x5c: 0x5c, // backslash
}

function hexDigit (code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
  return -1
}

/**
 * A `(literal) string`, escapes resolved.
 *
 * The bytes are collected as characters first and decoded once at the end, because a
 * `FE FF` marker is only meaningful once the escapes have been undone.
 *
 * `null` means the string never closed. That is a truncated stream, and the caller reports
 * it as an unreadable page rather than as an image-only one.
 */
function readLiteralString (content: string, open: number): ReadResult<string> | null {
  const bytes: string[] = []
  let at = open + 1
  let depth = 1

  while (at < content.length) {
    const code = content.charCodeAt(at)

    if (code === 0x5c) {
      at += 1
      if (at >= content.length) return null
      const escape = content.charCodeAt(at)

      // A backslash before a line break continues the string on the next line. The break
      // is layout, so neither the marker nor the newline is part of the text.
      if (escape === 0x0d) {
        at += content.charCodeAt(at + 1) === 0x0a ? 2 : 1
        continue
      }
      if (escape === 0x0a) {
        at += 1
        continue
      }

      if (escape >= 0x30 && escape <= 0x37) {
        let value = 0
        let digits = 0
        while (digits < 3 && at < content.length) {
          const digit = content.charCodeAt(at)
          if (digit < 0x30 || digit > 0x37) break
          value = value * 8 + (digit - 0x30)
          at += 1
          digits += 1
        }
        bytes.push(String.fromCharCode(value & 0xff))
        continue
      }

      bytes.push(String.fromCharCode(SIMPLE_ESCAPES[escape] ?? escape))
      at += 1
      continue
    }

    if (code === 0x28) {
      depth += 1
      bytes.push('(')
      at += 1
      continue
    }

    if (code === 0x29) {
      depth -= 1
      at += 1
      if (depth === 0) return { value: decodePdfBytes(bytes.join('')), next: at }
      bytes.push(')')
      continue
    }

    // A bare end-of-line inside a string is one newline, whichever of CR, LF or CRLF the
    // writer used.
    if (code === 0x0d) {
      bytes.push('\n')
      at += content.charCodeAt(at + 1) === 0x0a ? 2 : 1
      continue
    }

    bytes.push(String.fromCharCode(code))
    at += 1
  }

  return null
}

/** A `<hex string>`. Whitespace inside is ignored; a trailing odd digit is padded. */
function readHexString (content: string, open: number): ReadResult<string> | null {
  const bytes: string[] = []
  let at = open + 1
  let high = -1

  while (at < content.length) {
    const code = content.charCodeAt(at)
    at += 1

    if (code === 0x3e) {
      if (high >= 0) bytes.push(String.fromCharCode(high * 16))
      return { value: decodePdfBytes(bytes.join('')), next: at }
    }

    const digit = hexDigit(code)
    if (digit < 0) continue
    if (high < 0) {
      high = digit
      continue
    }
    bytes.push(String.fromCharCode(high * 16 + digit))
    high = -1
  }

  return null
}

/** A `<< dictionary >>`, skipped whole so nothing inside it is read as an operator. */
function skipDictionary (content: string, open: number): number | null {
  let at = open
  let depth = 0

  while (at < content.length) {
    const code = content.charCodeAt(at)

    if (code === 0x3c) {
      if (content.charCodeAt(at + 1) === 0x3c) {
        depth += 1
        at += 2
        continue
      }
      const read = readHexString(content, at)
      if (read === null) return null
      at = read.next
      continue
    }

    if (code === 0x3e) {
      if (content.charCodeAt(at + 1) === 0x3e) {
        depth -= 1
        at += 2
        if (depth === 0) return at
        continue
      }
      at += 1
      continue
    }

    if (code === 0x28) {
      const read = readLiteralString(content, at)
      if (read === null) return null
      at = read.next
      continue
    }

    at += 1
  }

  return null
}

/** The index just past a `/Name`. */
function readNameEnd (content: string, at: number): number {
  let cursor = at + 1
  while (cursor < content.length && isRegular(content.charCodeAt(cursor))) cursor += 1
  return cursor
}

/**
 * A `[ ... ]` operand, which is how a `TJ` array arrives.
 *
 * The numbers in the array are kerning adjustments. They are dropped instead of being
 * turned into spaces: the numbers are how the writer says the glyphs already carry that
 * spacing, so a space inserted for them would split a word that the page draws joined.
 */
function readArray (content: string, open: number): ReadResult<Operand> | null {
  const items: Operand[] = []
  let at = open + 1

  while (at < content.length) {
    const code = content.charCodeAt(at)

    if (isWhitespace(code)) {
      at += 1
      continue
    }

    if (code === 0x5d) return { value: { kind: 'array', items }, next: at + 1 }

    if (code === 0x28) {
      const read = readLiteralString(content, at)
      if (read === null) return null
      items.push({ kind: 'string', text: read.value })
      at = read.next
      continue
    }

    if (code === 0x3c) {
      if (content.charCodeAt(at + 1) === 0x3c) {
        const next = skipDictionary(content, at)
        if (next === null) return null
        items.push({ kind: 'other' })
        at = next
        continue
      }
      const read = readHexString(content, at)
      if (read === null) return null
      items.push({ kind: 'string', text: read.value })
      at = read.next
      continue
    }

    if (code === 0x5b) {
      const nested = readArray(content, at)
      if (nested === null) return null
      items.push(nested.value)
      at = nested.next
      continue
    }

    if (code === 0x2f) {
      at = readNameEnd(content, at)
      items.push({ kind: 'other' })
      continue
    }

    if (isNumberStart(code)) {
      while (at < content.length && isRegular(content.charCodeAt(at))) at += 1
      items.push({ kind: 'other' })
      continue
    }

    at += 1
  }

  return null
}

interface ContentReading {
  text: string
  /** Whether the stream asked for text at all, which is what separates a scan from a gap. */
  sawTextOperator: boolean
  /** The stream ended inside a construct, so anything after it is unknown. */
  broken: boolean
}

/**
 * The text a content stream draws, in the order it draws it.
 *
 * Why a newline on every positioning operator. `T*`, `Td`, `TD`, `Tm`, `'` and `"` all
 * move the text position, and a reader without font metrics cannot tell a line break from
 * a move across the page. A newline is the only separator that keeps two paragraphs from
 * becoming one sentence, and a chunker downstream can treat it as a soft boundary.
 *
 * Why `Tf` is ignored. It names a font and a size. The encoding that comes with the font
 * is the part that would matter, and this build does not resolve it, so the bytes are
 * decoded as WinAnsi regardless: see the note on limitations at the top of the file.
 */
function readContent (content: string): ContentReading {
  let buffer = ''
  let sawTextOperator = false
  let broken = false
  let operands: Operand[] = []
  let at = 0

  const lineBreak = (): void => {
    if (buffer !== '' && !buffer.endsWith('\n')) buffer += '\n'
  }

  /*
   * The operand the showing operators draw.
   *
   * Searched backwards rather than read off the end, because `"` takes three operands
   * (`aw ac string`) and the string is the oldest of them. Reading the last one there
   * would draw the horizontal spacing word-space and drop the text.
   */
  const lastString = (): string | null => {
    for (let index = operands.length - 1; index >= 0; index -= 1) {
      const operand = operands[index]
      if (operand !== undefined && operand.kind === 'string') return operand.text
    }
    return null
  }

  const lastArray = (): Operand[] | null => {
    for (let index = operands.length - 1; index >= 0; index -= 1) {
      const operand = operands[index]
      if (operand !== undefined && operand.kind === 'array') return operand.items
    }
    return null
  }

  const show = (text: string | null): void => {
    if (text !== null) buffer += text
  }

  while (at < content.length) {
    const code = content.charCodeAt(at)

    if (isWhitespace(code)) {
      at += 1
      continue
    }

    if (code === 0x25) {
      const end = content.indexOf('\n', at)
      at = end < 0 ? content.length : end + 1
      continue
    }

    if (code === 0x28) {
      const read = readLiteralString(content, at)
      if (read === null) {
        broken = true
        break
      }
      operands.push({ kind: 'string', text: read.value })
      at = read.next
      continue
    }

    if (code === 0x3c) {
      if (content.charCodeAt(at + 1) === 0x3c) {
        const next = skipDictionary(content, at)
        if (next === null) {
          broken = true
          break
        }
        operands.push({ kind: 'other' })
        at = next
        continue
      }
      const read = readHexString(content, at)
      if (read === null) {
        broken = true
        break
      }
      operands.push({ kind: 'string', text: read.value })
      at = read.next
      continue
    }

    if (code === 0x5b) {
      const read = readArray(content, at)
      if (read === null) {
        broken = true
        break
      }
      operands.push(read.value)
      at = read.next
      continue
    }

    if (code === 0x5d || code === 0x3e || code === 0x7b || code === 0x7d) {
      at += 1
      continue
    }

    if (code === 0x2f) {
      at = readNameEnd(content, at)
      operands.push({ kind: 'other' })
      continue
    }

    // `'` and `"` are operators in their own right: they move to the next line and then
    // draw the string they were given, so the break comes before the text.
    if (code === 0x27 || code === 0x22) {
      sawTextOperator = true
      lineBreak()
      show(lastString())
      operands = []
      at += 1
      continue
    }

    if (isNumberStart(code)) {
      while (at < content.length && isRegular(content.charCodeAt(at))) at += 1
      operands.push({ kind: 'other' })
      continue
    }

    const start = at
    while (at < content.length && isKeywordByte(content.charCodeAt(at))) at += 1
    if (at === start) {
      // A delimiter this reader does not handle. Stepping over it keeps the scan moving
      // rather than looping on the same byte.
      at += 1
      continue
    }

    const operator = content.slice(start, at)

    switch (operator) {
      case 'Tj': {
        sawTextOperator = true
        show(lastString())
        break
      }
      case 'TJ': {
        sawTextOperator = true
        const items = lastArray()
        if (items !== null) {
          for (const item of items) {
            if (item.kind === 'string') buffer += item.text
          }
        }
        break
      }
      case 'T*':
      case 'Td':
      case 'TD':
      case 'Tm':
      case 'ET':
        lineBreak()
        break
      default:
        break
    }

    operands = []
  }

  return { text: buffer, sawTextOperator, broken }
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

interface PageReading {
  text: string
  sawTextOperator: boolean
  /** Some part of this page could not be read, so it must not be reported as a scan. */
  unreadable: boolean
}

function noText (unreadable: boolean): PageReading {
  return { text: '', sawTextOperator: false, unreadable }
}

function readPage (page: PdfObject, objects: Map<number, PdfObject>): PageReading {
  const references = contentObjectNumbers(page.dict)
  const pieces: string[] = []
  let unreadable = false
  /*
   * What is left of this page's allowance. It is spent down as each piece is decoded
   * rather than reset per piece, because a `/Contents` array may name the same stream
   * many times over: each name would otherwise decode that stream again in full. It is
   * tracked here, and spent down as each piece is decoded, which is what makes the bound
   * describe the page instead of the piece.
   */
  let remaining = MAX_PAGE_DECODED_BYTES

  if (references.length === 0) {
    /*
     * A page with no `/Contents` at all draws nothing: it is the blank page a section
     * break leaves behind. It is reported the same way a scan is, because from here both
     * are "a page with no text layer", and claiming it was read would be worse than
     * saying it could not be.
     */
    if (page.stream === null) return noText(false)
    const inline = decodeStream(page.stream, remaining)
    if (inline === null) return noText(true)
    pieces.push(latin1(inline))
    remaining -= inline.length
  } else {
    for (const reference of references) {
      const object = objects.get(reference)
      if (object === undefined || object.stream === null) {
        unreadable = true
        continue
      }
      // Refused here rather than after the loop, so a page that repeats one stream past
      // its allowance does not first collect everything it is about to be refused for.
      if (remaining <= 0) refuse('too_large')
      const data = decodeStream(object.stream, remaining)
      if (data === null) {
        unreadable = true
        continue
      }
      pieces.push(latin1(data))
      remaining -= data.length
    }
  }

  if (pieces.length === 0) return noText(unreadable)

  /*
   * The pieces are joined with a newline. Concatenating content streams is really
   * operator concatenation, and a writer that splits a page usually splits it between
   * text objects, so a separator here matches what the streams themselves would do.
   */
  const reading = readContent(pieces.join('\n'))
  return {
    text: reading.text,
    sawTextOperator: reading.sawTextOperator,
    unreadable: unreadable || reading.broken,
  }
}

/* ------------------------------------------------------------------ *
 * The extractor
 * ------------------------------------------------------------------ */

function hasPdfHeader (bytes: Uint8Array): boolean {
  if (bytes.length < PDF_HEADER.length) return false
  for (let at = 0; at < PDF_HEADER.length; at += 1) {
    if (bytes[at] !== PDF_HEADER.charCodeAt(at)) return false
  }
  return true
}

function extract (bytes: Uint8Array): ExtractionResult {
  if (!(bytes instanceof Uint8Array)) refuse('unreadable')
  /*
   * The size is checked before anything reads a byte. Parsing first and rejecting later
   * would mean the ceiling only existed on paper: the work would already have been done.
   */
  if (bytes.length > MAX_INPUT_BYTES) refuse('too_large')
  if (!hasPdfHeader(bytes)) refuse('unreadable')

  const text = latin1(bytes)
  const objects = scanObjects(text, bytes)

  if (hasEncryptKey(text, objects)) refuse('unreadable')

  /*
   * The pages are the objects that say `/Type /Page`. A page tree is not walked: its
   * `/Kids` order is the reading order, and it is also the structure most often damaged,
   * so the objects are taken in the order the file writes them. In practice a writer emits
   * pages in reading order, and a document that does not is reported in the order it was
   * stored rather than in an order this reader would have to invent.
   */
  const pages: PdfObject[] = []
  for (const object of objects.values()) {
    if (PAGE_TYPE.test(object.dict)) pages.push(object)
  }
  if (pages.length === 0) refuse('parse_failed')

  const accumulator = new SectionAccumulator()
  const ocrPending: number[] = []
  let pagesWithText = 0

  for (const [index, page] of pages.entries()) {
    const pageNumber = index + 1
    const reading = readPage(page, objects)

    if (reading.text.trim() !== '') {
      accumulator.push({ page: pageNumber, section: null, text: reading.text })
      pagesWithText += 1
      continue
    }

    // A page this build could not read is skipped, not called a scan. Saying "this page
    // holds an image" about a page whose stream was truncated would be a guess.
    if (reading.unreadable) continue
    if (reading.sawTextOperator) continue
    ocrPending.push(pageNumber)
  }

  /*
   * Every page was blank, unreadable or image-only. When at least one page needs OCR the
   * result is honest: an empty text layer with the pages named. When none does, the file
   * had pages but nothing in it this reader could follow, which is a parse failure.
   */
  if (pagesWithText === 0 && ocrPending.length === 0) refuse('parse_failed')

  return accumulator.result(pages.length, ocrPending)
}

/**
 * The text of a PDF, one section per page.
 *
 * Never throws anything but `ExtractionError`. A `RangeError` from a slice, a surprise
 * from a decoder or a stack overflow on a pathological file all become `parse_failed`, so
 * a caller has one kind of failure to handle and no document-shaped string can reach a
 * log line.
 */
export function extractPdf (bytes: Uint8Array): ExtractionResult {
  try {
    return extract(bytes)
  } catch (error) {
    if (error instanceof ExtractionError) throw error
    refuse('parse_failed')
  }
}
