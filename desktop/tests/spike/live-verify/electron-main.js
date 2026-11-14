'use strict'

/*
 * Live verification entry for the Phase 0 spike.
 *
 * This is a separate Electron entry point, not a production mode: it exists so
 * one real run can answer, with evidence, the three questions the phase has to
 * settle before anything is built on the sidecar design:
 *
 *   1. Does the main process reach the signed-in user's data over the exact
 *      session object the web view uses (persist:ws)?
 *   2. Can it create a uniquely marked throwaway task and permanently delete it,
 *      with the CSRF token taken from that session's cookie jar?
 *   3. With no session, do both probes refuse with not_signed_in and attempt no
 *      write at all?
 *
 * Two deliberate choices about ordering:
 *
 * - The signed-out probes run first, on the partition before any page loads.
 *   That is the only moment the jar is provably empty, and it means the same
 *   session object later flips from refused to authorised. A second partition
 *   would prove less.
 * - The run gets its own userData directory, so a developer's real desktop
 *   session can never satisfy the check by accident. The partition name stays
 *   persist:ws inside that directory, which is the thing under test.
 *
 * Every request the probes make is recorded through a wrapper around the real
 * session's fetch, then reduced by ./sanitize.js. The run refuses to write
 * evidence that contains a cookie value, CSRF token or password.
 */

const { app, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const { SESSION_PARTITION, resolveServerConfig, createWorkSpaceWindow } = require('../../../electron/windows.js')
const { createWorkspaceProbe, WORKSPACE_PARTITION } = require('../../../features/copilot/main/workspace-api/index.js')
const { MARKER_PREFIX } = require('../../../features/copilot/main/workspace-api/probe.js')
const {
  describeCookies,
  findLeakedSecrets,
  sanitizeHeaders,
  sanitizePath,
  sanitizeRequestBody,
} = require('./sanitize.js')

const SIGN_IN_POLL_MS = 500
// The first dev-server load transforms the whole module graph, which is slower
// than every later load; a short cap here would report a working app as missing.
const PAGE_READY_TIMEOUT_MS = 120000
const RUN_TIMEOUT_SLACK_MS = 120000
const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_SETUP = 2

// One place for the run's mutable state so a crash path can still write what it has.
const run = {
  evidencePath: null,
  origin: null,
  workspaceId: null,
  signInMode: 'manual',
  signInTimeoutMs: 180000,
  requests: [],
  pageConsole: [],
  step: 'setup',
  finished: false,
  timer: null,
}

function log (line) {
  process.stdout.write(`live-verify: ${line}\n`)
}

function logError (line) {
  process.stderr.write(`live-verify: ${line}\n`)
}

function parseArgs (argv) {
  const args = {}
  for (const entry of argv) {
    if (!entry.startsWith('--')) continue
    const separator = entry.indexOf('=')
    if (separator === -1) continue
    args[entry.slice(2, separator)] = entry.slice(separator + 1)
  }
  return args
}

function positiveInt (value) {
  const parsed = Number.parseInt(String(value == null ? '' : value), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function writeEvidence (record) {
  const target = run.evidencePath
  if (!target) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  fs.renameSync(temporary, target)
}

/**
 * Write the run record, but only after proving it carries no secret.
 *
 * If a secret did reach the record, the record itself is discarded rather than
 * written: a filename in a report is worth less than a token on disk.
 */
function writeSafeEvidence (record) {
  const text = JSON.stringify(record, null, 2)
  const secrets = [
    { label: 'password', value: process.env.LIVE_VERIFY_PASSWORD },
    ...run.cookieValues.map(cookie => ({ label: `cookie:${cookie.name}`, value: cookie.value })),
  ]
  const leaked = findLeakedSecrets(text, secrets)
  const checked = { ...record, secretsCheck: { checked: true, leaked } }
  if (leaked.length > 0) {
    writeEvidence({
      schemaVersion: 1,
      mode: 'live',
      generatedAt: new Date().toISOString(),
      origin: run.origin,
      error: 'evidence_withheld',
      secretsCheck: { checked: true, leaked },
    })
    logError(`evidence withheld, secret labels present: ${leaked.join(', ')}`)
    return false
  }
  writeEvidence(checked)
  return true
}

function finish (code) {
  if (run.finished) return
  run.finished = true
  if (run.timer) clearTimeout(run.timer)
  app.exit(code)
}

function evidenceShell (errorCode) {
  return {
    schemaVersion: 1,
    mode: 'live',
    generatedAt: new Date().toISOString(),
    electronVersion: process.versions.electron,
    origin: run.origin,
    partition: WORKSPACE_PARTITION,
    userDataIsolated: true,
    userDataDirectory: run.userDataDirectory ? path.basename(run.userDataDirectory) : null,
    signIn: {
      requested: run.signInMode,
      used: null,
      manual: run.signInMode === 'manual',
      waitedMs: null,
      sessionCookieObserved: false,
      sameSessionAsWebView: false,
      sessionCookieNames: [],
      jarBeforeProbe: { count: null, names: [] },
      jarAfterSignIn: { count: null, names: [] },
      formFilled: false,
      error: errorCode || null,
    },
    signedOut: null,
    read: null,
    write: null,
    requests: run.requests,
    markerPrefix: MARKER_PREFIX,
    error: errorCode || null,
  }
}

/** Wait for a condition without a fixed sleep per attempt growing unbounded. */
async function pollUntil (check, timeoutMs, intervalMs = SIGN_IN_POLL_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

function readCookieValues (cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter(cookie => cookie && typeof cookie.value === 'string' && cookie.value.length > 0)
    .map(cookie => ({ name: String(cookie.name), value: cookie.value }))
}

/**
 * Fills the real login form and submits it, rather than injecting a session.
 *
 * The native value setter is required: React tracks the previous value on the
 * DOM node, so assigning `el.value` directly leaves the component state empty
 * and the form posts nothing.
 */
function fillSignInFormScript (email, password) {
  return `(() => {
    const emailInput = document.querySelector('input[name="email"]')
    const passwordInput = document.querySelector('input[name="password"]')
    if (!emailInput || !passwordInput) return 'form_not_ready'
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setValue(emailInput, ${JSON.stringify(email)})
    setValue(passwordInput, ${JSON.stringify(password)})
    const form = emailInput.closest('form')
    const submit = form ? form.querySelector('button[type="submit"]') : null
    if (!submit) return 'submit_not_found'
    submit.click()
    return 'submitted'
  })()`
}

async function waitForForm (contents) {
  return pollUntil(async () => {
    try {
      return await contents.executeJavaScript(
        'Boolean(document.querySelector(\'input[name="email"]\') && document.querySelector(\'input[name="password"]\'))'
      )
    } catch {
      return false
    }
  }, PAGE_READY_TIMEOUT_MS)
}

/**
 * What the web view was showing when the form was not found. Counts and short
 * labels only: the page can hold the seeded email once someone has typed it.
 */
async function pageDiagnostics (contents) {
  const script = `(() => ({
    readyState: document.readyState,
    title: document.title.slice(0, 80),
    url: location.pathname,
    rootChildren: document.getElementById('root') ? document.getElementById('root').children.length : -1,
    inputNames: Array.from(document.querySelectorAll('input')).slice(0, 12).map(input => input.name || input.type || 'unnamed'),
    buttonLabels: Array.from(document.querySelectorAll('button')).slice(0, 12).map(button => (button.textContent || '').trim().slice(0, 40)),
    heading: (document.querySelector('h1, h2') || { textContent: '' }).textContent.trim().slice(0, 80),
    bodyTextLength: document.body ? document.body.innerText.length : -1
  }))()`
  try {
    return await contents.executeJavaScript(script)
  } catch (error) {
    return { error: 'diagnostics_failed', detail: String(error && error.message ? error.message : error).slice(0, 120) }
  }
}

async function captureWindow (contents, evidencePath, name) {
  if (!evidencePath) return null
  try {
    const image = await contents.capturePage()
    const target = path.join(path.dirname(evidencePath), name)
    fs.writeFileSync(target, image.toPNG())
    return path.basename(target)
  } catch {
    return null
  }
}

async function signInThroughForm (contents) {
  const email = String(process.env.LIVE_VERIFY_EMAIL || '')
  const password = String(process.env.LIVE_VERIFY_PASSWORD || '')
  if (email === '' || password === '') return { formFilled: false, error: 'missing_credentials' }

  const ready = await waitForForm(contents)
  if (!ready) {
    return {
      formFilled: false,
      error: 'sign_in_form_not_found',
      diagnostics: await pageDiagnostics(contents),
      screenshot: await captureWindow(contents, run.evidencePath, 'sign-in-window.png'),
    }
  }

  let outcome
  try {
    outcome = await contents.executeJavaScript(fillSignInFormScript(email, password), true)
  } catch {
    return { formFilled: false, error: 'sign_in_script_failed' }
  }
  if (outcome !== 'submitted') {
    return {
      formFilled: false,
      error: String(outcome),
      diagnostics: await pageDiagnostics(contents),
      screenshot: await captureWindow(contents, run.evidencePath, 'sign-in-window.png'),
    }
  }
  return { formFilled: true, error: null }
}

/**
 * Wrap the real session's fetch with a recorder.
 *
 * The wrapper forwards to `webSession.fetch` itself, so Chromium still attaches
 * the session cookie from the jar; the recorder sees only what the client code
 * passed. That is exactly the header set the report has to list.
 */
function observedSession (webSession) {
  return {
    cookies: webSession.cookies,
    fetch: async (url, options = {}) => {
      const record = {
        step: run.step,
        method: String(options.method || 'GET').toUpperCase(),
        path: sanitizePath(url),
        headers: sanitizeHeaders(options.headers || {}),
        body: sanitizeRequestBody(options.body, { markerPrefix: MARKER_PREFIX }),
        status: null,
        durationMs: null,
      }
      const started = Date.now()
      try {
        const response = await webSession.fetch(url, options)
        record.status = response.status
        record.durationMs = Date.now() - started
        run.requests.push(record)
        return response
      } catch (error) {
        record.durationMs = Date.now() - started
        record.error = 'fetch_failed'
        run.requests.push(record)
        throw error
      }
    },
  }
}

function writeRequestCount (step) {
  return run.requests.filter(
    record => record.step === step && record.method === 'POST' && record.path.includes('/tasks/')
  ).length
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  run.origin = String(args.origin || '')
  run.workspaceId = positiveInt(args['workspace-id'])
  run.evidencePath = args.evidence ? path.resolve(String(args.evidence)) : null
  run.signInMode = args['sign-in'] === 'form' ? 'form' : 'manual'
  run.signInTimeoutMs = positiveInt(args['sign-in-timeout-ms']) || 180000

  if (run.origin === '' || !run.workspaceId || !run.evidencePath) {
    logError('usage: electron electron-main.js --origin=<url> --workspace-id=<int> --evidence=<path> [--sign-in=manual|form]')
    return EXIT_SETUP
  }

  // The production config resolver is the thing being exercised, so give it the
  // same environment variable the app uses rather than a parallel code path.
  process.env.WORKSPACE_SERVER_URL = run.origin
  let config
  try {
    config = resolveServerConfig()
  } catch (error) {
    logError(`server config refused: ${error && error.code ? error.code : 'invalid'}`)
    return EXIT_SETUP
  }

  const evidence = evidenceShell(null)
  const webSession = session.fromPartition(SESSION_PARTITION)

  // The jar must be empty, or the signed-out proof is worthless.
  const jarBefore = await webSession.cookies.get({})
  evidence.signIn.jarBeforeProbe = describeCookies(jarBefore)

  try {
    run.step = 'signed-out-read'
    const signedOutProbe = createWorkspaceProbe({
      session: observedSession(webSession),
      serverUrl: run.origin,
      workspaceId: run.workspaceId,
    })
    const signedOutRead = await signedOutProbe.run('read')

    run.step = 'signed-out-write'
    const signedOutWrite = await signedOutProbe.run('write')
    const signedOutWrites = writeRequestCount('signed-out-write')

    evidence.signedOut = {
      partition: WORKSPACE_PARTITION,
      cookiesBefore: jarBefore.filter(cookie => cookie && cookie.name === 'sessionid').length,
      jarBefore: describeCookies(jarBefore),
      read: signedOutRead,
      write: signedOutWrite,
      writeRequests: signedOutWrites,
    }
    log(`signed out: read=${signedOutRead.errorCode} write=${signedOutWrite.errorCode} writeRequests=${signedOutWrites}`)

    // Only now load the web view, so the signed-out probes ran on an untouched jar.
    const workSpaceWindow = createWorkSpaceWindow({ config })
    const contents = workSpaceWindow.webContents
    workSpaceWindow.show()

    // Renderer errors are the difference between "the form is slow" and "the
    // app never mounted"; keep a short, bounded copy for the evidence.
    // Electron 45 passes one event object. Declaring extra parameters only
    // triggers the legacy-arguments deprecation warning.
    contents.on('console-message', event => {
      if (run.pageConsole.length >= 40) return
      run.pageConsole.push({
        level: event && event.level !== undefined ? event.level : null,
        message: String(event && event.message !== undefined ? event.message : '').slice(0, 200),
      })
    })

    let loadFailure = null
    contents.once('did-fail-load', (_event, code, description) => {
      loadFailure = `${code}:${description}`
    })

    const sameSession = contents.session === webSession
    evidence.signIn.sameSessionAsWebView = sameSession

    if (run.signInMode === 'form') {
      const form = await signInThroughForm(contents)
      evidence.signIn.formFilled = form.formFilled
      evidence.signIn.error = form.error
      if (form.diagnostics) evidence.signIn.diagnostics = form.diagnostics
      if (form.screenshot) evidence.signIn.screenshot = form.screenshot
      evidence.signIn.console = run.pageConsole
      log(`form sign-in: ${form.formFilled ? 'submitted' : form.error}`)
    } else {
      log(`sign in through the WorkSpace window (up to ${Math.round(run.signInTimeoutMs / 1000)}s)`)
    }

    run.step = 'sign-in'
    const started = Date.now()
    const signedIn = await pollUntil(async () => {
      const cookies = await webSession.cookies.get({ name: 'sessionid' })
      return cookies.length > 0
    }, run.signInTimeoutMs)
    evidence.signIn.waitedMs = Date.now() - started

    if (loadFailure) {
      evidence.error = 'page_load_failed'
      writeSafeEvidence(evidence)
      logError(`page load failed: ${loadFailure}`)
      return EXIT_FAILED
    }
    if (!signedIn) {
      evidence.signIn.error = evidence.signIn.error || 'session_cookie_not_observed'
      if (!evidence.signIn.diagnostics) evidence.signIn.diagnostics = await pageDiagnostics(contents)
      if (!evidence.signIn.screenshot) {
        evidence.signIn.screenshot = await captureWindow(contents, run.evidencePath, 'sign-in-failed-window.png')
      }
      evidence.signIn.console = run.pageConsole
      writeSafeEvidence(evidence)
      logError(`no session cookie within ${run.signInTimeoutMs}ms`)
      return EXIT_FAILED
    }

    const jarAfter = await webSession.cookies.get({})
    run.cookieValues = readCookieValues(jarAfter)
    evidence.signIn.sessionCookieObserved = true
    evidence.signIn.used = run.signInMode
    evidence.signIn.sessionCookieNames = describeCookies(jarAfter).names
    evidence.signIn.jarAfterSignIn = describeCookies(jarAfter)
    evidence.signIn.pagePath = sanitizePath(contents.getURL())
    evidence.signIn.screenshot = await captureWindow(contents, run.evidencePath, 'signed-in-window.png')
    log(`signed in; jar=${describeCookies(jarAfter).names.join(',')}`)

    const probe = createWorkspaceProbe({
      session: observedSession(webSession),
      serverUrl: run.origin,
      workspaceId: run.workspaceId,
    })

    run.step = 'read'
    evidence.read = await probe.run('read')
    log(`read: status=${evidence.read.status} workspaces=${evidence.read.workspaceCount} workspaceId=${evidence.read.workspaceId}`)

    run.step = 'write'
    evidence.write = await probe.run('write')
    log(`write: status=${evidence.write.status} created=${evidence.write.taskCreated} deleted=${evidence.write.taskDeleted}`)

    // Kept for the database cross-check: the title is the only body worth
    // recording, and the sanitiser only keeps it when it carries the marker.
    const createRecord = run.requests.find(
      record => record.step === 'write' && record.method === 'POST' && record.body && record.body.title
    )
    evidence.markerTitle = createRecord ? createRecord.body.title : null

    evidence.signIn.requested = run.signInMode
    const wrote = writeSafeEvidence(evidence)
    if (!wrote) {
      logError('evidence withheld because it contained a secret')
      return EXIT_FAILED
    }
    log(`evidence written: ${path.basename(run.evidencePath)}`)

    const ok =
      evidence.read.status === 'ok' &&
      evidence.write.status === 'ok' &&
      evidence.write.taskCreated === true &&
      evidence.write.taskDeleted === true &&
      evidence.signedOut.read.errorCode === 'not_signed_in' &&
      evidence.signedOut.write.errorCode === 'not_signed_in' &&
      signedOutWrites === 0
    return ok ? EXIT_OK : EXIT_FAILED
  } catch (error) {
    evidence.error = 'unexpected_error'
    evidence.errorDetail = String(error && error.message ? error.message : error).slice(0, 300)
    writeSafeEvidence(evidence)
    logError(`unexpected error: ${evidence.errorDetail}`)
    return EXIT_FAILED
  }
}

// Must run before app is ready: the partition is stored under this directory.
const userDataDirectory = process.env.LIVE_VERIFY_USER_DATA
if (userDataDirectory) {
  fs.mkdirSync(userDataDirectory, { recursive: true })
  app.setPath('userData', path.resolve(userDataDirectory))
  run.userDataDirectory = userDataDirectory
}
run.cookieValues = []

app.on('window-all-closed', () => {
  // The run decides when to exit; a closed window is a failed run, not a quit.
})

app.whenReady().then(async () => {
  // A wedged sign-in or a hung request must still leave evidence behind.
  run.timer = setTimeout(async () => {
    logError('run timed out')
    const evidence = evidenceShell('run_timeout')
    evidence.requests = run.requests
    writeSafeEvidence(evidence)
    finish(EXIT_FAILED)
  }, run.signInTimeoutMs + RUN_TIMEOUT_SLACK_MS)

  let code = EXIT_FAILED
  try {
    code = await main()
  } catch (error) {
    logError(`fatal: ${error && error.message ? error.message : error}`)
  }
  finish(code)
})
