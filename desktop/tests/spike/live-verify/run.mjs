// Drive one live verification run of the Phase 0 desktop spike.
//
// The Electron entry owns the three probes and writes the raw run record. This
// file owns everything around them: the throwaway database, the Django server,
// the Vite proxy, the throwaway account, and the database check before and after
// the probes. It never reuses or stops a server it did not start, and it stops
// every server it did start, on every path.
//
//   node desktop/tests/spike/live-verify/run.mjs --sign-in=manual
//
// Exit codes: 0 all checks passed and Electron exited 0, 1 a check failed,
// 2 the run could not be set up (port busy, migrate failed, no workspace...).

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, openSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allPassed, evaluateLiveRun } from './expectations.js'
import { renderSummary } from './summarize.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// live-verify -> spike -> tests -> desktop -> the repository root.
const ROOT = path.resolve(HERE, '..', '..', '..', '..')

const WEB_PORT = 5183
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`
const DEFAULT_API_PORT = 8099
const DEFAULT_SIGN_IN_TIMEOUT_MS = 180000
const DEFAULT_SERVE_MODE = 'dev'
// A manual run waits for a person, so the cap covers the sign-in timeout plus
// the three probes with room to spare.
const ELECTRON_TIMEOUT_MS = 8 * 60 * 1000
const DJANGO_READY_TIMEOUT_MS = 60000
const VITE_READY_TIMEOUT_MS = 90000

const PYTHON = 'python'

const USAGE = [
  'Usage: node desktop/tests/spike/live-verify/run.mjs [options]',
  '',
  '  --sign-in=manual|form       How the Electron window signs in (default manual)',
  '  --serve=dev|preview         Serve the dev app or the built app (default dev)',
  '  --api-port=<int>            Port for the throwaway Django server (default 8099)',
  '  --sign-in-timeout-ms=<int>  How long Electron waits for a sign-in (default 180000)',
].join('\n')

// Setup problems get a single clear line and exit 2. A thrown anything else is
// reported the same way, so a broken run never looks like a failed check.
class UsageError extends Error {}
class SetupError extends Error {}

function delay (milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/* ------------------------------------------------------------------ args -- */

function parsePositiveInteger (value, label) {
  if (!/^[0-9]+$/.test(value)) {
    throw new UsageError(`--${label} expects a whole number, got '${value}'`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new UsageError(`--${label} expects a number greater than zero, got '${value}'`)
  }
  return number
}

function parseArgs (argv) {
  const options = {
    signIn: 'manual',
    serve: DEFAULT_SERVE_MODE,
    apiPort: DEFAULT_API_PORT,
    signInTimeoutMs: DEFAULT_SIGN_IN_TIMEOUT_MS,
  }

  for (const argument of argv) {
    if (!argument.startsWith('--')) {
      throw new UsageError(`unexpected argument '${argument}'`)
    }
    const separator = argument.indexOf('=')
    if (separator === -1) {
      throw new UsageError(`argument '${argument}' needs a value, written as --key=value`)
    }
    const key = argument.slice(2, separator)
    const value = argument.slice(separator + 1)

    if (key === 'sign-in') {
      if (value !== 'manual' && value !== 'form') {
        throw new UsageError(`--sign-in must be 'manual' or 'form', got '${value}'`)
      }
      options.signIn = value
    } else if (key === 'serve') {
      if (value !== 'dev' && value !== 'preview') {
        throw new UsageError(`--serve must be 'dev' or 'preview', got '${value}'`)
      }
      options.serve = value
    } else if (key === 'api-port') {
      const port = parsePositiveInteger(value, 'api-port')
      if (port > 65535) {
        throw new UsageError(`--api-port must be 65535 or less, got '${value}'`)
      }
      options.apiPort = port
    } else if (key === 'sign-in-timeout-ms') {
      options.signInTimeoutMs = parsePositiveInteger(value, 'sign-in-timeout-ms')
    } else {
      throw new UsageError(`unknown argument '--${key}'`)
    }
  }

  return options
}

/* ----------------------------------------------------------------- ports -- */

function canBind (port, host) {
  return new Promise(resolve => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, host)
  })
}

// Both address families, because Vite binds localhost and a leftover process may
// hold only ::1. A check that passed on IPv4 alone would then start the run
// against a port this run cannot actually have.
async function isPortFree (port) {
  return (await canBind(port, '127.0.0.1')) && (await canBind(port, '::1'))
}

/* ------------------------------------------------------------- processes -- */

const tracked = []

function isRunning (child) {
  return Boolean(child) && Number.isInteger(child.pid) &&
    child.exitCode === null && child.signalCode === null
}

// Only ever called with a process this run spawned. Nothing here looks a port or
// an image name up, so a development server is never a casualty.
function stopProcess (child) {
  if (!isRunning(child)) return

  if (process.platform === 'win32') {
    // Electron leaves renderer and GPU children behind, and a window sitting on
    // a modal ignores a polite signal, so take the tree and force it.
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    if (result.error) {
      console.error(`live-verify: could not stop pid ${child.pid}: ${result.error.message}`)
    }
    return
  }

  try {
    // The child was started detached, so the negative pid reaches its whole
    // process group rather than only the process node spawned.
    process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    console.error(`live-verify: could not stop pid ${child.pid}: ${error.message}`)
  }
}

function stopAllProcesses () {
  for (const entry of tracked) stopProcess(entry.child)
  tracked.length = 0
}

// A server started with its output going to a log file, because a readiness poll
// is a better signal than parsing stdout.
function startProcess (name, command, args, options) {
  const descriptor = openSync(options.logPath, 'a')
  let child
  try {
    child = spawn(command, args, {
      cwd: ROOT,
      env: options.env,
      stdio: ['ignore', descriptor, descriptor],
      shell: options.shell === true,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
  } finally {
    // The child holds its own copy of the descriptor; the parent must not keep
    // the file open, or Windows refuses to remove the run directory later.
    closeSync(descriptor)
  }

  const record = { name, child, spawnError: null }
  // Without this a missing interpreter would surface as a 60 second timeout.
  child.once('error', error => {
    record.spawnError = error
    console.error(`live-verify: ${name} could not start: ${error.message}`)
  })
  tracked.push(record)
  return record
}

async function readLogTail (logPath, lineCount = 10) {
  if (!logPath) return ''
  try {
    const text = await readFile(logPath, 'utf8')
    const tail = text.trimEnd().split('\n').slice(-lineCount).join('\n')
    return tail === '' ? '' : `--- last lines of ${path.basename(logPath)} ---\n${tail}`
  } catch (error) {
    return `--- ${path.basename(logPath)} could not be read: ${error.message} ---`
  }
}

/* ------------------------------------------------------------- readiness -- */

async function waitForServerReady (options) {
  const { url, label, timeoutMs, intervalMs, accept, record, logPath } = options
  const deadline = Date.now() + timeoutMs
  let last = 'no response yet'

  for (;;) {
    if (record && record.spawnError) {
      throw new SetupError(`${label} could not start: ${record.spawnError.message}`)
    }
    if (record && !isRunning(record.child)) {
      const tail = await readLogTail(logPath)
      const ending = record.child.signalCode
        ? `signal ${record.child.signalCode}`
        : `code ${record.child.exitCode}`
      throw new SetupError(
        `${label} exited (${ending}) before it answered ${url}.${tail ? `\n${tail}` : ''}`,
      )
    }

    try {
      const response = await fetch(url)
      if (accept(response)) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error.message
    }

    if (Date.now() >= deadline) {
      const tail = await readLogTail(logPath)
      throw new SetupError(
        `${label} did not answer ${url} within ${timeoutMs}ms (last attempt: ${last}).${tail ? `\n${tail}` : ''}`,
      )
    }
    await delay(intervalMs)
  }
}

/* -------------------------------------------------------------- cookies -- */

function setCookieLines (response) {
  const headers = response.headers
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie()
    if (Array.isArray(lines) && lines.length > 0) return lines
  }
  const combined = headers.get('set-cookie')
  if (!combined) return []
  // An older runtime joins repeated headers with ', '. Split only where a fresh
  // `name=` starts, so the comma inside an Expires date stays put.
  return combined.split(/,\s*(?=[^;,=\s]+=)/)
}

// A jar just big enough for a two-request sign-up: node's fetch stores nothing.
function createCookieJar () {
  const cookies = new Map()

  return {
    absorb (response) {
      for (const line of setCookieLines(response)) {
        const pair = String(line).split(';')[0]
        const separator = pair.indexOf('=')
        if (separator <= 0) continue
        cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim())
      }
    },
    value (name) {
      return cookies.has(name) ? cookies.get(name) : null
    },
  }
}

/* ---------------------------------------------------------------- setup --- */

function formatStamp (date) {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

// DATABASE_URL wins over WORKSPACE_DB_NAME and a set WORKSPACE_DB_NAME flips the
// engine back to Postgres, so both are forced rather than trusted.
function buildDjangoEnv (apiPort, databaseFile) {
  const env = { ...process.env }
  delete env.DATABASE_URL
  env.WORKSPACE_DB_NAME = databaseFile
  env.WORKSPACE_DB_ENGINE = 'django.db.backends.sqlite3'
  env.WORKSPACE_ALLOWED_HOSTS = '127.0.0.1,localhost'
  env.WORKSPACE_CSRF_TRUSTED_ORIGINS = `${WEB_ORIGIN},http://127.0.0.1:${WEB_PORT}`
  env.WORKSPACE_DEBUG = 'true'
  env.WORKSPACE_API_TARGET = `http://127.0.0.1:${apiPort}`
  return env
}

function runMigrate (options) {
  const descriptor = openSync(options.logPath, 'a')
  let result
  try {
    result = spawnSync(PYTHON, ['manage.py', 'migrate', '--noinput'], {
      cwd: ROOT,
      env: options.env,
      stdio: ['ignore', descriptor, descriptor],
    })
  } finally {
    closeSync(descriptor)
  }

  if (result.error) {
    throw new SetupError(`migrate could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new SetupError(`migrate exited ${result.status}; its output is in ${options.logPath}`)
  }
}

async function readJsonBody (response) {
  try {
    return await response.json()
  } catch {
    // A non-JSON body is a status worth reporting on its own; the caller adds it.
    return null
  }
}

function describeApiError (body) {
  const message = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : ''
  return message === '' ? '' : `: ${message}`
}

// The account is created through the real API behind the Vite proxy, so the
// throwaway user goes through exactly the path a visitor does.
async function seedAccount (stamp) {
  const jar = createCookieJar()

  const csrfResponse = await fetch(`${WEB_ORIGIN}/api/auth/csrf/`)
  jar.absorb(csrfResponse)
  if (!csrfResponse.ok) {
    throw new SetupError(`GET /api/auth/csrf/ answered ${csrfResponse.status}`)
  }
  const csrfToken = jar.value('csrftoken')
  if (!csrfToken) {
    throw new SetupError('the API answered /api/auth/csrf/ without a csrftoken cookie')
  }

  const email = `live-verify-${stamp}@example.invalid`
  // Generated per run, handed to Electron through the environment, and never
  // printed or written. Nothing below may quote this value.
  const password = randomBytes(24).toString('base64url')

  const response = await fetch(`${WEB_ORIGIN}/api/auth/me/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Node's fetch keeps no cookie jar, and Django compares the header token
      // with the CSRF cookie on the request. Without this line the POST is a 403.
      'Cookie': `csrftoken=${csrfToken}`,
      'Origin': WEB_ORIGIN,
      'Referer': `${WEB_ORIGIN}/`,
      'X-CSRFToken': csrfToken,
    },
    body: JSON.stringify({ email, password, first_name: 'Live Verify' }),
  })
  const body = await readJsonBody(response)

  if (response.status !== 201) {
    throw new SetupError(`sign-up answered ${response.status}${describeApiError(body)}`)
  }

  const workspaces = body && body.user && Array.isArray(body.user.workspaces) ? body.user.workspaces : []
  const workspaceId = workspaces.length > 0 && Number.isInteger(workspaces[0].id) ? workspaces[0].id : null
  if (workspaceId === null) {
    throw new SetupError('sign-up answered 201 but returned no workspace id')
  }

  return { email, password, status: response.status, workspaceId, workspaceCount: workspaces.length }
}

/* -------------------------------------------------------------- db check -- */

function runDbCheck (options) {
  const args = [
    path.join(HERE, 'db-check.py'),
    '--workspace-id', String(options.workspaceId),
    '--database', options.databaseFile,
  ]
  if (options.markerPrefix) args.push('--marker-prefix', options.markerPrefix)
  if (options.marker) args.push('--marker', options.marker)

  const result = spawnSync(PYTHON, args, { cwd: ROOT, env: options.env, encoding: 'utf8' })
  if (result.error) {
    throw new Error(`db-check.py could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim().split('\n').slice(-3).join(' ')
    throw new Error(`db-check.py exited ${result.status}${detail === '' ? '' : `: ${detail}`}`)
  }

  const lastLine = String(result.stdout || '').trim().split('\n').pop()
  try {
    return JSON.parse(lastLine)
  } catch (error) {
    throw new Error(`db-check.py did not print JSON: ${error.message}`)
  }
}

/* --------------------------------------------------------------- electron -- */

function quoteWindowsArgument (value) {
  return `"${String(value).replace(/"/g, '\\"')}"`
}

// The packaged binary is the normal case; the .bin shim is the fallback when the
// postinstall download left no dist folder.
function resolveElectronCommand () {
  const binary = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
  if (existsSync(binary)) {
    return { command: binary, shell: false, quote: false }
  }
  const shim = path.join(ROOT, 'desktop', 'node_modules', '.bin', 'electron.cmd')
  if (existsSync(shim)) {
    // A .cmd cannot be spawned directly without a shell, and a shell needs each
    // argument quoted by hand or the spaces in the project path split them.
    return { command: shim, shell: true, quote: true }
  }
  return null
}

function closeLogStream (stream) {
  return new Promise(resolve => {
    stream.once('error', () => resolve())
    stream.end(() => resolve())
  })
}

function waitForExit (child) {
  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      resolve(result)
    }
    child.once('exit', (code, signal) => finish({ code, signal }))
    // A process that never starts emits 'error' and no 'exit' at all.
    child.once('error', error => finish({ code: null, signal: null, error }))
  })
}

async function runElectron (context) {
  const electron = resolveElectronCommand()
  if (!electron) {
    throw new SetupError(
      'Electron is not installed; run npm install in desktop/ first (looked for electron.exe ' +
      'and the .bin/electron.cmd shim)',
    )
  }

  const entry = path.join(HERE, 'electron-main.js')
  if (!existsSync(entry)) {
    throw new SetupError(`${path.relative(ROOT, entry)} is missing`)
  }

  const rawPath = path.join(context.runDir, 'electron-raw.json')
  const logPath = path.join(context.runDir, 'electron.log')

  const args = [
    entry,
    `--origin=${WEB_ORIGIN}`,
    `--workspace-id=${context.workspaceId}`,
    `--sign-in=${context.options.signIn}`,
    `--sign-in-timeout-ms=${context.options.signInTimeoutMs}`,
    `--evidence=${rawPath}`,
  ]
  const spawnArgs = electron.quote ? args.map(quoteWindowsArgument) : args

  const env = {
    ...context.env,
    LIVE_VERIFY_EMAIL: context.email,
    LIVE_VERIFY_PASSWORD: context.password,
    LIVE_VERIFY_USER_DATA: path.join(context.runDir, 'electron-user-data'),
    WORKSPACE_SERVER_URL: WEB_ORIGIN,
  }

  const log = createWriteStream(logPath, { flags: 'a' })
  log.on('error', error => {
    console.error(`live-verify: could not write ${path.basename(logPath)}: ${error.message}`)
  })

  const child = spawn(electron.command, spawnArgs, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: electron.shell,
    windowsHide: false,
    detached: process.platform !== 'win32',
  })

  // The run record is written by the entry; this copy exists so a crashed run
  // still has something to read.
  child.stdout.on('data', chunk => {
    log.write(chunk)
    process.stdout.write(chunk)
  })
  child.stderr.on('data', chunk => {
    log.write(chunk)
    process.stderr.write(chunk)
  })

  tracked.push({ name: 'electron', child })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    console.error(`live-verify: Electron did not finish within ${ELECTRON_TIMEOUT_MS}ms; stopping it`)
    stopProcess(child)
  }, ELECTRON_TIMEOUT_MS)

  const exit = await waitForExit(child)
  clearTimeout(timer)
  await closeLogStream(log)

  if (exit.error) {
    throw new SetupError(`Electron could not start: ${exit.error.message}`)
  }
  if (timedOut) {
    console.error(`live-verify: Electron timed out after ${ELECTRON_TIMEOUT_MS}ms`)
  }

  return { rawPath, exitCode: exit.code, timedOut }
}

/* --------------------------------------------------------------- evidence -- */

function findCreatedTaskTitle (requests) {
  const rows = Array.isArray(requests) ? requests : []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.method !== 'POST') continue
    const body = row.body
    if (!body || body.kind !== 'json' || typeof body.title !== 'string') continue
    if (body.title === '') continue
    return body.title
  }
  return null
}

function buildRunInfo (context) {
  return {
    runDir: context.runDir,
    database: context.databaseFile,
    djangoLog: path.join(context.runDir, 'django.log'),
    viteLog: path.join(context.runDir, 'vite.log'),
    electronLog: path.join(context.runDir, 'electron.log'),
    apiPort: context.options.apiPort,
    webPort: WEB_PORT,
    serveMode: context.options.serve,
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
    electronExitCode: context.electronExitCode,
    // A killed Electron still exits with a code; without this a timeout would
    // read like an ordinary crash.
    electronTimedOut: context.electronTimedOut === true,
    signUpStatus: context.signUpStatus,
    workspaceCount: context.workspaceCount,
  }
}

// `checked` is false when either database read failed: a missing check must not
// read as a clean cleanup.
function buildCleanup (context) {
  const before = context.tasksBefore
  const after = context.tasksAfter
  const cleanup = {
    checked: Boolean(before && after),
    markersRemaining: after ? after.markersInWorkspace : null,
    markerFound: after ? after.markerPresent : null,
    tasksBefore: before ? before.tasksInWorkspace : null,
    tasksAfter: after ? after.tasksInWorkspace : null,
    workspaceId: context.workspaceId,
    databaseFile: path.basename(context.databaseFile),
  }
  if (context.afterError) cleanup.error = context.afterError
  return cleanup
}

function withExpectations (record) {
  record.expectations = evaluateLiveRun(record)
  record.passed = allPassed(record.expectations)
  return record
}

function buildEvidence (context, raw) {
  return withExpectations({
    ...raw,
    run: buildRunInfo(context),
    cleanup: buildCleanup(context),
  })
}

// Everything the raw record would have said, with the probes marked as never
// having happened, so the summary still explains the failure.
function buildFailedEvidence (context, reason) {
  return withExpectations({
    schemaVersion: null,
    mode: context.options.signIn,
    generatedAt: new Date().toISOString(),
    electronVersion: null,
    origin: WEB_ORIGIN,
    partition: null,
    userDataIsolated: null,
    signIn: null,
    signedOut: null,
    read: null,
    write: null,
    requests: [],
    secretsCheck: { checked: false, leaked: [] },
    markerPrefix: '',
    run: buildRunInfo(context),
    cleanup: buildCleanup(context),
    failure: reason,
  })
}

async function readRawRecord (rawPath) {
  let text
  try {
    text = await readFile(rawPath, 'utf8')
  } catch (error) {
    return { ok: false, reason: `Electron wrote no readable record at ${rawPath} (${error.message})` }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ok: false, reason: `${path.basename(rawPath)} is not valid JSON (${error.message})` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: `${path.basename(rawPath)} does not contain a JSON object` }
  }
  return { ok: true, raw }
}

async function writeEvidenceFiles (context, record) {
  const evidencePath = path.join(context.runDir, 'evidence.json')
  await writeFile(evidencePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

  let summary = null
  try {
    summary = renderSummary(record)
  } catch (error) {
    console.error(`live-verify: the summary could not be rendered: ${error.message}`)
  }
  if (summary === null) return { evidencePath, summaryPath: null }

  const summaryPath = path.join(context.runDir, 'summary.md')
  await writeFile(summaryPath, summary, 'utf8')
  return { evidencePath, summaryPath }
}

function reportFiles (files) {
  console.log(`live-verify: evidence ${files.evidencePath}`)
  if (files.summaryPath) console.log(`live-verify: summary ${files.summaryPath}`)
}

function reportFailures (record) {
  const failed = (record.expectations || []).filter(entry => entry.pass !== true)
  for (const entry of failed) {
    console.log(`live-verify: FAILED ${entry.id}: ${entry.detail}`)
  }
}

/* ------------------------------------------------------------------ flow -- */

async function runVerification (options) {
  if (process.env.DATABASE_URL) {
    throw new SetupError(
      'DATABASE_URL is set. Unset it: a set DATABASE_URL wins over WORKSPACE_DB_NAME and would ' +
      'point this run at a real database.',
    )
  }

  const occupied = []
  if (!(await isPortFree(WEB_PORT))) occupied.push(WEB_PORT)
  if (!(await isPortFree(options.apiPort))) occupied.push(options.apiPort)
  if (occupied.length > 0) {
    throw new SetupError(
      `port ${occupied.join(' and ')} is already in use. Stop whatever holds it; this harness ` +
      'never reuses or kills a server it did not start.',
    )
  }

  const started = new Date()
  const stamp = formatStamp(started)
  const runDir = path.join(ROOT, '.tmp-phase0', 'live-verify', stamp)
  await mkdir(runDir, { recursive: true })
  const databaseFile = path.join(runDir, 'probe.sqlite3')
  const env = buildDjangoEnv(options.apiPort, databaseFile)

  const context = {
    options,
    runDir,
    databaseFile,
    env,
    startedAt: started.toISOString(),
    signUpStatus: null,
    workspaceId: null,
    workspaceCount: null,
    email: null,
    password: null,
    tasksBefore: null,
    tasksAfter: null,
    afterError: null,
    electronExitCode: null,
    electronTimedOut: false,
  }

  console.log(`live-verify: run directory ${runDir}`)

  const migrateLog = path.join(runDir, 'migrate.log')
  console.log('live-verify: migrating the throwaway database')
  runMigrate({ env, logPath: migrateLog })

  const djangoLog = path.join(runDir, 'django.log')
  console.log(`live-verify: starting Django on 127.0.0.1:${options.apiPort}`)
  const django = startProcess(
    'django',
    PYTHON,
    ['manage.py', 'runserver', `127.0.0.1:${options.apiPort}`, '--noreload'],
    { env, logPath: djangoLog },
  )
  await waitForServerReady({
    url: `http://127.0.0.1:${options.apiPort}/api/auth/csrf/`,
    label: 'the Django API',
    timeoutMs: DJANGO_READY_TIMEOUT_MS,
    intervalMs: 300,
    accept: () => true,
    record: django,
    logPath: djangoLog,
  })

  const viteLog = path.join(runDir, 'vite.log')
  // Preview serves the built app: same origin, same proxy, no dev-only inline
  // preamble. The dev app cannot render in the hardened window while the CSP
  // carries a script hash, because a hash cancels 'unsafe-inline'.
  if (options.serve === 'preview' && !existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new SetupError('dist/index.html is missing for --serve=preview; run npm run build first')
  }
  const viteArgs = [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')]
  if (options.serve === 'preview') {
    viteArgs.push('preview')
  }
  viteArgs.push('--port', String(WEB_PORT), '--strictPort')
  console.log(`live-verify: starting the ${options.serve === 'preview' ? 'built' : 'dev'} app on ${WEB_ORIGIN}`)
  const vite = startProcess(
    'vite',
    process.execPath,
    viteArgs,
    { env, logPath: viteLog },
  )
  await waitForServerReady({
    url: `${WEB_ORIGIN}/`,
    label: 'the app',
    timeoutMs: VITE_READY_TIMEOUT_MS,
    intervalMs: 500,
    accept: response => response.status === 200,
    record: vite,
    logPath: viteLog,
  })

  console.log('live-verify: creating a throwaway account')
  let account
  try {
    account = await seedAccount(stamp)
  } catch (error) {
    if (error instanceof SetupError) throw error
    throw new SetupError(`the throwaway account could not be created: ${error.message}`)
  }
  context.email = account.email
  context.password = account.password
  context.workspaceId = account.workspaceId
  context.workspaceCount = account.workspaceCount
  context.signUpStatus = account.status
  console.log(`live-verify: account ${account.email} owns workspace ${account.workspaceId}`)
  if (options.signIn === 'manual') {
    // A human cannot sign in without credentials, and the account exists only
    // in the throwaway database inside this run directory.
    console.log(`live-verify: throwaway sign-in (manual): ${account.email} / ${account.password}`)
  }

  try {
    context.tasksBefore = runDbCheck({
      env,
      workspaceId: context.workspaceId,
      databaseFile,
    })
  } catch (error) {
    throw new SetupError(`the pre-run database check failed: ${error.message}`)
  }

  console.log(`live-verify: starting Electron (sign-in ${options.signIn})`)
  const electron = await runElectron(context)
  context.electronExitCode = electron.exitCode
  context.electronTimedOut = electron.timedOut
  console.log(`live-verify: Electron exited with code ${electron.exitCode}`)

  const read = await readRawRecord(electron.rawPath)
  if (!read.ok) {
    const record = buildFailedEvidence(context, read.reason)
    const files = await writeEvidenceFiles(context, record)
    console.error(`live-verify: ${read.reason}`)
    reportFiles(files)
    reportFailures(record)
    return 1
  }

  const raw = read.raw
  const markerPrefix = typeof raw.markerPrefix === 'string' ? raw.markerPrefix : ''
  const marker = findCreatedTaskTitle(raw.requests)

  try {
    context.tasksAfter = runDbCheck({
      env,
      workspaceId: context.workspaceId,
      databaseFile,
      markerPrefix,
      marker,
    })
  } catch (error) {
    // The probes have already run. Losing the cleanup read is a failed check,
    // not a reason to throw away the run record.
    context.afterError = error.message
    console.error(`live-verify: the post-run database check failed: ${error.message}`)
  }

  const record = buildEvidence(context, raw)
  const files = await writeEvidenceFiles(context, record)
  reportFiles(files)
  reportFailures(record)

  if (!record.passed) {
    console.log('live-verify: FAIL (see the failed checks above)')
    return 1
  }
  if (electron.exitCode !== 0) {
    console.log(`live-verify: FAIL (Electron exited with code ${electron.exitCode})`)
    return 1
  }

  console.log('live-verify: PASS')
  return 0
}

async function main () {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    console.error(`live-verify: ${error.message}`)
    console.error(USAGE)
    return 2
  }

  try {
    return await runVerification(options)
  } catch (error) {
    if (error instanceof SetupError) {
      console.error(`live-verify: ${error.message}`)
      return 2
    }
    console.error('live-verify: the run stopped on an unexpected error')
    console.error(error && error.stack ? error.stack : String(error))
    return 2
  } finally {
    // The one place servers stop, whatever happened above.
    stopAllProcesses()
  }
}

// Belt for the paths that never reach main's finally: a Ctrl-C, or the process
// dying mid-spawn. A leaked server would hold the port for the next run.
process.on('exit', stopAllProcesses)
process.on('SIGINT', () => {
  stopAllProcesses()
  process.exit(130)
})

main()
  .then(code => {
    process.exitCode = code
  })
  .catch(error => {
    // Only reachable if main itself is broken; it handles its own failures.
    console.error(`live-verify: ${error && error.stack ? error.stack : String(error)}`)
    stopAllProcesses()
    process.exitCode = 2
  })
