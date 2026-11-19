'use strict'

/*
 * The chat channel surface, tested through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs` from `main/ipc/index.ts`,
 * and this file requires that build rather than the TypeScript source, so what is
 * proven is the CommonJS the main process registers. A test that fails here with
 * a missing `registerChatIpc` means the chat layer is not re-exported by that
 * entry yet (or the build is stale), and `npm run build:main` is the fix, not a
 * change to this file.
 *
 * Nothing below opens a database, reaches a provider or runs Electron. The
 * service is a hand-written object of plain functions that records what it was
 * asked and answers with a canned reply, `ipcMain` is a Map of listeners, and the
 * trusted-view registry records pushes. That is deliberate: this file is about
 * the rules the channel surface itself owns, and every one of them is decided
 * before or after the service is reached rather than inside it.
 *
 * - Only the contract's request channels exist, each registered once under the
 *   contract's own string, and dispose() removes every one of them.
 * - The sender is judged before its payload is read, so an untrusted window
 *   learns nothing from the way its malformed request was refused.
 * - A refusal is a token plus its fixed sentence. A ChatError keeps its own
 *   token; anything else becomes `internal_error`, and neither the answer nor the
 *   log line carries the original message, because that message can quote a
 *   conversation.
 * - A good request reaches the service as the schema parsed it, the service's
 *   answer comes straight back, and an answer that arrives a few microtasks later
 *   is awaited rather than handed over as a pending promise.
 *
 * One rule is specific to a conversation and has no counterpart on the access or
 * Models surfaces: a streamed event is pushed to every trusted view on the one
 * push channel, and a delta with no text is dropped instead of costing a repaint.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

/*
 * Four directories up from `main/chat/` is `desktop/`, and the bundle sits under
 * `desktop/build/main/`. Same depth as the Models channel test, same reason.
 */
const api = require('../../../../build/main/ipc.cjs')

/**
 * What this file needs the bundle to export, and what each thing must be.
 *
 * Checked once at load: a missing export is a wiring gap, and saying so once is
 * clearer than every test failing with "not a function" for two different reasons.
 */
const REQUIRED_EXPORTS = {
  registerChatIpc: 'function',
  chatFailureReply: 'function',
  ChatError: 'function',
  chatEventSchema: 'object',
  CHAT_CHANNELS: 'object',
  CHAT_REQUEST_SCHEMAS: 'object',
  CHAT_REPLY_SCHEMAS: 'object',
  CHAT_FAILURES: 'object',
  CHAT_FAILURE_MESSAGES: 'object',
  CHAT_CHANNEL_ORDER: 'object',
}

for (const [name, type] of Object.entries(REQUIRED_EXPORTS)) {
  assert.equal(
    typeof api[name],
    type,
    `${name} is not exported by the main bundle (run npm run build:main)`,
  )
}

const {
  registerChatIpc,
  chatFailureReply,
  ChatError,
  chatEventSchema,
  CHAT_CHANNELS,
  CHAT_REQUEST_SCHEMAS,
  CHAT_REPLY_SCHEMAS,
  CHAT_FAILURES,
  CHAT_FAILURE_MESSAGES,
  CHAT_CHANNEL_ORDER,
} = api

/**
 * The sixteen request channels, written out rather than read from the contract.
 *
 * Deliberately a second statement of the same list: a channel added to
 * `CHAT_CHANNELS` without a handler, or a handler left behind after a rename,
 * fails the registration test instead of becoming a channel that answers nothing.
 */
const REQUEST_NAMES = Object.freeze([
  'listThreads',
  'createThread',
  'renameThread',
  'pinThread',
  'removeThread',
  'listMessages',
  'sendMessage',
  'cancelTurn',
  'payloadPreview',
  'listMemory',
  'editMemory',
  'removeMemory',
  'listProposals',
  'setProposalStatus',
  'editProposal',
  'closeThread',
])

/** The one conversation every fixture in this file is about. */
const THREAD_ID = 't1a2b3c4'

/** One instant every fixture shares: these tests are about channels, not a clock. */
const AT = '2026-11-16T09:30:00.000Z'

/** A phrase that must not appear in an answer or in a log line. */
const CANARY = 'the Tilley quote moves to Friday'

/**
 * What the trusted-view registry sees. The shell bridge marks a trusted page and
 * the mark is the only thing the check reads, so an unmarked event is untrusted.
 */
const TRUSTED_EVENT = Object.freeze({ sender: { id: 1 }, trusted: true })
const UNTRUSTED_EVENT = Object.freeze({ sender: { id: 2 }, trusted: false })

/* ------------------------------------------------------------------ *
 * Fixtures: rows and replies in the contract's own shapes
 * ------------------------------------------------------------------ */

/** A stored conversation as the sidebar draws one. */
function threadRow (overrides = {}) {
  return {
    id: THREAD_ID,
    title: 'Overdue tasks',
    pinned: false,
    createdAt: AT,
    updatedAt: AT,
    closedAt: null,
    messageCount: 1,
    ...overrides,
  }
}

/** A person's own message: no model produced it, so the three attribution fields are null. */
function messageRow (overrides = {}) {
  return {
    id: 'm1a2b3c4',
    threadId: THREAD_ID,
    seq: 1,
    role: 'user',
    content: 'Which tasks are overdue?',
    provider: null,
    model: null,
    cloud: null,
    createdAt: AT,
    ...overrides,
  }
}

/** A remembered item, as the panel draws one. */
function memoryRow (overrides = {}) {
  return {
    id: 'r1a2b3c4',
    kind: 'decision',
    text: 'The Tilley quote moves to Friday.',
    sourceMessageId: 'm1a2b3c4',
    origin: 'ai',
    locked: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/** A drafted task, waiting on a person. */
function proposalRow (overrides = {}) {
  return {
    id: 'p1a2b3c4',
    threadId: THREAD_ID,
    kind: 'task',
    status: 'pending',
    title: 'Chase the Tilley quote',
    payload: { title: 'Chase the Tilley quote' },
    idempotencyKey: 'k1a2b3c4',
    expiresAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/** A rolling summary, as closing a thread leaves one. */
function summaryRow (overrides = {}) {
  return {
    threadId: THREAD_ID,
    text: 'The Tilley quote was discussed and moved to Friday.',
    coversThroughSeq: 4,
    updatedAt: AT,
    ...overrides,
  }
}

/**
 * One answer per request channel, in the reply shapes the service really returns.
 *
 * Built fresh on every call so a test that mutates an answer cannot change what
 * the next test is handed.
 */
function replyObjects () {
  return {
    listThreads: { threads: [threadRow()] },
    createThread: { thread: threadRow() },
    renameThread: { thread: threadRow({ title: 'Renamed' }) },
    pinThread: { thread: threadRow({ pinned: true }) },
    removeThread: { removed: true },
    listMessages: { messages: [messageRow()] },
    sendMessage: { turnId: 'turn-1', threadId: THREAD_ID, userMessage: messageRow() },
    cancelTurn: { turnId: 'turn-1', stopped: true },
    payloadPreview: {
      cloud: false,
      messages: [{ role: 'user', text: 'Which tasks are overdue?' }],
      placeholders: [],
      blocked: false,
      blockedReason: null,
    },
    listMemory: { memory: [memoryRow()] },
    editMemory: { item: memoryRow({ text: 'Corrected by hand.', origin: 'user', locked: true }) },
    removeMemory: { removed: true },
    listProposals: { proposals: [proposalRow()] },
    setProposalStatus: { proposal: proposalRow({ status: 'approved' }) },
    editProposal: { proposal: proposalRow({ title: 'Send the June invoice and a reminder' }) },
    closeThread: { summary: summaryRow(), added: 2 },
  }
}

/** A well-formed request for every channel, built per call so nothing is shared. */
function validRequests () {
  return {
    listThreads: {},
    createThread: { title: 'Planning' },
    renameThread: { threadId: THREAD_ID, title: 'Renamed' },
    pinThread: { threadId: THREAD_ID, pinned: true },
    removeThread: { threadId: THREAD_ID },
    listMessages: { threadId: THREAD_ID, afterSeq: 3 },
    sendMessage: { threadId: THREAD_ID, text: 'Which tasks are overdue?', presetId: 'openai' },
    cancelTurn: { threadId: THREAD_ID },
    payloadPreview: { threadId: THREAD_ID, presetId: 'openai', text: 'Which tasks are overdue?', modelId: 'gpt-4.1-mini' },
    listMemory: {},
    editMemory: { memoryId: 'r1a2b3c4', text: 'The quote actually moves to Monday.' },
    removeMemory: { memoryId: 'r1a2b3c4' },
    listProposals: {},
    setProposalStatus: { proposalId: 'p1a2b3c4', status: 'rejected' },
    editProposal: { proposalId: 'p1a2b3c4', title: 'Send the June invoice', notes: 'Ask for the signed copy.' },
    closeThread: { threadId: THREAD_ID },
  }
}

/* ------------------------------------------------------------------ *
 * Fakes
 * ------------------------------------------------------------------ */

/**
 * A stand-in for Electron's ipcMain.
 *
 * Listeners are kept in a Map so a test can call one the way a renderer's invoke
 * would, and every handle() and removeHandler() call is recorded in order: a Map
 * alone would hide a channel registered twice and a removal of one never there.
 */
function fakeIpcMain () {
  const handlers = new Map()
  const registrations = []
  const removals = []
  return {
    handle (channel, listener) {
      registrations.push(channel)
      handlers.set(channel, listener)
    },
    removeHandler (channel) {
      removals.push(channel)
      handlers.delete(channel)
    },
    handlerFor (channel) {
      return handlers.get(channel)
    },
    channels () {
      return [...handlers.keys()]
    },
    registered () {
      return [...registrations]
    },
    removed () {
      return [...removals]
    },
  }
}

/** The trusted-view registry: pushes are recorded, never sent anywhere. */
function fakeViews () {
  const sent = []
  return {
    sent,
    // Answered from the event's own mark, so a window that never signed in is
    // untrusted by default rather than by a flag set somewhere else.
    isTrustedSender: (event) => event !== null && typeof event === 'object' && event.trusted === true,
    broadcast (channel, payload) {
      sent.push({ channel, payload })
    },
  }
}

/**
 * A service that answers validly by default and records what it was asked.
 *
 * Every answer is overridable, so a test can make one channel refuse, throw, or
 * answer later without a mocking library and without that behaviour reaching the
 * next test. `dispose` is present because the real service has it, and the IPC
 * layer must leave it alone: tearing the surface down is not tearing the
 * conversation down.
 */
function fakeService (overrides = {}) {
  const calls = []
  const answers = {}

  for (const name of REQUEST_NAMES) {
    answers[name] = () => replyObjects()[name]
  }
  Object.assign(answers, overrides)

  const service = {
    calls,
    dispose () {
      calls.push({ method: 'dispose', request: undefined })
    },
  }

  for (const name of REQUEST_NAMES) {
    service[name] = (request) => {
      calls.push({ method: name, request })
      return answers[name](request)
    }
  }

  return service
}

/** Register the surface over the fakes, with a logger that keeps its lines. */
function harness ({ service = fakeService() } = {}) {
  const ipcMain = fakeIpcMain()
  const views = fakeViews()
  const warnings = []

  const bridge = registerChatIpc({
    ipcMain,
    service,
    views,
    log: { warn: (message) => warnings.push(message) },
  })

  /** Call one registered handler the way a renderer's invoke would. */
  async function call (name, request, event = TRUSTED_EVENT) {
    const handler = ipcMain.handlerFor(CHAT_CHANNELS[name])
    assert.equal(typeof handler, 'function', `${name} is registered`)
    return await handler(event, request)
  }

  return { ipcMain, views, service, bridge, warnings, call }
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

test('the sixteen request channels are registered once under the contract strings, and the push channel is not', () => {
  const { ipcMain, bridge } = harness()

  const names = Object.keys(CHAT_CHANNELS).filter((name) => name !== 'event')
  assert.equal(names.length, 16, 'the contract no longer has exactly sixteen request channels')
  assert.deepEqual([...names].sort(), [...REQUEST_NAMES].sort())

  /*
   * One string per channel, spelled the way the contract spells it. The literal
   * prefix is repeated here so a channel renamed on both sides at once, in a way
   * that keeps them equal to each other, still fails this file.
   */
  for (const name of REQUEST_NAMES) {
    assert.equal(CHAT_CHANNELS[name], `zuri:chat:${name}`)
  }
  assert.equal(CHAT_CHANNELS.event, 'zuri:chat:event')

  const expected = REQUEST_NAMES.map((name) => CHAT_CHANNELS[name])

  // Sorted deep equality fails on a duplicate, so this is "exactly once".
  assert.deepEqual(ipcMain.registered().sort(), [...expected].sort())
  assert.deepEqual(ipcMain.channels().sort(), [...expected].sort())
  for (const channel of expected) {
    assert.equal(typeof ipcMain.handlerFor(channel), 'function', `${channel} has a handler`)
  }

  /*
   * The push channel is what main sends on. A page that could ask on it would be
   * asking for something the main process is meant to deliver unasked, so nothing
   * is registered there at all.
   */
  assert.equal(ipcMain.registered().includes(CHAT_CHANNELS.event), false)
  assert.equal(ipcMain.handlerFor(CHAT_CHANNELS.event), undefined)

  // Two methods and no channel name in either: a page that could name a channel
  // could name one it was not given.
  assert.deepEqual(Object.keys(bridge).sort(), ['dispose', 'publish'])
  assert.equal(typeof bridge.publish, 'function')
  assert.equal(typeof bridge.dispose, 'function')
})

test('one request schema and one reply schema exist per request channel, in the contract order', () => {
  assert.deepEqual(Object.keys(CHAT_REQUEST_SCHEMAS).sort(), [...REQUEST_NAMES].sort())
  assert.deepEqual(Object.keys(CHAT_REPLY_SCHEMAS).sort(), [...REQUEST_NAMES].sort())
  // The order the preload copies the strings in, checked by its own drift guard.
  assert.deepEqual([...CHAT_CHANNEL_ORDER], [...REQUEST_NAMES])
})

/* ------------------------------------------------------------------ *
 * Who may ask
 * ------------------------------------------------------------------ */

test('an untrusted sender is refused before its request is read, and the log line carries no content', async () => {
  const { service, warnings, call } = harness()

  /*
   * Well-formed requests on purpose, with a phrase in the ones that carry text:
   * the refusal must be about the sender, not about the body, and the log line
   * must not quote what the window was trying to say.
   */
  const requests = validRequests()
  requests.sendMessage = { ...requests.sendMessage, text: CANARY }
  requests.payloadPreview = { ...requests.payloadPreview, text: CANARY }

  const attempts = [UNTRUSTED_EVENT, {}, null]

  for (const name of REQUEST_NAMES) {
    for (const event of attempts) {
      const reply = await call(name, requests[name], event)
      assert.deepEqual(reply, {
        ok: false,
        failure: 'untrusted_sender',
        message: CHAT_FAILURE_MESSAGES.untrusted_sender,
      }, `${name} with ${JSON.stringify(event)}`)
    }
  }

  assert.deepEqual(service.calls, [], 'no part of the service was touched')

  // The refusal a page receives is the contract's own, so a token and its sentence
  // cannot drift apart from the helper the other surfaces use.
  assert.deepEqual(chatFailureReply('untrusted_sender'), {
    ok: false,
    failure: 'untrusted_sender',
    message: CHAT_FAILURE_MESSAGES.untrusted_sender,
  })

  // One fixed line per refusal, so the token is there to search for and nothing
  // else about the request is.
  assert.equal(warnings.length, REQUEST_NAMES.length * attempts.length)
  assert.equal(new Set(warnings).size, 1, 'the refusal line is not a fixed sentence')
  for (const line of warnings) {
    assert.equal(line.includes('untrusted'), true, line)
    assert.equal(line.includes(CANARY), false, 'the log line quotes the request text')
    assert.equal(line.includes(THREAD_ID), false, 'the log line quotes the thread')
    assert.equal(line.includes('{'), false, 'the log line carries a serialized request')
  }
})

/* ------------------------------------------------------------------ *
 * What may be asked
 * ------------------------------------------------------------------ */

test('a malformed request is refused on every channel and never reaches the service', async () => {
  const { service, warnings, call } = harness()

  const longId = 'a'.repeat(65)
  const longText = 'x'.repeat(200_001)

  /*
   * A missing field, a field of the wrong type and an unknown extra key, on each
   * channel. None of them is a thing a person can do by accident, and all of them
   * are refused before a service is called: filling in a missing field for the
   * caller would mean the surface, not the request, decided what was asked.
   */
  const bad = [
    // The list is searched by a short word. A number is not a search.
    { name: 'listThreads', request: null, why: 'no body' },
    { name: 'listThreads', request: 'threads', why: 'a string' },
    { name: 'listThreads', request: { search: 5 }, why: 'a number as a search' },
    { name: 'listThreads', request: { search: 'a'.repeat(121) }, why: 'an over-long search' },
    { name: 'listThreads', request: { query: 'x' }, why: 'an unknown key' },

    { name: 'createThread', request: { title: 5 }, why: 'a number as a title' },
    { name: 'createThread', request: { title: 'a'.repeat(201) }, why: 'an over-long title' },
    { name: 'createThread', request: { id: THREAD_ID }, why: 'an unknown key' },

    { name: 'renameThread', request: { threadId: THREAD_ID }, why: 'a missing title' },
    { name: 'renameThread', request: { threadId: '', title: 'x' }, why: 'an empty thread id' },
    { name: 'renameThread', request: { threadId: longId, title: 'x' }, why: 'an over-long thread id' },
    {
      name: 'renameThread',
      request: { threadId: THREAD_ID, title: 'x', pinned: true },
      why: 'an unknown key',
    },

    { name: 'pinThread', request: { threadId: THREAD_ID }, why: 'a missing pin' },
    { name: 'pinThread', request: { threadId: THREAD_ID, pinned: 'true' }, why: 'text as a pin' },
    // A pin is a decision the screen draws, so the flag is a boolean and not 1.
    { name: 'pinThread', request: { threadId: THREAD_ID, pinned: 1 }, why: 'a number as a pin' },

    { name: 'removeThread', request: {}, why: 'a missing thread id' },
    { name: 'removeThread', request: { threadId: 7 }, why: 'a number as a thread id' },
    { name: 'removeThread', request: { threadId: THREAD_ID, hard: true }, why: 'an unknown key' },

    { name: 'listMessages', request: { threadId: THREAD_ID, afterSeq: -1 }, why: 'a negative cursor' },
    { name: 'listMessages', request: { threadId: THREAD_ID, afterSeq: 1.5 }, why: 'a fractional cursor' },
    { name: 'listMessages', request: { threadId: THREAD_ID, afterSeq: '3' }, why: 'text as a cursor' },
    {
      name: 'listMessages',
      request: { threadId: THREAD_ID, afterSeq: 1, limit: 2 },
      why: 'an unknown key',
    },

    { name: 'sendMessage', request: { threadId: THREAD_ID, text: 'hi' }, why: 'a missing preset' },
    { name: 'sendMessage', request: { threadId: THREAD_ID, presetId: 'openai' }, why: 'a missing text' },
    {
      name: 'sendMessage',
      request: { threadId: THREAD_ID, text: '', presetId: 'openai' },
      why: 'an empty text',
    },
    {
      name: 'sendMessage',
      request: { threadId: THREAD_ID, text: 7, presetId: 'openai' },
      why: 'a number as text',
    },
    {
      name: 'sendMessage',
      request: { threadId: THREAD_ID, text: longText, presetId: 'openai' },
      why: 'an over-long text',
    },
    {
      name: 'sendMessage',
      request: { threadId: THREAD_ID, text: 'hi', presetId: '' },
      why: 'an empty preset id',
    },
    {
      name: 'sendMessage',
      request: { threadId: THREAD_ID, text: 'hi', presetId: 'openai', baseUrl: 'https://x.test' },
      why: 'an unknown key',
    },

    { name: 'cancelTurn', request: { threadId: THREAD_ID, force: true }, why: 'an unknown key' },
    { name: 'cancelTurn', request: {}, why: 'a missing thread id' },

    { name: 'payloadPreview', request: { threadId: THREAD_ID, presetId: 'openai' }, why: 'a missing text' },
    {
      name: 'payloadPreview',
      request: { threadId: THREAD_ID, presetId: 'openai', text: 'hi', cloud: true },
      why: 'an unknown key',
    },
    {
      name: 'payloadPreview',
      request: { threadId: THREAD_ID, text: 'hi' },
      why: 'a missing preset',
    },
    {
      name: 'payloadPreview',
      request: { threadId: THREAD_ID, presetId: 'openai', text: 'hi', modelId: 'm'.repeat(201) },
      why: 'an over-long model id',
    },
    {
      name: 'payloadPreview',
      request: { threadId: THREAD_ID, presetId: 'openai', text: 'hi', modelId: '' },
      why: 'an empty model id',
    },
  ]

  for (const { name, request, why } of bad) {
    const reply = await call(name, request)
    assert.deepEqual(reply, {
      ok: false,
      failure: 'invalid_request',
      message: CHAT_FAILURE_MESSAGES.invalid_request,
    }, `${name} accepted ${why}`)
  }

  assert.deepEqual(service.calls, [], 'a refused request reached the service')

  /*
   * A malformed request is the caller's mistake, not something that happened in
   * the app, and a log line about it would be one line per keystroke from a page
   * in a loop. Nothing is logged.
   */
  assert.deepEqual(warnings, [])
})

/* ------------------------------------------------------------------ *
 * A request that is allowed
 * ------------------------------------------------------------------ */

test('a valid request reaches the service with the parsed body and the reply comes straight back', async () => {
  // The answers this file expects the service to give, one per channel.
  const replies = replyObjects()
  const { service, call, warnings } = harness()
  const requests = validRequests()

  /*
   * Every fixture is a reply the contract would draw, so a channel whose canned
   * answer drifted from its own schema fails here rather than passing as
   * something plausible.
   */
  for (const name of REQUEST_NAMES) {
    assert.equal(
      CHAT_REPLY_SCHEMAS[name].safeParse(replies[name]).success,
      true,
      `${name} answers with something the reply schema refuses`,
    )
  }

  for (const name of REQUEST_NAMES) {
    const reply = await call(name, requests[name])

    /*
     * The answer the service gave, whole: no envelope around it, no field added or
     * dropped on the way through, and no `ok` a success never has. Compared as a
     * round trip because that is what a renderer receives.
     */
    assert.deepEqual(JSON.parse(JSON.stringify(reply)), replies[name], `${name} reply`)
    assert.equal(Object.hasOwn(reply, 'ok'), false, `${name} wrapped a success as ok`)
  }

  assert.deepEqual(service.calls.map((entry) => entry.method), [...REQUEST_NAMES])

  for (const [index, name] of REQUEST_NAMES.entries()) {
    const entry = service.calls[index]
    /*
     * Exactly the fields that were sent and no others. What the service is given
     * is the schema's output, and that the schema ran at all is what the previous
     * test proves: a strict schema is the only thing that could refuse those
     * unknown keys.
     */
    assert.deepEqual(entry.request, requests[name], `${name} body`)
  }

  /*
   * The cursor arrives as a number, which is what the service branches on. A page
   * that sent a string was refused in the test above rather than reaching here
   * with a value the query would have coerced by accident.
   */
  const listMessages = service.calls.find((entry) => entry.method === 'listMessages')
  assert.equal(listMessages.request.afterSeq, 3)
  assert.equal(typeof listMessages.request.afterSeq, 'number')

  // Nothing on the allowed path is a refusal, so nothing is logged.
  assert.deepEqual(warnings, [])
})

/* ------------------------------------------------------------------ *
 * Refusals from below
 * ------------------------------------------------------------------ */

test('a ChatError keeps its own token and its fixed sentence, and the request text is not logged', async () => {
  const { warnings, call } = harness({
    service: fakeService({
      sendMessage: () => {
        throw new ChatError('busy')
      },
    }),
  })

  const reply = await call('sendMessage', {
    threadId: THREAD_ID,
    text: CANARY,
    presetId: 'openai',
  })

  assert.deepEqual(reply, {
    ok: false,
    failure: 'busy',
    message: CHAT_FAILURE_MESSAGES.busy,
  })
  // The token's own sentence, not whatever the error happened to say.
  assert.equal(reply.message, CHAT_FAILURE_MESSAGES.busy)
  assert.equal(CHAT_FAILURES.includes('busy'), true)

  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].includes('busy'), true, warnings[0])
  assert.equal(warnings[0].includes(CANARY), false, 'the log line quotes the request text')
})

test('an unexpected error becomes internal_error and its message goes nowhere', async () => {
  const secret = 'a phrase from the conversation nobody may log'

  const { warnings, call } = harness({
    service: fakeService({
      listMessages: () => {
        throw new Error(secret)
      },
    }),
  })

  const reply = await call('listMessages', { threadId: THREAD_ID })

  assert.deepEqual(reply, {
    ok: false,
    failure: 'internal_error',
    message: CHAT_FAILURE_MESSAGES.internal_error,
  })
  assert.equal(CHAT_FAILURES.includes('internal_error'), true)

  /*
   * A driver or provider message can quote a bound value, and a bound value here
   * is a sentence somebody typed. Neither the answer nor the log line may carry
   * it, and neither may carry any fragment of it.
   */
  assert.equal(JSON.stringify(reply).includes(secret), false, 'the answer quotes the error')
  assert.equal(JSON.stringify(reply).includes('conversation'), false)

  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].includes(secret), false, 'the log line quotes the error')
  assert.equal(warnings[0].includes('conversation'), false)
  assert.equal(warnings[0].includes('internal_error'), true, warnings[0])
})

/* ------------------------------------------------------------------ *
 * Events pushed at the page
 * ------------------------------------------------------------------ */

test('publish pushes an event on the push channel and drops a delta with no text', () => {
  const { views, bridge } = harness()

  const delta = {
    type: 'delta',
    turnId: 'turn-1',
    threadId: THREAD_ID,
    text: 'Three are overdue.',
  }
  // A real event, parsed first, so the fixture cannot drift from the contract.
  assert.deepEqual(chatEventSchema.parse(delta), delta)

  bridge.publish(delta)

  assert.equal(views.sent.length, 1)
  assert.equal(views.sent[0].channel, CHAT_CHANNELS.event)
  // The event itself, not a copy: `done` carries a stored row and the page draws
  // exactly what was persisted.
  assert.equal(views.sent[0].payload, delta)

  /*
   * An empty delta would append nothing and still cost a repaint, so it is
   * dropped. It is deliberately an event the schema would refuse: the drop has to
   * hold for a buggy producer, which is what a producer counting characters can
   * turn into at the end of a stream.
   */
  bridge.publish({ type: 'delta', turnId: 'turn-1', threadId: THREAD_ID, text: '' })
  assert.equal(views.sent.length, 1, 'an empty delta was broadcast')

  // A terminal event is pushed as it is, and the drop is not sticky.
  const failed = {
    type: 'failed',
    turnId: 'turn-1',
    threadId: THREAD_ID,
    failure: 'network',
    userMessageId: 'm1a2b3c4',
    retryable: true,
  }
  assert.deepEqual(chatEventSchema.parse(failed), failed)
  bridge.publish(failed)

  const singleCharacter = { type: 'delta', turnId: 'turn-2', threadId: THREAD_ID, text: 'a' }
  bridge.publish(singleCharacter)

  assert.deepEqual(views.sent.map((push) => push.payload), [delta, failed, singleCharacter])
  assert.equal(views.sent.every((push) => push.channel === CHAT_CHANNELS.event), true)
})

/* ------------------------------------------------------------------ *
 * Tearing the surface down
 * ------------------------------------------------------------------ */

test('dispose removes every handler it registered, and removes each one once', () => {
  const { ipcMain, service, bridge } = harness()

  const expected = REQUEST_NAMES.map((name) => CHAT_CHANNELS[name])
  assert.equal(ipcMain.channels().length, REQUEST_NAMES.length)

  bridge.dispose()

  assert.deepEqual(ipcMain.channels(), [], 'a handler survived dispose')
  assert.deepEqual(ipcMain.removed().sort(), [...expected].sort())
  for (const channel of expected) {
    // A page invoking after this gets no listener at all, which is the closed
    // answer rather than a handler that answers from a half-torn-down surface.
    assert.equal(ipcMain.handlerFor(channel), undefined, `${channel} still answers`)
  }

  // The second call has nothing left to remove, and must not remove a channel
  // twice: on Windows a repeated removeHandler throws, and this runs on a quit
  // path nobody is watching.
  bridge.dispose()
  assert.equal(ipcMain.removed().length, REQUEST_NAMES.length)
  assert.deepEqual(ipcMain.channels(), [])

  // Removing the channel surface is not stopping the conversations behind it.
  assert.equal(service.calls.some((entry) => entry.method === 'dispose'), false)
})

/* ------------------------------------------------------------------ *
 * Answers that arrive later
 * ------------------------------------------------------------------ */

test('a service that answers on a later microtask is awaited, so the reply is the value', async () => {
  const answer = { turnId: 'turn-9', threadId: THREAD_ID, userMessage: messageRow({ seq: 2 }) }

  const { ipcMain, service } = harness({
    service: fakeService({
      /*
       * Two microtask hops before the answer exists. One hop would be unwrapped by
       * the promise machinery anyway; two make "returned the promise instead of its
       * value" a different answer rather than a coincidentally equal one.
       */
      sendMessage: () => new Promise((resolve) => {
        queueMicrotask(() => {
          queueMicrotask(() => resolve(answer))
        })
      }),
    }),
  })

  const handler = ipcMain.handlerFor(CHAT_CHANNELS.sendMessage)
  const pending = handler(TRUSTED_EVENT, validRequests().sendMessage)

  // An async listener, so a page's invoke has something to await.
  assert.equal(typeof pending.then, 'function', 'the listener does not answer with a promise')

  const reply = await pending

  assert.deepEqual(reply, answer)
  // No promise anywhere in the answer: a caller that drew this would otherwise
  // print "[object Promise]" where a turn id belongs.
  assert.equal(typeof reply.then, 'undefined')
  assert.equal(Object.values(reply).some((value) => value instanceof Promise), false)

  // And the service was actually asked, once, before the answer existed.
  assert.deepEqual(service.calls.map((entry) => entry.method), ['sendMessage'])
  assert.equal(service.calls[0].request.threadId, THREAD_ID)
})
