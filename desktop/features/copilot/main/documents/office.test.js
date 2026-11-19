'use strict'

/*
 * The DOCX, XLSX and PPTX extractors, driven through the bundle Electron loads.
 *
 * Every fixture is built here rather than checked in as a binary, for two reasons. A
 * checked-in `.docx` is unreadable in review - a change to the expectation and a change
 * to the file would look the same in the diff. And the parts under test are exactly the
 * parts written below: a heading style, a shared-string table, a notes relationship. So
 * the fixture doubles as the statement of what the parser promises.
 *
 * That makes the ZIP writer at the top part of the test, which is why one test checks it
 * against the shared reader before any parser is allowed to explain a failure with it.
 * A broken writer would otherwise look exactly like a broken parser.
 *
 * What is worth proving here, beyond the obvious "it finds the text":
 *
 * - Order comes from the package, not from file names. The workbook below lists its
 *   second tab first, and the deck names its slides in the reverse of their file names.
 *   A reader that guessed by name would fail both and look correct on a tidy fixture.
 * - Text that is not the author's is not reported. A shared string's phonetic hint, a
 *   field placeholder holding a slide number: both are stored as text and neither is
 *   something a person typed to be read.
 * - An empty result is a refusal. A file that opens but yields nothing is far more
 *   likely to be the wrong file than a blank document, and reporting success would let
 *   the caller chunk nothing and show an empty answer as though it had read it.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/*
 * The three entry points, in the wording a missing one deserves: the bundle only
 * publishes what `features/copilot/main/ipc/index.ts` re-exports, so a gap here is a
 * wiring step, not a parser bug.
 */
function requireBundle (names) {
  const missing = names.filter((name) => typeof api[name] !== 'function')
  assert.deepEqual(
    missing,
    [],
    `desktop/features/copilot/main/ipc/index.ts must re-export ${missing.join(', ')} from ../documents/office.js`,
  )
}

requireBundle(['extractDocx', 'extractXlsx', 'extractPptx'])

/** A refusal is the storage-independent token, never a driver or scanner message. */
function expectFailure (work, failure) {
  assert.throws(work, (error) => {
    assert.equal(error && error.name, 'ExtractionError', `expected an ExtractionError, got ${error && error.name}`)
    assert.equal(error.failure, failure)
    return true
  })
}

/* ------------------------------------------------------------------ *
 * A store-only ZIP writer, so every fixture below is a real archive
 * ------------------------------------------------------------------ */

/**
 * CRC-32 of some bytes.
 *
 * A ZIP entry states one, and an archive written with a guess would be a fixture that
 * only this reader accepts. Stored (method 0) entries are used throughout because the
 * fixture then holds exactly the bytes written, which keeps a failure here readable.
 */
function crc32 (bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** 1980-01-01, the earliest a ZIP timestamp can express. The date is not under test. */
const DOS_DATE = 0x0021
/** Names are compared as UTF-8, so the flag that says so is set. */
const UTF8_NAMES_FLAG = 0x0800

/**
 * One ZIP archive, from `[name, text]` pairs.
 *
 * Local headers, a central directory and an end record, because that is the order the
 * reader walks and a fixture that cheated on any of them would not be testing the
 * reader's contract.
 */
function zip (files) {
  const body = []
  const entries = []
  let offset = 0

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_NAMES_FLAG, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)

    body.push(local, data)
    entries.push({ nameBytes, crc, size: data.length, offset })
    offset += local.length + data.length
  }

  const records = entries.map((entry) => {
    const record = Buffer.alloc(46 + entry.nameBytes.length)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(UTF8_NAMES_FLAG, 8)
    record.writeUInt16LE(0, 10)
    record.writeUInt16LE(0, 12)
    record.writeUInt16LE(DOS_DATE, 14)
    record.writeUInt32LE(entry.crc, 16)
    record.writeUInt32LE(entry.size, 20)
    record.writeUInt32LE(entry.size, 24)
    record.writeUInt16LE(entry.nameBytes.length, 28)
    record.writeUInt16LE(0, 30)
    record.writeUInt16LE(0, 32)
    record.writeUInt16LE(0, 34)
    record.writeUInt16LE(0, 36)
    record.writeUInt32LE(0, 38)
    record.writeUInt32LE(entry.offset, 42)
    entry.nameBytes.copy(record, 46)
    return record
  })

  const directorySize = records.reduce((total, record) => total + record.length, 0)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  // A plain Uint8Array rather than the Buffer itself: `Buffer.concat` hands back a view
  // of a shared pool, and the bytes here outlive the allocation that produced them.
  return new Uint8Array(Buffer.concat([...body, ...records, end]))
}

test('the zip writer behind these fixtures produces an archive the shared reader opens', () => {
  assert.equal(
    typeof api.readZip,
    'function',
    'readZip is missing from build/main/ipc.cjs: ' +
      'desktop/features/copilot/main/ipc/index.ts must re-export ../documents/zip.js',
  )

  const bytes = zip([
    ['word/document.xml', '<w:document/>'],
    ['docProps/app.xml', 'Application: Zuri'],
  ])
  const archive = api.readZip(bytes)

  assert.deepEqual([...archive.keys()].sort(), ['docProps/app.xml', 'word/document.xml'])
  const entry = archive.get('docProps/app.xml')
  assert.ok(entry !== undefined, 'the reader dropped an entry the writer stored')
  assert.equal(Buffer.from(entry.bytes).toString('utf8'), 'Application: Zuri')

  /*
   * The control. Without it, every assertion above would also pass on a writer that
   * produced something the reader happened to accept for the wrong reason.
   */
  expectFailure(
    () => api.readZip(new TextEncoder().encode('not an archive, just an ordinary sentence')),
    'unreadable',
  )
})

/* ------------------------------------------------------------------ *
 * Fixture vocabulary
 * ------------------------------------------------------------------ */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

const WORDPROCESSING = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SPREADSHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const PACKAGE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const OFFICE_RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PRESENTATION = 'http://schemas.openxmlformats.org/presentationml/2006/main'

/**
 * A DOCX whose body is the given paragraphs.
 *
 * The other parts a real package carries are present and carry text of their own, so a
 * reader that walked the archive instead of the part it was told to read would show the
 * document's title from `docProps` as though it were body text.
 */
function docxFile (body) {
  return zip([
    [
      '[Content_Types].xml',
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    ],
    [
      'docProps/core.xml',
      `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
        '<dc:title>METADATA-TITLE-MARKER</dc:title></cp:coreProperties>',
    ],
    [
      'word/document.xml',
      `${XML_HEAD}<w:document xmlns:w="${WORDPROCESSING}"><w:body>${body}</w:body></w:document>`,
    ],
  ])
}

/** One worksheet part from its `<row>` elements. */
function worksheetPart (rows) {
  return `${XML_HEAD}<worksheet xmlns="${SPREADSHEET}"><sheetData>${rows}</sheetData></worksheet>`
}

/* ------------------------------------------------------------------ *
 * DOCX
 * ------------------------------------------------------------------ */

test('DOCX: headings start sections, runs join into paragraphs, tabs, breaks and entities are read', () => {
  const body = [
    '<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Rent review 2026</w:t></w:r></w:p>',
    '<w:p><w:r><w:t xml:space="preserve">Prepared for Zuri Lofts</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Terms &amp; conditions</w:t></w:r></w:p>',
    '<w:p>',
    // Two runs that make one word: a reader that treated a run as a line would split it.
    '<w:r><w:t>Revision </w:t></w:r><w:r><w:t>B</w:t></w:r>',
    // A tab and a break inside the paragraph, then an empty run that must not break it.
    '<w:r><w:tab/><w:t>signed</w:t></w:r><w:r><w:t/></w:r><w:r><w:br/><w:t>on Monday</w:t></w:r>',
    '</w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Rent roll</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Numeric &#38; named &#x41; plus &quot;quoted&quot; and &#39;apostrophe&#39;</w:t></w:r></w:p>',
    '<w:p/>',
  ].join('')

  const result = api.extractDocx(docxFile(body))

  // A DOCX has no fixed pages: pagination belongs to whatever renders it.
  assert.equal(result.pageCount, 0)
  assert.deepEqual(result.ocrPending, [])

  assert.deepEqual(result.sections, [
    {
      page: null,
      section: 'Rent review 2026',
      text: 'Rent review 2026\nPrepared for Zuri Lofts',
    },
    {
      page: null,
      section: 'Terms & conditions',
      text: 'Terms & conditions\nRevision B\tsigned\non Monday',
    },
    {
      page: null,
      section: 'Rent roll',
      text: 'Rent roll\nNumeric & named A plus "quoted" and \'apostrophe\'',
    },
  ])

  // The document's own metadata is not body text, and no section may quote it.
  assert.equal(JSON.stringify(result).includes('METADATA-TITLE-MARKER'), false)
})

test('DOCX: body text before the first heading is still a section, under no heading', () => {
  const body = [
    '<w:p><w:r><w:t>Draft, not yet filed</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Opening</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>The rent was reviewed in March.</w:t></w:r></w:p>',
  ].join('')

  assert.deepEqual(api.extractDocx(docxFile(body)).sections, [
    { page: null, section: null, text: 'Draft, not yet filed' },
    { page: null, section: 'Opening', text: 'Opening\nThe rent was reviewed in March.' },
  ])
})

test('DOCX: an archive with no word/document.xml is refused as parse_failed', () => {
  const bytes = zip([['[Content_Types].xml', `${XML_HEAD}<Types/>`]])
  expectFailure(() => api.extractDocx(bytes), 'parse_failed')
})

test('DOCX: a document with no text at all is refused rather than reported as empty', () => {
  // Empty paragraphs and an empty run: this opens, and holds nothing anybody wrote.
  const body = '<w:p/><w:p><w:r><w:t/></w:r></w:p><w:p><w:r><w:t>   </w:t></w:r></w:p>'
  expectFailure(() => api.extractDocx(docxFile(body)), 'parse_failed')
})

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

test('XLSX: shared, inline and numeric cells across two tabs in the workbook order', () => {
  const workbook = [
    `${XML_HEAD}<workbook xmlns="${SPREADSHEET}" xmlns:r="${OFFICE_RELATIONSHIPS}">`,
    '<sheets>',
    // The tab bar's first tab is `rId2`, which is `worksheets/sheet2.xml`. Reading by
    // file name would show this workbook's tabs in the wrong order under the wrong names.
    '<sheet name="Rent &amp; charges" sheetId="2" r:id="rId2"/>',
    '<sheet name="Summary" sheetId="1" r:id="rId1"/>',
    '</sheets>',
    '</workbook>',
  ].join('')

  const relationships = [
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">`,
    // An absolute target, which some writers emit and which resolves from the root.
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/worksheet" Target="/xl/worksheets/sheet1.xml"/>`,
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS}/worksheet" Target="worksheets/sheet2.xml"/>`,
    `<Relationship Id="rId3" Type="${OFFICE_RELATIONSHIPS}/styles" Target="styles.xml"/>`,
    '</Relationships>',
  ].join('')

  const sharedStrings = [
    `${XML_HEAD}<sst xmlns="${SPREADSHEET}" count="4" uniqueCount="4">`,
    '<si><t>Month</t></si>',
    '<si><t>Amount</t></si>',
    // A rich string split across runs: the runs of one item make one value.
    '<si><r><t>Rent</t></r><r><t xml:space="preserve"> for November</t></r></si>',
    // A phonetic hint spells out the pronunciation. It is not the value, and reading it
    // would turn this cell into `AbujaPHONETIC`.
    '<si><t>Abuja</t><rPh sb="0" eb="2"><t>PHONETIC</t></rPh></si>',
    '</sst>',
  ].join('')

  const charges = worksheetPart(
    [
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="inlineStr"><is><t>January</t></is></c><c r="B2"><v>1250000</v></c></row>',
      // A shared string in column A and a formula's cached result in column C, so the
      // gap has to stay a gap.
      '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3" t="str"><v>1250000</v></c></row>',
      // A row with no cells carries nothing and must not become a blank line.
      '<row r="4"/>',
      // Column A empty, column B filled: the line starts with a tab, because that is
      // where the value sits.
      '<row r="5"><c r="A5"/><c r="B5" t="s"><v>3</v></c></row>',
      '<row r="6"><c r="A6" t="b"><v>1</v></c></row>',
      // A stored zero is a value, not an empty cell.
      '<row r="7"><c r="A7"><v>0</v></c></row>',
    ].join(''),
  )

  const summary = worksheetPart(
    [
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Total</t></is></c><c r="B1"><v>1250000</v></c></row>',
      // An index past the end of the shared table: one blank cell, not a lost sheet.
      '<row r="2"><c r="A2" t="s"><v>99</v></c></row>',
    ].join(''),
  )

  const bytes = zip([
    ['[Content_Types].xml', `${XML_HEAD}<Types/>`],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', relationships],
    ['xl/sharedStrings.xml', sharedStrings],
    ['xl/worksheets/sheet1.xml', summary],
    ['xl/worksheets/sheet2.xml', charges],
  ])

  const result = api.extractXlsx(bytes)

  assert.deepEqual(result.sections, [
    {
      page: null,
      section: 'Rent & charges',
      text: [
        'Month\tAmount',
        'January\t1250000',
        'Rent for November\t\t1250000',
        '\tAbuja',
        'TRUE',
        '0',
      ].join('\n'),
    },
    { page: null, section: 'Summary', text: 'Total\t1250000' },
  ])

  // Two tabs, so two pages: the count a person would check against the tab bar.
  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.ocrPending, [])
})

test('XLSX: a chart tab is skipped and still counted, and a workbook part is required', () => {
  const workbook = [
    `${XML_HEAD}<workbook xmlns="${SPREADSHEET}" xmlns:r="${OFFICE_RELATIONSHIPS}">`,
    '<sheets>',
    '<sheet name="Rent roll" sheetId="1" r:id="rId1"/>',
    '<sheet name="Rent roll chart" sheetId="2" r:id="rId2"/>',
    '</sheets>',
    '</workbook>',
  ].join('')

  const relationships = [
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">`,
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/>`,
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS}/chartsheet" Target="chartsheets/sheet1.xml"/>`,
    '</Relationships>',
  ].join('')

  const bytes = zip([
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', relationships],
    ['xl/worksheets/sheet1.xml', worksheetPart('<row r="1"><c r="A1" t="inlineStr"><is><t>Rent</t></is></c></row>')],
    // Shaped like a worksheet with a row in it, so a reader that ignored the
    // relationship type would emit this chart's tab as a section of text.
    ['xl/chartsheets/sheet1.xml', worksheetPart('<row r="1"><c r="A1" t="inlineStr"><is><t>CHART-MARKER</t></is></c></row>')],
  ])

  const result = api.extractXlsx(bytes)
  assert.deepEqual(result.sections, [{ page: null, section: 'Rent roll', text: 'Rent' }])
  assert.equal(result.pageCount, 2)
  assert.equal(JSON.stringify(result).includes('CHART-MARKER'), false)

  // The workbook part is required: without it there is nothing that says which tabs
  // exist, and guessing from the file names is the failure this reader avoids.
  expectFailure(
    () => api.extractXlsx(zip([['xl/worksheets/sheet1.xml', worksheetPart('')]])),
    'parse_failed',
  )
})

test('XLSX: a workbook whose tabs hold no cells is refused rather than reported as empty', () => {
  const workbook = [
    `${XML_HEAD}<workbook xmlns="${SPREADSHEET}" xmlns:r="${OFFICE_RELATIONSHIPS}">`,
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>',
    '</workbook>',
  ].join('')

  const relationships = [
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">`,
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/worksheet" Target="worksheets/sheet1.xml"/>`,
    '</Relationships>',
  ].join('')

  const bytes = zip([
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', relationships],
    ['xl/worksheets/sheet1.xml', worksheetPart('<row r="1"/><row r="2"><c r="A2"/></row>')],
  ])

  expectFailure(() => api.extractXlsx(bytes), 'parse_failed')
})

/* ------------------------------------------------------------------ *
 * PPTX
 * ------------------------------------------------------------------ */

test('PPTX: slides follow the presentation order and their notes come with them', () => {
  const presentation = [
    `${XML_HEAD}<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${OFFICE_RELATIONSHIPS}">`,
    // The first slide is `rId3`, which is `slides/slide2.xml`: the file names are the
    // reverse of the deck's order, which is exactly what reordering a deck produces.
    '<p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>',
    '<p:sldSz cx="12192000" cy="6858000"/>',
    '</p:presentation>',
  ].join('')

  const relationships = [
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">`,
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS}/slide" Target="slides/slide1.xml"/>`,
    `<Relationship Id="rId3" Type="${OFFICE_RELATIONSHIPS}/slide" Target="slides/slide2.xml"/>`,
    '</Relationships>',
  ].join('')

  const slide = (body) => `${XML_HEAD}<p:sld xmlns:p="${PRESENTATION}" xmlns:a="${DRAWING}"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`

  /* The deck's first slide, which is stored in `slides/slide2.xml`. */
  const openingSlideBody = [
    '<a:p><a:r><a:t>Opening the review</a:t></a:r></a:p>',
    '<a:p><a:r><a:t>Rent &amp; service charge</a:t></a:r></a:p>',
  ].join('')

  /* The deck's second slide, which is stored in `slides/slide1.xml`. */
  const closingSlideBody = [
    '<a:p><a:r><a:t>Why the price moved</a:t></a:r></a:p>',
    // Two runs and a break inside one paragraph: one line, then a second.
    '<a:p><a:r><a:t>Rent </a:t></a:r><a:r><a:t>review</a:t></a:r><a:br/><a:r><a:t>second line</a:t></a:r></a:p>',
    // A slide-number field. It is generated text, so it is not part of what was written.
    '<a:p><a:fld id="{5C1F0A54}" type="slidenum"><a:t>77</a:t></a:fld></a:p>',
  ].join('')

  const notes = `${XML_HEAD}<p:notes xmlns:p="${PRESENTATION}" xmlns:a="${DRAWING}"><p:cSld><p:spTree>` +
    '<p:sp><p:txBody>' +
    '<a:p><a:r><a:t>Open with the rent roll.</a:t></a:r></a:p>' +
    '<a:p><a:r><a:t>Then the rent &amp; uplift.</a:t></a:r></a:p>' +
    '</p:txBody></p:sp>' +
    // The notes page's own slide-number placeholder, which must not reach the text.
    '<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody>' +
    '<a:p><a:fld id="{5C1F0A55}" type="slidenum"><a:t>78</a:t></a:fld></a:p>' +
    '</p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:notes>'

  /*
   * The notes are reached through the slide's own relationship, and the number in the
   * path is deliberately not the slide's position: a deck edited after it was saved has
   * notes pages whose numbers no longer follow its slides.
   */
  const openingSlideRels = [
    `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">`,
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS}/notesSlide" Target="../notesSlides/notesSlide9.xml"/>`,
    '</Relationships>',
  ].join('')

  const bytes = zip([
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', relationships],
    ['ppt/slides/slide1.xml', slide(closingSlideBody)],
    ['ppt/slides/slide2.xml', slide(openingSlideBody)],
    ['ppt/slides/_rels/slide2.xml.rels', openingSlideRels],
    ['ppt/notesSlides/notesSlide9.xml', notes],
    /*
     * An unreferenced notes page. It exists, it holds text, and nothing names it: a
     * reader that matched notes to slides by number would attach this to slide 1.
     */
    ['ppt/notesSlides/notesSlide1.xml', notes.replace('Open with the rent roll.', 'ORPHAN-NOTES-MARKER')],
  ])

  const result = api.extractPptx(bytes)

  assert.deepEqual(result.sections, [
    {
      page: null,
      section: 'Slide 1',
      text: [
        'Opening the review',
        'Rent & service charge',
        'Notes:',
        'Open with the rent roll.',
        'Then the rent & uplift.',
      ].join('\n'),
    },
    {
      page: null,
      section: 'Slide 2',
      text: ['Why the price moved', 'Rent review', 'second line'].join('\n'),
    },
  ])

  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.ocrPending, [])

  const whole = JSON.stringify(result)
  assert.equal(whole.includes('ORPHAN-NOTES-MARKER'), false, 'notes were matched to a slide by file name')
  // The two slide-number fields: neither slide nor the notes may report one as text.
  assert.equal(whole.includes('77'), false)
  assert.equal(whole.includes('78'), false)
})

test('PPTX: a deck with no presentation.xml is refused as parse_failed', () => {
  expectFailure(
    () => api.extractPptx(zip([['ppt/slides/slide1.xml', `${XML_HEAD}<p:sld/>`]])),
    'parse_failed',
  )
})

test('PPTX: a deck whose slides hold no text is refused rather than reported as empty', () => {
  const presentation = `${XML_HEAD}<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${OFFICE_RELATIONSHIPS}">` +
    '<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>'

  const relationships = `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/slide" Target="slides/slide1.xml"/>` +
    '</Relationships>'

  const bytes = zip([
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', relationships],
    ['ppt/slides/slide1.xml', `${XML_HEAD}<p:sld xmlns:p="${PRESENTATION}" xmlns:a="${DRAWING}"><p:cSld><p:spTree/></p:cSld></p:sld>`],
  ])

  expectFailure(() => api.extractPptx(bytes), 'parse_failed')
})

/* ------------------------------------------------------------------ *
 * What every format shares
 * ------------------------------------------------------------------ */

test('a file that is not an archive is refused as unreadable by all three extractors', () => {
  const notAnArchive = new TextEncoder().encode('Supplier list for the Abuja site, comma, separated, values\n')
  const tooShort = new Uint8Array(4)

  for (const [name, extract] of [
    ['extractDocx', api.extractDocx],
    ['extractXlsx', api.extractXlsx],
    ['extractPptx', api.extractPptx],
  ]) {
    expectFailure(() => extract(notAnArchive), 'unreadable')
    expectFailure(() => extract(tooShort), 'unreadable')
    assert.equal(typeof extract, 'function', `${name} is not callable`)
  }
})

test('a refused part is reported as parse_failed, not as a scanner message', () => {
  /*
   * The part exists and is XML, but the element it needs is not there: the deck names a
   * slide whose part is missing. What comes back must be the token and nothing else,
   * because the message ends up on a screen and in a log line.
   */
  const presentation = `${XML_HEAD}<p:presentation xmlns:p="${PRESENTATION}" xmlns:r="${OFFICE_RELATIONSHIPS}">` +
    '<p:sldIdLst><p:sldId id="256" r:id="rId9"/></p:sldIdLst></p:presentation>'

  const relationships = `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">` +
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS}/slide" Target="slides/slide1.xml"/>` +
    '</Relationships>'

  const bytes = zip([
    ['ppt/presentation.xml', presentation],
    ['ppt/_rels/presentation.xml.rels', relationships],
    ['ppt/slides/slide1.xml', `${XML_HEAD}<p:sld/>`],
  ])

  assert.throws(() => api.extractPptx(bytes), (error) => {
    assert.equal(error.name, 'ExtractionError')
    assert.equal(error.failure, 'parse_failed')
    // The message names the failure, never the document it was reading.
    assert.equal(error.message.includes('slide1'), false)
    return true
  })
})
