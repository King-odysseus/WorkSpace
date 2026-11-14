'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const {
  DEBUG_PAGE_FILE,
  DEBUG_PARTITION,
  debugPagePath,
  debugPageUrl,
  guardContents,
  hardenProbeSession,
  probeWindowPreferences,
} = require('../../../../electron/debug-window.js')

const HTML = fs.readFileSync(debugPagePath(), 'utf8')

function between (openTag, closeTag) {
  const open = HTML.indexOf(openTag)
  assert.notEqual(open, -1, `the page has no ${openTag}`)
  const start = open + openTag.length
  const close = HTML.indexOf(closeTag, start)
  assert.notEqual(close, -1, `the page never closes ${openTag}`)
  return HTML.slice(start, close)
}

function sha256 (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('base64')
}

function metaPolicy () {
  const match = HTML.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)
  assert.ok(match, 'the page carries no Content-Security-Policy meta tag')
  return match[1]
}

function directives () {
  const map = new Map()
  for (const part of metaPolicy().split(';')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const [name, ...values] = trimmed.split(/\s+/)
    map.set(name, values.join(' '))
  }
  return map
}

test('the policy allows exactly the inline script and style in this file, by hash', () => {
  const policy = directives()

  // Chromium ignores an unquoted hash, so the quoting is part of the check.
  assert.equal(policy.get('script-src'), `'sha256-${sha256(between('<script>', '</script>'))}'`)
  assert.equal(policy.get('style-src'), `'sha256-${sha256(between('<style>', '</style>'))}'`)
})

test('the policy is deny-by-default and allows no script escape hatch', () => {
  const policy = directives()

  assert.equal(policy.get('default-src'), "'none'")
  // No network of its own: every request goes through the main process.
  assert.equal(policy.get('connect-src'), "'none'")
  assert.equal(policy.get('img-src'), "'none'")
  assert.equal(policy.get('font-src'), "'none'")
  assert.equal(policy.get('form-action'), "'none'")
  assert.equal(policy.get('base-uri'), "'none'")
  assert.equal(policy.get('object-src'), "'none'")

  const raw = metaPolicy()
  for (const loosener of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', 'http:', 'https:', 'ws:', '*']) {
    assert.equal(raw.includes(loosener), false, `the policy must not allow ${loosener}`)
  }
})

test('the page loads nothing from outside itself', () => {
  for (const tag of ['<script src', '<link', '<iframe', '<object', '<embed', '<base', '<form']) {
    assert.equal(HTML.includes(tag), false, `the page must not contain ${tag}`)
  }
  assert.equal(/https?:\/\//i.test(HTML), false, 'the page must not name a remote address')
})

test('the page has no inline event handlers and no script URLs', () => {
  assert.equal(/\son[a-z]+\s*=/i.test(HTML), false, 'an inline handler would need unsafe-inline')
  assert.equal(/javascript:/i.test(HTML), false)
})

test('the view writes results as text, never as markup', () => {
  // Probe results are data. A field that looked like markup must stay text.
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
    assert.equal(between('<script>', '</script>').includes(sink), false, `the view must not use ${sink}`)
  }
  assert.ok(between('<script>', '</script>').includes('textContent'))
})

test('the page lives in the desktop folder and is a local file', () => {
  assert.equal(path.basename(debugPagePath()), DEBUG_PAGE_FILE)
  assert.equal(fs.existsSync(debugPagePath()), true)
  assert.equal(debugPageUrl().startsWith('file:'), true)
})

test('the probe window runs the bridge under isolation, sandboxing and no Node', () => {
  const preferences = probeWindowPreferences()

  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.nodeIntegrationInWorker, false)
  assert.equal(preferences.nodeIntegrationInSubFrames, false)
  assert.equal(preferences.webviewTag, false)
  assert.equal(preferences.webSecurity, true)
  assert.equal(preferences.allowRunningInsecureContent, false)
  assert.equal(preferences.experimentalFeatures, false)
  assert.equal(path.basename(preferences.preload), 'copilot.js')
  assert.equal(path.basename(path.dirname(preferences.preload)), 'preload')
})

test('the probe window shares no session with the signed-in web view', () => {
  // A `persist:` partition writes cookies to disk and would be the wrong place
  // for a debug renderer; `persist:ws` is the web view's, and must stay its own.
  assert.equal(DEBUG_PARTITION.startsWith('persist:'), false)
  assert.notEqual(DEBUG_PARTITION, 'persist:ws')
  assert.equal(probeWindowPreferences().partition, DEBUG_PARTITION)
})

/** Just enough of webContents to see which guards are attached. */
function fakeContents () {
  const listeners = new Map()
  let windowOpenHandler = null

  return {
    on (name, handler) { listeners.set(name, handler) },
    setWindowOpenHandler (handler) { windowOpenHandler = handler },
    fire (name) {
      const handler = listeners.get(name)
      assert.equal(typeof handler, 'function', `no handler for ${name}`)
      const event = {
        defaultPrevented: false,
        preventDefault () { this.defaultPrevented = true },
      }
      handler(event)
      return event
    },
    openWindow (url) {
      assert.equal(typeof windowOpenHandler, 'function', 'no window open handler')
      return windowOpenHandler({ url })
    },
  }
}

test('the probe window refuses every navigation, redirect, webview and popup', () => {
  const contents = fakeContents()
  guardContents(contents)

  for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    const fired = contents.fire(event)
    assert.equal(fired.defaultPrevented, true, `${event} must be refused`)
  }

  for (const url of ['https://example.test', 'file:///C:/Windows/system32/', `${debugPageUrl()}?again=1`]) {
    assert.deepEqual(contents.openWindow(url), { action: 'deny' }, `refusing a popup to ${url}`)
  }
})

/** Just enough of a session to see what the permission handlers say. */
function fakeSession () {
  let requestHandler = null
  let checkHandler = null

  return {
    setPermissionRequestHandler (handler) { requestHandler = handler },
    setPermissionCheckHandler (handler) { checkHandler = handler },
    ask (permission) {
      let answer = null
      requestHandler({}, permission, value => { answer = value })
      return answer
    },
    check (permission) { return checkHandler({}, permission) },
  }
}

test('the probe window is granted no permission at all', () => {
  const probeSession = fakeSession()
  hardenProbeSession(probeSession)

  // Including clipboard, which the web view allows: this view has no copy UI.
  for (const permission of ['clipboard-sanitized-write', 'media', 'geolocation', 'notifications', 'openExternal']) {
    assert.equal(probeSession.ask(permission), false, `granting ${permission}`)
    assert.equal(probeSession.check(permission), false, `checking ${permission}`)
  }
})

test('the guards refuse to attach to something that is not a window or session', () => {
  assert.throws(() => guardContents({}), TypeError)
  assert.throws(() => guardContents(null), TypeError)
  assert.throws(() => hardenProbeSession({}), TypeError)
  assert.throws(() => hardenProbeSession(null), TypeError)
})
