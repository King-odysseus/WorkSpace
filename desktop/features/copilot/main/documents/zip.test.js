'use strict'

/*
 * The ZIP reader's own bounds, driven through the bundle Electron loads.
 *
 * The interesting failures here are the ones a well-formed archive never shows. An entry's
 * central record states two sizes - what it holds on disk and what it expands to - and both
 * are written by whoever made the file. A reader that spends its allowance according to
 * those numbers is trusting the file to police itself:
 *
 * - One entry can claim a single byte and hand over a megabyte of stored data, which costs
 *   one byte of the allowance and allocates a megabyte.
 * - Many entries can name the same local header, so a file of a few kilobytes decodes
 *   itself again and again.
 *
 * Neither needs a clever file. They need a reader that charges the budget with the bytes it
 * actually produced, and that refuses a STORE entry whose two sizes disagree. Those two
 * rules are what this file proves, alongside a normal archive still opening.
 *
 * The writer below is deliberately small and deliberately able to lie, because a helper
 * that could only write honest archives could not build either case.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')

const api = require('../../../../build/main/ipc.cjs')

assert.equal(
  typeof api.readZip,
  'function',
  'desktop/features/copilot/main/index.ts must re-export ../documents/zip.js',
)

/*
 * The ceiling, repeated rather than imported.
 *
 * The bundle only publishes what the main index re-exports, and the limits live in
 * `documents/types.ts`. The value is stated there as 64 MB, so if it moves, the test that
 * depends on it fails loudly instead of quietly checking the wrong bound.
 */
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const EOCD_SIGNATURE = 0x06054b50

/** STORE: the bytes are written as they are. */
const STORE = 0
/** Deflate: the bytes are compressed. */
const DEFLATE = 8

/**
 * One local entry: its header, its name and its data.
 *
 * The sizes in the local header are left honest. Nothing reads them - the reader takes its
 * sizes from the central directory, which is why the central records below are the only
 * place worth lying in - but writing a true local header keeps the fixture honest about
 * what a real writer produces.
 *
 * The checksum is written as zero and never read. Verifying it would be a good idea, but it
 * is not a bound, and adding it here would suggest this test covers something it does not.
 */
function localEntry (name, data, method) {
  const nameBytes = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30)
  header.writeUInt32LE(LOCAL_SIGNATURE, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0, 6)
  header.writeUInt16LE(method, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0x0021, 12)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(nameBytes.length, 26)
  header.writeUInt16LE(0, 28)
  return { bytes: Buffer.concat([header, nameBytes, data]), data, method, name }
}

/**
 * An archive from local entries plus the central records that index them.
 *
 * A record names a local entry by position rather than being welded to one, which is what
 * lets several records point at the same local header - the shape of the multiplied-entry
 * case below.
 */
function buildArchive (locals, records) {
  const chunks = []
  const offsets = []
  let offset = 0

  for (const local of locals) {
    offsets.push(offset)
    chunks.push(local.bytes)
    offset += local.bytes.length
  }

  const directoryOffset = offset
  let directorySize = 0

  for (const record of records) {
    const nameBytes = Buffer.from(record.name, 'utf8')
    const header = Buffer.alloc(46)
    header.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(record.method, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0x0021, 14)
    header.writeUInt32LE(0, 16)
    header.writeUInt32LE(record.compressedSize, 20)
    // The one field worth lying in: what the entry says it will expand to.
    header.writeUInt32LE(record.claimedUncompressed, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offsets[record.localIndex], 42)
    chunks.push(header, nameBytes)
    directorySize += header.length + nameBytes.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(directoryOffset, 16)
  end.writeUInt16LE(0, 20)

  return new Uint8Array(Buffer.concat([...chunks, end]))
}

function refusal (failure) {
  return (error) => {
    assert.equal(error && error.name, 'ExtractionError', `not an ExtractionError: ${String(error)}`)
    assert.equal(error.failure, failure)
    return true
  }
}

/* ------------------------------------------------------------------ *
 * A lie about a STORE entry's size
 * ------------------------------------------------------------------ */

test('a STORE entry that carries more than it claims is refused, not returned', () => {
  /*
   * The case the reader used to miss. STORE promises the two sizes are the same because
   * nothing was compressed, so a disagreement is not a rounding difference - it is an
   * entry asking to be charged one byte and to allocate a megabyte.
   */
  const payload = Buffer.alloc(1024 * 1024, 0x41)
  const local = localEntry('word/document.xml', payload, STORE)
  const archive = buildArchive([local], [
    {
      name: 'word/document.xml',
      localIndex: 0,
      method: STORE,
      compressedSize: payload.length,
      // The lie, and the whole point of the test.
      claimedUncompressed: 0,
    },
  ])

  assert.throws(() => api.readZip(archive), refusal('unreadable'))
})

/* ------------------------------------------------------------------ *
 * Many entries, one local header
 * ------------------------------------------------------------------ */

test('many records naming one lying local header cannot multiply an allocation past the budget', () => {
  /*
   * The multiplier the reader used to allow. Each record claims nothing and hands over a
   * megabyte, so the allowance was charged nothing while a megabyte was allocated - and
   * every record pointed at the same local header, so one megabyte on disk filled memory
   * once per record. The old reader returned all of it.
   *
   * Now the first disagreement is the whole answer, so the repetition never happens.
   */
  const payload = Buffer.alloc(1024 * 1024, 0x41)
  const local = localEntry('xl/sharedStrings.xml', payload, STORE)

  const records = []
  for (let index = 0; index < 64; index += 1) {
    records.push({
      name: `xl/part${index}.xml`,
      localIndex: 0,
      method: STORE,
      compressedSize: payload.length,
      claimedUncompressed: 0,
    })
  }

  const archive = buildArchive([local], records)

  // The payload is carried once and named sixty-four times: this is not a big file.
  assert.ok(archive.length < payload.length * 2, `the archive should carry the payload once, saw ${archive.length} bytes`)
  assert.throws(() => api.readZip(archive), refusal('unreadable'))
})

test('honest entries are charged against the budget until it runs out', () => {
  /*
   * The control for the ceiling itself. Every record here is truthful, so nothing local to
   * an entry is wrong; the archive simply asks for more than the allowance holds and is
   * refused on the entry that would cross it. What matters is that the bound exists in
   * bytes and is spent down, rather than being restarted for each entry.
   */
  const payload = Buffer.alloc(1024 * 1024, 0x41)
  const local = localEntry('xl/pad.xml', payload, STORE)
  const count = Math.floor(MAX_EXPANDED_BYTES / payload.length) + 1

  const records = []
  for (let index = 0; index < count; index += 1) {
    records.push({
      name: `xl/pad${index}.xml`,
      localIndex: 0,
      method: STORE,
      compressedSize: payload.length,
      claimedUncompressed: payload.length,
    })
  }

  assert.throws(() => api.readZip(buildArchive([local], records)), refusal('too_large'))
})

/* ------------------------------------------------------------------ *
 * A deflate entry that expands past its own claim
 * ------------------------------------------------------------------ */

test('a deflate entry is expanded under what is left of the budget, not its own claim', () => {
  /*
   * The claim still caps the output, which is why this ends as a resource refusal rather
   * than as a megabyte allocated. Node's zlib is handed the smaller of the claim and the
   * remaining allowance, so a stream that outgrows its claim is stopped inside zlib.
   */
  const payload = Buffer.alloc(1024 * 1024, 0x42)
  const deflated = zlib.deflateRawSync(payload)
  const local = localEntry('docProps/app.xml', deflated, DEFLATE)

  const archive = buildArchive([local], [
    {
      name: 'docProps/app.xml',
      localIndex: 0,
      method: DEFLATE,
      compressedSize: deflated.length,
      claimedUncompressed: 16,
    },
  ])

  assert.throws(() => api.readZip(archive), refusal('too_large'))
})

/* ------------------------------------------------------------------ *
 * And a well-formed archive still opens
 * ------------------------------------------------------------------ */

test('an honest archive is still read, so the bounds above refuse only what they should', () => {
  /*
   * The control. Without it, every assertion above would also pass on a reader that
   * refused everything.
   */
  const stored = Buffer.from('<w:document/>', 'utf8')
  const compressed = zlib.deflateRawSync(Buffer.from('<?xml version="1.0"?><Types/>', 'utf8'))

  const first = localEntry('word/document.xml', stored, STORE)
  const second = localEntry('[Content_Types].xml', compressed, DEFLATE)

  const archive = buildArchive([first, second], [
    {
      name: 'word/document.xml',
      localIndex: 0,
      method: STORE,
      compressedSize: stored.length,
      claimedUncompressed: stored.length,
    },
    {
      name: '[Content_Types].xml',
      localIndex: 1,
      method: DEFLATE,
      compressedSize: compressed.length,
      claimedUncompressed: '<?xml version="1.0"?><Types/>'.length,
    },
  ])

  const entries = api.readZip(archive)

  assert.deepEqual([...entries.keys()].sort(), ['[Content_Types].xml', 'word/document.xml'])
  assert.equal(Buffer.from(entries.get('word/document.xml').bytes).toString('utf8'), '<w:document/>')
  assert.equal(
    Buffer.from(entries.get('[Content_Types].xml').bytes).toString('utf8'),
    '<?xml version="1.0"?><Types/>',
  )
})
