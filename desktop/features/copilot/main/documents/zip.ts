/*
 * A minimal ZIP reader, because a DOCX, XLSX and PPTX are ZIP archives of XML.
 *
 * Why this exists rather than a package. All three Office formats are the same
 * container, and reading it needs about eighty lines: find the central directory at the
 * end of the file, then inflate the entries it names. Adding a dependency to do that
 * would put a third-party parser on the path that reads every document a person
 * attaches - the widest exposure in the app - to save those eighty lines. Node's own
 * `zlib` does the only hard part.
 *
 * Why the central directory and not a scan from the front. Entries are described twice:
 * once in a local header at the start of each entry's data, and once in the central
 * directory at the end. The local headers may carry sizes of zero and a flag saying
 * "look in a data descriptor after the bytes", which is legal and common in files
 * written by streaming writers. The central directory always holds the real sizes, so
 * it is the only reliable index.
 *
 * Why every bound is applied before inflating. A ZIP bomb is a few kilobytes on disk
 * that expands to gigabytes. `maxOutputLength` stops zlib itself rather than relying on
 * checking the result afterwards, because afterwards is too late to matter.
 */

import { inflateRawSync } from 'node:zlib'
import { MAX_EXPANDED_BYTES, MAX_ZIP_ENTRIES, refuse } from './types.js'

export interface ZipEntry {
  name: string
  bytes: Uint8Array
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

/** The end-of-central-directory record is at least 22 bytes, then up to 64 KB of comment. */
const EOCD_MIN_SIZE = 22
const EOCD_MAX_COMMENT = 0xffff

/** The largest central directory this reader will walk: a bound on the index itself. */
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024

function view (bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Where the end-of-central-directory record starts, or -1.
 *
 * Searched backwards from the end because the record sits at the end by definition,
 * and a file may legally carry a comment of any length after it. A forward scan could
 * match the four signature bytes inside an entry's compressed data and point at
 * nonsense.
 */
function findEndOfCentralDirectory (bytes: Uint8Array, data: DataView): number {
  if (bytes.length < EOCD_MIN_SIZE) return -1
  const lowest = Math.max(0, bytes.length - EOCD_MIN_SIZE - EOCD_MAX_COMMENT)
  for (let at = bytes.length - EOCD_MIN_SIZE; at >= lowest; at -= 1) {
    if (data.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  return -1
}

/**
 * Whether a failure was the ceiling being reached rather than a corrupt stream.
 *
 * zlib reports a `maxOutputLength` breach as a `RangeError` carrying its own code. The
 * code is checked first and the type second, because a corrupt stream never raises a
 * range error: the distinction decides between `too_large` and `unreadable`, and a
 * version of Node that renames the code must not turn a bomb into a corrupt entry.
 */
function exceededCeiling (error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') return true
  return error instanceof RangeError
}

/**
 * One deflated entry, expanded under a limit the caller has already spent.
 *
 * `limit` is what is left of the archive's budget, never a fresh ceiling, so entries
 * cannot each be spent the whole allowance in turn.
 */
function inflateEntry (raw: Uint8Array, limit: number): Uint8Array {
  try {
    return inflateRawSync(raw, { maxOutputLength: limit })
  } catch (error) {
    // Past the limit is a resource refusal a caller can explain to a person; anything
    // else is a deflate stream that will not inflate, which is a corrupt entry.
    if (exceededCeiling(error)) refuse('too_large')
    refuse('unreadable')
  }
}

/**
 * Unpack every entry into memory, keyed by its path inside the archive.
 *
 * Everything is decompressed up front rather than lazily, because a caller reads a
 * handful of named parts and then discards the archive - lazy loading would keep the
 * whole compressed file alive for no benefit. The total is bounded so "all of it" is a
 * known size rather than a guess.
 */
export function readZip (bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.length < EOCD_MIN_SIZE) refuse('unreadable')

  const data = view(bytes)
  const eocd = findEndOfCentralDirectory(bytes, data)
  if (eocd < 0) refuse('unreadable')

  const totalEntries = data.getUint16(eocd + 10, true)
  const directorySize = data.getUint32(eocd + 12, true)
  const directoryOffset = data.getUint32(eocd + 16, true)

  if (totalEntries === 0) refuse('parse_failed')
  if (totalEntries > MAX_ZIP_ENTRIES) refuse('too_large')
  if (directorySize > MAX_CENTRAL_DIRECTORY_BYTES) refuse('too_large')
  if (directoryOffset + directorySize > bytes.length) refuse('unreadable')

  const entries = new Map<string, ZipEntry>()
  let expanded = 0
  let at = directoryOffset

  for (let index = 0; index < totalEntries; index += 1) {
    // A directory that ends early or runs off its own end is a corrupt file, not a
    // file with fewer entries: the count above already promised how many there are.
    if (at + 46 > bytes.length) refuse('unreadable')
    if (data.getUint32(at, true) !== CENTRAL_SIGNATURE) refuse('unreadable')

    const method = data.getUint16(at + 10, true)
    const compressedSize = data.getUint32(at + 20, true)
    const uncompressedSize = data.getUint32(at + 24, true)
    const nameLength = data.getUint16(at + 28, true)
    const extraLength = data.getUint16(at + 30, true)
    const commentLength = data.getUint16(at + 32, true)
    const localOffset = data.getUint32(at + 42, true)

    if (at + 46 + nameLength > bytes.length) refuse('unreadable')
    const name = utf8(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    // ZIP64 marks an oversized field with all ones in the 32-bit slot. These formats
    // never need it, and reading those fields as real numbers would mean seeking to
    // offset 4 GB rather than reporting what happened.
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      refuse('unreadable')
    }

    // Directories are entries with no content and a trailing slash. They carry no text
    // and a caller never asks for one.
    if (name.endsWith('/')) continue

    if (localOffset + 30 > bytes.length) refuse('unreadable')
    if (data.getUint32(localOffset, true) !== LOCAL_SIGNATURE) refuse('unreadable')

    // The local header repeats the name and extra field, and its lengths are the
    // authority for where its data starts - they can differ from the central copy.
    const localNameLength = data.getUint16(localOffset + 26, true)
    const localExtraLength = data.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > bytes.length) refuse('unreadable')

    const raw = bytes.subarray(dataStart, dataStart + compressedSize)

    /*
     * STORE means nothing was compressed, so the two sizes are the same number by
     * definition. Checking that is what stops the budget being spent on a claim: an entry
     * may report one byte in its central record and hand over a megabyte of stored data,
     * which would be charged to the ceiling as one byte and then copied in full. Many
     * entries naming the same local header need only a small file to exhaust the heap that
     * way, so a disagreement is treated as the corrupt file it is.
     */
    if (method === 0 && compressedSize !== uncompressedSize) refuse('unreadable')

    // What is left of the archive's allowance, checked against the bytes this entry will
    // really contribute rather than against what its record says it contributes.
    const remaining = MAX_EXPANDED_BYTES - expanded
    if (remaining <= 0) refuse('too_large')

    let content: Uint8Array
    if (method === 0) {
      // Refused before the copy rather than after it: afterwards is a megabyte already
      // allocated, which is the thing the ceiling exists to prevent.
      if (compressedSize > remaining) refuse('too_large')
      content = raw.slice()
    } else if (method === 8) {
      /*
       * zlib is given what is left of the budget, not the entry's own claim about its
       * size, so a stream that inflates past the ceiling is stopped inside zlib instead
       * of being allocated and then measured. The claim still caps the output, which is
       * what keeps a lying entry from expanding to the whole allowance alone.
       */
      content = inflateEntry(raw, Math.min(uncompressedSize + 1, remaining))
    } else {
      // Anything else (bzip2, LZMA, zstd) is not something these formats use.
      refuse('unsupported')
    }

    // Charged with the bytes actually produced. Charging the claim would let an entry
    // spend the allowance it said it needed and keep the rest.
    expanded += content.length
    entries.set(name, { name, bytes: content })
  }

  if (entries.size === 0) refuse('parse_failed')
  return entries
}

/** One named entry's bytes, or a refusal naming the archive part that is missing. */
export function zipEntry (entries: Map<string, ZipEntry>, name: string): Uint8Array {
  const entry = entries.get(name)
  if (entry === undefined) refuse('parse_failed')
  return entry.bytes
}

/** One named entry decoded as UTF-8 text. */
export function zipText (entries: Map<string, ZipEntry>, name: string): string {
  return utf8(zipEntry(entries, name))
}

/** Every entry name, for a caller looking for a pattern rather than a fixed path. */
export function zipNames (entries: Map<string, ZipEntry>): string[] {
  return [...entries.keys()].sort()
}

/**
 * Bytes to text, never throwing.
 *
 * `TextDecoder` leaves malformed bytes as replacement characters rather than raising,
 * which is what a parser wants: one broken character in a document should not lose the
 * other two hundred pages.
 */
export function utf8 (bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}
