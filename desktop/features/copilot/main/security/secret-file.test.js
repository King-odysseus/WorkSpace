'use strict'

/*
 * The durable key file, tested against a real directory.
 *
 * `secret-file.ts` is the half of the secret store that outlives the process,
 * so the tests use a real file in the OS temp directory rather than a fake:
 * what is being proven is the bytes that survive a restart, and a fake
 * filesystem would prove only that the calls were made.
 *
 * The cases that matter beyond the happy path:
 *
 * - A brand new store reads back what an earlier store wrote. That is the
 *   restart, and it is the whole reason this module exists.
 * - The file holds ciphertext and never a plaintext secret, checked with a
 *   canary that must not appear in the raw bytes.
 * - Every refusal is a value, not an exception, including a write that throws.
 *   A key file the app cannot write must leave it running, not crash it.
 * - Nothing the file holds is echoed in a log line, and `describe()` says only
 *   where the file is and whether it exists.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

/* Stand-ins for safeStorage output: base64 of some bytes, never plaintext. */
const CIPHER_A = Buffer.from('encrypted-anthropic-key').toString('base64')
const CIPHER_B = Buffer.from('encrypted-ollama-key').toString('base64')

/* A string that must never reach the disk, a log or a describe() answer. */
const CANARY = 'plaintext-canary-4417'

/** A fresh key file path inside its own temp directory, removed after the test. */
function tempFile (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-file-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'secrets.json')
}

function recordingLog () {
  const lines = []
  return { lines, log: { warn (message) { lines.push(String(message)) } } }
}

/**
 * `node:fs` behind the injected interface, with room for one method to fail.
 *
 * The store only ever uses these six calls, so a wrapper this small is enough
 * to exercise the failure paths without a filesystem mock library.
 */
function nodeIo (overrides = {}) {
  return {
    readFileSync: (file, encoding) => fs.readFileSync(file, encoding),
    writeFileSync: (file, data, options) => fs.writeFileSync(file, data, options),
    renameSync: (from, to) => fs.renameSync(from, to),
    mkdirSync: (dir, options) => fs.mkdirSync(dir, options),
    unlinkSync: (file) => fs.unlinkSync(file),
    existsSync: (file) => fs.existsSync(file),
    ...overrides
  }
}

function store (file, extra = {}) {
  // The bundle only exposes what ipc/index.ts re-exports, so a missing export
  // is reported as the wiring step it is rather than as "undefined is not a
  // function" in twenty places.
  if (typeof api.createSecretFileStore !== 'function') {
    throw new Error('desktop/features/copilot/main/ipc/index.ts must re-export ./security/secret-file.js')
  }
  return api.createSecretFileStore({ path: file, ...extra })
}

test('the bundle publishes the secret file store', () => {
  // The tests below load what Electron loads. If this is red, the module exists
  // but is not reachable, and every case after it would be testing nothing.
  assert.equal(
    typeof api.createSecretFileStore,
    'function',
    'desktop/features/copilot/main/ipc/index.ts must re-export ./security/secret-file.js'
  )
})

test('entries written by one store are read back by a new one', (t) => {
  const file = tempFile(t)

  // Saved out of order on purpose: load answers sorted by name.
  assert.equal(store(file).save([['ollama', CIPHER_B], ['anthropic', CIPHER_A]]), true)

  // The second store has no memory of the first: the file is all it has, which
  // is exactly the situation after a restart.
  assert.deepEqual(store(file).load(), [['anthropic', CIPHER_A], ['ollama', CIPHER_B]])
})

test('the file holds base64 ciphertext and never the plaintext it came from', (t) => {
  const file = tempFile(t)
  const ciphertext = Buffer.from(CANARY).toString('base64')

  assert.equal(store(file).save([['anthropic', ciphertext]]), true)

  const raw = fs.readFileSync(file, 'utf8')
  assert.equal(raw.includes(CANARY), false, 'the key file must not carry a plaintext secret')
  assert.ok(raw.includes(ciphertext), 'the ciphertext is what gets stored')

  // One versioned document, keys sorted, nothing else in it.
  assert.deepEqual(JSON.parse(raw), { version: 1, entries: { anthropic: ciphertext } })
})

test('a missing file loads as an empty store, without a log line', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()

  assert.deepEqual(store(file, { log }).load(), [])
  // A first run is not a fault, so it must not fill the log with warnings.
  assert.deepEqual(lines, [])
  assert.equal(fs.existsSync(file), false)
})

test('a corrupt file loads as empty and is reported exactly once', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()
  fs.writeFileSync(file, 'not json')

  assert.deepEqual(store(file, { log }).load(), [])
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('invalid_json'))
  // The reason is fixed text; the file's own content never reaches a log.
  assert.equal(lines[0].includes('not json'), false, 'a log line must not quote the file')
})

test('an empty file loads as empty', (t) => {
  const file = tempFile(t)
  fs.writeFileSync(file, '   \n')

  assert.deepEqual(store(file).load(), [])
})

test('a file of another version or the wrong shape loads as empty', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()
  const secrets = store(file, { log })

  fs.writeFileSync(file, JSON.stringify({ version: 99, entries: { anthropic: CIPHER_A } }))
  assert.deepEqual(secrets.load(), [])

  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: 'not an object' }))
  assert.deepEqual(secrets.load(), [])

  fs.writeFileSync(file, '[]')
  assert.deepEqual(secrets.load(), [])

  // One line per discarded file, and no more.
  assert.equal(lines.length, 3)
})

test('an empty or non-base64 value is skipped and the good entries are kept', (t) => {
  const file = tempFile(t)
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    entries: {
      good: CIPHER_A,
      empty: '',
      prose: 'not base64 at all',
      stars: '****'
    }
  }))

  assert.deepEqual(store(file).load(), [['good', CIPHER_A]])
})

test('an entry whose name could never be written back is skipped', (t) => {
  const file = tempFile(t)
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    entries: { 'bad name': CIPHER_A, good: CIPHER_B }
  }))

  assert.deepEqual(store(file).load(), [['good', CIPHER_B]])
})

test('a value that is not a string makes the whole file unreadable', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { anthropic: 42 } }))

  // A number where ciphertext belongs means this is not this file's shape at
  // all, so nothing from it is trusted.
  assert.deepEqual(store(file, { log }).load(), [])
  assert.equal(lines.length, 1)
})

test('an invalid name makes save write nothing', (t) => {
  const file = tempFile(t)

  for (const name of ['has space', 'dir/entry', 'a'.repeat(65), '']) {
    assert.equal(store(file).save([[name, CIPHER_A]]), false, `accepted the name '${name}'`)
    assert.equal(fs.existsSync(file), false, 'a refused save must not create the file')
  }

  // The boundaries themselves are allowed.
  assert.equal(store(file).save([['a'.repeat(64), CIPHER_A]]), true)
})

test('an empty value makes save write nothing', (t) => {
  const file = tempFile(t)

  assert.equal(store(file).save([['anthropic', '']]), false)
  assert.equal(fs.existsSync(file), false)
})

test('a refused save leaves an existing key file untouched', (t) => {
  const file = tempFile(t)
  const secrets = store(file)
  assert.equal(secrets.save([['anthropic', CIPHER_A]]), true)
  const before = fs.readFileSync(file, 'utf8')

  // All or nothing: the good pair must not be written while the bad one is
  // refused, or the next start would silently lose the rest.
  assert.equal(secrets.save([['anthropic', CIPHER_A], ['bad name', CIPHER_B]]), false)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.deepEqual(store(file).load(), [['anthropic', CIPHER_A]])
})

test('a write that throws returns false, leaves no temp file and does not throw', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()
  const io = nodeIo({
    writeFileSync () {
      // Shaped like a real failure: the message carries a path and the reason.
      throw Object.assign(new Error(`could not write C:\\keys\\${CANARY}`), { code: 'ENOSPC' })
    }
  })

  let saved
  assert.doesNotThrow(() => {
    saved = store(file, { io, log }).save([['anthropic', CIPHER_A]])
  })

  assert.equal(saved, false)
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.existsSync(file + '.tmp'), false)
  assert.equal(lines.length, 1)
  // Only the error code may travel; a message can name a path.
  assert.ok(lines[0].includes('ENOSPC'))
  assert.equal(lines[0].includes(CANARY), false)
})

test('a failed write removes the temp file it left behind', (t) => {
  const file = tempFile(t)
  const { log } = recordingLog()
  const io = nodeIo({
    writeFileSync (target, data, options) {
      fs.writeFileSync(target, data, options)
      // The rename is what fails here, which is the case that can leave a fully
      // written temp file next to an untouched key file.
      throw Object.assign(new Error('rename refused'), { code: 'EPERM' })
    }
  })

  assert.equal(store(file, { io, log }).save([['anthropic', CIPHER_A]]), false)
  assert.equal(fs.existsSync(file + '.tmp'), false)
  assert.equal(fs.existsSync(file), false)
})

test('a read that throws is answered with an empty store and one log line', (t) => {
  const file = tempFile(t)
  const { lines, log } = recordingLog()
  const io = nodeIo({
    readFileSync () {
      throw Object.assign(new Error(`EACCES: permission denied, open '${file}'`), { code: 'EACCES' })
    }
  })

  assert.deepEqual(store(file, { io, log }).load(), [])
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('EACCES'))
  assert.equal(lines[0].includes(file), false, 'the path stays out of the log')
})

test('clearFile removes the file and answers true, twice', (t) => {
  const file = tempFile(t)
  const secrets = store(file)
  assert.equal(secrets.save([['anthropic', CIPHER_A]]), true)

  assert.equal(secrets.clearFile(), true)
  assert.equal(fs.existsSync(file), false)

  // Nothing left to remove is still the outcome the caller asked for.
  assert.equal(secrets.clearFile(), true)
})

test('a clear that fails returns false instead of throwing', (t) => {
  const file = tempFile(t)
  fs.writeFileSync(file, '{}')
  const { lines, log } = recordingLog()
  const io = nodeIo({
    unlinkSync () {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    }
  })

  assert.equal(store(file, { io, log }).clearFile(), false)
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('EPERM'))
})

test('describe reports the path and whether a file exists, and no ciphertext', (t) => {
  const file = tempFile(t)
  const secrets = store(file)

  assert.deepEqual(secrets.describe(), { path: file, exists: false })

  assert.equal(secrets.save([['anthropic', CIPHER_A]]), true)
  assert.deepEqual(secrets.describe(), { path: file, exists: true })

  // This answer is drawn on a screen, so it carries the path and nothing from
  // the file itself.
  assert.equal(JSON.stringify(secrets.describe()).includes(CIPHER_A), false)

  assert.equal(secrets.clearFile(), true)
  assert.deepEqual(secrets.describe(), { path: file, exists: false })
})

test('save creates the parent directory it needs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-file-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'nested', 'deeper', 'secrets.json')

  assert.equal(store(file).save([['anthropic', CIPHER_A]]), true)
  assert.deepEqual(store(file).load(), [['anthropic', CIPHER_A]])
})

test('a second save replaces the file rather than merging into it', (t) => {
  const file = tempFile(t)
  const secrets = store(file)

  assert.equal(secrets.save([['anthropic', CIPHER_A]]), true)
  assert.equal(secrets.save([['ollama', CIPHER_B]]), true)

  // A removed key must stay removed after a restart, which is only true if the
  // file is rewritten from the given entries.
  assert.deepEqual(store(file).load(), [['ollama', CIPHER_B]])
})

/* Windows has no POSIX mode bits, so the permission check is POSIX only. */
const posixOnly = process.platform === 'win32' ? 'Windows has no POSIX mode bits' : false

test('the key file is created owner-only', { skip: posixOnly }, (t) => {
  const file = tempFile(t)

  assert.equal(store(file).save([['anthropic', CIPHER_A]]), true)
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})
