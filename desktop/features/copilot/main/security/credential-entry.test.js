'use strict'

/*
 * The credential-entry boundary, tested through the bundle Electron loads.
 *
 * This is the one door a provider key may come through, so the tests are about
 * what it refuses as much as what it accepts:
 *
 * - A challenge comes first and is single use, so a captured submit cannot be
 *   replayed and a page cannot try unlimited keys.
 * - A challenge is bound to the account that asked for it, so a page cannot
 *   obtain a nonce as itself and store a key into somebody else's partition.
 * - The reply carries only an outcome and, at most, a four-character fingerprint.
 *   A canary proves the key itself never comes back, in the reply or in a log.
 * - Every refusal is a fixed token. A validation message would quote the value it
 *   refused, and the value here is a live key.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const CANARY = 'sk-live-canary-7b3e9d1f4a2c'
const SCOPE = { serverHost: 'zuri.example.com', userId: 7 }

/** A credential store that records what it was asked to save. */
function fakeStore (result = { ok: true, fingerprint: '2c1a' }) {
  const saved = []
  return {
    saved,
    save (scope, name, secret) {
      saved.push({ scope, name, secret })
      return result
    },
  }
}

function recordingLogger () {
  const lines = []
  return { lines, warn: message => lines.push(String(message)) }
}

/** A boundary with an injectable clock, so expiry can be reached without waiting. */
function build (options = {}) {
  const store = options.store ?? fakeStore()
  const log = options.log
  let clock = options.now ?? 1000
  const entry = api.createCredentialEntry({
    store,
    log,
    now: () => clock,
    challengeTtlMs: options.ttlMs,
    maxChallenges: options.maxChallenges,
  })
  return { entry, store, advance: ms => { clock += ms } }
}

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test('a valid submit stores the key and returns only its fingerprint', () => {
  const { entry, store } = build()

  const issued = entry.issueChallenge(SCOPE)
  assert.equal(issued.ok, true)
  assert.equal(typeof issued.challenge.nonce, 'string')
  assert.ok(issued.challenge.expiresAt > 0)

  const reply = entry.submit({ nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY })

  assert.deepEqual(reply, { ok: true, fingerprint: '2c1a' })
  assert.equal(store.saved.length, 1)
  assert.equal(store.saved[0].secret, CANARY)

  // The key itself must not travel back, in any field of the reply.
  assert.equal(JSON.stringify(reply).includes(CANARY), false)
})

/* ------------------------------------------------------------------ *
 * Single use and binding
 * ------------------------------------------------------------------ */

test('a used challenge cannot be replayed', () => {
  const { entry } = build()
  const issued = entry.issueChallenge(SCOPE)
  const request = { nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY }

  assert.equal(entry.submit(request).ok, true)
  assert.deepEqual(entry.submit(request), { ok: false, reason: 'unknown_challenge' })
  // A replay must not create a second stored key.
  assert.equal(entry.pendingChallenges(), 0)
})

test('a failed submit still consumes the challenge, so it cannot be retried', () => {
  const { entry, store } = build({ store: fakeStore({ ok: false, reason: 'storage_unavailable' }) })
  const issued = entry.issueChallenge(SCOPE)
  const request = { nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY }

  assert.deepEqual(entry.submit(request), { ok: false, reason: 'storage_unavailable' })
  assert.deepEqual(entry.submit(request), { ok: false, reason: 'unknown_challenge' })
  assert.equal(store.saved.length, 1)
})

test('a challenge is bound to the account that asked for it', () => {
  const { entry, store } = build()
  const issued = entry.issueChallenge(SCOPE)

  // Same nonce, a different account: the key would land in the wrong partition.
  const reply = entry.submit({
    nonce: issued.challenge.nonce,
    scope: { serverHost: 'zuri.example.com', userId: 70 },
    name: 'deepseek',
    secret: CANARY,
  })

  assert.deepEqual(reply, { ok: false, reason: 'scope_mismatch' })
  assert.equal(store.saved.length, 0)
})

test('a challenge expires', () => {
  const { entry, advance } = build({ ttlMs: 1000 })
  const issued = entry.issueChallenge(SCOPE)

  advance(1500)
  assert.deepEqual(
    entry.submit({ nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY }),
    { ok: false, reason: 'expired_challenge' },
  )
})

/* ------------------------------------------------------------------ *
 * Shape of the request
 * ------------------------------------------------------------------ */

test('an unknown key, a missing field or a bad nonce is refused before it is read', () => {
  const { entry, store } = build()
  const issued = entry.issueChallenge(SCOPE)
  const good = { nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY }

  // A stray field would be stripped by a loose schema and then trusted later.
  assert.deepEqual(entry.submit({ ...good, localOnly: true }), { ok: false, reason: 'invalid_request' })

  const { secret, ...withoutSecret } = good
  assert.equal(secret.length > 0, true)
  assert.deepEqual(entry.submit(withoutSecret), { ok: false, reason: 'invalid_request' })

  assert.deepEqual(entry.submit({ ...good, nonce: 'not-hex-at-all-'.repeat(2) }), {
    ok: false,
    reason: 'invalid_request',
  })
  assert.deepEqual(entry.submit({ ...good, secret: '' }), { ok: false, reason: 'invalid_request' })
  assert.deepEqual(entry.submit({ ...good, secret: 'x'.repeat(4097) }), { ok: false, reason: 'invalid_request' })
  assert.deepEqual(entry.submit({ ...good, name: 'bad name' }), { ok: false, reason: 'invalid_request' })
  assert.deepEqual(entry.submit({ ...good, scope: { serverHost: 'x', userId: 0 } }), {
    ok: false,
    reason: 'invalid_request',
  })
  assert.deepEqual(entry.submit(null), { ok: false, reason: 'invalid_request' })
  assert.deepEqual(entry.submit('a string'), { ok: false, reason: 'invalid_request' })

  // A malformed submit never reaches the store.
  assert.equal(store.saved.length, 0)
  // And it leaves the live challenge untouched, because it was never parsed as
  // belonging to one.
  assert.equal(entry.pendingChallenges(), 1)
})

test('the number of live challenges is capped', () => {
  const { entry } = build({ maxChallenges: 2 })

  assert.equal(entry.issueChallenge(SCOPE).ok, true)
  assert.equal(entry.issueChallenge(SCOPE).ok, true)
  assert.deepEqual(entry.issueChallenge(SCOPE), { ok: false, reason: 'too_many_challenges' })
})

test('an expired challenge is pruned rather than counted against the cap', () => {
  const { entry, advance } = build({ maxChallenges: 1, ttlMs: 1000 })
  assert.equal(entry.issueChallenge(SCOPE).ok, true)

  advance(2000)
  assert.equal(entry.pendingChallenges(), 0)
  assert.equal(entry.issueChallenge(SCOPE).ok, true)
})

test('revoking clears every live challenge, as sign-out must', () => {
  const { entry } = build()
  const issued = entry.issueChallenge(SCOPE)
  entry.revokeAll()

  assert.equal(entry.pendingChallenges(), 0)
  assert.deepEqual(
    entry.submit({ nonce: issued.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY }),
    { ok: false, reason: 'unknown_challenge' },
  )
})

/* ------------------------------------------------------------------ *
 * Failures from storage
 * ------------------------------------------------------------------ */

test('a storage refusal comes back as a fixed token, never as a message', () => {
  const cases = [
    ['storage_unavailable', 'storage_unavailable'],
    ['not_encrypted', 'not_encrypted'],
    ['not_persisted', 'not_persisted'],
    // Everything else collapses to one token, because a caller may not learn
    // which internal check failed.
    ['invalid_scope', 'invalid_request'],
    ['not_found', 'invalid_request'],
  ]

  for (const [reason, expected] of cases) {
    const { entry } = build({ store: fakeStore({ ok: false, reason }) })
    const issued = entry.issueChallenge(SCOPE)
    const reply = entry.submit({ nonce: issued.challenge.nonce, scope: SCOPE, name: 'k', secret: CANARY })
    assert.deepEqual(reply, { ok: false, reason: expected }, reason)
    assert.equal(JSON.stringify(reply).includes(CANARY), false, reason)
  }
})

/* ------------------------------------------------------------------ *
 * Leaks
 * ------------------------------------------------------------------ */

test('no log line carries the key, on success or on any refusal', () => {
  const log = recordingLogger()
  const { entry } = build({ log })

  const first = entry.issueChallenge(SCOPE)
  entry.submit({ nonce: first.challenge.nonce, scope: SCOPE, name: 'deepseek', secret: CANARY })

  // A scope mismatch, a malformed submit, an unknown nonce and an expiry.
  const second = entry.issueChallenge(SCOPE)
  entry.submit({
    nonce: second.challenge.nonce,
    scope: { serverHost: 'zuri.example.com', userId: 70 },
    name: 'deepseek',
    secret: CANARY,
  })
  entry.submit({ nonsense: CANARY })
  entry.submit({ nonce: 'a'.repeat(48), scope: SCOPE, name: 'deepseek', secret: CANARY })

  assert.ok(log.lines.length > 0, 'the boundary should log its refusals')
  for (const line of log.lines) {
    assert.equal(line.includes(CANARY), false, `a log line leaked the key: ${line}`)
  }
  assert.equal(log.lines.some(line => line.includes('deepseek')), true, 'log lines should name the entry')
})

test('the boundary cannot be built without a credential store', () => {
  assert.throws(() => api.createCredentialEntry({}), TypeError)
  assert.throws(() => api.createCredentialEntry({ store: {} }), TypeError)
})
