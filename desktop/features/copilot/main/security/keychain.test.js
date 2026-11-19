'use strict'

/*
 * The keychain tests load the bundled main process, the same file Electron
 * runs, so what is tested is what ships. Electron is never required here:
 * `safeStorage` is faked, which is the whole point of the injection.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createKeychain } = require('../../../../build/main/ipc.cjs')

const SECRET = 'dummy-secret-value'

/** A safeStorage whose behaviour each test can flip, including its failures. */
function fakeSafeStorage () {
  const fake = {
    available: true,
    encryptError: null,
    decryptError: null,
    isEncryptionAvailable: () => fake.available,
    encryptString (plainText) {
      if (fake.encryptError) throw fake.encryptError
      return Buffer.from('enc:' + plainText)
    },
    decryptString (encrypted) {
      if (fake.decryptError) throw fake.decryptError
      return encrypted.toString('utf8').slice(4)
    },
  }
  return fake
}

function recordingLogger () {
  const lines = []
  return { lines, warn: message => lines.push(String(message)) }
}

test('a stored secret survives a round trip and is reported as present', () => {
  const keychain = createKeychain({ safeStorage: fakeSafeStorage() })

  assert.deepEqual(keychain.store('phase1-smoke', SECRET), { ok: true })
  assert.deepEqual(keychain.read('phase1-smoke'), { ok: true, secret: SECRET })
  assert.equal(keychain.has('phase1-smoke'), true)
})

test('unavailable storage refuses to store and keeps nothing', () => {
  const safeStorage = fakeSafeStorage()
  safeStorage.available = false
  const keychain = createKeychain({ safeStorage })

  assert.deepEqual(keychain.store('api-key', SECRET), { ok: false, reason: 'storage_unavailable' })
  assert.equal(keychain.has('api-key'), false)
  // Not not_found: the store cannot answer at all, and saying "missing" would
  // send the caller off to re-enter a secret it never stored.
  assert.deepEqual(keychain.read('api-key'), { ok: false, reason: 'storage_unavailable' })
})

test('storage that becomes unavailable after a store is refused on read', () => {
  const safeStorage = fakeSafeStorage()
  const keychain = createKeychain({ safeStorage })

  assert.deepEqual(keychain.store('api-key', SECRET), { ok: true })
  safeStorage.available = false

  assert.deepEqual(keychain.read('api-key'), { ok: false, reason: 'storage_unavailable' })
})

test('a failed encryption leaves nothing behind', () => {
  const safeStorage = fakeSafeStorage()
  safeStorage.encryptError = new Error('encrypt refused')
  const keychain = createKeychain({ safeStorage })

  assert.deepEqual(keychain.store('api-key', SECRET), { ok: false, reason: 'not_encrypted' })
  assert.equal(keychain.has('api-key'), false)
})

test('a failed decryption is reported instead of thrown', () => {
  const safeStorage = fakeSafeStorage()
  const keychain = createKeychain({ safeStorage })

  assert.deepEqual(keychain.store('api-key', SECRET), { ok: true })
  safeStorage.decryptError = new Error('decrypt refused')

  assert.deepEqual(keychain.read('api-key'), { ok: false, reason: 'decrypt_failed' })
})

test('invalid names and secrets are refused', () => {
  const keychain = createKeychain({ safeStorage: fakeSafeStorage() })
  const invalid = { ok: false, reason: 'invalid_argument' }

  assert.deepEqual(keychain.store('', SECRET), invalid)
  assert.deepEqual(keychain.store('api key', SECRET), invalid)
  assert.deepEqual(keychain.store('api/key', SECRET), invalid)
  assert.deepEqual(keychain.store('a'.repeat(65), SECRET), invalid)
  assert.deepEqual(keychain.store('api-key', ''), invalid)
  assert.deepEqual(keychain.store('api-key', 'x'.repeat(4097)), invalid)
  assert.deepEqual(keychain.store('api-key', 42), invalid)
  assert.deepEqual(keychain.store('api-key', null), invalid)
  assert.deepEqual(keychain.store(null, SECRET), invalid)
  assert.deepEqual(keychain.store(undefined, SECRET), invalid)
  assert.deepEqual(keychain.read(''), invalid)
  assert.deepEqual(keychain.read(42), invalid)
  assert.equal(keychain.has('api key'), false)

  // The boundaries themselves are allowed.
  assert.deepEqual(keychain.store('a'.repeat(64), SECRET), { ok: true })
  const tight = createKeychain({ safeStorage: fakeSafeStorage(), maxSecretLength: 4 })
  assert.deepEqual(tight.store('api-key', 'abcd'), { ok: true })
  assert.deepEqual(tight.store('api-key', SECRET), invalid)
})

test('the secret never appears in a log line', () => {
  const log = recordingLogger()

  const safeStorage = fakeSafeStorage()
  const keychain = createKeychain({ safeStorage, log })
  keychain.store('api-key', SECRET)
  keychain.read('api-key')

  const unavailable = fakeSafeStorage()
  unavailable.available = false
  createKeychain({ safeStorage: unavailable, log }).store('api-key', SECRET)

  const encryptFails = fakeSafeStorage()
  encryptFails.encryptError = new Error(`could not encrypt ${SECRET}`)
  createKeychain({ safeStorage: encryptFails, log }).store('api-key', SECRET)

  const decryptFails = fakeSafeStorage()
  const stored = createKeychain({ safeStorage: decryptFails, log })
  stored.store('api-key', SECRET)
  decryptFails.decryptError = new Error(`could not decrypt ${SECRET}`)
  stored.read('api-key')

  assert.ok(log.lines.length > 0, 'the keychain should log')
  for (const line of log.lines) {
    assert.equal(line.includes(SECRET), false, `log line leaked the secret: ${line}`)
  }
  assert.ok(
    log.lines.some(line => line.includes('api-key')),
    'log lines should name the entry they are about'
  )
})

test('the module never imports Electron', () => {
  const source = fs.readFileSync(path.join(__dirname, 'keychain.ts'), 'utf8')

  // Guard against reading the wrong file and passing on an empty string.
  assert.ok(source.includes('export function createKeychain'), 'read the keychain source')
  assert.equal(/from\s+['"]electron['"]/.test(source), false)
  assert.equal(/require\s*\(\s*['"]electron['"]\s*\)/.test(source), false)
})

test('a missing or incomplete safeStorage is a programming error', () => {
  assert.throws(() => createKeychain({}), TypeError)
  assert.throws(
    () => createKeychain({ safeStorage: { isEncryptionAvailable: () => true } }),
    TypeError
  )
})

test('remove forgets the entry without decrypting it', () => {
  const safeStorage = fakeSafeStorage()
  const keychain = createKeychain({ safeStorage })

  assert.deepEqual(keychain.store('api-key', SECRET), { ok: true })
  safeStorage.decryptError = new Error('remove must not decrypt')

  keychain.remove('api-key')

  assert.equal(keychain.has('api-key'), false)
  assert.deepEqual(keychain.read('api-key'), { ok: false, reason: 'not_found' })
})

test('remove says whether there was an entry to forget', () => {
  const keychain = createKeychain({ safeStorage: fakeSafeStorage() })
  keychain.store('api-key', SECRET)

  assert.deepEqual(keychain.remove('api-key'), { ok: true, removed: true })
  // Nothing left is the outcome the caller asked for, not a failure.
  assert.deepEqual(keychain.remove('api-key'), { ok: true, removed: false })
})

test('a removal that never reached the file is reported, and the entry stays', () => {
  let allowWrites = true
  let durable = []
  const keychain = createKeychain({
    safeStorage: fakeSafeStorage(),
    persistence: {
      load: () => durable,
      save (entries) {
        if (!allowWrites) return false
        durable = entries
        return true
      },
    },
  })

  keychain.store('api-key', SECRET)
  allowWrites = false

  /* The file still holds it, so answering "removed" would promise a deletion that
   * undoes itself at the next start. Memory is put back to match the file instead. */
  assert.deepEqual(keychain.remove('api-key'), { ok: false, reason: 'not_persisted' })
  assert.equal(keychain.has('api-key'), true)
  assert.deepEqual(keychain.read('api-key'), { ok: true, secret: SECRET })

  // Once the write lands, the removal is real and does not come back on reload.
  allowWrites = true
  assert.deepEqual(keychain.remove('api-key'), { ok: true, removed: true })
  keychain.reload()
  assert.equal(keychain.has('api-key'), false)
})
