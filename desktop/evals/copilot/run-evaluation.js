#!/usr/bin/env node
'use strict'

/*
 * Runs the memory-extraction and task-drafting evaluation sets against a
 * configured model.
 *
 * This is not a unit test. It talks to a real endpoint, it costs real money and
 * it is not part of `npm test`. What it exists for is the one question the unit
 * tests cannot answer: does the shipped prompt, run against the model a person
 * would actually pick, produce the behaviour the plan promises?
 *
 * It goes through the same path the app goes through:
 *
 *   credential entry challenge -> credential store -> keychain -> provider
 *   service -> guarded transport -> adapter -> shipped prompt -> apply rules.
 *
 * Nothing here builds its own prompt, its own parser or its own HTTP client. If
 * this file ever disagrees with the app about what a memory item is, that is a bug
 * in this file.
 *
 * Three things it is careful about.
 *
 * Isolation. Every case gets brand-new repositories. Nothing from an earlier case
 * can be deduplicated against, approved, or inherited, and the run asserts that
 * with a canary instead of assuming it: a canary row is written into the finished
 * case's store, and the next case's store is checked for it. Without that, a case
 * that "correctly stored nothing" might just be a case whose item was dropped as
 * already known.
 *
 * Honest counts. A turn that timed out, failed at the transport or never produced
 * a valid shape is recorded as exactly that and is never scored on content. The
 * earlier report counted failed calls as passes on the negative cases, which is
 * the specific mistake this run is meant to stop repeating.
 *
 * No secrets. The key is read from the environment, handed to the credential
 * entry boundary, encrypted, and never logged, printed, or written to the results.
 * The run ends by re-reading its own output and refusing to keep it if the key
 * appears anywhere in it.
 *
 * Usage:
 *
 *   npm run build:main
 *   ZURICOPILOT_EVAL_KEY=... node evals/copilot/run-evaluation.js \
 *     --preset deepseek --model deepseek-chat
 *
 * Options:
 *   --preset <id>      provider preset, default deepseek
 *   --model <id>       model id, default is the preset's own default
 *   --feature <name>   memory, drafting, or both (default both)
 *   --timeout <ms>     per case, default 90000
 *   --limit <n>        first n cases per feature, for a smoke run
 *   --out <dir>        where results go, default .tmp-zuricopilot-eval/<run id>
 *   --note <text>      recorded with the results, e.g. why this run was made
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const DESKTOP_ROOT = path.join(__dirname, '..', '..')
const REPO_ROOT = path.join(DESKTOP_ROOT, '..')
const BUNDLE_PATH = path.join(DESKTOP_ROOT, 'build', 'main', 'ipc.cjs')

const { judgeMemory, judgeDrafting } = require('./expectations.js')

const CANARY_PREFIX = 'isolation-canary-'

function parseArguments (argv) {
  const options = {
    preset: 'deepseek',
    model: null,
    feature: 'both',
    timeout: 90_000,
    limit: null,
    out: null,
    note: null,
    keyEnv: 'ZURICOPILOT_EVAL_KEY',
  }

  const takesValue = new Set(['--preset', '--model', '--feature', '--timeout', '--limit', '--out', '--note', '--key-env'])

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!takesValue.has(flag)) {
      throw new Error(`unknown option: ${flag}`)
    }
    const value = argv[index + 1]
    if (value === undefined) {
      throw new Error(`${flag} needs a value`)
    }
    index += 1

    if (flag === '--preset') options.preset = value
    if (flag === '--model') options.model = value
    if (flag === '--feature') options.feature = value
    if (flag === '--timeout') options.timeout = Number.parseInt(value, 10)
    if (flag === '--limit') options.limit = Number.parseInt(value, 10)
    if (flag === '--out') options.out = value
    if (flag === '--note') options.note = value
    if (flag === '--key-env') options.keyEnv = value
  }

  if (!['memory', 'drafting', 'both'].includes(options.feature)) {
    throw new Error('--feature must be memory, drafting or both')
  }
  if (!Number.isFinite(options.timeout) || options.timeout < 1_000) {
    throw new Error('--timeout must be at least 1000 milliseconds')
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive whole number')
  }

  return options
}

function loadBundle () {
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw new Error(
      `the main bundle is missing at ${BUNDLE_PATH}\n` +
      'build it first with:  cd desktop && npm run build:main',
    )
  }
  return require(BUNDLE_PATH)
}

/*
 * A stand-in for Electron's safeStorage, and the only thing this run swaps out.
 *
 * It is AES-256-GCM under a key generated for this process and never written
 * anywhere. The real app gets its key from the OS key store, which a Node script
 * cannot reach; what matters for the evaluation is that the credential goes
 * through the same entry challenge and the same encrypted file store, and that the
 * plaintext does not survive the process. A key that is gone when the run ends is
 * the same property by a shorter route.
 */
function evaluationSafeStorage () {
  const masterKey = crypto.randomBytes(32)

  return {
    isEncryptionAvailable: () => true,
    encryptString (plainText) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
      const sealed = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), sealed])
    },
    decryptString (encrypted) {
      const buffer = Buffer.from(encrypted)
      const iv = buffer.subarray(0, 12)
      const tag = buffer.subarray(12, 28)
      const sealed = buffer.subarray(28)
      const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(sealed), decipher.final()]).toString('utf8')
    },
  }
}

/**
 * The credential boundary, wired the way `electron/shell-window.js` wires it.
 *
 * The scope is a business that does not exist, so a run can never read or write a
 * real account's provider settings even if someone later points the persistence at
 * a real file.
 */
function createHarness (api, options, scratchRoot) {
  const warnings = []
  const log = {
    debug: () => {},
    info: () => {},
    warn: (message) => warnings.push(String(message)),
    error: (message) => warnings.push(String(message)),
  }

  const secretFile = api.createSecretFileStore({
    path: path.join(scratchRoot, 'credentials.json'),
    log,
  })

  const keychain = api.createKeychain({
    safeStorage: evaluationSafeStorage(),
    log,
    persistence: {
      load: () => secretFile.load(),
      save: (rows) => secretFile.save(rows),
    },
  })

  const credentials = api.createCredentialStore({ keychain, log })
  const entry = api.createCredentialEntry({ store: credentials, log })
  const guard = api.createEgressGuard({ resolve: api.systemResolve, log })
  const transport = api.createGuardedTransport(guard, () => false)

  const scopeRef = {
    current: { serverHost: 'desktop.eval', userId: 1 },
  }

  const service = api.createProviderSettingsService({
    transport,
    credentials,
    entry,
    scope: () => scopeRef.current,
    log,
  })

  return { service, log, warnings }
}

function configureProvider (api, service, options, apiKey) {
  const preset = api.findPreset(options.preset)
  if (preset === null || preset === undefined) {
    throw new Error(`unknown preset: ${options.preset}`)
  }

  const modelId = options.model ?? preset.defaultModel ?? null

  try {
    service.saveProvider(preset.id, preset.baseUrl, modelId ?? '')
  } catch (error) {
    throw new Error(`the provider entry was refused: ${failureToken(error)}`)
  }

  /*
   * The key crosses into the app here and nowhere else. `saveCredential` binds the
   * submission to the account that asked for the challenge, so this is the same
   * door the Models screen knocks on, not a shortcut behind it. A refusal is a
   * fixed word, never the secret and never a hash of it.
   */
  const challenge = service.beginCredential(preset.id)
  let saved
  try {
    saved = service.saveCredential(preset.id, challenge.nonce, apiKey)
  } catch (error) {
    throw new Error(`the key was not accepted by the credential boundary: ${failureToken(error)}`)
  }

  if (typeof saved?.fingerprint !== 'string') {
    throw new Error('the credential boundary accepted the key but returned no fingerprint')
  }

  const routed = service.openProvider(preset.id, modelId)
  return { preset, modelId, routed, cloud: routed.cloud }
}

/** A fixed failure word from the error, never the message and never the secret. */
function failureToken (error) {
  if (error && typeof error === 'object' && typeof error.failure === 'string') return error.failure
  if (error && typeof error === 'object' && typeof error.name === 'string') return error.name
  return 'unknown'
}

/* ------------------------------------------------------------------ *
 * Repositories
 * ------------------------------------------------------------------ */

/**
 * The two stores an evaluation case touches, made fresh every time.
 *
 * These are the narrowest fakes that satisfy the real apply functions: the point
 * of the run is the model and the rules, and the SQLite repositories already have
 * their own tests. Being plain arrays is also what makes the isolation claim
 * checkable - there is no connection, cache or prepared statement to share.
 */
function freshRepositories () {
  const memoryRows = []
  const removedRows = []
  const proposalRows = []
  const additions = []

  return {
    memory: {
      list: () => memoryRows.slice(),
      listRemoved: () => removedRows.slice(),
      add: (scope, item) => {
        const row = {
          id: `memory-${memoryRows.length + 1}`,
          kind: item.kind,
          text: item.text,
          sourceMessageId: item.sourceMessageId ?? null,
          removedAt: null,
        }
        memoryRows.push(row)
        additions.push(row)
        return row
      },
      __seed: (text, kind = 'fact') => memoryRows.push({ id: `seed-${memoryRows.length + 1}`, kind, text, sourceMessageId: null, removedAt: null }),
      __remove: (text) => {
        const index = memoryRows.findIndex((row) => row.text === text)
        if (index >= 0) removedRows.push(...memoryRows.splice(index, 1))
      },
      __rows: () => memoryRows.slice(),
    },
    proposals: {
      list: (scope, query = {}) => proposalRows.filter((row) => query.status === undefined || row.status === query.status).slice(),
      create: (scope, input) => {
        const row = {
          id: `proposal-${proposalRows.length + 1}`,
          kind: input.kind,
          title: input.title,
          payload: input.payload,
          threadId: input.threadId ?? null,
          status: 'pending',
        }
        proposalRows.push(row)
        return row
      },
      __rows: () => proposalRows.slice(),
    },
  }
}

/** Card text as the person reads it: title, notes and due hint together. */
function proposalText (row) {
  return [row.title, row.payload?.notes ?? '', row.payload?.dueHint ?? '']
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join(' | ')
}

function draftingRows (repositories) {
  return repositories.proposals.__rows().map((row) => ({
    id: row.id,
    title: row.title,
    text: proposalText(row),
    dueHint: typeof row.payload?.dueHint === 'string' ? row.payload.dueHint : null,
  }))
}

function memoryRows (repositories) {
  return repositories.memory.__rows()
    .filter((row) => !String(row.text).startsWith(CANARY_PREFIX))
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      text: row.text,
    }))
}

/* ------------------------------------------------------------------ *
 * One case
 * ------------------------------------------------------------------ */

function chatMessage (role, text) {
  return { role, parts: [{ type: 'text', text }] }
}

function classifyFailure (api, error) {
  if (api.isAbortError(error)) return { status: 'timeout', detail: 'aborted' }
  if (error instanceof api.ProviderError) {
    if (error.failure === 'schema_mismatch') {
      return { status: 'invalid_shape', detail: error.failure }
    }
    return { status: 'error', detail: error.failure }
  }
  if (error instanceof api.EgressBlockedError) {
    return { status: 'error', detail: 'egress_blocked' }
  }
  if (error instanceof api.EgressTransportError) {
    return { status: 'error', detail: 'transport' }
  }
  return { status: 'error', detail: String(error && error.message ? error.message : error).slice(0, 200) }
}

async function runMemoryCase (api, context, caseDef) {
  const { routed, scope, repositories, timeoutMs } = context
  const identity = {}

  const batch = caseDef.exchange.map((message, index) => ({
    id: `message-${index + 1}`,
    threadId: 'thread-eval',
    seq: index + 1,
    role: message.role,
    content: message.content,
  }))

  const conversation = [chatMessage('user', api.numberedBatch(batch).join('\n'))]
  const sendable = api.recallConversation(conversation, routed, identity)

  if (sendable === null) {
    const blocked = caseDef.expect.preSendBlocked !== undefined
    return {
      status: blocked ? 'pass' : 'blocked_unexpected',
      evidence: 'blocked_before_send',
      checks: [{
        label: blocked
          ? 'the exchange is refused before it is sent to a cloud model'
          : 'the exchange was refused before sending, which this case did not expect',
        ok: blocked,
      }],
      failed: blocked ? [] : ['unexpected privacy block'],
      answer: null,
      apply: null,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('evaluation timeout')), timeoutMs)
  let answer
  try {
    answer = await api.askStructured({
      routed,
      ctx: api.createCallContext({
        businessId: 1,
        providerId: routed.provider.id,
        userId: scope.userId,
        purpose: 'quick',
        unredactedContent: !routed.cloud,
      }, controller.signal),
      system: api.EXTRACTION_PROMPT,
      conversation: sendable,
    }, api.extractedMemorySchema)
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: 'timeout', evidence: 'turn', checks: [], failed: ['no answer within the timeout'], answer: null, apply: null }
    }
    const failure = classifyFailure(api, error)
    return { status: failure.status, evidence: 'turn', detail: failure.detail, checks: [], failed: [failure.detail], answer: null, apply: null }
  } finally {
    clearTimeout(timer)
  }

  const apply = api.applyExtraction(repositories, scope, batch, answer)
  const stored = memoryRows(repositories)
  const judged = judgeMemory(caseDef.expect, stored, { applyResult: apply })

  return {
    status: judged.verdict === 'pass' ? 'pass' : 'fail',
    evidence: judged.evidence,
    checks: judged.checks,
    failed: judged.failed ?? [],
    answer: answer.items,
    apply,
    stored,
  }
}

async function runDraftingCase (api, context, caseDef) {
  const { routed, scope, threadId, repositories, timeoutMs } = context
  const identity = {}

  const conversation = [chatMessage('user', caseDef.message)]
  const sendable = api.recallConversation(conversation, routed, identity)

  if (sendable === null) {
    const blocked = caseDef.expect.preSendBlocked !== undefined
    return {
      status: blocked ? 'pass' : 'blocked_unexpected',
      evidence: 'blocked_before_send',
      checks: [{
        label: blocked
          ? 'the message is refused before it is sent to a cloud model'
          : 'the message was refused before sending, which this case did not expect',
        ok: blocked,
      }],
      failed: blocked ? [] : ['unexpected privacy block'],
      answer: null,
      apply: null,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('evaluation timeout')), timeoutMs)
  let answer
  try {
    answer = await api.askStructured({
      routed,
      ctx: api.createCallContext({
        businessId: 1,
        providerId: routed.provider.id,
        userId: scope.userId,
        purpose: 'quick',
        unredactedContent: !routed.cloud,
      }, controller.signal),
      system: api.DRAFTING_PROMPT,
      conversation: sendable,
    }, api.draftedTasksSchema)
  } catch (error) {
    if (controller.signal.aborted) {
      return { status: 'timeout', evidence: 'turn', checks: [], failed: ['no answer within the timeout'], answer: null, apply: null }
    }
    const failure = classifyFailure(api, error)
    return { status: failure.status, evidence: 'turn', detail: failure.detail, checks: [], failed: [failure.detail], answer: null, apply: null }
  } finally {
    clearTimeout(timer)
  }

  const apply = api.applyProposals(repositories, scope, threadId, answer, 'user_message')
  const rows = draftingRows(repositories)
  const judged = judgeDrafting(caseDef.expect, rows)

  return {
    status: judged.verdict === 'pass' ? 'pass' : 'fail',
    evidence: judged.evidence,
    checks: judged.checks,
    failed: judged.failed ?? [],
    answer: answer.tasks,
    apply,
    stored: rows,
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * The isolation guarantee, asserted rather than described.
 *
 * The canary is written into a case's store only AFTER it has been judged, and the
 * next case's store is checked for it before it is used. Salting the store that is
 * about to be judged would put a row in front of the judge that no model wrote,
 * which is how a correct empty answer turns into a failure - so the canary lands
 * behind every case, never in front of one.
 */
function isolationProbe (state, repositories, caseId) {
  const rows = repositories.memory.list({})
  const leaked = rows.filter((row) => String(row.text).startsWith(CANARY_PREFIX))

  state.checks += 1
  if (leaked.length > 0) {
    state.failures.push({ caseId, reason: 'a previous case\'s canary reached this case' })
  }
  if (state.repositories.has(repositories)) {
    state.failures.push({ caseId, reason: 'the same repository object was reused' })
  }
  state.repositories.add(repositories)

  if (state.previous !== null) {
    state.previous.repositories.memory.__seed(`${CANARY_PREFIX}${state.previous.caseId}`, 'fact')
  }
  state.previous = { repositories, caseId }
}

function newIsolationState () {
  return { checks: 0, failures: [], previous: null, repositories: new WeakSet() }
}

async function runSet (api, context, set, runner, isolation, options) {
  const cases = options.limit === null ? set.cases : set.cases.slice(0, options.limit)
  const results = []

  for (const caseDef of cases) {
    const repositories = freshRepositories()
    isolationProbe(isolation, repositories, caseDef.id)

    const caseContext = {
      ...context,
      repositories,
      scope: context.scope,
      threadId: 'thread-eval',
    }

    const startedAt = Date.now()
    let outcome
    try {
      outcome = await runner(api, caseContext, caseDef)
    } catch (error) {
      const failure = classifyFailure(api, error)
      outcome = {
        status: failure.status,
        evidence: 'harness',
        detail: failure.detail,
        checks: [],
        failed: [`the harness could not finish this case: ${failure.detail}`],
        answer: null,
        apply: null,
      }
    }
    const durationMs = Date.now() - startedAt

    const record = {
      id: caseDef.id,
      title: caseDef.title,
      origin: caseDef.origin ?? null,
      status: outcome.status,
      evidence: outcome.evidence ?? null,
      detail: outcome.detail ?? null,
      durationMs,
      failed: outcome.failed ?? [],
      checks: outcome.checks ?? [],
      answer: outcome.answer ?? null,
      apply: outcome.apply ?? null,
      stored: outcome.stored ?? null,
    }

    if (set.feature === 'task_drafting') {
      const actual = api.DRAFT_CUE.test(caseDef.message)
      const expected = caseDef.reach === 'should-draft'
      record.reach = { expected, actual, ok: expected === actual }
    }

    results.push(record)
    process.stdout.write(progressLine(record))
  }

  return results
}

function progressLine (record) {
  const mark = {
    pass: 'ok  ',
    fail: 'FAIL',
    timeout: 'TIME',
    error: 'ERR ',
    invalid_shape: 'SHAPE',
    blocked_unexpected: 'BLOCK',
  }[record.status] ?? '????'
  return `${mark} ${record.id.padEnd(10)} ${record.durationMs.toString().padStart(6)}ms  ${record.title}\n`
}

function tally (results) {
  const counts = {
    pass: 0,
    fail: 0,
    timeout: 0,
    error: 0,
    invalid_shape: 0,
    blocked_unexpected: 0,
    blocked_before_send: 0,
  }

  for (const result of results) {
    if (result.status === 'pass' && result.evidence === 'blocked_before_send') {
      counts.blocked_before_send += 1
      continue
    }
    counts[result.status] = (counts[result.status] ?? 0) + 1
  }

  const judged = counts.pass + counts.fail
  return {
    ...counts,
    total: results.length,
    judged,
    passRate: judged === 0 ? null : Number((counts.pass / judged).toFixed(3)),
  }
}

function reachTally (results) {
  const withReach = results.filter((result) => result.reach !== undefined)
  const shouldDraft = withReach.filter((result) => result.reach.expected)
  const mismatches = withReach.filter((result) => !result.reach.ok)
  return {
    checked: withReach.length,
    shouldDraft: shouldDraft.length,
    reached: shouldDraft.filter((result) => result.reach.actual).length,
    mismatches: mismatches.map((result) => ({
      id: result.id,
      expected: result.reach.expected ? 'should-draft' : 'should-stay-silent',
      actual: result.reach.actual ? 'drafts' : 'silent',
    })),
  }
}

function summariseFailures (results) {
  return results
    .filter((result) => result.status === 'fail')
    .slice(0, 40)
    .map((result) => ({
      id: result.id,
      title: result.title,
      failed: result.failed,
      answer: result.answer,
      stored: result.stored,
    }))
}

function writeReports (outDir, payload, secret) {
  const jsonPath = path.join(outDir, 'results.json')
  const summaryPath = path.join(outDir, 'summary.md')

  const lines = []
  lines.push('# Evaluation run')
  lines.push('')
  lines.push(`Run: ${payload.runId}`)
  lines.push(`Started: ${payload.startedAt}`)
  lines.push(`Preset: ${payload.provider.presetId}`)
  lines.push(`Model: ${payload.provider.modelId ?? 'preset default'}`)
  lines.push(`Cloud: ${payload.provider.cloud ? 'yes' : 'no'}`)
  lines.push(`Per-case timeout: ${payload.provider.timeoutMs} ms`)
  lines.push(`Credential path: ${payload.provider.credentialPath}`)
  if (payload.note !== null) lines.push(`Note: ${payload.note}`)
  lines.push('')

  for (const set of payload.sets) {
    lines.push(`## ${set.feature} (${set.promptConstant})`)
    lines.push('')
    const counts = set.counts
    lines.push(`Cases: ${counts.total}. Judged on content: ${counts.judged}. Passed: ${counts.pass}. Failed: ${counts.fail}.`)
    lines.push(`Failed turns: timeout ${counts.timeout}, error ${counts.error}, invalid shape ${counts.invalid_shape}.`)
    lines.push(`Refused before send: ${counts.blocked_before_send}. Unexpected privacy block: ${counts.blocked_unexpected}.`)
    if (counts.passRate !== null) lines.push(`Pass rate over judged cases: ${(counts.passRate * 100).toFixed(1)} percent.`)
    if (set.reach !== undefined) {
      lines.push(`Drafting trigger: reached ${set.reach.reached} of the ${set.reach.shouldDraft} messages that ask for work, out of ${set.reach.checked} cases.`)
      for (const mismatch of set.reach.mismatches) {
        lines.push(`  - ${mismatch.id}: expected ${mismatch.expected}, the trigger was ${mismatch.actual}.`)
      }
    }
    lines.push('')

    lines.push('| Case | Verdict | Title |')
    lines.push('| --- | --- | --- |')
    for (const result of set.results) {
      const verdict = result.evidence === 'blocked_before_send' && result.status === 'pass'
        ? 'pass (refused before send)'
        : result.status
      lines.push(`| ${result.id} | ${verdict} | ${result.title} |`)
    }
    lines.push('')

    if (set.failures.length > 0) {
      lines.push('### Failures in detail')
      lines.push('')
      for (const failure of set.failures) {
        lines.push(`- ${failure.id}: ${failure.title}`)
        lines.push(`  - unmet: ${failure.failed.join('; ')}`)
        lines.push(`  - answer: ${JSON.stringify(failure.answer)}`)
        lines.push(`  - stored: ${JSON.stringify(failure.stored)}`)
      }
      lines.push('')
    }
  }

  lines.push('## Isolation')
  lines.push('')
  lines.push(`Checks: ${payload.isolation.checks}. Failures: ${payload.isolation.failures.length}.`)
  if (payload.isolation.failures.length > 0) {
    for (const failure of payload.isolation.failures) {
      lines.push(`- ${failure.caseId}: ${failure.reason}`)
    }
  }
  lines.push('')

  const reports = [
    { path: jsonPath, text: JSON.stringify(payload, null, 2) },
    { path: summaryPath, text: lines.join('\n') },
  ]

  // Checked before either reaches the disk: see assertNoSecret for why one file at a
  // time was not enough.
  assertNoSecret(reports, secret)

  fs.mkdirSync(outDir, { recursive: true })
  for (const report of reports) fs.writeFileSync(report.path, report.text, 'utf8')

  return { jsonPath, summaryPath }
}

/**
 * The run must not leave the key on disk in its own output.
 *
 * This is a check rather than a promise because the results contain model answers,
 * and an answer that quoted the key would otherwise be written out and committed
 * by whoever picks the directory up next.
 *
 * The finished reports are handed here in memory, before either is written, and both
 * are judged before any decision is acted on. Reading the files back one at a time
 * was not enough: a key that appeared in both reports deleted the first file and then
 * threw, leaving the second one on disk holding the key in plain text.
 */
function assertNoSecret (reports, secret) {
  const offender = reports.find((report) => report.text.includes(secret))
  if (offender === undefined) return

  // Nothing from this run has been written yet, so there is nothing of ours to
  // remove - but a directory left by an earlier run may still hold the key.
  for (const report of reports) fs.rmSync(report.path, { force: true })
  throw new Error(`the run's own output would have contained the key; ${offender.path} was not written`)
}

async function main () {
  const options = parseArguments(process.argv.slice(2))
  const api = loadBundle()

  const secret = process.env[options.keyEnv]
  if (typeof secret !== 'string' || secret.trim().length < 8) {
    throw new Error(
      `no key found in ${options.keyEnv}\n` +
      'the key is supplied for this run only, through the environment; it is never read from a file',
    )
  }

  const runId = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${options.preset}`
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-eval-secrets-'))
  const outDir = options.out === null
    ? path.join(REPO_ROOT, '.tmp-zuricopilot-eval', runId)
    : path.resolve(options.out)

  const harness = createHarness(api, options, scratchRoot)

  let provider
  try {
    provider = configureProvider(api, harness.service, options, secret)
  } catch (error) {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
    throw error
  }

  // The key has done its job and is no longer needed in this process.
  delete process.env[options.keyEnv]

  const scope = {
    serverHost: 'desktop.eval',
    userId: 1,
    businessId: 1,
    remoteWorkspaceId: null,
  }

  const setsToRun = []
  if (options.feature === 'memory' || options.feature === 'both') {
    setsToRun.push({ module: require('./memory-extraction-cases.js'), runner: runMemoryCase })
  }
  if (options.feature === 'drafting' || options.feature === 'both') {
    setsToRun.push({ module: require('./drafting-cases.js'), runner: runDraftingCase })
  }

  const startedAt = new Date().toISOString()
  const isolation = newIsolationState()
  const setPayloads = []

  try {
    for (const entry of setsToRun) {
      process.stdout.write(`\n${entry.module.feature}: ${entry.module.cases.length} cases\n`)

      const results = await runSet(
        api,
        { routed: provider.routed, scope, timeoutMs: options.timeout },
        entry.module,
        entry.runner,
        isolation,
        options,
      )

      setPayloads.push({
        feature: entry.module.feature,
        promptConstant: entry.module.promptConstant,
        cases: entry.module.cases.length,
        counts: tally(results),
        reach: entry.module.feature === 'task_drafting' ? reachTally(results) : undefined,
        failures: summariseFailures(results),
        results,
      })

      // A rejected key or an unreachable provider makes the rest of the run
      // pointless and expensive; stop at the first case that proves it.
      const first = results[0]
      if (first !== undefined && first.status === 'error' && first.detail === 'provider_unauthorized') {
        process.stdout.write('\nthe provider rejected the key; stopping before spending more calls\n')
        break
      }
    }
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  }

  const payload = {
    runId,
    startedAt,
    note: options.note,
    provider: {
      presetId: provider.preset.id,
      modelId: provider.modelId,
      cloud: provider.cloud,
      timeoutMs: options.timeout,
      credentialPath: 'credential entry challenge -> credential store -> keychain -> provider service -> guarded transport',
    },
    warnings: harness.warnings.slice(0, 20),
    isolation: { checks: isolation.checks, failures: isolation.failures },
    sets: setPayloads,
  }

  const paths = writeReports(outDir, payload, secret)

  process.stdout.write('\n')
  for (const set of setPayloads) {
    const counts = set.counts
    process.stdout.write(
      `${set.feature}: ${counts.pass}/${counts.judged} judged cases passed` +
      ` (fail ${counts.fail}, timeout ${counts.timeout}, error ${counts.error}, invalid shape ${counts.invalid_shape},` +
      ` refused before send ${counts.blocked_before_send})\n`,
    )
  }
  process.stdout.write(`isolation: ${isolation.checks} checks, ${isolation.failures.length} failures\n`)
  process.stdout.write(`results: ${paths.jsonPath}\nsummary: ${paths.summaryPath}\n`)
}

// The report check is tested directly, so the file has to be loadable without
// starting a paid run.
if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`evaluation failed: ${error && error.message ? error.message : error}\n`)
    process.exitCode = 1
  })
}

module.exports = { assertNoSecret, writeReports }
