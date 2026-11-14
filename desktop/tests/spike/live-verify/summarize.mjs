/*
 * Render one live verification run as Markdown.
 *
 * The evidence file is the durable record, but it is nested JSON: request rows,
 * boolean probes and a long list of acceptance checks. This module turns it into
 * the page a reviewer actually reads: one PASS or FAIL line, the checks, the
 * exact HTTP exchanges, and the three scenarios (signed-out, cleanup, sign-in).
 *
 * The input is treated as untrusted. A missing or half-written evidence file
 * must still render something readable, because a broken run is exactly when the
 * summary is needed. Values were already sanitised on the way into the evidence
 * file; this module only escapes them for Markdown.
 */

const UNKNOWN = 'unknown'
const NOT_RECORDED = 'not recorded'

function isObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asArray (value) {
  return Array.isArray(value) ? value : []
}

function asObject (value) {
  return isObject(value) ? value : {}
}

function isPresent (value) {
  return value !== undefined && value !== null
}

function firstPresent (...values) {
  for (const value of values) {
    if (isPresent(value)) return value
  }
  return null
}

function text (value, fallback = '-') {
  if (!isPresent(value)) return fallback
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value.trim() === '' ? fallback : value
  return fallback
}

function yesNo (value, fallback = UNKNOWN) {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return fallback
}

/*
 * Escape the characters a Markdown renderer would treat as HTML. Without this a
 * sanitised value such as `<redacted>` would disappear into an unknown tag.
 */
function escapeHtml (value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/*
 * One table cell. Newlines become `<br>`, which is how a header list stays one
 * per line inside a cell and still reads correctly as raw Markdown.
 */
function cell (value) {
  const raw = isPresent(value) ? String(value) : ''
  if (raw.trim() === '') return '-'
  return escapeHtml(raw)
    .replace(/\|/g, '\\|')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')
    .trim()
}

function describe (value) {
  if (typeof value === 'string') return escapeHtml(value)
  if (isPresent(value)) {
    try {
      const json = JSON.stringify(value)
      if (typeof json === 'string') return escapeHtml(json)
    } catch {
      // Not serialisable: fall through to String, which cannot throw.
    }
    return escapeHtml(String(value))
  }
  return '-'
}

/* Basename without importing node:path, so this stays pure string handling. */
function basename (value) {
  if (!isPresent(value)) return '-'
  const parts = String(value).split(/[\\/]/).filter(part => part !== '')
  return parts.length === 0 ? '-' : parts[parts.length - 1]
}

function formatDuration (value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : '-'
}

function formatBody (body) {
  if (body === null) return 'null'
  if (!isPresent(body)) return NOT_RECORDED
  try {
    const json = JSON.stringify(body)
    if (typeof json === 'string') return json
  } catch {
    // A body that cannot be serialised is reported as unreadable below.
  }
  return '<unserialisable>'
}

/* One header per line; cell() turns the newlines into <br> in the table. */
function renderHeaders (headers) {
  const map = asObject(headers)
  const names = Object.keys(map)
  if (names.length === 0) return '-'
  return names.map(name => `${name}: ${text(map[name])}`).join('\n')
}

function renderKeyValueTable (rows) {
  return [
    '| Item | Value |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${cell(label)} | ${cell(value)} |`),
  ].join('\n')
}

function renderExpectations (expectations) {
  const list = asArray(expectations)
  if (list.length === 0) return '_No acceptance checks were recorded._'

  const rows = list.map((entry, index) => {
    const check = asObject(entry)
    const result = check.pass === true ? 'PASS' : 'FAIL'
    return `| ${index + 1} | ${cell(check.id)} | ${cell(check.description)} | ${result} | ${cell(check.detail)} |`
  })

  return [
    '| # | Check | Description | Result | Detail |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function renderRequests (requests) {
  const list = asArray(requests)
  if (list.length === 0) return '_No HTTP exchanges were recorded._'

  const rows = list.map((entry, index) => {
    const request = asObject(entry)
    const status = isPresent(request.status) ? text(request.status) : 'none'
    return `| ${index + 1} | ${cell(request.step)} | ${cell(request.method)} | ${cell(request.path)} | ` +
      `${cell(status)} | ${cell(formatDuration(request.durationMs))} | ${cell(renderHeaders(request.headers))} | ` +
      `${cell(formatBody(request.body))} |`
  })

  return [
    '| # | Step | Method | Path | Status | Duration | Headers (sanitised) | Body |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

function renderSignedOut (signedOut) {
  if (!isObject(signedOut)) return '_The signed-out attempt was not recorded._'

  const read = asObject(signedOut.read)
  const write = asObject(signedOut.write)

  return [
    `Cookies in the shared session before the attempt: ${text(signedOut.cookiesBefore)}`,
    '',
    '| Probe | Status | Error code | Workspaces | Task created |',
    '| --- | --- | --- | --- | --- |',
    `| Read | ${cell(text(read.status))} | ${cell(text(read.errorCode))} | ${cell(text(read.workspaceCount))} | - |`,
    `| Write | ${cell(text(write.status))} | ${cell(text(write.errorCode))} | - | ${cell(yesNo(write.taskCreated))} |`,
    '',
    `Task-create requests attempted: ${text(signedOut.writeRequests)}`,
  ].join('\n')
}

function renderCleanup (cleanup) {
  if (!isObject(cleanup)) return '_Cleanup was not recorded._'

  const markerFound = firstPresent(
    cleanup.markerFoundAfter,
    cleanup.exactMarkerFoundAfter,
    cleanup.markerFound,
    cleanup.exactMarkerFound,
  )
  const database = firstPresent(cleanup.databaseFile, cleanup.databasePath, cleanup.database)

  // A check that never ran must not read as 'marker not found'.
  const markerLabel = cleanup.checked === false ? 'not checked' : yesNo(markerFound)

  return renderKeyValueTable([
    ['Workspace id', text(cleanup.workspaceId)],
    ['Database check ran', yesNo(cleanup.checked)],
    ['Tasks before', text(cleanup.tasksBefore)],
    ['Tasks after', text(cleanup.tasksAfter)],
    ['Markers remaining', text(cleanup.markersRemaining)],
    ['Exact marker found after the run', markerLabel],
    ['Database file', basename(database)],
  ])
}

function cookieNames (signIn) {
  if (Array.isArray(signIn.sessionCookieNames)) return signIn.sessionCookieNames.map(name => String(name))
  if (Array.isArray(signIn.cookieNames)) return signIn.cookieNames.map(name => String(name))
  const cookies = asObject(signIn.cookies)
  if (Array.isArray(cookies.names)) return cookies.names.map(name => String(name))
  return []
}

function renderSignIn (signIn) {
  if (!isObject(signIn)) return '_Sign-in was not recorded._'

  const names = cookieNames(signIn)
  const enteredInWindow = firstPresent(signIn.manual, signIn.humanTyped, signIn.typedByHuman, signIn.wasManual)
  const csrfObserved = isPresent(signIn.csrfCookieObserved)
    ? signIn.csrfCookieObserved
    : names.length > 0 ? names.includes('csrftoken') : null

  const rows = [
    ['Requested mode', text(firstPresent(signIn.requestedMode, signIn.requested))],
    ['Used mode', text(firstPresent(signIn.usedMode, signIn.used))],
    // Manual mode means the harness waited for a sign-in in the window. It cannot
    // tell whether a person or UI automation typed, so it must not claim "human".
    ['Credentials entered in the app window', yesNo(enteredInWindow)],
    ['Session cookie observed', yesNo(signIn.sessionCookieObserved)],
    ['Same session object as the web view', yesNo(signIn.sameSessionAsWebView)],
    ['Cookie names', names.length > 0 ? names.join(', ') : '-'],
    ['CSRF cookie in the jar', yesNo(csrfObserved)],
  ]

  if (isPresent(signIn.csrfTokenSource)) {
    rows.push(['CSRF token source', text(signIn.csrfTokenSource)])
  }

  return renderKeyValueTable(rows)
}

function collectWarnings (record) {
  const top = asArray(record.warnings)
  if (top.length > 0) return top
  return asArray(asObject(record.signIn).warnings)
}

function renderWarnings (record) {
  const warnings = collectWarnings(record)
  if (warnings.length === 0) return ''
  return ['## Warnings', '', ...warnings.map(warning => `- ${describe(warning)}`)].join('\n')
}

/**
 * Render one evidence object as Markdown.
 *
 * `evidence` is either the run record with `expectations` and `requests` on it,
 * or `{ run, expectations, requests }`. Anything missing renders as a FAIL or as
 * 'not recorded' instead of throwing.
 *
 * @param {object} evidence
 * @returns {string}
 */
export function renderSummary (evidence) {
  const source = asObject(evidence)
  // The runner may keep the probes flat or nest them under `run`; both work.
  const record = isObject(source.run) ? { ...source, ...source.run } : source

  const expectations = asArray(source.expectations).length > 0
    ? source.expectations
    : asArray(record.expectations)
  const requests = asArray(source.requests).length > 0
    ? source.requests
    : asArray(record.requests)

  const passedCount = expectations.filter(entry => asObject(entry).pass === true).length
  const passed = expectations.length > 0
    ? passedCount === expectations.length
    : source.pass === true || source.status === 'pass' || record.pass === true || record.status === 'pass'

  const result = passed ? 'PASS' : 'FAIL'
  const timestamp = text(
    firstPresent(record.runAt, record.startedAt, record.timestamp),
    'timestamp unknown',
  )
  const origin = text(
    firstPresent(record.origin, record.serverUrl),
    'origin unknown',
  )

  const lines = [
    '# ZuriCopilot live verification',
    '',
    `Result: ${result} - run ${timestamp} - origin ${origin}`,
    '',
    // Which server produced the page matters: the dev app cannot render under
    // the current CSP, so a preview run and a dev run are not interchangeable.
    `Server: ${text(asObject(record.run).serveMode, 'dev')} - checks: ${passedCount} of ${expectations.length} passed - HTTP exchanges: ${requests.length}`,
    '',
    '## Acceptance checks',
    '',
    renderExpectations(expectations),
    '',
    '## HTTP exchanges',
    '',
    renderRequests(requests),
    '',
    '## Signed-out attempt',
    '',
    renderSignedOut(record.signedOut),
    '',
    '## Cleanup',
    '',
    renderCleanup(record.cleanup),
    '',
    '## Sign-in',
    '',
    renderSignIn(record.signIn),
  ]

  const warnings = renderWarnings(record)
  if (warnings !== '') {
    lines.push('', warnings)
  }

  return `${lines.join('\n').trimEnd()}\n`
}
