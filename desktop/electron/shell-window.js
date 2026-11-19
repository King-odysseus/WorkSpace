'use strict'

/*
 * The desktop shell: one frameless window, three views.
 *
 * Why a BaseWindow with child views rather than a BrowserWindow with frames:
 *
 * - The web app must keep its own hardened renderer on `persist:ws`, with no
 *   preload and no bridge. A view is exactly that renderer, and it survives a
 *   mode change instead of being destroyed and rebuilt, which is what keeps the
 *   signed-in session, scroll position and any open dialog.
 * - The chrome is a local page that draws the title bar and the rail. It is a
 *   second view, so it cannot be scripted by the web app and the web app cannot
 *   be scripted by it.
 * - The dock is the same local ZuriCopilot page in a 360px column, so it is a
 *   third view of the same bundle, not a third kind of window.
 *
 * Everything geometric comes from `computeShellLayout`, and everything about
 * mode comes from `session.ts`. This file only applies those answers to views:
 * it decides nothing about the product, so the smoke test can compare what
 * Electron did with the same pure functions the menu and the rail use.
 *
 * Electron is required inside the functions that build windows, so the pure
 * helpers and the tests never need an Electron runtime.
 */

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const {
  computeShellLayout,
  createShellSession,
  describeShellState,
  setShellMode,
  toggleShellDock,
  buildMenuTemplate,
  buildTrayMenuTemplate,
  trayTooltip,
  registerShellIpc,
  shellPageHash,
  createAccessController,
  createAccessService,
  createAccessStore,
  createWorkspaceClient,
  registerAccessIpc,
  createCredentialEntry,
  createCredentialStore,
  createEgressGuard,
  createGuardedTransport,
  createKeychain,
  createProviderSettingsService,
  createBusinessStore,
  createSecretFileStore,
  registerProviderIpc,
  createChatService,
  registerChatIpc,
  systemResolve,
} = require('../build/main/ipc.cjs')

const { createWebView, SESSION_PARTITION } = require('./windows.js')

/*
 * The local views get their own session, and it does not persist: nothing they
 * do should outlive the app, and they must never see the web app's cookie jar.
 */
const LOCAL_PARTITION = 'spike-shell'

const SHELL_PAGE_FILE = path.join(__dirname, '..', 'build', 'renderer', 'index.html')
const SHELL_PRELOAD_FILE = path.join(__dirname, 'preload', 'shell.js')
const TRAY_ICON_FILE = path.join(__dirname, '..', 'assets', 'tray.png')
const WINDOW_ICON_FILE = path.join(__dirname, '..', 'assets', 'icon.png')

const MIN_WIDTH = 880
const MIN_HEIGHT = 600

function shellPagePath () {
  return SHELL_PAGE_FILE
}

/** The exact URL a view loads, hash included: the trust check compares the hash. */
function shellPageUrl (view) {
  return pathToFileURL(SHELL_PAGE_FILE).href + shellPageHash(view)
}

/**
 * A local view's switches, stated rather than assumed.
 *
 * The preload is the one addition over the web view: it exposes two named
 * bridges with fixed methods and nothing else, `nodeIntegration` stays off, and
 * the page is a local file whose own meta policy allows no inline script and no
 * network. The partition is non-persistent, so these views cannot inherit or
 * leave a session.
 */
function localViewPreferences () {
  return Object.freeze({
    partition: LOCAL_PARTITION,
    preload: SHELL_PRELOAD_FILE,
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
 * A local view has nowhere to go and nothing to open.
 *
 * Refusing navigation outright rather than comparing against an allow list is
 * the stronger rule: the page is one local file, so any navigation is a bug or
 * an attack, and there is no destination worth naming.
 */
function installLocalViewGuards (contents) {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-redirect', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.on('did-fail-load', (_event, errorCode, errorDescription, url, isMainFrame) => {
    if (!isMainFrame) return
    process.stderr.write(`zuricopilot-desktop: local view failed to load code=${errorCode} description=${errorDescription}\n`)
  })
}

/** Nothing a local page may ask the desktop for. */
function hardenLocalSession (electronSession) {
  electronSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  electronSession.setPermissionCheckHandler(() => false)
}

function readImage (nativeImage, file) {
  try {
    const image = nativeImage.createFromPath(file)
    return image.isEmpty() ? null : image
  } catch {
    return null
  }
}

/**
 * Build the shell window.
 *
 * options.config: a resolved server config (windows.js); the web view uses it for
 *   its navigation rules and its content policy.
 * options.url: what the web view loads first. The smoke test passes a local
 *   placeholder so it runs with no server up.
 * options.mode / options.dockOpen: the state to start in.
 * options.tray: false to skip the tray (tests, and a machine with no desktop).
 *
 * The returned controller is the only handle the main process needs: it owns the
 * state, so the rail, the menu, the tray and the accelerators all go through it.
 */
/*
 * The server a key is filed under.
 *
 * The credential store namespaces by host, not by full origin, because a key is
 * for a service rather than for a port. A value this cannot parse is not a reason
 * to refuse to start: it is a reason for every key to be filed under one name that
 * no real server will ever have, which keeps them separate rather than shared.
 */
function serverHostFor (origin) {
  try {
    const parsed = new URL(String(origin))
    return parsed.hostname.length > 0 ? parsed.hostname : 'unknown-host'
  } catch {
    return 'unknown-host'
  }
}

function createShellWindow (options = {}) {
  const electron = require('electron')
  const { BaseWindow, WebContentsView, Menu, Tray, nativeImage, session, nativeTheme, app, safeStorage } = electron

  const config = options.config
  if (!config) throw new TypeError('createShellWindow needs a resolved server config')

  const ipcMain = options.ipcMain || electron.ipcMain
  const log = options.log || console

  const localSession = session.fromPartition(LOCAL_PARTITION)
  hardenLocalSession(localSession)
  // The web view's session policy is installed by createWebView below, through
  // the same code path the standalone window used.

  const icon = readImage(nativeImage, WINDOW_ICON_FILE)

  const shellWindow = new BaseWindow({
    width: options.width || 1440,
    height: options.height || 900,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: options.show === true,
    frame: false,
    backgroundColor: '#000D3D',
    title: 'WorkSpace',
    ...(icon ? { icon } : {}),
  })

  const chromeView = new WebContentsView({ webPreferences: localViewPreferences() })
  const copilotView = new WebContentsView({ webPreferences: localViewPreferences() })
  const webView = createWebView({ config, url: options.url })

  // The chrome is added first so it sits behind the content views: it draws the
  // whole window and the other two are placed on top of the area they own.
  shellWindow.contentView.addChildView(chromeView)
  shellWindow.contentView.addChildView(webView)
  shellWindow.contentView.addChildView(copilotView)

  installLocalViewGuards(chromeView.webContents)
  installLocalViewGuards(copilotView.webContents)

  let shellSession = createShellSession({ mode: options.mode, dockOpen: options.dockOpen })
  let quitting = false
  let disposed = false
  let tray = null
  let menu = null

  const state = () => describeShellState(shellSession, windowFacts())

  /**
   * The moment the window has something to show.
   *
   * A BaseWindow has no `ready-to-show`: it owns no document, so the event a
   * BrowserWindow would send never arrives and waiting for it leaves the app
   * running with nothing on screen. The chrome page finishing its first load is
   * the honest equivalent. The timer is the failure path, because a chrome page
   * that cannot load must still give the person a window rather than a hidden
   * process.
   */
  let readyDone = false
  let readyTimer = null
  let resolveReady = null
  const ready = new Promise(resolve => { resolveReady = resolve })

  function markReady () {
    if (readyDone) return
    readyDone = true
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
    resolveReady()
  }

  function windowFacts () {
    return {
      maximized: typeof shellWindow.isMaximized === 'function' ? shellWindow.isMaximized() : false,
      theme: nativeTheme && nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
      platform: process.platform,
    }
  }

  const layout = () => {
    const bounds = shellWindow.getContentBounds()
    return computeShellLayout({
      width: bounds.width,
      height: bounds.height,
      mode: shellSession.mode,
      dockOpen: shellSession.dockOpen,
    })
  }

  /**
   * Put every view where the layout says.
   *
   * A view with no rectangle is hidden, never destroyed: hiding the web view is
   * how ZuriCopilot mode keeps the session and the page alive, so switching back
   * is instant and does not reload.
   */
  function applyLayout () {
    const next = layout()
    placeView(chromeView, next.chrome)
    placeView(webView, next.web)
    placeView(copilotView, next.copilot)
    return next
  }

  function placeView (view, rect) {
    if (!rect) {
      if (typeof view.setVisible === 'function') view.setVisible(false)
      return
    }
    if (typeof view.setVisible === 'function') view.setVisible(true)
    view.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  }

  const bridge = registerShellIpc({
    ipcMain,
    log,
    actions: {
      getState: () => publish(),
      setMode: mode => commit(setShellMode(shellSession, mode)),
      toggleDock: () => commit(toggleShellDock(shellSession)),
      windowAction: action => {
        windowAction(action)
        return publish()
      },
    },
  })

  bridge.trust(chromeView.webContents, shellPageUrl('chrome'))
  bridge.trust(copilotView.webContents, shellPageUrl('copilot'))

  /*
   * The access surface, built on the web view's own session.
   *
   * The client reads the same `persist:ws` partition the web app signs into, so
   * "signed in" means the same thing on both sides. It must not read the local
   * views' partition: a permission answered through a cookie jar the web app
   * cannot see would be a second, quieter session.
   *
   * The trusted-view registry is the shell bridge's, so there is one answer to
   * "may this page talk to me" rather than two that could disagree.
   */
  const accessClient = createWorkspaceClient({
    session: session.fromPartition(SESSION_PARTITION),
    serverUrl: config.origin,
  })
  const accessStore = createAccessStore()
  const accessController = createAccessController(accessStore, createAccessService(accessClient))
  const accessBridge = registerAccessIpc({
    ipcMain,
    log,
    controller: accessController,
    views: { isTrustedSender: bridge.isTrustedSender, broadcast: bridge.broadcast },
  })

  /*
   * The Models surface: provider configuration, and the one place a key crosses
   * from a page into encrypted storage.
   *
   * Five things are assembled here and nowhere else.
   *
   * 1. The key file. `createSecretFileStore` is the durable file the keychain
   *    already uses for its ciphertext; the provider catalogue reuses it in a
   *    second file for configuration, which holds no secret by shape.
   * 2. The keychain, over Electron's own encryption. If the platform cannot
   *    encrypt, every save is refused rather than falling back to plaintext.
   * 3. The credential store, which namespaces every key by server and by user, so
   *    two people on one machine never share one and one person on two servers
   *    keeps two.
   * 4. The entry boundary, so a key is submitted once against a single-use pass.
   * 5. The guard and the transport. Every model call - including listing models
   *    and testing a key - leaves through the guard, which resolves the host,
   *    classifies the address and dials the address it verified.
   *
   * The scope reader is the reason a sign-out is immediate: it asks the access
   * store, not a value captured at start-up, so the very next call after a
   * sign-out is refused instead of using a session that has ended.
   */
  const userDataDir = (typeof app.getPath === 'function' ? app.getPath('userData') : __dirname)
  const providerConfigFile = createSecretFileStore({
    path: path.join(userDataDir, 'model-providers.json'),
    log,
  })
  const providerKeyFile = createSecretFileStore({
    path: path.join(userDataDir, 'model-keys.json'),
    log,
  })

  const providerKeychain = createKeychain({ safeStorage, log, persistence: providerKeyFile })
  const providerCredentials = createCredentialStore({ keychain: providerKeychain, log })
  const providerEntry = createCredentialEntry({ store: providerCredentials, log })

  const providerGuard = createEgressGuard({ resolve: systemResolve, log })
  /*
   * The local-only policy is Phase 5's, and there is no business to ask about yet:
   * every call here happens before a business is chosen, which is exactly why the
   * call context carries no business id. Answered false, not defaulted, because a
   * policy that forgot to answer would silently let every cloud call out.
   */
  const providerTransport = createGuardedTransport(providerGuard, () => false)

  const providerConfigPersistence = {
    load: () => {
      const stored = providerConfigFile.load().find(entry => entry[0] === 'providers')
      if (!stored) return {}
      try {
        return JSON.parse(stored[1])
      } catch {
        // A corrupted configuration is not a credential problem: start empty and
        // let the person re-add an entry rather than refusing to open the screen.
        log.warn('zuricopilot-desktop: stored provider configuration could not be read')
        return {}
      }
    },
    save: records => providerConfigFile.save([['providers', JSON.stringify(records)]]),
  }

  const providerService = createProviderSettingsService({
    transport: providerTransport,
    credentials: providerCredentials,
    entry: providerEntry,
    persistence: providerConfigPersistence,
    log,
    scope: () => {
      const state = accessStore.getState()
      if (state.status !== 'ready' || state.identity === null) return null
      return { serverHost: serverHostFor(config.origin), userId: state.identity.id }
    },
  })

  const providerBridge = registerProviderIpc({
    ipcMain,
    log,
    service: providerService,
    views: { isTrustedSender: bridge.isTrustedSender, broadcast: bridge.broadcast },
  })

  /*
   * The local conversation database.
   *
   * One file per person on one server, with the key in its own keychain entry, so
   * a second account signing in on this machine opens a different file rather than
   * being filtered away from the first account's rows. The key file is separate
   * from the provider key file on purpose: losing one must not cost the other.
   *
   * `isEligible` asks the access store rather than trusting the row. A workspace
   * whose grant was withdrawn between opening the database and sending a message
   * is refused at the data layer, which is the only place that still knows about
   * it after the screen has moved on.
   */
  const businessDataDir = path.join(userDataDir, 'business-data')
  try {
    fs.mkdirSync(businessDataDir, { recursive: true })
  } catch {
    // A directory that cannot be created shows up as a refusal to open below,
    // where it is reported once, instead of throwing during window construction.
  }
  const businessKeyFile = createSecretFileStore({
    path: path.join(userDataDir, 'business-keys.json'),
    log,
  })
  const businessKeychain = createKeychain({ safeStorage, log, persistence: businessKeyFile })
  const businessStore = createBusinessStore({
    directory: businessDataDir,
    keychain: businessKeychain,
    logger: log,
    isEligible: (_scope, remoteWorkspaceId) => {
      const state = accessStore.getState()
      if (state.status !== 'ready') return false
      return state.workspaces.some(workspace => workspace.id === remoteWorkspaceId && workspace.granted)
    },
  })

  /**
   * Open for the signed-in person, close for nobody.
   *
   * Every route into a locked or different account passes through the access
   * store, so following its state covers the button, an expired session, a
   * withdrawn grant and a different person signing in, without four call sites
   * that could each forget one.
   */
  function syncBusinessStore () {
    const state = accessStore.getState()
    if (state.status !== 'ready' || state.identity === null) {
      businessStore.close()
      return
    }
    try {
      businessStore.open({ serverHost: serverHostFor(config.origin), userId: state.identity.id })
    } catch (error) {
      // A database that will not open must not take the window with it. The token
      // is recorded, never the driver's message, which can quote a bound value.
      const failure = error && typeof error.failure === 'string' ? error.failure : 'internal_error'
      log.warn('zuricopilot storage: refusing to open the local database (' + failure + ')')
      businessStore.close()
    }
  }
  const unsubscribeBusinessStore = accessStore.subscribe(() => syncBusinessStore())
  syncBusinessStore()

  /*
   * The conversation layer.
   *
   * It owns no key and no URL: the provider for a turn comes from the Models
   * service, which reads the stored credential and hands back a ready adapter. The
   * store it writes through is the one above, so a closed database answers
   * "nobody is signed in" rather than writing into a file that belongs to somebody
   * else.
   *
   * The three getters are getters rather than values on purpose. A turn started
   * before a sign-out must see that the account has ended, and a captured string
   * would not.
   */
  /**
   * The workspace the assistant is currently pointed at, or null.
   *
   * The access store speaks the web app's ids and knows whether the grant is still
   * in place; the conversation database speaks its own local row ids. Both are
   * needed, so the join lives here in one place rather than in four getters.
   */
  function currentWorkspace () {
    const state = accessStore.getState()
    if (state.status !== 'ready' || state.identity === null) return null
    const chosen = state.workspaces.find(workspace => workspace.id === state.selectedWorkspaceId)
    if (chosen === undefined || !chosen.granted) return null
    return { workspace: chosen, identity: state.identity }
  }

  /**
   * The local row for the chosen workspace, created on first use.
   *
   * `upsert` is the documented write path for a business row: the first mention
   * inserts it, every mention after that refreshes the name. That is exactly what
   * "the assistant has been told about this workspace" means, and it is why the
   * row does not have to be seeded when somebody signs in.
   *
   * Everything is inside one try because this getter is called while an event is
   * being published: a refusal here must answer null rather than throw into a push
   * that nobody is awaiting.
   */
  function localBusiness () {
    const current = currentWorkspace()
    if (current === null) return null
    const scope = {
      serverHost: serverHostFor(config.origin),
      userId: current.identity.id,
    }
    try {
      const repositories = businessStore.repositories(scope)
      const existing = repositories.businesses
        .list(scope)
        .find(row => row.remoteWorkspaceId === current.workspace.id)
      if (existing !== undefined) return { business: existing, identity: current.identity }
      const created = repositories.businesses.upsert(scope, {
        remoteWorkspaceId: current.workspace.id,
        name: current.workspace.name,
      })
      return { business: created, identity: current.identity }
    } catch {
      return null
    }
  }

  const chatService = createChatService({
    store: businessStore,
    providers: () => (accessStore.getState().status === 'ready' ? providerService : null),
    scope: () => {
      const state = accessStore.getState()
      if (state.status !== 'ready' || state.identity === null) return null
      return { serverHost: serverHostFor(config.origin), userId: state.identity.id }
    },
    businessId: () => localBusiness()?.business.id ?? null,
    identity: () => {
      const current = localBusiness()
      if (current === null) return { displayName: null, email: null, businessName: null }
      return {
        /*
         * The session carries the person's display name; it does not carry an email
         * address, and inventing one would mean substituting nothing while claiming
         * to have hidden something. The business name is the workspace's, which is
         * the identifying detail a conversation is most likely to contain.
         */
        displayName: current.identity.name,
        email: null,
        businessName: current.business.name,
      }
    },
    publish: event => { chatBridge.publish(event) },
    log,
  })

  const chatBridge = registerChatIpc({
    ipcMain,
    log,
    service: chatService,
    views: { isTrustedSender: bridge.isTrustedSender, broadcast: bridge.broadcast },
  })

  /*
   * Sign-out and account switch.
   *
   * Watching the access store rather than the sign-out call means every route into
   * a locked or different account is covered: the button, an expired session, a
   * revocation, and a different person signing in. The key material is cleared,
   * every live key submission is revoked, and the screen is pushed a state built
   * from the session - which, when nobody is signed in, lists no providers.
   */
  let lastProviderAccount = accessStore.getState().identity?.id ?? null
  const unsubscribeProviderScope = accessStore.subscribe(state => {
    const account = state.status === 'ready' && state.identity !== null ? state.identity.id : null
    if (account === lastProviderAccount) return
    lastProviderAccount = account
    providerService.forgetAccount()
    providerBridge.publishState()
  })

  /**
   * Re-read the session after anything that could have changed it.
   *
   * Signing in or out happens in the web view, not here, so the web view's own
   * load events and the window regaining focus are the moments worth re-reading.
   * The controller answers rather than throws, and a failure leaves the current
   * state alone, so a flaky connection cannot lock the assistant by accident.
   *
   * Every read this function starts is marked automatic, because nobody clicked
   * for it. That is what stops a focus event from undoing a sign-out whose server
   * call failed: the controller answers the locked state instead of reading a
   * session cookie that is still alive.
   */
  function refreshAccess () {
    accessController.refresh({ automatic: true }).catch(error => {
      log.warn(`zuricopilot-desktop: access refresh failed (${(error && error.name) || 'unknown'})`)
    })
  }

  webView.webContents.on('did-finish-load', refreshAccess)
  shellWindow.on('focus', refreshAccess)
  refreshAccess()

  function commit (next) {
    if (next) {
      shellSession = next
      applyLayout()
    }
    return publish()
  }

  /** One place pushes a state out: the views, the menu and the tray all hear it. */
  function publish () {
    const next = state()
    bridge.publish(next)
    installMenu(next)
    updateTray(next)
    return next
  }

  function setMode (mode) {
    return commit(setShellMode(shellSession, mode))
  }

  function toggleDock () {
    return commit(toggleShellDock(shellSession))
  }

  function windowAction (action) {
    if (action === 'minimize') shellWindow.minimize()
    else if (action === 'toggle-maximize') {
      if (shellWindow.isMaximized()) shellWindow.unmaximize()
      else shellWindow.maximize()
    } else if (action === 'close') shellWindow.close()
  }

  function showWindow () {
    if (shellWindow.isMinimized()) shellWindow.restore()
    shellWindow.show()
    shellWindow.focus()
  }

  function quit () {
    quitting = true
    app.quit()
  }

  /**
   * Close means "hide to the tray", and quitting says so explicitly.
   *
   * The tray is the reason the app has a life after the window: without this the
   * close button would end the process and the tray icon would blink out of
   * existence, which is not what a tray icon is for.
   */
  shellWindow.on('close', event => {
    if (quitting) return
    // With no tray icon there is no way back to a hidden window, so closing has
    // to mean what it says. This is the headless case and the missing-icon case.
    if (!tray) {
      quitting = true
      return
    }
    event.preventDefault()
    shellWindow.hide()
  })

  shellWindow.on('resize', () => applyLayout())
  shellWindow.on('maximize', () => publish())
  shellWindow.on('unmaximize', () => publish())
  shellWindow.on('closed', () => dispose())

  // A quit from outside this file (OS shutdown, a dock command) must be allowed
  // through the close handler above, which is the only thing that knows whether
  // the person asked for it.
  const onBeforeQuit = () => { quitting = true }
  app.on('before-quit', onBeforeQuit)

  const onNativeThemeUpdated = () => publish()
  if (nativeTheme && typeof nativeTheme.on === 'function') {
    nativeTheme.on('updated', onNativeThemeUpdated)
  }

  function menuActions () {
    return {
      setMode,
      toggleDock,
      minimizeToTray: () => shellWindow.hide(),
      quit,
    }
  }

  function installMenu (next) {
    menu = Menu.buildFromTemplate(buildMenuTemplate(next, menuActions(), { platform: process.platform }))
    Menu.setApplicationMenu(menu)
    return menu
  }

  function trayActions () {
    return {
      open: showWindow,
      setMode: mode => {
        // A tray mode switch must bring the window back, or nothing visible
        // happens and the click looks broken.
        setMode(mode)
        showWindow()
      },
      toggleDock: () => {
        toggleDock()
        showWindow()
      },
      quit,
    }
  }

  function updateTray (next) {
    if (!tray) return
    tray.setToolTip(trayTooltip(next))
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(next, trayActions())))
  }

  function createTray () {
    if (options.tray === false) return null
    const trayImage = readImage(nativeImage, TRAY_ICON_FILE)
    if (!trayImage) {
      log.warn('zuricopilot-desktop: tray icon missing, continuing without a tray')
      return null
    }
    tray = new Tray(trayImage)
    tray.on('click', showWindow)
    // A double click on Windows arrives as two clicks; the extra show is
    // harmless and means the icon behaves the way the platform expects.
    tray.on('double-click', showWindow)
    updateTray(state())
    return tray
  }

  function dispose () {
    if (disposed) return
    disposed = true
    accessBridge.dispose()
    providerBridge.dispose()
    // A running turn is stopped before the database closes, so its cancellation
    // path cannot try to write into a handle that is already gone.
    chatService.dispose()
    chatBridge.dispose()
    unsubscribeProviderScope()
    /*
     * Closing here matters more than it looks: an open SQLite handle keeps the
     * file locked on Windows, so a window torn down without this leaves a
     * database the next launch cannot open until the process exits.
     */
    unsubscribeBusinessStore()
    businessStore.close()
    bridge.dispose()
    // A listener left on an app-level emitter outlives the window it publishes
    // to, so it is removed here rather than relying on process exit.
    if (typeof app.removeListener === 'function') app.removeListener('before-quit', onBeforeQuit)
    if (nativeTheme && typeof nativeTheme.removeListener === 'function') {
      nativeTheme.removeListener('updated', onNativeThemeUpdated)
    }
    if (readyTimer) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
    if (tray) {
      tray.destroy()
      tray = null
    }
    menu = null
  }

  /**
   * Resolve once every view has painted its first document.
   *
   * The smoke test needs this before it can read the pages, and a view that
   * never loads has to be a failure rather than a hang.
   */
  function waitForViews (timeoutMs = 15000) {
    const views = [chromeView, copilotView, webView]
    const loaded = views.map(view => new Promise((resolve, reject) => {
      const contents = view.webContents
      if (typeof contents.isLoading === 'function' && !contents.isLoading() && contents.getURL()) {
        resolve(contents.getURL())
        return
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`view did not load within ${timeoutMs}ms`))
      }, timeoutMs)
      const done = () => {
        cleanup()
        resolve(contents.getURL())
      }
      const failed = (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return
        cleanup()
        reject(new Error(`view failed to load code=${errorCode} ${errorDescription}`))
      }
      function cleanup () {
        clearTimeout(timer)
        contents.removeListener('did-finish-load', done)
        contents.removeListener('did-fail-load', failed)
      }
      contents.once('did-finish-load', done)
      contents.on('did-fail-load', failed)
    }))

    return Promise.all(loaded)
  }

  // A load that fails must be visible in the log: a blank view is otherwise
  // indistinguishable from a page that is merely slow, and this is the only
  // place that knows which view it was.
  function reportLoadFailure (view) {
    return error => {
      process.stderr.write(`zuricopilot-desktop: ${view} view failed to load (${(error && error.message) || 'unknown'})\n`)
    }
  }

  // Load order matters only in one way: the chrome is the page that draws the
  // frame, so it goes first and a mode change cannot arrive before it exists.
  chromeView.webContents.once('did-finish-load', markReady)
  readyTimer = setTimeout(markReady, 1500)
  if (readyTimer.unref) readyTimer.unref()

  chromeView.webContents.loadFile(shellPagePath(), { hash: 'chrome' }).catch(reportLoadFailure('chrome'))
  copilotView.webContents.loadFile(shellPagePath(), { hash: 'copilot' }).catch(reportLoadFailure('dock'))
  webView.webContents.loadURL(options.url || config.url).catch(reportLoadFailure('web'))

  applyLayout()
  installMenu(state())
  createTray()

  return {
    window: shellWindow,
    views: { chrome: chromeView, web: webView, copilot: copilotView },
    state,
    layout,
    applyLayout,
    setMode,
    toggleDock,
    windowAction,
    show: showWindow,
    focus: () => shellWindow.focus(),
    /** Resolves when the window has painted, or when it is clear it never will. */
    whenReady: () => ready,
    waitForViews,
    dispose,
    // The smoke test reads this to prove the tray and the menu exist without
    // reaching into Electron's own state.
    get tray () { return tray },
    get menu () { return menu },
  }
}

/**
 * The web app as a view: the same hardened preferences, session and guards the
 * standalone window used, built in windows.js so there is one set of rules.
 */
module.exports = {
  LOCAL_PARTITION,
  MIN_WIDTH,
  MIN_HEIGHT,
  SHELL_PAGE_FILE,
  SHELL_PRELOAD_FILE,
  shellPagePath,
  shellPageUrl,
  localViewPreferences,
  installLocalViewGuards,
  hardenLocalSession,
  createShellWindow,
  SESSION_PARTITION,
}
