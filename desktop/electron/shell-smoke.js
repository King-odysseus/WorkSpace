'use strict'

/*
 * The shell's smoke test: real Electron, real views, no server.
 *
 * What it is for: the three modes are one arithmetic function plus a set of view
 * rectangles, and the only way to know Electron accepted those rectangles is to
 * ask it. So this runs a real BaseWindow, loads the real built pages, switches
 * modes through the same controller the rail and the menu use, and reads back
 * what each view actually got.
 *
 * It is deliberately not a unit test with Electron stubbed: the failures worth
 * catching here are the ones stubs cannot have, such as a view that never paints
 * because the page was loaded without its hash, or a resize that leaves the dock
 * at its old width.
 *
 * The window stays hidden. Layout, loading, focus and close-to-tray all work
 * without painting on screen, and a smoke test that flashes a window is a smoke
 * test nobody runs.
 */

const fs = require('node:fs')
const path = require('node:path')

const { runChatScreenChecks } = require('./smoke-chat.js')
const { runControlChecks } = require('./smoke-controls.js')

const MAIN_SOURCE = path.join(__dirname, 'main.js')

/** Every check is one sentence: what was asked, and what came back. */
function check (report, name, passed, detail) {
  report.checks[name] = { passed: Boolean(passed), detail: detail === undefined ? null : detail }
  if (!passed) report.failed.push(name)
}

function sameRect (actual, expected) {
  if (!actual || !expected) return false
  return actual.x === expected.x &&
    actual.y === expected.y &&
    actual.width === expected.width &&
    actual.height === expected.height
}

function viewVisible (view) {
  if (view && typeof view.getVisible === 'function') return view.getVisible()
  return null
}

function flattenMenuItems (items, out = []) {
  for (const item of items || []) {
    out.push(item)
    // submenu is a Menu, not an array, so its items have to be walked through.
    if (item.submenu && Array.isArray(item.submenu.items)) flattenMenuItems(item.submenu.items, out)
  }
  return out
}

/** Read a value out of a local view's page. Never throws: a missing page is a failed check. */
async function readFrom (view, script, fallback) {
  try {
    return await view.webContents.executeJavaScript(script, true)
  } catch {
    return fallback
  }
}

function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Read a value out of a page until it says what is expected.
 *
 * The page has to fetch its state and React has to render it, so a read taken in
 * the same tick as a mode change sees the previous frame. Waiting for the value
 * rather than sleeping a guessed number of milliseconds keeps the test honest
 * about what it is proving: the page eventually shows this mode.
 */
async function waitForValue (view, script, expected, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await readFrom(view, script, null)
    if (last === expected) return last
    await wait(50)
  }
  return last
}

/**
 * Wait until a view has the rectangle it should.
 *
 * Reading immediately after a resize only proves the function is correct; it
 * says nothing about whether the resize handler ran. Polling for the rectangle
 * means a view left at its old size fails here instead of passing on a
 * layout the test computed itself.
 */
async function waitForRect (view, expected, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = view.getBounds()
    if (sameRect(last, expected)) return last
    await wait(50)
  }
  return last
}

/** Wait until the window reports the content size that was asked for. */
async function waitForContentSize (win, width, height, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = win.getContentBounds()
    if (last.width === width && last.height === height) return last
    await wait(50)
  }
  return last
}

/**
 * Wait for the assistant to stop saying "not checked yet".
 *
 * The access state arrives over IPC after the page paints, so a read taken in the
 * same tick as the mode change still sees `pending`. Polling for anything else
 * keeps this honest about what it proves: the page settles on a state, rather than
 * the test guessing how long that takes.
 */
async function waitForAccessState (view, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await readFrom(view,
      `(() => { const el = document.querySelector('[data-shell="copilot"]'); return el ? el.dataset.accessState : null })()`,
      null)
    if (last !== null && last !== 'pending') return last
    await wait(50)
  }
  return last
}

/**
 * A locked assistant: the gate, and nothing that belonged to the session.
 *
 * Checked by absence as much as by presence. A cleared session that left a nav row
 * or a Models screen behind would be the failure this exists for, and it is also
 * the shape a reply from the previous account would take if one ever got through.
 */
async function checkAssistantIsLocked (view, report) {
  const locked = await readFrom(view, `(() => {
    const root = document.querySelector('[data-shell="copilot"]')
    return {
      accessState: root ? root.dataset.accessState : null,
      gate: document.querySelector('[data-access="gate"]') !== null,
      panel: document.querySelector('[data-access="panel"]') !== null,
      navRows: document.querySelectorAll('[data-shell^="copilot-"]').length,
      modelsScreen: document.querySelector('[data-shell="models-screen"]') !== null,
    }
  })()`, null)

  check(report, 'lockedShowsTheGate', locked !== null && locked.gate === true, locked)
  check(report, 'lockedHidesAssistantContent',
    locked !== null &&
      locked.panel === false &&
      locked.navRows === 0 &&
      locked.modelsScreen === false,
    locked)
}

/**
 * An unlocked assistant: the rail and the Models screen, or, until a workspace is
 * chosen, the list that chooses one.
 */
async function checkAssistantSurface (view, report) {
  const railExists = await readFrom(view,
    `document.querySelector('[data-shell="copilot-models"]') !== null`, false)

  if (!railExists) {
    /*
     * Unlocked with nothing chosen. The panel is the screen until a workspace is
     * picked, and the rail is deliberately absent because there is nothing to
     * navigate yet.
     */
    const panel = await readFrom(view, `(() => ({
      panel: document.querySelector('[data-access="panel"]') !== null,
      modelsScreen: document.querySelector('[data-shell="models-screen"]') !== null,
    }))()`, null)
    check(report, 'unlockedWithoutAWorkspaceShowsTheList',
      panel !== null && panel.panel === true && panel.modelsScreen === false, panel)
    return
  }

  const modelsOpened = await readFrom(view, `(async () => {
    const nav = document.querySelector('[data-shell="copilot-models"]')
    if (!nav) return { found: false }
    nav.click()

    /*
     * The screen reads its state over IPC, so it draws a "reading" line first.
     * Poll for the settled screen rather than guessing a timeout: a fixed wait is
     * the kind of check that passes on a fast machine and fails in CI.
     */
    const deadline = Date.now() + 3000
    let screen = null
    while (Date.now() < deadline) {
      screen = document.querySelector('[data-shell="models-screen"]')
      if (screen !== null && !screen.textContent.includes('Reading model settings')) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    return {
      found: true,
      current: nav.getAttribute('aria-current'),
      screen: screen !== null,
      heading: screen === null ? null : screen.querySelector('h1').textContent,
      hasRows: screen !== null && screen.querySelector('[data-shell="models-row"]') !== null,
      hasPresetPicker: document.querySelector('[data-shell="models-preset"]') !== null,
      askedToSignIn: screen === null
        ? false
        : screen.textContent.includes('Sign in through the WorkSpace window'),
      settled: screen === null ? false : !screen.textContent.includes('Reading model settings'),
    }
  })()`, { found: false })

  check(report, 'modelsNavIsAControl', modelsOpened.found === true, modelsOpened)
  check(report, 'modelsScreenDraws', modelsOpened.screen === true && modelsOpened.heading === 'Models', modelsOpened)
  check(report, 'modelsNavMarked', modelsOpened.current === 'page', modelsOpened)
  /*
   * No provider is configured in this window, so there must be no model list and
   * no connection line. That holds whatever the session turns out to be: a
   * connection claimed before a provider exists is the state this check exists to
   * catch.
   */
  check(report, 'modelsNeedsAProviderFirst',
    modelsOpened.settled === true && modelsOpened.hasRows === false,
    modelsOpened)
  // The catalogue is readable before anything is saved, so the form is shown.
  check(report, 'modelsShowsCatalog', modelsOpened.hasPresetPicker === true, modelsOpened)

  /*
   * Choosing a provider reveals its fields, and the key field is masked. Both are
   * worth checking in the real window because both are decided by React state
   * rather than by anything a node test can reach.
   */
  const modelsForm = await readFrom(view, `(async () => {
    const select = document.querySelector('[data-shell="models-preset"]')
    if (!select) return { found: false }

    const first = Array.from(select.options).find(option => option.value !== '')
    if (!first) return { found: true, catalogued: false }

    // React tracks the value on the element, so the setter has to be the native
    // one, then a bubbling change event is what React listens for.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, first.value)
    select.dispatchEvent(new Event('change', { bubbles: true }))

    const deadline = Date.now() + 2000
    let secret = null
    while (Date.now() < deadline) {
      secret = document.querySelector('[data-shell="models-secret"]')
      if (secret !== null) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    return {
      found: true,
      catalogued: true,
      preset: first.value,
      address: document.querySelector('[data-shell="models-base-url"]') !== null,
      masked: secret === null ? null : secret.getAttribute('type'),
    }
  })()`, { found: false })

  check(report, 'modelsFormOpensForAPreset',
    modelsForm.found === true && modelsForm.catalogued === true && modelsForm.address === true,
    modelsForm)
  // A key typed into a visible field is a key on a shared screen.
  check(report, 'modelsKeyFieldIsMasked', modelsForm.masked === 'password', modelsForm)

  const modelsBackHome = await readFrom(view, `(async () => {
    const home = document.querySelector('[data-shell="copilot-home"]')
    if (!home) return null
    home.click()
    await new Promise(resolve => setTimeout(resolve, 150))
    return {
      screenGone: document.querySelector('[data-shell="models-screen"]') === null,
      homeMarked: home.getAttribute('aria-current'),
    }
  })()`, null)

  check(report, 'modelsReturnsHome', modelsBackHome !== null && modelsBackHome.screenGone === true, modelsBackHome)
  check(report, 'homeNavMarked', modelsBackHome !== null && modelsBackHome.homeMarked === 'page', modelsBackHome)
}

async function runShellSmoke (options) {
  const {
    app,
    createShellWindow,
    config,
    placeholderUrl,
    timeoutMs = 20000,
  } = options

  const report = { ok: false, checks: {}, failed: [] }
  const controller = createShellWindow({
    config,
    url: placeholderUrl,
    show: false,
    tray: true,
    width: 1440,
    height: 900,
  })

  try {
    await controller.waitForViews(timeoutMs)

    // A window that never becomes ready is a window that never appears, which is
    // how the shell used to launch: hidden, waiting for an event that does not
    // exist for a BaseWindow.
    const readyInTime = await Promise.race([
      controller.whenReady().then(() => true),
      wait(4000).then(() => false),
    ])
    check(report, 'startupBecomesReady', readyInTime === true, readyInTime)

    const { chrome, web, copilot } = controller.views
    const webUrlAtStart = web.webContents.getURL()

    check(report, 'chromePage', chrome.webContents.getURL().endsWith('#chrome'), chrome.webContents.getURL())
    check(report, 'copilotPage', copilot.webContents.getURL().endsWith('#copilot'), copilot.webContents.getURL())
    check(report, 'webViewLoaded', webUrlAtStart === placeholderUrl, webUrlAtStart)

    // The web app must still be the hardened renderer on the signed-in partition.
    const { session } = require('electron')
    check(report, 'webPartition',
      web.webContents.session === session.fromPartition('persist:ws'),
      'persist:ws')
    check(report, 'webViewNoPreload', !web.webContents.getPreloadPath || web.webContents.getPreloadPath() === null)

    // Workspace mode: the web app fills the content area, the dock is off screen.
    const bounds = controller.window.getContentBounds()
    const workspace = controller.layout()
    check(report, 'workspaceLayoutMatches', sameRect(web.getBounds(), workspace.web), {
      web: web.getBounds(), expected: workspace.web,
    })
    check(report, 'workspaceDockHidden',
      viewVisible(copilot) === false || sameRect(copilot.getBounds(), { x: 0, y: 0, width: 0, height: 0 }),
      viewVisible(copilot))
    check(report, 'chromeCoversWindow', sameRect(chrome.getBounds(), { x: 0, y: 0, width: bounds.width, height: bounds.height }),
      chrome.getBounds())

    // The chrome actually painted a rail and says which mode it is in.
    const railMode = await waitForValue(chrome,
      `(() => { const root = document.querySelector('[data-mode]'); return root ? root.dataset.mode : null })()`,
      'workspace')
    const railState = await readFrom(chrome,
      `(() => {
        const rail = document.querySelector('[data-shell="rail"]')
        const dockToggle = document.querySelector('[data-shell="dock-toggle"]')
        return { rail: Boolean(rail), dockToggle: Boolean(dockToggle) }
      })()`, { rail: false, dockToggle: false })
    check(report, 'chromeRailRendered', railState.rail && railState.dockToggle, railState)
    check(report, 'chromeShowsWorkspace', railMode === 'workspace', railMode)

    // Dock: 360px on the right, web app narrowed, both on screen.
    const docked = controller.toggleDock()
    const layout = controller.layout()
    check(report, 'dockStateOpen', docked.dockOpen === true && datasetSafe(docked), docked)
    check(report, 'dockWidth', layout.copilot && layout.copilot.width === 360, layout.copilot)
    check(report, 'dockAtRightEdge', layout.copilot && layout.copilot.x + layout.copilot.width === bounds.width, layout.copilot)
    check(report, 'dockBoundsMatch', sameRect(copilot.getBounds(), layout.copilot), {
      actual: copilot.getBounds(), expected: layout.copilot,
    })
    check(report, 'webNarrowed', sameRect(web.getBounds(), layout.web), {
      actual: web.getBounds(), expected: layout.web,
    })

    // The dock draws its compact shape, and the rail shows the toggle as on.
    const dockSurface = await waitForValue(copilot,
      `(() => { const root = document.querySelector('[data-shell="copilot"]'); return root ? root.dataset.surface : null })()`,
      'dock')
    check(report, 'dockDrawsCompactSurface', dockSurface === 'dock', dockSurface)
    const railDocked = await waitForValue(chrome,
      `(() => { const el = document.querySelector('[data-shell="dock-toggle"]'); return el ? el.getAttribute('aria-pressed') : null })()`,
      'true')
    check(report, 'railShowsDockOn', railDocked === 'true', railDocked)

    // ZuriCopilot mode: the web app is off screen but still loaded, on the same page.
    const copilotState = controller.setMode('copilot')
    const copilotLayout = controller.layout()
    check(report, 'copilotMode', copilotState.mode === 'copilot', copilotState)
    check(report, 'copilotFillsContent', sameRect(copilot.getBounds(), copilotLayout.copilot), {
      actual: copilot.getBounds(), expected: copilotLayout.copilot,
    })
    check(report, 'webHiddenInCopilotMode',
      viewVisible(web) === false || copilotLayout.web === null, viewVisible(web))
    const fullSurface = await waitForValue(copilot,
      `(() => { const root = document.querySelector('[data-shell="copilot"]'); return root ? root.dataset.surface : null })()`,
      'full')
    check(report, 'copilotDrawsFullSurface', fullSurface === 'full', fullSurface)
    check(report, 'webSessionKept', web.webContents.getURL() === webUrlAtStart, web.webContents.getURL())

    /*
     * The Models destination inside the assistant.
     *
     * What can be proved here depends on whether this window holds a signed-in
     * session, and a smoke test may not assume one: the session is whatever the
     * machine happens to have. So the assistant's own access state is read first
     * and the checks follow it, instead of the run failing whenever the person is
     * signed out.
     *
     * Locked is not a skip. A locked window must draw the gate and none of the
     * assistant's own controls, which is the access-loss proof. The rail, the
     * Models screen and its form are then proved on a window that is genuinely
     * unlocked, and the panel case is proved when a session exists but no
     * workspace has been chosen.
     */
    const accessState = await waitForAccessState(copilot)

    if (accessState === 'locked') {
      await checkAssistantIsLocked(copilot, report)
    } else if (accessState === 'ready') {
      await checkAssistantSurface(copilot, report)
    } else {
      // 'unverified', or a state that never settled. Neither may read as allowed.
      check(report, 'assistantAccessStateIsVerifiable', false, accessState)
    }

    // Back to Workspace: the dock flag the person had is restored.
    const back = controller.setMode('workspace')
    check(report, 'dockRestored', back.dockOpen === true && back.mode === 'workspace', back)
    check(report, 'dockBackOnScreen', sameRect(copilot.getBounds(), controller.layout().copilot), copilot.getBounds())

    // A resize must re-run the layout, not leave the views at their old size.
    // No applyLayout() call here on purpose: the resize handler is what is
    // being tested, so the views have to move on their own.
    controller.window.setContentSize(900, 700)
    const small = await waitForContentSize(controller.window, 900, 700)
    const smallLayout = controller.layout()
    const resizedWeb = await waitForRect(web, smallLayout.web)
    check(report, 'resizeWebMatches', sameRect(resizedWeb, smallLayout.web), {
      actual: resizedWeb, expected: smallLayout.web, content: small,
    })
    const resizedDock = await waitForRect(copilot, smallLayout.copilot)
    check(report, 'resizeDockFollowsLayout', sameRect(resizedDock, smallLayout.copilot), {
      actual: resizedDock, expected: smallLayout.copilot,
    })
    check(report, 'resizeDockStillAtEdge',
      smallLayout.copilot && smallLayout.copilot.x + smallLayout.copilot.width === small.width,
      { copilot: smallLayout.copilot, width: small.width })

    // The palette is the main process's call, and both local pages must adopt
    // it: a dark shell that keeps light tokens is the failure this catches.
    const { nativeTheme } = require('electron')
    const previousThemeSource = nativeTheme.themeSource
    nativeTheme.themeSource = 'dark'
    const darkTheme = await waitForValue(chrome, `document.documentElement.dataset.theme`, 'dark')
    check(report, 'themeFollowsNative', darkTheme === 'dark', darkTheme)
    const darkClass = await readFrom(chrome, `document.documentElement.classList.contains('dark')`, false)
    check(report, 'darkClassApplied', darkClass === true, darkClass)
    const dockTheme = await waitForValue(copilot, `document.documentElement.dataset.theme`, 'dark')
    check(report, 'dockThemeFollowsNative', dockTheme === 'dark', dockTheme)
    nativeTheme.themeSource = 'light'
    const lightTheme = await waitForValue(chrome, `document.documentElement.dataset.theme`, 'light')
    check(report, 'themeReturnsToLight', lightTheme === 'light', lightTheme)
    nativeTheme.themeSource = previousThemeSource

    // The native menu carries the dock shortcut, and the tray exists.
    const accelerators = flattenMenuItems(controller.menu ? controller.menu.items : [])
      .map(item => item.accelerator)
      .filter(Boolean)
    check(report, 'menuHasDockShortcut', accelerators.includes('CmdOrCtrl+Shift+D'), accelerators)
    const quitItems = flattenMenuItems(controller.menu ? controller.menu.items : [])
      .filter(item => item.role === 'quit' || item.accelerator === 'Ctrl+Q')
    check(report, 'menuHasExplicitQuit', quitItems.length > 0, quitItems.map(item => item.label))
    check(report, 'trayCreated', controller.tray !== null && controller.tray !== undefined)

    // Close hides to the tray instead of ending the app; showing it again works.
    controller.window.close()
    await wait(150)
    check(report, 'closeHidesToTray', !controller.window.isDestroyed() && !controller.window.isVisible(), {
      destroyed: controller.window.isDestroyed(), visible: controller.window.isVisible(),
    })
    controller.show()
    await wait(100)
    check(report, 'restoreFromTray', controller.window.isVisible(), controller.window.isVisible())

    // The bridge is reachable from the chrome page and absent from the web view.
    const chromeBridge = await readFrom(chrome, `typeof window.zuriShell === 'object'`, false)
    check(report, 'chromeHasShellBridge', chromeBridge === true, chromeBridge)
    const webBridge = await readFrom(web, `typeof window.zuriShell === 'undefined' && typeof window.copilot === 'undefined'`, false)
    check(report, 'webViewHasNoBridge', webBridge === true, webBridge)

    // A second copy cannot own the tray. This cannot be spawned from inside the
    // process, so the guard is read from source: both halves must be present.
    const mainSource = fs.readFileSync(MAIN_SOURCE, 'utf8')
    check(report, 'singleInstanceGuard',
      mainSource.includes('requestSingleInstanceLock()') && mainSource.includes("'second-instance'"),
      null)

    /*
     * The conversation screen, in the shapes it is drawn in.
     *
     * It gets its own window with stub bridges, because the screen needs a session,
     * a business and a provider, and none of those belong in a smoke test that boots
     * the shell without a server. The checks live in their own module so this file
     * stays a list of what the shell proves; see `smoke-chat.js` for what it asserts.
     */
    await runChatScreenChecks(report)

    /*
     * The controls, measured rather than counted.
     *
     * Existence is not the claim: five visibility defects shipped past checks that
     * only asked whether a button was in the DOM. This module reads computed style,
     * bounding boxes and hit testing in real windows, so a control that is present,
     * sized, styled and covered is a failure. See `smoke-controls.js`.
     */
    await runControlChecks(report)
  } finally {
    controller.dispose()
    if (controller.window && !controller.window.isDestroyed()) controller.window.destroy()
  }

  report.ok = report.failed.length === 0
  if (!report.ok) app.exitCode = 1
  return report
}

/** The state object is plain data; this only documents that assumption. */
function datasetSafe (state) {
  return state && typeof state === 'object' && typeof state.mode === 'string'
}

module.exports = { runShellSmoke, sameRect, flattenMenuItems }
