/*
 * The one door a provider key may come through (sections 7.1 and 9.6).
 *
 * The plan is blunt about secrets: they are decrypted in the main process, and
 * they "never cross IPC to a renderer". A key still has to be typed somewhere, so
 * this module is the narrowest possible inbound path rather than a promise that
 * nothing ever arrives.
 *
 * What makes it narrow, and why each part is here.
 *
 * 1. A challenge comes first. The screen asks for a single-use nonce, and only a
 *    submit carrying a live nonce is even parsed. That bounds how much a page can
 *    attempt, and a nonce that has been used is gone, so a captured request
 *    cannot be replayed.
 *
 * 2. The schema is strict. Unknown keys are refused rather than stripped, so a
 *    caller cannot smuggle a field that a later reader might trust.
 *
 * 3. The reply never contains the secret. It carries an outcome and, at most, the
 *    four-character fingerprint the plan allows to be displayed. Nothing else is
 *    returned, logged or kept: the plaintext goes straight into the encrypted
 *    keychain and the local reference to it dies with this function.
 *
 * 4. Every refusal is a fixed token. A validation message would echo the value it
 *    refused, and the value here is a live API key.
 *
 * The renderer channel that will use this is deliberately NOT registered yet. The
 * Models screen is the next piece of work, and until it exists there is no page
 * that can submit a key at all, which is the safest possible default.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

import type { CredentialFailure, CredentialScope, CredentialStore } from './credentials.js'

/** Every way a submit can be refused, as fixed tokens. */
export const CREDENTIAL_ENTRY_FAILURES = Object.freeze([
  'invalid_request',
  'unknown_challenge',
  'expired_challenge',
  'scope_mismatch',
  'too_many_challenges',
  'storage_unavailable',
  'not_encrypted',
  'not_persisted',
] as const)

export type CredentialEntryFailure = (typeof CREDENTIAL_ENTRY_FAILURES)[number]

export interface CredentialChallenge {
  readonly nonce: string
  readonly expiresAt: number
}

export type ChallengeResult =
  | { ok: true; challenge: CredentialChallenge }
  | { ok: false; reason: CredentialEntryFailure }

export type SubmitResult =
  | { ok: true; fingerprint: string }
  | { ok: false; reason: CredentialEntryFailure }

export interface CredentialEntryOptions {
  store: CredentialStore
  /** How long a challenge stays usable. Short on purpose: it is seconds of work. */
  challengeTtlMs?: number
  /** Cap on live challenges, so a page cannot grow the map without bound. */
  maxChallenges?: number
  now?: () => number
  log?: { warn: (message: string) => void }
}

export interface CredentialEntry {
  issueChallenge: (scope: CredentialScope) => ChallengeResult
  submit: (request: unknown) => SubmitResult
  /** Drop every live challenge, for example on sign-out. */
  revokeAll: () => void
  pendingChallenges: () => number
}

const DEFAULT_TTL_MS = 60_000
const DEFAULT_MAX_CHALLENGES = 8
const NONCE_BYTES = 24

/*
 * Strict throughout. `secret` is bounded the same way the keychain bounds it, so
 * an oversized paste is refused here with a token rather than deep in storage
 * with an exception.
 */
const scopeSchema = z.strictObject({
  serverHost: z.string().min(1).max(200),
  userId: z.number().int().positive(),
})

const submitSchema = z.strictObject({
  nonce: z.string().min(16).max(128).regex(/^[a-f0-9]+$/),
  scope: scopeSchema,
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  secret: z.string().min(1).max(4096),
})

/** Which entry failure a storage refusal becomes. Never carries the value. */
function entryFailureFor (reason: CredentialFailure): CredentialEntryFailure {
  switch (reason) {
    case 'storage_unavailable':
      return 'storage_unavailable'
    case 'not_encrypted':
      return 'not_encrypted'
    case 'not_persisted':
      return 'not_persisted'
    default:
      // invalid_scope, invalid_argument, decrypt_failed and not_found all mean
      // "this submit cannot be honoured", which is all a caller may be told.
      return 'invalid_request'
  }
}

function scopeMatches (a: CredentialScope, b: CredentialScope): boolean {
  return a.serverHost.trim().toLowerCase() === b.serverHost.trim().toLowerCase() && a.userId === b.userId
}

export function createCredentialEntry (options: CredentialEntryOptions): CredentialEntry {
  const store = options?.store
  if (!store || typeof store.save !== 'function') {
    throw new TypeError('createCredentialEntry needs a credential store')
  }

  const ttlMs = Number.isInteger(options.challengeTtlMs) && (options.challengeTtlMs as number) > 0
    ? (options.challengeTtlMs as number)
    : DEFAULT_TTL_MS
  const maxChallenges = Number.isInteger(options.maxChallenges) && (options.maxChallenges as number) > 0
    ? (options.maxChallenges as number)
    : DEFAULT_MAX_CHALLENGES
  const now = typeof options.now === 'function' ? options.now : Date.now
  const log = options.log

  /*
   * Nonce to scope and expiry. The scope is bound at issue time so a challenge is
   * only ever good for the account that asked for it; a page cannot obtain a nonce
   * as itself and then submit a key into somebody else's partition.
   */
  const challenges = new Map<string, { scope: CredentialScope; expiresAt: number }>()

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot credential entry: ${message}`)
  }

  /** Forget expired challenges. Cheap, and keeps the cap meaningful. */
  function prune (at: number): void {
    for (const [nonce, entry] of challenges) {
      if (entry.expiresAt <= at) challenges.delete(nonce)
    }
  }

  function issueChallenge (scope: CredentialScope): ChallengeResult {
    const at = now()
    prune(at)

    if (challenges.size >= maxChallenges) {
      warn('refused a challenge (too many live challenges)')
      return { ok: false, reason: 'too_many_challenges' }
    }

    const nonce = randomBytes(NONCE_BYTES).toString('hex')
    const expiresAt = at + ttlMs
    challenges.set(nonce, { scope: { serverHost: scope.serverHost, userId: scope.userId }, expiresAt })
    return { ok: true, challenge: { nonce, expiresAt } }
  }

  function submit (request: unknown): SubmitResult {
    const parsed = submitSchema.safeParse(request)
    if (!parsed.success) {
      // The issue list would quote the value it refused, and that value is a key.
      warn('refused a submit (invalid request)')
      return { ok: false, reason: 'invalid_request' }
    }

    const { nonce, scope, name, secret } = parsed.data

    // Single use: the nonce is consumed whether or not the rest succeeds, so a
    // failed attempt cannot be retried with the same material.
    const held = challenges.get(nonce)
    challenges.delete(nonce)

    if (!held) {
      warn('refused a submit (unknown challenge)')
      return { ok: false, reason: 'unknown_challenge' }
    }
    const at = now()
    if (held.expiresAt <= at) {
      warn('refused a submit (expired challenge)')
      return { ok: false, reason: 'expired_challenge' }
    }
    if (!scopeMatches(held.scope, scope)) {
      warn('refused a submit (scope mismatch)')
      return { ok: false, reason: 'scope_mismatch' }
    }

    const saved = store.save(scope, name, secret)
    if (!saved.ok) {
      warn(`stored nothing (${saved.reason})`)
      return { ok: false, reason: entryFailureFor(saved.reason) }
    }

    warn(`stored "${name}"`)
    // Only the fingerprint leaves. The secret itself has been handed to the
    // encrypted store and is not held anywhere in this function after the call.
    return { ok: true, fingerprint: saved.fingerprint }
  }

  function revokeAll (): void {
    challenges.clear()
  }

  function pendingChallenges (): number {
    prune(now())
    return challenges.size
  }

  return Object.freeze({ issueChallenge, submit, revokeAll, pendingChallenges })
}
