'use strict'

/*
 * The fixtures are only worth having if they are real, so this file proves that rather
 * than checking that each function returns a buffer.
 *
 * What is proven, and why each one matters:
 *
 * - The cross-reference table points at the objects. A PDF whose `startxref` is wrong, or
 *   whose entry offsets are a guess, opens in a viewer that scans for objects and fails in
 *   every reader that seeks. Checking the offset of each entry against the bytes it claims
 *   to describe is the only way to know the table was measured rather than assumed.
 * - The compressed streams are zlib streams. Inflating one proves it; a fixture marked
 *   FlateDecode whose payload was never deflated is exactly the near-miss that makes a
 *   parser test pass for the wrong reason.
 * - The CRC is the one the CRC-32 standard names. The check value for "123456789" is a
 *   published constant, so it is asserted against the standard rather than against whatever
 *   this implementation happens to produce.
 * - The archives can be read by a second, independent reader. The helper below walks the
 *   central directory itself, so a writer whose directory disagrees with its local headers
 *   fails here instead of inside a parser.
 * - Shuffled part names really are shuffled. Without that check, `shufflePartNames` could
 *   quietly do nothing and every ordering test built on it would prove the opposite of what
 *   it claims.
 *
 * The module is required directly, not through `build/main/ipc.cjs`, because it is a test
 * helper: it is plain CommonJS so this file runs under `node` with no build step, and it is
 * deliberately not exported from the app bundle.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')

const fixtures = require('./build.cjs')

/* ------------------------------------------------------------------ *
 * Reading an archive without going through the writer
 * ------------------------------------------------------------------ */

/**
 * The archive as a second implementation sees it.
 *
 * Deliberately not `documents/zip.ts`: a test that used the reader under test to check the
 * writer under test would only prove the two agree. This walks the end-of-central-directory
 * record and the central directory with `DataView`, which is short enough to be obviously
 * right, and then follows each central entry back to its local header.
 */
function readArchive (archive) {
  const data = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)

  let end = -1
  for (let at = archive.length - 22; at >= 0; at -= 1) {
    if (data.getUint32(at, true) === 0x06054b50) {
      end = at
      break
    }
  }
  assert.notEqual(end, -1, 'the archive has no end-of-central-directory record')

  const count = data.getUint16(end + 10, true)
  const directorySize = data.getUint32(end + 12, true)
  const directoryOffset = data.getUint32(end + 16, true)
  assert.ok(directoryOffset + directorySize <= archive.length, 'the central directory runs past the end of the file')

  const entries = []
  let at = directoryOffset
  for (let index = 0; index < count; index += 1) {
    assert.equal(
      data.getUint32(at, true),
      0x02014b50,
      `central directory record ${index + 1} does not start with the central signature`,
    )

    const method = data.getUint16(at + 10, true)
    const checksum = data.getUint32(at + 16, true)
    const compressedSize = data.getUint32(at + 20, true)
    const uncompressedSize = data.getUint32(at + 24, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const localOffset = data.getUint32(at + 42, true)
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    at += 46 + nameLength + extraLength + commentLength

    assert.equal(
      data.getUint32(localOffset, true),
      0x04034b50,
      `the local header of "${name}" does not start with the local signature`,
    )

    // The local header's own name and extra lengths decide where the data begins: they can
    // differ from the central copy, and this is the number a reader seeks with.
    const localNameLength = data.getUint16(localOffset + 26, true)
    const localExtraLength = data.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength

    entries.push({
      name,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      data: archive.subarray(start, start + compressedSize),
    })
  }

  assert.equal(
    at - directoryOffset,
    directorySize,
    'the directory size in the end record does not match the records it holds',
  )

  return { count, entries }
}

/** Every entry name, in the archive's own order. */
function entryNames (archive) {
  return readArchive(archive).entries.map((entry) => entry.name)
}

/** One named entry, refusing a name the archive does not hold. */
function entryNamed (archive, name) {
  const found = readArchive(archive).entries.find((entry) => entry.name === name)
  assert.ok(found, `the archive has no part called ${name}`)
  return found
}

/** One named entry, decoded as text. */
function partText (archive, name) {
  return entryNamed(archive, name).data.toString('utf8')
}

/** A relationship target resolved against the part that names it. */
function resolvePart (from, target) {
  const segments = from.split('/')
  segments.pop()
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop()
    else if (segment !== '.') segments.push(segment)
  }
  return segments.join('/')
}

/* ------------------------------------------------------------------ *
 * Reading a PDF without going through the writer
 * ------------------------------------------------------------------ */

/** A PDF as text, in the one-byte encoding every fixture is written in. */
function pdfText (archive) {
  return archive.toString('latin1')
}

/** How many times a pattern matches, which reads better than a list nobody inspects. */
function occurrences (text, pattern) {
  const found = text.match(pattern)
  return found === null ? 0 : found.length
}

/**
 * The `startxref` offset, checked against the file it is written in.
 *
 * This is the assertion that catches a table built from a number the builder believed. The
 * offset has to be measured against the finished bytes, so a header one line longer than
 * expected shows up here rather than as a reader refusing the file.
 */
function xrefOffset (archive) {
  const text = pdfText(archive)
  const found = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)
  assert.ok(found, 'the file does not end with a startxref record and the end marker')

  const offset = Number(found[1])
  assert.ok(offset > 0 && offset < archive.length, `startxref ${offset} is outside a ${archive.length}-byte file`)
  assert.equal(
    text.slice(offset, offset + 4),
    'xref',
    `startxref ${offset} points at ${JSON.stringify(text.slice(offset, offset + 12))} rather than the xref keyword`,
  )
  return offset
}

/**
 * Every in-use entry in the table, checked against the object it describes.
 *
 * A PDF table entry is exactly twenty bytes: ten digits of offset, five of generation, a
 * space, `n` or `f`, then a space and a newline. Reading each one and following it is the
 * only way to know the offsets are real, and it catches both a table that is one entry
 * short and an entry pointing a byte or two off.
 */
function xrefEntryCount (archive) {
  const text = pdfText(archive)
  const at = xrefOffset(archive)

  const header = /^xref\n0 (\d+)\n/.exec(text.slice(at, at + 32))
  assert.ok(header, 'the xref table does not start with a subsection header')
  const count = Number(header[1])
  const first = at + header[0].length

  for (let number = 1; number < count; number += 1) {
    const line = text.slice(first + number * 20, first + number * 20 + 20)
    assert.match(
      line,
      /^\d{10} \d{5} n \n$/,
      `entry ${number} is not a twenty-byte in-use record: ${JSON.stringify(line)}`,
    )

    const offset = Number(line.slice(0, 10))
    assert.ok(
      text.startsWith(`${number} 0 obj`, offset),
      `entry ${number} points at byte ${offset}, which holds ${JSON.stringify(text.slice(offset, offset + 12))}`,
    )
  }

  return count
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

test('buildPdf writes a real cross-reference table that points at its objects', () => {
  const archive = fixtures.buildPdf([
    { lines: ['Rent roll for November.', 'The Tilley quotation expires on Friday.'] },
    { lines: ['Signed for and on behalf of Zuri Lofts.'] },
  ])

  assert.ok(Buffer.isBuffer(archive), 'buildPdf must hand back a buffer')
  const text = pdfText(archive)

  assert.ok(text.startsWith('%PDF-'), 'the file does not start with a PDF header')
  assert.match(text, /%%EOF\n$/, 'the file does not end with the end marker')
  assert.ok(text.includes('trailer\n<< /Size '), 'the file has no trailer')

  // Catalog, page tree, font, image, then one dictionary and one content stream per page.
  assert.equal(xrefEntryCount(archive), 4 + 2 * 2 + 1)

  // An xref entry per object means the size in the trailer has to agree.
  assert.ok(text.includes('/Size 9 /Root 1 0 R'), 'the trailer does not describe every object')

  // The page tree names both pages, and the pages themselves agree with it. The lookahead
  // keeps `/Type /Pages` from being counted as a page.
  assert.ok(text.includes('/Type /Pages /Kids [5 0 R 7 0 R] /Count 2'), 'the page tree does not name its pages')
  assert.equal(occurrences(text, /\/Type \/Page(?![A-Za-z])/g), 2)
  assert.equal(occurrences(text, /\/F1 3 0 R/g), 2, 'each page should use the one font object')
})

test('buildPdf escapes the delimiters of a PDF string, so a line with brackets survives', () => {
  const archive = fixtures.buildPdf([{ lines: ['Supplier list (Abuja) \\ Tilley'] }], { plain: true })
  const text = pdfText(archive)

  // Parentheses and the backslash are the form's own characters, so they have to arrive
  // escaped; a raw one would end the string early and make the rest of the page operators.
  assert.ok(
    text.includes('(Supplier list \\(Abuja\\) \\\\ Tilley) Tj'),
    'the line was written without its escapes',
  )
  assert.equal(text.includes('(Supplier list (Abuja)'), false, 'a raw parenthesis was left in the string')

  // `plain` is what made the operators visible; the default stream holds no such text.
  const compressed = pdfText(fixtures.buildPdf([{ lines: ['Supplier list (Abuja)'] }]))
  assert.equal(compressed.includes('Supplier list'), false, 'the default stream should be compressed')
})

test('buildPdf compresses by default with a zlib stream a reader can inflate', () => {
  const archive = fixtures.buildPdf([{ lines: ['The Tilley quotation is premium work.'] }])
  const text = pdfText(archive)

  const found = /\/Filter \/FlateDecode \/Length (\d+) >>\nstream\n/.exec(text)
  assert.ok(found, 'the content stream is not marked as deflated')

  const start = found.index + found[0].length
  const payload = archive.subarray(start, start + Number(found[1]))

  /*
   * Inflated with `inflateSync`, which expects the zlib wrapper that `/FlateDecode` names.
   * That the payload is a real stream, rather than the operators with a filter written
   * beside them, is the whole reason this fixture can stand in for a writer's output.
   */
  const inflated = zlib.inflateSync(payload).toString('latin1')
  assert.ok(inflated.startsWith('BT /F1 12 Tf 72 720 Td'), `the stream inflated to ${JSON.stringify(inflated.slice(0, 24))}`)
  assert.ok(inflated.includes('(The Tilley quotation is premium work.) Tj'))
  assert.ok(inflated.endsWith('0 -14 Td ET\n'), 'the last line has no position move before ET')
})

test('buildPdf can draw a page with no text at all, and one line as a kerning array', () => {
  const archive = fixtures.buildPdf([
    { imageOnly: true },
    { lines: ['Installation of the Tilley survey.'] },
  ], { plain: true, tjArray: true })
  const text = pdfText(archive)

  // A scanned page: a draw operator, no text operator. This is what lets a test prove the
  // parser reports "needs OCR" instead of "empty".
  assert.ok(text.includes('q 100 0 0 100 0 0 cm /Im1 Do Q'), 'the image-only page draws nothing')
  assert.ok(text.includes('/Subtype /Image'), 'the picture the page draws is not defined')

  const kerning = /\[ \(([^)]*)\) -250 \(([^)]*)\) \] TJ/.exec(text)
  assert.ok(kerning, 'no kerning array in the file')
  // The two halves are one line between them: -250 is spacing in thousandths of an em, not
  // a space, so a reader that turns it into one splits a word that was never split.
  assert.equal(`${kerning[1]}${kerning[2]}`, 'Installation of the Tilley survey.')
  assert.equal(text.includes('(Installation of the Tilley survey.) Tj'), false, 'the line was also written as a plain string')
})

test('buildPdf records an encryption dictionary when asked, and not otherwise', () => {
  const encrypted = pdfText(fixtures.buildPdf([{ lines: ['Secret.'] }], { encrypt: true }))
  assert.match(
    encrypted,
    /trailer\n<< \/Size \d+ \/Root 1 0 R \/Encrypt << \/Filter \/Standard >> >>\nstartxref\n/,
    'the trailer has no encryption entry',
  )

  // The plain build has none, so the check above is about the option and not about a
  // string that is always there.
  assert.equal(pdfText(fixtures.buildPdf([{ lines: ['Plain.'] }])).includes('/Encrypt'), false)
})

test('buildLargePdf makes 200 real pages and stays quick', () => {
  const started = Date.now()
  const archive = fixtures.buildLargePdf(200)
  const elapsed = Date.now() - started

  const text = pdfText(archive)
  assert.ok(text.startsWith('%PDF-'))
  assert.equal(occurrences(text, /\/Type \/Page(?![A-Za-z])/g), 200, 'the page count is wrong')

  // The first and last page, so a fixture that wrote one line 200 times would show.
  assert.ok(text.includes('(Page 1 of the Tilley survey.) Tj'))
  assert.ok(text.includes('(Page 200 of the Tilley survey.) Tj'))

  // A table of 404 entries has to be right as well; a long document is where a guessed
  // offset drifts furthest from the truth.
  assert.equal(xrefEntryCount(archive), 4 + 2 * 200 + 1)

  // Generous by two orders of magnitude: building the pages is a string join per page, so
  // anything near this ceiling means the work became quadratic.
  assert.ok(elapsed < 2000, `200 pages took ${elapsed}ms, which is slower than this fixture is allowed to be`)
})

test('buildScannedPdf has pages, draws them, and holds no text operator at all', () => {
  const archive = fixtures.buildScannedPdf(3)
  const text = pdfText(archive)

  assert.equal(occurrences(text, /\/Type \/Page(?![A-Za-z])/g), 3)
  assert.equal(occurrences(text, /\/Im1 Do/g), 3, 'every page should draw the image')

  /*
   * The whole file, not one page: a scan has nowhere to hide a word. The streams are
   * written uncompressed here and the image samples are all zero, so this is a property of
   * the bytes rather than a coincidence of what the compressor produced.
   */
  assert.equal(text.includes('Tj'), false, 'a scanned page must not show text')
  assert.equal(text.includes('TJ'), false, 'a scanned page must not show text')

  xrefEntryCount(archive)
})

test('buildPdfRaw wraps a body the caller wrote and points the table at it', () => {
  const archive = fixtures.buildPdfRaw(
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n',
  )
  const text = pdfText(archive)

  assert.ok(text.startsWith('%PDF-'))
  assert.ok(text.includes('/Size 3'), 'the table does not describe the two objects and the free entry')
  assert.ok(text.includes('/Root 1 0 R'))
  assert.equal(xrefEntryCount(archive), 3)

  // A body that is merely wrong, rather than short: the shell stays correct around it, so a
  // reader is tested on the one thing that is actually broken.
  const broken = fixtures.buildPdfRaw('1 0 obj\n<< /Type /Catalog /Pages 9 0 R >>\nendobj\n')
  assert.ok(pdfText(broken).includes('/Pages 9 0 R'))
  assert.equal(xrefEntryCount(broken), 2)

  /*
   * An empty body is still a well-formed shell around nothing. The reader, not the builder,
   * is what should refuse it for having no pages, so the builder has to be able to produce
   * it.
   */
  const empty = fixtures.buildPdfRaw('')
  assert.ok(pdfText(empty).startsWith('%PDF-'))
  assert.ok(pdfText(empty).includes('/Size 1'))
  assert.equal(xrefOffset(empty), pdfText(empty).indexOf('xref'))
})

/* ------------------------------------------------------------------ *
 * ZIP
 * ------------------------------------------------------------------ */

test('crc32 reproduces the standard check value', () => {
  /*
   * The published check value for CRC-32: the nine ASCII bytes of "123456789" give
   * 0xCBF43926. Asserting that constant, rather than a number printed by this
   * implementation, is what makes the test about the standard.
   */
  assert.equal(fixtures.crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.equal(fixtures.crc32('123456789'), 0xcbf43926, 'a string should be taken as its UTF-8 bytes')
  assert.equal(fixtures.crc32(Buffer.alloc(0)), 0, 'the checksum of nothing is zero')

  /*
   * And an independent implementation, where the runtime has one, agrees on something less
   * famous. `zlib.crc32` is newer than the oldest Node this project runs, so the call is
   * guarded rather than assumed.
   */
  if (typeof zlib.crc32 === 'function') {
    const sample = Buffer.from('The Tilley quotation expires on Friday.')
    assert.equal(fixtures.crc32(sample), zlib.crc32(sample))
  }
})

test('storeZip writes a central directory that describes its own local headers', () => {
  const nine = Buffer.from('123456789')
  const everyByte = Buffer.from([...Array(256).keys()])

  const archive = fixtures.storeZip([
    { name: 'word/document.xml', data: '<a/>' },
    { name: 'checksum.txt', data: nine },
    { name: 'all-bytes.bin', data: everyByte },
  ])

  assert.equal(archive.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'the archive does not start with a local header')

  const { count, entries } = readArchive(archive)
  assert.equal(count, 3, 'the entry count in the end record is wrong')
  assert.deepEqual(entries.map((entry) => entry.name), ['word/document.xml', 'checksum.txt', 'all-bytes.bin'])

  for (const entry of entries) {
    assert.equal(entry.method, 0, `${entry.name} is not stored`)
    // STORE holds one copy of the bytes, so the two sizes have to be the same one.
    assert.equal(entry.compressedSize, entry.uncompressedSize, `${entry.name} stores two different sizes`)
    assert.equal(entry.checksum, fixtures.crc32(entry.data), `${entry.name} carries the wrong checksum`)
  }

  /*
   * The published value again, this time read out of the archive rather than computed by
   * the function just called: the writer and the checksum agree with the standard, which is
   * a stronger statement than the two agreeing with each other.
   */
  assert.equal(entries[1].checksum, 0xcbf43926)
  assert.deepEqual(entries[1].data, nine)
  assert.deepEqual(entries[2].data, everyByte)
})

test('a stored entry is the plain bytes, so a deflating reader would read them too', () => {
  const payload = Buffer.from('Supplier list for the Abuja site, rent roll attached.')
  const entry = entryNamed(fixtures.storeZip([{ name: 'suppliers.txt', data: payload }]), 'suppliers.txt')

  /*
   * The writer applies no transform: what is in the file is what was handed to it. A STORE
   * entry that had been quietly compressed would be unreadable by the reader it is meant
   * for, and this is the assertion that would notice.
   */
  assert.deepEqual(entry.data, payload, 'the stored bytes are not the bytes that were passed in')

  /*
   * And those bytes are a real input to the other method a ZIP reader handles: raw deflate
   * in, raw inflate out, unchanged. `storeZip` never writes method 8, so this is the closest
   * a fixture can come to proving that a reader which only knows how to inflate can consume
   * what it produces.
   */
  const deflated = zlib.deflateRawSync(entry.data)
  assert.notDeepEqual(deflated, entry.data, 'deflateRawSync returned its input, so this proves nothing')
  assert.deepEqual(zlib.inflateRawSync(deflated), entry.data)
})

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

test('buildDocx produces a package with the parts a reader follows', () => {
  const archive = fixtures.buildDocx({
    paragraphs: [
      { text: 'Tilley refurbishment', style: 'Title' },
      { text: 'Scope', style: 'Heading1' },
      { text: 'Replace the kitchen and the bathroom.' },
      { text: 'A & B < C > D' },
      { text: 'Item\tAmount', tabs: true },
      { tabs: true },
    ],
  })

  assert.equal(archive.subarray(0, 4).toString('latin1'), 'PK\x03\x04')
  assert.deepEqual(entryNames(archive), [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/document.xml',
    'word/_rels/document.xml.rels',
    'word/styles.xml',
  ])

  const document = partText(archive, 'word/document.xml')
  assert.ok(document.includes('<w:pStyle w:val="Title"/>'), 'the title paragraph names no style')
  assert.ok(document.includes('<w:pStyle w:val="Heading1"/>'), 'the heading paragraph names no style')
  assert.ok(document.includes('<w:t xml:space="preserve">Replace the kitchen and the bathroom.</w:t>'))

  /*
   * The escaping. A raw ampersand or angle bracket here makes the part unparseable, and the
   * failure shows up as a document that reads as empty rather than as one wrong character.
   */
  assert.ok(document.includes('A &amp; B &lt; C &gt; D'), 'the entities were not written')
  assert.equal(document.includes('A & B'), false, 'a raw ampersand was left in the part')

  // A tab is its own element, and an indent with no words is a paragraph of one of them.
  assert.equal(occurrences(document, /<w:tab\/>/g), 2)

  // The relationships the format is navigated by.
  assert.ok(partText(archive, '_rels/.rels').includes('Target="word/document.xml"'))
  assert.ok(partText(archive, 'word/_rels/document.xml.rels').includes('Target="styles.xml"'))
  assert.ok(partText(archive, '[Content_Types].xml').includes('PartName="/word/document.xml"'))

  /*
   * The style ids the paragraphs name have to exist in the part the relationship points
   * at. A paragraph naming a style nothing defines is one Word offers to repair, and a
   * reader that follows the id has nothing to apply, so both halves are checked.
   */
  const styles = partText(archive, 'word/styles.xml')
  assert.ok(styles.includes('w:styleId="Title"'), 'the styles part does not define the Title style')
  assert.ok(styles.includes('w:styleId="Heading1"'), 'the styles part does not define the Heading1 style')
})

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

test('buildXlsx follows the tab order in the workbook part even when the parts are shuffled', () => {
  const archive = fixtures.buildXlsx({
    shufflePartNames: true,
    sheets: [
      { name: 'Rent roll', rows: [['Month', 'Amount'], ['November', 450000], [null, null, 'Note']] },
      { name: 'Suppliers', rows: [['Name'], ['Tilley']] },
      { name: 'Notes', rows: [['Tilley'], ['Month']] },
    ],
  })

  const names = entryNames(archive)
  for (const part of ['sheet1', 'sheet2', 'sheet3']) {
    assert.ok(names.includes(`xl/worksheets/${part}.xml`), `the workbook has no ${part}`)
  }

  const workbook = partText(archive, 'xl/workbook.xml')
  const order = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((match) => match[1])
  assert.deepEqual(order, ['Rent roll', 'Suppliers', 'Notes'], 'the tabs are not in the order they were given')

  const rels = partText(archive, 'xl/_rels/workbook.xml.rels')
  const first = /Id="rId1" Type="[^"]*\/worksheet" Target="([^"]*)"/.exec(rels)
  assert.ok(first, 'the first tab has no relationship to a worksheet')

  /*
   * The shuffle itself. The first tab is not the first part, so a reader that sorts file
   * names, or walks the entries in the order it finds them, is visibly wrong rather than
   * accidentally right.
   */
  assert.notEqual(first[1], 'worksheets/sheet1.xml', 'shufflePartNames did nothing')

  const firstSheet = partText(archive, resolvePart('xl/workbook.xml', first[1]))
  assert.ok(firstSheet.includes('<c r="A1" t="s"><v>0</v></c>'), 'the first cell is not a shared-string index')
  assert.ok(firstSheet.includes('<c r="B2"><v>450000</v></c>'), 'the number is not written as a number')
  // A null cell is left out, so the third row starts at C: the gap survives as a gap.
  assert.ok(firstSheet.includes('<row r="3"><c r="C3"'), 'the missing cells were written as empty ones')

  /*
   * Shared strings are deduplicated across the workbook: eight string cells, six entries.
   * A table with one entry per cell would still read correctly, which is why the count is
   * asserted rather than only the text.
   */
  const shared = partText(archive, 'xl/sharedStrings.xml')
  assert.equal(occurrences(shared, /<si>/g), 6, 'the shared string table is not deduplicated')

  // Counted inside the worksheet parts rather than over the whole archive, so a string in
  // some other part cannot make the figure agree by accident.
  const stringCells = ['sheet1', 'sheet2', 'sheet3']
    .map((part) => occurrences(partText(archive, `xl/worksheets/${part}.xml`), /t="s"/g))
    .reduce((total, count) => total + count, 0)
  assert.equal(stringCells, 8, 'the number of string cells changed')
  assert.ok(shared.includes('<t xml:space="preserve">Tilley</t>'))

  // Tilley appears in two sheets and must have one entry, which is the whole point of a
  // shared table: a table that merely looked deduplicated would still read correctly.
  assert.equal(
    occurrences(shared, /<si><t xml:space="preserve">Tilley<\/t><\/si>/g),
    1,
    'the repeated string was not stored once',
  )

  // Without the shuffle the first tab is the first part, so the check above is about the
  // option rather than about how the parts are always named.
  const plain = fixtures.buildXlsx({ sheets: [{ name: 'Only', rows: [['a']] }] })
  assert.ok(partText(plain, 'xl/_rels/workbook.xml.rels').includes('Target="worksheets/sheet1.xml"'))
})

/* ------------------------------------------------------------------ *
 * PPTX
 * ------------------------------------------------------------------ */

test('buildPptx follows the slide order in the presentation part, notes and all', () => {
  const archive = fixtures.buildPptx({
    shufflePartNames: true,
    slides: [
      { lines: ['Tilley refurbishment', 'Abuja, November'], notes: 'Rates agreed on the call.' },
      { lines: ['Next steps'] },
    ],
  })

  const names = entryNames(archive)
  for (const part of [
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
    'ppt/slides/slide1.xml',
    'ppt/slides/slide2.xml',
  ]) {
    assert.ok(names.includes(part), `the deck has no ${part}`)
  }

  const presentation = partText(archive, 'ppt/presentation.xml')
  const order = [...presentation.matchAll(/r:id="(rId\d+)"/g)].map((match) => match[1])
  assert.deepEqual(order, ['rId1', 'rId2'], 'the slide id list is not in the order the slides were given')

  const rels = partText(archive, 'ppt/_rels/presentation.xml.rels')
  const first = /Id="rId1" Type="[^"]*\/slide" Target="([^"]*)"/.exec(rels)
  assert.ok(first, 'the first slide of the deck has no relationship')
  assert.notEqual(first[1], 'slides/slide1.xml', 'shufflePartNames did nothing')

  const firstPart = resolvePart('ppt/presentation.xml', first[1])
  const firstSlide = partText(archive, firstPart)
  assert.ok(firstSlide.includes('<a:t>Tilley refurbishment</a:t>'))
  assert.ok(firstSlide.includes('<a:t>Abuja, November</a:t>'))

  /*
   * The notes are reached through the slide's own relationships and through nothing else.
   * A deck saved after an edit has notes parts whose numbers no longer follow its slides, so
   * matching them by file name puts one slide's notes on another.
   */
  const slideRelsName = `${firstPart.slice(0, firstPart.lastIndexOf('/'))}/_rels/${firstPart.slice(firstPart.lastIndexOf('/') + 1)}.rels`
  const notesTarget = /Target="([^"]*notesSlide\d+\.xml)"/.exec(partText(archive, slideRelsName))
  assert.ok(notesTarget, 'the slide with notes has no notes relationship')
  assert.ok(
    partText(archive, resolvePart(firstPart, notesTarget[1])).includes('<a:t>Rates agreed on the call.</a:t>'),
    'the notes of the slide are not in the part its relationship names',
  )

  // The slide with no notes has no notes part and no relationship to one, so the pair above
  // is about the notes and not about a part every slide gets.
  const secondTarget = /Id="rId2" Type="[^"]*" Target="([^"]*)"/.exec(rels)
  assert.ok(secondTarget, 'the second slide of the deck has no relationship')
  const secondNumber = /slides\/slide(\d+)\.xml$/.exec(resolvePart('ppt/presentation.xml', secondTarget[1]))[1]
  assert.equal(
    names.includes(`ppt/notesSlides/notesSlide${secondNumber}.xml`),
    false,
    'the slide without notes was given a notes part',
  )
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('every builder refuses input it cannot write, and names what was wrong', () => {
  // Nothing to draw, or a shape that is not a page list.
  assert.throws(() => fixtures.buildPdf([]), /non-empty array/)
  assert.throws(() => fixtures.buildPdf('pages'), /non-empty array/)
  assert.throws(() => fixtures.buildPdf([null]), /must be an object/)
  assert.throws(() => fixtures.buildPdf([{ lines: 'one line' }]), /array of strings/)
  assert.throws(() => fixtures.buildPdf([{ lines: [1] }]), /must be a string/)
  assert.throws(() => fixtures.buildPdf([{ lines: ['ok'] }], 'plain'), /options must be an object/)

  // A page count that cannot be a count, and one that would be a denial of service.
  assert.throws(() => fixtures.buildLargePdf(0), /whole number/)
  assert.throws(() => fixtures.buildLargePdf(2.5), /whole number/)
  assert.throws(() => fixtures.buildLargePdf(100000), /ceiling/)
  assert.throws(() => fixtures.buildScannedPdf(-1), /whole number/)

  // A raw body that is not text, and one whose objects are out of order.
  assert.throws(() => fixtures.buildPdfRaw({}), /must be a string/)
  assert.throws(
    () => fixtures.buildPdfRaw('7 0 obj\n<< >>\nendobj\n1 0 obj\n<< >>\nendobj\n'),
    /numbered upwards/,
  )

  // A checksum of something that has no bytes, and an archive of something that is not a
  // list of entries.
  assert.throws(() => fixtures.crc32(7), /expected a Buffer/)
  assert.throws(() => fixtures.storeZip('entries'), /must be an array/)
  assert.throws(() => fixtures.storeZip([{ data: 'x' }]), /needs a non-empty name/)
  assert.throws(() => fixtures.storeZip([{ name: 'a', data: 7 }]), /expected a Buffer/)

  // A paragraph list that is not a list, a style the fixture does not define, and a
  // paragraph with nothing in it at all.
  assert.throws(() => fixtures.buildDocx({}), /paragraphs must be an array/)
  assert.throws(() => fixtures.buildDocx({ paragraphs: [{ text: 'x', style: 'Heading9' }] }), /does not define/)
  assert.throws(() => fixtures.buildDocx({ paragraphs: [{ tabs: false }] }), /has no text/)

  // A sheet with no name, a name Excel would reject, and a cell that is none of the three
  // things a cell can be.
  assert.throws(() => fixtures.buildXlsx({}), /non-empty array/)
  assert.throws(() => fixtures.buildXlsx({ sheets: [{ name: '  ', rows: [] }] }), /non-empty name/)
  assert.throws(() => fixtures.buildXlsx({ sheets: [{ name: 'a/b', rows: [] }] }), /forbids/)
  assert.throws(
    () => fixtures.buildXlsx({ sheets: [{ name: 'ok', rows: [[{}]] }] }),
    /must be a string, a finite number or null/,
  )

  // A slide whose text is not a list of lines, and notes that are neither a line nor a list.
  assert.throws(() => fixtures.buildPptx({}), /non-empty array/)
  assert.throws(() => fixtures.buildPptx({ slides: [{ lines: 'text' }] }), /array of strings/)
  assert.throws(() => fixtures.buildPptx({ slides: [{ lines: ['ok'], notes: 7 }] }), /string or an array of strings/)
})
