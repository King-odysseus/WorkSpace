'use strict'

/*
 * Evidence sanitising for the live verification run.
 *
 * The run has to record exactly what the main process sent, because the
 * acceptance criteria ask for the request headers. It must not record the
 * session cookie, the CSRF token, the throwaway password, or any credential the
 * harness did not anticipate, because those would then sit in a file on disk and
 * in whatever reads that file.
 *
 * Two fail-closed rules, not one denylist:
 *
 * - A header value is kept only when its name is in SAFE_HEADERS below. A header
 *   the harness has never seen, such as `X-API-Key`, is withheld outright. A
 *   denylist cannot do that: an unlisted credential header would be copied into
 *   the evidence verbatim. `findLeakedSecrets` is only given the password and
 *   the cookie values, so it could not notice, let alone remove, that value.
 * - A query parameter keeps its value only when its name is in one of the small
 *   allowlists below and the value has the expected shape. The parameter name
 *   always stays, because `?permanent=true` on a DELETE is evidence; every other
 *   value becomes REDACTED. Unknown parameters fail closed too.
 */

const REDACTED = '<redacted>'

// Request-describing headers. Anything not listed here is withheld, so a new
// header on a request can never add its value to the evidence file by accident.
const SAFE_HEADERS = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'content-length',
  'content-type',
  'dnt',
  'host',
  'origin',
  'pragma',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'transfer-encoding',
  'upgrade-insecure-requests',
  'user-agent',
])

// Values that are URLs carry a query string too, so they get the same query
// redaction: a Referer can hold a token exactly like a request URL can.
const URL_HEADERS = new Set(['origin', 'referer'])

// A query parameter whose name looks like a credential is always redacted, even
// if a later change adds that name to an allowlist below.
const SENSITIVE_QUERY_NAME = /(pass(word|wd)?|token|secret|api[-_]?key|access[-_]?key|auth|session|signature|credential|jwt|bearer|csrf|ticket|code|key)/i
const SAFE_BOOLEAN_QUERY_NAMES = new Set(['permanent'])
const SAFE_NUMERIC_QUERY_NAMES = new Set(['page', 'page_size', 'limit', 'offset'])

const MAX_HEADER_CHARS = 200

/** Percent- and plus-decoding for comparison only; the raw text is what is kept. */
function decodeQueryPart(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' '))
  } catch {
    return String(value)
  }
}

/** Whether a query value is safe to keep verbatim. */
function isSafeQueryValue(name, value) {
  const key = String(name).toLowerCase()
  if (SENSITIVE_QUERY_NAME.test(key)) return false
  if (SAFE_BOOLEAN_QUERY_NAMES.has(key)) return value === 'true' || value === 'false'
  if (SAFE_NUMERIC_QUERY_NAMES.has(key)) return /^\d{1,7}$/.test(value)
  return false
}

/**
 * One `name=value` pair with the value kept only when the name allows it.
 *
 * The raw name and raw value are reused so the recorded query keeps the exact
 * encoding the client sent; only the value is replaced, never re-encoded.
 */
function sanitizeQueryPart(part) {
  const separator = part.indexOf('=')
  if (separator === -1) return part // A bare flag has no value to leak.
  const rawName = part.slice(0, separator)
  const rawValue = part.slice(separator + 1)
  const name = decodeQueryPart(rawName)
  const value = decodeQueryPart(rawValue)
  return isSafeQueryValue(name, value) ? part : `${rawName}=${REDACTED}`
}

function sanitizeQuery(search) {
  const raw = String(search == null ? '' : search).replace(/^\?/, '')
  const parts = raw.split('&').filter(part => part !== '').map(sanitizeQueryPart)
  return parts.length === 0 ? '' : `?${parts.join('&')}`
}

/** Path and redacted query only, for a parsed URL. */
function pathAndQuery(url) {
  return `${url.pathname}${sanitizeQuery(url.search)}`
}

/**
 * Path and query only. The origin is recorded once for the run, and dropping it
 * from every row keeps rows short and unnavigable.
 */
function sanitizePath(rawUrl) {
  try {
    return pathAndQuery(new URL(String(rawUrl)))
  } catch {
    return '<unparsable-url>'
  }
}

/**
 * A URL-valued header, with its query values redacted.
 *
 * A value that will not parse is withheld rather than kept: a token pasted into
 * a Referer is not a URL, and guessing at it is how it would end up on disk.
 */
function sanitizeUrlText(value, options = {}) {
  const text = String(value == null ? '' : value)
  if (text === '') return text
  try {
    const url = new URL(text)
    // An Origin header is scheme, host and port by definition; it has no path to
    // record, and adding one would misreport what was sent.
    const keepPath = options.keepPath !== false
    return `${url.origin}${keepPath ? pathAndQuery(url) : ''}`
  } catch {
    return REDACTED
  }
}

/** Cookie names in a `Cookie` header value, never the values. */
function cookieNamesFrom(value) {
  return String(value)
    .split(';')
    .map(part => part.split('=')[0].trim())
    .filter(Boolean)
    .sort()
}

/**
 * One header value, reduced to what is safe to keep.
 *
 * Cookie values are dropped but their names stay: seeing `sessionid` and
 * `csrftoken` is what proves the request carried the web view's login.
 */
function sanitizeHeaderValue(name, value) {
  const header = String(name || '').toLowerCase()
  const text = Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value)

  if (header === 'cookie') {
    const names = cookieNamesFrom(text)
    return names.length === 0 ? REDACTED : `${REDACTED}; names: ${names.join(', ')}`
  }
  if (header === 'x-csrftoken' || header === 'x-xsrf-token') {
    return `${REDACTED}; ${text.length} chars`
  }
  // Everything else has to earn its place in SAFE_HEADERS.
  if (!SAFE_HEADERS.has(header)) return REDACTED

  const cleaned = text.replace(/\s+/g, ' ').trim()
  const shaped = URL_HEADERS.has(header)
    ? sanitizeUrlText(cleaned, { keepPath: header !== 'origin' })
    : cleaned
  return shaped.slice(0, MAX_HEADER_CHARS)
}

/** A header map with every non-allowlisted value replaced. Keys keep their case. */
function sanitizeHeaders(headers) {
  const safe = {}
  for (const [name, value] of Object.entries(headers || {})) {
    safe[name] = sanitizeHeaderValue(name, value)
  }
  return safe
}

/**
 * Request bodies: the throwaway task title is the only body worth keeping, and
 * only when it carries the probe's own marker prefix. Anything else is reduced
 * to its key names, so a credential can never be copied out of a request.
 */
function sanitizeRequestBody(body, options = {}) {
  const markerPrefix = String(options.markerPrefix || '')
  if (body == null) return null

  let parsed = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return { kind: 'text', length: body.length }
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'non-object' }
  }

  const keys = Object.keys(parsed).sort()
  const title = parsed.title
  if (markerPrefix !== '' && typeof title === 'string' && title.startsWith(markerPrefix)) {
    return { kind: 'json', keys, title }
  }
  return { kind: 'json', keys, valuesOmitted: true }
}

/** Cookie jar summary: how many, and which names. No values, no domains. */
function describeCookies(cookies) {
  const list = Array.isArray(cookies) ? cookies : []
  const names = [...new Set(list.map(cookie => String(cookie && cookie.name)))].sort()
  return { count: list.length, names }
}

/**
 * Which of the given secrets appear verbatim in the serialised evidence.
 *
 * Callers pass labelled values (session cookie, CSRF token, password). An empty
 * result is the only acceptable one before the file is written.
 *
 * This is a second line of defence, not the first: it can only look for values
 * it is told about. The header allowlist and the query redaction are what stop
 * a credential the harness never anticipated from being recorded at all.
 */
function findLeakedSecrets(text, secrets) {
  const haystack = String(text == null ? '' : text)
  const leaked = []
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    const label = String(secret && secret.label)
    const value = String(secret && secret.value == null ? '' : secret.value)
    // Short values would match ordinary words; a real token or password is long.
    if (!label || value.length < 6) continue
    if (haystack.includes(value)) leaked.push(label)
  }
  return leaked
}

module.exports = {
  MAX_HEADER_CHARS,
  REDACTED,
  SAFE_HEADERS,
  SENSITIVE_QUERY_NAME,
  cookieNamesFrom,
  describeCookies,
  findLeakedSecrets,
  sanitizeHeaderValue,
  sanitizeHeaders,
  sanitizePath,
  sanitizeQuery,
  sanitizeRequestBody,
  sanitizeUrlText,
}
