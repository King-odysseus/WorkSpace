'use strict'

/*
 * The chat service, driven through the bundle Electron loads and a real database.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proved here is the CommonJS
 * the main process runs. Every case opens a real database in a temporary directory
 * and writes real rows, because four of the five things this file is about are
 * properties of what reached the disk rather than of a JavaScript object:
 *
 * - A conversation's threads are its own. Listing, renaming, pinning, searching and
 *   removing all answer inside one business, and an id from another business is
 *   refused rather than obeyed.
 * - A turn answers with a turn id before the model says anything, then streams its
 *   text, then reports exactly one terminal event. That order is what a screen draws
 *   a spinner from, so it is asserted in that order rather than only at the end.
 * - The reply is stored with the provider, the model and whether it ran in the
 *   cloud, and a failed turn keeps the person's own message so a retry is possible.
 * - A reply that outlives its account - a workspace switch, a sign-out - is neither
 *   published nor stored. The interesting moment is the one after the first delta
 *   has already been drawn, which is why the fake provider parks mid-reply.
 * - A cloud turn is scanned before it leaves the machine, so an email address blocks
 *   it and a business name travels as a token.
 *
 * The provider is the only fake. No network, no key, no Electron: its `stream` is an
 * async generator the test drives by hand, so a test can let one delta out, change
 * the world underneath the running turn, and only then let the rest out. A canned
 * generator could not express any of the cancellation or staleness cases.
 *
 * Two source discrepancies are recorded here rather than papered over.
 *
 * 1. `createChatService` hands its *business* scope to `store.repositories()`, and
 *    the store parses that argument strictly - it refuses the extra `businessId`
 *    key in `repositoriesFor` (store.ts). Against the real store every chat method
 *    would answer `invalid_request` before it reached a table. `serviceStore()` below
 *    is the one-line adapter that drops the key, so the rest of this file can prove
 *    the behaviour the phase asks for; delete it once the service stops passing a
 *    business scope through. Nothing else is faked: the same file, the same
 *    repositories, the same guarded reads.
 *
 * 2. `removeThread` answers `{ removed: true }` for a thread that is already gone,
 *    because the thread repository treats a second delete as the state the caller
 *    wanted (`remove` in threads.ts says so in a comment). The criterion this file
 *    was written against says a second removal is refused, so that assertion is left
 *    in place and failing rather than weakened.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

/*
 * A missing export is a wiring gap in the main entry, not a chat bug, and saying so
 * once at load is clearer than the "not a function" every case would otherwise
 * report.
 */
for (const name of ['createBusinessStore', 'createChatService', 'ChatError', 'ProviderError']) {
  assert.equal(
    typeof api[name],
    'function',
    `${name} is not exported by the main bundle - run npm run build:main first`,
  )
}

/** One person on one server. Every row below is filed under this. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/** The business the service is working in, and the one it must never reach into. */
const BUSINESS_NAME = 'Zuri Lofts'
const OTHER_BUSINESS_NAME = 'Tijha Books'

/** Who the app thinks is signed in, so a cloud payload can be scrubbed of them. */
const IDENTITY = {
  displayName: 'Tunde Bakare',
  email: 'tunde@zuri.example.test',
  businessName: BUSINESS_NAME,
}

/* ------------------------------------------------------------------ *
 * A keychain, a store, and the service over them
 * ------------------------------------------------------------------ */

/** A keychain that keeps its entries in memory, in the shape the store asks for. */
function memoryKeychain () {
  const entries = new Map()
  return {
    entries,
    store (name, secret) {
      entries.set(name, secret)
      return { ok: true }
    },
    read (name) {
      return entries.has(name)
        ? { ok: true, secret: entries.get(name) }
        : { ok: false, reason: 'not_found' }
    },
    remove (name) {
      return { ok: entries.delete(name) }
    },
  }
}

/**
 * The real store, with the scope the service passes corrected.
 *
 * `createChatService` calls `store.repositories(scope)` with a scope that carries
 * `businessId` (see `scoped()` in service.ts). The store parses that argument
 * strictly and refuses an unknown key, so every chat call would fail with
 * `invalid_request` before it reached a table. Dropping the extra key here keeps
 * everything under test real - the same file, the same repositories, the same
 * guarded reads - while the defect is reported with this file rather than patched
 * into the source by a test author.
 */
function serviceStore (store) {
  return {
    ...store,
    repositories (scope) {
      return store.repositories({ serverHost: scope.serverHost, userId: scope.userId })
    },
  }
}

/**
 * One open database, two businesses, and the service wired to it.
 *
 * The business rows are written with the schema by hand, the way ownership.test.js
 * does it, so a failure in a chat case can only mean the chat code is wrong. The
 * second business is always present: every isolation claim in this file is about one
 * business reaching another inside one signed-in account, which is the leak a single
 * database makes possible.
 */
function openHarness (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-chat-service-'))

  let store = null
  let service = null

  /*
   * One cleanup, registered before anything can fail, and it runs in the order that
   * cannot throw: stop any running turn, close the handle, then take the file away.
   */
  t.after(() => {
    if (service !== null) service.dispose()
    if (store !== null) {
      try {
        store.close()
      } catch {
        // A handle that is already closed is the state this hook wanted.
      }
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  store = api.createBusinessStore({
    directory,
    keychain: memoryKeychain(),
    vectorExtensionPath: null,
  })
  store.open(SCOPE)

  const business = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 42,
    name: BUSINESS_NAME,
  })
  const otherBusiness = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 43,
    name: OTHER_BUSINESS_NAME,
  })

  /* What the test can change underneath a running turn. */
  const state = { signedIn: true, businessId: business.id, routed: null }
  const events = []
  const warnings = []
  const opened = []

  service = api.createChatService({
    store: serviceStore(store),
    // Read on every call, so a sign-out or a workspace switch takes effect mid-turn.
    scope: () => (state.signedIn ? SCOPE : null),
    businessId: () => state.businessId,
    providers: () => ({
      openProvider (presetId, modelId) {
        opened.push({ presetId, modelId })
        if (state.routed === null) {
          throw new Error('this test did not set a routed provider')
        }
        return state.routed
      },
    }),
    identity: () => IDENTITY,
    publish: (event) => {
      events.push(event)
    },
    log: {
      warn: (message) => {
        warnings.push(message)
      },
    },
  })

  return {
    store,
    service,
    business,
    otherBusiness,
    events,
    warnings,
    opened,

    /** The routed provider every `openProvider` call answers with. */
    setProvider (routed) {
      state.routed = routed
    },

    /** Move the assistant into another business, as the sidebar does. */
    selectBusiness (businessId) {
      state.businessId = businessId
    },

    /** Sign out, without closing the database the window still holds. */
    signOut () {
      state.signedIn = false
    },

    /**
     * One business's messages, read straight from the store.
     *
     * Deliberately not through the service: these assertions are about rows that no
     * longer match the selected business, and going through the service would answer
     * "not found" for a reason the test is not asking about.
     */
    messagesIn (businessId, threadId) {
      return store.repositories(SCOPE).messages.list({ ...SCOPE, businessId }, threadId)
    },

    /** One business's thread rows, read the same way. */
    threadsIn (businessId) {
      return store.repositories(SCOPE).threads.list({ ...SCOPE, businessId })
    },

    titles () {
      return service.listThreads({}).threads.map((row) => row.title)
    },
  }
}

/* ------------------------------------------------------------------ *
 * A provider the test drives
 * ------------------------------------------------------------------ */

/** A promise the test resolves when it wants the parked stream to continue. */
function deferred () {
  let release = null
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

/**
 * One routed provider, as the Models layer hands it over.
 *
 * `script` returns the async generator the service iterates, so the test owns every
 * yield. `cloud` is what the service reads to decide whether the payload is scrubbed
 * and what it records on the stored row; `presetId` is the name the screen shows.
 *
 * What the adapters do on cancellation is mirrored by the scripts that need it: after
 * a yield, a cancelled call raises `ProviderError('aborted')` rather than returning
 * what it had. The service has to map that, and the partial-answer rule depends on it.
 */
function routedProvider (options = {}) {
  const {
    script,
    cloud = true,
    presetId = 'fake',
    modelId = 'fake-model-1',
  } = options

  /* Every request the provider was actually asked to send. */
  const requests = []

  const routed = {
    presetId,
    modelId,
    cloud,
    provider: {
      id: 'fake',
      stream (request, ctx) {
        requests.push({ request, ctx })
        return script(request, ctx)
      },
    },
    // The Models layer checks its own state before a send; nothing here changes it.
    assertCurrent () {},
  }

  return { routed, requests }
}

/** A routed provider that answers at once with one sentence and hangs up. */
function quickProvider (options = {}) {
  const { reply = 'Three are overdue.', ...rest } = options
  return routedProvider({
    ...rest,
    script: async function * () {
      yield { type: 'text', text: reply }
      yield { type: 'done' }
    },
  })
}

/* ------------------------------------------------------------------ *
 * Waiting, and reading what arrived
 * ------------------------------------------------------------------ */

/**
 * Wait until `predicate` holds, or fail the test.
 *
 * The turn runs on microtasks and the fake provider parks on a promise, so polling on
 * a timer is what lets both make progress before the assertion runs. A timeout rather
 * than an assertion failure: "the event never came" is a different bug from "the
 * event said the wrong thing", and the message should say which.
 */
async function waitFor (predicate, what) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  assert.fail(`timed out waiting for ${what}`)
}

/**
 * Let every pending microtask and timer run.
 *
 * Used after a turn has been resumed and is expected to finish silently: there is no
 * event to wait for, which is the whole point of those cases.
 */
async function settle (rounds = 5) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The text of every delta that reached the caller, in order. */
function deltaText (events) {
  return events
    .filter((event) => event.type === 'delta')
    .map((event) => event.text)
    .join('')
}

/** The one terminal event, or a failure that says what actually arrived. */
function terminalOf (events) {
  const terminals = events.filter((event) => event.type === 'done' || event.type === 'failed')
  assert.equal(terminals.length, 1, `expected one terminal event, got ${events.map((e) => e.type).join(',')}`)
  return terminals[0]
}

/** The text of one outbound provider message, the way a chat turn reads. */
function textOf (message) {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
}

/** A refusal as the chat screen draws it: the token, and the class that carries it. */
function chatFailure (token) {
  return (error) => {
    assert.equal(error && error.name, 'ChatError', `not a ChatError: ${String(error)}`)
    assert.equal(error.failure, token)
    return true
  }
}

/**
 * A refusal by token, whichever layer raised it.
 *
 * `sendMessage` checks the thread before it opens its own `try`, so a foreign thread
 * id reaches the caller as the storage layer's own refusal rather than the chat
 * layer's wrapper. The token is the same and the token is what the screen reads, so
 * the test asserts the token and says so here rather than pretending otherwise.
 */
function refusalByToken (token) {
  return (error) => {
    assert.ok(error && typeof error.failure === 'string', `no failure token: ${String(error)}`)
    assert.equal(error.failure, token)
    return true
  }
}

/* ================================================================== *
 * Threads (criterion 1)
 * ================================================================== */

test('a new thread is called New conversation, is listed, and belongs to one business', (t) => {
  const harness = openHarness(t)

  const reply = harness.service.createThread({})
  assert.equal(reply.thread.title, 'New conversation')
  assert.equal(reply.thread.pinned, false)
  assert.equal(reply.thread.messageCount, 0)
  assert.equal(reply.thread.closedAt, null)
  assert.ok(reply.thread.id.length > 0, 'the thread came back without an id')

  const listed = harness.service.listThreads({}).threads
  assert.deepEqual(listed.map((row) => row.id), [reply.thread.id])
  assert.equal(listed[0].title, 'New conversation')

  // Filed under this business, not merely in this file: the other business must not
  // see it, even though it is one account on one server with the same database.
  harness.selectBusiness(harness.otherBusiness.id)
  assert.deepEqual(harness.service.listThreads({}).threads, [])

  // And coming back finds it again, so the emptiness above was the business filter
  // rather than a row that had gone missing.
  harness.selectBusiness(harness.business.id)
  assert.deepEqual(harness.service.listThreads({}).threads.map((row) => row.id), [reply.thread.id])
})

test('renaming a thread changes its title, and a title from another business is refused', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const renamed = harness.service.renameThread({ threadId: thread.id, title: 'Invoices for June' })
  assert.equal(renamed.thread.id, thread.id)
  assert.equal(renamed.thread.title, 'Invoices for June')
  assert.deepEqual(harness.titles(), ['Invoices for June'])

  // The id is real and was quoted to a screen; naming it is not permission to rename
  // somebody else's conversation.
  harness.selectBusiness(harness.otherBusiness.id)
  assert.throws(
    () => harness.service.renameThread({ threadId: thread.id, title: 'Not mine to name' }),
    chatFailure('not_found'),
  )

  // The refused rename changed nothing: the owner still reads their own title.
  harness.selectBusiness(harness.business.id)
  assert.deepEqual(harness.titles(), ['Invoices for June'])
})

test('pinning puts a thread first in the list, and unpinning takes it out again', (t) => {
  const harness = openHarness(t)
  const first = harness.service.createThread({ title: 'Overdue invoices' }).thread
  harness.service.createThread({ title: 'Hiring plan' })

  // Two, whatever the order: both were created inside the same millisecond often
  // enough that asserting the tie-break here would be asserting the clock.
  assert.equal(harness.titles().length, 2)

  const pinned = harness.service.pinThread({ threadId: first.id, pinned: true })
  assert.equal(pinned.thread.pinned, true)
  assert.equal(pinned.thread.id, first.id)

  // Pinned sorts ahead of unpinned before any timestamp is consulted, which is what
  // makes this assertion independent of how fast the two creates ran.
  const whilePinned = harness.service.listThreads({}).threads
  assert.equal(whilePinned[0].id, first.id)
  assert.deepEqual(whilePinned.map((row) => row.pinned), [true, false])

  const unpinned = harness.service.pinThread({ threadId: first.id, pinned: false })
  assert.equal(unpinned.thread.pinned, false)
  const afterUnpin = harness.service.listThreads({}).threads
  assert.equal(afterUnpin.length, 2)
  assert.deepEqual(afterUnpin.map((row) => row.pinned), [false, false])
  assert.equal(afterUnpin.some((row) => row.id === first.id), true)
})

test('a search finds a thread by a word in its title and not by an unrelated one', (t) => {
  const harness = openHarness(t)
  harness.service.createThread({ title: 'Overdue invoices for June' })
  harness.service.createThread({ title: 'Hiring plan' })

  const found = harness.service.listThreads({ search: 'invoice' }).threads
  assert.deepEqual(found.map((row) => row.title), ['Overdue invoices for June'])

  // Case is not something a person types deliberately, so it must not matter.
  assert.deepEqual(
    harness.service.listThreads({ search: 'INVOICE' }).threads.map((row) => row.title),
    ['Overdue invoices for June'],
  )

  assert.deepEqual(harness.service.listThreads({ search: 'payroll' }).threads, [])

  // No search at all still answers with everything, so the filter narrowed the
  // answer rather than the listing only ever working when one is given.
  assert.equal(harness.titles().length, 2)
})

test('removing a thread takes it out of the list, and a second removal is refused', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Short lived' })
  harness.service.createThread({ title: 'Kept' })

  const removed = harness.service.removeThread({ threadId: thread.id })
  assert.deepEqual(removed, { removed: true })

  const remaining = harness.service.listThreads({}).threads
  assert.deepEqual(remaining.map((row) => row.title), ['Kept'])

  /*
   * The second removal is the criterion's own question, and the app answers it the
   * other way today: `remove` in the thread repository deletes nothing and reports
   * nothing, and `removeThread` therefore answers `{ removed: true }` again. Saying
   * "I removed the conversation you asked about" to a screen that is drawing a
   * conversation which no longer exists is not true, which is why the criterion asks
   * for a refusal. Left failing rather than weakened: either the repository grows a
   * `changes === 0` refusal or the criterion changes.
   */
  assert.throws(
    () => harness.service.removeThread({ threadId: thread.id }),
    chatFailure('not_found'),
  )
})

/* ================================================================== *
 * Streaming and persistence (criteria 2 and 3)
 * ================================================================== */

test('sendMessage answers with a turn id, then streams the reply to the caller', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const parked = deferred()
  const seen = { resumed: false }
  const { routed } = routedProvider({
    cloud: true,
    script: async function * (request, ctx) {
      yield { type: 'text', text: 'The quote' }
      await parked.promise
      // Set by the stream itself as it leaves the gate, so this flag can only be
      // true once the test has let the rest of the reply out.
      seen.resumed = true
      if (ctx.signal.aborted) throw new api.ProviderError('aborted')
      yield { type: 'text', text: ' moves to Friday.' }
      yield { type: 'done' }
    },
  })
  harness.setProvider(routed)

  const reply = await harness.service.sendMessage({
    threadId: thread.id,
    text: 'When is the Tilley quote due?',
    presetId: 'fake',
    modelId: 'fake-model-1',
  })

  assert.equal(reply.threadId, thread.id)
  assert.equal(typeof reply.turnId, 'string')
  assert.ok(reply.turnId.length > 0, 'the turn came back without an id')
  assert.equal(reply.userMessage.role, 'user')
  assert.equal(reply.userMessage.seq, 1)
  assert.equal(reply.userMessage.content, 'When is the Tilley quote due?')

  // The id arrived before the model said anything, which is what lets the screen
  // discard events from a turn it has walked away from.
  await waitFor(() => harness.events.some((event) => event.type === 'delta'), 'the first delta')

  assert.equal(seen.resumed, false, 'the stream ran to the end before the delta was checked')
  // Exactly one delta, because the stream is parked: the text that arrived cannot be
  // part of a reply that has already finished.
  assert.deepEqual(harness.events.map((event) => event.type), ['delta'])
  assert.equal(harness.events[0].turnId, reply.turnId)
  assert.equal(harness.events[0].threadId, thread.id)
  assert.equal(harness.events[0].text, 'The quote')

  parked.release()
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the done event')

  const done = terminalOf(harness.events)
  assert.equal(done.type, 'done')
  assert.equal(done.turnId, reply.turnId)
  assert.equal(deltaText(harness.events), 'The quote moves to Friday.')

  // The terminal event carries the stored row, not a copy the screen would have to
  // guess the id of.
  assert.equal(done.message.role, 'assistant')
  assert.equal(done.message.threadId, thread.id)
  assert.equal(done.message.seq, 2)
  assert.equal(done.message.content, 'The quote moves to Friday.')

  /*
   * The turn reported through its events, and never through the "ended without
   * reporting" fallback, which only fires when the turn itself breaks.
   *
   * The recall passes are allowed to report a skip here. This provider fake implements
   * `stream` and not `chat`, so the housekeeping that runs after the person already has
   * their answer cannot ask it for a summary or an item - which is exactly the
   * behaviour that pass is written to have: it fails quietly and alone, leaving the
   * turn untouched. What would be a real failure is the turn's own fallback line.
   */
  assert.equal(
    harness.warnings.some((line) => line.includes('ended without reporting')),
    false,
    'the turn itself broke',
  )
  assert.equal(
    harness.warnings.every((line) => line.startsWith('recall pass skipped')),
    true,
    `an unexpected warning: ${harness.warnings.join(' | ')}`,
  )
})

test('a finished turn stores both messages, attributed to the preset, model and cloud flag', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})
  harness.setProvider(quickProvider({ reply: 'Three are overdue.', cloud: true }).routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
    modelId: 'fake-model-1',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the done event')

  // The Models layer is opened with what the screen chose, not with what it guessed.
  assert.deepEqual(harness.opened, [{ presetId: 'fake', modelId: 'fake-model-1' }])

  const { messages } = harness.service.listMessages({ threadId: thread.id })
  assert.deepEqual(messages.map((row) => row.role), ['user', 'assistant'])
  assert.deepEqual(messages.map((row) => row.seq), [1, 2])
  assert.equal(messages[0].content, 'Which tasks are overdue?')
  assert.equal(messages[1].content, 'Three are overdue.')

  // Which provider, which model, and whether it left the machine: the attribution
  // the plan asks the row to carry.
  assert.equal(messages[1].provider, 'fake')
  assert.equal(messages[1].model, 'fake-model-1')
  assert.equal(messages[1].cloud, true)

  // The question carries none of it. Null is not false: nothing but the person said it.
  assert.equal(messages[0].provider, null)
  assert.equal(messages[0].model, null)
  assert.equal(messages[0].cloud, null)

  // The thread is named after the first thing said, so the sidebar says what the
  // conversation is about.
  assert.deepEqual(harness.titles(), ['Which tasks are overdue?'])
})

test('a rejected key fails the turn with a fixed token and keeps the question for a retry', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const { routed, requests } = routedProvider({
    script: async function * () {
      throw new api.ProviderError('provider_unauthorized')
    },
  })
  harness.setProvider(routed)

  const reply = await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'failed'), 'the failed event')

  const failed = terminalOf(harness.events)
  assert.equal(failed.type, 'failed')
  assert.equal(failed.failure, 'provider_unauthorized')
  // A rejected key fails identically next time, so a retry button would be a lie.
  assert.equal(failed.retryable, false)
  assert.equal(failed.userMessageId, reply.userMessage.id)
  assert.equal(failed.turnId, reply.turnId)
  assert.equal(failed.threadId, thread.id)

  // The provider was asked and refused: nothing was streamed, and no assistant row
  // was invented for a reply that never happened.
  assert.equal(requests.length, 1)
  assert.deepEqual(harness.events.map((event) => event.type), ['failed'])

  // The question survives, so retrying is a second turn on the same text rather than
  // something the person has to type again.
  const { messages } = harness.service.listMessages({ threadId: thread.id })
  assert.deepEqual(messages.map((row) => row.role), ['user'])
  assert.equal(messages[0].id, reply.userMessage.id)
  assert.equal(messages[0].content, 'Which tasks are overdue?')
})

test('a network failure is reported as worth one more try', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  harness.setProvider(routedProvider({
    script: async function * () {
      throw new api.ProviderError('network')
    },
  }).routed)

  await harness.service.sendMessage({ threadId: thread.id, text: 'Which tasks are overdue?', presetId: 'fake' })
  await waitFor(() => harness.events.some((event) => event.type === 'failed'), 'the failed event')

  const failed = terminalOf(harness.events)
  assert.equal(failed.failure, 'network')
  assert.equal(failed.retryable, true)
})

test('cancelling mid-stream keeps what arrived as a stored partial answer', async (t) => {
  const harness = openHarness(t)

  const { thread } = harness.service.createThread({})
  const parked = deferred()
  const seen = { resumed: false, sawAbort: false }

  harness.setProvider(routedProvider({
    script: async function * (request, ctx) {
      yield { type: 'text', text: 'Three are overdue: ' }
      await parked.promise
      seen.resumed = true
      // What every adapter does: a cancelled call raises rather than returning what
      // it had, so the service decides what may be kept.
      seen.sawAbort = ctx.signal.aborted
      if (seen.sawAbort) throw new api.ProviderError('aborted')
      yield { type: 'text', text: 'the Tilley quote.' }
      yield { type: 'done' }
    },
  }).routed)

  const reply = await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'delta'), 'the first delta')

  const cancelled = harness.service.cancelTurn({ threadId: thread.id })
  assert.equal(cancelled.stopped, true)
  assert.equal(cancelled.turnId, reply.turnId)

  parked.release()
  await waitFor(
    () => harness.events.some((event) => event.type === 'done' || event.type === 'failed'),
    'the terminal event',
  )

  assert.equal(seen.resumed, true)
  assert.equal(seen.sawAbort, true, 'the provider was never told the turn had been cancelled')

  // Partial output retained safely: one terminal event, `done`, carrying a stored row
  // with exactly the text that had arrived.
  const terminal = terminalOf(harness.events)
  assert.equal(terminal.type, 'done')
  assert.equal(terminal.turnId, reply.turnId)
  assert.equal(terminal.message.role, 'assistant')
  assert.equal(terminal.message.content, 'Three are overdue: ')
  assert.equal(deltaText(harness.events), 'Three are overdue: ')

  const { messages } = harness.service.listMessages({ threadId: thread.id })
  assert.deepEqual(messages.map((row) => row.content), ['Which tasks are overdue?', 'Three are overdue: '])
  assert.deepEqual(messages.map((row) => row.role), ['user', 'assistant'])
})

/* ================================================================== *
 * Staleness (criterion 4)
 * ================================================================== */

test('a reply that outlives a workspace switch is neither published nor stored', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  // A conversation in the business the person is about to switch to, seeded through
  // the store: the assertion is that nothing lands in it either.
  const otherThread = harness.store
    .repositories(SCOPE)
    .threads.create({ ...SCOPE, businessId: harness.otherBusiness.id }, { title: 'Tijha invoices' })

  const parked = deferred()
  const seen = { resumed: false }
  harness.setProvider(routedProvider({
    script: async function * (request, ctx) {
      yield { type: 'text', text: 'Half an answer' }
      await parked.promise
      seen.resumed = true
      if (ctx.signal.aborted) throw new api.ProviderError('aborted')
      yield { type: 'text', text: ' and the rest.' }
    },
  }).routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'delta'), 'the first delta')
  const published = harness.events.length
  assert.equal(published, 1)

  // The person picks a different business while the model is still answering.
  harness.selectBusiness(harness.otherBusiness.id)

  parked.release()
  await waitFor(() => seen.resumed, 'the parked stream to resume')
  await settle()

  assert.equal(harness.events.length, published, 'an event reached a screen that had moved on')

  // Nothing was written: not into the conversation that was left behind, and not
  // into the one that is now on screen.
  assert.deepEqual(
    harness.messagesIn(harness.business.id, thread.id).map((row) => row.role),
    ['user'],
  )
  assert.deepEqual(harness.messagesIn(harness.otherBusiness.id, otherThread.id), [])
})

test('a reply that outlives a sign-out is neither published nor stored', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const parked = deferred()
  const seen = { resumed: false }
  harness.setProvider(routedProvider({
    script: async function * (request, ctx) {
      yield { type: 'text', text: 'Half an answer' }
      await parked.promise
      seen.resumed = true
      if (ctx.signal.aborted) throw new api.ProviderError('aborted')
      yield { type: 'text', text: ' and the rest.' }
    },
  }).routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'delta'), 'the first delta')
  const published = harness.events.length

  // Signed out with the window still open and the turn still running.
  harness.signOut()

  parked.release()
  await waitFor(() => seen.resumed, 'the parked stream to resume')
  await settle()

  assert.equal(harness.events.length, published, 'an event was delivered to a session that had ended')
  assert.deepEqual(
    harness.messagesIn(harness.business.id, thread.id).map((row) => row.role),
    ['user'],
  )
  assert.equal(harness.threadsIn(harness.business.id).length, 1)
})

test('a second turn is refused while one is still running', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const parked = deferred()
  harness.setProvider(routedProvider({
    script: async function * (request, ctx) {
      yield { type: 'text', text: 'Working' }
      await parked.promise
      if (ctx.signal.aborted) throw new api.ProviderError('aborted')
      yield { type: 'done' }
    },
  }).routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'Which tasks are overdue?',
    presetId: 'fake',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'delta'), 'the first delta')

  await assert.rejects(
    harness.service.sendMessage({ threadId: thread.id, text: 'Are you there?', presetId: 'fake' }),
    chatFailure('busy'),
  )

  // The refused turn wrote nothing: one question is in the thread, not two.
  assert.deepEqual(
    harness.messagesIn(harness.business.id, thread.id).map((row) => row.role),
    ['user'],
  )

  parked.release()
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the first turn to finish')
})

test('sending into another business\'s thread is refused and writes the question nowhere', async (t) => {
  const harness = openHarness(t)
  const otherThread = harness.store
    .repositories(SCOPE)
    .threads.create({ ...SCOPE, businessId: harness.otherBusiness.id }, { title: 'Tijha invoices' })

  const quick = quickProvider()
  harness.setProvider(quick.routed)

  await assert.rejects(
    harness.service.sendMessage({
      threadId: otherThread.id,
      text: 'Not mine to ask.',
      presetId: 'fake',
    }),
    refusalByToken('not_found'),
  )

  assert.deepEqual(harness.messagesIn(harness.otherBusiness.id, otherThread.id), [])
  assert.deepEqual(harness.messagesIn(harness.business.id, otherThread.id), [])
  assert.deepEqual(harness.events, [])
  // The check comes before the provider is opened: a foreign id must not even cost a
  // key being read.
  assert.deepEqual(harness.opened, [])
})

/* ================================================================== *
 * Privacy (criterion 5)
 * ================================================================== */

test('a cloud turn carrying an email address is blocked before the provider is called', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const quick = quickProvider({ cloud: true })
  harness.setProvider(quick.routed)

  const text = 'Email client@example.com about the quote.'
  const reply = await harness.service.sendMessage({ threadId: thread.id, text, presetId: 'fake' })
  await waitFor(() => harness.events.some((event) => event.type === 'failed'), 'the failed event')

  const failed = terminalOf(harness.events)
  assert.equal(failed.type, 'failed')
  assert.equal(failed.failure, 'blocked_content')
  assert.equal(failed.retryable, false)
  assert.equal(failed.userMessageId, reply.userMessage.id)

  // The refusal happens before the stream starts, so the payload never left.
  assert.equal(quick.requests.length, 0, 'the payload reached the provider anyway')

  // The person's own message is stored: they can edit it and send again.
  const { messages } = harness.service.listMessages({ threadId: thread.id })
  assert.deepEqual(messages.map((row) => row.role), ['user'])
  assert.equal(messages[0].content, text)
})

test('a cloud turn replaces the business name before the provider sees the text', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const quick = quickProvider({ cloud: true })
  harness.setProvider(quick.routed)

  const text = 'What did Zuri Lofts agree to?'
  await harness.service.sendMessage({ threadId: thread.id, text, presetId: 'fake' })
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the done event')

  assert.equal(quick.requests.length, 1)
  const { request } = quick.requests[0]
  const sent = textOf(request.messages[request.messages.length - 1])
  assert.equal(sent, 'What did [[business]] agree to?')
  // Not one trace of the name anywhere in what was handed to the provider.
  assert.equal(JSON.stringify(request).includes(BUSINESS_NAME), false)

  // The screen still shows what the person typed: only the copy that leaves changes.
  assert.equal(harness.service.listMessages({ threadId: thread.id }).messages[0].content, text)
})

test('a cloud preview is the exact payload a send would use, already tokenised', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const quick = quickProvider({ cloud: true })
  harness.setProvider(quick.routed)

  const text = 'What did Zuri Lofts agree to?'
  const preview = harness.service.payloadPreview({ threadId: thread.id, text, presetId: 'fake' })

  assert.equal(preview.cloud, true)
  assert.equal(preview.blocked, false)
  assert.equal(preview.blockedReason, null)
  assert.equal(preview.placeholders.some((placeholder) => placeholder.token === '[[business]]'), true)

  assert.equal(preview.messages.length, 1)
  assert.equal(preview.messages[0].role, 'user')
  assert.equal(preview.messages[0].text, 'What did [[business]] agree to?')

  // "Exact" is the claim, so the same text is actually sent and the two are compared
  // rather than trusted to agree.
  await harness.service.sendMessage({ threadId: thread.id, text, presetId: 'fake' })
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the done event')

  assert.equal(quick.requests.length, 1)
  const sent = quick.requests[0].request.messages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    text: textOf(message),
  }))
  assert.deepEqual(sent, preview.messages)
})

test('a local preview sends nothing and leaves the business name alone', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const local = quickProvider({ cloud: false })
  harness.setProvider(local.routed)

  const text = 'Ask Zuri Lofts for the invoice.'
  const preview = harness.service.payloadPreview({ threadId: thread.id, text, presetId: 'fake' })

  // A model on this machine already sees what the person sees, so there is nothing
  // to substitute and nothing to block.
  assert.equal(preview.cloud, false)
  assert.equal(preview.blocked, false)
  assert.equal(preview.blockedReason, null)
  assert.deepEqual(preview.placeholders, [])
  assert.equal(preview.messages.length, 1)
  assert.equal(preview.messages[0].text, text)

  // A preview is not a send.
  assert.equal(local.requests.length, 0)
})

test('a turn tells the guard whether its text was redacted, so a local answer cannot be redirected to the cloud', async (t) => {
  /*
   * The privacy rules rewrite the conversation for a cloud model and leave the
   * person's own words alone for a local one. "The endpoint looked local" is
   * therefore the only reason an unredacted body is safe, and the decision is made
   * here, once, before the request exists.
   *
   * Stating it on the call context is what lets the guard hold every hop of that
   * request to a verified local address. Without it a local server could answer with
   * a redirect to a public one and the transport would carry the private text out,
   * because the business itself is not local-only and nothing else would object.
   */
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  // A model on this machine: the text goes out as the person wrote it.
  const local = quickProvider({ reply: 'Locally answered.', cloud: false, presetId: 'local-box' })
  harness.setProvider(local.routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'When is the Tilley quote due?',
    presetId: 'local-box',
  })
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the local answer')
  await settle()

  assert.equal(local.requests.length, 1)
  assert.equal(local.requests[0].ctx.unredactedContent, true)

  // A cloud model is the opposite: the text was rewritten, so nothing about the
  // content constrains where the provider's own endpoint sends it.
  const cloud = quickProvider({ reply: 'Answered in the cloud.', cloud: true, presetId: 'cloud-box' })
  harness.setProvider(cloud.routed)

  await harness.service.sendMessage({
    threadId: thread.id,
    text: 'And the second quote?',
    presetId: 'cloud-box',
  })
  await waitFor(
    () => harness.events.filter((event) => event.type === 'done').length === 2,
    'the cloud answer',
  )

  assert.equal(cloud.requests.length, 1)
  assert.equal(cloud.requests[0].ctx.unredactedContent, false)

  // The stored rows still record which of the two ran in the cloud, which is what
  // the screen draws its badge from.
  const { messages } = harness.service.listMessages({ threadId: thread.id })
  const answers = messages.filter((row) => row.role === 'assistant')
  assert.deepEqual(answers.map((row) => row.cloud), [false, true])
})

/* ================================================================== *
 * The preview is the send (F3)
 * ================================================================== */

/*
 * A preview exists to be approved. The person reads that panel, decides the words are
 * the right ones, and sends. So the panel is only worth having if it is the request
 * that will actually leave - and it was not, in two ways that both came from building
 * it by hand instead of through the send's own path.
 *
 * 1. It opened the provider without the model, so the context was budgeted for the
 *    provider's default window rather than the window of the model that would answer.
 * 2. It appended the question *after* the conversation had been trimmed, so at a
 *    narrow budget the panel could list an older turn that the send dropped.
 *
 * The cases below assert the two together by comparing the panel with the request the
 * provider actually received, rather than trusting the two to agree.
 *
 * `kimi` is the preset used for the budget cases because it is the one whose models
 * declare different windows (8k and 128k), which is what makes "budgeted for the
 * answering model" an observable difference rather than a claim.
 */

/** The messages of a captured provider request, in the preview's own shape. */
function receivedAs (request) {
  return request.messages.map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
    text: textOf(message),
  }))
}

/** One stored message, written straight through the store. */
function seedMessage (harness, threadId, role, content) {
  return harness.store
    .repositories(SCOPE)
    .messages.append(
      { ...SCOPE, businessId: harness.business.id },
      { threadId, role, content },
    )
}

test('a preview is opened with the model that would answer, not the provider default', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const kimi = routedProvider({ presetId: 'kimi', modelId: 'moonshot-v1-8k' })
  harness.setProvider(kimi.routed)

  harness.service.payloadPreview({
    threadId: thread.id,
    text: 'What is outstanding?',
    presetId: 'kimi',
    modelId: 'moonshot-v1-8k',
  })

  /*
   * The argument, not the result. `openProvider` is what the Models layer sizes the
   * context from, so a preview that leaves the model out is budgeted for a different
   * model however the rest of the call behaves.
   */
  assert.equal(harness.opened.length, 1)
  assert.deepEqual(harness.opened[0], { presetId: 'kimi', modelId: 'moonshot-v1-8k' })
})

test('a preview sizes the context from the answering model, so two models give two lists', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  // Long enough to fit a 60,000-character budget and to miss a 24,576 one.
  const long = 'x'.repeat(24_000)
  seedMessage(harness, thread.id, 'assistant', long)

  const text = 'y'.repeat(1_000)

  // The 8k model: 24,576 characters. The question takes 1,000 of it, and the 24,000
  // that is left over does not fit, so the older turn is dropped.
  const small = quickProvider({ presetId: 'kimi', modelId: 'moonshot-v1-8k' })
  harness.setProvider(small.routed)
  const narrow = harness.service.payloadPreview({
    threadId: thread.id,
    text,
    presetId: 'kimi',
    modelId: 'moonshot-v1-8k',
  })

  // The 128k model: the ceiling of 60,000. Both turns fit.
  const large = quickProvider({ presetId: 'kimi', modelId: 'moonshot-v1-128k' })
  harness.setProvider(large.routed)
  const wide = harness.service.payloadPreview({
    threadId: thread.id,
    text,
    presetId: 'kimi',
    modelId: 'moonshot-v1-128k',
  })

  assert.equal(narrow.messages.length, 1, 'the narrow budget kept a turn it could not afford')
  assert.equal(narrow.messages[0].text, text)
  assert.equal(wide.messages.length, 2, 'the wide budget dropped a turn that fits')
  assert.equal(wide.messages[0].text, long)
  assert.equal(wide.messages[1].text, text)
})

test('the question stays inside the trim, so the panel cannot list a turn the send drops', async (t) => {
  /*
   * The regression. The question is the newest turn, so it is kept; the older turn is
   * what the budget decides about. Appended after the trim, the question did not count
   * against the budget at all, and the panel listed the older turn that the send then
   * dropped - the panel promising words that were not the words sent.
   */
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const long = 'x'.repeat(24_000)
  seedMessage(harness, thread.id, 'assistant', long)

  const kimi = quickProvider({ presetId: 'kimi', modelId: 'moonshot-v1-8k' })
  harness.setProvider(kimi.routed)

  const text = 'y'.repeat(1_000)
  const request = { threadId: thread.id, text, presetId: 'kimi', modelId: 'moonshot-v1-8k' }

  const preview = harness.service.payloadPreview(request)
  await harness.service.sendMessage(request)
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the answer')

  assert.equal(kimi.requests.length, 1)
  const sent = receivedAs(kimi.requests[0].request)

  assert.equal(sent.length, 1, 'the send kept the older turn, so this case proves nothing')
  assert.deepEqual(preview.messages, sent)
})

test('a preview of a thread with remembered items and a summary matches the send', async (t) => {
  /*
   * The recall block is assembled from rows, not from the preview, so it is the part
   * most likely to be built twice and disagree. Both lists are compared in full,
   * including the system turn that carries the recall block.
   *
   * A local model is used, deliberately. A cloud turn carrying this block is blocked
   * before it leaves, because the block labels each record with the row's own id and
   * a 32-character hex id trips the "long digit run" rule (see the note at the end of
   * this section). Blocked or not, the two lists have to match, but a test that
   * asserted the block would be a test asserting that defect, so this one takes the
   * path where the turn actually runs.
   */
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Overdue invoices' })

  const businessScope = { ...SCOPE, businessId: harness.business.id }
  const question = seedMessage(harness, thread.id, 'user', 'Which invoices are overdue?')
  seedMessage(harness, thread.id, 'assistant', 'Three are overdue.')
  harness.store.repositories(SCOPE).memory.add(businessScope, {
    kind: 'decision',
    text: 'Quotes go out on Fridays.',
    sourceMessageId: question.id,
  })
  harness.store.repositories(SCOPE).summaries.upsert(businessScope, {
    threadId: thread.id,
    text: 'The person asked about invoices and was told three were overdue.',
    // Nothing covered yet, so every stored turn is still a candidate.
    coversThroughSeq: 0,
  })

  const quick = quickProvider({ presetId: 'fake', modelId: 'fake-model-1', cloud: false })
  harness.setProvider(quick.routed)

  const request = { threadId: thread.id, text: 'And the Tilley quote?', presetId: 'fake', modelId: 'fake-model-1' }
  const preview = harness.service.payloadPreview(request)
  await harness.service.sendMessage(request)
  await waitFor(() => harness.events.some((event) => event.type === 'done'), 'the answer')

  // The recall block really is in the list being compared, or this proves nothing.
  assert.equal(preview.messages[0].role, 'system')
  assert.match(preview.messages[0].text, /Quotes go out on Fridays\./)

  assert.equal(quick.requests.length, 1)
  assert.deepEqual(preview.messages, receivedAs(quick.requests[0].request))
})

test('a preview says a cloud turn is blocked, and the same turn sends nothing', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const quick = quickProvider({ cloud: true, presetId: 'fake', modelId: 'fake-model-1' })
  harness.setProvider(quick.routed)

  const text = 'Email client@example.com about the quote.'
  const request = { threadId: thread.id, text, presetId: 'fake', modelId: 'fake-model-1' }

  const preview = harness.service.payloadPreview(request)
  assert.equal(preview.blocked, true)
  assert.notEqual(preview.blockedReason, null)
  // A blocked preview still shows the list, so the person can see what tripped it.
  assert.equal(preview.messages[preview.messages.length - 1].text.includes('client@example.com'), true)

  await harness.service.sendMessage(request)
  await waitFor(() => harness.events.some((event) => event.type === 'failed'), 'the refusal')

  assert.equal(terminalOf(harness.events).failure, 'blocked_content')
  // Blocked is a refusal, not a scrub: the words never went, so they were not replaced.
  assert.equal(quick.requests.length, 0, 'a blocked payload reached the provider')
})

test('a preview writes nothing, starts no turn and calls no model', (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({})

  const quick = quickProvider({ presetId: 'fake', modelId: 'fake-model-1' })
  harness.setProvider(quick.routed)

  const before = harness.service.listMessages({ threadId: thread.id }).messages
  harness.service.payloadPreview({
    threadId: thread.id,
    text: 'What is outstanding?',
    presetId: 'fake',
    modelId: 'fake-model-1',
  })

  assert.deepEqual(harness.service.listMessages({ threadId: thread.id }).messages, before)
  assert.deepEqual(harness.events, [])
  assert.equal(quick.requests.length, 0)
  // The question is not a row, so the sidebar's count is unchanged too.
  assert.equal(harness.service.listThreads({}).threads[0].messageCount, 0)
})

test('a preview of another business thread is refused before a key is read', (t) => {
  /*
   * A preview builds a list from a thread's stored rows. Without the ownership check
   * an id from another business would answer with that business's conversation, which
   * is a read of somebody else's data dressed as a preview.
   */
  const harness = openHarness(t)
  const otherThread = harness.store
    .repositories(SCOPE)
    .threads.create({ ...SCOPE, businessId: harness.otherBusiness.id }, { title: 'Tijha invoices' })

  const quick = quickProvider({ presetId: 'fake', modelId: 'fake-model-1' })
  harness.setProvider(quick.routed)

  assert.throws(
    () => harness.service.payloadPreview({
      threadId: otherThread.id,
      text: 'Not mine to read.',
      presetId: 'fake',
      modelId: 'fake-model-1',
    }),
    refusalByToken('not_found'),
  )

  assert.deepEqual(harness.opened, [], 'the provider was opened for a thread this business does not own')
})

/*
 * A defect this section surfaced and does not fix.
 *
 * A cloud turn is refused with `blocked_content` / `long_number` as soon as the
 * business has any remembered item or any summary, which is to say almost always.
 * The recall block labels each record with the id of the row it came from -
 * `memory:e1e0d9d7f26cc981e0aacff5c7377139` - and roughly one id in ten contains a
 * twelve-digit run, which `residualIdentifier` reads as an account number. The turn
 * never leaves, and the person is told their own message identified somebody.
 *
 * Reproduced against the built bundle: `residualIdentifier` of a memory id and of a
 * thread id both answer `long_number`, and a preview of a thread carrying both comes
 * back `blocked: true, blockedReason: 'long_number'`.
 *
 * It is not fixed here because the correction belongs to the privacy rule, or to the
 * ids the recall block puts in the prompt, and both are the subject of F1 and F2.
 * Choosing between "do not scan the app's own labels" and "do not put row ids in the
 * prompt" is a privacy decision, not a preview one.
 */
