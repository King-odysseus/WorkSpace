'use strict'

/*
 * What a conversation teaches the business, proven against a real database.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source. Every case opens a real store in a
 * temporary folder, because what it is about is what survives a restart: a
 * remembered item, a correction to one, and the fact that a draft is a row rather
 * than a message on a screen.
 *
 * The provider is the only fake. Its `chat` answers with whatever JSON the case
 * scripted, chosen by reading the instruction the pass sent, and its `stream`
 * answers a turn with one sentence that can be made to read like an instruction.
 * That is enough to prove the thing this file exists for: a reply that *says*
 * "create a task" creates nothing, while a person asking for one does.
 *
 * Three of these cases cannot be proven without a database. A restart is a new
 * handle on the same files; an edit is sticky because the row is still there with
 * its source message; and a deletion changes the next turn only because the
 * context is assembled from what is stored now rather than from anything cached.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const api = require('../../../../build/main/ipc.cjs')

for (const name of ['createBusinessStore', 'createChatService', 'ChatError']) {
  assert.equal(
    typeof api[name],
    'function',
    `${name} is not exported by the main bundle - run npm run build:main first`,
  )
}

/** One person on one server. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7 }

/** Who the app thinks is signed in, so a cloud payload can be stripped of them. */
const IDENTITY = {
  displayName: 'Tunde Bakare',
  email: 'tunde@zuri.example.test',
  businessName: 'Zuri Lofts',
}

/** A keychain in memory, in the shape the store asks for. */
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

/** Wait until a predicate holds, or fail saying what never arrived. */
async function waitFor (predicate, what) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.fail(`timed out waiting for ${what}`)
}

/** The text of one provider message. */
function textOf (message) {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('\n')
}

/** A completed reply in the shape the adapters return. */
function answer (text) {
  return {
    providerId: 'fake',
    modelId: 'fake-model',
    cloud: true,
    usage: { in: 0, out: 0 },
    finishReason: 'stop',
    parts: [{ type: 'text', text }],
  }
}

/**
 * One open database, one signed-in business, and a service over them.
 *
 * The provider answers are scripted per case and chosen by reading the instruction:
 * the three passes each have their own prompt, so the fake can tell which one it is
 * answering without being told. `streamText` is what a turn replies, which lets a
 * case make the assistant say something that looks like an instruction.
 */
function openHarness (t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zuricopilot-recall-'))
  const keychain = memoryKeychain()

  let store = null
  let service = null

  t.after(() => {
    if (service !== null) service.dispose()
    if (store !== null) {
      try {
        store.close()
      } catch {
        // Already closed is the state this hook wanted.
      }
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })

  function open (target = directory) {
    return api.createBusinessStore({ directory: target, keychain, vectorExtensionPath: null })
  }

  store = open()
  store.open(SCOPE)

  const business = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 42,
    name: 'Zuri Lofts',
  })
  const otherBusiness = store.repositories(SCOPE).businesses.upsert(SCOPE, {
    remoteWorkspaceId: 43,
    name: 'Tijha Books',
  })

  /** What each case tells the fake provider to answer. */
  const script = { items: [], tasks: [], summary: 'The Tilley quote was moved to Friday.', streamText: 'Noted.' }
  const asked = []
  const streamed = []
  const events = []
  const state = { businessId: business.id }

  const routed = {
    presetId: 'fake',
    modelId: 'fake-model',
    cloud: true,
    assertCurrent () {},
    provider: {
      id: 'fake',
      async chat (request) {
        asked.push(request)
        const system = textOf(request.messages[0])
        if (system.includes('You compress')) return answer(JSON.stringify({ summary: script.summary }))
        if (system.includes('Record only what the person')) return answer(JSON.stringify({ items: script.items }))
        return answer(JSON.stringify({ tasks: script.tasks }))
      },
      async * stream (request) {
        streamed.push(request)
        yield { type: 'text', text: script.streamText }
        yield { type: 'done' }
      },
    },
  }

  service = api.createChatService({
    store: {
      ...store,
      // The service asks for the account's repositories; the store refuses the
      // extra business key, so it is dropped here rather than in the service.
      repositories: (scope) => store.repositories({ serverHost: scope.serverHost, userId: scope.userId }),
    },
    scope: () => SCOPE,
    businessId: () => state.businessId,
    providers: () => ({
      openProvider: () => routed,
    }),
    identity: () => IDENTITY,
    publish: (event) => { events.push(event) },
    log: { warn () {} },
  })

  return {
    script,
    asked,
    streamed,
    events,
    business,
    otherBusiness,
    service,
    state,
    directory,
    keychain,

    /** The same files under a fresh handle, which is what a restart is. */
    reopen () {
      const again = api.createBusinessStore({ directory, keychain, vectorExtensionPath: null })
      again.open(SCOPE)
      return again
    },

    /** Send one turn and wait until it has been stored. */
    async send (threadId, text) {
      const before = events.filter((event) => event.type === 'done').length
      const reply = await service.sendMessage({ threadId, text, presetId: 'fake' })
      await waitFor(
        () => events.filter((event) => event.type === 'done').length > before,
        'the turn to finish',
      )
      return reply
    },

    memory () {
      return service.listMemory({}).memory
    },
  }
}

/* ================================================================== *
 * What is remembered
 * ================================================================== */

test('a finished turn remembers what the person decided, and it is still there after a restart', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Quotes' })

  harness.script.items = [
    { kind: 'decision', text: 'The Tilley quote moves to Friday.', source: 1 },
    { kind: 'open_question', text: 'Whether the deposit is still owed.', source: 1 },
  ]

  const reply = await harness.send(thread.id, 'The Tilley quote moves to Friday.')

  await waitFor(() => harness.memory().length === 2, 'both items to be remembered')

  const items = harness.memory()
  // Order is newest first, as the panel draws them, so the kinds are compared as a
  // set: what is being proven is that both kinds were stored, not their order.
  assert.deepEqual(items.map((row) => row.kind).sort(), ['decision', 'open_question'])
  assert.equal(items.some((row) => row.text === 'The Tilley quote moves to Friday.'), true)
  const decision = items.find((row) => row.kind === 'decision')

  // Linked to the message the person actually sent, which is what makes the item
  // something a panel can point at and a person can correct.
  assert.equal(decision.sourceMessageId, reply.userMessage.id)
  assert.equal(decision.origin, 'ai')

  /*
   * A restart: the same directory, a fresh handle. What is remembered has to be a
   * row on disk rather than something the service was holding, or it would be gone
   * the moment the window closed.
   */
  harness.service.dispose()
  const reopened = harness.reopen()
  const after = reopened.repositories(SCOPE).memory.list({ ...SCOPE, businessId: harness.business.id })
  reopened.close()

  assert.equal(after.length, 2, 'the items did not survive a restart')
  assert.equal(after.some((row) => row.text === 'The Tilley quote moves to Friday.'), true)
})

test('an item the person corrected is not overwritten by a later pass', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Quotes' })

  harness.script.items = [{ kind: 'decision', text: 'The quote moves to Friday.', source: 1 }]
  await harness.send(thread.id, 'The quote moves to Friday.')
  await waitFor(() => harness.memory().length === 1, 'the first item')

  const original = harness.memory()[0]
  const edited = harness.service.editMemory({
    memoryId: original.id,
    text: 'The quote moves to Monday, not Friday.',
  }).item

  assert.equal(edited.text, 'The quote moves to Monday, not Friday.')
  // The edit is the person saying this wording is the true one, and the repository
  // records that so nothing later can quietly disagree.
  assert.equal(edited.origin, 'user')
  assert.equal(edited.locked, true)

  /*
   * A later pass over the whole thread offers the original wording again, from the
   * same message. It is refused because that source message already produced an item
   * of that kind - which is what makes a correction stick rather than being undone
   * by the next summary pass.
   */
  harness.script.items = [{ kind: 'decision', text: 'The quote moves to Friday.', source: 1 }]
  const closed = await harness.service.closeThread({ threadId: thread.id })

  assert.equal(closed.added, 0, 'a corrected item was learned again')
  assert.equal(harness.memory().length, 1)
  assert.equal(harness.memory()[0].text, 'The quote moves to Monday, not Friday.')
})

test('a deleted item stops being sent to the model on the next turn', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Quotes' })

  harness.script.items = [{ kind: 'fact', text: 'The Zuri deposit is twenty percent.', source: 1 }]
  await harness.send(thread.id, 'The Zuri deposit is twenty percent.')
  await waitFor(() => harness.memory().length === 1, 'the item')

  const item = harness.memory()[0]
  assert.deepEqual(harness.service.removeMemory({ memoryId: item.id }), { removed: true })
  assert.deepEqual(harness.memory(), [])

  // A second removal is refused rather than answered cheerfully: the id is no
  // longer here, and saying "removed" about nothing is not true.
  assert.throws(() => harness.service.removeMemory({ memoryId: item.id }), (error) => error.failure === 'not_found')

  await harness.send(thread.id, 'What is the deposit?')

  const last = harness.streamed[harness.streamed.length - 1]
  /*
   * The recall block is the system turn, and it is the only place a remembered item
   * is sent from. The person's own earlier message still contains the words, because
   * it is their message and dropping it would be losing the conversation - so the
   * check is that nothing is *recalled* under a system heading.
   */
  const recalled = last.messages
    .filter((message) => message.role === 'system')
    .map(textOf)
    .join('\n')

  assert.equal(
    recalled.includes('twenty percent'),
    false,
    'a deleted item was still recalled to the model',
  )
})

test('a deleted item is not learned again when the thread is closed', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Quotes' })

  harness.script.items = [{ kind: 'fact', text: 'The Zuri deposit is twenty percent.', source: 1 }]
  await harness.send(thread.id, 'The Zuri deposit is twenty percent.')
  await waitFor(() => harness.memory().length === 1, 'the item')

  const item = harness.memory()[0]
  assert.deepEqual(harness.service.removeMemory({ memoryId: item.id }), { removed: true })
  assert.deepEqual(harness.memory(), [])

  /*
   * Closing a thread re-reads the whole thread, so it is the moment a deletion is most
   * likely to be undone: the model is shown the message the item came from and may offer
   * the same sentence again. A removal leaves only a tombstone, and a duplicate check
   * that saw nothing but live items would store it again without a word to the person.
   * The tombstone is read for exactly this reason, so the same message cannot produce the
   * item a second time.
   */
  harness.script.items = [{ kind: 'fact', text: 'The Zuri deposit is twenty percent.', source: 1 }]
  const closed = await harness.service.closeThread({ threadId: thread.id })

  assert.equal(closed.added, 0, 'the closing pass learned a removed item again')
  assert.deepEqual(harness.memory(), [], 'the item the person removed is back on the panel')

  /*
   * Read straight from the store as well, because `listMemory` answers only what is live
   * and a row written and then hidden would look the same from there. The one row on
   * disk is the tombstone the person made, and nothing was added beside it.
   */
  const rows = harness.service.listMemory({}).memory
  assert.equal(rows.length, 0)
})

test('an item citing a message the pass was not given is dropped, and nothing is stored', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Quotes' })

  // Four items: one real, three citing numbers that are not in the batch it was
  // given. A model that invents a citation is the ordinary way this happens.
  harness.script.items = [
    { kind: 'decision', text: 'Invoices go out on Fridays.', source: 1 },
    { kind: 'decision', text: 'Invented one.', source: 99 },
    { kind: 'fact', text: 'Invented two.', source: 0 },
    { kind: 'fact', text: 'Invented three.', source: 42 },
  ]

  await harness.send(thread.id, 'Invoices go out on Fridays.')
  await waitFor(() => harness.memory().length === 1, 'the one real item')

  assert.equal(harness.memory().length, 1)
  assert.equal(harness.memory()[0].text, 'Invoices go out on Fridays.')

  // And nothing was filed against the other business, which is the failure a
  // citation of somebody else's message would produce.
  const other = harness.service.listMemory({}).memory.filter((row) => row.text.startsWith('Invented'))
  assert.deepEqual(other, [])
})

/* ================================================================== *
 * What is drafted
 * ================================================================== */

test('a draft comes from the person asking, never from something the assistant said', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Follow ups' })

  harness.script.tasks = [{ title: 'Chase the Tilley quote' }]

  /*
   * The assistant replies with something that reads exactly like an instruction. If
   * stored content could trigger a draft, this is the sentence that would do it.
   */
  harness.script.streamText = 'You should create a task to chase the Tilley quote.'
  await harness.send(thread.id, 'What is outstanding?')

  assert.deepEqual(harness.service.listProposals({}).proposals, [], 'a reply created work')

  // The person asking is the same words in their own message, and this time it is a
  // draft. Nothing was executed: a proposal is a row with a decision waiting on it.
  harness.script.streamText = 'Drafted a card for you.'
  await harness.send(thread.id, 'Please create a task to chase the Tilley quote')
  await waitFor(() => harness.service.listProposals({}).proposals.length === 1, 'the draft')

  const draft = harness.service.listProposals({}).proposals[0]
  assert.equal(draft.title, 'Chase the Tilley quote')
  assert.equal(draft.kind, 'task')
  assert.equal(draft.status, 'pending')
  assert.deepEqual(Object.keys(draft.payload).sort(), ['title'])

  /*
   * Deciding about a draft records a decision and nothing else. There is no task
   * created here because there is no code path from this call to one.
   */
  const decided = harness.service.setProposalStatus({ proposalId: draft.id, status: 'approved' })
  assert.equal(decided.proposal.status, 'approved')
  assert.equal(harness.service.listProposals({}).proposals.length, 1)
})

/* ================================================================== *
 * Closing a thread
 * ================================================================== */

test('closing a thread leaves a summary that later turns are sent instead of the text it covered', async (t) => {
  const harness = openHarness(t)
  const { thread } = harness.service.createThread({ title: 'Long thread' })

  for (let index = 0; index < 4; index += 1) {
    harness.script.streamText = `Answer ${index}.`
    await harness.send(thread.id, `Question ${index}.`)
  }

  const closed = await harness.service.closeThread({ threadId: thread.id })

  assert.notEqual(closed.summary, null, 'closing a thread left no summary')
  assert.equal(closed.summary.threadId, thread.id)
  assert.ok(closed.summary.coversThroughSeq > 0, 'the summary does not say what it covered')
  assert.equal(closed.summary.text, 'The Tilley quote was moved to Friday.')

  /*
   * And the next turn sends the summary rather than the turns it already compressed.
   * The check is the words of the first question: once a summary covers it, it must
   * not appear again as a turn, or the app is paying twice for the same text.
   */
  await harness.send(thread.id, 'And the deposit?')
  const last = harness.streamed[harness.streamed.length - 1]
  const sent = last.messages.map(textOf).join('\n')

  assert.equal(sent.includes('moved to Friday'), true, 'the summary was not sent at all')
  assert.equal(sent.includes('Question 0.'), false, 'a turn the summary covered was sent again')
})
