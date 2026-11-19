'use strict'

/*
 * The text, markdown and CSV reader, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS the
 * main process runs. The single wiring assertion at the top is deliberate: a missing
 * re-export in `main/ipc/index.ts` should read as the wiring step it is, not as a dozen
 * failures about `undefined`.
 *
 * Three of the properties below throw when they break, and three do not, which is why
 * they are all stated here rather than trusted.
 *
 * A section boundary is a citation target. If a markdown heading produced no section, or
 * a horizontal rule produced one, an answer would cite a heading that does not exist or a
 * page that was never there - and nothing about the extraction would look wrong. The
 * `---` line is checked twice for exactly this reason: as a setext underline under text,
 * and as a rule under a blank line.
 *
 * CSV is where a naive reader quietly produces one column. A quoted field holding a comma
 * and a newline is the ordinary case in a supplier list, and a semicolon export from a
 * European spreadsheet is the ordinary case in an accounts department. Both are asserted
 * on the exact text that comes out, because "it did not throw" proves nothing here.
 *
 * The refusal cases matter as much as the successes. A zero-byte file, a file of
 * nothing but commas and a binary file renamed to `.txt` all have to fail, because
 * succeeding would store a document that can never produce a chunk.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

assert.equal(
  typeof api.extractText,
  'function',
  'desktop/features/copilot/main/ipc/index.ts must export * from \'../documents/text.js\'',
)

/*
 * The input ceiling, repeated rather than imported.
 *
 * The bundle only publishes what the main index re-exports, and the limits live in
 * `documents/types.ts`, which that index may not surface. The value is stated in a
 * comment there as 200 MB, so if it moves, the test that asserts on it fails loudly
 * instead of quietly testing the wrong bound.
 */
const MAX_INPUT_BYTES = 200 * 1024 * 1024

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function utf8 (text) {
  return new TextEncoder().encode(text)
}

/** A refusal is the parser's own token, never a driver message. */
function refusal (failure) {
  return (error) => {
    assert.equal(error && error.name, 'ExtractionError', `not an ExtractionError: ${String(error)}`)
    assert.equal(error.failure, failure)
    return true
  }
}

/** The sections as [section, text] pairs, which is what a citation would name. */
function outline (result) {
  return result.sections.map((section) => [section.section, section.text])
}

/* ------------------------------------------------------------------ *
 * Plain text
 * ------------------------------------------------------------------ */

test('txt is one section holding the whole file, with no page and no section name', () => {
  const source = 'Rent roll for November.\nTotal: 1,200,000.\n\nSigned by the landlord.'
  const result = api.extractText(utf8(source), 'txt')

  assert.equal(result.pageCount, 0)
  assert.deepEqual(result.ocrPending, [])
  assert.equal(result.sections.length, 1)
  assert.deepEqual(result.sections[0], { page: null, section: null, text: source })
})

test('a byte-order mark and Windows line endings are removed before anything is split', () => {
  const bytes = utf8('\ufeffLine one\r\nLine two\rLine three\n')
  const result = api.extractText(bytes, 'txt')

  /*
   * A stray `\r` would otherwise sit at the end of every heading in a markdown file
   * written on Windows, and `# Terms\r` does not match a heading pattern - which is a
   * section boundary silently disappearing rather than an error.
   */
  assert.equal(result.sections[0].text, 'Line one\nLine two\nLine three')
})

test('a file with nothing to read is refused rather than stored as a document that answers nothing', () => {
  assert.throws(() => api.extractText(new Uint8Array(0), 'txt'), refusal('parse_failed'))
  assert.throws(() => api.extractText(utf8('   \n\n\t\n'), 'txt'), refusal('parse_failed'))
  assert.throws(() => api.extractText(utf8('\ufeff\n\n'), 'md'), refusal('parse_failed'))

  // Nothing but field separators is a table with no rows, which is the same dead end.
  assert.throws(() => api.extractText(utf8(',,\n,,\n'), 'csv'), refusal('parse_failed'))

  // Nothing but a horizontal rule: the rule is punctuation, so no text survives it.
  assert.throws(() => api.extractText(utf8('---\n'), 'md'), refusal('parse_failed'))
})

test('a binary file wearing a text extension is refused instead of becoming replacement characters', () => {
  /*
   * Every one of these bytes is invalid UTF-8, so a lossy decode produces nothing but
   * U+FFFD. That is a renamed binary, not a document with an accented word in it.
   */
  const binary = Uint8Array.from([0x80, 0x81, 0x82, 0xfe, 0xff, 0x00, 0x01])
  assert.throws(() => api.extractText(binary, 'txt'), refusal('parse_failed'))
})

test('a file past the input ceiling is refused before it is decoded', () => {
  /* Allocated rather than built: the point is the length, not the contents. */
  const oversized = Buffer.allocUnsafe(MAX_INPUT_BYTES + 1)
  assert.throws(() => api.extractText(oversized, 'txt'), refusal('too_large'))
  assert.throws(() => api.extractText(oversized, 'csv'), refusal('too_large'))
})

test('bytes that are not bytes, and a kind this file does not read, are refused', () => {
  assert.throws(() => api.extractText('not bytes at all', 'txt'), refusal('unreadable'))
  assert.throws(() => api.extractText(null, 'txt'), refusal('unreadable'))

  // A caller outside TypeScript can name a kind that belongs to the office or PDF reader.
  assert.throws(() => api.extractText(utf8('Plans for the Abuja site.'), 'pdf'), refusal('unsupported'))
})

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

test('markdown headings start sections and the text before the first one has no section', () => {
  const source = [
    'A short note at the top.',
    '',
    '# Terms',
    'The quotation expires on Friday.',
    '',
    '## Pricing',
    'Twelve million naira.',
  ].join('\n')

  const result = api.extractText(utf8(source), 'md')

  assert.equal(result.pageCount, 0)
  assert.deepEqual(result.ocrPending, [])
  assert.deepEqual(outline(result), [
    [null, 'A short note at the top.'],
    ['Terms', 'The quotation expires on Friday.'],
    ['Pricing', 'Twelve million naira.'],
  ])

  // No section of a markdown file names a page, because the format has none.
  assert.deepEqual(result.sections.map((section) => section.page), [null, null, null])
})

test('every ATX level starts a section, and a closing run of hashes is not part of the name', () => {
  const source = [
    '# One',
    'body of one',
    '###### Six',
    'body of six',
    '## Notes ##',
    'body of notes',
  ].join('\n')

  const result = api.extractText(utf8(source), 'md')

  assert.deepEqual(outline(result), [
    ['One', 'body of one'],
    ['Six', 'body of six'],
    ['Notes', 'body of notes'],
  ])
})

test('a hash run with no space after it is a sentence, not a heading', () => {
  /*
   * `#1 priority` is the shape this guards: reading it as a heading would drop the line
   * from the body and name a section `1 priority`, inventing structure that is not there.
   */
  const source = ['#1 priority: fix the roof', 'then repaint', '##', 'a hash line'].join('\n')
  const result = api.extractText(utf8(source), 'md')

  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].section, null)
  assert.equal(
    result.sections[0].text,
    '#1 priority: fix the roof\nthen repaint\n##\na hash line',
  )
})

test('a line of equals or dashes under text makes that text a heading', () => {
  const source = [
    'Introduction',
    '============',
    'Body of the introduction.',
    '',
    'Pricing',
    '-------',
    'Twelve million naira.',
  ].join('\n')

  const result = api.extractText(utf8(source), 'md')

  assert.deepEqual(outline(result), [
    ['Introduction', 'Body of the introduction.'],
    ['Pricing', 'Twelve million naira.'],
  ])
})

test('a setext heading keeps its body even when no blank line follows the underline', () => {
  /*
   * The common shape in a real file, and the one a "is there a blank line after it?"
   * rule would get wrong: the underline still belongs to the paragraph above it.
   */
  const source = ['Installation', '------------', 'Run the installer.'].join('\n')
  assert.deepEqual(outline(api.extractText(utf8(source), 'md')), [
    ['Installation', 'Run the installer.'],
  ])
})

test('a setext heading under a two-line paragraph takes the whole paragraph as its name', () => {
  const source = ['Quarterly', 'report', '=====', 'The figures are below.'].join('\n')
  assert.deepEqual(outline(api.extractText(utf8(source), 'md')), [
    ['Quarterly report', 'The figures are below.'],
  ])
})

test('a line of dashes after a blank line is a horizontal rule, not a setext underline', () => {
  /*
   * The ambiguous case, decided and stated. A rule carries no words, so it becomes
   * nothing; what matters is that it does not turn the paragraph above it into a heading,
   * which would move that text into a section named after itself.
   */
  const source = ['First paragraph.', '', '---', 'Second paragraph.'].join('\n')

  const result = api.extractText(utf8(source), 'md')

  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].section, null)
  assert.equal(result.sections[0].text, 'First paragraph.\n\nSecond paragraph.')
})

test('a run of dashes under an ATX heading is a rule, not a second heading', () => {
  /*
   * A heading is already complete, so it cannot be underlined. Treating the dashes as a
   * setext underline would name a section after the heading text a second time and lose
   * the heading itself.
   */
  const source = ['# Terms', '---', 'Body text.'].join('\n')
  assert.deepEqual(outline(api.extractText(utf8(source), 'md')), [['Terms', 'Body text.']])
})

test('a rule at the very start of the file is dropped and does not become a section', () => {
  const source = ['---', '# Terms', 'Body text.'].join('\n')
  assert.deepEqual(outline(api.extractText(utf8(source), 'md')), [['Terms', 'Body text.']])
})

test('a markdown file written on Windows still has its headings found', () => {
  const source = '\ufeff# Terms\r\nThe quotation expires on Friday.\r\n\r\n## Pricing\r\n12m.\r\n'
  assert.deepEqual(outline(api.extractText(utf8(source), 'md')), [
    ['Terms', 'The quotation expires on Friday.'],
    ['Pricing', '12m.'],
  ])
})

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

test('csv quotes protect commas, newlines and doubled quotes', () => {
  const source = [
    'name,note',
    '"Lofts, Zuri",ok',
    '"two\nlines",fine',
    '"he said ""yes""",quoted',
  ].join('\n')

  const result = api.extractText(utf8(source), 'csv')

  assert.equal(result.pageCount, 0)
  assert.deepEqual(result.ocrPending, [])
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].section, null)
  assert.equal(result.sections[0].page, null)
  assert.equal(
    result.sections[0].text,
    'name\tnote\nLofts, Zuri\tok\ntwo\nlines\tfine\nhe said "yes"\tquoted',
  )
})

test('a semicolon-delimited export is parsed into columns rather than one', () => {
  /*
   * A European spreadsheet writes `;` because the comma is its decimal separator. A
   * comma-only reader turns every one of these rows into a single column, and the file
   * still looks readable, which is why this is asserted on the exact text.
   */
  const source = ['code;description', 'A1;Roof repairs', 'B2;Painting, exterior'].join('\n')

  assert.equal(
    api.extractText(utf8(source), 'csv').sections[0].text,
    'code\tdescription\nA1\tRoof repairs\nB2\tPainting, exterior',
  )
})

test('a tab-separated file copied out of a spreadsheet is parsed into columns', () => {
  const source = ['month\tamount', 'November\t1200000'].join('\n')
  assert.equal(
    api.extractText(utf8(source), 'csv').sections[0].text,
    'month\tamount\nNovember\t1200000',
  )
})

test('a comma inside a quoted header does not make a semicolon file look comma-delimited', () => {
  const source = ['name;"Total, naira"', 'Lofts;1200000'].join('\n')
  assert.equal(
    api.extractText(utf8(source), 'csv').sections[0].text,
    'name\tTotal, naira\nLofts\t1200000',
  )
})

test('a comma file is still read as commas when a later row holds a semicolon', () => {
  /*
   * The delimiter is decided from the header, so a semicolon in one value does not split
   * that row differently from the rest of the file.
   */
  const source = ['name,note', 'Lofts,liveable; affordable'].join('\n')
  assert.equal(
    api.extractText(utf8(source), 'csv').sections[0].text,
    'name\tnote\nLofts\tliveable; affordable',
  )
})

test('completely empty rows are dropped rather than becoming blank lines', () => {
  const source = ['a,b', '', ',,', 'c,d', ''].join('\n')
  assert.equal(api.extractText(utf8(source), 'csv').sections[0].text, 'a\tb\nc\td')
})

test('a stray quote inside an unquoted field does not swallow the rest of the file', () => {
  /*
   * `6" wall` is an inch mark, not the start of a quoted value. A reader that opened a
   * quote anywhere would take every remaining row as one field, and the file would come
   * back as a single line with no error at all.
   */
  const source = ['name,note', 'Lofts,6" wall', 'Tijha,plain'].join('\n')
  assert.equal(
    api.extractText(utf8(source), 'csv').sections[0].text,
    'name\tnote\nLofts\t6" wall\nTijha\tplain',
  )
})

test('a csv file has one section however many rows it holds', () => {
  const rows = ['sku,qty']
  for (let index = 1; index <= 50; index += 1) rows.push(`item-${index},${index}`)

  const result = api.extractText(utf8(rows.join('\n')), 'csv')

  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].text.split('\n').length, 51)
  assert.equal(result.pageCount, 0)
})

test('crlf line endings in a csv do not leave a carriage return on every field', () => {
  const source = 'name,note\r\nLofts,ok\r\n'
  assert.equal(api.extractText(utf8(source), 'csv').sections[0].text, 'name\tnote\nLofts\tok')
})
