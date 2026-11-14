'use strict'

/*
 * Electron main process for the ZuriCopilot desktop spike.
 *
 * It opens two renderers, and they are deliberately different:
 *
 * - the WorkSpace web app, on the shared `persist:ws` session, with no preload
 *   and no bridge at all (windows.js);
 * - the throwaway probe view, a local file with the narrow bridge from
 *   electron/preload/copilot.js (debug-window.js).
 *
 * The probe itself runs here, never in a renderer: it reads the session cookie
 * the web view earned, so the view has no cookies of its own and no network
 * access. `features/copilot/main/ipc/probe-ipc.js` is the only path between the
 * two, and it trusts exactly one window and one local page.
 *
 * Server selection and the web view's navigation rules live in windows.js.
 *
 * `npm run start:smoke` boots the web view path with the window hidden and
 * exits 0 once a page loads. `npm run probe:smoke` does the same for the probe
 * view: it proves the bridge, both methods and the page policy without a server
 * and without writing anything.
 */

const { app, ipcMain, session } = require('electron')

const {
  CONTRACT_VERSION,
  PROBE_CHANNEL,
  isSanitizedProbeResult,
  sanitizeProbeResult,
} = require('../features/copilot/shared/probe-contract.js')
const { registerProbeIpc } = require('../features/copilot/main/ipc/probe-ipc.js')
const { createWorkspaceProbe } = require('../features/copilot/main/workspace-api/index.js')
const {
  SERVER_URL_ENV,
  SESSION_PARTITION,
  ServerConfigError,
  createWorkSpaceWindow,
  resolveServerConfig,
} = require('./windows.js')
const { createProbeWindow, debugPageUrl } = require('./debug-window.js')

const SMOKE_TEST = process.argv.includes('--smoke-test')
const PROBE_VIEW_SMOKE = process.argv.includes('--probe-view-smoke')
const PROBE_VIEW_FLAG = '--probe-view'
const NO_PROBE_VIEW_FLAG = '--no-probe-view'

// The isolated owner workspace the write probe may use. Set in the environment;
// the probe converts the text to a number once, and refuses anything else.
const PROBE_WORKSPACE_ENV = 'ZURICOPILOT_PROBE_WORKSPACE_ID'

const SMOKE_TIMEOUT_MS = 15000

/**
 * Resolve the server once, before a window exists.
 *
 * A bad WORKSPACE_SERVER_URL is configuration, not a crash: name the variable
 * and the reason in one line and stop, because loading the wrong origin would
 * put a password and a session cookie in the wrong place.
 */
function readServerConfig () {
  try {
    return resolveServerConfig({ env: process.env, isPackaged: app.isPackaged })
  } catch (error) {
    if (error instanceof ServerConfigError) {
      process.stderr.write(`zuricopilot-desktop: ${error.message}\n`)
    } else {
      process.stderr.write(`zuricopilot-desktop: could not resolve ${SERVER_URL_ENV} (${error && error.name})\n`)
    }
    return null
  }
}

function isConfigured () {
  return String(process.env[SERVER_URL_ENV] == null ? '' : process.env[SERVER_URL_ENV]).trim() !== ''
}

/** What the web view loads first: the real app, or the offline placeholder. */
function startUrlFor (config) {
  if (!SMOKE_TEST) return config.url
  return isConfigured() ? config.url : debugPageUrl()
}

/**
 * Whether to open the throwaway probe view.
 *
 * The spike needs it, so it opens in development. A packaged build is not the
 * debug shape, so there it has to be asked for, and either way it can be turned
 * off. Nothing else in the app reads this.
 */
function shouldOpenProbeView (options = {}) {
  const argv = options.argv || process.argv
  if (argv.includes(NO_PROBE_VIEW_FLAG)) return false
  if (options.isPackaged !== true) return true
  return argv.includes(PROBE_VIEW_FLAG)
}

/** The configured probe workspace as text, or null when it was not set. */
function probeWorkspaceIdFrom (env) {
  const raw = env ? env[PROBE_WORKSPACE_ENV] : undefined
  const text = String(raw == null ? '' : raw).trim()
  // A blank value means "not set", so the probe does not warn about a value
  // nobody supplied.
  return text === '' ? null : text
}

/** The probe on the web view's session, so it inherits the sign-in. */
function buildProbe (config, options = {}) {
  return createWorkspaceProbe({
    session: session.fromPartition(SESSION_PARTITION),
    serverUrl: config.origin,
    workspaceId: probeWorkspaceIdFrom(process.env),
    timeoutMs: options.timeoutMs,
  })
}

/**
 * Open the probe view and let one window use the bridge.
 *
 * Registration happens here rather than at startup, so the channel does not
 * exist unless the view that uses it does.
 */
function openProbeView (config) {
  const probe = buildProbe(config)
  const bridge = registerProbeIpc({ ipcMain, runProbe: action => probe.run(action) })
  const view = createProbeWindow({ config, show: true })

  bridge.trust(view.webContents, debugPageUrl())
  view.on('closed', () => bridge.dispose())

  return view
}

/**
 * An answer shaped like a successful probe, with no request behind it.
 *
 * Used only by the probe view's own smoke check, so the bridge, both methods
 * and the page policy can be proven with no server running and without creating
 * a task anywhere.
 */
function createFixtureProbe () {
  return {
    async run (action) {
      const write = action === 'write'
      return {
        action,
        status: 'ok',
        errorCode: null,
        httpStatus: write ? 201 : 200,
        cleanupHttpStatus: write ? 200 : null,
        durationMs: 12,
        checkedAt: new Date().toISOString(),
        workspaceCount: 1,
        workspaceId: 7,
        taskCreated: write ? true : null,
        taskDeleted: write ? true : null,
      }
    },
  }
}

// Runs in the probe view, after the preload has installed the bridge.
//
// Each check is a property the acceptance criteria name: the bridge exists and
// exposes only its two methods, the page has no Node and no raw IPC, a read and
// a write both round-trip, nothing credential-shaped comes back, an injected
// inline script cannot run, and the page cannot navigate.
const PROBE_VIEW_SMOKE_SCRIPT = `(async () => {
  const report = {
    bridge: false,
    noNodeAccess: false,
    viewReady: false,
    readOk: false,
    writeOk: false,
    clean: false,
    viewShowsOutcome: false,
    viewShowsCleanup: false,
    inlineScriptBlocked: false,
    networkBlocked: false,
    navigationBlocked: false,
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const rows = () => document.querySelectorAll('#rows tr')

  const api = window.copilot && window.copilot.probe
  report.bridge = Boolean(api && typeof api.read === 'function' && typeof api.write === 'function')
  report.noNodeAccess = typeof window.require === 'undefined' &&
    typeof window.process === 'undefined' &&
    typeof window.module === 'undefined' &&
    Boolean(window.copilot) &&
    window.copilot.ipcRenderer === undefined &&
    window.copilot.invoke === undefined &&
    Boolean(api) &&
    api.invoke === undefined &&
    api.send === undefined &&
    api.on === undefined

  const state = document.getElementById('bridge-state')
  const readButton = document.getElementById('run-read')
  report.viewReady = Boolean(state && state.textContent.indexOf('Bridge ready') === 0 &&
    readButton && readButton.disabled === false && rows().length === 12)

  if (api) {
    const read = await api.read()
    report.readOk = Boolean(read && read.contractVersion === 1 && read.action === 'read' && read.status === 'ok')
    const write = await api.write()
    report.writeOk = Boolean(write && write.action === 'write' && write.taskCreated === true && write.taskDeleted === true)
    const seen = JSON.stringify([read, write])
    report.clean = !/csrf|cookie|sessionid|password|authorization|bearer/i.test(seen)
  }

  // Drive the view the way a person does, and read the table it renders.
  readButton.click()
  await wait(300)
  report.viewShowsOutcome = rows().length === 12 && rows()[2].children[1].textContent === 'ok'

  document.getElementById('run-write').click()
  await wait(300)
  report.viewShowsCleanup = rows().length === 12 &&
    rows()[10].children[1].textContent === 'true' &&
    rows()[11].children[1].textContent === 'true'

  // Watch for a blocked connect before trying one. Violation events are queued,
  // so the listener has to be in place first, and only connect-src counts: the
  // inline-script check below raises its own violation.
  let connectBlocked = false
  document.addEventListener('securitypolicyviolation', event => {
    if (event.violatedDirective === 'connect-src') connectBlocked = true
  })

  // An inline script without the pinned hash must not run.
  const injected = document.createElement('script')
  injected.textContent = 'window.__cspRan = true'
  document.body.appendChild(injected)
  report.inlineScriptBlocked = window.__cspRan === undefined

  // No network of its own: the attempt must be refused by the policy, not by a
  // connection that happens to fail.
  try { await fetch('http://127.0.0.1:9/csp-check') } catch (error) {}
  await wait(150)
  report.networkBlocked = connectBlocked

  try { window.location.href = 'https://example.test/probe-navigation' } catch (error) {}
  await wait(250)
  report.navigationBlocked = window.location.protocol === 'file:'

  return report
})()`

function onceLoaded (contents) {
  return new Promise((resolve, reject) => {
    contents.once('did-finish-load', resolve)
    contents.once('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame) reject(new Error(`load failed ${errorCode}`))
    })
  })
}

async function runProbeViewSmoke (config) {
  const timeout = setTimeout(() => {
    process.stderr.write(`zuricopilot-desktop: probe view did not load within ${SMOKE_TIMEOUT_MS}ms\n`)
    app.exit(1)
  }, SMOKE_TIMEOUT_MS)

  try {
    const probe = createFixtureProbe()
    const bridge = registerProbeIpc({ ipcMain, runProbe: action => probe.run(action) })
    const view = createProbeWindow({ config, show: false })
    bridge.trust(view.webContents, debugPageUrl())

    await onceLoaded(view.webContents)
    const report = await view.webContents.executeJavaScript(PROBE_VIEW_SMOKE_SCRIPT, true)

    // The real probe, through the same session, must also produce an outcome the
    // boundary accepts. It talks to the configured server, so what it reports
    // depends on what is running; that its shape fits the contract does not.
    // The short timeout keeps a wedged dev server from turning this check into a
    // timeout of its own.
    const realOutcome = await buildProbe(config, { timeoutMs: 3000 }).run('read')
    report.realProbeFitsContract = isSanitizedProbeResult(sanitizeProbeResult(realOutcome))
    clearTimeout(timeout)

    const failed = Object.keys(report).filter(key => report[key] !== true)
    process.stdout.write(
      `zuricopilot-desktop probe-view electron=${process.versions.electron} ` +
      `contract=${CONTRACT_VERSION} channel=${PROBE_CHANNEL} ${JSON.stringify(report)}\n`,
    )
    if (failed.length > 0) {
      process.stderr.write(`zuricopilot-desktop: probe view check failed: ${failed.join(',')}\n`)
    }
    app.exit(failed.length === 0 ? 0 : 1)
  } catch (error) {
    clearTimeout(timeout)
    process.stderr.write(`zuricopilot-desktop: probe view smoke failed (${(error && error.name) || 'unknown'})\n`)
    app.exit(1)
  }
}

function runSmokeTest (config) {
  const timeout = setTimeout(() => {
    // A page that never loads is a failure, not a slow start.
    process.stderr.write(`zuricopilot-desktop: nothing loaded within ${SMOKE_TIMEOUT_MS}ms\n`)
    app.exit(1)
  }, SMOKE_TIMEOUT_MS)

  const window = createWorkSpaceWindow({ config, url: startUrlFor(config) })

  let reported = false
  // `on`, not `once`: a failed subframe must not consume the handler before the
  // main frame has had its say.
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || reported) return
    reported = true
    clearTimeout(timeout)
    process.stderr.write(`zuricopilot-desktop: load failed code=${errorCode} description=${errorDescription}\n`)
    app.exit(1)
  })

  window.webContents.once('did-finish-load', () => {
    if (reported) return
    reported = true
    clearTimeout(timeout)
    process.stdout.write(
      `zuricopilot-desktop ready electron=${process.versions.electron} node=${process.versions.node} ` +
      `server=${config.origin} partition=${SESSION_PARTITION} ` +
      `contract=${CONTRACT_VERSION} channel=${PROBE_CHANNEL}\n`,
    )
    app.exit(0)
  })
}

app.whenReady().then(() => {
  const config = readServerConfig()
  if (!config) {
    app.exit(1)
    return
  }

  if (SMOKE_TEST) {
    runSmokeTest(config)
    return
  }

  if (PROBE_VIEW_SMOKE) {
    runProbeViewSmoke(config)
    return
  }

  createWorkSpaceWindow({ config }).once('ready-to-show', function () {
    this.show()
  })

  if (shouldOpenProbeView({ argv: process.argv, isPackaged: app.isPackaged })) {
    openProbeView(config)
  }
}).catch(error => {
  // A failure before a window exists would otherwise close with no explanation.
  process.stderr.write(`zuricopilot-desktop: failed to start (${(error && error.name) || 'unknown'})\n`)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
