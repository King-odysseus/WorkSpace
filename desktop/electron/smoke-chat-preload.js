'use strict'

/*
 * The bridges a smoke-test window is given, so the real conversation screen can be
 * driven in real Electron without a server, a session or a provider.
 *
 * Why this exists at all: the conversation screen is the one part of the shell that
 * cannot be checked from a node test. Everything worth proving about it - that a
 * business switch clears the conversation in the same frame, that a failed turn's
 * retry carries the original words, that an answer states the fallback position,
 * that a long unbroken message does not push the layout sideways - is a property of
 * React state, and React state only exists once something has mounted.
 *
 * The production preload is not used here and is not modified. This file is loaded
 * only by `smoke-chat.js`, into a hidden window, and it answers with invented rows
 * of exactly the shapes the real main process sends. A check that passes here is a
 * check that the screen behaves; it is not a claim that the main process works,
 * which is what the rest of the smoke test and the node suite are for.
 *
 * The data is deliberately chosen so each rule has something to fail on:
 *
 * - Two businesses, each with its own thread, so a switch that leaves the previous
 *   conversation on screen is visible as the wrong thread title.
 * - One thread with three messages, including an unbroken 600-character answer, so
 *   overflow has a chance to happen.
 * - One thread with no messages, so the empty state has a chance to draw.
 * - The first turn always fails, and later turns succeed, so "Try again" has both a
 *   failure to offer and a success to reach.
 *
 * `window.__smoke` is the test's own handle on that data: it is how a check switches
 * mode, and how it reads back what the screen actually asked for. Nothing in the
 * shipped app defines it, and the checks that use it are the only readers.
 */

const { contextBridge } = require('electron')

const ACCESS_VERSION = 1
const PROVIDER_SETTINGS_VERSION = 1

/** One instant for every invented row: nothing here is about a clock. */
const AT = '2026-11-16T09:30:00.000Z'

/** The business the window opens on. */
const ZURI_LOFTS = 11
const TIJHA_BOOKS = 12

const LOFTS_THREADS = 'aaaaaa11'
const LOFTS_EMPTY_THREAD = 'aaaaaa12'
const BOOKS_THREAD = 'bbbbbb21'

/** Long enough to overflow a 360px column unless the bubble wraps. */
const UNBROKEN = 'x'.repeat(600)

function message (id, threadId, seq, role, content, origin) {
  return {
    id,
    threadId,
    seq,
    role,
    content,
    provider: origin === undefined ? null : origin.provider,
    model: origin === undefined ? null : origin.model,
    cloud: origin === undefined ? null : origin.cloud,
    createdAt: AT,
  }
}

const MESSAGES = {
  [LOFTS_THREADS]: [
    message('m00001', LOFTS_THREADS, 1, 'user', 'Which invoices are overdue?'),
    message('m00002', LOFTS_THREADS, 2, 'assistant', 'Three are overdue, and the Tilley quote is unsent.', {
      provider: 'anthropic', model: 'claude-sonnet-4-5', cloud: true,
    }),
    // No attribution recorded on purpose: the chip must say so rather than guess
    // "Local", which is the one label that would make somebody relax.
    message('m00003', LOFTS_THREADS, 3, 'assistant', UNBROKEN),
  ],
  [LOFTS_EMPTY_THREAD]: [],
  [BOOKS_THREAD]: [
    message('m00021', BOOKS_THREAD, 1, 'user', 'How many copies of the new title are left?'),
  ],
}

function thread (id, title, pinned, count) {
  return {
    id,
    title,
    pinned,
    createdAt: AT,
    updatedAt: AT,
    closedAt: null,
    messageCount: count,
  }
}

const THREADS = {
  [ZURI_LOFTS]: [
    thread(LOFTS_THREADS, 'Overdue invoices', true, 3),
    thread(LOFTS_EMPTY_THREAD, 'Quote follow ups', false, 0),
  ],
  [TIJHA_BOOKS]: [
    thread(BOOKS_THREAD, 'Stock levels', false, 1),
  ],
}

const MEMORY = {
  [ZURI_LOFTS]: [
    {
      id: 'a00001',
      kind: 'decision',
      text: 'Quotes go out on Fridays.',
      sourceMessageId: null,
      origin: 'ai',
      locked: false,
      createdAt: AT,
      updatedAt: AT,
    },
    {
      id: 'a00002',
      kind: 'open_question',
      text: 'Whether the Tilley deposit is still owed.',
      sourceMessageId: null,
      origin: 'ai',
      locked: false,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  [TIJHA_BOOKS]: [],
}

const PROPOSALS = {
  [ZURI_LOFTS]: [
    {
      id: 'prop-01',
      threadId: LOFTS_THREADS,
      kind: 'task',
      status: 'pending',
      title: 'Chase the Tilley quote',
      payload: { title: 'Chase the Tilley quote', notes: 'Ask for the signed copy.', dueHint: 'Friday' },
      idempotencyKey: 'key-01',
      expiresAt: null,
      createdAt: AT,
      updatedAt: AT,
    },
  ],
  [TIJHA_BOOKS]: [],
}

/** The models the picker lists: one cloud, one local, both with capabilities. */
const MODELS = [
  {
    id: 'claude-sonnet-4-5',
    providerId: 'anthropic',
    label: 'Claude Sonnet 4.5',
    cloud: true,
    capabilities: {
      contextWindow: 200000,
      maxOutput: 8192,
      tools: 'native',
      vision: true,
      webSearch: false,
      streaming: true,
      embeddings: false,
      jsonMode: false,
    },
  },
  {
    id: 'qwen2.5:7b',
    providerId: 'custom-local',
    label: 'Qwen 2.5 7B',
    cloud: false,
    capabilities: {
      contextWindow: 32768,
      maxOutput: 4096,
      tools: 'prompted',
      vision: false,
      webSearch: false,
      streaming: true,
      embeddings: false,
      jsonMode: true,
    },
  },
]

/* ------------------------------------------------------------------ *
 * The state the window draws
 * ------------------------------------------------------------------ */

const smoke = {
  /** Which business the screen is working in. Changing it pushes a new state. */
  selectedWorkspaceId: ZURI_LOFTS,
  mode: 'copilot',
  dockOpen: false,
  theme: 'light',
  /** Every text the screen has asked to send, in order. */
  sent: [],
  /** Every memory edit, so an edit can be proved to have reached the bridge. */
  edited: [],
  /** Turn counter, so each send gets its own id. */
  turn: 0,
  /** How often the screen has asked for each read, so a stuck screen can be seen. */
  calls: { listThreads: 0, listMessages: 0 },
  accessListeners: new Set(),
  shellListeners: new Set(),
  chatListeners: new Set(),
}

function accessState () {
  return {
    version: ACCESS_VERSION,
    status: 'ready',
    reason: null,
    identity: { id: 7, name: 'Tunde Bakare' },
    workspaces: [
      { id: ZURI_LOFTS, name: 'Zuri Lofts', role: 'owner', granted: true },
      { id: TIJHA_BOOKS, name: 'Tijha Books', role: 'owner', granted: true },
    ],
    selectedWorkspaceId: smoke.selectedWorkspaceId,
  }
}

function shellState () {
  return {
    mode: smoke.mode,
    dockOpen: smoke.dockOpen,
    maximized: false,
    theme: smoke.theme,
    platform: 'win32',
  }
}

function emitAccess () {
  const state = accessState()
  for (const listener of smoke.accessListeners) listener(state)
}

function emitShell () {
  const state = shellState()
  for (const listener of smoke.shellListeners) listener(state)
}

function emitChat (event) {
  for (const listener of smoke.chatListeners) listener(event)
}

/** A turn runs on a timer so the screen paints the question before the answer. */
function later (run) {
  setTimeout(run, 20)
}

function currentThreads () {
  return THREADS[smoke.selectedWorkspaceId] ?? []
}

function currentMessages (threadId) {
  return MESSAGES[threadId] ?? []
}

function assistantRow (threadId, content) {
  return message(`m${String(900 + smoke.turn).padStart(5, '0')}`, threadId, smoke.turn + 10, 'assistant', content, {
    provider: 'anthropic', model: 'claude-sonnet-4-5', cloud: true,
  })
}

/* ------------------------------------------------------------------ *
 * The bridges
 * ------------------------------------------------------------------ */

const zuriShell = {
  getState: async () => shellState(),
  readState: async () => shellState(),
  setMode: async (mode) => {
    smoke.mode = mode === 'workspace' ? 'workspace' : 'copilot'
    emitShell()
    return shellState()
  },
  toggleDock: async () => {
    smoke.dockOpen = !smoke.dockOpen
    emitShell()
    return shellState()
  },
  windowAction: async () => shellState(),
  onState: (listener) => {
    smoke.shellListeners.add(listener)
    return () => smoke.shellListeners.delete(listener)
  },
}

const zuriAccess = {
  readState: async () => ({ ok: true, value: accessState() }),
  refresh: async () => ({ ok: true, value: accessState() }),
  selectWorkspace: async (workspaceId) => {
    /*
     * The switch is applied and pushed before the reply is returned, which is the
     * order the real controller uses. A screen that waited for the reply to clear
     * would show the previous business's conversation for that gap, and this is
     * the shape that lets the test catch it.
     */
    smoke.selectedWorkspaceId = workspaceId
    emitAccess()
    return { ok: true, value: accessState() }
  },
  listManagers: async () => ({ ok: true, value: { workspaceId: smoke.selectedWorkspaceId, managers: [] } }),
  setPermission: async () => ({ ok: false, reason: 'not_found' }),
  signOut: async () => {
    const locked = { ...accessState(), status: 'locked', reason: 'signed_out', identity: null, workspaces: [], selectedWorkspaceId: null }
    for (const listener of smoke.accessListeners) listener(locked)
    return { ok: true, value: locked }
  },
  onState: (listener) => {
    smoke.accessListeners.add(listener)
    return () => smoke.accessListeners.delete(listener)
  },
}

const zuriChats = {
  listThreads: async () => {
    smoke.calls.listThreads += 1
    return { threads: currentThreads() }
  },
  createThread: async () => {
    const created = thread(`cccc${String(smoke.turn + 1).padStart(2, '0')}`, 'New conversation', false, 0)
    MESSAGES[created.id] = []
    THREADS[smoke.selectedWorkspaceId] = [created, ...currentThreads()]
    return { thread: created }
  },
  renameThread: async (request) => ({ thread: { ...thread(request.threadId, request.title, false, 0) } }),
  pinThread: async (request) => ({ thread: { ...thread(request.threadId, 'Overdue invoices', request.pinned, 3) } }),
  removeThread: async () => ({ removed: true }),
  listMessages: async (request) => {
    smoke.calls.listMessages += 1
    return { messages: currentMessages(request.threadId) }
  },
  closeThread: async () => ({ summary: null, added: 0 }),
  cancelTurn: async (request) => ({ turnId: '', stopped: true }),
  payloadPreview: async () => ({
    cloud: true,
    messages: [{ role: 'user', text: 'Which invoices are overdue?' }],
    placeholders: [
      { token: '[BUSINESS_1]', label: 'Business name' },
      { token: '[PERSON_1]', label: 'Person' },
    ],
    blocked: false,
    blockedReason: null,
  }),
  sendMessage: async (request) => {
    /*
     * The first turn fails and every later one succeeds. That gives the retry check
     * both halves it needs in one window: something to retry, then an answer.
     */
    smoke.turn += 1
    const turnId = `turn-${smoke.turn}`
    const text = String(request.text)
    smoke.sent.push(text)

    const userMessage = message(`m${String(800 + smoke.turn).padStart(5, '0')}`, request.threadId, smoke.turn, 'user', text)

    later(() => {
      if (smoke.turn === 1) {
        emitChat({
          type: 'failed',
          turnId,
          threadId: request.threadId,
          failure: 'network',
          userMessageId: userMessage.id,
          retryable: true,
        })
        return
      }
      emitChat({ type: 'delta', turnId, threadId: request.threadId, text: 'Three are ' })
      emitChat({ type: 'done', turnId, threadId: request.threadId, message: assistantRow(request.threadId, 'Three are overdue.') })
    })

    return { turnId, threadId: request.threadId, userMessage }
  },
  listMemory: async () => ({ memory: MEMORY[smoke.selectedWorkspaceId] ?? [] }),
  editMemory: async (request) => {
    smoke.edited.push({ memoryId: request.memoryId, text: request.text })
    return { item: { id: request.memoryId, kind: 'decision', text: request.text, sourceMessageId: null, origin: 'user', locked: true, createdAt: AT, updatedAt: AT } }
  },
  removeMemory: async () => ({ removed: true }),
  listProposals: async () => ({ proposals: PROPOSALS[smoke.selectedWorkspaceId] ?? [] }),
  setProposalStatus: async (request) => ({ proposal: { ...PROPOSALS[smoke.selectedWorkspaceId][0], id: request.proposalId, status: request.status } }),
  editProposal: async (request) => ({ proposal: { ...PROPOSALS[smoke.selectedWorkspaceId][0], id: request.proposalId, title: request.title } }),
  onEvent: (listener) => {
    smoke.chatListeners.add(listener)
    return () => smoke.chatListeners.delete(listener)
  },
}

const zuriProviders = {
  readState: async () => ({
    ok: true,
    value: {
      version: PROVIDER_SETTINGS_VERSION,
      signedIn: true,
      /*
       * The catalogue entry is the shape the shipped bridge returns, field for
       * field: `id` is what the Models form's provider list is keyed on, and an
       * entry without it silently renders an unchosen option, so the address and
       * starting-model fields never appear and the form cannot be exercised at all.
       * Kept in step with `providerCatalogEntrySchema` rather than trimmed to what a
       * check happens to read.
       */
      catalog: [{
        id: 'anthropic',
        providerId: 'anthropic',
        label: 'Anthropic',
        kind: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-5',
        requiresKey: true,
        local: false,
        needsBaseUrl: false,
      }],
      providers: [
        {
          presetId: 'anthropic',
          providerId: 'anthropic',
          label: 'Anthropic',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-5',
          local: false,
          requiresKey: true,
          hasCredential: true,
          fingerprint: 'b1ff',
        },
      ],
    },
  }),
  listModels: async () => ({ ok: true, value: { models: MODELS } }),
  saveProvider: async () => ({ ok: true, value: { version: PROVIDER_SETTINGS_VERSION, signedIn: true, catalog: [], providers: [] } }),
  testConnection: async () => ({ ok: true, value: { ok: true, models: MODELS } }),
  discoverLocal: async () => ({ ok: true, value: { servers: [] } }),
  setCredential: async () => ({ ok: false, reason: 'invalid_request' }),
  removeCredential: async () => ({ ok: true, value: { version: PROVIDER_SETTINGS_VERSION, signedIn: true, catalog: [], providers: [] } }),
  forgetAccount: async () => ({ ok: true, value: null }),
  onState: () => () => {},
}

/**
 * The test's own handle. It is how a check switches mode or business and reads back
 * what the screen asked for; nothing in the shipped app defines it.
 */
const handle = {
  state: () => ({
    sent: smoke.sent.slice(),
    edited: smoke.edited.slice(),
    selectedWorkspaceId: smoke.selectedWorkspaceId,
    calls: { ...smoke.calls },
  }),
  setMode: (mode, dockOpen) => {
    smoke.mode = mode === 'workspace' ? 'workspace' : 'copilot'
    smoke.dockOpen = Boolean(dockOpen)
    emitShell()
  },
  setTheme: (theme) => {
    /* The theme reaches the page from the main process, so the check pushes it the
     * same way rather than toggling a class on the document itself. */
    smoke.theme = theme === 'dark' ? 'dark' : 'light'
    emitShell()
  },
  selectWorkspace: (workspaceId) => {
    smoke.selectedWorkspaceId = workspaceId
    emitAccess()
  },
  failure: () => ({
    failure: 'network',
    sentence: 'The provider could not be reached.',
  }),
}

try {
  contextBridge.exposeInMainWorld('zuriShell', zuriShell)
  contextBridge.exposeInMainWorld('zuriAccess', zuriAccess)
  contextBridge.exposeInMainWorld('zuriChats', zuriChats)
  contextBridge.exposeInMainWorld('zuriProviders', zuriProviders)
  contextBridge.exposeInMainWorld('__smoke', handle)
} catch (error) {
  // A bridge that cannot be exposed is a failed check, not a crash: the checks read
  // a missing bridge as false and say which one was absent.
  void error
}
