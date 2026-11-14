'use strict'

/*
 * The WorkSpace web view for the desktop spike (plan section 19, Phase 0).
 *
 * One window, one renderer, and that renderer is the real web app: no shell
 * chrome, no Copilot preload, no IPC. It loads the configured server on the
 * `persist:ws` session partition, so a person signs in by hand once and the
 * login survives a restart. The main process reads the same partition later,
 * which is what lets the probe reuse that session (plan section 4.2).
 *
 * The policy helpers at the top are pure functions, so the test runner can
 * check them with no Electron runtime. Electron is required inside the
 * functions that actually touch it.
 *
 * Content-Security-Policy: the Django app ships none (plan section 4.1 asks for
 * a strict policy on every renderer), so this window applies one itself, to
 * every document the web view loads from the configured server. It is added as
 * a response header, not injected into the page, so it cannot be removed by
 * anything the page runs afterwards.
 */

const ELECTRON = 'electron'

// The server is configuration, never a built-in constant (plan section 4.2).
const SERVER_URL_ENV = 'WORKSPACE_SERVER_URL'

// Part of the contract with the probe: these are the cookies the main process
// will read back. Renaming the partition signs everyone out.
const SESSION_PARTITION = 'persist:ws'

// Development may only talk to the two local ports this repo already trusts for
// CSRF (backend/settings.py, WORKSPACE_CSRF_TRUSTED_ORIGINS). Any other local
// port is refused instead of silently working and then failing on every write.
const TRUSTED_DEV_PORTS = Object.freeze([5175, 5183])

// Where an unconfigured development run looks. No production host is committed
// to the repository, so a packaged build must be told where to go rather than
// shipping a guessed domain.
const DEFAULT_DEV_SERVER_URL = 'http://localhost:5183'

// Links the web app itself produces (src/lib/linkify.js emits http, https and
// mailto). Anything else, including file:, javascript: and data:, is refused.
const EXTERNAL_PROTOCOLS = Object.freeze(['http:', 'https:', 'mailto:'])

const CSP_HEADER = 'Content-Security-Policy'

// The only inline script the web app ships: the pre-paint theme bootstrap in
// index.html. Allowing that one script by hash keeps every other inline script
// (which is what an injection looks like) blocked.
//
// The digest is stored bare because a policy source has to be quoted
// ('sha256-...'): an unquoted hash is an invalid source and Chromium ignores it,
// silently blocking the script instead of allowing it.
//
// windows.test.js recomputes this from index.html, so an edit there fails the
// test with the new value instead of silently dropping the theme on load. A
// stale hash only blocks that script; it can never loosen the policy. The web
// app is not modified by this window (plan section 5).
const INLINE_SCRIPT_HASHES = Object.freeze([
  'sha256-dGPIOlfb5j9v8OUmaw6T0b4fV9wTyYk4ChPrdYkE92A=',
])

function quotedInlineScriptHashes () {
  return INLINE_SCRIPT_HASHES.map(hash => `'${hash}'`)
}

class ServerConfigError extends Error {
  // The code is a fixed token so logs and tests never depend on the raw value
  // of the environment variable.
  constructor (code) {
    super(`invalid ${SERVER_URL_ENV}: ${code}`)
    this.name = 'ServerConfigError'
    this.code = code
  }
}

function isLoopbackHost (hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.localhost')
}

function buildConfig (parsed) {
  // A path is allowed (the app may be served under a prefix), but a trailing
  // slash is normalised so a later URL comparison is exact.
  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')
  return Object.freeze({
    origin: parsed.origin,
    url: `${parsed.origin}${path}/`,
    // Loopback is the only development case this spike supports. A LAN address
    // would need an explicit trust list; nothing asks for one yet.
    isDevelopment: isLoopbackHost(parsed.hostname),
    partition: SESSION_PARTITION,
  })
}

/**
 * Resolve WORKSPACE_SERVER_URL into the one origin the window may load.
 *
 * Throws ServerConfigError rather than falling back to something that looks
 * plausible: a wrong origin would put the person's password and session in the
 * wrong place.
 */
function resolveServerConfig (options = {}) {
  const env = options.env || process.env
  const isPackaged = options.isPackaged === true
  const configured = String(env[SERVER_URL_ENV] == null ? '' : env[SERVER_URL_ENV]).trim()

  if (configured === '') {
    if (isPackaged) throw new ServerConfigError('missing_url_for_packaged_build')
    return buildConfig(new URL(DEFAULT_DEV_SERVER_URL))
  }

  let parsed
  try {
    parsed = new URL(configured)
  } catch {
    // Never echo the value: it may contain a pasted password.
    throw new ServerConfigError('not_a_url')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ServerConfigError('unsupported_protocol')
  }
  // Credentials in the URL would be logged and stored by the window.
  if (parsed.username || parsed.password) throw new ServerConfigError('credentials_in_url')
  if (parsed.search || parsed.hash) throw new ServerConfigError('query_or_fragment_not_supported')

  if (isLoopbackHost(parsed.hostname)) {
    if (isPackaged) throw new ServerConfigError('loopback_not_allowed_in_packaged_build')
    if (parsed.protocol !== 'http:') throw new ServerConfigError('dev_server_must_be_http')
    if (!TRUSTED_DEV_PORTS.includes(Number(parsed.port))) {
      throw new ServerConfigError('untrusted_dev_port')
    }
  } else if (parsed.protocol !== 'https:') {
    // Anything reachable over the network must be https; a plain-http remote
    // server would expose the session cookie.
    throw new ServerConfigError('https_required')
  }

  return buildConfig(parsed)
}

/**
 * Decide what may happen when the web view tries to go somewhere.
 *
 * allow: same origin as the configured server, so the renderer navigates.
 * external: a normal web mail link, handed to the default browser.
 * deny: everything else, including popups, file paths and script URLs.
 */
function decideNavigation (targetUrl, config) {
  if (!config || typeof config.origin !== 'string') {
    return Object.freeze({ action: 'deny', reason: 'no_config' })
  }

  let target
  try {
    target = new URL(String(targetUrl))
  } catch {
    return Object.freeze({ action: 'deny', reason: 'not_a_url' })
  }

  if (target.username || target.password) {
    return Object.freeze({ action: 'deny', reason: 'credentials_in_url' })
  }
  if (target.origin === config.origin) {
    return Object.freeze({ action: 'allow', url: target.href })
  }
  if (EXTERNAL_PROTOCOLS.includes(target.protocol)) {
    return Object.freeze({ action: 'external', url: target.href })
  }
  return Object.freeze({ action: 'deny', reason: 'unsupported_scheme' })
}

function developmentSocketOrigin (origin) {
  // Vite's hot reload opens a websocket on the dev server itself, so the only
  // extra connect-src entry development needs is the ws:// form of the origin
  // already trusted for the page.
  return String(origin).replace(/^http:/, 'ws:')
}

/**
 * The policy, directive by directive, for the configured server.
 *
 * Deliberate choices, in the order a reviewer will ask about them:
 * - No 'unsafe-inline' and no 'unsafe-eval' for scripts in a real (non-loopback)
 *   build: same-origin injected markup cannot run script in this signed-in
 *   session. The theme bootstrap is allowed by hash instead.
 * - style-src keeps 'unsafe-inline'. Inline CSS cannot execute script, and the
 *   app's rich text (memos, comments, pasted images) carries inline styles that
 *   would otherwise render unstyled.
 * - img-src allows data: because the app's sanitizer (src/lib/sanitize.js)
 *   permits pasted base64 images.
 * - object-src 'none', base-uri 'none', frame-ancestors 'none' and
 *   form-action 'self' close the classic escapes: plugin embedding, <base>
 *   hijack, clickjacking of this window, and a form posting the session
 *   cookie elsewhere.
 * - connect-src stays 'self'. If a build enables Sentry (VITE_SENTRY_DSN) or
 *   Google sign-in (VITE_GOOGLE_CLIENT_ID), their hosts have to be added here
 *   on purpose: both are off by default, and manual sign-in is what this phase
 *   promises.
 */
function buildPolicyDirectives (config) {
  const development = Boolean(config && config.isDevelopment)
  const scriptSrc = ["'self'", ...quotedInlineScriptHashes()]
  const connectSrc = ["'self'"]

  if (development) {
    // Vite injects the React Fast Refresh preamble as an inline script into the
    // dev HTML and rewrites CSS into <style> tags in memory, so neither can be
    // hashed ahead of time. Development is loopback-only and never packaged
    // (see resolveServerConfig), so this never reaches a real server.
    scriptSrc.push("'unsafe-inline'")
    connectSrc.push(developmentSocketOrigin(config.origin))
  }

  return Object.freeze([
    ['default-src', "'self'"],
    ['script-src', scriptSrc.join(' ')],
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', "'self' data:"],
    ['font-src', "'self' data:"],
    ['connect-src', connectSrc.join(' ')],
    ['frame-src', "'self'"],
    ['worker-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ])
}

function buildContentSecurityPolicy (config) {
  return buildPolicyDirectives(config).map(([name, value]) => `${name} ${value}`).join('; ')
}

/**
 * Whether a response is a document this window must police: a page (top level
 * or frame) served by the configured origin over http or https.
 *
 * Everything else is left exactly as it arrived: a stylesheet or an API reply
 * is not a document, and the local file:// placeholder carries its own meta
 * policy because a file request has no response headers to rewrite.
 */
function shouldPoliceDocument (details, config) {
  if (!config || typeof config.origin !== 'string') return false
  const type = details && details.resourceType
  if (type !== 'mainFrame' && type !== 'subFrame') return false

  let url
  try {
    url = new URL(String(details.url))
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.origin === config.origin
}

/**
 * Replace any policy the server sent with ours and keep every other header.
 *
 * Replacing rather than appending keeps one policy to reason about; a server
 * header is written by the same app we are protecting, so trusting it to be
 * strict is the assumption this change exists to avoid.
 */
function withContentSecurityPolicy (responseHeaders, policy) {
  const headers = {}
  for (const [name, value] of Object.entries(responseHeaders || {})) {
    if (name.toLowerCase() === CSP_HEADER.toLowerCase()) continue
    headers[name] = Array.isArray(value) ? value.slice() : [String(value)]
  }
  headers[CSP_HEADER] = [policy]
  return headers
}

/**
 * Attach the policy to the shared session, so it applies to every document the
 * web view loads on that session rather than to one navigation.
 *
 * The filter is both belt and braces: Electron only calls back for the types
 * and URLs given here, and the handler re-checks before touching a header.
 */
function installContentSecurityPolicy (webSession, config) {
  if (!config || typeof config.origin !== 'string') {
    throw new TypeError('installContentSecurityPolicy needs a resolved server config')
  }
  if (!webSession || !webSession.webRequest || typeof webSession.webRequest.onHeadersReceived !== 'function') {
    throw new TypeError('installContentSecurityPolicy needs a session with webRequest access')
  }

  const policy = buildContentSecurityPolicy(config)
  webSession.webRequest.onHeadersReceived(
    { urls: [`${config.origin}/*`], types: ['mainFrame', 'subFrame'] },
    (details, callback) => {
      if (!shouldPoliceDocument(details, config)) {
        callback({})
        return
      }
      callback({ responseHeaders: withContentSecurityPolicy(details.responseHeaders, policy) })
    },
  )
  return policy
}

/**
 * Every Electron security switch, stated rather than assumed. The absent
 * `preload` is deliberate: the web view must never receive the Copilot bridge
 * (plan section 4.1).
 */
function hardenedWebPreferences () {
  return Object.freeze({
    partition: SESSION_PARTITION,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  })
}

function safeOpenExternal (shell, url) {
  // A link the OS cannot open is not a reason to crash the shell.
  Promise.resolve()
    .then(() => shell.openExternal(url))
    .catch(error => {
      process.stderr.write(`zuricopilot-desktop: could not open external link (${(error && error.code) || 'unknown'})\n`)
    })
}

function hardenSession (webSession, config) {
  // Nothing the app needs before sign-in is a privileged permission. Clipboard
  // writes stay allowed because the app's copy buttons are ordinary UI; every
  // other request (camera, microphone, geolocation, notifications) is refused
  // until a later phase decides to support it on purpose.
  const allowed = permission => permission === 'clipboard-sanitized-write'
  webSession.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)))
  webSession.setPermissionCheckHandler((_contents, permission) => allowed(permission))

  // The server sends no policy of its own, so the window supplies one.
  installContentSecurityPolicy(webSession, config)
}

/**
 * Create the window that shows the WorkSpace web app.
 *
 * options.config: a value from resolveServerConfig (the caller resolves it once
 *   so a bad URL is reported before any window opens).
 * options.url: what to load first. Defaults to the configured server; the smoke
 *   test passes a local placeholder so it can run with no server up.
 */
function createWorkSpaceWindow (options = {}) {
  const electron = require(ELECTRON)
  const { BrowserWindow, session, shell } = electron

  const config = options.config
  if (!config) throw new TypeError('createWorkSpaceWindow needs a resolved server config')
  const startUrl = options.url || config.url

  hardenSession(session.fromPartition(SESSION_PARTITION), config)

  const workSpaceWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#000D3D',
    title: 'WorkSpace',
    webPreferences: hardenedWebPreferences(),
  })

  const contents = workSpaceWindow.webContents

  // Top-level navigation stays on the configured origin. External links leave
  // for the default browser instead of turning the window into one. Subframe
  // loads are left alone: they are content inside the page, not navigation.
  //
  // Electron passes the URL on the event as well as in the older positional
  // argument; read both so a version bump cannot quietly drop the guard.
  const guard = (event, legacyUrl) => {
    const targetUrl = event && typeof event.url === 'string' ? event.url : legacyUrl
    const decision = decideNavigation(targetUrl, config)
    if (decision.action === 'allow') return
    event.preventDefault()
    if (decision.action === 'external') safeOpenExternal(shell, decision.url)
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)

  // No second renderer, ever. A same-origin popup is folded back into this
  // window; anything else is the browser's job.
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideNavigation(url, config)
    if (decision.action === 'allow') {
      // Loading inside the handler would run a navigation during the popup
      // decision, so it waits for the current task to finish.
      setImmediate(() => {
        workSpaceWindow.loadURL(decision.url).catch(() => {
          // did-fail-load has already reported why the page did not load.
        })
      })
    } else if (decision.action === 'external') {
      safeOpenExternal(shell, decision.url)
    }
    return { action: 'deny' }
  })

  // webviewTag is off; refuse an attached guest anyway if a page ever tries.
  contents.on('will-attach-webview', event => event.preventDefault())

  // A server that is down must say so in the terminal, not look like a hang.
  contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return
    process.stderr.write(`zuricopilot-desktop: page load failed code=${errorCode} description=${errorDescription}\n`)
  })

  workSpaceWindow.loadURL(startUrl).catch(() => {
    // did-fail-load already reported the reason; nothing else to do here.
  })

  return workSpaceWindow
}

module.exports = {
  SERVER_URL_ENV,
  SESSION_PARTITION,
  TRUSTED_DEV_PORTS,
  DEFAULT_DEV_SERVER_URL,
  EXTERNAL_PROTOCOLS,
  ServerConfigError,
  isLoopbackHost,
  resolveServerConfig,
  decideNavigation,
  CSP_HEADER,
  INLINE_SCRIPT_HASHES,
  buildContentSecurityPolicy,
  buildPolicyDirectives,
  shouldPoliceDocument,
  withContentSecurityPolicy,
  installContentSecurityPolicy,
  hardenedWebPreferences,
  createWorkSpaceWindow,
}
