'use strict'

/*
 * Checks for the parts of windows.js that decide where the desktop window goes
 * and what the page it loads is allowed to do.
 *
 * These run with the Node test runner and no Electron runtime, which is why
 * windows.js keeps its policy helpers free of top-level Electron imports:
 *
 *   cd desktop && node --test electron/windows.test.js
 *
 * The window itself needs Electron to exist, and is verified by
 * `npm run start:smoke` instead.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  AUTH_POPUP_ORIGIN,
  CSP_HEADER,
  DEFAULT_DEV_SERVER_URL,
  INLINE_SCRIPT_HASHES,
  SESSION_PARTITION,
  ServerConfigError,
  THIRD_PARTY_SOURCES,
  buildContentSecurityPolicy,
  decideNavigation,
  decideWindowOpen,
  guardAuthPopup,
  hardenSession,
  hardenedWebPreferences,
  installContentSecurityPolicy,
  resolveServerConfig,
  shouldPoliceDocument,
  withContentSecurityPolicy,
} = require('./windows.js')

function withUrl (value, isPackaged = false) {
  return resolveServerConfig({ env: { WORKSPACE_SERVER_URL: value }, isPackaged })
}

function codeOf (fn) {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof ServerConfigError, `expected ServerConfigError, got ${error && error.name}`)
    return error.code
  }
  assert.fail('expected the call to throw')
}

test('an unconfigured development run uses the local dev server', () => {
  const config = resolveServerConfig({ env: {}, isPackaged: false })
  assert.equal(config.origin, 'http://localhost:5183')
  assert.equal(config.origin, new URL(DEFAULT_DEV_SERVER_URL).origin)
  assert.equal(config.url, 'http://localhost:5183/')
  assert.equal(config.isDevelopment, true)
  assert.equal(config.partition, 'persist:ws')
  assert.equal(config.partition, SESSION_PARTITION)
})

test('WORKSPACE_SERVER_URL selects the server', () => {
  const config = withUrl('https://work.example.com')
  assert.equal(config.origin, 'https://work.example.com')
  assert.equal(config.url, 'https://work.example.com/')
  assert.equal(config.isDevelopment, false)
})

test('the two trusted development ports are accepted on loopback spellings', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    for (const port of [5175, 5183]) {
      const config = withUrl(`http://${host}:${port}`)
      assert.equal(config.origin, `http://${host}:${port}`)
      assert.equal(config.isDevelopment, true)
    }
  }
})

test('a local port outside the trusted pair is refused', () => {
  for (const port of [5173, 8000, 3000, 443]) {
    assert.equal(codeOf(() => withUrl(`http://localhost:${port}`)), 'untrusted_dev_port')
  }
})

test('a packaged build must be told where the server is', () => {
  assert.equal(
    codeOf(() => resolveServerConfig({ env: {}, isPackaged: true })),
    'missing_url_for_packaged_build',
  )
})

test('a packaged build refuses a loopback server', () => {
  assert.equal(
    codeOf(() => withUrl('http://localhost:5183', true)),
    'loopback_not_allowed_in_packaged_build',
  )
})

test('a remote server must be https', () => {
  assert.equal(codeOf(() => withUrl('http://work.example.com')), 'https_required')
})

test('a server path is kept and normalised, not dropped', () => {
  const config = withUrl('https://work.example.com/app/')
  assert.equal(config.origin, 'https://work.example.com')
  assert.equal(config.url, 'https://work.example.com/app/')
})

test('a server URL with credentials, a query, a fragment or no protocol is refused', () => {
  assert.equal(codeOf(() => withUrl('https://user:secret@work.example.com')), 'credentials_in_url')
  assert.equal(codeOf(() => withUrl('https://work.example.com/?a=1')), 'query_or_fragment_not_supported')
  assert.equal(codeOf(() => withUrl('https://work.example.com/#top')), 'query_or_fragment_not_supported')
  assert.equal(codeOf(() => withUrl('work.example.com')), 'not_a_url')
})

test('a non-web protocol is refused as the server', () => {
  assert.equal(codeOf(() => withUrl('file:///C:/WorkSpace/index.html')), 'unsupported_protocol')
})

test('navigation inside the configured origin is allowed', () => {
  const config = withUrl('https://work.example.com')
  for (const target of [
    'https://work.example.com/',
    'https://work.example.com/projects/12',
    'https://work.example.com/projects/12?tab=board#task-4',
  ]) {
    assert.equal(decideNavigation(target, config).action, 'allow', target)
  }
})

test('another origin opens externally rather than loading in the window', () => {
  const config = withUrl('https://work.example.com')
  for (const target of [
    'https://example.org/help',
    'http://example.org/help',
    'mailto:someone@example.invalid',
    'https://localhost:5183/',
  ]) {
    const decision = decideNavigation(target, config)
    assert.equal(decision.action, 'external', target)
    assert.equal(decision.url, new URL(target).href)
  }
})

test('only the Google sign-in origin stays attached as a child window', () => {
  const config = withUrl('https://work.example.com')
  const google = decideWindowOpen('https://accounts.google.com/gsi/select?client_id=example', config)

  assert.equal(google.action, 'popup')
  assert.equal(new URL(google.url).origin, AUTH_POPUP_ORIGIN)
  assert.equal(decideWindowOpen('https://example.org/help', config).action, 'external')
  assert.equal(decideWindowOpen('https://work.example.com/projects/12', config).action, 'load')
  assert.equal(decideWindowOpen('https://user:pass@accounts.google.com/gsi/select', config).action, 'deny')
  assert.equal(decideWindowOpen('https://accounts.google.com.evil.invalid/gsi/select', config).action, 'external')
  assert.equal(decideWindowOpen('https://accounts.google.com/gsi/select', null).action, 'deny')
})

test('the Google child refuses navigation and nested windows outside its origin', () => {
  const handlers = {}
  let openHandler
  const googleWindow = {
    webContents: {
      on (name, handler) { handlers[name] = handler },
      setWindowOpenHandler (handler) { openHandler = handler },
    },
  }
  guardAuthPopup(googleWindow)

  const runGuard = (name, url) => {
    let prevented = false
    handlers[name]({ url, preventDefault () { prevented = true } })
    return prevented
  }

  assert.equal(runGuard('will-navigate', 'https://accounts.google.com/v3/signin/identifier'), false)
  assert.equal(runGuard('will-redirect', 'https://workspace.tijha.com/'), true)
  assert.equal(runGuard('will-navigate', 'https://user:pass@accounts.google.com/'), true)
  assert.equal(runGuard('will-navigate', 'https://accounts.google.com.evil.invalid/'), true)
  assert.equal(runGuard('will-navigate', 'not a url'), true)
  assert.deepEqual(openHandler({ url: 'https://accounts.google.com/' }), { action: 'deny' })

  let webviewPrevented = false
  handlers['will-attach-webview']({ preventDefault () { webviewPrevented = true } })
  assert.equal(webviewPrevented, true)
  assert.throws(() => guardAuthPopup(null), TypeError)
  assert.throws(() => guardAuthPopup({}), TypeError)
})

test('script, file and data URLs are denied, not opened', () => {
  const config = withUrl('https://work.example.com')
  for (const target of [
    'javascript:alert(1)',
    'file:///C:/Windows/System32/calc.exe',
    'data:text/html,<h1>hi</h1>',
    'not a url',
    '',
  ]) {
    assert.equal(decideNavigation(target, config).action, 'deny', target)
  }
})

test('a same-origin URL carrying credentials is denied', () => {
  const config = withUrl('https://work.example.com')
  // URL.origin ignores userinfo, so this would otherwise look same-origin.
  assert.equal(decideNavigation('https://user:pass@work.example.com/app', config).action, 'deny')
})

test('a different port on the same host is a different origin', () => {
  const config = withUrl('http://localhost:5183')
  assert.equal(decideNavigation('http://localhost:8000/api/', config).action, 'external')
})

test('without a resolved config nothing navigates', () => {
  assert.equal(decideNavigation('https://work.example.com', null).action, 'deny')
})

test('the web view is sandboxed, isolated and has no preload', () => {
  const prefs = hardenedWebPreferences()
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.sandbox, true)
  assert.equal(prefs.nodeIntegration, false)
  assert.equal(prefs.nodeIntegrationInSubFrames, false)
  assert.equal(prefs.nodeIntegrationInWorker, false)
  assert.equal(prefs.webviewTag, false)
  assert.equal(prefs.webSecurity, true)
  assert.equal(prefs.partition, 'persist:ws')
  assert.equal(Object.hasOwn(prefs, 'preload'), false)
  assert.equal(Object.isFrozen(prefs), true)
})

// --- Content-Security-Policy ---------------------------------------------

/** Policy string to `directive -> [sources]`, the way a browser reads it. */
function parsePolicy (policy) {
  const directives = new Map()
  for (const part of policy.split(';')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const [name, ...sources] = trimmed.split(/\s+/)
    directives.set(name, sources)
  }
  return directives
}

/** Run an onHeadersReceived listener and return what it handed the callback. */
function runListener (listener, details) {
  let result
  let calls = 0
  listener(details, value => {
    calls += 1
    result = value
  })
  assert.equal(calls, 1, 'the listener must call back exactly once')
  return result
}

function fakeSession () {
  const registrations = []
  const permissionHandlers = {}
  return {
    registrations,
    permissionHandlers,
    webRequest: {
      onHeadersReceived (filter, listener) {
        registrations.push({ filter, listener })
      },
    },
    setPermissionRequestHandler (handler) { permissionHandlers.request = handler },
    setPermissionCheckHandler (handler) { permissionHandlers.check = handler },
  }
}

test('the policy for a real server refuses inline and eval script', () => {
  const policy = buildContentSecurityPolicy(withUrl('https://work.example.com'))
  const directives = parsePolicy(policy)

  assert.deepEqual(directives.get('default-src'), ["'self'"])
  // The whole point: injected markup served from the same origin gets no script
  // execution, so the signed-in session cookie cannot be spent by it.
  assert.deepEqual(directives.get('script-src'), ["'self'", ...INLINE_SCRIPT_HASHES.map(hash => `'${hash}'`), 'https://accounts.google.com'])
  // An unquoted hash is an invalid source list entry: Chromium ignores it and
  // the theme bootstrap would be blocked, so the quoting is checked here too.
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/)
  assert.equal(policy.includes("'unsafe-inline'"), true, 'style-src still allows inline CSS')
  assert.equal(directives.get('script-src').includes("'unsafe-inline'"), false)
  assert.equal(policy.includes("'unsafe-eval'"), false)
  assert.equal(policy.includes("'strict-dynamic'"), false)

  // The escapes that turn an injection into exfiltration or clickjacking.
  assert.deepEqual(directives.get('object-src'), ["'none'"])
  assert.deepEqual(directives.get('base-uri'), ["'none'"])
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"])
  assert.deepEqual(directives.get('form-action'), ["'self'"])
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'https://accounts.google.com'])
  assert.deepEqual(directives.get('frame-src'), ["'self'", 'https://accounts.google.com'])
  assert.deepEqual(directives.get('worker-src'), ["'self'"])

  // A header value with a line break is dropped by Chromium, which would leave
  // the page with no policy at all.
  assert.equal(policy.includes('\n'), false)
  assert.match(policy, /^default-src 'self'; /)
  assert.equal(policy.endsWith(';'), false)
})

test('the policy allows exactly the outside hosts the web app loads', () => {
  const directives = parsePolicy(buildContentSecurityPolicy(withUrl('https://work.example.com')))

  // Each one is a feature of the app rather than a convenience: the Google
  // sign-in button, the Inter font every screen is set in, and the signed
  // Cloudinary URLs uploaded avatars and files are rendered from. Blocked,
  // the sign-in screen says it cannot connect and nothing tells the person why.
  assert.equal(directives.get('script-src').includes('https://accounts.google.com'), true)
  assert.equal(directives.get('frame-src').includes('https://accounts.google.com'), true)
  assert.equal(directives.get('connect-src').includes('https://accounts.google.com'), true)
  assert.equal(directives.get('style-src').includes('https://fonts.googleapis.com'), true)
  assert.equal(directives.get('font-src').includes('https://fonts.gstatic.com'), true)
  assert.equal(directives.get('img-src').includes('https://res.cloudinary.com'), true)

  // Widening is per host and https only: no wildcard, no plain http, and no
  // host that could be swapped for another.
  for (const [directive, sources] of Object.entries(THIRD_PARTY_SOURCES)) {
    assert.ok(directives.has(directive), directive + ' must stay in the policy')
    for (const source of sources) {
      assert.match(source, /^https:\/\/[a-z0-9.-]+$/)
    }
  }

  // Google may run, and only Google: no other outside host is a script source,
  // and script still cannot be inline or eval.
  assert.deepEqual(directives.get('script-src').filter(source => source.startsWith('http')), ['https://accounts.google.com'])
  assert.equal(directives.get('script-src').includes("'unsafe-eval'"), false)
})

test('the window grants only the permissions the app has UI for', () => {
  const session = fakeSession()
  hardenSession(session, withUrl('https://work.example.com'))

  const decisions = []
  const ask = permission => session.permissionHandlers.request({}, permission, value => decisions.push([permission, value]))
  ask('notifications')
  ask('display-capture')
  ask('clipboard-sanitized-write')
  ask('media')
  ask('geolocation')

  // Reminder bells, screen sharing and the copy buttons are ordinary app UI.
  // A camera, a microphone and a location reading are not something this window
  // needs, so they stay refused.
  assert.deepEqual(decisions, [
    ['notifications', true],
    ['display-capture', true],
    ['clipboard-sanitized-write', true],
    ['media', false],
    ['geolocation', false],
  ])

  // Chromium consults the synchronous check handler too; it has to agree.
  assert.equal(session.permissionHandlers.check({}, 'notifications'), true)
  assert.equal(session.permissionHandlers.check({}, 'media'), false)
})

test('development loosens script-src only enough for the Vite dev server', () => {
  const directives = parsePolicy(buildContentSecurityPolicy(withUrl('http://localhost:5183')))
  assert.deepEqual(
    directives.get('script-src'),
    ["'self'", ...INLINE_SCRIPT_HASHES.map(hash => `'${hash}'`), "'unsafe-inline'", 'https://accounts.google.com'],
  )
  // Hot reload talks to the dev server's own websocket, not to some other host.
  assert.deepEqual(directives.get('connect-src'), ["'self'", 'ws://localhost:5183', 'https://accounts.google.com'])
  assert.deepEqual(directives.get('object-src'), ["'none'"])
})

test('the pinned hash is the theme bootstrap script index.html actually ships', () => {
  // The web app is not modified to suit the desktop window (plan section 5), so
  // the one inline script it needs stays allowed by hash. If index.html changes,
  // this test fails and prints the value to paste into windows.js.
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8')
  const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1])
  assert.equal(inlineScripts.length, 1, 'index.html should ship exactly one inline script')

  const digest = 'sha256-' + crypto.createHash('sha256').update(inlineScripts[0], 'utf8').digest('base64')
  assert.deepEqual([...INLINE_SCRIPT_HASHES], [digest], `index.html changed: set INLINE_SCRIPT_HASHES to '${digest}'`)
})

test('our policy replaces any server-sent policy and keeps every other header', () => {
  const policy = buildContentSecurityPolicy(withUrl('https://work.example.com'))
  const headers = withContentSecurityPolicy({
    'Content-Type': ['text/html; charset=utf-8'],
    'Content-Security-Policy': ["default-src * 'unsafe-inline' 'unsafe-eval'"],
    'content-security-policy': ['script-src *'],
    'Set-Cookie': ['csrftoken=abc; Path=/'],
  }, policy)

  assert.deepEqual(headers[CSP_HEADER], [policy])
  const names = Object.keys(headers).map(name => name.toLowerCase())
  assert.equal(names.filter(name => name === 'content-security-policy').length, 1)
  assert.deepEqual(headers['Content-Type'], ['text/html; charset=utf-8'])
  assert.deepEqual(headers['Set-Cookie'], ['csrftoken=abc; Path=/'])
})

test('a header value Electron reports as a plain string is kept, not dropped', () => {
  const headers = withContentSecurityPolicy({ 'Content-Type': 'text/html' }, "default-src 'self'")
  assert.deepEqual(headers['Content-Type'], ['text/html'])
})

test('only a document from the configured origin is policed', () => {
  const config = withUrl('https://work.example.com')
  const document = url => ({ resourceType: 'mainFrame', url })

  assert.equal(shouldPoliceDocument(document('https://work.example.com/login'), config), true)
  assert.equal(shouldPoliceDocument(document('https://work.example.com/app/?a=1#top'), config), true)
  assert.equal(shouldPoliceDocument({ resourceType: 'subFrame', url: 'https://work.example.com/files/9' }, config), true)

  // A stylesheet, an API reply or an image is not a document.
  for (const resourceType of ['xhr', 'script', 'stylesheet', 'image', 'other']) {
    assert.equal(shouldPoliceDocument({ resourceType, url: 'https://work.example.com/api/tasks/' }, config), false, resourceType)
  }
  // Another origin, another scheme, or nothing to parse.
  assert.equal(shouldPoliceDocument(document('https://example.org/'), config), false)
  assert.equal(shouldPoliceDocument(document('http://work.example.com/'), config), false)
  assert.equal(shouldPoliceDocument(document('file:///C:/page.html'), config), false)
  assert.equal(shouldPoliceDocument(document('not a url'), config), false)
  assert.equal(shouldPoliceDocument({ resourceType: 'mainFrame' }, config), false)
  assert.equal(shouldPoliceDocument(document('https://work.example.com/'), null), false)
})

test('the session is hardened so every document on it gets the policy', () => {
  const config = withUrl('https://work.example.com')
  const policy = buildContentSecurityPolicy(config)
  const session = fakeSession()

  assert.equal(installContentSecurityPolicy(session, config), policy)
  assert.equal(session.registrations.length, 1)

  // Same origin, documents only: the probe's API replies stay untouched.
  assert.deepEqual(session.registrations[0].filter, {
    urls: ['https://work.example.com/*'],
    types: ['mainFrame', 'subFrame'],
  })

  const listener = session.registrations[0].listener
  const document = runListener(listener, {
    resourceType: 'mainFrame',
    url: 'https://work.example.com/login',
    responseHeaders: { 'Content-Type': ['text/html'], 'Content-Security-Policy': ["script-src *"] },
  })
  assert.deepEqual(document.responseHeaders[CSP_HEADER], [policy])
  assert.deepEqual(document.responseHeaders['Content-Type'], ['text/html'])

  // Belt and braces: a type the filter should never have delivered is ignored.
  assert.deepEqual(runListener(listener, {
    resourceType: 'xhr',
    url: 'https://work.example.com/api/tasks/',
    responseHeaders: { 'Content-Type': ['application/json'] },
  }), {})
})

test('the installer refuses to run without a config or a session it can hook', () => {
  const config = withUrl('https://work.example.com')
  assert.throws(() => installContentSecurityPolicy(fakeSession(), null), TypeError)
  assert.throws(() => installContentSecurityPolicy(fakeSession(), {}), TypeError)
  assert.throws(() => installContentSecurityPolicy(null, config), TypeError)
  assert.throws(() => installContentSecurityPolicy({}, config), TypeError)
})
