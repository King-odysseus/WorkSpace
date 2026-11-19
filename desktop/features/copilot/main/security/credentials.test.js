'use strict'

/*
 * The account-scoped credential store, tested through the bundle Electron loads.
 *
 * Four things are proven here, and each is a promise the plan makes.
 *
 * - A key survives a restart. That is the difference between a keychain and a
 *   credential store, so it is proven with a real file and a second, freshly
 *   built store rather than a fake that would pass either way.
 * - Two accounts never share an entry, including the two that a naive prefix
 *   match would confuse (user 7 and user 70).
 * - Signing out drops what is decryptable in memory and keeps what is on disk,
 *   because signing out is not deleting a key.
 * - Nothing secret reaches a log line, on any path, including the failures.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

const SECRET = 'sk-live-9f2c1b7e4d5a3c6b8e0f1a2b'
const SCOPE = { serverHost: 'zuri.example.com', userId: 7 }
const OTHER_USER = { serverHost: 'zuri.example.com', userId: 70 }
const OTHER_HOST = { serverHost: 'other.example.com', userId: 7 }

/** A safeStorage whose behaviour each test can flip, including its failures. */
function fakeSafeStorage () {
  const fake = {
    available: true,
    isEncryptionAvailable: () => fake.available,
    encryptString: plainText => Buffer.from('enc:' + plainText),
    decryptString: encrypted => encrypted.toString('utf8').slice(4),
  }
  return fake
}

function recordingLogger () {
  const lines = []
  return { lines, warn: message => lines.push(String(message)) }
}

/** A temp directory that the test cleans up. */
function tempDir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credentials-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** A keychain whose ciphertext lives in a real file, so a restart can be faked. */
function durableKeychain (filePath, options = {}) {
  const file = api.createSecretFileStore({ path: filePath, log: options.fileLog })
  const keychain = api.createKeychain({
    safeStorage: options.safeStorage ?? fakeSafeStorage(),
    log: options.log,
    persistence: { load: () => file.load(), save: entries => file.save(entries) },
  })
  return { file, keychain }
}

/* ------------------------------------------------------------------ *
 * Round trip and fingerprint
 * ------------------------------------------------------------------ */

test('a saved credential reads back, and only a four character tail is shown', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  const saved = store.save(SCOPE, 'deepseek', SECRET)
  assert.equal(saved.ok, true)
  assert.equal(saved.fingerprint, SECRET.slice(-4))

  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
  assert.deepEqual(store.describe(SCOPE, 'deepseek'), { ok: true, fingerprint: SECRET.slice(-4) })
})

test('a secret too short to show four characters is masked instead', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  // Four of eight characters would be half the key.
  const saved = store.save(SCOPE, 'short', 'abcdefgh')
  assert.equal(saved.ok, true)
  assert.equal(saved.fingerprint, api.MASKED_FINGERPRINT)
  assert.equal(api.fingerprintOf('short'), api.MASKED_FINGERPRINT)
  assert.equal(api.fingerprintOf('a'.repeat(api.MIN_FINGERPRINT_LENGTH)), 'aaaa')
})

/* ------------------------------------------------------------------ *
 * Survives a restart
 * ------------------------------------------------------------------ */

test('a credential survives a restart of the app', t => {
  const dir = tempDir(t)
  const filePath = path.join(dir, 'secrets.json')

  const first = durableKeychain(filePath)
  api.createCredentialStore({ keychain: first.keychain }).save(SCOPE, 'deepseek', SECRET)

  // Nothing plaintext touched the file.
  const raw = fs.readFileSync(filePath, 'utf8')
  assert.equal(raw.includes(SECRET), false, 'the file must hold ciphertext only')

  // A second, independent store over the same file is what a restart looks like.
  const second = durableKeychain(filePath)
  const reopened = api.createCredentialStore({ keychain: second.keychain })
  assert.deepEqual(reopened.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
})

/* ------------------------------------------------------------------ *
 * Partitioning
 * ------------------------------------------------------------------ */

test('accounts and servers never share an entry', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  store.save(SCOPE, 'deepseek', SECRET)

  // Another user on the same server, and the same user on another server.
  assert.deepEqual(store.read(OTHER_USER, 'deepseek'), { ok: false, reason: 'not_found' })
  assert.deepEqual(store.read(OTHER_HOST, 'deepseek'), { ok: false, reason: 'not_found' })

  // The near miss a prefix match would get wrong: user 7 must not see user 70.
  store.save(OTHER_USER, 'deepseek', 'sk-other-account-key-0000')
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
  assert.deepEqual(store.read(OTHER_USER, 'deepseek'), { ok: true, secret: 'sk-other-account-key-0000' })
})

test('the key is namespaced, and an unusable scope or name is refused', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  assert.equal(api.credentialKey(SCOPE, 'deepseek'), 'zuricopilot.16-zuri.example.com.7.deepseek')

  // A host carrying a separator or a quote must never become part of a name.
  assert.equal(api.credentialKey({ serverHost: 'evil/../x', userId: 7 }, 'deepseek'), null)
  assert.equal(api.credentialKey({ serverHost: 'a b', userId: 7 }, 'deepseek'), null)
  assert.equal(api.credentialKey({ serverHost: 'ok.example.com', userId: 0 }, 'deepseek'), null)
  assert.equal(api.credentialKey({ serverHost: 'ok.example.com', userId: 1.5 }, 'deepseek'), null)
  assert.equal(api.credentialKey(SCOPE, 'bad name'), null)
  assert.equal(api.credentialKey(SCOPE, 'a'.repeat(65)), null)

  assert.deepEqual(store.save({ serverHost: 'a/b', userId: 7 }, 'deepseek', SECRET), {
    ok: false,
    reason: 'invalid_scope',
  })
  assert.deepEqual(store.save(SCOPE, 'a'.repeat(65), SECRET), { ok: false, reason: 'invalid_argument' })
})

test('two accounts cannot be given the same key name', t => {
  /*
   * The case a plain dot-join gets wrong: host `example.com.7` with user 8 is the
   * same string as host `example.com` with user 7 and name `8.key`. Both are legal
   * inputs, so a join that cannot be re-split is the only safe answer.
   */
  const account = { serverHost: 'example.com', userId: 7 }
  const impostor = { serverHost: 'example.com.7', userId: 8 }

  assert.notEqual(api.credentialKey(account, '8.key'), api.credentialKey(impostor, 'key'))

  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  store.save(account, '8.key', SECRET)
  assert.deepEqual(store.read(impostor, 'key'), { ok: false, reason: 'not_found' })

  // And clearing one account cannot reach into the other.
  assert.deepEqual(store.clearScope(impostor), { ok: true, removed: 0 })
  assert.deepEqual(store.read(account, '8.key'), { ok: true, secret: SECRET })
})

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

test('storage that cannot encrypt refuses to store anything', t => {
  const dir = tempDir(t)
  const safeStorage = fakeSafeStorage()
  safeStorage.available = false
  const { keychain, file } = durableKeychain(path.join(dir, 'secrets.json'), { safeStorage })
  const store = api.createCredentialStore({ keychain })

  assert.deepEqual(store.save(SCOPE, 'deepseek', SECRET), { ok: false, reason: 'storage_unavailable' })
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: false, reason: 'storage_unavailable' })
  assert.deepEqual(file.load(), [], 'a refused store must leave nothing on disk')
})

test('a store that cannot be written says so, but still works this session', t => {
  const dir = tempDir(t)
  const filePath = path.join(dir, 'secrets.json')
  const file = api.createSecretFileStore({ path: filePath })
  const keychain = api.createKeychain({
    safeStorage: fakeSafeStorage(),
    persistence: {
      load: () => file.load(),
      // The durable half refuses every write.
      save: () => false,
    },
  })
  const store = api.createCredentialStore({ keychain })

  assert.deepEqual(store.save(SCOPE, 'deepseek', SECRET), { ok: false, reason: 'not_persisted' })
  // The key was encrypted and kept, so it is usable now. Reporting a plain
  // success would have promised it survives a restart, which it does not.
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
})

/* ------------------------------------------------------------------ *
 * Sign-out and removal
 * ------------------------------------------------------------------ */

test('signing out drops the live secret and keeps the durable one', t => {
  const dir = tempDir(t)
  const filePath = path.join(dir, 'secrets.json')
  const { keychain } = durableKeychain(filePath)
  const store = api.createCredentialStore({ keychain })

  store.save(SCOPE, 'deepseek', SECRET)
  store.signOut()

  // Nothing decryptable is held any more.
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: false, reason: 'not_found' })

  // Signing back in reads the same person's keys without re-entering them.
  keychain.reload()
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
})

test('removing a credential reports whether there was one, and forgets it durably', t => {
  const dir = tempDir(t)
  const filePath = path.join(dir, 'secrets.json')
  const first = durableKeychain(filePath)
  const store = api.createCredentialStore({ keychain: first.keychain })

  store.save(SCOPE, 'deepseek', SECRET)
  assert.deepEqual(store.remove(SCOPE, 'deepseek'), { ok: true, removed: true })
  assert.deepEqual(store.remove(SCOPE, 'deepseek'), { ok: true, removed: false })

  // Durable too, not just in memory.
  const second = durableKeychain(filePath)
  assert.deepEqual(
    api.createCredentialStore({ keychain: second.keychain }).read(SCOPE, 'deepseek'),
    { ok: false, reason: 'not_found' },
  )
})

test('replacing a credential is a replacement, not a second entry', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  store.save(SCOPE, 'deepseek', SECRET)
  store.save(SCOPE, 'deepseek', 'sk-live-replacement-0000')

  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: 'sk-live-replacement-0000' })
  assert.equal(keychain.names().length, 1)
})

test('clearing one account leaves the others alone', t => {
  const dir = tempDir(t)
  const { keychain } = durableKeychain(path.join(dir, 'secrets.json'))
  const store = api.createCredentialStore({ keychain })

  store.save(SCOPE, 'deepseek', SECRET)
  store.save(OTHER_USER, 'deepseek', 'sk-other-account-key-0000')
  store.save(OTHER_HOST, 'deepseek', 'sk-other-server-key-0000')

  // User 7 is a prefix of user 70, so this is the case a naive match breaks.
  assert.deepEqual(store.clearScope(SCOPE), { ok: true, removed: 1 })

  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: false, reason: 'not_found' })
  assert.deepEqual(store.read(OTHER_USER, 'deepseek'), { ok: true, secret: 'sk-other-account-key-0000' })
  assert.deepEqual(store.read(OTHER_HOST, 'deepseek'), { ok: true, secret: 'sk-other-server-key-0000' })
})

/* ------------------------------------------------------------------ *
 * Leaks
 * ------------------------------------------------------------------ */

test('no log line ever carries the secret, on success or on any failure', t => {
  const dir = tempDir(t)
  const log = recordingLogger()
  const fileLog = recordingLogger()
  const filePath = path.join(dir, 'secrets.json')

  const ok = durableKeychain(filePath, { log, fileLog })
  const store = api.createCredentialStore({ keychain: ok.keychain, log })
  store.save(SCOPE, 'deepseek', SECRET)
  store.read(SCOPE, 'deepseek')
  store.describe(SCOPE, 'deepseek')
  store.remove(SCOPE, 'deepseek')

  // Encryption gone, then persistence refusing, then a bad scope.
  const blocked = fakeSafeStorage()
  blocked.available = false
  const refused = durableKeychain(path.join(dir, 'other.json'), { safeStorage: blocked, log, fileLog })
  api.createCredentialStore({ keychain: refused.keychain, log }).save(SCOPE, 'deepseek', SECRET)
  api.createCredentialStore({ keychain: refused.keychain, log }).save({ serverHost: 'a/b', userId: 7 }, 'x', SECRET)

  assert.ok(log.lines.length > 0, 'the store should log its refusals')
  for (const line of [...log.lines, ...fileLog.lines]) {
    assert.equal(line.includes(SECRET), false, `a log line leaked the secret: ${line}`)
  }
})

test('the store cannot be built without a keychain', () => {
  assert.throws(() => api.createCredentialStore({}), TypeError)
  assert.throws(() => api.createCredentialStore({ keychain: {} }), TypeError)
})

test('no channel can answer with a credential, and the one that takes one answers with a fingerprint', () => {
  const channels = [
    ...(api.CHANNEL_NAMES ?? []),
    ...(api.ACCESS_CHANNEL_NAMES ?? []),
    ...Object.values(api.ACCESS_CHANNELS ?? {}),
    ...Object.values(api.CHANNELS ?? {}),
    ...Object.values(api.SHELL_CHANNELS ?? {}),
    ...Object.values(api.PROVIDER_CHANNELS ?? {}),
  ].map(String)

  assert.ok(channels.length > 0, 'expected to read the channel lists')

  /*
   * Section 7.1 says a secret never crosses IPC *to a renderer*. It does not say a
   * key may not be handed to the main process - it has to be, or a person could
   * never enter one - and it names the last four characters as the one thing that
   * may come back.
   *
   * This test used to refuse the words "credential", "secret" and "key" anywhere
   * in a channel name or in the preload. That was a good proxy while no entry path
   * existed, but it is the wrong invariant: it fails on the approved entry channel
   * while saying nothing about whether a key can come *back*. So it now checks the
   * two things that actually decide that.
   *
   * 1. No channel name suggests reading a secret out. A channel that reads is the
   *    only shape that could leak one, so this still fails the day somebody adds
   *    one rather than the day it leaks.
   * 2. The reply of the entry channel is the contract's fingerprint shape, which
   *    has no field a key could fit in. That is checked against the schema itself
   *    rather than against a name, so a renamed field cannot slip past.
   */
  for (const channel of channels) {
    const reads = /read|get|fetch|reveal|export|show|dump|dump/i.test(channel)
    const secretShaped = /credential|secret|keychain|api-?key|passphrase|token/i.test(channel)
    assert.equal(
      reads && secretShaped,
      false,
      `${channel} looks like it could answer with a secret`,
    )
  }

  const saved = api.providerCredentialSavedSchema
  assert.deepEqual(Object.keys(saved.shape).sort(), ['fingerprint', 'presetId'])

  const fingerprint = saved.shape.fingerprint
  // Four characters, which is the tail section 7.1 allows. A schema that accepted
  // a longer value would let a whole key through one character at a time.
  assert.equal(fingerprint.safeParse('c0de').success, true)
  assert.equal(fingerprint.safeParse('sk-live-abcdefghijklmnop').success, false)

  // The state a page draws carries the fingerprint and nothing else.
  const entry = api.providerEntrySchema
  assert.equal(entry.shape.secret, undefined)
  assert.equal(entry.shape.credential, undefined)
  assert.equal(entry.shape.apiKey, undefined)

  // The preload bridge is the only thing a page can invoke through, so it must
  // expose nothing that reads a key back out of the main process.
  const preload = fs.readFileSync(path.join(__dirname, '../../../../electron/preload/shell.js'), 'utf8')
  assert.ok(preload.includes('contextBridge'), 'read the preload source')
  for (const forbidden of ['readCredential', 'getCredential', 'revealKey', 'exportKey', 'decrypt', 'decryptString']) {
    assert.equal(preload.includes(forbidden), false, `the preload must not expose ${forbidden}`)
  }
})

/* ------------------------------------------------------------------ *
 * Deletion that did not reach the disk
 * ------------------------------------------------------------------ */

test('a delete that never reached the file is reported, not pretended', t => {
  const dir = tempDir(t)
  const filePath = path.join(dir, 'secrets.json')
  const file = api.createSecretFileStore({ path: filePath })
  let allowWrites = true
  const keychain = api.createKeychain({
    safeStorage: fakeSafeStorage(),
    persistence: {
      load: () => file.load(),
      save: entries => (allowWrites ? file.save(entries) : false),
    },
  })
  const store = api.createCredentialStore({ keychain })

  store.save(SCOPE, 'deepseek', SECRET)
  store.save(SCOPE, 'other', 'sk-live-second-key-0000')
  allowWrites = false

  /*
   * The file still holds both, so "removed" would be a promise that undoes itself
   * at the next start. The caller is told, and the key stays usable meanwhile.
   */
  assert.deepEqual(store.remove(SCOPE, 'deepseek'), { ok: false, reason: 'not_persisted' })
  assert.deepEqual(store.read(SCOPE, 'deepseek'), { ok: true, secret: SECRET })
  assert.deepEqual(store.clearScope(SCOPE), { ok: false, reason: 'not_persisted' })

  // Once writes land again the same calls are real, and durable.
  allowWrites = true
  assert.deepEqual(store.remove(SCOPE, 'deepseek'), { ok: true, removed: true })
  assert.deepEqual(store.clearScope(SCOPE), { ok: true, removed: 1 })

  const second = durableKeychain(filePath)
  const reopened = api.createCredentialStore({ keychain: second.keychain })
  assert.deepEqual(reopened.read(SCOPE, 'deepseek'), { ok: false, reason: 'not_found' })
  assert.deepEqual(reopened.read(SCOPE, 'other'), { ok: false, reason: 'not_found' })
})
