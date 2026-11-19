'use strict'

/*
 * The preload for the shell views: the shell bridge (mode, dock, window controls
 * and its state push) and the access bridge (who may use the assistant, on which
 * workspace), and nothing else.
 *
 * This file runs in a sandboxed preload, which means `require` only resolves
 * Electron and a short list of built-ins: a sandboxed preload cannot load a
 * project file. The channel names are therefore repeated here as literals, and
 * `features/copilot/main/ipc/preload-shell.test.js` asserts those literals
 * equal the shared contract's table, so the two cannot drift apart silently.
 *
 * What is exposed is two named bridges, `zuriShell` and `zuriAccess`, each a
 * short list of named methods. There is no generic `invoke`, no
 * channel parameter, no URL parameter, no `send` and no `ipcRenderer` anywhere
 * a page can reach, so page code has no way to name a channel of its own. Each
 * method sends one fixed channel and one fixed request shape, and the
 * methods that carry a value check it against a local list before anything
 * crosses the process boundary: a made-up mode, window action or workspace id is
 * a bug in the page, and the main process should never have to filter it.
 *
 * The state push is the one thing the page listens to. Both local views draw
 * from it, which is what keeps the title bar and the dock showing the same mode
 * after a menu accelerator or a keyboard shortcut moved it.
 */

const { contextBridge, ipcRenderer } = require('electron')

const STATE = 'shell:state'
const SET_MODE = 'shell:mode:set'
const TOGGLE_DOCK = 'shell:dock:toggle'
const WINDOW_ACTION = 'shell:window:action'
const STATE_PUSH = 'shell:state:changed'

/*
 * The sets below are copies of the contract's enums, for the same reason the
 * channel names are copies: no import is available here. The test asserts each
 * of these names appears in this file and equals the contract's value, so a
 * rename on the main side fails the build instead of producing a view that
 * silently stops switching modes.
 */
const MODES = Object.freeze(['workspace', 'copilot'])
const WINDOW_ACTION_NAMES = Object.freeze(['minimize', 'toggle-maximize', 'close'])
const THEMES = Object.freeze(['light', 'dark'])

// The calls that take no input send an empty object rather than nothing, for
// the same reason the Copilot bridge does: the main process validates a request
// object it can refuse, instead of treating an undefined argument as consent.
// Frozen so a page that gets hold of it cannot widen the next request.
const EMPTY_REQUEST = Object.freeze({})

/*
 * The one place this file touches `ipcRenderer`.
 *
 * Both bridges are built over this same object rather than each writing its own
 * forwarding arrows. That keeps the rule the header states - one fixed channel
 * per method, nothing the page can name - in one readable spot, and it means the
 * drift guard has a single call site to count instead of one per bridge that
 * would quietly multiply as bridges are added.
 */
const TRANSPORT = Object.freeze({
  invoke: (channel, request) => ipcRenderer.invoke(channel, request),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
})

function isKnownMode (value) {
  return typeof value === 'string' && MODES.includes(value)
}

function isKnownWindowAction (value) {
  return typeof value === 'string' && WINDOW_ACTION_NAMES.includes(value)
}

/**
 * The structural check the push has to pass, mirroring `isShellState` in the
 * contract but written out by hand because the schema module cannot be loaded
 * here. A payload that fails is dropped rather than forwarded: a view that
 * rendered half a state would show a mode the window is not actually in.
 */
function isShellState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return isKnownMode(value.mode) &&
    typeof value.dockOpen === 'boolean' &&
    typeof value.maximized === 'boolean' &&
    typeof value.theme === 'string' && THEMES.includes(value.theme) &&
    typeof value.platform === 'string'
}

/**
 * Build the bridge over injected Electron calls, so the shape can be tested
 * without a window. Every option is a function and is checked here, because a
 * missing one would otherwise surface as a failing call inside the page.
 */
function createShellApi (options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createShellApi needs an options object')
  }
  const { invoke, on, removeListener } = options
  if (typeof invoke !== 'function') throw new TypeError('createShellApi needs an invoke function')
  if (typeof on !== 'function') throw new TypeError('createShellApi needs an on function')
  if (typeof removeListener !== 'function') throw new TypeError('createShellApi needs a removeListener function')

  return Object.freeze({
    getState: () => invoke(STATE, EMPTY_REQUEST),

    // The refusal message is fixed and never repeats the value: a bad mode is a
    // bug report, not data worth carrying into a log line.
    setMode: (mode) => {
      if (!isKnownMode(mode)) return Promise.reject(new TypeError('setMode needs a known shell mode'))
      return invoke(SET_MODE, { mode })
    },

    toggleDock: () => invoke(TOGGLE_DOCK, EMPTY_REQUEST),

    windowAction: (action) => {
      if (!isKnownWindowAction(action)) return Promise.reject(new TypeError('windowAction needs a known window action'))
      return invoke(WINDOW_ACTION, { action })
    },

    /**
     * Subscribe to the one push channel and return an unsubscribe function.
     *
     * Electron hands the listener an IpcRendererEvent first and the payload
     * second. The page has no use for the event, and the wrapped listener is
     * also the only identity `removeListener` recognises, so the wrapper is the
     * thing stored and removed. Unsubscribing twice is harmless: a view that
     * unmounts twice must not double-remove or throw.
     */
    onState: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onState needs a listener function')

      function handlePush (event, payload) {
        if (!isShellState(payload)) return
        listener(payload)
      }

      on(STATE_PUSH, handlePush)

      let removed = false
      return function unsubscribe () {
        if (removed) return
        removed = true
        removeListener(STATE_PUSH, handlePush)
      }
    },
  })
}

contextBridge.exposeInMainWorld('zuriShell', createShellApi(TRANSPORT))

/*
 * The access bridge: who may use the assistant, and on which workspace.
 *
 * Kept separate from `zuriShell` rather than folded into it, because the two
 * answer different questions. The shell bridge moves a window; this one asks the
 * server about a person's permissions, and a page that only needs to draw a
 * title bar should not be handed the second.
 *
 * The channel names and the lock reasons below are literals for the same reason
 * as the shell's: a sandboxed preload cannot load a project file, so
 * `features/copilot/main/ipc/preload-shell.test.js` compares every literal here
 * with the shared contract table and fails the build if they ever disagree.
 *
 * Every method names one fixed channel. A workspace and a user id are numbers
 * and are checked here before they cross, so a page cannot send a string, an
 * object, or an address to the main process.
 */
const ACCESS_STATE = 'zuri:access:state'
const ACCESS_REFRESH = 'zuri:access:refresh'
const ACCESS_SELECT = 'zuri:access:select'
const ACCESS_MANAGERS = 'zuri:access:managers'
const ACCESS_PERMISSION = 'zuri:access:permission'
const ACCESS_SIGN_OUT = 'zuri:access:signout'
const ACCESS_STATE_PUSH = 'zuri:access:state:changed'

const ACCESS_ROLES = Object.freeze(['owner', 'manager'])
const ACCESS_LOCK_REASONS = Object.freeze([
  'signed_out',
  'no_access',
  'expired',
  'revoked',
  'account_changed',
])

function isPositiveId (value) {
  return Number.isInteger(value) && value > 0
}

function isAccessWorkspace (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return isPositiveId(value.id) &&
    typeof value.name === 'string' && value.name.length > 0 &&
    typeof value.role === 'string' && ACCESS_ROLES.includes(value.role) &&
    typeof value.granted === 'boolean'
}

/**
 * The structural check the access push has to pass, mirroring `accessStateSchema`
 * but written by hand because the schema module cannot be loaded in a sandboxed
 * preload. A payload that fails is dropped: a panel drawn from half a state
 * would show an unlocked assistant that the main process just locked.
 */
function isAccessState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.version !== 1) return false
  if (value.status !== 'locked' && value.status !== 'ready') return false
  if (value.reason !== null &&
    !(typeof value.reason === 'string' && ACCESS_LOCK_REASONS.includes(value.reason))) {
    return false
  }
  if (value.identity !== null) {
    const identity = value.identity
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return false
    if (!isPositiveId(identity.id) || typeof identity.name !== 'string') return false
  }
  if (!Array.isArray(value.workspaces) || !value.workspaces.every(isAccessWorkspace)) return false
  const selected = value.selectedWorkspaceId
  if (selected !== null && !isPositiveId(selected)) return false
  return true
}

function createAccessApi (options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createAccessApi needs an options object')
  }
  const { invoke, on, removeListener } = options
  if (typeof invoke !== 'function') throw new TypeError('createAccessApi needs an invoke function')
  if (typeof on !== 'function') throw new TypeError('createAccessApi needs an on function')
  if (typeof removeListener !== 'function') throw new TypeError('createAccessApi needs a removeListener function')

  return Object.freeze({
    readState: () => invoke(ACCESS_STATE, EMPTY_REQUEST),

    refresh: () => invoke(ACCESS_REFRESH, EMPTY_REQUEST),

    selectWorkspace: (workspaceId) => {
      if (!isPositiveId(workspaceId)) return Promise.reject(new TypeError('selectWorkspace needs a workspace id'))
      return invoke(ACCESS_SELECT, { workspaceId })
    },

    listManagers: (workspaceId) => {
      if (!isPositiveId(workspaceId)) return Promise.reject(new TypeError('listManagers needs a workspace id'))
      return invoke(ACCESS_MANAGERS, { workspaceId })
    },

    // The permission name is not a parameter: the page decides whether the
    // assistant is on, and only the main process decides which key that is.
    setPermission: (workspaceId, userId, granted) => {
      if (!isPositiveId(workspaceId)) return Promise.reject(new TypeError('setPermission needs a workspace id'))
      if (!isPositiveId(userId)) return Promise.reject(new TypeError('setPermission needs a user id'))
      if (typeof granted !== 'boolean') return Promise.reject(new TypeError('setPermission needs a boolean'))
      return invoke(ACCESS_PERMISSION, { workspaceId, userId, granted })
    },

    signOut: () => invoke(ACCESS_SIGN_OUT, EMPTY_REQUEST),

    onState: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onState needs a listener function')

      function handlePush (event, payload) {
        if (!isAccessState(payload)) return
        listener(payload)
      }

      on(ACCESS_STATE_PUSH, handlePush)

      let removed = false
      return function unsubscribe () {
        if (removed) return
        removed = true
        removeListener(ACCESS_STATE_PUSH, handlePush)
      }
    },
  })
}

contextBridge.exposeInMainWorld('zuriAccess', createAccessApi(TRANSPORT))

/*
 * The provider bridge: which model provider the assistant may use, and the one
 * way a key can be handed over.
 *
 * Separate from the other two for the same reason they are separate from each
 * other, and more so here: this is the only surface that carries a secret, so a
 * page that only needs to draw a title bar must not be handed it. The web view
 * gets no preload at all, which is what keeps key entry out of the page that
 * renders a customer's data.
 *
 * The channel names below are literals, like the other two bridges: a sandboxed
 * preload cannot load a project file, so `preload-shell.test.js` compares each of
 * these with the shared contract table and fails if they ever disagree.
 *
 * Three checks happen here, before anything crosses:
 *
 * - A preset id must be a short identifier. A page cannot send a URL, a header
 *   name, an object or an address through a method that only accepts an id.
 * - A key is bounded and must be a string. The main process still re-validates it
 *   against its own schema; this is the cheap refusal, not the only one.
 * - The pushed state must have the shape the contract requires. A half-read
 *   state would draw a configured provider with no key, or a key with no provider.
 */
const PROVIDER_STATE = 'zuri:providers:read-state'
const PROVIDER_SAVE = 'zuri:providers:save-provider'
const PROVIDER_REMOVE = 'zuri:providers:remove-provider'
const PROVIDER_BEGIN_CREDENTIAL = 'zuri:providers:begin-credential'
const PROVIDER_SAVE_CREDENTIAL = 'zuri:providers:save-credential'
const PROVIDER_TEST = 'zuri:providers:test-connection'
const PROVIDER_MODELS = 'zuri:providers:list-models'
const PROVIDER_DISCOVER = 'zuri:providers:discover-local'
const PROVIDER_STATE_PUSH = 'zuri:providers:state-changed'

const PROVIDER_SETTINGS_VERSION = 1

/** The same pattern the main process enforces, so a bad id fails on both sides. */
const PRESET_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const NONCE_PATTERN = /^[a-f0-9]{16,128}$/

const MAX_KEY_LENGTH = 4096

/** A row id: the same shape every other bridge accepts. */
const CHAT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/
const MAX_BASE_URL_LENGTH = 500
const MAX_MODEL_LENGTH = 200

function isPresetId (value) {
  return typeof value === 'string' && PRESET_ID_PATTERN.test(value)
}

/**
 * The structural check a pushed provider state has to pass.
 *
 * Mirrors `providerSettingsStateSchema` by hand, because a sandboxed preload
 * cannot load the schema module. Only the fields the screen reads are checked: a
 * field it never touches cannot break the drawing, and refusing on one would drop
 * a state that is otherwise usable.
 */
function isProviderState (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (value.version !== PROVIDER_SETTINGS_VERSION) return false
  if (typeof value.signedIn !== 'boolean') return false
  if (!Array.isArray(value.catalog)) return false
  if (!Array.isArray(value.providers)) return false

  const catalogOk = value.catalog.every(function (entry) {
    return entry && typeof entry === 'object' && !Array.isArray(entry) &&
      typeof entry.id === 'string' && typeof entry.label === 'string'
  })
  if (!catalogOk) return false

  return value.providers.every(function (entry) {
    return entry && typeof entry === 'object' && !Array.isArray(entry) &&
      typeof entry.presetId === 'string' &&
      typeof entry.label === 'string' &&
      typeof entry.baseUrl === 'string' &&
      typeof entry.hasCredential === 'boolean'
  })
}

function createProvidersApi (options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createProvidersApi needs an options object')
  }
  const { invoke, on, removeListener } = options
  if (typeof invoke !== 'function') throw new TypeError('createProvidersApi needs an invoke function')
  if (typeof on !== 'function') throw new TypeError('createProvidersApi needs an on function')
  if (typeof removeListener !== 'function') throw new TypeError('createProvidersApi needs a removeListener function')

  return Object.freeze({
    readState: () => invoke(PROVIDER_STATE, EMPTY_REQUEST),

    // Endpoints and model names are capped here as well as in the main process:
    // an oversized paste is refused before it becomes a 500-character address.
    saveProvider: (request) => {
      if (!request || typeof request !== 'object') {
        return Promise.reject(new TypeError('saveProvider needs a request object'))
      }
      if (!isPresetId(request.presetId)) {
        return Promise.reject(new TypeError('saveProvider needs a provider id'))
      }
      const baseUrl = typeof request.baseUrl === 'string' ? request.baseUrl : ''
      const defaultModel = typeof request.defaultModel === 'string' ? request.defaultModel : ''
      if (baseUrl.length > MAX_BASE_URL_LENGTH) {
        return Promise.reject(new TypeError('saveProvider refuses an oversized address'))
      }
      if (defaultModel.length > MAX_MODEL_LENGTH) {
        return Promise.reject(new TypeError('saveProvider refuses an oversized model name'))
      }
      return invoke(PROVIDER_SAVE, { presetId: request.presetId, baseUrl, defaultModel })
    },

    removeProvider: (presetId) => {
      if (!isPresetId(presetId)) return Promise.reject(new TypeError('removeProvider needs a provider id'))
      return invoke(PROVIDER_REMOVE, { presetId })
    },

    // The pass is asked for, not invented: only the main process knows which
    // account is signed in, and it is the account the pass is bound to.
    beginCredential: (presetId) => {
      if (!isPresetId(presetId)) return Promise.reject(new TypeError('beginCredential needs a provider id'))
      return invoke(PROVIDER_BEGIN_CREDENTIAL, { presetId })
    },

    saveCredential: (presetId, nonce, secret) => {
      if (!isPresetId(presetId)) return Promise.reject(new TypeError('saveCredential needs a provider id'))
      if (typeof nonce !== 'string' || !NONCE_PATTERN.test(nonce)) {
        return Promise.reject(new TypeError('saveCredential needs a pass'))
      }
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_KEY_LENGTH) {
        return Promise.reject(new TypeError('saveCredential needs a key'))
      }
      return invoke(PROVIDER_SAVE_CREDENTIAL, { presetId, nonce, secret })
    },

    testConnection: (presetId) => {
      if (!isPresetId(presetId)) return Promise.reject(new TypeError('testConnection needs a provider id'))
      return invoke(PROVIDER_TEST, { presetId })
    },

    listModels: (presetId) => {
      if (!isPresetId(presetId)) return Promise.reject(new TypeError('listModels needs a provider id'))
      return invoke(PROVIDER_MODELS, { presetId })
    },

    discoverLocal: () => invoke(PROVIDER_DISCOVER, EMPTY_REQUEST),

    onState: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onState needs a listener function')

      function handlePush (event, payload) {
        if (!isProviderState(payload)) return
        listener(payload)
      }

      on(PROVIDER_STATE_PUSH, handlePush)

      let removed = false
      return function unsubscribe () {
        if (removed) return
        removed = true
        removeListener(PROVIDER_STATE_PUSH, handlePush)
      }
    },
  })
}

contextBridge.exposeInMainWorld('zuriProviders', createProvidersApi(TRANSPORT))


/* ------------------------------------------------------------------ *
 * The chat bridge
 * ------------------------------------------------------------------ *
 *
 * Same three rules as the other bridges: literal channels, named methods rather
 * than a call-and-channel pair, and a push that is checked before it reaches the
 * page. The chat surface has one more consideration than the rest, because a
 * conversation carried a person's own words in both directions.
 *
 * - Nothing here can name a business, an account or an address. The page names a
 *   thread, some text and a provider entry; the main process decides what that
 *   means for the person who is signed in.
 * - Text is bounded on the way out. The main process enforces the real limit
 *   against its own schema, so this is the cheap refusal rather than the only one.
 * - A pushed event is checked for its type and its three carriers before it is
 *   handed on. An event that failed its own check is dropped silently rather than
 *   drawn as a delta of "undefined", which would look like the model answering
 *   with nothing.
 */

/** The channels, copied by hand from the shared contract's frozen list. */
const CHAT_LIST_THREADS = 'zuri:chat:listThreads'
const CHAT_CREATE_THREAD = 'zuri:chat:createThread'
const CHAT_RENAME_THREAD = 'zuri:chat:renameThread'
const CHAT_PIN_THREAD = 'zuri:chat:pinThread'
const CHAT_REMOVE_THREAD = 'zuri:chat:removeThread'
const CHAT_LIST_MESSAGES = 'zuri:chat:listMessages'
const CHAT_SEND_MESSAGE = 'zuri:chat:sendMessage'
const CHAT_CANCEL_TURN = 'zuri:chat:cancelTurn'
const CHAT_PAYLOAD_PREVIEW = 'zuri:chat:payloadPreview'
const CHAT_LIST_MEMORY = 'zuri:chat:listMemory'
const CHAT_EDIT_MEMORY = 'zuri:chat:editMemory'
const CHAT_REMOVE_MEMORY = 'zuri:chat:removeMemory'
const CHAT_LIST_PROPOSALS = 'zuri:chat:listProposals'
const CHAT_SET_PROPOSAL_STATUS = 'zuri:chat:setProposalStatus'
const CHAT_EDIT_PROPOSAL = 'zuri:chat:editProposal'
const CHAT_CLOSE_THREAD = 'zuri:chat:closeThread'
const CHAT_EVENT_PUSH = 'zuri:chat:event'

/** The longest single turn the main process will accept, restated for the cheap no. */
const CHAT_MAX_TEXT = 200000

/** A remembered item's bound, restated here so an oversized edit does not cross. */
const CHAT_MAX_MEMORY_TEXT = 4000

/**
 * The two decisions a person can record about a draft.
 *
 * Written out rather than imported: the preload cannot import the contract, so the
 * pair that the main process also refuses is spelled here too. A mismatch fails
 * closed - an unknown status never leaves the page.
 */
const PROPOSAL_DECISIONS = Object.freeze(['approved', 'rejected'])

function isChatId (value) {
  return typeof value === 'string' && CHAT_ID_PATTERN.test(value)
}

/** A turn event as the contract defines one: three types, each with its carriers. */
function isChatEvent (value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!isChatId(value.turnId) || !isChatId(value.threadId)) return false

  if (value.type === 'delta') return typeof value.text === 'string' && value.text.length > 0

  if (value.type === 'done') {
    const message = value.message
    return Boolean(message) && typeof message === 'object' &&
      isChatId(message.id) && typeof message.content === 'string' &&
      typeof message.role === 'string' && typeof message.seq === 'number'
  }

  if (value.type === 'failed') {
    return typeof value.failure === 'string' && isChatId(value.userMessageId) &&
      typeof value.retryable === 'boolean'
  }

  return false
}

function createChatApi (transport) {
  const invoke = transport.invoke

  function textOf (text) {
    return typeof text === 'string' && text.length > 0 && text.length <= CHAT_MAX_TEXT
  }

  return Object.freeze({
    listThreads: (request) => {
      const search = request?.search
      if (search !== undefined && (typeof search !== 'string' || search.length > 120)) {
        return Promise.reject(new TypeError('listThreads needs a short search'))
      }
      return invoke(CHAT_LIST_THREADS, search === undefined ? EMPTY_REQUEST : { search })
    },

    createThread: (request) => {
      const title = request?.title
      if (title !== undefined && (typeof title !== 'string' || title.length > 200)) {
        return Promise.reject(new TypeError('createThread needs a short title'))
      }
      return invoke(CHAT_CREATE_THREAD, title === undefined ? EMPTY_REQUEST : { title })
    },

    renameThread: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('renameThread needs a thread id'))
      if (typeof request.title !== 'string' || request.title.length > 200 || request.title.trim() === '') {
        return Promise.reject(new TypeError('renameThread needs a title'))
      }
      return invoke(CHAT_RENAME_THREAD, { threadId: request.threadId, title: request.title })
    },

    pinThread: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('pinThread needs a thread id'))
      if (typeof request.pinned !== 'boolean') return Promise.reject(new TypeError('pinThread needs a pinned flag'))
      return invoke(CHAT_PIN_THREAD, { threadId: request.threadId, pinned: request.pinned })
    },

    removeThread: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('removeThread needs a thread id'))
      return invoke(CHAT_REMOVE_THREAD, { threadId: request.threadId })
    },

    listMessages: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('listMessages needs a thread id'))
      const afterSeq = request.afterSeq
      if (afterSeq !== undefined && (typeof afterSeq !== 'number' || !Number.isInteger(afterSeq) || afterSeq < 0)) {
        return Promise.reject(new TypeError('listMessages needs a whole sequence number'))
      }
      return invoke(CHAT_LIST_MESSAGES, afterSeq === undefined
        ? { threadId: request.threadId }
        : { threadId: request.threadId, afterSeq })
    },

    sendMessage: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('sendMessage needs a thread id'))
      if (!textOf(request.text)) return Promise.reject(new TypeError('sendMessage needs some text'))
      if (!isChatId(request.presetId)) return Promise.reject(new TypeError('sendMessage needs a provider id'))
      if (request.modelId !== undefined && !isChatId(request.modelId)) {
        return Promise.reject(new TypeError('sendMessage needs a model id'))
      }
      const body = { threadId: request.threadId, text: request.text, presetId: request.presetId }
      return invoke(CHAT_SEND_MESSAGE, request.modelId === undefined ? body : { ...body, modelId: request.modelId })
    },

    cancelTurn: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('cancelTurn needs a thread id'))
      return invoke(CHAT_CANCEL_TURN, { threadId: request.threadId })
    },

    payloadPreview: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('payloadPreview needs a thread id'))
      if (!isChatId(request?.presetId)) return Promise.reject(new TypeError('payloadPreview needs a provider id'))
      if (!textOf(request.text)) return Promise.reject(new TypeError('payloadPreview needs some text'))
      return invoke(CHAT_PAYLOAD_PREVIEW, {
        threadId: request.threadId,
        presetId: request.presetId,
        text: request.text,
      })
    },

    listMemory: () => invoke(CHAT_LIST_MEMORY, EMPTY_REQUEST),

    editMemory: (request) => {
      if (!isChatId(request?.memoryId)) return Promise.reject(new TypeError('editMemory needs a memory id'))
      if (typeof request.text !== 'string' || request.text.trim() === '' || request.text.length > CHAT_MAX_MEMORY_TEXT) {
        return Promise.reject(new TypeError('editMemory needs some text'))
      }
      return invoke(CHAT_EDIT_MEMORY, { memoryId: request.memoryId, text: request.text })
    },

    removeMemory: (request) => {
      if (!isChatId(request?.memoryId)) return Promise.reject(new TypeError('removeMemory needs a memory id'))
      return invoke(CHAT_REMOVE_MEMORY, { memoryId: request.memoryId })
    },

    listProposals: () => invoke(CHAT_LIST_PROPOSALS, EMPTY_REQUEST),

    setProposalStatus: (request) => {
      if (!isChatId(request?.proposalId)) return Promise.reject(new TypeError('setProposalStatus needs a proposal id'))
      if (!PROPOSAL_DECISIONS.includes(request.status)) {
        return Promise.reject(new TypeError('setProposalStatus needs a decision'))
      }
      return invoke(CHAT_SET_PROPOSAL_STATUS, { proposalId: request.proposalId, status: request.status })
    },

    editProposal: (request) => {
      if (!isChatId(request?.proposalId)) return Promise.reject(new TypeError('editProposal needs a proposal id'))
      if (typeof request.title !== 'string' || request.title.trim() === '' || request.title.length > 200) {
        return Promise.reject(new TypeError('editProposal needs a title'))
      }
      // An empty note is a real answer: it is how a person removes one. Absent and
      // empty are therefore both forwarded, and only an oversized value is refused.
      if (request.notes !== undefined && (typeof request.notes !== 'string' || request.notes.length > 600)) {
        return Promise.reject(new TypeError('editProposal notes are too long'))
      }
      if (request.dueHint !== undefined && (typeof request.dueHint !== 'string' || request.dueHint.length > 40)) {
        return Promise.reject(new TypeError('editProposal due hint is too long'))
      }
      /*
       * Only the four named fields are forwarded. Anything else the page attached to
       * the request stops here rather than being handed to the main process, where a
       * strict schema would refuse it and the person would see a refusal instead of
       * the edit they made.
       */
      const payload = { proposalId: request.proposalId, title: request.title }
      if (request.notes !== undefined) payload.notes = request.notes
      if (request.dueHint !== undefined) payload.dueHint = request.dueHint
      return invoke(CHAT_EDIT_PROPOSAL, payload)
    },

    closeThread: (request) => {
      if (!isChatId(request?.threadId)) return Promise.reject(new TypeError('closeThread needs a thread id'))
      return invoke(CHAT_CLOSE_THREAD, { threadId: request.threadId })
    },

    onEvent: (listener) => {
      if (typeof listener !== 'function') throw new TypeError('onEvent needs a listener function')

      function handlePush (event, payload) {
        if (!isChatEvent(payload)) return
        listener(payload)
      }

      transport.on(CHAT_EVENT_PUSH, handlePush)

      let removed = false
      return function unsubscribe () {
        if (removed) return
        removed = true
        transport.removeListener(CHAT_EVENT_PUSH, handlePush)
      }
    },
  })
}

contextBridge.exposeInMainWorld('zuriChats', createChatApi(TRANSPORT))
