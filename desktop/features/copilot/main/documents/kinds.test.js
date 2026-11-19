'use strict'

/*
 * The file-kind detector, driven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS the
 * main process runs. The bundle only publishes what `main/ipc/index.ts` re-exports, so
 * a missing name is reported once as the wiring step it is, not as a dozen failures
 * about `undefined`.
 *
 * What this file is really guarding is the promise that a parser is never handed a file
 * that is not what its name claims. Every extension check below has two halves: the
 * right bytes answer a kind, and the wrong bytes answer `null`. Only the second half
 * matters to a person, because a `.pdf` that is really a spreadsheet would otherwise
 * reach the PDF reader and come back as "your document is corrupt".
 *
 * The fixtures are byte arrays rather than strings wherever a signature is not
 * printable, because a signature is bytes: 0x89 is not a character anyone can type, and
 * a fixture that spelled it differently would test a different thing.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const WIRING =
  'desktop/features/copilot/main/ipc/index.ts must export * from \'../documents/kinds.js\''

for (const name of ['detectKind', 'isImageKind', 'kindHasPages']) {
  assert.equal(typeof api[name], 'function', `${name} is missing: ${WIRING}`)
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Bytes from a latin1 string, so a printable signature reads as itself. */
function ascii (text) {
  return new Uint8Array(Buffer.from(text, 'latin1'))
}

const PDF = ascii('%PDF-1.7\n1 0 obj\n')
const NOT_PDF = ascii('<?xml version="1.0"?><document/>')

const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])
const NOT_ZIP = ascii('This is a plain text file that was renamed.')

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
const TIFF_LE = Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])
const TIFF_BE = Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08])
const BMP = Uint8Array.from([0x42, 0x4d, 0x3a, 0x00, 0x00, 0x00, 0x00, 0x00])
const GIF = ascii('GIF89a\x01\x00\x01\x00')
const WEBP = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size
  0x57, 0x45, 0x42, 0x50, // WEBP
  0x56, 0x50, 0x38, 0x20,
])
/* The same container with something else inside it: a sound file, not a picture. */
const RIFF_WAVE = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46,
  0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45,
])

const EMPTY = new Uint8Array(0)

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

test('a .pdf is a pdf only when the bytes begin with the PDF header', () => {
  assert.equal(api.detectKind('Tilley quotation.pdf', PDF), 'pdf')

  /*
   * The case this function exists for. A file renamed to `.pdf` and handed to the PDF
   * reader comes back as a corrupt document, which sends the person looking for a
   * problem in their file rather than in its name.
   */
  assert.equal(api.detectKind('Tilley quotation.pdf', NOT_PDF), null)
  assert.equal(api.detectKind('Tilley quotation.pdf', EMPTY), null)
  assert.equal(api.detectKind('Tilley quotation.pdf', ascii('%PD')), null)

  // Four bytes are not enough: the dash is part of the header.
  assert.equal(api.detectKind('short.pdf', ascii('%PDF')), null)
})

/* ------------------------------------------------------------------ *
 * The office formats
 * ------------------------------------------------------------------ */

test('a .docx, .xlsx or .pptx is that kind only when the bytes begin with a zip header', () => {
  for (const name of ['brief.docx', 'rent-roll.xlsx', 'pitch.pptx']) {
    assert.equal(api.detectKind(name, ZIP), name.slice(name.lastIndexOf('.') + 1))
    assert.equal(api.detectKind(name, NOT_ZIP), null, `${name} was accepted without a zip header`)
    assert.equal(api.detectKind(name, EMPTY), null, `${name} was accepted with no bytes at all`)
  }

  /*
   * A renamed PDF is the same mistake from the other side: it starts with `%PDF-` and
   * not with a zip header, so no office parser is asked to open it.
   */
  assert.equal(api.detectKind('brief.docx', PDF), null)

  // A `.zip` itself has the right bytes but no reader in this build.
  assert.equal(api.detectKind('archive.zip', ZIP), null)
})

/* ------------------------------------------------------------------ *
 * The text formats
 * ------------------------------------------------------------------ */

test('plain text, markdown and csv are recognised from the extension alone', () => {
  /*
   * No signature is checked for these three, and that is deliberate: any byte can
   * appear in a CSV field, so an apparent check would be theatre. The reader refuses a
   * file that decodes to nothing instead.
   */
  for (const bytes of [ascii('Rent roll for November.'), ZIP, EMPTY, NOT_PDF]) {
    assert.equal(api.detectKind('notes.txt', bytes), 'txt')
    assert.equal(api.detectKind('notes.md', bytes), 'md')
    assert.equal(api.detectKind('notes.markdown', bytes), 'md')
    assert.equal(api.detectKind('rows.csv', bytes), 'csv')
  }
})

/* ------------------------------------------------------------------ *
 * Pictures
 * ------------------------------------------------------------------ */

test('each image extension is confirmed by the magic number of that format', () => {
  const cases = [
    ['site-plan.png', PNG],
    ['photo.jpg', JPEG],
    ['photo.jpeg', JPEG],
    ['scan.tif', TIFF_LE],
    ['scan.tiff', TIFF_BE],
    ['diagram.bmp', BMP],
    ['animation.gif', GIF],
    ['picture.webp', WEBP],
  ]

  for (const [name, bytes] of cases) {
    assert.equal(api.detectKind(name, bytes), 'image', `${name} should have been an image`)
  }
})

test('an image extension with the wrong bytes is not an image', () => {
  /*
   * Each pair is the wrong picture for the extension, which is the common real case: a
   * WebP saved with a `.png` name, or a screenshot that is really a JPEG.
   */
  assert.equal(api.detectKind('site-plan.png', JPEG), null)
  assert.equal(api.detectKind('photo.jpg', PNG), null)
  assert.equal(api.detectKind('scan.tif', PNG), null)
  assert.equal(api.detectKind('diagram.bmp', PNG), null)
  assert.equal(api.detectKind('animation.gif', PNG), null)
  assert.equal(api.detectKind('picture.webp', PNG), null)

  // A RIFF container holding something other than WebP is not a picture.
  assert.equal(api.detectKind('sound.webp', RIFF_WAVE), null)
  // A truncated WebP: the header is there but the format name is not.
  assert.equal(api.detectKind('short.webp', ascii('RIFF')), null)

  // And no image extension accepts a text file or nothing.
  for (const name of ['site-plan.png', 'photo.jpg', 'picture.webp']) {
    assert.equal(api.detectKind(name, NOT_PDF), null)
    assert.equal(api.detectKind(name, EMPTY), null)
  }
})

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

test('the extension is matched without regard to case', () => {
  assert.equal(api.detectKind('TILLEY QUOTATION.PDF', PDF), 'pdf')
  assert.equal(api.detectKind('Site Plan.PNG', PNG), 'image')
  assert.equal(api.detectKind('Notes.MD', ascii('text')), 'md')
  assert.equal(api.detectKind('Rows.CSV', ascii('a,b')), 'csv')
  assert.equal(api.detectKind('Brief.DocX', ZIP), 'docx')
})

test('a path is handled, and a dot in a folder name is not an extension', () => {
  assert.equal(api.detectKind('C:\\Users\\Mega-Mind\\Documents\\report.v2.pdf', PDF), 'pdf')
  assert.equal(api.detectKind('/home/zuri/brief.docx', ZIP), 'docx')

  /*
   * The only dot in this name is in a folder, so there is no extension and no parser
   * should be chosen. Taking the last dot in the whole string would have read this as a
   * file of kind "v2\\notes".
   */
  assert.equal(api.detectKind('C:\\Users\\me.v2\\notes', ascii('words')), null)
})

test('an unknown extension, a missing extension and a bare dot answer null', () => {
  assert.equal(api.detectKind('setup.exe', ascii('MZ')), null)
  assert.equal(api.detectKind('archive.tar.gz', ZIP), null)
  assert.equal(api.detectKind('README', ascii('# Notes')), null)
  assert.equal(api.detectKind('report.', PDF), null)
  assert.equal(api.detectKind('.gitignore', ascii('node_modules')), null)
  assert.equal(api.detectKind('', PDF), null)

  // A kind this build has no reader for, even though the bytes are recognisable.
  assert.equal(api.detectKind('sheet.ods', ZIP), null)
})

/* ------------------------------------------------------------------ *
 * The two helpers the ingestion asks
 * ------------------------------------------------------------------ */

test('isImageKind and kindHasPages answer for every kind in the contract', () => {
  /*
   * The list is repeated from `shared/storage-contract.ts` on purpose: this test is the
   * thing that fails if the contract grows a kind and these two helpers are not revisited.
   */
  const kinds = ['pdf', 'docx', 'txt', 'md', 'xlsx', 'csv', 'pptx', 'image']

  for (const kind of kinds) {
    assert.equal(api.isImageKind(kind), kind === 'image', `isImageKind(${kind})`)
    assert.equal(api.kindHasPages(kind), kind === 'pdf', `kindHasPages(${kind})`)
  }

  // An office format has sheets or slides but no pages, so neither helper claims one.
  assert.equal(api.kindHasPages('docx'), false)
  assert.equal(api.kindHasPages('xlsx'), false)
  assert.equal(api.kindHasPages('pptx'), false)
})
