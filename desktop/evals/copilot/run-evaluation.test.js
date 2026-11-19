'use strict'

/*
 * The evaluation writes model answers to disk, so its own output must never carry
 * the key. These tests pin the rule that was broken: the check used to read the two
 * finished files back one at a time and delete the first one that held the key, so a
 * key that appeared in both reports left summary.md sitting on disk in plain text.
 *
 * Nothing here touches the network or needs a real key. The secret is synthetic.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { assertNoSecret, writeReports } = require('./run-evaluation.js')

const SECRET = 'sk-synthetic-0123456789abcdef'

/** The smallest payload whose rendered summary also carries the case title. */
function payloadWithTitle (title) {
  return {
    runId: 'test-run',
    startedAt: '2026-01-01T00:00:00.000Z',
    note: null,
    provider: {
      presetId: 'deepseek',
      modelId: 'test-model',
      cloud: true,
      timeoutMs: 1000,
      credentialPath: 'credential entry -> store -> transport',
    },
    warnings: [],
    isolation: { checks: 2, failures: [] },
    sets: [
      {
        feature: 'memory extraction',
        promptConstant: 'MEMORY_PROMPT',
        counts: {
          total: 1,
          judged: 1,
          pass: 1,
          fail: 0,
          timeout: 0,
          error: 0,
          invalid_shape: 0,
          blocked_before_send: 0,
          blocked_unexpected: 0,
          passRate: null,
        },
        results: [{ id: 'mem-01', status: 'pass', evidence: 'stored', title }],
        failures: [],
      },
    ],
  }
}

function scratchDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-eval-redaction-'))
}

test('a key in both reports stops the run before either report is written', (t) => {
  const outDir = scratchDir()
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  // The title is rendered into both files, so both would carry the key.
  let failure = null
  try {
    writeReports(outDir, payloadWithTitle(`answer quoting ${SECRET}`), SECRET)
  } catch (error) {
    failure = error
  }

  assert.notEqual(failure, null, 'the run must refuse to keep reports that hold the key')
  assert.match(String(failure.message), /key/u)

  // The leak the check exists to prevent: with the old per-file check, results.json
  // was deleted and summary.md was left behind holding the key.
  assert.equal(fs.existsSync(path.join(outDir, 'results.json')), false, 'results.json must not be written')
  assert.equal(fs.existsSync(path.join(outDir, 'summary.md')), false, 'summary.md must not be written')
})

test('reports left by an earlier run are removed when they hold the key', (t) => {
  const outDir = scratchDir()
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const jsonPath = path.join(outDir, 'results.json')
  const summaryPath = path.join(outDir, 'summary.md')
  fs.writeFileSync(jsonPath, `{"answer":"${SECRET}"}`, 'utf8')
  fs.writeFileSync(summaryPath, `- answer: ${SECRET}`, 'utf8')

  assert.throws(
    () => assertNoSecret([
      { path: jsonPath, text: `{"answer":"${SECRET}"}` },
      { path: summaryPath, text: `- answer: ${SECRET}` },
    ], SECRET),
    /would have contained the key/u,
  )

  assert.equal(fs.existsSync(jsonPath), false, 'the stale json report must not survive')
  assert.equal(fs.existsSync(summaryPath), false, 'the stale summary must not survive')
})

test('a clean run writes both reports and neither contains the key', (t) => {
  const outDir = scratchDir()
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }))

  const paths = writeReports(outDir, payloadWithTitle('a decision was stored'), SECRET)

  const json = fs.readFileSync(paths.jsonPath, 'utf8')
  const summary = fs.readFileSync(paths.summaryPath, 'utf8')

  assert.equal(json.includes(SECRET), false)
  assert.equal(summary.includes(SECRET), false)
  assert.match(summary, /a decision was stored/u, 'the summary still renders the case title')
})
