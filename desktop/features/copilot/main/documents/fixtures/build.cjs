'use strict'

/*
 * Real documents, built byte by byte, so tests can read something genuine.
 *
 * Why generated rather than committed. The parsers beside this folder are tested against
 * PDFs and against the ZIP-based Office formats. A committed binary would be invisible in
 * review, unreadable in a diff, and impossible to adjust when a test needs one more page
 * or one fewer heading. So every fixture here is assembled at test time from the bytes
 * the format actually requires: numbered objects at recorded offsets, a real
 * cross-reference table, a real central directory, real CRCs.
 *
 * Why plain CommonJS. A test file requires this module directly with
 * `require('./fixtures/build.cjs')`, so it has to run under plain `node` without the
 * TypeScript build. It is deliberately not imported by the app and not re-exported from
 * `main/ipc/index.ts`: nothing the product ships should depend on a test helper. It is
 * also never referenced by `scripts/build-main.mjs`, so it is not in the bundle.
 *
 * The three properties every builder below keeps: byte offsets are computed from the
 * bytes that were actually written rather than guessed, text is escaped by the rules of
 * the format rather than by a general-purpose encoder, and bad input raises a plain Error
 * naming what was wrong instead of producing a file that merely looks right. A fixture
 * that is only plausible is worse than no fixture, because the tests written against it
 * prove nothing.
 */

const zlib = require('node:zlib')

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

/** A buffer in the one-byte encoding everything here is written in. */
function latin1 (text) {
  return Buffer.from(text, 'latin1')
}

/** What went wrong, by shape, without quoting whatever was passed in. */
function describe (value) {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'an array'
  const kind = typeof value
  return kind === 'object' ? 'an object' : `a ${kind}`
}

/**
 * The bytes of a caller-supplied value.
 *
 * A string is taken as UTF-8, which is what a document body means by "text". Anything
 * else is refused rather than coerced: `String(value)` on an object produces
 * `[object Object]`, and a fixture full of that would fail somewhere far from the call
 * that caused it.
 */
function toBytes (value, caller) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  throw new Error(`${caller}: expected a Buffer, a Uint8Array or a string, got ${describe(value)}`)
}

/**
 * Options, or an empty set.
 *
 * An array is refused even though it is an object: `buildDocx({ paragraphs: [...] })` and
 * `buildDocx([...])` look close enough in a test that the mistake should be named rather
 * than silently producing an empty document.
 */
function optionsOf (value, caller) {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${caller}: options must be an object, got ${describe(value)}`)
  }
  return value
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

/*
 * The shell of a PDF is three things: a header, numbered objects whose byte offsets are
 * recorded as they are written, and a cross-reference table that repeats those offsets so
 * a reader can seek instead of scan. The table is the part a hand-written fixture usually
 * gets wrong, and the one part a real reader notices immediately, so every builder below
 * shares `pdfTail`: there is exactly one place that formats an entry.
 */

/** A marker on the second line, so a file is not mistaken for text by a transfer tool. */
const PDF_BINARY_COMMENT = Buffer.from('%\xe2\xe3\xcf\xd3\n', 'latin1')

/*
 * Fixed object numbers rather than an allocator.
 *
 * A fixture that numbers its objects the same way every time is byte-stable, so a test can
 * assert on a snippet of it, and a numbering mistake fails here rather than turning into a
 * mystery inside a reader. The image object is always present even when no page draws it,
 * which keeps the page numbers independent of the caller's options.
 */
const PDF_CATALOG = 1
const PDF_PAGES = 2
const PDF_FONT = 3
const PDF_IMAGE = 4
const PDF_FIRST_PAGE = 5

/** A ceiling, so a mistyped argument cannot allocate gigabytes inside a test run. */
const MAX_PDF_PAGES = 5000

function requirePageCount (caller, value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${caller}: pageCount must be a whole number of at least 1, got ${describe(value)}`)
  }
  if (value > MAX_PDF_PAGES) {
    throw new Error(`${caller}: pageCount ${value} is above the ${MAX_PDF_PAGES}-page ceiling this fixture keeps`)
  }
  return value
}

function pdfPrefix (version) {
  return Buffer.concat([latin1(`%PDF-${version}\n`), PDF_BINARY_COMMENT])
}

/**
 * The table, the trailer and the end marker.
 *
 * `offsets` is indexed by object number minus one, so `offsets[0]` describes object 1, and
 * a value of -1 marks an object number that was never written. `startxref` is the length
 * of everything before it, which is what makes that number honest: it is not a value the
 * builder believed, it is the count of bytes it had already produced.
 *
 * The trailer is the cross-reference table's own dictionary, so `/Encrypt` written here is
 * `/Encrypt` written to the table.
 */
function pdfTail (offsets, startxref, options) {
  const size = offsets.length + 1
  const lines = [`xref\n0 ${size}\n`, '0000000000 65535 f \n']
  for (const at of offsets) {
    lines.push(at < 0 ? '0000000000 00000 f \n' : `${String(at).padStart(10, '0')} 00000 n \n`)
  }

  const encrypt = options.encrypt === true ? ' /Encrypt << /Filter /Standard >>' : ''
  const root = options.root === undefined ? PDF_CATALOG : options.root
  lines.push(`trailer\n<< /Size ${size} /Root ${root} 0 R${encrypt} >>\nstartxref\n${startxref}\n%%EOF\n`)
  return latin1(lines.join(''))
}

/** One stream object: a dictionary followed by the length of the payload it declares. */
function pdfStream (payload, filtered) {
  const dictionary = filtered
    ? `<< /Filter /FlateDecode /Length ${payload.length} >>`
    : `<< /Length ${payload.length} >>`
  return Buffer.concat([latin1(`${dictionary}\nstream\n`), payload, latin1('\nendstream')])
}

/**
 * Text as a PDF literal string.
 *
 * Parentheses and backslashes delimit the form, so they have to be escaped; a carriage
 * return or newline would end the visible line inside the string, so those become their
 * escapes too. A character outside Latin-1 is refused rather than truncated: silently
 * dropping half of a character would put a different word in the fixture from the one the
 * caller wrote, and the test would then be about the wrong text.
 */
function escapePdfText (text) {
  let escaped = ''
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at)
    if (code > 0xff) {
      throw new Error(
        `escapePdfText: the character at position ${at + 1} is U+${code.toString(16).toUpperCase()}, outside the single-byte range a PDF string holds here`,
      )
    }
    const character = text.charAt(at)
    if (character === '\\' || character === '(' || character === ')') {
      escaped += `\\${character}`
      continue
    }
    if (character === '\n') {
      escaped += '\\n'
      continue
    }
    if (character === '\r') {
      escaped += '\\r'
      continue
    }
    escaped += character
  }
  return escaped
}

/**
 * One page's content stream source.
 *
 * An image-only page draws a 100 by 100 unit picture and nothing else. That is what a
 * scanned page looks like once it has been wrapped in a PDF, and it is the only honest way
 * to prove a parser reports "needs OCR" instead of "empty page": the page has a content
 * stream, so it is not blank, but no text operator appears in it.
 *
 * A blank page (no lines, not image-only) emits an empty stream. Both are real states, and
 * a caller that wants one should not have to hand-write operators to get it.
 */
function pdfPageContent (page, options) {
  if (page.imageOnly === true) return 'q 100 0 0 100 0 0 cm /Im1 Do Q\n'

  const lines = page.lines === undefined ? [] : page.lines
  if (!Array.isArray(lines)) {
    throw new Error(`buildPdf: page.lines must be an array of strings, got ${describe(lines)}`)
  }
  if (lines.length === 0) return ''

  const parts = ['BT /F1 12 Tf 72 720 Td']
  for (const [index, line] of lines.entries()) {
    if (typeof line !== 'string') {
      throw new Error(`buildPdf: line ${index + 1} of a page must be a string, got ${describe(line)}`)
    }

    /*
     * One line as a kerning array instead of a shown string. The split is deliberately
     * mid-word: the numbers in a TJ array are spacing in thousandths of an em, so a reader
     * that turns them into spaces would turn "Installation" into "Install ation". That
     * failure has nowhere to show unless a fixture contains one.
     */
    if (options.tjArray === true && index === 0) {
      const cut = Math.max(1, Math.floor(line.length / 2))
      parts.push(`[ (${escapePdfText(line.slice(0, cut))}) -250 (${escapePdfText(line.slice(cut))}) ] TJ`)
      parts.push('0 -14 Td')
      continue
    }

    parts.push(`(${escapePdfText(line)}) Tj`)
    parts.push('0 -14 Td')
  }
  parts.push('ET')
  return `${parts.join(' ')}\n`
}

/**
 * A PDF from a list of object bodies, in object-number order.
 *
 * The offsets are recorded as each chunk is appended, so the table describes the file that
 * exists rather than the file the builder intended. `offset` at the end of the loop is the
 * position of the next byte, which is where `xref` starts.
 */
function assemblePdf (objects, options) {
  const prefix = pdfPrefix(options.version === undefined ? '1.4' : options.version)
  const chunks = [prefix]
  const offsets = []
  let offset = prefix.length

  objects.forEach((body, index) => {
    if (!Buffer.isBuffer(body)) {
      throw new Error(`assemblePdf: object ${index + 1} is not a buffer`)
    }
    const chunk = Buffer.concat([latin1(`${index + 1} 0 obj\n`), body, latin1('\nendobj\n')])
    offsets.push(offset)
    chunks.push(chunk)
    offset += chunk.length
  })

  chunks.push(pdfTail(offsets, offset, options))
  return Buffer.concat(chunks)
}

/** One page of a PDF, drawn into the shared assembler. */
function writePdfPage (put, page, index, options) {
  if (page === null || typeof page !== 'object') {
    throw new Error(`buildPdf: page ${index + 1} must be an object, got ${describe(page)}`)
  }

  const pageObject = PDF_FIRST_PAGE + index * 2
  const contentObject = pageObject + 1
  const source = pdfPageContent(page, options)

  /*
   * Compressed by default, because that is what every real writer does and therefore what
   * a reader has to handle. `plain` leaves the operators visible in the bytes, which is
   * what a test about escaping or about operators needs.
   */
  const raw = latin1(source)
  const filtered = options.plain !== true
  const payload = filtered ? zlib.deflateSync(raw) : raw

  put(pageObject, latin1(
    `<< /Type /Page /Parent ${PDF_PAGES} 0 R /MediaBox [0 0 595 842] ` +
    `/Resources << /Font << /F1 ${PDF_FONT} 0 R >> /XObject << /Im1 ${PDF_IMAGE} 0 R >> >> ` +
    `/Contents ${contentObject} 0 R >>`,
  ))
  put(contentObject, pdfStream(payload, filtered))
}

/**
 * A PDF of the given pages.
 *
 * A page is `{ lines?: string[], imageOnly?: boolean }`. `lines` are drawn one per line at
 * 12 point; `imageOnly` draws a picture and no text; neither means a blank page.
 */
function buildPdf (pages, opts) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`buildPdf: pages must be a non-empty array, got ${describe(pages)}`)
  }
  if (pages.length > MAX_PDF_PAGES) {
    throw new Error(`buildPdf: ${pages.length} pages is above the ${MAX_PDF_PAGES}-page ceiling this fixture keeps`)
  }
  const options = optionsOf(opts, 'buildPdf')

  /*
   * Filled by object number rather than appended, so a numbering mistake is caught below
   * instead of shifting every later object by one and producing a file that opens with a
   * page missing.
   */
  const objects = []
  const put = (number, body) => {
    if (objects[number - 1] !== undefined) throw new Error(`buildPdf: object ${number} was written twice`)
    objects[number - 1] = body
  }

  const kids = pages.map((page, index) => `${PDF_FIRST_PAGE + index * 2} 0 R`)

  put(PDF_CATALOG, latin1(`<< /Type /Catalog /Pages ${PDF_PAGES} 0 R >>`))
  put(PDF_PAGES, latin1(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`))
  put(PDF_FONT, latin1('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'))

  /*
   * A flat grey square, so an image-only page draws something real. Every sample is 0x00,
   * which has a second benefit: the bytes cannot spell a text operator by accident, so the
   * scanned-PDF test can assert that no text operator appears anywhere in the file.
   */
  const image = Buffer.alloc(64, 0x00)
  put(PDF_IMAGE, Buffer.concat([
    latin1('<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length 64 >>\nstream\n'),
    image,
    latin1('\nendstream'),
  ]))

  pages.forEach((page, index) => writePdfPage(put, page, index, options))

  for (let at = 0; at < objects.length; at += 1) {
    if (objects[at] === undefined) throw new Error(`buildPdf: object ${at + 1} was never written`)
  }

  return assemblePdf(objects, options)
}

/**
 * A PDF of `pageCount` text pages, one distinct line each.
 *
 * Uncompressed streams: the pages exist so a test can prove a long document is read in
 * pieces, and 200 deflate calls would be work nobody is testing. The content is built as
 * one string per page, so the cost is linear in the page count.
 */
function buildLargePdf (pageCount) {
  const pages = new Array(requirePageCount('buildLargePdf', pageCount))
  for (let at = 0; at < pages.length; at += 1) {
    pages[at] = { lines: [`Page ${at + 1} of the Tilley survey.`] }
  }
  return buildPdf(pages, { plain: true })
}

/** A PDF whose every page is image-only, so a parser must ask for OCR rather than guess. */
function buildScannedPdf (pageCount) {
  const pages = new Array(requirePageCount('buildScannedPdf', pageCount))
  for (let at = 0; at < pages.length; at += 1) pages[at] = { imageOnly: true }
  return buildPdf(pages, { plain: true })
}

/**
 * A PDF whose objects the caller writes verbatim, inside a well-formed shell.
 *
 * For the malformed cases a builder would refuse to produce: a page whose `/Contents`
 * names an object that was never written, a stream that lies about its length, a
 * dictionary that never closes. The shell around them stays correct, so the reader is
 * tested on the one thing that is wrong rather than on a file that is wrong everywhere.
 *
 * Object headers are found by scanning for `N 0 obj`, which is safe here because the
 * caller is writing a fixture by hand and knows what that pattern means inside it. The
 * numbers must ascend: a body that writes object 7 and then object 3 is a mistake in the
 * call, not a document.
 *
 * A body with no objects is allowed. The shell is then still well formed and names a
 * `/Root` that does not exist, which is exactly the file a reader should refuse for having
 * no pages.
 */
function buildPdfRaw (body) {
  if (typeof body !== 'string') {
    throw new Error(`buildPdfRaw: body must be a string of PDF objects, got ${describe(body)}`)
  }

  const payload = latin1(body)
  /*
   * A byte offset is only the same as a string index while every character is one byte.
   * `latin1` encoding would silently keep the low byte of anything wider, so the check has
   * to be on the characters rather than on the encoded length.
   */
  if (/[\u0100-\uffff]/.test(body)) {
    throw new Error('buildPdfRaw: body holds a character outside Latin-1, so its byte offsets cannot be measured')
  }

  const prefix = pdfPrefix('1.4')
  const found = new Map()
  let previous = 0
  const pattern = /(\d+)[ \t]+0[ \t]+obj/g
  let match = pattern.exec(body)
  while (match !== null) {
    const number = Number(match[1])
    if (number <= previous) {
      throw new Error(`buildPdfRaw: object ${number} follows object ${previous}; objects must be numbered upwards`)
    }
    previous = number
    found.set(number, prefix.length + match.index)
    match = pattern.exec(body)
  }

  const offsets = new Array(found.size === 0 ? 0 : previous).fill(-1)
  let root = PDF_CATALOG
  let lowest = 0
  for (const [number, at] of found) {
    offsets[number - 1] = at
    if (lowest === 0 || number < lowest) lowest = number
  }
  if (lowest !== 0) root = lowest

  const assembled = Buffer.concat([prefix, payload])
  return Buffer.concat([assembled, pdfTail(offsets, assembled.length, { root })])
}

/* ------------------------------------------------------------------ *
 * ZIP: the container DOCX, XLSX and PPTX already are
 * ------------------------------------------------------------------ */

const ZIP_LOCAL_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_SIGNATURE = 0x02014b50
const ZIP_EOCD_SIGNATURE = 0x06054b50

/** Compression method 0 is STORE: the bytes are written as they are. */
const ZIP_METHOD_STORE = 0

/** Bit 11 says the name is UTF-8, which is what it is. */
const ZIP_FLAG_UTF8 = 0x0800

/** 1980-01-01, the earliest date a DOS timestamp holds. Fixed, so output is byte-stable. */
const ZIP_DOS_DATE = 0x0021
const ZIP_DOS_TIME = 0x0000

const MAX_ZIP_UINT32 = 0xffffffff
const MAX_ZIP_NAME = 0xffff

/**
 * CRC-32 as ZIP defines it: reflected, polynomial 0xEDB88320, initial and final value
 * 0xFFFFFFFF.
 *
 * Implemented rather than faked because the per-entry checksum is the field a reader uses
 * to tell a complete entry from a truncated one. A fixture with a zeroed CRC would be
 * accepted by a lenient reader and rejected by a strict one, so tests built on it would
 * prove the wrong thing. The standard check value is asserted in the test file: CRC-32 of
 * the nine bytes "123456789" is 0xCBF43926.
 */
const CRC32_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[index] = value
  }
  return table
})()

function crc32 (bytes) {
  const data = toBytes(bytes, 'crc32')
  let value = -1
  for (let at = 0; at < data.length; at += 1) {
    value = CRC32_TABLE[(value ^ data[at]) & 0xff] ^ (value >>> 8)
  }
  return (value ^ -1) >>> 0
}

function requireUint32 (caller, value, what) {
  if (value > MAX_ZIP_UINT32) {
    throw new Error(`${caller}: ${what} is ${value} bytes, which a ZIP without ZIP64 cannot describe`)
  }
  return value
}

/**
 * A STORE-only ZIP.
 *
 * STORE rather than deflate on purpose. These fixtures exist to be read by a parser, and an
 * uncompressed entry means the XML inside can be inspected in a diff, grepped for a part
 * name, and compared byte for byte without an inflate step in the way. The compressed path
 * belongs to a real writer, not to a fixture.
 *
 * Offsets are accumulated as each local header is appended, so every central directory
 * entry points at the header it describes. That number is what a reader seeks to, and
 * getting it wrong produces an archive that lists its parts but cannot open them.
 */
function storeZip (entries) {
  if (!Array.isArray(entries)) {
    throw new Error(`storeZip: entries must be an array, got ${describe(entries)}`)
  }

  const chunks = []
  const directory = []
  let offset = 0

  for (const [index, entry] of entries.entries()) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error(`storeZip: entry ${index + 1} must be an object with a name and data`)
    }
    if (typeof entry.name !== 'string' || entry.name === '') {
      throw new Error(`storeZip: entry ${index + 1} needs a non-empty name`)
    }
    if (entry.name.length > MAX_ZIP_NAME) {
      throw new Error(`storeZip: the name of entry ${index + 1} is longer than a ZIP can hold`)
    }

    const nameBytes = Buffer.from(entry.name, 'utf8')
    // The length a ZIP stores is a count of bytes, and a name of accented characters is
    // more bytes than it is characters.
    if (nameBytes.length > MAX_ZIP_NAME) {
      throw new Error(`storeZip: the name of entry ${index + 1} is longer than a ZIP can hold once encoded`)
    }
    const data = toBytes(entry.data, `storeZip: the data of "${entry.name}"`)
    const checksum = crc32(data)
    requireUint32('storeZip', offset, 'the offset of this entry')
    requireUint32('storeZip', data.length, `the size of "${entry.name}"`)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(ZIP_LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(ZIP_FLAG_UTF8, 6)
    local.writeUInt16LE(ZIP_METHOD_STORE, 8)
    local.writeUInt16LE(ZIP_DOS_TIME, 10)
    local.writeUInt16LE(ZIP_DOS_DATE, 12)
    local.writeUInt32LE(checksum, 14)
    // STORE holds the same bytes either way, so both sizes are the data's own length.
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBytes, data)
    directory.push({ nameBytes, checksum, size: data.length, localOffset: offset })
    offset += local.length + nameBytes.length + data.length
  }

  const directoryOffset = offset

  for (const record of directory) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(ZIP_CENTRAL_SIGNATURE, 0)
    // `version made by` with a 0 in the host byte: MS-DOS attribute semantics, which is
    // what a file this simple is.
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(ZIP_FLAG_UTF8, 8)
    header.writeUInt16LE(ZIP_METHOD_STORE, 10)
    header.writeUInt16LE(ZIP_DOS_TIME, 12)
    header.writeUInt16LE(ZIP_DOS_DATE, 14)
    header.writeUInt32LE(record.checksum, 16)
    header.writeUInt32LE(record.size, 20)
    header.writeUInt32LE(record.size, 24)
    header.writeUInt16LE(record.nameBytes.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(record.localOffset, 42)

    chunks.push(header, record.nameBytes)
    offset += header.length + record.nameBytes.length
  }

  const directorySize = offset - directoryOffset
  requireUint32('storeZip', directorySize, 'the central directory')
  requireUint32('storeZip', directoryOffset, 'the central directory offset')

  const end = Buffer.alloc(22)
  end.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(directory.length, 8)
  end.writeUInt16LE(directory.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(directoryOffset, 16)
  end.writeUInt16LE(0, 20)

  chunks.push(end)
  return Buffer.concat(chunks)
}

/* ------------------------------------------------------------------ *
 * Shared XML
 * ------------------------------------------------------------------ */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * Text with the five predefined entities escaped, in one pass.
 *
 * One pass matters: a chained `replace` would turn the four characters `&amp;lt;` into
 * `<`, which is a different document from the one the caller asked for. `>` and the quotes
 * are escaped as well as the two that are strictly required, so the same function is safe
 * in text and in an attribute value.
 */
function escapeXml (text) {
  if (typeof text !== 'string') {
    throw new Error(`escapeXml: expected a string, got ${describe(text)}`)
  }
  let escaped = ''
  for (let at = 0; at < text.length; at += 1) {
    const character = text.charAt(at)
    if (character === '&') {
      escaped += '&amp;'
      continue
    }
    if (character === '<') {
      escaped += '&lt;'
      continue
    }
    if (character === '>') {
      escaped += '&gt;'
      continue
    }
    if (character === '"') {
      escaped += '&quot;'
      continue
    }
    if (character === "'") {
      escaped += '&apos;'
      continue
    }
    escaped += character
  }
  return escaped
}

/** A package's content types: the two Defaults every OOXML package needs, plus overrides. */
function contentTypesXml (overrides) {
  const lines = [
    XML_DECLARATION,
    `<Types xmlns="${CONTENT_TYPES_NS}">`,
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
  ]
  for (const [partName, contentType] of overrides) {
    lines.push(`  <Override PartName="/${partName}" ContentType="${contentType}"/>`)
  }
  lines.push('</Types>', '')
  return lines.join('\n')
}

/** A `.rels` part from `{ id, type, target }` records, in the order given. */
function relationshipsXml (records) {
  const lines = [XML_DECLARATION, `<Relationships xmlns="${RELATIONSHIPS_NS}">`]
  for (const record of records) {
    lines.push(
      `  <Relationship Id="${record.id}" Type="${record.type}" Target="${escapeXml(record.target)}"/>`,
    )
  }
  lines.push('</Relationships>', '')
  return lines.join('\n')
}

/** The package-level relationships part, naming the one part that holds the content. */
function packageRels (target) {
  return relationshipsXml([
    { id: 'rId1', type: `${OFFICE_REL}/officeDocument`, target },
  ])
}

/**
 * The part number for each position, in presentation order.
 *
 * Without `shufflePartNames` the nth slide is `slide(n).xml`, which is what a writer
 * produces and what a naive reader assumes. With it the numbers are reversed, so
 * `slide1.xml` holds the last slide in the deck. The point is to make "the order comes
 * from the package's own description" a property a test can fail on: a reader that sorts
 * file names, or trusts `slide1` as the first slide, gets the deck backwards.
 */
function partNumbers (count, shuffled) {
  const numbers = new Array(count)
  for (let at = 0; at < count; at += 1) numbers[at] = shuffled ? count - at : at + 1
  return numbers
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const WORD_MAIN_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
const WORD_STYLES_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'

/**
 * The paragraph styles this fixture defines in `word/styles.xml`, keyed by the id a
 * paragraph names and valued by the display name Word knows the style by.
 *
 * Anything else is refused: a `w:pStyle` pointing at a style defined nowhere is a document
 * Word offers to repair, and a fixture that needs repairing before it can be read is not
 * the fixture a parser test wants.
 */
const DOCX_STYLES = new Map([
  ['Title', 'Title'],
  ['Subtitle', 'Subtitle'],
  ['Heading1', 'heading 1'],
  ['Heading2', 'heading 2'],
  ['Heading3', 'heading 3'],
])

/**
 * One paragraph's runs.
 *
 * A tab is its own element in WordprocessingML rather than a character inside a text run,
 * so a paragraph written with tabs is split around them. `xml:space="preserve"` keeps the
 * leading and trailing spaces the caller typed, which the format otherwise strips.
 */
function docxRuns (paragraph, position) {
  const text = paragraph.text

  if (text === undefined) {
    // An indent with no words is a real thing in a document, and `tabs: true` is how a
    // caller asks for one without inventing text to put beside it.
    if (paragraph.tabs === true) return '<w:r><w:tab/></w:r>'
    throw new Error(`buildDocx: paragraph ${position} has no text`)
  }
  if (typeof text !== 'string') {
    throw new Error(`buildDocx: the text of paragraph ${position} must be a string, got ${describe(text)}`)
  }

  if (paragraph.tabs !== true) {
    return `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  }

  const runs = []
  for (const [index, piece] of text.split('\t').entries()) {
    if (index > 0) runs.push('<w:r><w:tab/></w:r>')
    if (piece !== '') runs.push(`<w:r><w:t xml:space="preserve">${escapeXml(piece)}</w:t></w:r>`)
  }
  return runs.join('')
}

/**
 * A Word document of the given paragraphs.
 *
 * `paragraphs` is `[{ text, style?, tabs? }]`. One section is enough for a fixture: the
 * reader groups by heading style, not by section, so a second `w:sectPr` would add a page
 * break nothing reads.
 */
function buildDocx (opts) {
  const options = optionsOf(opts, 'buildDocx')
  const paragraphs = options.paragraphs
  if (!Array.isArray(paragraphs)) {
    throw new Error(`buildDocx: options.paragraphs must be an array, got ${describe(paragraphs)}`)
  }

  const body = paragraphs.map((paragraph, index) => {
    const position = index + 1
    if (paragraph === null || typeof paragraph !== 'object' || Array.isArray(paragraph)) {
      throw new Error(`buildDocx: paragraph ${position} must be an object, got ${describe(paragraph)}`)
    }

    const style = paragraph.style
    if (style !== undefined && !DOCX_STYLES.has(style)) {
      throw new Error(
        `buildDocx: paragraph ${position} names the style "${style}", which this fixture does not define`,
      )
    }

    const properties = style === undefined ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
    return `    <w:p>${properties}${docxRuns(paragraph, position)}</w:p>`
  })

  const documentXml = [
    XML_DECLARATION,
    `<w:document xmlns:w="${WORD_NS}" xmlns:r="${OFFICE_REL}">`,
    '  <w:body>',
    ...body,
    // A section with a page size, so the body is a complete one rather than a fragment.
    '    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    '  </w:body>',
    '</w:document>',
    '',
  ].join('\n')

  const stylesXml = [
    XML_DECLARATION,
    `<w:styles xmlns:w="${WORD_NS}">`,
    '  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    ...[...DOCX_STYLES].map(([id, name]) => (
      `  <w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/></w:style>`
    )),
    '</w:styles>',
    '',
  ].join('\n')

  return storeZip([
    {
      name: '[Content_Types].xml',
      data: contentTypesXml(new Map([
        ['word/document.xml', WORD_MAIN_TYPE],
        ['word/styles.xml', WORD_STYLES_TYPE],
      ])),
    },
    { name: '_rels/.rels', data: packageRels('word/document.xml') },
    { name: 'word/document.xml', data: documentXml },
    {
      name: 'word/_rels/document.xml.rels',
      data: relationshipsXml([
        { id: 'rId1', type: `${OFFICE_REL}/styles`, target: 'styles.xml' },
      ]),
    },
    { name: 'word/styles.xml', data: stylesXml },
  ])
}

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const SHARED_STRINGS_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml'
const WORKSHEET_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'

/** Excel's own limits, enforced here so a fixture cannot be a workbook Excel would refuse. */
const XLSX_MAX_NAME = 31
const XLSX_FORBIDDEN = '[]:*?/\\'

/** The letters of a 0-based column index: 0 is A, 25 is Z, 26 is AA. */
function columnName (index) {
  let name = ''
  let at = index
  while (at >= 0) {
    name = String.fromCharCode(65 + (at % 26)) + name
    at = Math.floor(at / 26) - 1
  }
  return name
}

function requireSheetName (value, position) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`buildXlsx: sheet ${position} needs a non-empty name`)
  }
  if (value.length > XLSX_MAX_NAME) {
    throw new Error(
      `buildXlsx: the name of sheet ${position} is longer than the ${XLSX_MAX_NAME} characters Excel allows`,
    )
  }
  for (const character of XLSX_FORBIDDEN) {
    if (value.includes(character)) {
      throw new Error(
        `buildXlsx: the name of sheet ${position} holds "${character}", which Excel forbids in a tab name`,
      )
    }
  }
  return value
}

/** One worksheet part. `sharedFor` answers with the index a string has in the shared table. */
function xlsxSheetXml (rows, sharedFor) {
  if (!Array.isArray(rows)) {
    throw new Error(`buildXlsx: a sheet's rows must be an array of rows, got ${describe(rows)}`)
  }

  const built = []
  for (const [rowIndex, row] of rows.entries()) {
    if (!Array.isArray(row)) {
      throw new Error(`buildXlsx: row ${rowIndex + 1} must be an array of cells, got ${describe(row)}`)
    }

    const cells = []
    for (const [columnIndex, cell] of row.entries()) {
      /*
       * A null cell is a gap, and a gap is written by leaving the cell out entirely. That
       * is how a sheet says "this row has nothing under the third heading", and a reader
       * is expected to keep the hole visible rather than closing it up.
       */
      if (cell === null || cell === undefined) continue

      const reference = `${columnName(columnIndex)}${rowIndex + 1}`
      if (typeof cell === 'string') {
        // `t="s"` means the value is an index into the shared table, not the text itself.
        cells.push(`<c r="${reference}" t="s"><v>${sharedFor(cell)}</v></c>`)
        continue
      }
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        // No `t` attribute at all is a number, which is what the default form means.
        cells.push(`<c r="${reference}"><v>${String(cell)}</v></c>`)
        continue
      }
      throw new Error(
        `buildXlsx: cell ${reference} must be a string, a finite number or null, got ${describe(cell)}`,
      )
    }
    built.push(`      <row r="${rowIndex + 1}">${cells.join('')}</row>`)
  }

  return [
    XML_DECLARATION,
    `<worksheet xmlns="${SHEET_NS}">`,
    '  <sheetData>',
    ...built,
    '  </sheetData>',
    '</worksheet>',
    '',
  ].join('\n')
}

/**
 * A workbook of the given sheets.
 *
 * `sheets` is `[{ name, rows }]` in tab order, and a row is an array of strings, numbers
 * and nulls. `shufflePartNames: true` names and writes the worksheet parts so that neither
 * the file names nor the archive's order match the tab bar, which is the only way a test
 * can prove a reader follows `xl/workbook.xml`.
 */
function buildXlsx (opts) {
  const options = optionsOf(opts, 'buildXlsx')
  const sheets = options.sheets
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error(`buildXlsx: options.sheets must be a non-empty array, got ${describe(sheets)}`)
  }

  const numbers = partNumbers(sheets.length, options.shufflePartNames === true)
  const names = sheets.map((sheet, index) => {
    if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) {
      throw new Error(`buildXlsx: sheet ${index + 1} must be an object, got ${describe(sheet)}`)
    }
    return requireSheetName(sheet.name, index + 1)
  })

  /*
   * One table of shared strings for the whole workbook, filled in the order the cells are
   * visited. A string that appears twice keeps the first index, which is what makes the
   * table worth having: the second cell stores a number, not the sentence again.
   */
  const shared = []
  const known = new Map()
  const sharedFor = (text) => {
    const found = known.get(text)
    if (found !== undefined) return found
    const index = shared.length
    known.set(text, index)
    shared.push(text)
    return index
  }

  // Built in presentation order, so the table's indices stay stable however the parts are
  // named afterwards.
  const sheetParts = sheets.map((sheet, index) => ({
    part: `xl/worksheets/sheet${numbers[index]}.xml`,
    xml: xlsxSheetXml(sheet.rows, sharedFor),
  }))

  const workbookXml = [
    XML_DECLARATION,
    `<workbook xmlns="${SHEET_NS}" xmlns:r="${OFFICE_REL}">`,
    '  <sheets>',
    ...names.map((name, index) => (
      `    <sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )),
    '  </sheets>',
    '</workbook>',
    '',
  ].join('\n')

  /*
   * The relationship ids are numbered in tab order and point at whatever part number that
   * tab was given, so the shuffle shows in the targets and nowhere else. A reader that
   * trusted `rId1` to mean `sheet1.xml` would be wrong here.
   */
  const workbookRels = relationshipsXml([
    ...numbers.map((part, index) => ({
      id: `rId${index + 1}`,
      type: `${OFFICE_REL}/worksheet`,
      target: `worksheets/sheet${part}.xml`,
    })),
    {
      id: `rId${numbers.length + 1}`,
      type: `${OFFICE_REL}/sharedStrings`,
      target: 'sharedStrings.xml',
    },
  ])

  const sharedStringsXml = [
    XML_DECLARATION,
    `<sst xmlns="${SHEET_NS}" count="${shared.length}" uniqueCount="${shared.length}">`,
    ...shared.map((text) => `  <si><t xml:space="preserve">${escapeXml(text)}</t></si>`),
    '</sst>',
    '',
  ].join('\n')

  const overrides = new Map([
    ['xl/workbook.xml', WORKBOOK_TYPE],
    ['xl/sharedStrings.xml', SHARED_STRINGS_TYPE],
  ])
  for (const part of sheetParts) overrides.set(part.part, WORKSHEET_TYPE)

  /*
   * The worksheet parts are written in reverse when they are shuffled, so the archive's own
   * order disagrees with the tab bar as well as the file names doing so. A reader that
   * walks the entries it finds, instead of following `xl/workbook.xml`, lands on the wrong
   * sheet twice over rather than accidentally right.
   */
  const written = options.shufflePartNames === true ? [...sheetParts].reverse() : sheetParts

  return storeZip([
    { name: '[Content_Types].xml', data: contentTypesXml(overrides) },
    { name: '_rels/.rels', data: packageRels('xl/workbook.xml') },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/sharedStrings.xml', data: sharedStringsXml },
    ...written.map((part) => ({ name: part.part, data: part.xml })),
  ])
}

/* ------------------------------------------------------------------ *
 * PPTX
 * ------------------------------------------------------------------ */

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const PRESENTATION_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
const SLIDE_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
const NOTES_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'

/** One `<a:p>` per line, which is the only thing a text reader looks for. */
function pptxParagraphs (lines, where) {
  if (!Array.isArray(lines)) {
    throw new Error(`${where}: must be an array of strings, got ${describe(lines)}`)
  }
  return lines.map((line, index) => {
    if (typeof line !== 'string') {
      throw new Error(`${where}: line ${index + 1} must be a string, got ${describe(line)}`)
    }
    return `          <a:p><a:r><a:t>${escapeXml(line)}</a:t></a:r></a:p>`
  })
}

/**
 * The notes of one slide, as an array of lines.
 *
 * A single string is one line, because that is how a caller with a one-line note thinks of
 * it. Nothing else is accepted: a number or an object here would become `[object Object]`
 * inside a slide, which is the kind of fixture that makes a parser test meaningless.
 */
function pptxNotesLines (notes, where) {
  if (notes === undefined || notes === null) return []
  if (typeof notes === 'string') return [notes]
  if (!Array.isArray(notes)) {
    throw new Error(`${where}: must be a string or an array of strings, got ${describe(notes)}`)
  }
  return notes
}

/**
 * The shape tree every slide and notes page needs.
 *
 * Written out rather than collapsed to a bare `<a:p>`: a DrawingML part whose paragraphs
 * float outside a shape is not a slide, and a fixture that only a lenient scanner can read
 * tests the scanner's leniency rather than its reading.
 */
function pptxBodyXml (lines, where) {
  return [
    '      <p:sp>',
    '        <p:txBody>',
    '          <a:bodyPr/>',
    ...pptxParagraphs(lines, where),
    '        </p:txBody>',
    '      </p:sp>',
  ].join('\n')
}

function pptxPartXml (root, lines, where) {
  return [
    XML_DECLARATION,
    `<p:${root} xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${PRESENTATION_NS}">`,
    '  <p:cSld>',
    '    <p:spTree>',
    pptxBodyXml(lines, where),
    '    </p:spTree>',
    '  </p:cSld>',
    `</p:${root}>`,
    '',
  ].join('\n')
}

/**
 * A deck of the given slides.
 *
 * `slides` is `[{ lines, notes? }]` in presentation order. Slide order comes from
 * `p:sldIdLst`, and `shufflePartNames: true` numbers the parts backwards so a reader cannot
 * get that order right by trusting a file name.
 *
 * What this deck does not carry: a slide master, a layout or a theme. A real PowerPoint
 * file has all three, and without them PowerPoint itself would offer to repair this file.
 * They are omitted because text extraction never follows those relationships, and three
 * more parts of boilerplate would be three more things to keep correct in a fixture. The
 * notes pages are here because the reader does follow them, and because getting the wrong
 * notes onto a slide is silent.
 */
function buildPptx (opts) {
  const options = optionsOf(opts, 'buildPptx')
  const slides = options.slides
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error(`buildPptx: options.slides must be a non-empty array, got ${describe(slides)}`)
  }

  const numbers = partNumbers(slides.length, options.shufflePartNames === true)

  const parts = slides.map((slide, index) => {
    const position = index + 1
    if (slide === null || typeof slide !== 'object' || Array.isArray(slide)) {
      throw new Error(`buildPptx: slide ${position} must be an object, got ${describe(slide)}`)
    }

    /*
     * Validated here rather than where the XML is built, so a bad slide is named by its
     * position in the deck the caller passed and not by a part number nobody recognises.
     */
    const where = `buildPptx: slide ${position}`

    return {
      part: numbers[index],
      slideXml: pptxPartXml('sld', slide.lines, `${where} lines`),
      notes: pptxNotesLines(slide.notes, `${where} notes`),
    }
  })

  const presentationXml = [
    XML_DECLARATION,
    `<p:presentation xmlns:a="${DRAWING_NS}" xmlns:r="${OFFICE_REL}" xmlns:p="${PRESENTATION_NS}">`,
    '  <p:sldIdLst>',
    ...parts.map((part, index) => `    <p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`),
    '  </p:sldIdLst>',
    '  <p:sldSz cx="12192000" cy="6858000"/>',
    '</p:presentation>',
    '',
  ].join('\n')

  const presentationRels = relationshipsXml(parts.map((part, index) => ({
    id: `rId${index + 1}`,
    type: `${OFFICE_REL}/slide`,
    target: `slides/slide${part.part}.xml`,
  })))

  const slideParts = []
  for (const part of parts) {
    slideParts.push({ name: `ppt/slides/slide${part.part}.xml`, data: part.slideXml })
    if (part.notes.length === 0) continue

    /*
     * The notes part is reached only through the slide's own relationships, never by name.
     * A deck edited and saved has notes pages whose numbers no longer follow its slides, so
     * a reader that matches them by file name puts one slide's notes on another. The
     * relationship below is the whole of what says which slide the notes belong to.
     */
    slideParts.push({
      name: `ppt/slides/_rels/slide${part.part}.xml.rels`,
      data: relationshipsXml([{
        id: 'rId1',
        type: `${OFFICE_REL}/notesSlide`,
        target: `../notesSlides/notesSlide${part.part}.xml`,
      }]),
    })
    slideParts.push({
      name: `ppt/notesSlides/notesSlide${part.part}.xml`,
      data: pptxPartXml('notes', part.notes, `buildPptx: the notes of slide ${part.part}`),
    })
  }

  const overrides = new Map([['ppt/presentation.xml', PRESENTATION_TYPE]])
  for (const part of parts) {
    overrides.set(`ppt/slides/slide${part.part}.xml`, SLIDE_TYPE)
    if (part.notes.length > 0) {
      overrides.set(`ppt/notesSlides/notesSlide${part.part}.xml`, NOTES_TYPE)
    }
  }

  return storeZip([
    { name: '[Content_Types].xml', data: contentTypesXml(overrides) },
    { name: '_rels/.rels', data: packageRels('ppt/presentation.xml') },
    { name: 'ppt/presentation.xml', data: presentationXml },
    { name: 'ppt/_rels/presentation.xml.rels', data: presentationRels },
    ...slideParts,
  ])
}

/* ------------------------------------------------------------------ *
 * What a test file may ask for
 * ------------------------------------------------------------------ */

module.exports = {
  buildPdf,
  buildLargePdf,
  buildScannedPdf,
  buildPdfRaw,
  crc32,
  storeZip,
  buildDocx,
  buildXlsx,
  buildPptx,
}
