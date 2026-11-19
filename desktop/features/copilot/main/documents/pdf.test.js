'use strict'

/*
 * The PDF extractor, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS the
 * main process runs. The bundle is also why the wiring is asserted once at the top: a
 * missing re-export in `main/ipc/index.ts` should read as the wiring step it is, not as
 * fifteen failures about `undefined`.
 *
 * Every fixture below is a real PDF built byte by byte: a header, numbered objects at
 * recorded offsets, a cross-reference table and a trailer. Nothing here is a string that
 * merely starts with `%PDF-`, because the thing under test is a reader that walks
 * structure, and a fake fixture would let a broken reader pass.
 *
 * The tests are grouped by the property each one proves rather than by method, because
 * the interesting failures here are all silent: a kerning number turned into a space
 * changes a word, a page number taken from loop position rather than page object order
 * points a citation at the wrong page, and an image-only page reported as an empty
 * section looks exactly like a blank one. None of those throw.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')

const api = require('../../../../build/main/ipc.cjs')

assert.equal(
  typeof api.extractPdf,
  'function',
  'desktop/features/copilot/main/ipc/index.ts must export * from \'../documents/pdf.js\'',
)

/*
 * The two ceilings, repeated rather than imported.
 *
 * The bundle only publishes what the main index re-exports, and the limits live in
 * `documents/types.ts`, which that index may not surface. The values are stated in a
 * comment there as 200 MB and 64 MB, so if either moves, the tests that assert on them
 * fail loudly instead of quietly testing the wrong bound.
 */
const MAX_INPUT_BYTES = 200 * 1024 * 1024
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024

/* ------------------------------------------------------------------ *
 * Building fixtures
 * ------------------------------------------------------------------ */

/**
 * A PDF assembled from already-serialised object bodies.
 *
 * Bodies are numbered 1 upwards in the order given, so a caller plans its object numbers
 * before it writes them, which is what a real writer does. The offsets are recorded as
 * each object is appended, which is the only way the cross-reference table can be honest.
 */
function buildPdf (bodies, options = {}) {
  const header = Buffer.from('%PDF-1.7\n%\xb5\xb5\xb5\xb5\n', 'latin1')
  const parts = [header]
  const offsets = []
  let offset = header.length

  bodies.forEach((body, index) => {
    offsets.push(offset)
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ])
    parts.push(chunk)
    offset += chunk.length
  })

  let xref = `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`
  // `trailerExtra` is how the encryption test gets a trailer that names a key.
  const extra = options.trailerExtra === undefined ? '' : ` ${options.trailerExtra}`
  xref += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R${extra} >>\nstartxref\n${offset}\n%%EOF\n`

  parts.push(Buffer.from(xref, 'latin1'))
  return Buffer.concat(parts)
}

/**
 * One stream object, deflated unless asked otherwise.
 *
 * `deflateSync` is the right call, not `deflateRawSync`: PDF's `FlateDecode` is the
 * zlib-wrapped form (RFC 1950), so a fixture built with raw deflate would be a file no
 * real reader could open while this file's own reader passed.
 */
function streamBody (content, options = {}) {
  const raw = Buffer.isBuffer(content) ? content : Buffer.from(content, 'latin1')
  const compressed = options.plain !== true
  const payload = compressed ? zlib.deflateSync(raw) : raw
  const filter = compressed ? ' /Filter /FlateDecode' : ''
  return Buffer.concat([
    Buffer.from(`<<${filter} /Length ${payload.length} >>\nstream\n`, 'latin1'),
    payload,
    Buffer.from('\nendstream', 'latin1'),
  ])
}

/**
 * A stream that claims to be FlateDecode and is not.
 *
 * `0xFF` is the one byte value that fails both readings: as a zlib header its check bits
 * are wrong, and as a raw deflate block it declares the reserved block type. So the
 * refusal is deterministic rather than dependent on how a corrupt stream happens to fall.
 */
function brokenStream () {
  const payload = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
  return Buffer.concat([
    Buffer.from(`<< /Filter /FlateDecode /Length ${payload.length} >>\nstream\n`, 'latin1'),
    payload,
    Buffer.from('\nendstream', 'latin1'),
  ])
}

/** How many object numbers one page needs: its own dictionary, then its content. */
function slotsFor (page) {
  if (page.inline === true) return 1
  if (page.split === true) return 3
  return 2
}

/**
 * A document of the given pages.
 *
 * A page is `{ content, plain, split, inline, brokenRef, corrupt }`. `plain` leaves the
 * stream uncompressed, `split` gives the page two content objects listed in an array,
 * `inline` puts the content stream in the page object itself, `brokenRef` points at an
 * object that was never written, and `corrupt` writes a stream that will not inflate.
 */
function makeDocument (pages, options = {}) {
  let next = 3
  const numbers = pages.map((page) => {
    const number = next
    next += slotsFor(page)
    return number
  })

  const bodies = new Array(next - 1)
  bodies[0] = Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1')

  const kids = numbers.map((number) => `${number} 0 R`).join(' ')
  bodies[1] = Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, 'latin1')

  const pageDictionary = (contents) =>
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]${contents} >>`, 'latin1')

  pages.forEach((page, index) => {
    const number = numbers[index]

    if (page.inline === true) {
      bodies[number - 1] = Buffer.concat([
        pageDictionary(''),
        Buffer.from('\n', 'latin1'),
        streamBody(page.content, page),
      ])
      return
    }

    if (page.split === true) {
      bodies[number - 1] = pageDictionary(` /Contents [${number + 1} 0 R ${number + 2} 0 R]`)
      bodies[number] = streamBody(page.content[0], page)
      bodies[number + 1] = streamBody(page.content[1], page)
      return
    }

    if (page.brokenRef === true) {
      bodies[number - 1] = pageDictionary(' /Contents 9999 0 R')
      // The second slot has to be filled or every later object number shifts. A real
      // file would simply never have written it.
      bodies[number] = streamBody('BT ET')
      return
    }

    bodies[number - 1] = pageDictionary(` /Contents ${number + 1} 0 R`)
    bodies[number] = page.corrupt === true ? brokenStream() : streamBody(page.content, page)
  })

  return buildPdf(bodies, options)
}

/** Every section's text, joined, so a multi-page fixture can be asserted in one go. */
function allText (result) {
  return result.sections.map((section) => section.text).join('\n')
}

/* ------------------------------------------------------------------ *
 * Compressed and uncompressed streams
 * ------------------------------------------------------------------ */

test('a FlateDecode page and an uncompressed page each become one section, in page order', () => {
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (Rent roll for November.) Tj ET' },
    { content: 'BT /F1 12 Tf 72 720 Td (Supplier list for the Abuja site.) Tj ET', plain: true },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.sections.map((section) => section.page), [1, 2])
  assert.deepEqual(result.sections.map((section) => section.text), [
    'Rent roll for November.',
    'Supplier list for the Abuja site.',
  ])
  // A PDF has no headings in its text layer, so nothing is claimed about them.
  assert.deepEqual(result.sections.map((section) => section.section), [null, null])
  assert.deepEqual(result.ocrPending, [])
})

test('a content stream that will not inflate is refused as unreadable', () => {
  const pdf = makeDocument([{ content: null, corrupt: true }])

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'unreadable')
      return true
    },
  )
})

test('a content stream that expands past the ceiling is refused as too large', () => {
  /*
   * A few kilobytes on disk that inflate to more than the ceiling: the shape of a
   * decompression bomb. The guard has to fire inside zlib, so the only way to know it
   * does is to hand it a stream that really does expand that far.
   */
  const bomb = Buffer.alloc(MAX_EXPANDED_BYTES + 4096, 0x41)
  const pdf = makeDocument([{ content: bomb }])

  assert.ok(pdf.length < 2_000_000, `the fixture should be small on disk, saw ${pdf.length} bytes`)

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'too_large')
      return true
    },
  )
})

/* ------------------------------------------------------------------ *
 * Text operators
 * ------------------------------------------------------------------ */

test('a TJ array joins its pieces without inserting spaces and drops the kerning numbers', () => {
  /*
   * The numbers between the strings are kerning adjustments, which is the writer saying
   * the glyphs already carry that spacing. Turning them into spaces is the classic way to
   * turn "Tilley" into "Til ley", so the joined result is asserted exactly.
   */
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td [(Tilley) -250 (quotation)] TJ ET' },
  ])

  assert.equal(allText(api.extractPdf(pdf)), 'Tilleyquotation')
})

test('a TJ array keeps a space the writer put in the array itself', () => {
  // The positive control for the test above: the array can express a space, and when it
  // does, it has to survive, or the previous test would pass on a reader that drops all
  // separators.
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td [(Tilley) ( quotation)] TJ ET' },
  ])

  assert.equal(allText(api.extractPdf(pdf)), 'Tilley quotation')
})

test('the quote operators draw a line of their own and the positioning operators break the line', () => {
  const content = [
    'BT /F1 12 Tf 72 720 Td (first) Tj',
    'T*',
    '(second) Tj',
    'T*',
    '(third) Tj',
    // The quote operators take the spacing operands first and the string last, so this
    // line also proves the string is found rather than whatever came before it.
    '(fourth) 1 0 "',
    'ET',
    'BT 72 600 Td (fifth) Tj ET',
    'BT 72 580 TD (sixth) Tj ET',
    'BT 1 0 0 1 72 560 Tm (seventh) Tj ET',
  ].join('\n')

  assert.deepEqual(
    allText(api.extractPdf(makeDocument([{ content }]))).split('\n'),
    ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'],
  )
})

test('every string escape the format defines is decoded', () => {
  const content = [
    'BT /F1 12 Tf 72 720 Td (A \\(round\\) bracket) Tj',
    'T*',
    '(octal \\101\\102\\103 here) Tj',
    'T*',
    '(continued\\\nline) Tj',
    'T*',
    '(tab\\there) Tj',
    'T*',
    '(one\\\\two) Tj',
    'ET',
  ].join('\n')

  assert.deepEqual(
    allText(api.extractPdf(makeDocument([{ content }]))).split('\n'),
    [
      'A (round) bracket',
      'octal ABC here',
      // The backslash before the newline is a continuation: the break is layout, not text.
      'continuedline',
      'tab\there',
      'one\\two',
    ],
  )
})

test('a hex string is decoded, and one carrying a byte-order mark is read as UTF-16BE', () => {
  const content = [
    'BT /F1 12 Tf 72 720 Td <48656C6C6F> Tj',
    'T*',
    // FE FF marks UTF-16BE; 00E9 is "e" with an acute accent.
    '<FEFF00E9> Tj',
    'T*',
    // Whitespace inside a hex string is ignored by the format.
    '<54 69 6C 6C 65 79> Tj',
    'T*',
    // An odd number of digits is padded with a zero, so the trailing 4 becomes 0x40.
    '<41 4> Tj',
    'ET',
  ].join('\n')

  assert.deepEqual(
    allText(api.extractPdf(makeDocument([{ content }]))).split('\n'),
    ['Hello', '\u00e9', 'Tilley', 'A@'],
  )
})

test('bytes 0x80 to 0x9F decode as WinAnsi punctuation rather than control characters', () => {
  /*
   * Real documents leave their fonts in WinAnsi, which puts the apostrophe, the quotes,
   * the dashes and the bullet in the range Latin-1 calls control characters. Reading them
   * as Latin-1 leaves an invisible byte where every apostrophe should be, which is silent
   * corruption of the text that gets chunked and cited.
   */
  const content = Buffer.concat([
    Buffer.from('BT /F1 12 Tf 72 720 Td (It', 'latin1'),
    Buffer.from([0x92]),
    Buffer.from('s ', 'latin1'),
    Buffer.from([0x93]),
    Buffer.from('quoted', 'latin1'),
    Buffer.from([0x94]),
    Buffer.from(' and a dash ', 'latin1'),
    Buffer.from([0x96]),
    Buffer.from(' then a bullet ', 'latin1'),
    Buffer.from([0x95]),
    Buffer.from(') Tj ET', 'latin1'),
  ])

  assert.equal(
    allText(api.extractPdf(makeDocument([{ content }]))),
    'It\u2019s \u201cquoted\u201d and a dash \u2013 then a bullet \u2022',
  )
})

/* ------------------------------------------------------------------ *
 * Finding pages and their content
 * ------------------------------------------------------------------ */

test('a page that splits its content into two objects is read in the order they are listed', () => {
  const pdf = makeDocument([
    {
      split: true,
      content: [
        'BT /F1 12 Tf 72 720 Td (The Tilley ) Tj ET',
        'BT /F1 12 Tf 72 700 Td (quotation expires on Friday.) Tj ET',
      ],
    },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 1)
  // Normalised, because the boundary between two content streams is a line break here:
  // a reader without font metrics cannot tell it from a new line of the same paragraph.
  assert.equal(result.sections[0].text.replace(/\s+/g, ' '), 'The Tilley quotation expires on Friday.')
})

test('a page that carries its own inline stream is read', () => {
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (Inline content) Tj ET', inline: true },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 1)
  assert.equal(result.sections[0].text, 'Inline content')
})

test('the page tree is not mistaken for a page, and every page object is counted once', () => {
  /*
   * `/Type /Pages` is the node above the pages and carries no content. A reader that
   * matched it would produce an extra, empty section at the front and shift every page
   * number after it, which is how a citation ends up pointing at the wrong page.
   */
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (one) Tj ET', plain: true },
    { content: 'BT /F1 12 Tf 72 720 Td (two) Tj ET', plain: true },
    { content: 'BT /F1 12 Tf 72 720 Td (three) Tj ET', plain: true },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 3)
  assert.deepEqual(result.sections.map((section) => section.text), ['one', 'two', 'three'])
})

/* ------------------------------------------------------------------ *
 * Scans
 * ------------------------------------------------------------------ */

test('an image-only page is reported as needing OCR and no text is invented for it', () => {
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (Signed and dated.) Tj ET' },
    // A page that draws an image and never asks for a glyph to be shown.
    { content: 'q 100 0 0 100 0 0 cm /Im0 Do Q' },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.sections.map((section) => section.page), [1])
  assert.deepEqual(result.ocrPending, [2])
})

test('a document that is entirely image-only returns no sections and names every page', () => {
  const pdf = makeDocument([
    { content: 'q 100 0 0 100 0 0 cm /Im0 Do Q' },
    { content: 'q 100 0 0 100 0 0 cm /Im1 Do Q' },
  ])

  const result = api.extractPdf(pdf)

  assert.deepEqual(result.sections, [])
  assert.equal(result.pageCount, 2)
  assert.deepEqual(result.ocrPending, [1, 2])
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('an encrypted document is refused as unreadable rather than reported as empty', () => {
  const pdf = makeDocument(
    [{ content: 'BT /F1 12 Tf 72 720 Td (ciphertext) Tj ET' }],
    { trailerExtra: '/Encrypt 9 0 R' },
  )

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'unreadable')
      return true
    },
  )
})

test('a file that does not start with the PDF header is refused as unreadable', () => {
  for (const notAPdf of [
    Buffer.from('This is a text file, not a document.\n', 'latin1'),
    Buffer.from('PK\u0003\u0004 a zip that was renamed\n', 'latin1'),
    Buffer.alloc(0),
  ]) {
    assert.throws(
      () => api.extractPdf(notAPdf),
      (error) => {
        assert.equal(error.name, 'ExtractionError')
        assert.equal(error.failure, 'unreadable')
        return true
      },
    )
  }
})

test('a file past the input ceiling is refused as too large before anything reads it', () => {
  /*
   * Allocated rather than faked, because there is no way to hand the extractor a length
   * without the bytes behind it. It is uninitialised on purpose: the size check runs
   * before the header is looked at, so a buffer full of nothing in particular is exactly
   * the input that proves the order.
   */
  const oversized = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1)

  assert.throws(
    () => api.extractPdf(oversized),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'too_large')
      return true
    },
  )
})

test('a document with no page objects is refused as a parse failure', () => {
  assert.throws(
    () => api.extractPdf(makeDocument([])),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'parse_failed')
      return true
    },
  )
})

/* ------------------------------------------------------------------ *
 * Pages that cannot be read
 * ------------------------------------------------------------------ */

test('a page whose content cannot be read is skipped while the other pages are kept', () => {
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (The page that reads.) Tj ET' },
    // A stream that stops inside a string, so nothing after it can be trusted.
    { content: 'BT /F1 12 Tf 72 720 Td (a string that never closes' },
    // A page pointing at an object that was never written.
    { content: null, brokenRef: true },
    { content: 'BT /F1 12 Tf 72 720 Td (The last page reads too.) Tj ET' },
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 4)
  assert.deepEqual(result.sections.map((section) => section.page), [1, 4])
  /*
   * Neither skipped page is listed as needing OCR. "This page holds an image" is a claim
   * about the document, and these two pages could not be read at all, which is a
   * different thing to say.
   */
  assert.deepEqual(result.ocrPending, [])
})

test('a document where no page yields text and none needs OCR is refused as a parse failure', () => {
  const pdf = makeDocument([
    { content: 'BT /F1 12 Tf 72 720 Td (a string that never closes' },
    { content: null, brokenRef: true },
  ])

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'parse_failed')
      return true
    },
  )
})

test('a page whose text operators draw nothing does not become a section', () => {
  // Empty and whitespace-only strings are drawn text with nothing in them: the page is
  // read, it simply has nothing worth citing, so no section and no OCR claim either.
  const pdf = makeDocument([{ content: 'BT /F1 12 Tf 72 720 Td () Tj (   ) Tj ET' }])

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'parse_failed')
      return true
    },
  )
})

/* ------------------------------------------------------------------ *
 * One stream, named many times
 * ------------------------------------------------------------------ */

/**
 * A one-page PDF whose single content stream is named `references` times.
 *
 * Built from object bodies rather than through `makeDocument`, because the array has to be
 * long enough to matter and `makeDocument` describes a page as one or two parts. The local
 * `buildPdf` records honest offsets either way, so the only unusual thing here is the array.
 */
function repeatedContentsDocument (references, payload) {
  const contents = new Array(references).fill('4 0 R').join(' ')
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents [${contents}] >>`,
      'latin1',
    ),
    streamBody(payload),
  ])
}

test('a page that names the same stream many times is refused rather than decoded for each name', () => {
  /*
   * A per-stream ceiling is not a per-page one. `/Contents` may legally be an array, and an
   * array may name the same object a hundred times: each name decoded that stream again in
   * full, and the page only looked too big after every copy had been collected and joined.
   * The sizes here are honest, which is what makes this different from a lying entry - the
   * file is simply asking to be read more times than the budget allows.
   *
   * One byte repeated deflates to about a kilobyte, so the file stays tiny however many
   * times it is named.
   */
  const payload = Buffer.alloc(1024 * 1024, 0x41)
  const references = Math.floor(MAX_EXPANDED_BYTES / payload.length) + 1

  const pdf = repeatedContentsDocument(references, payload)

  // A big file would be refused by the input ceiling instead, and would prove nothing about
  // the multiplier.
  assert.ok(pdf.length < 100_000, `the fixture should be small on disk, saw ${pdf.length} bytes`)

  assert.throws(
    () => api.extractPdf(pdf),
    (error) => {
      assert.equal(error.name, 'ExtractionError')
      assert.equal(error.failure, 'too_large')
      return true
    },
  )
})

test('a page that names a small stream twice is still read, so the budget refuses only what it should', () => {
  /*
   * The control. Repeating a reference is legal and a writer that appends to a page does it,
   * so the budget must not turn a genuinely small page into a refusal.
   */
  const content = 'BT /F1 12 Tf 72 720 Td (Repointing the Tilley elevation.) Tj ET'
  const pdf = buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents [4 0 R 4 0 R] >>',
      'latin1',
    ),
    streamBody(content),
  ])

  const result = api.extractPdf(pdf)

  assert.equal(result.pageCount, 1)
  assert.equal(result.sections.length, 1)
  // Named twice, drawn twice: the point is that it was read at all, not how many times.
  assert.equal(result.sections[0].text.match(/Repointing the Tilley elevation\./g).length, 2)
})
