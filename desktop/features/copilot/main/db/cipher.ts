/*
 * Field encryption for the local database.
 *
 * The plan asks for an encrypted database (section 7.2) and lists a
 * SQLCipher-compatible driver as the way to get one. That driver was not
 * approved, so this file takes the other road to the same property: every
 * column that holds something a person wrote or a model said is sealed with
 * AES-256-GCM before it reaches SQLite. The database file therefore contains
 * ciphertext for exactly the data the plan cares about, which is what "no
 * plaintext fallback" and "the journal holds no conversation" mean in practice.
 *
 * Three choices are worth stating.
 *
 * The key never leaves the keychain. `createKeyMaterial()` produces 32 random
 * bytes once; the keychain stores them (section 7.1 names safeStorage/DPAPI for
 * exactly this) and this module only ever sees the bytes while the database is
 * open.
 *
 * Every envelope carries a context string as its additional authenticated data.
 * GCM binds that data to the ciphertext, so a sealed thread title cannot be
 * copied into a message's content column and still open: the context would not
 * match. Without it, a bug that read the wrong column would return a plausible
 * wrong answer instead of a loud one.
 *
 * A failure is always `bad_key`. Distinguishing "wrong key" from "tampered bytes"
 * would tell an attacker which of the two they achieved, and the person reading
 * the screen can act on neither.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

import { StorageError } from '../../shared/storage-contract.js'

/** 32 bytes: AES-256. */
const KEY_BYTES = 32
/** GCM's standard nonce length. Never reused with the same key. */
const IV_BYTES = 12
/** GCM's tag length. A truncated tag would weaken the authentication. */
const TAG_BYTES = 16

/** The prefix on every envelope, so a future format can be recognised. */
const ENVELOPE_PREFIX = 'v1.'

/**
 * The domain separator. HKDF is used so these bytes cannot be useful in any other
 * AES-256-GCM use in the app, even if the same keychain entry were ever read
 * twice for two purposes.
 */
const KEY_SALT = Buffer.from('zuricopilot.local-database.salt.v1', 'utf8')
const KEY_INFO = Buffer.from('zuricopilot.local-database.key.v1', 'utf8')

/**
 * A second derivation, for the keyed digests the search indexes are built from.
 *
 * Separate info string means separate key material: reusing the AES key as an HMAC
 * key would let one primitive's output say something about the other's.
 */
const DIGEST_INFO = Buffer.from('zuricopilot.local-database.digest.v1', 'utf8')

/** Bytes kept from the digest. 16 is enough that two different words colliding is
 * not a thing that happens by accident, and short enough that an index over a large
 * library stays small. */
const DIGEST_BYTES = 16

export interface FieldCipher {
  /** Seal one plaintext for one column, named by `context`. */
  seal: (context: string, plaintext: string) => string
  /** Open one envelope, or throw `bad_key`. */
  open: (context: string, envelope: string) => string
  /** True when an envelope opens under this key. Used by the key check. */
  canOpen: (context: string, envelope: string) => boolean
  /**
   * Seal bytes, for the document copies and the stored vectors.
   *
   * A BLOB rather than a base64 string: a 5 MB PDF sealed as text costs two rounds
   * of base64 on the way in and on the way out, for no gain a database cares about.
   */
  sealBytes: (context: string, plaintext: Uint8Array) => Uint8Array
  /** Open sealed bytes, or throw `bad_key`. */
  openBytes: (context: string, envelope: Uint8Array) => Uint8Array
  /**
   * A keyed digest, for the values a search index has to compare.
   *
   * Document chunks cannot be indexed as plaintext without putting the library back
   * on disk in the clear, and SQLite's full-text index has no way to encrypt what it
   * stores. So the index holds one digest per distinct word instead: searching is
   * "digest the query the same way and look for equal digests", which works without
   * the index ever holding a word. It does leak that two chunks share a word, and
   * how often - the standard trade for a searchable index, and the reason the key is
   * per-database rather than global.
   */
  keyedDigest: (context: string, input: Uint8Array | string) => string
}

/** True for a string shaped like an envelope this module wrote. */
export function isEnvelope (value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX)
}

/**
 * New key material, as the string the keychain stores.
 *
 * Base64 rather than hex purely so it is shorter in the keychain file; both are
 * equally opaque.
 */
export function createKeyMaterial (): string {
  return randomBytes(KEY_BYTES).toString('base64')
}

/**
 * Turn a stored key string into the 32 bytes this module uses.
 *
 * A key of the wrong length is refused rather than stretched: padding a short key
 * would turn a mistake at the keychain into a database that opens with something
 * weaker than the design says it does.
 */
export function databaseKeyFromSecret (secret: unknown): Buffer {
  if (typeof secret !== 'string' || secret === '') throw new StorageError('bad_key')
  const bytes = Buffer.from(secret, 'base64')
  if (bytes.length !== KEY_BYTES) throw new StorageError('bad_key')
  return bytes
}

/** The real key: the stored bytes, domain-separated by HKDF. */
function deriveKey (raw: Buffer): Buffer {
  if (raw.length !== KEY_BYTES) throw new StorageError('bad_key')
  const derived = hkdfSync('sha256', raw, KEY_SALT, KEY_INFO, KEY_BYTES)
  return Buffer.from(derived)
}

export function createFieldCipher (rawKey: Buffer): FieldCipher {
  const key = deriveKey(rawKey)
  const digestKey = Buffer.from(hkdfSync('sha256', rawKey, KEY_SALT, DIGEST_INFO, KEY_BYTES))

  function seal (context: string, plaintext: string): string {
    if (typeof plaintext !== 'string') throw new StorageError('invalid_request')
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(context, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return ENVELOPE_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64')
  }

  function open (context: string, envelope: string): string {
    if (!isEnvelope(envelope)) throw new StorageError('bad_key')
    const bytes = Buffer.from(envelope.slice(ENVELOPE_PREFIX.length), 'base64')
    if (bytes.length < IV_BYTES + TAG_BYTES) throw new StorageError('bad_key')
    const iv = bytes.subarray(0, IV_BYTES)
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(Buffer.from(context, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    } catch {
      // Wrong key, wrong context or changed bytes: one answer, because the three
      // are indistinguishable to anyone who should not be reading the row.
      throw new StorageError('bad_key')
    }
  }

  function canOpen (context: string, envelope: string): boolean {
    try {
      open(context, envelope)
      return true
    } catch {
      return false
    }
  }

  function sealBytes (context: string, plaintext: Uint8Array): Uint8Array {
    if (!(plaintext instanceof Uint8Array)) throw new StorageError('invalid_request')
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(context, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext]))
  }

  function openBytes (context: string, envelope: Uint8Array): Uint8Array {
    if (!(envelope instanceof Uint8Array) || envelope.length < IV_BYTES + TAG_BYTES) {
      throw new StorageError('bad_key')
    }
    const bytes = Buffer.from(envelope)
    const iv = bytes.subarray(0, IV_BYTES)
    const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
    const ciphertext = bytes.subarray(IV_BYTES + TAG_BYTES)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAAD(Buffer.from(context, 'utf8'))
      decipher.setAuthTag(tag)
      return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]))
    } catch {
      throw new StorageError('bad_key')
    }
  }

  function keyedDigest (context: string, input: Uint8Array | string): string {
    if (typeof input !== 'string' && !(input instanceof Uint8Array)) {
      throw new StorageError('invalid_request')
    }
    /*
     * The context is hashed in alongside the input rather than used as a prefix of
     * the digest, so a word digested for the chunk index cannot be recognised as the
     * same digest a different index would produce for a different column.
     */
    const hmac = createHmac('sha256', digestKey)
    hmac.update(context, 'utf8')
    hmac.update('\u0000', 'utf8')
    hmac.update(input)
    return hmac.digest('hex').slice(0, DIGEST_BYTES * 2)
  }

  return { seal, open, canOpen, sealBytes, openBytes, keyedDigest }
}

/* ------------------------------------------------------------------ *
 * The key check
 * ------------------------------------------------------------------ */

/**
 * The known text stored under the key so a wrong key is caught at open time.
 *
 * Without this, a wrong key would open the file happily and only fail later, on
 * whichever row was read first, which reads on screen as "your conversations are
 * corrupt" instead of "this is not your database".
 */
export const KEY_CHECK_CONTEXT = 'meta.key_check'
export const KEY_CHECK_PLAINTEXT = 'zuricopilot.key-check.v1'
