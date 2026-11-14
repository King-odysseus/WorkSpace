'use strict'

/*
 * The throwaway probe window (plan section 19, Phase 0).
 *
 * It shows one local HTML file and the two bridge methods from
 * `electron/preload/copilot.js`. It is not a product screen and it is not the
 * WorkSpace web view: the web view lives in windows.js and deliberately gets no
 * preload at all.
 *
 * Why this window is separate from the web view, in security terms:
 *
 * - Its own session partition, and a non-persistent one. The signed-in cookies
 *   live in `persist:ws`; this renderer never sees that jar, and nothing it does
 *   can write to it. The main process does every request, so the view needs no
 *   session of its own.
 * - It never navigates. `will-navigate` and `will-redirect` are refused outright
 *   rather than compared against an allow list, because the page has nowhere to
 *   go: it is one local file with no links.
 * - It opens no windows, embeds no webview and asks for no permissions. The
 *   permission handlers on its session refuse everything, including clipboard.
 * - The page carries its own Content-Security-Policy as a meta tag, because a
 *   file:// response has no header to rewrite. `debug.html` allows exactly one
 *   inline script and one inline style block by hash, so the tests can recompute
 *   both digests from the file.
 *
 * Electron is required inside the function that builds the window, so the pure
 * helpers below can be checked by the test runner with no Electron runtime.
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Not `persist:`, so this partition keeps nothing on disk and shares nothing
// with the signed-in web view.
const DEBUG_PARTITION = 'spike-probe-view'

const DEBUG_PAGE_FILE = 'debug.html'

function debugPagePath () {
  return path.join(__dirname, DEBUG_PAGE_FILE)
}

function debugPageUrl () {
  return pathToFileURL(debugPagePath()).href
}

/**
 * Every switch this renderer runs under, stated rather than assumed.
 *
 * The preload is the one difference from the web view: this window is the only
 * place the Copilot bridge is exposed, and `nodeIntegration` stays off so the
 * page itself still has no Node access.
 */
function probeWindowPreferences (preloadPath = path.join(__dirname, 'preload', 'copilot.js')) {
  return Object.freeze({
    partition: DEBUG_PARTITION,
    preload: preloadPath,
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

/**
 * Refuse every permission this view could ask for.
 *
 * Phase 0 needs none of them, and the list is not a place to guess: refusing all
 * is the only answer that stays correct when Electron adds a permission. Kept
 * separate from window creation so a test can drive it without Electron.
 */
function hardenProbeSession (probeSession) {
  if (!probeSession || typeof probeSession.setPermissionRequestHandler !== 'function') {
    throw new TypeError('hardenProbeSession needs a session')
  }
  probeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  probeSession.setPermissionCheckHandler(() => false)
}

/**
 * Block every way this page could leave its own document.
 *
 * The page has no links, so a navigation is either a mistake or an attempt. It
 * is refused outright rather than compared against an allow list, because there
 * is no destination this view is allowed to reach.
 */
function guardContents (contents) {
  if (!contents || typeof contents.on !== 'function') {
    throw new TypeError('guardContents needs a webContents')
  }
  const deny = event => event.preventDefault()
  contents.on('will-navigate', deny)
  contents.on('will-redirect', deny)
  contents.on('will-attach-webview', deny)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/**
 * Create the probe window.
 *
 * @param {object} [options]
 * @param {boolean} [options.show] true to show it at once; the smoke check keeps
 *   it hidden so a test run does not leave a window on someone's desktop
 * @returns {object} the BrowserWindow
 */
function createProbeWindow (options = {}) {
  const electron = require('electron')
  const { BrowserWindow, session } = electron

  hardenProbeSession(session.fromPartition(DEBUG_PARTITION))

  const probeWindow = new BrowserWindow({
    width: 720,
    height: 640,
    minWidth: 520,
    minHeight: 420,
    show: options.show === true,
    backgroundColor: '#000D3D',
    title: 'ZuriCopilot probe (spike)',
    webPreferences: probeWindowPreferences(),
  })

  const contents = probeWindow.webContents
  guardContents(contents)

  contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return
    process.stderr.write(`zuricopilot-desktop: probe view failed code=${errorCode} description=${errorDescription}\n`)
  })

  probeWindow.loadURL(debugPageUrl()).catch(() => {
    // did-fail-load has already said why.
  })

  return probeWindow
}

module.exports = {
  DEBUG_PARTITION,
  DEBUG_PAGE_FILE,
  debugPagePath,
  debugPageUrl,
  probeWindowPreferences,
  hardenProbeSession,
  guardContents,
  createProbeWindow,
}
