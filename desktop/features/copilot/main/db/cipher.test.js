'use strict'

/*
 * The field cipher, tested through the bundle Electron loads.
 *
 * Every column that holds something a person wrote or a model said is sealed
 * with AES-256-GCM before it reaches SQLite, so this file is where four
 * properties are pinned:
 *
 * - A value opens back to exactly what was sealed, whatever alphabet it uses.
 * - Two seals of one plaintext differ, which is the only visible sign that the
 *   nonce is fresh every time and never reused under one key.
 * - The context is authenticated data, so a value sealed for one column cannot
 *   be opened as another. Without that, a bug that read the wrong column would
 *   return a plausible wrong answer instead of refusing.
 * - Every refusal is the single token `bad_key`. Telling "wrong key" apart from
 *   "tampered bytes" would tell an attacker which of the two they achieved, and
 *   the person reading the screen can act on neither.
 *
 * Nothing here touches the keychain or the database, and every key is made inside
 * the test, so no ciphertext produced here can outlive the run.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/**
 * Two column contexts, spelled the way the repositories spell them: the table,
 * a dot, and the encrypted column. Having two is the point, because the pair is
 * what proves a value cannot move between columns.
 */
const THREAD_TITLE = 'thread.title_enc'
const MESSAGE_CONTENT = 'message.content_enc'

/** The format tag `isEnvelope` recognises, written out so tampering is exact. */
const ENVELOPE_PREFIX = 'v1.'

/** A key as the keychain holds it, turned into the 32 bytes the cipher takes. */
function newRawKey () {
  return api.databaseKeyFromSecret(api.createKeyMaterial())
}

/** A cipher over a key nobody else in the run has. */
function newCipher () {
  return api.createFieldCipher(newRawKey())
}

/**
 * The one refusal this module produces.
 *
 * Written as a validator so every `assert.throws` in the file checks the same
 * two facts: the error is a `StorageError`, and its token is `bad_key`.
 */
function refusedBadKey (error) {
  assert.ok(error instanceof api.StorageError, 'the refusal is not a StorageError: ' + error)
  assert.equal(error.failure, 'bad_key')
  return true
}

/* ------------------------------------------------------------------ *
 * Key material
 * ------------------------------------------------------------------ */

test('a new key is 32 random bytes in base64, and two calls differ', () => {
  const first = api.createKeyMaterial()
  const second = api.createKeyMaterial()

  assert.equal(typeof first, 'string')
  // 32 bytes is ten whole three-byte groups plus two bytes, so base64 is 44
  // characters ending in one pad. Checking the shape as well as the length keeps
  // a hex string from passing as key material.
  assert.match(first, /^[A-Za-z0-9+/]{43}=$/)
  assert.equal(Buffer.from(first, 'base64').length, 32)

  // A generator that answered the same bytes twice would give every install the
  // same key, and every test below would still pass.
  assert.notEqual(first, second)
})

test('a real key is accepted and anything that is not 32 bytes is refused', () => {
  const accepted = api.databaseKeyFromSecret(api.createKeyMaterial())
  assert.ok(Buffer.isBuffer(accepted))
  assert.equal(accepted.length, 32)

  // Nothing at all: the keychain answered with an empty string, and an empty
  // string must not be stretched into a key.
  assert.throws(() => api.databaseKeyFromSecret(''), refusedBadKey)

  // Wrong length once decoded. A short key padded up would quietly open the
  // database with something weaker than the design says it does, so it is
  // refused instead.
  assert.throws(() => api.databaseKeyFromSecret('abc'), refusedBadKey)
  assert.throws(() => api.databaseKeyFromSecret(Buffer.alloc(16).toString('base64')), refusedBadKey)
  assert.throws(() => api.databaseKeyFromSecret(Buffer.alloc(64).toString('base64')), refusedBadKey)

  // Not a string at all. A Buffer of the right length is still refused, because
  // the key arrives from the keychain as text and anything else is a bug.
  for (const notAString of [undefined, null, 0, Buffer.alloc(32), {}, []]) {
    assert.throws(() => api.databaseKeyFromSecret(notAString), refusedBadKey, String(notAString))
  }

  // The same length check guards the cipher, so a caller that skips the
  // conversion cannot hand it 16 bytes either.
  assert.throws(() => api.createFieldCipher(Buffer.alloc(16)), refusedBadKey)
})

/* ------------------------------------------------------------------ *
 * Sealing and opening
 * ------------------------------------------------------------------ */

test('a sealed value opens back to the same text, non-ASCII included', () => {
  const cipher = newCipher()

  const samples = [
    'hello',
    // An empty string is a real value here: a thread with no title yet, and it
    // must not seal into something that opens as a refusal.
    '',
    'Zuri Lofts - 500 naira for the roof repair',
    // Two-byte and three-byte sequences, so a fix that only handled one of them
    // shows up here rather than in somebody's saved conversation.
    'Château, café, naïve, résumé',
    'Grüße aus München, Größe 42',
    'ありがとうございます',
    'line one\nline two\twith a tab',
    ' padded so a trim anywhere would show up ',
  ]

  for (const plaintext of samples) {
    const envelope = cipher.seal(THREAD_TITLE, plaintext)
    assert.equal(cipher.open(THREAD_TITLE, envelope), plaintext, JSON.stringify(plaintext))
  }
})

test('the same plaintext sealed twice gives different envelopes, and both open', () => {
  const cipher = newCipher()
  const plaintext = 'the same sentence'

  const first = cipher.seal(THREAD_TITLE, plaintext)
  const second = cipher.seal(THREAD_TITLE, plaintext)

  // A reused nonce would make these identical, which is the failure this pins.
  // It would also let anyone who saw one row test a guess against another.
  assert.notEqual(first, second)
  assert.equal(first.startsWith(ENVELOPE_PREFIX), true)
  assert.equal(second.startsWith(ENVELOPE_PREFIX), true)

  // Different ciphertext, same plaintext: the random part is not part of the value.
  assert.equal(cipher.open(THREAD_TITLE, first), plaintext)
  assert.equal(cipher.open(THREAD_TITLE, second), plaintext)
})

test('isEnvelope recognises a sealed value and refuses plain text', () => {
  const cipher = newCipher()

  assert.equal(api.isEnvelope(cipher.seal(THREAD_TITLE, 'a thread title')), true)

  // A value that never went through the cipher must not be mistaken for one, or
  // a read path would try to decrypt a sentence somebody typed.
  const notEnvelopes = [
    '',
    'a thread title',
    'v1',
    'v1 but this is prose',
    'v2.' + 'A'.repeat(40),
    42,
    null,
    undefined,
    {},
    ['v1.'],
  ]
  for (const value of notEnvelopes) {
    assert.equal(api.isEnvelope(value), false, String(value))
  }
})

/* ------------------------------------------------------------------ *
 * What a wrong key and a wrong column look like
 * ------------------------------------------------------------------ */

test('a value sealed with one key cannot be opened with another', () => {
  const sealing = newCipher()
  const other = newCipher()
  const envelope = sealing.seal(MESSAGE_CONTENT, 'what the model said')

  assert.throws(() => other.open(MESSAGE_CONTENT, envelope), refusedBadKey)

  // The refusal is about the key and not about the envelope: the cipher that
  // sealed it still opens it, so the test above is not passing by accident.
  assert.equal(sealing.open(MESSAGE_CONTENT, envelope), 'what the model said')
  assert.equal(other.canOpen(MESSAGE_CONTENT, envelope), false)
})

test('a value sealed for one column cannot be opened as another column', () => {
  const cipher = newCipher()
  const envelope = cipher.seal(THREAD_TITLE, 'a thread title')

  /*
   * This is the property that stops a sealed value being copied between columns.
   * Both contexts are real ones from the schema, and the ciphertext is unchanged,
   * so the only difference is the context the caller claims.
   */
  assert.throws(() => cipher.open(MESSAGE_CONTENT, envelope), refusedBadKey)
  assert.equal(cipher.canOpen(MESSAGE_CONTENT, envelope), false)

  assert.equal(cipher.open(THREAD_TITLE, envelope), 'a thread title')
})

test('changing one character of an envelope makes it fail to open', () => {
  const cipher = newCipher()
  const plaintext = 'a message that must not change'
  const envelope = cipher.seal(MESSAGE_CONTENT, plaintext)
  const bodyStart = ENVELOPE_PREFIX.length

  // The first byte of the nonce, a later nonce byte and the first byte of the
  // authentication tag. Each one is a different way to break the same promise.
  for (const offset of [0, 10, 24]) {
    const index = bodyStart + offset
    const original = envelope[index]
    const replacement = original === 'A' ? 'B' : 'A'
    const tampered = envelope.slice(0, index) + replacement + envelope.slice(index + 1)

    assert.notEqual(tampered, envelope, 'the tampered envelope is unchanged')
    assert.equal(api.isEnvelope(tampered), true, 'the tampered value still looks sealed')
    assert.throws(() => cipher.open(MESSAGE_CONTENT, tampered), refusedBadKey, 'offset ' + offset)
    assert.equal(cipher.canOpen(MESSAGE_CONTENT, tampered), false, 'offset ' + offset)
  }

  // Shorter than a nonce and a tag, so it is refused before decryption is tried.
  assert.throws(() => cipher.open(MESSAGE_CONTENT, ENVELOPE_PREFIX + 'AAAA'), refusedBadKey)
  // Cut short in the middle of a real envelope, which is what a torn write or a
  // truncated column would leave behind.
  assert.throws(() => cipher.open(MESSAGE_CONTENT, envelope.slice(0, -6)), refusedBadKey)
})

test('an envelope never contains the plaintext it seals', () => {
  const cipher = newCipher()
  const plaintext = 'the marker a search would look for'
  const envelope = cipher.seal(MESSAGE_CONTENT, plaintext)

  // The whole sentence, and one word of it. The second check is what catches a
  // format that wrote a readable prefix beside the ciphertext.
  assert.equal(envelope.includes(plaintext), false)
  assert.equal(envelope.includes('marker'), false)
  assert.equal(envelope.includes('the marker'), false)

  // The key check seals a known constant. It is the one sealed value whose
  // plaintext is written in the source, so if anything leaked, this would.
  const keyCheck = cipher.seal(api.KEY_CHECK_CONTEXT, api.KEY_CHECK_PLAINTEXT)
  assert.equal(keyCheck.includes(api.KEY_CHECK_PLAINTEXT), false)
  assert.equal(api.KEY_CHECK_CONTEXT.startsWith('meta.'), true)
})

/* ------------------------------------------------------------------ *
 * Asking without throwing
 * ------------------------------------------------------------------ */

test('canOpen answers true or false instead of throwing', () => {
  const cipher = newCipher()
  const envelope = cipher.seal(THREAD_TITLE, 'a title')

  assert.equal(cipher.canOpen(THREAD_TITLE, envelope), true)

  /*
   * Every entry below is a throw from `open`, and none of them may escape: this
   * is the function the key check calls while it is deciding whether a database
   * belongs to the person opening it, and an exception there would be reported as
   * a broken app instead of a wrong profile.
   */
  const refusals = [
    [MESSAGE_CONTENT, envelope],
    [THREAD_TITLE, 'not an envelope'],
    [THREAD_TITLE, ENVELOPE_PREFIX + 'AAAA'],
    [THREAD_TITLE, envelope.slice(0, -6)],
    [THREAD_TITLE, newCipher().seal(THREAD_TITLE, 'a title')],
  ]

  for (const [context, value] of refusals) {
    assert.equal(cipher.canOpen(context, value), false, context)
  }
})

/* ------------------------------------------------------------------ *
 * The refusal itself
 * ------------------------------------------------------------------ */

test('a storage refusal carries its fixed sentence and never a cause', () => {
  // Read from the contract rather than written out here, so a token added in a
  // newer build is checked instead of shipping without a sentence.
  assert.ok(api.STORAGE_FAILURES.length > 0, 'the contract lists no failure tokens')

  for (const failure of api.STORAGE_FAILURES) {
    const error = new api.StorageError(failure)

    assert.equal(error.failure, failure)
    assert.equal(error.message, api.STORAGE_FAILURE_MESSAGES[failure], failure)
    assert.equal(error.name, 'StorageError')
    assert.ok(error instanceof Error)

    // `console.error` prints a cause, and a cause here would be a row's content.
    assert.equal('cause' in error, false, failure + ' carries a cause')
    assert.equal(error.cause, undefined, failure + ' carries a cause')
    assert.equal(error.message.includes('_'), false, failure + ' shows an identifier')
    assert.equal(/[\u2013\u2014]/.test(error.message), false, failure + ' carries a long dash')
  }

  // The one this module produces, checked as the cipher produces it rather than
  // as the constructor was handed it.
  const cipher = newCipher()
  assert.throws(() => cipher.open(THREAD_TITLE, 'not an envelope'), (error) => {
    assert.equal(error.failure, 'bad_key')
    assert.equal(error.message, api.STORAGE_FAILURE_MESSAGES.bad_key)
    assert.equal('cause' in error, false)
    return true
  })
})
