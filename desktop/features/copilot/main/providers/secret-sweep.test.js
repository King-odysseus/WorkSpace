'use strict'

/*
 * The sweep across the provider feature for anything shaped like a live key.
 *
 * Every other provider test asserts a key is absent from one path: the state it
 * returns, the failure it throws, the line it logs. Each of those is right, and
 * none of them can see the mistake this phase's acceptance criteria names, which
 * is a key pasted into a fixture, a report or a README while somebody was
 * debugging. No single path's assertions can notice that, because the key is not
 * on any of those paths. It is in a file.
 *
 * So this file reads the files instead. It walks every source and test file in
 * `features/copilot`, every file in `reports` when that folder is present, and
 * the two desktop documents, and fails on any string shaped like a key from a
 * hosted provider.
 *
 * Three choices keep the sweep honest rather than quiet:
 *
 * - It has a positive control. A sweep that is simply misconfigured passes on
 *   every repository, so one test builds a key shape at runtime and asserts the
 *   detector reports it. The shape is assembled by concatenation, which keeps a
 *   key-shaped literal out of this file.
 * - Every exemption is a string this repository really uses, written out in
 *   full, and a test asserts each one is still present in a swept file. A stale
 *   exemption therefore fails here instead of quietly widening the blind spot.
 * - Placeholders are never skipped by shape alone. Exempting anything containing
 *   "test" or "canary" would forgive `sk-test-<a real key>`; only an exact match
 *   against a verified fixture is let through.
 *
 * The prebuilt bundle, `node_modules` and `dist` are not scanned: the first is
 * generated from the sources that are, and the other two are not ours.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/* `providers` -> `main` -> `copilot` -> `features` -> `desktop`. */
const DESKTOP = path.join(__dirname, '..', '..', '..', '..')
const COPILOT = path.join(DESKTOP, 'features', 'copilot')
const REPORTS = path.join(DESKTOP, 'reports')

/** Code is swept by extension; reports and documents are swept whole. */
const SOURCE_EXTENSIONS = new Set(['.js', '.ts'])
const DOCUMENTS = [path.join(DESKTOP, 'README.md'), path.join(DESKTOP, 'package.json')]

/** Generated or installed trees, which the sources above already cover. */
const SKIPPED_DIRS = new Set(['node_modules', 'build', 'dist'])

/*
 * This file is excluded from its own sweep, by absolute path.
 *
 * It is the only file in the repository that names these patterns, so it is the
 * only file guaranteed to contain the strings the patterns are looking for. Being
 * exempt is the reason the patterns can be stated plainly instead of being
 * assembled from fragments, which would hide from a reader what is being caught.
 */
const THIS_FILE = path.resolve(__filename)

/*
 * The shapes worth failing on, each one short enough to read and long enough that
 * prose cannot produce it by accident.
 *
 * Length matters as much as the prefix. `sk-proj-` on its own would fire on a
 * document that merely names the prefix, so each pattern requires the run of
 * characters a real credential carries after it. The generic OpenAI form is 20
 * alphanumerics with no hyphen, which is what separates a pasted key from the
 * `sk-live-...` fixtures this repository already uses.
 */
const KEY_PATTERNS = [
  /* Anthropic: `sk-ant-api03-` plus roughly 90 more characters. */
  { name: 'Anthropic', source: 'sk-ant-[A-Za-z0-9_-]{20,}' },
  /* OpenAI legacy keys, one unbroken run after the prefix. */
  { name: 'OpenAI', source: 'sk-[A-Za-z0-9]{20,}' },
  /* OpenAI project keys, which carry hyphens in the body. */
  { name: 'OpenAI project', source: 'sk-proj-[A-Za-z0-9_-]{20,}' },
  /* OpenRouter. */
  { name: 'OpenRouter', source: 'sk-or-v1-[A-Za-z0-9]{32,}' },
  /* Groq. */
  { name: 'Groq', source: 'gsk_[A-Za-z0-9]{20,}' },
  /* An AWS access key id, which a Bedrock setup would carry. */
  { name: 'AWS access key id', source: 'AKIA[0-9A-Z]{16}' },
]

const COMPILED = KEY_PATTERNS.map(pattern => ({
  name: pattern.name,
  regex: new RegExp(pattern.source, 'g'),
}))

/*
 * The deliberate dummy keys already in the fixtures, each traced to the file that
 * uses it so the next reader can check the claim rather than trust it.
 *
 * These are short, hyphenated and obviously authored: a canary that has to be
 * unique, a distinction between two accounts, a value that sorts first. A real
 * credential is neither short nor hyphenated after its prefix, which is why the
 * patterns above do not need help to tell them apart today. The list exists so a
 * future widening of a pattern cannot turn a fixture into a false failure, and
 * the test below re-checks every entry against the files on disk.
 */
const PLACEHOLDERS = [
  /* providers/settings-service.test.js: the two accounts on one machine. */
  'sk-ant-api03-7f3c9b1e4d5a',
  'sk-ant-api03-2b8e6f0c7a91',
  /* security/credential-entry.test.js: the canary a refusal may not quote. */
  'sk-live-canary-7b3e9d1f4a2c',
  /* security/credentials.test.js: the stored secret most of that file uses. */
  'sk-live-9f2c1b7e4d5a3c6b8e0f1a2b',
  /* security/credentials.test.js: partitioning by account and by server. */
  'sk-other-account-key-0000',
  'sk-other-server-key-0000',
  'sk-live-second-key-0000',
  'sk-live-replacement-0000',
  /* security/credentials.test.js: a value the fingerprint schema must reject. */
  'sk-live-abcdefghijklmnop',
  /* security/egress-guard.test.js and security/pinned-transport.test.js. */
  'sk-canary-4d8e2f',
  'sk-canary-pinned-transport',
  /* providers/registry.test.js and providers/settings-ipc.test.js. */
  'sk-canary-7c41d9',
  /* providers/settings-ipc.test.js: a secret that may not come back. */
  'sk-test-0123456789abcdef',
  /* adapters/anthropic.test.js and adapters/openai-compatible.test.js: a
   * provider body that tries to echo a key through its error text. */
  'sk-live-secret',
  /* ipc/preload-shell.test.js: the shortest thing the boundary will accept. */
  'sk-live-key',
  /* shared/probe-contract.test.js: a key named inside a diagnostic string. */
  'sk-live-abc',
]

/** Every file under `dir`, names in a stable order, skipping generated trees. */
function walk (dir, found) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      walk(full, found)
    } else if (entry.isFile()) {
      found.push(full)
    }
  }
  return found
}

/** The code files under `dir`, or nothing when the folder is not there. */
function codeFilesUnder (dir) {
  if (!fs.existsSync(dir)) return []
  return walk(dir, []).filter(file => SOURCE_EXTENSIONS.has(path.extname(file)))
}

/** Every file under `dir`, or nothing when the folder is not there. */
function allFilesUnder (dir) {
  if (!fs.existsSync(dir)) return []
  return walk(dir, [])
}

/** Everything the sweep judges, this file aside. */
function sweptFiles () {
  const documents = DOCUMENTS.filter(file => fs.existsSync(file))
  return [
    ...codeFilesUnder(COPILOT),
    ...allFilesUnder(REPORTS),
    ...documents,
  ]
    .filter(file => path.resolve(file) !== THIS_FILE)
    .sort()
}

/** True only for a fixture this repository is known to use, matched in full. */
function isPlaceholder (text) {
  return PLACEHOLDERS.includes(text)
}

/**
 * Every key-shaped string in one text, as the facts a person needs to delete it.
 *
 * Each match is reported on its own rather than one per line, so a fixture that
 * shares a line with a real key cannot hide behind the fixture. Lines are
 * counted from one, which is what an editor shows.
 */
function keyShapesIn (text) {
  const reports = []
  const lines = text.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    for (const { name, regex } of COMPILED) {
      for (const match of line.matchAll(regex)) {
        if (isPlaceholder(match[0])) continue
        reports.push({ name, line: index + 1, text: match[0] })
      }
    }
  }
  return reports
}

/**
 * A report that says where the key is without repeating it.
 *
 * This text ends up in a terminal, a chat window and often an issue tracker,
 * which is the last place a live credential should reappear. The prefix, the
 * length and the line number are enough to find and remove it.
 */
function describe (file, found) {
  const relative = path.relative(DESKTOP, file).split(path.sep).join('/')
  return `${relative}:${found.line} looks like a ${found.name} key ` +
    `(${found.text.slice(0, 7)}..., ${found.text.length} chars)`
}

/* ------------------------------------------------------------------ *
 * The sweep
 * ------------------------------------------------------------------ */

test('no provider key shape appears in the provider feature or its reports', () => {
  const files = sweptFiles()

  /*
   * A sweep that walks nothing passes on every repository, so the root is
   * proved before the files are read. The named fixture is a providers test, so
   * a wrong `DESKTOP` fails here with a readable reason rather than a green run.
   */
  assert.ok(files.length > 20, `only ${files.length} files were swept`)
  assert.ok(
    files.some(file => file.endsWith(path.join('providers', 'settings-service.test.js'))),
    'the providers folder was not reached',
  )

  const offences = []
  for (const file of files) {
    for (const found of keyShapesIn(fs.readFileSync(file, 'utf8'))) {
      offences.push(describe(file, found))
    }
  }

  assert.deepEqual(offences, [], `a key shape was found:\n${offences.join('\n')}`)
})

/* ------------------------------------------------------------------ *
 * That the sweep can actually fail
 * ------------------------------------------------------------------ */

test('the detector recognises a key shape assembled at runtime', () => {
  /*
   * The positive control, and the reason this file is worth trusting: the sweep
   * above is only as good as its ability to say no. Both shapes are built from
   * fragments so this file carries no key-shaped literal of its own.
   */
  const anthropic = 'sk-ant-api03-' + 'K'.repeat(30)
  const aws = 'AKIA' + 'Q'.repeat(16)

  assert.deepEqual(
    keyShapesIn(`const key = '${anthropic}'`).map(found => found.name),
    ['Anthropic'],
  )
  assert.deepEqual(keyShapesIn(`awsKey: ${aws}`).map(found => found.name), ['AWS access key id'])

  // The line number points at the line the key is on, not at the file's start,
  // because that is what a person acts on.
  const reported = keyShapesIn(`// header\n\nexport const key = '${anthropic}'\n`)
  assert.equal(reported.length, 1)
  assert.equal(reported[0].line, 3)

  // And ordinary source produces nothing, so the patterns are not simply
  // matching everything and being saved by the emptiness of the fixtures. A
  // short fixture is named too, since a pattern that fired on one of those would
  // fail the sweep for the wrong reason.
  assert.deepEqual(keyShapesIn("const model = 'claude-sonnet-4-5'"), [])
  assert.deepEqual(keyShapesIn('Authorization: Bearer <token>'), [])
  assert.deepEqual(keyShapesIn(`key: '${PLACEHOLDERS[0]}'`), [])
})

test('every exemption is a shape the fixtures really use, and exempts nothing else', () => {
  const text = sweptFiles().map(file => fs.readFileSync(file, 'utf8')).join('\n')

  for (const placeholder of PLACEHOLDERS) {
    /*
     * A fixture that was renamed or deleted leaves an exemption behind that
     * forgives a shape nobody uses any more. Checking presence keeps the list
     * tied to the files it was written from.
     */
    assert.ok(
      text.includes(placeholder),
      `${placeholder} is no longer in any swept file, so its exemption is stale`,
    )
    assert.equal(isPlaceholder(placeholder), true, placeholder)
  }

  // A real key that merely begins with a fixture is not exempt: the list is held
  // as exact matches, never prefixes.
  assert.equal(isPlaceholder(PLACEHOLDERS[0] + 'ff'), false)
  assert.equal(isPlaceholder('sk-ant-api03-' + 'K'.repeat(30)), false)
})

/* ------------------------------------------------------------------ *
 * What the sweep reads
 * ------------------------------------------------------------------ */

test('the sweep reads source, tests and reports, not generated trees', () => {
  const files = sweptFiles()

  // Nothing installed or generated: the bundle is built from the sources that
  // are scanned, so scanning it would only duplicate them.
  const generated = files.filter(file => {
    const parts = path.relative(DESKTOP, file).split(path.sep)
    return parts.some(part => part === 'node_modules' || part === 'build' || part === 'dist')
  })
  assert.deepEqual(generated, [])

  // The feature sweep is code only, and this file is not among the files it
  // judges, for the reason stated at the top.
  const codeFiles = files.filter(file => file.startsWith(COPILOT + path.sep))
  assert.ok(codeFiles.length > 20, 'the feature folder was not swept')
  for (const file of codeFiles) {
    assert.ok(SOURCE_EXTENSIONS.has(path.extname(file)), `${file} is not source`)
  }
  assert.equal(files.includes(THIS_FILE), false)

  // The reports are the captured evidence for each phase, so they are swept in
  // full when the folder is present. It is not required to exist.
  if (fs.existsSync(REPORTS)) {
    const reports = files.filter(file => file.startsWith(REPORTS + path.sep))
    assert.ok(reports.length > 0, 'the reports folder exists but nothing was swept from it')
    for (const file of reports) {
      assert.ok(file.endsWith('.md'), `${file} is not a report`)
    }
  }
})
