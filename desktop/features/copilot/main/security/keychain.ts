/*
 * The desktop main process's secret store.
 *
 * Electron's `safeStorage` encrypts with the OS keychain (DPAPI on Windows),
 * but importing Electron here would make the module unloadable under plain
 * Node. `safeStorage` is passed in instead, and nothing in this file touches
 * Electron, so the tests exercise the same code the app ships.
 *
 * The invariant this module exists to keep: a secret reaches the caller or it
 * stays here as ciphertext. It is never kept in plaintext, never logged, and
 * never put into a thrown message. Names are the only thing that may appear in
 * a log line, and a name is validated before it is echoed.
 */

export type SecretFailureReason =
  | 'decrypt_failed'
  | 'invalid_argument'
  | 'not_encrypted'
  // Encrypted fine, but the durable half refused it. The secret works for this
  // session and is gone at restart, and saying so beats claiming it was saved.
  | 'not_persisted'
  | 'not_found'
  | 'storage_unavailable'

export type SecretWriteResult = { ok: true } | { ok: false; reason: SecretFailureReason }
export type SecretReadResult = { ok: true; secret: string } | { ok: false; reason: SecretFailureReason }
/**
 * `removed` answers "was there one", `ok` answers "did the deletion reach disk".
 * A removal that only happened in memory comes back at the next start, so the two
 * questions have to be answered separately.
 */
export type SecretRemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; reason: SecretFailureReason }

export interface SafeStorageLike {
  isEncryptionAvailable (): boolean
  encryptString (plainText: string): Buffer
  decryptString (encrypted: Buffer): string
}

export interface KeychainLogger { warn (message: string): void }

/*
 * Where ciphertext lives between runs.
 *
 * Ciphertext is passed in and out as `[name, base64]` pairs rather than as a Map
 * so the file layer cannot hand back a live reference to its own state, and so
 * this module keeps no opinion about where the bytes are kept. Anything that
 * understands pairs can back it: a file, a test fake, nothing at all.
 */
export interface KeychainPersistence {
  load (): ReadonlyArray<readonly [string, string]>
  /** Called after every change. Returns false when the write did not land. */
  save (entries: ReadonlyArray<readonly [string, string]>): boolean
}

export interface KeychainOptions {
  safeStorage: SafeStorageLike
  log?: KeychainLogger
  maxSecretLength?: number
  persistence?: KeychainPersistence
}

export interface Keychain {
  store (name: string, secret: string): SecretWriteResult
  read (name: string): SecretReadResult
  has (name: string): boolean
  remove (name: string): SecretRemoveResult
  /** Sign-out: forget every ciphertext held in memory. Durable bytes stay. */
  clear (): void
  /** Re-read the durable half into memory, after signing back in. */
  reload (): void
  /** Stored names, sorted. Used to clean one account's entries on sign-out. */
  names (): string[]
}

/*
 * A name identifies an entry and never holds secret material itself. It is
 * restricted because it is the one caller-supplied value allowed into a log
 * line: no quotes, no spaces, no path separators, nothing that can reshape a
 * log entry.
 */
const NAME_PATTERN = /^[a-zA-Z0-9._-]+$/
const MAX_NAME_LENGTH = 64
const DEFAULT_MAX_SECRET_LENGTH = 4096

function isUsableSafeStorage (value: unknown): value is SafeStorageLike {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.isEncryptionAvailable === 'function' &&
    typeof candidate.encryptString === 'function' &&
    typeof candidate.decryptString === 'function'
}

function isValidName (name: unknown): name is string {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    NAME_PATTERN.test(name)
}

export function createKeychain (options: KeychainOptions): Keychain {
  const candidate: unknown = options?.safeStorage
  if (!isUsableSafeStorage(candidate)) {
    // A programming error, not a runtime condition: there is no safe fallback
    // store, and a plaintext one would defeat the module.
    throw new TypeError(
      'createKeychain needs a safeStorage with isEncryptionAvailable(), encryptString() and decryptString()'
    )
  }
  const storage: SafeStorageLike = candidate

  const log = options?.log
  const secretLimit = options?.maxSecretLength ?? DEFAULT_MAX_SECRET_LENGTH
  const persistence = options?.persistence

  // Ciphertext only. Holding nothing else means there is no plaintext copy to
  // leak through a crash dump, a log or an accidental serialisation.
  const entries = new Map<string, Buffer>()

  /*
   * Rebuild the in-memory map from durable ciphertext.
   *
   * A pair that will not decode is skipped, not treated as a failure: one corrupt
   * entry must not cost the person every other key they had stored.
   */
  function seed (): void {
    if (!persistence) return

    let pairs: ReadonlyArray<readonly [string, string]>
    try {
      pairs = persistence.load()
    } catch {
      logLine('could not load the store')
      return
    }
    if (!Array.isArray(pairs)) return

    for (const pair of pairs) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const name: unknown = pair[0]
      const encoded: unknown = pair[1]
      if (!isValidName(name) || typeof encoded !== 'string' || encoded.length === 0) continue

      // Buffer.from does not throw on malformed base64, it returns whatever it
      // could decode, so an empty result is the signal that nothing decoded.
      const ciphertext = Buffer.from(encoded, 'base64')
      if (ciphertext.length === 0) continue
      entries.set(name, ciphertext)
    }
  }

  /** Write the whole map out. Returns false when the durable half refused it. */
  function persist (): boolean {
    if (!persistence) return true

    const snapshot: Array<readonly [string, string]> = []
    for (const [name, ciphertext] of entries) snapshot.push([name, ciphertext.toString('base64')])

    try {
      return persistence.save(snapshot) !== false
    } catch {
      return false
    }
  }

  function clear (): void {
    for (const ciphertext of entries.values()) ciphertext.fill(0)
    entries.clear()
  }

  function reload (): void {
    clear()
    seed()
  }

  function names (): string[] {
    return [...entries.keys()].sort()
  }

  seed()

  function logLine (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot keychain: ${message}`)
  }

  function logRefusal (name: string | null, reason: SecretFailureReason): void {
    // An invalid name is caller text of unknown shape, so it is not echoed.
    logLine(name === null ? `refused (${reason})` : `refused "${name}" (${reason})`)
  }

  // null means "no usable ciphertext". The thrown message is dropped on
  // purpose: it can echo the plaintext, so only the fixed reason may travel.
  function encrypt (secret: string): Buffer | null {
    try {
      const encrypted: unknown = storage.encryptString(secret)
      return Buffer.isBuffer(encrypted) && encrypted.length > 0 ? encrypted : null
    } catch {
      return null
    }
  }

  function decrypt (encrypted: Buffer): string | null {
    try {
      const secret: unknown = storage.decryptString(encrypted)
      return typeof secret === 'string' ? secret : null
    } catch {
      return null
    }
  }

  function store (name: string, secret: string): SecretWriteResult {
    if (!isValidName(name)) {
      logRefusal(null, 'invalid_argument')
      return { ok: false, reason: 'invalid_argument' }
    }
    if (typeof secret !== 'string' || secret.length === 0 || secret.length > secretLimit) {
      logRefusal(name, 'invalid_argument')
      return { ok: false, reason: 'invalid_argument' }
    }

    // Availability is asked per call, because the OS keychain can be locked or
    // removed between calls. There is deliberately no plaintext fallback.
    if (!storage.isEncryptionAvailable()) {
      logRefusal(name, 'storage_unavailable')
      return { ok: false, reason: 'storage_unavailable' }
    }

    const encrypted = encrypt(secret)
    if (encrypted === null) {
      logRefusal(name, 'not_encrypted')
      return { ok: false, reason: 'not_encrypted' }
    }

    // A replaced ciphertext is zeroed for the same reason as in remove.
    const previous = entries.get(name)
    if (previous) previous.fill(0)
    entries.set(name, encrypted)

    // The entry is kept even when the write fails, so the key still works for
    // this session. The caller is told it is not durable rather than being left
    // to discover that at the next restart.
    if (!persist()) {
      logRefusal(name, 'not_persisted')
      return { ok: false, reason: 'not_persisted' }
    }

    logLine(`stored "${name}"`)
    return { ok: true }
  }

  function read (name: string): SecretReadResult {
    if (!isValidName(name)) {
      logRefusal(null, 'invalid_argument')
      return { ok: false, reason: 'invalid_argument' }
    }
    // Availability is checked before the lookup: with encryption gone, "we
    // cannot answer" is truer than "there is no such entry", and it tells the
    // caller to fix storage rather than to re-enter the secret.
    if (!storage.isEncryptionAvailable()) {
      logRefusal(name, 'storage_unavailable')
      return { ok: false, reason: 'storage_unavailable' }
    }

    const encrypted = entries.get(name)
    if (!encrypted) {
      logRefusal(name, 'not_found')
      return { ok: false, reason: 'not_found' }
    }

    const secret = decrypt(encrypted)
    if (secret === null) {
      logRefusal(name, 'decrypt_failed')
      return { ok: false, reason: 'decrypt_failed' }
    }

    logLine(`read "${name}"`)
    return { ok: true, secret }
  }

  // No decryption and no storage probe: this answers "did this run ever store
  // that name", which callers ask at startup before the OS is involved.
  function has (name: string): boolean {
    return entries.has(name)
  }

  function remove (name: string): SecretRemoveResult {
    if (!isValidName(name)) {
      logRefusal(null, 'invalid_argument')
      return { ok: false, reason: 'invalid_argument' }
    }

    const encrypted = entries.get(name)
    if (!encrypted) return { ok: true, removed: false }

    entries.delete(name)
    if (!persist()) {
      /*
       * The file still holds it, so memory is put back to match: a key that only
       * this session has forgotten is still usable after a restart, and telling
       * the caller it was deleted would be a guess that the disk disagrees with.
       */
      entries.set(name, encrypted)
      logRefusal(name, 'not_persisted')
      return { ok: false, reason: 'not_persisted' }
    }

    // Zero the ciphertext only once the deletion is durable, so it does not sit in
    // the heap readable until the garbage collector gets to it.
    encrypted.fill(0)
    logLine(`removed "${name}"`)
    return { ok: true, removed: true }
  }

  // Frozen and closed over the map: no caller can add, read or widen entries.
  return Object.freeze({ store, read, has, remove, clear, reload, names })
}
