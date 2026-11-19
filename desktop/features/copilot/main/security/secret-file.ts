/*
 * The durable half of the desktop secret store.
 *
 * `keychain.ts` holds provider keys in memory as ciphertext produced by
 * Electron's `safeStorage` (DPAPI on Windows), and memory is lost on every
 * restart. This module is the small file that outlives the process. It stores
 * ONLY the base64 ciphertext: it never sees a plaintext secret, cannot decrypt
 * one, and therefore cannot leak one. If the file is stolen it is as useless as
 * the OS keychain is, which is the property that makes writing it at all
 * acceptable.
 *
 * Three decisions carry the rest of the design:
 *
 * 1. Writes go to `<path>.tmp` and are then renamed over `<path>`. A rename
 *    within one directory is atomic, so a crash, a full disk or a killed
 *    process leaves either the old file or the new one, never half of either.
 *
 * 2. Every failure is a return value, not a throw. Filesystem errors carry the
 *    path they failed on, and a path can name a person or a business folder; a
 *    thrown error would put that text in a log or an IPC reply. It would also
 *    turn "the key file is unreadable" into a crash at startup, when the one
 *    thing the app must do is run without the saved keys. A log line names a
 *    fixed reason (plus, at most, the error's code) and nothing else.
 *
 * 3. `load` never throws and never trusts the file. A key file can be truncated,
 *    hand-edited, or written by an older build, so anything that is not exactly
 *    this version's shape is answered with an empty store. The caller then
 *    behaves as on a first run: no keys saved yet, ask for them again.
 *
 * The file carries no timestamps and no ordering of its own; keys are written
 * sorted, so the same set of entries always produces the same bytes. That is
 * also why `SecretFileOptions.now` is accepted but unused: nothing in the file
 * is a function of time.
 */

import * as nodeFs from 'node:fs'
import { dirname } from 'node:path'

export interface SecretFileIo {
  readFileSync (path: string, encoding: 'utf8'): string
  writeFileSync (path: string, data: string, options: { encoding: 'utf8'; mode?: number }): void
  renameSync (from: string, to: string): void
  mkdirSync (path: string, options: { recursive: true }): void
  unlinkSync (path: string): void
  existsSync (path: string): boolean
}

export interface SecretFileLogger { warn (message: string): void }

export interface SecretFileOptions {
  /** Where the ciphertext file lives. Its parent directory is created on save. */
  path: string
  /** Injected in tests; defaults to `node:fs`. */
  io?: SecretFileIo
  log?: SecretFileLogger
  now?: () => number
}

export interface SecretFileStore {
  load (): ReadonlyArray<readonly [string, string]>
  save (entries: ReadonlyArray<readonly [string, string]>): boolean
  clearFile (): boolean
  describe (): { path: string; exists: boolean }
}

/** The only file shape this build reads. An older or newer file is ignored. */
const FILE_VERSION = 1

/**
 * A name identifies an entry and never holds secret material, so it may appear
 * in a saved file and in a log line. It is restricted for that reason: no
 * quotes, no spaces, no path separators.
 */
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_NAME_LENGTH = 64

/**
 * Standard base64, which is what `Buffer.toString('base64')` produces. A value
 * outside this alphabet did not come from the keychain, so it is not ciphertext
 * this app can use.
 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

/** Owner read and write only: the file is useless without the OS keychain, but it is still private. */
const FILE_MODE = 0o600

/** Shared empty answer, so every refusal returns the same frozen value. */
const NO_ENTRIES: ReadonlyArray<readonly [string, string]> = Object.freeze(
  [] as Array<readonly [string, string]>
)

/**
 * `node:fs` behind the narrow interface above.
 *
 * Built as an explicit adapter rather than handing `nodeFs` over directly, so
 * the shape the module relies on is visible in one place and a change in a
 * Node overload cannot quietly widen it.
 */
const NODE_IO: SecretFileIo = {
  readFileSync (path, encoding) {
    return nodeFs.readFileSync(path, encoding)
  },
  writeFileSync (path, data, options) {
    nodeFs.writeFileSync(path, data, options)
  },
  renameSync (from, to) {
    nodeFs.renameSync(from, to)
  },
  mkdirSync (path, options) {
    // `recursive: true` makes an existing directory fine and creates the chain
    // when it is missing, which is what a first run needs.
    nodeFs.mkdirSync(path, options)
  },
  unlinkSync (path) {
    nodeFs.unlinkSync(path)
  },
  existsSync (path) {
    return nodeFs.existsSync(path)
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidName (value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    NAME_PATTERN.test(value)
}

/**
 * The bytes a base64 value stands for, or null when it stands for nothing.
 *
 * `Buffer.from` never throws on bad base64; it silently drops what it cannot
 * read, which would turn a corrupt entry into a short ciphertext and a failed
 * decrypt much later. The value is therefore checked before it is decoded.
 */
function decodeCiphertext (value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (!BASE64_PATTERN.test(value)) return null

  const unpadded = value.replace(/=+$/, '')
  // A base64 length of 1 modulo 4 cannot come from any whole byte sequence.
  if (unpadded.length % 4 === 1) return null

  const bytes = Buffer.from(unpadded, 'base64')
  return bytes.length > 0 ? bytes : null
}

/**
 * How a thrown filesystem error is named in a log line.
 *
 * Only the code or the error's type: a message can carry the path and, on some
 * platforms, the contents of the operation that failed.
 */
function errorLabel (error: unknown): string {
  if (typeof error !== 'object' || error === null) return typeof error
  const candidate = error as { code?: unknown; name?: unknown }
  if (typeof candidate.code === 'string' && candidate.code.length > 0) return candidate.code
  if (typeof candidate.name === 'string' && candidate.name.length > 0) return candidate.name
  return 'unknown'
}

/**
 * Whether a read failed because there is no file yet.
 *
 * That is the ordinary first run, not a fault, so it is answered silently.
 */
function isMissingFile (error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { code?: unknown }).code === 'ENOENT'
}

/**
 * The pairs of a `save` call, read as unknown values so each can be validated.
 *
 * The parameter type promises pairs, but a caller in plain JavaScript can pass
 * anything; refusing a malformed argument here keeps the failure a `false`
 * rather than a `TypeError` halfway through writing a file.
 */
function asPairs (value: unknown): ReadonlyArray<readonly [unknown, unknown]> | null {
  if (!Array.isArray(value)) return null

  const pairs: Array<readonly [unknown, unknown]> = []
  for (const entry of value as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) return null
    const pair = entry as unknown[]
    pairs.push([pair[0], pair[1]])
  }
  return pairs
}

/** Byte-order-free comparison, so the saved file does not depend on a locale. */
function byName (left: readonly [string, string], right: readonly [string, string]): number {
  if (left[0] < right[0]) return -1
  if (left[0] > right[0]) return 1
  return 0
}

export function createSecretFileStore (options: SecretFileOptions): SecretFileStore {
  // A missing path is a programming error, not a runtime condition: there is no
  // sensible default location and guessing one would write keys somewhere
  // unexpected.
  const candidate: unknown = options
  if (!isRecord(candidate)) {
    throw new TypeError('createSecretFileStore needs an options object with a path')
  }
  const targetPath = candidate.path
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new TypeError('createSecretFileStore needs a non-empty path')
  }

  const path = targetPath
  const tempPath = `${path}.tmp`
  const io = options.io ?? NODE_IO
  const log = options.log

  function logLine (reason: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot secret-file: ${reason}`)
  }

  /** Drop the half written temp file after a failed save. */
  function removeTempFile (): void {
    try {
      if (io.existsSync(tempPath)) io.unlinkSync(tempPath)
    } catch {
      // The failed write is already being reported. A cleanup failure must not
      // become a second failure, and must not escape a method that returns a
      // boolean.
    }
  }

  function load (): ReadonlyArray<readonly [string, string]> {
    let raw: string
    try {
      raw = io.readFileSync(path, 'utf8')
    } catch (error) {
      if (isMissingFile(error)) return NO_ENTRIES
      logLine(`discarded (read_failed ${errorLabel(error)})`)
      return NO_ENTRIES
    }

    // An empty file is what a crash between create and write leaves behind, and
    // it is not JSON, but it is worth its own reason in the log.
    if (raw.trim().length === 0) {
      logLine('discarded (empty_file)')
      return NO_ENTRIES
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      logLine('discarded (invalid_json)')
      return NO_ENTRIES
    }

    if (!isRecord(parsed)) {
      logLine('discarded (invalid_shape)')
      return NO_ENTRIES
    }
    if (parsed.version !== FILE_VERSION) {
      logLine('discarded (unsupported_version)')
      return NO_ENTRIES
    }
    const rawEntries = parsed.entries
    if (!isRecord(rawEntries)) {
      logLine('discarded (invalid_shape)')
      return NO_ENTRIES
    }

    const entries: Array<readonly [string, string]> = []
    for (const [name, value] of Object.entries(rawEntries)) {
      // A name this build could not write back is unusable, so the entry is
      // dropped rather than handed to a caller that could never save it.
      if (!isValidName(name)) continue

      // A value of the wrong type means this is not the file shape at all, so
      // the whole document is refused. A string that is empty or is not base64
      // is one damaged entry, and the rest of the file is still good.
      if (typeof value !== 'string') {
        logLine('discarded (invalid_shape)')
        return NO_ENTRIES
      }
      if (decodeCiphertext(value) === null) continue

      entries.push(Object.freeze([name, value] as const))
    }

    entries.sort(byName)
    return Object.freeze(entries)
  }

  function save (entries: ReadonlyArray<readonly [string, string]>): boolean {
    const pairs = asPairs(entries)
    if (pairs === null) {
      logLine('refused (invalid_entries)')
      return false
    }

    // A Map, not an object: the name '__proto__' passes the name rules, and
    // assigning it on a plain object would set the prototype instead of adding
    // an entry, which would drop that key without a word.
    const record = new Map<string, string>()
    for (const pair of pairs) {
      const name: unknown = pair[0]
      const value: unknown = pair[1]
      if (!isValidName(name) || typeof value !== 'string' || value.length === 0) {
        // All or nothing: a file holding only some of the keys would make the
        // app forget the rest on the next start without saying so.
        logLine('refused (invalid_entry)')
        return false
      }
      record.set(name, value)
    }

    // Sorted keys make the bytes a function of the entries alone, so a diff of
    // the key file never shows a reordering as a change. `fromEntries` defines
    // own properties, so it keeps the same safety the Map just gave us.
    const ordered = [...record.entries()].sort(byName)
    const text = JSON.stringify({ version: FILE_VERSION, entries: Object.fromEntries(ordered) })

    try {
      io.mkdirSync(dirname(path), { recursive: true })
      io.writeFileSync(tempPath, text, { encoding: 'utf8', mode: FILE_MODE })
      // The rename is the commit point: before it the old file is intact, after
      // it the new one is complete.
      io.renameSync(tempPath, path)
      return true
    } catch (error) {
      removeTempFile()
      logLine(`write_failed (${errorLabel(error)})`)
      return false
    }
  }

  function clearFile (): boolean {
    try {
      // Nothing to remove is the outcome the caller asked for.
      if (!io.existsSync(path)) return true
      io.unlinkSync(path)
      return true
    } catch (error) {
      logLine(`clear_failed (${errorLabel(error)})`)
      return false
    }
  }

  function describe (): { path: string; exists: boolean } {
    // The path and whether it is there, nothing else: this answer is drawn on a
    // settings screen, and a ciphertext must not travel further than load().
    let exists = false
    try {
      exists = io.existsSync(path)
    } catch {
      exists = false
    }
    return { path, exists }
  }

  return Object.freeze({ load, save, clearFile, describe })
}
