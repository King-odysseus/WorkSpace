/*
 * Provider credentials, partitioned by who they belong to (sections 4.4 and 7.1).
 *
 * The keychain underneath knows only "store these bytes under this name". This
 * module supplies the part the plan actually promised: entries are namespaced
 * `zuricopilot/<serverHost>/<userId>/<name>`, so two people signing in on one
 * machine never see each other's keys, and the same person on two servers keeps
 * two sets.
 *
 * Four rules, each of which closes a way this could go wrong.
 *
 * 1. A scope is validated before it is turned into a key name. The name is the
 *    one caller-supplied string that may reach a log line, so a host carrying a
 *    slash or a quote must never become part of one.
 *
 * 2. The keychain forbids `/` in a name, so the namespaced key joins its parts
 *    with dots - but the host part carries its own length first
 *    (`zuricopilot.16-example.com.7.deepseek`). A plain join collides: host
 *    `example.com.7` with user 8 is the same string as host `example.com` with
 *    user 7 and name `8.key`, which would show one account another account's key.
 *    A stated length cannot be re-split, so the mapping is injective whatever
 *    the parts contain, and the user id is still required to be an integer.
 *
 * 3. A fingerprint is the last four characters, and only of a secret long enough
 *    for four characters to reveal almost nothing. A short key gets a fixed
 *    mask instead, because "last 4 of 8" is half the key.
 *
 * 4. Signing out clears the live ciphertext without touching the durable copy.
 *    Signing out is not deleting a key: the same person signing back in should
 *    still have their providers configured. What sign-out must guarantee is that
 *    a machine left unattended holds nothing decryptable in memory.
 *
 * `read` returns a plaintext secret and exists for the main process alone. It is
 * deliberately absent from the IPC surface: a renderer has no business holding a
 * provider key, and a channel that could hand one out would undo the rest.
 */
import type { Keychain, SecretFailureReason } from './keychain.js'

/** Why a credential operation refused. Same vocabulary as the keychain below. */
export const CREDENTIAL_FAILURES = Object.freeze([
  'decrypt_failed',
  'invalid_argument',
  'invalid_scope',
  'not_encrypted',
  'not_found',
  'not_persisted',
  'storage_unavailable',
] as const)

export type CredentialFailure = (typeof CREDENTIAL_FAILURES)[number]

export interface CredentialScope {
  /** The web server this account signs in to, for example `zuri.example.com`. */
  readonly serverHost: string
  readonly userId: number
}

export type CredentialSaveResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: CredentialFailure }

export type CredentialReadResult =
  | { ok: true; secret: string }
  | { ok: false; reason: CredentialFailure }

export type CredentialDescribeResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: CredentialFailure }

export type CredentialRemoveResult =
  | { ok: true; removed: boolean }
  | { ok: false; reason: CredentialFailure }

export type CredentialClearResult =
  | { ok: true; removed: number }
  | { ok: false; reason: CredentialFailure }

export interface CredentialLogger {
  warn: (message: string) => void
}

export interface CredentialStoreOptions {
  keychain: Keychain
  log?: CredentialLogger
}

export interface CredentialStore {
  save: (scope: CredentialScope, name: string, secret: string) => CredentialSaveResult
  /** Main process only. Never expose this over IPC. */
  read: (scope: CredentialScope, name: string) => CredentialReadResult
  /** Answers "is one stored, and what does it end with" without decrypting. */
  describe: (scope: CredentialScope, name: string) => CredentialDescribeResult
  remove: (scope: CredentialScope, name: string) => CredentialRemoveResult
  /** Delete every credential for one account, durably. */
  clearScope: (scope: CredentialScope) => CredentialClearResult
  /** Sign-out: forget the live ciphertext, keep the durable copy. */
  signOut: () => void
}

const KEY_PREFIX = 'zuricopilot'
/** Hosts are DNS names or dotted quads. Colons and slashes are refused. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/
const MAX_HOST_LENGTH = 200
const MAX_NAME_LENGTH = 64
/** Below this, four characters are too much of the secret to show. */
export const MIN_FINGERPRINT_LENGTH = 12
export const MASKED_FINGERPRINT = '****'

/**
 * The visible tail of a secret, or a fixed mask when the secret is too short.
 *
 * Exported because the tests and the future Models screen must agree on it, and
 * because a fingerprint is the only part of a secret allowed to be displayed.
 */
export function fingerprintOf (secret: unknown): string {
  if (typeof secret !== 'string' || secret.length < MIN_FINGERPRINT_LENGTH) return MASKED_FINGERPRINT
  return secret.slice(-4)
}

/** Why a scope is unusable, or null when it is fine. */
function scopeProblem (value: unknown): CredentialFailure | null {
  if (typeof value !== 'object' || value === null) return 'invalid_scope'
  const candidate = value as Record<string, unknown>

  const host = candidate.serverHost
  if (typeof host !== 'string') return 'invalid_scope'
  const normalised = host.trim().toLowerCase()
  if (normalised.length === 0 || normalised.length > MAX_HOST_LENGTH) return 'invalid_scope'
  if (!HOST_PATTERN.test(normalised)) return 'invalid_scope'

  const userId = candidate.userId
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId < 1) return 'invalid_scope'

  return null
}

function isValidName (name: unknown): name is string {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    NAME_PATTERN.test(name)
}

/**
 * The host part of a key: the normalised host, prefixed by its own length.
 *
 * One helper so the key and the account prefix cannot disagree about the shape.
 */
function hostSegment (host: string): string {
  const lower = host.trim().toLowerCase()
  return `${lower.length}-${lower}`
}

/**
 * The keychain name for one credential.
 *
 * Callers pass an unvalidated scope, so this returns null rather than building a
 * name out of something it could not check.
 */
export function credentialKey (scope: unknown, name: unknown): string | null {
  if (scopeProblem(scope) !== null) return null
  if (!isValidName(name)) return null

  const { serverHost, userId } = scope as CredentialScope
  return `${KEY_PREFIX}.${hostSegment(serverHost)}.${userId}.${name}`
}

/** The prefix every credential for one account shares. */
function scopePrefix (scope: CredentialScope): string {
  return `${KEY_PREFIX}.${hostSegment(scope.serverHost)}.${scope.userId}.`
}

/** Secret failures and credential failures share their tokens, so pass through. */
function asCredentialFailure (reason: SecretFailureReason): CredentialFailure {
  return reason
}

export function createCredentialStore (options: CredentialStoreOptions): CredentialStore {
  const keychain = options?.keychain
  if (!keychain || typeof keychain.store !== 'function' || typeof keychain.read !== 'function') {
    throw new TypeError('createCredentialStore needs a keychain')
  }

  const log = options?.log

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot credentials: ${message}`)
  }

  function save (scope: CredentialScope, name: string, secret: string): CredentialSaveResult {
    // The secret is never part of a log line, so only the outcome is described.
    const key = credentialKey(scope, name)
    if (key === null) {
      warn('refused to save (invalid scope or name)')
      return { ok: false, reason: scopeProblem(scope) === null ? 'invalid_argument' : 'invalid_scope' }
    }

    const stored = keychain.store(key, secret)
    if (!stored.ok) {
      warn(`save failed (${stored.reason})`)
      return { ok: false, reason: asCredentialFailure(stored.reason) }
    }

    warn(`saved "${name}"`)
    return { ok: true, fingerprint: fingerprintOf(secret) }
  }

  function read (scope: CredentialScope, name: string): CredentialReadResult {
    const key = credentialKey(scope, name)
    if (key === null) return { ok: false, reason: 'invalid_scope' }

    const found = keychain.read(key)
    if (!found.ok) return { ok: false, reason: asCredentialFailure(found.reason) }
    return { ok: true, secret: found.secret }
  }

  /*
   * describe exists so a screen can say "a key ends in 1f2c" without the main
   * process ever decrypting one on behalf of a renderer. It still has to read the
   * entry to work out the tail, and that read happens here, in the main process,
   * with the result reduced to four characters before anything else sees it.
   */
  function describe (scope: CredentialScope, name: string): CredentialDescribeResult {
    const found = read(scope, name)
    if (!found.ok) return { ok: false, reason: found.reason }
    return { ok: true, fingerprint: fingerprintOf(found.secret) }
  }

  function remove (scope: CredentialScope, name: string): CredentialRemoveResult {
    const key = credentialKey(scope, name)
    if (key === null) return { ok: true, removed: false }

    // The keychain reports both halves: whether there was anything to remove, and
    // whether the removal reached the file. Reporting success on a write that did
    // not land would promise a key is gone that returns at the next start.
    const result = keychain.remove(key)
    if (!result.ok) {
      warn(`remove failed (${result.reason})`)
      return { ok: false, reason: asCredentialFailure(result.reason) }
    }
    if (!result.removed) return { ok: true, removed: false }

    warn(`removed "${name}"`)
    return { ok: true, removed: true }
  }

  /*
   * Deleting every key for one account is a real deletion, unlike sign-out. It is
   * driven off the keychain's own name list, so it cannot miss an entry created
   * through a path this module does not know about, and it cannot touch another
   * account: the prefix carries host and user id, and the separator after the id
   * stops user 7 from matching user 70.
   */
  function clearScope (scope: CredentialScope): CredentialClearResult {
    if (scopeProblem(scope) !== null) return { ok: true, removed: 0 }

    const prefix = scopePrefix(scope)
    let removed = 0
    for (const key of keychain.names()) {
      if (!key.startsWith(prefix)) continue
      const result = keychain.remove(key)
      if (!result.ok) {
        // Everything removed so far is gone; the rest stays. Saying how far it got
        // would mean naming another account's entries, so only the count travels.
        warn(`clear stopped after ${removed} removal(s) (${result.reason})`)
        return { ok: false, reason: asCredentialFailure(result.reason) }
      }
      if (result.removed) removed += 1
    }
    warn(`cleared ${removed} credential(s) for one account`)
    return { ok: true, removed }
  }

  function signOut (): void {
    // Memory only. The durable copy is what lets the same person sign back in
    // without re-entering every provider key.
    keychain.clear()
    warn('signed out, live secrets dropped')
  }

  return Object.freeze({ save, read, describe, remove, clearScope, signOut })
}
