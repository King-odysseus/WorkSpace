'use strict'

/*
 * One narrow client for the workspace server, used only by the main process.
 *
 * Everything it needs comes from the shared Electron session the web view also uses
 * (`session.fromPartition('persist:ws')`): the login cookie already sits in that
 * session's jar, so the desktop app inherits the sign-in instead of asking again.
 *
 * Three rules keep this from becoming a proxy or a leak:
 *
 * 1. There is no generic request method. Each endpoint is its own function with a
 *    fixed method, path and body shape, so no caller can reach an address of its
 *    own choosing.
 * 2. A write reads the CSRF token from the session's cookie jar at the moment of
 *    the call and puts it in a header. The token never leaves this module: it is
 *    not returned, not logged and never placed in an error.
 * 3. Failures are reported as codes from the shared vocabulary, because a thrown
 *    fetch error names the full URL and a server body can echo an address back.
 */

const { PROBE_ERROR_CODES } = require('../../shared/probe-contract.js')

const CSRF_COOKIE_NAME = 'csrftoken'
const CSRF_HEADER_NAME = 'X-CSRFToken'
const DEFAULT_TIMEOUT_MS = 15000
// A JSON answer this client understands is a few kilobytes. Anything larger is not
// a task list, so the read stops as soon as the limit is passed instead of buffering
// the whole answer in the main process.
const MAX_BODY_BYTES = 1024 * 1024
// `URL.hostname` keeps the brackets around an IPv6 literal.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A failure the probe can report. The message is the code itself: there is nothing
 * else in this object that could carry a token, a cookie or a server message.
 */
class WorkspaceApiError extends Error {
  constructor (code, { status = null } = {}) {
    if (!PROBE_ERROR_CODES.includes(code)) {
      throw new TypeError('workspace-api error code is not in the shared vocabulary')
    }
    super(code)
    this.name = 'WorkspaceApiError'
    this.code = code
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null
  }
}

function isPlainObject (value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function toPositiveInt (value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return Number.isInteger(number) && number > 0 ? number : null
}

/**
 * Accept only a server address the session's cookies may be sent to.
 *
 * The session attaches cookies to every request it makes, so a plain-http address on
 * a real host would hand the login to the network. Plain http is therefore limited to
 * the loopback interface, which is where the local Django dev server lives.
 */
function resolveServerUrl (value) {
  let url
  try {
    url = new URL(String(value))
  } catch {
    throw new TypeError('server URL must be an absolute URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('server URL must use http or https')
  }
  if (url.username || url.password) {
    throw new TypeError('server URL must not carry credentials')
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TypeError('plain http is only allowed on the loopback interface')
  }
  return url
}

/**
 * The four headers Django needs to accept a write. Exported so a test can assert the
 * exact set, and so nothing downstream has to rebuild a half-correct version.
 *
 * Chromium treats `Origin` as a header it owns and may drop a caller-supplied value,
 * while `CsrfViewMiddleware` accepts either `Origin` or `Referer`. Sending both means
 * at least one survives.
 */
function buildWriteHeaders ({ csrfToken, origin }) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [CSRF_HEADER_NAME]: csrfToken,
    Origin: origin,
    Referer: `${origin}/`,
  }
}

/**
 * Drop a stream this client has given up on. Cancelling frees the socket; a cancel that
 * itself fails means the body is already gone, which is the outcome wanted anyway.
 */
async function cancelBody (reader) {
  try {
    await reader.cancel()
  } catch {
    // Nothing left to release.
  }
}

/**
 * Read a response body with the size limit applied as it arrives.
 *
 * The whole answer must never be buffered first: this runs in the Electron main process,
 * and a server that sends an endless body would otherwise grow that process until it
 * dies. Every chunk is counted before it is decoded, an oversized answer is cancelled
 * mid-stream, and an answer that cannot be streamed at all is treated as unreadable
 * rather than read whole (a body can only be bounded if it is read as a stream).
 */
async function readBodyText (response) {
  const stream = response && response.body
  if (!stream || typeof stream.getReader !== 'function') return null

  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  let reader = null
  try {
    reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || typeof value.byteLength !== 'number') {
        await cancelBody(reader)
        return null
      }
      bytes += value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        // Stop downloading the moment the answer is known to be too big.
        await cancelBody(reader)
        return null
      }
      text += decoder.decode(value, { stream: true })
    }
    // Flush any multi-byte character split across the final chunk.
    text += decoder.decode()
  } catch {
    // A body that cannot be read or streamed is an unreadable answer, not a different
    // outcome. Cancelling covers an error raised after the stream was acquired.
    if (reader) await cancelBody(reader)
    return null
  }
  return text
}

async function readJson (response) {
  const text = await readBodyText(response)
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_BODY_BYTES) return null
  try {
    const parsed = JSON.parse(text)
    // An array or scalar answer is not something this client asked for.
    return isPlainObject(parsed) ? parsed : null
  } catch {
    // Django's CSRF rejection is an HTML page, so "not JSON" is a real state.
    return null
  }
}

/**
 * Build the client. Throws TypeError for a caller mistake (no usable session, an
 * address that must not receive cookies); anything that goes wrong later is a
 * WorkspaceApiError carrying a code.
 */
function createWorkspaceClient ({ session, serverUrl, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!session || typeof session.fetch !== 'function') {
    throw new TypeError('an Electron session with fetch is required')
  }
  if (!session.cookies || typeof session.cookies.get !== 'function') {
    throw new TypeError('the session must expose its cookie jar')
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive whole number')
  }

  const server = resolveServerUrl(serverUrl)
  const origin = server.origin
  const apiUrl = path => new URL(path, `${origin}/`)

  async function sendJson ({ method, path, headers, body }) {
    let response
    try {
      response = await session.fetch(apiUrl(path).toString(), {
        method,
        headers,
        body,
        // The session attaches cookies to whatever host answers, and no endpoint this
        // client calls answers with a redirect.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      // A fetch rejection names the URL and, on some stacks, includes the request
      // options. Only the code crosses this line.
      throw new WorkspaceApiError('network_error')
    }
    if (!response || !Number.isInteger(response.status)) {
      throw new WorkspaceApiError('network_error')
    }
    return { status: response.status, payload: await readJson(response) }
  }

  /**
   * Read the CSRF token out of the shared cookie jar. Returns null when the jar holds
   * none, which the caller reports as `csrf_rejected` rather than sending a write the
   * server is certain to refuse.
   */
  async function readCsrfToken () {
    let cookies
    try {
      cookies = await session.cookies.get({ url: `${origin}/`, name: CSRF_COOKIE_NAME })
    } catch {
      // A jar that cannot be read is the same outcome as a jar with no token.
      return null
    }
    if (!Array.isArray(cookies)) return null
    const match = cookies.find(
      cookie => cookie && cookie.name === CSRF_COOKIE_NAME && typeof cookie.value === 'string' && cookie.value.length > 0,
    )
    return match ? match.value : null
  }

  /**
   * The token to send with a write.
   *
   * The jar is checked first: signing in through the web view already minted a token,
   * and a request per write would be wasted traffic. Only when the jar holds none does
   * this ask the server to mint one, which keeps the probe working on a fresh install
   * without depending on how the user reached the server.
   */
  async function ensureCsrfToken () {
    const existing = await readCsrfToken()
    if (existing !== null) return existing
    await sendJson({ method: 'GET', path: '/api/auth/csrf/', headers: { Accept: 'application/json' } })
    return readCsrfToken()
  }

  /**
   * GET /api/auth/me/. The body decides whether there is a session: the server answers
   * this endpoint with 200 and `authenticated: false` for a visitor, so a caller must
   * read the flag and not the status code.
   */
  function getMe () {
    return sendJson({ method: 'GET', path: '/api/auth/me/', headers: { Accept: 'application/json' } })
  }

  /** POST /api/workspaces/{id}/tasks/ with the title and nothing else. */
  async function createTask (workspaceId, payload) {
    const id = toPositiveInt(workspaceId)
    if (id === null) throw new TypeError('workspace id must be a positive whole number')
    const title = payload && typeof payload.title === 'string' ? payload.title.trim() : ''
    if (!title) throw new TypeError('task title is required')

    const csrfToken = await ensureCsrfToken()
    if (csrfToken === null) throw new WorkspaceApiError('csrf_rejected')

    return sendJson({
      method: 'POST',
      path: `/api/workspaces/${id}/tasks/`,
      headers: buildWriteHeaders({ csrfToken, origin }),
      body: JSON.stringify({ title }),
    })
  }

  /**
   * DELETE /api/tasks/{id}/?permanent=true
   *
   * The flag is the whole point. Without it the server archives the task, which keeps
   * a probe row in someone's workspace forever; with it, an owner's call removes the
   * row. The caller still has to verify the answer, because a server that ignores the
   * flag replies 200 with `archived: true`.
   */
  async function deleteTaskPermanently (taskId) {
    const id = toPositiveInt(taskId)
    if (id === null) throw new TypeError('task id must be a positive whole number')

    const csrfToken = await ensureCsrfToken()
    if (csrfToken === null) throw new WorkspaceApiError('csrf_rejected')

    return sendJson({
      method: 'DELETE',
      path: `/api/tasks/${id}/?permanent=true`,
      headers: buildWriteHeaders({ csrfToken, origin }),
    })
  }

  return Object.freeze({
    origin,
    getMe,
    ensureCsrfToken,
    createTask,
    deleteTaskPermanently,
  })
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  DEFAULT_TIMEOUT_MS,
  MAX_BODY_BYTES,
  WorkspaceApiError,
  buildWriteHeaders,
  createWorkspaceClient,
  resolveServerUrl,
}
