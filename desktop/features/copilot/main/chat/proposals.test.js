'use strict'

/*
 * Drafting a task from a conversation, proven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS
 * the main process runs. A test against a separately compiled copy would agree with
 * this file about the rules while the shipped code did something else.
 *
 * Everything below is a fake repository and a fixed clock. That is deliberate:
 * `applyProposals` is a decision about what may be written, so the interesting
 * answers are "this row was built like this" and "no row was built at all", and a
 * database in a temporary folder would add a second way for the tests to fail
 * without making either answer more true. The fake honours the status filter the
 * way the real proposal repository does, which is what lets a test seed a rejected
 * row and prove the module's own choice rather than the fake's politeness.
 *
 * Five promises are checked, and each one is a sentence the plan states plainly.
 *
 * - A draft is a title, an optional note and an optional due hint. An assignee, a
 *   project or a task id is not accepted even when a model offers one, because a
 *   draft that named a real record would be a draft a bug could execute.
 * - Only a person's own message may produce a draft. Text that arrived inside a
 *   remembered item, a summary or a pasted email never can, however it is phrased.
 * - The same wording is not proposed twice while it is still waiting, and a
 *   decision already made is not consulted: a rejected wording may be proposed
 *   again, which is a second chance rather than a bug.
 * - Five drafts at most, and an answer offering more is refused rather than
 *   quietly shortened.
 * - An empty answer is a correct answer, and a draft the repository refuses is
 *   skipped without losing the drafts after it.
 *
 * One boundary is asserted as it is rather than as it might read: the title floor
 * is three characters inclusive, so two characters are refused and three are
 * accepted, and a title of three spaces passes the schema and is then dropped by
 * the service's trim. Both are recorded where they are asserted.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/*
 * What this file needs the bundle to export, and what each thing must be.
 *
 * Checked once at load: a missing export is a wiring gap, and saying so once is
 * clearer than every test failing with "not a function" for two different reasons.
 */
const REQUIRED_EXPORTS = {
  applyProposals: 'function',
  draftedTasksSchema: 'object',
  DRAFTING_PROMPT: 'string',
  MAX_DRAFTS: 'number',
}

for (const [name, type] of Object.entries(REQUIRED_EXPORTS)) {
  assert.equal(
    typeof api[name],
    type,
    `${name} is not exported by the main bundle (run npm run build:main)`,
  )
}

const { applyProposals, draftedTasksSchema, DRAFTING_PROMPT, MAX_DRAFTS } = api

/** One person on one server, working inside one business. Every call is filed under this. */
const SCOPE = Object.freeze({ serverHost: 'zuri.example.test', userId: 7, businessId: 'b1' })

/** The conversation the drafts are about. */
const THREAD_ID = 't1a2b3c4'

/** A conversation that is not the one under test, for the duplicate check's scope. */
const OTHER_THREAD_ID = 't9z8y7x6'

/** One instant every fixture shares: these tests are about drafts, not about a clock. */
const AT = '2026-11-16T09:30:00.000Z'

/* ------------------------------------------------------------------ *
 * The fakes
 * ------------------------------------------------------------------ */

/**
 * The proposal repository, kept in memory.
 *
 * `rows` is everything the fake holds, and `list` filters it by the status it was
 * asked for, exactly as `createProposalRepository` does with its SQL. A fake that
 * ignored the filter would make "a rejected draft may be proposed again" pass
 * whether or not the module asked for pending rows only.
 *
 * `created` records every attempt to write, including one that throws, because
 * several tests are about a write that must not happen. `createScopes` records the
 * scope each attempt was filed under, so "the row went to the right person and the
 * right business" is an assertion rather than an assumption.
 *
 * `refuseWhen` is how a test makes the repository refuse one draft. The module
 * catches everything on this path, so a plain Error stands in for the repository's
 * own StorageError: what is being proved is that the refusal does not stop the
 * other drafts, not which token it would have carried.
 */
function fakeRepositories (options = {}) {
  const { seed = [], refuseWhen = () => false } = options

  const created = []
  const createScopes = []
  const listCalls = []
  const rows = [...seed]

  return {
    created,
    createScopes,
    listCalls,
    rows,
    repositories: {
      proposals: {
        list (scope, filter) {
          listCalls.push({ scope, filter })
          const status = filter === undefined ? undefined : filter.status
          return rows.filter((row) => status === undefined || row.status === status)
        },
        create (scope, input) {
          createScopes.push(scope)
          created.push(input)
          if (refuseWhen(input)) throw new Error('refused by the repository')
          const row = {
            id: 'prop-' + created.length,
            threadId: input.threadId ?? null,
            kind: input.kind,
            status: 'pending',
            title: input.title,
            payload: input.payload,
            idempotencyKey: 'key-' + created.length,
            expiresAt: null,
            createdAt: AT,
            updatedAt: AT,
          }
          rows.push(row)
          return row
        },
      },
    },
  }
}

/**
 * One proposal row as the repository would hand it back.
 *
 * Shaped by `proposalRowSchema`, so a seeded row is a row this build could have
 * written rather than a shape invented for a test. `status` is the field these
 * tests move: everything else stays at its ordinary value.
 */
function proposalRow (overrides = {}) {
  return {
    id: 'prop-seed',
    threadId: THREAD_ID,
    kind: 'task',
    status: 'pending',
    title: 'Email the Tilley invoice',
    payload: { title: 'Email the Tilley invoice' },
    idempotencyKey: 'key-seed',
    expiresAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/**
 * Drafts as the schema hands them over.
 *
 * Parsing here rather than passing raw objects means every test that is not about
 * the schema is running on the shape the real caller would have. A test that
 * wanted an unparseable draft would say so, and one does: see the widened payload
 * case in the first test.
 */
function drafts (...tasks) {
  return draftedTasksSchema.parse({ tasks })
}

/** The keys of one created payload, sorted, so a comparison reads as a list of names. */
function payloadKeys (input) {
  return Object.keys(input.payload).sort()
}

/* ================================================================== *
 * A draft is a title and no more
 * ================================================================== */

test('a person asking for work produces drafts carrying a title, a note and a due hint, and nothing else', () => {
  const fake = fakeRepositories()

  const result = applyProposals(fake.repositories, SCOPE, THREAD_ID, drafts(
    {
      title: 'Email the Tilley invoice',
      // Padded on purpose: the stored note is the trimmed one, so a card is not
      // drawn with the spaces somebody pasted around it.
      notes: '  Send the June statement as a PDF.  ',
      dueHint: '  Friday  ',
    },
    { title: 'Call the plumber about the leak' },
  ), 'user_message')

  assert.deepEqual(result, { added: 2 })
  assert.equal(fake.created.length, 2)

  const first = fake.created[0]
  const second = fake.created[1]

  /*
   * The write itself: a task draft, filed in the conversation it was drafted in,
   * and carrying exactly the four fields the repository's own input accepts. No
   * `status`, because a proposal that arrived already approved would be a decision
   * nobody made, and no `expiresAt`, because nothing here set a deadline.
   */
  assert.equal(first.kind, 'task')
  assert.equal(first.threadId, THREAD_ID)
  assert.deepEqual(Object.keys(first).sort(), ['kind', 'payload', 'threadId', 'title'])

  // The payload, whole and trimmed. Deep equality, not a field check: an extra key
  // would fail here rather than being quietly tolerated.
  assert.deepEqual(first.payload, {
    title: 'Email the Tilley invoice',
    notes: 'Send the June statement as a PDF.',
    dueHint: 'Friday',
  })
  assert.deepEqual(payloadKeys(first), ['dueHint', 'notes', 'title'])

  // A draft that carried neither optional field produces a payload of one key,
  // rather than notes of "undefined" or an empty string.
  assert.deepEqual(second.payload, { title: 'Call the plumber about the leak' })
  assert.deepEqual(payloadKeys(second), ['title'])

  // Every write is filed under the signed-in person and the business on screen.
  assert.deepEqual(fake.createScopes, [SCOPE, SCOPE])

  /*
   * The schema is the first guard against anything that could name a real record.
   * An assignee or a task id is not accepted from a model, and the refusal is the
   * whole answer: a strict refusal shows up in a test, a silent trim shows up in
   * production.
   */
  const withAssignee = draftedTasksSchema.safeParse({
    tasks: [{ title: 'Email the client', assigneeId: 'user-3' }],
  })
  assert.equal(withAssignee.success, false)
  // And the same draft without the extra field is accepted, so the refusal was
  // about the key rather than about the task.
  assert.equal(
    draftedTasksSchema.safeParse({ tasks: [{ title: 'Email the client' }] }).success,
    true,
  )

  const withTaskId = draftedTasksSchema.safeParse({
    tasks: [{ title: 'Email the client', taskId: 'task-9' }],
  })
  assert.equal(withTaskId.success, false)

  // The top-level object is strict too: a model that wrapped its answer in an
  // explanation field does not get that field carried anywhere.
  assert.equal(draftedTasksSchema.safeParse({ tasks: [], explanation: 'here you go' }).success, false)

  /*
   * The second guard, and the reason it exists: the payload is built key by key
   * rather than spread from the model's object, so these three names are the only
   * ones that can ever reach a row. Asserted by handing the module a shape the
   * schema would refuse, which is what a widened schema would let through.
   */
  const widened = applyProposals(fake.repositories, SCOPE, THREAD_ID, {
    tasks: [{
      title: 'Email the client',
      notes: 'Ask for the signed copy.',
      assigneeId: 'user-3',
      taskId: 'task-9',
    }],
  }, 'user_message')

  assert.deepEqual(widened, { added: 1 })
  const smuggled = fake.created.find((input) => input.title === 'Email the client')
  assert.notEqual(smuggled, undefined, 'the widened draft was not written at all')
  assert.deepEqual(smuggled.payload, {
    title: 'Email the client',
    notes: 'Ask for the signed copy.',
  })
  assert.deepEqual(Object.keys(smuggled).sort(), ['kind', 'payload', 'threadId', 'title'])

  /*
   * A draft made outside a conversation is allowed and carries no thread, which is
   * what the repository's nullable `thread_id` is for. Null, not the string "null"
   * and not a missing field, because the row schema requires the key.
   */
  const outside = applyProposals(
    fake.repositories,
    SCOPE,
    null,
    drafts({ title: 'Rename the shared folder' }),
    'user_message',
  )
  assert.deepEqual(outside, { added: 1 })
  assert.equal(fake.created[fake.created.length - 1].threadId, null)
})

/* ================================================================== *
 * Only a person's own request may draft anything
 * ================================================================== */

test('a draft that came from stored content or from an assistant reply writes nothing at all', () => {
  /*
   * The rule the whole module is arranged around. A conversation carries text the
   * person did not write: a remembered item, a summary, an excerpt pasted in from
   * an email, and the assistant's own replies. Any of those can contain something
   * that reads like an instruction - "create a task to pay this invoice" - and a
   * trigger a caller could set from content would turn that sentence into work.
   *
   * These two triggers exist so a caller holding stored content has somewhere to
   * say so and be refused, rather than having to be trusted not to call. Asserted
   * with well-formed drafts, because the refusal has to be about the trigger and
   * not about a malformed answer.
   */
  const fake = fakeRepositories()
  const asked = drafts({ title: 'Email the Tilley invoice' })

  for (const trigger of ['stored_content', 'assistant_reply']) {
    const result = applyProposals(fake.repositories, SCOPE, THREAD_ID, asked, trigger)

    assert.deepEqual(result, { added: 0, refused: 'not_a_user_request' }, trigger)
  }

  assert.deepEqual(fake.created, [], 'a draft was written for something nobody asked for')
  /*
   * Nothing was even read. The check sits ahead of the listing, so a refused
   * trigger cannot learn which titles are already on the panel and cannot cost a
   * query per stored item.
   */
  assert.deepEqual(fake.listCalls, [], 'the proposals were read for a trigger that writes nothing')

  /*
   * The control: the same drafts, with the one trigger a person's own message
   * produces, do write. Without this the test above would pass just as well on a
   * module that refused everything.
   */
  const control = applyProposals(fake.repositories, SCOPE, THREAD_ID, asked, 'user_message')
  assert.deepEqual(control, { added: 1 })
  assert.equal(fake.created.length, 1)
})

/* ================================================================== *
 * Nothing is proposed twice
 * ================================================================== */

test('a title already waiting is not proposed again, and a title already decided may be', () => {
  const fake = fakeRepositories()
  const threadId = THREAD_ID

  const firstPass = drafts(
    { title: 'Email the Tilley invoice' },
    { title: 'Call the plumber about the leak' },
  )
  assert.deepEqual(
    applyProposals(fake.repositories, SCOPE, threadId, firstPass, 'user_message'),
    { added: 2 },
  )

  /*
   * The second pass over the same exchange, with the wording spelled differently.
   * The check is on the words that carry meaning rather than on the characters, so
   * case and runs of spaces do not make a second card for the same job.
   */
  const secondPass = drafts(
    { title: '  email   the TILLEY invoice ' },
    { title: 'Call the plumber about the leak' },
  )
  assert.deepEqual(
    applyProposals(fake.repositories, SCOPE, threadId, secondPass, 'user_message'),
    { added: 0 },
  )
  assert.equal(fake.created.length, 2, 'a repeat proposal reached the repository')

  /*
   * The same title twice in one answer is one card, because the pass remembers what
   * it wrote. A model repeating itself inside a single reply is the same duplicate
   * as a second pass, and the panel should not show it twice either.
   */
  const repeated = drafts(
    { title: 'Chase the Tilley deposit' },
    { title: 'chase the tilley deposit' },
  )
  assert.deepEqual(
    applyProposals(fake.repositories, SCOPE, threadId, repeated, 'user_message'),
    { added: 1 },
  )

  /*
   * Every duplicate check asked for pending rows only. That is the whole of the
   * next two assertions: approved and rejected drafts are deliberately not
   * consulted, because a decision has already been made about them and re-proposing
   * after a rejection is a person's second chance rather than a bug. Three passes
   * ran above, so three reads is the whole of what happened.
   */
  assert.equal(fake.listCalls.length, 3)
  for (const read of fake.listCalls) {
    assert.deepEqual(read.filter, { status: 'pending' })
    assert.equal(read.scope, SCOPE)
  }

  const decided = fakeRepositories({
    seed: [
      proposalRow({ id: 'prop-approved', status: 'approved', title: 'Email the Tilley invoice' }),
      proposalRow({ id: 'prop-rejected', status: 'rejected', title: 'Call the plumber about the leak' }),
    ],
  })

  const reRun = drafts(
    { title: 'Email the Tilley invoice' },
    { title: 'Call the plumber about the leak' },
  )
  assert.deepEqual(
    applyProposals(decided.repositories, SCOPE, threadId, reRun, 'user_message'),
    { added: 2 },
  )
  assert.deepEqual(
    decided.created.map((input) => input.title),
    ['Email the Tilley invoice', 'Call the plumber about the leak'],
  )

  /*
   * And the duplicate check is per conversation, not per business. The same wording
   * in another thread is another thread's card: the person asked in that
   * conversation, so it is offered there.
   */
  const elsewhere = fakeRepositories({
    seed: [proposalRow({ id: 'prop-other-thread', threadId: OTHER_THREAD_ID })],
  })
  assert.deepEqual(
    applyProposals(
      elsewhere.repositories,
      SCOPE,
      THREAD_ID,
      drafts({ title: 'Email the Tilley invoice' }),
      'user_message',
    ),
    { added: 1 },
  )
  assert.equal(elsewhere.listCalls.length, 1)
  // The read is not narrowed by thread, because the repository's own listing is
  // the business's; the thread filter is the module's, applied above.
  assert.deepEqual(elsewhere.listCalls[0].filter, { status: 'pending' })
})

/* ================================================================== *
 * Five at most
 * ================================================================== */

test('an answer offering more than five drafts is refused rather than shortened', () => {
  assert.equal(MAX_DRAFTS, 5)

  /*
   * The prompt and the schema state the same number, which is the only reason a
   * model that follows the prompt is not then refused by the schema that reads it.
   */
  assert.equal(DRAFTING_PROMPT.includes(`at most ${MAX_DRAFTS} tasks`), true)

  const offered = Array.from(
    { length: MAX_DRAFTS + 1 },
    (_unused, index) => ({ title: `Task number ${index + 1}` }),
  )

  const refused = draftedTasksSchema.safeParse({ tasks: offered })

  assert.equal(refused.success, false)
  // No data at all, rather than the first five: a caller that ignored the result
  // would have nothing to write, which is the difference between a refusal and a
  // silent trim the person never sees.
  assert.equal(refused.data, undefined)
  assert.equal(
    refused.error.issues.some((issue) => issue.path.join('.') === 'tasks'),
    true,
    'the refusal did not name the task list',
  )

  // Exactly the maximum is accepted, and writes exactly that many cards.
  const atLimit = draftedTasksSchema.parse({ tasks: offered.slice(0, MAX_DRAFTS) })
  assert.equal(atLimit.tasks.length, MAX_DRAFTS)

  const fake = fakeRepositories()
  assert.deepEqual(
    applyProposals(fake.repositories, SCOPE, THREAD_ID, atLimit, 'user_message'),
    { added: MAX_DRAFTS },
  )
  assert.equal(fake.created.length, MAX_DRAFTS)
})

/* ================================================================== *
 * An empty answer
 * ================================================================== */

test('an empty answer is a correct answer and writes nothing', () => {
  const fake = fakeRepositories()
  const parsed = draftedTasksSchema.parse({ tasks: [] })

  const result = applyProposals(fake.repositories, SCOPE, THREAD_ID, parsed, 'user_message')

  assert.deepEqual(result, { added: 0 })
  /*
   * Not refused, and the difference matters: nothing was turned away, there was
   * simply nothing to do. A caller that logged `refused` would be recording an
   * error every time somebody chatted about something other than creating work.
   */
  assert.equal(Object.hasOwn(result, 'refused'), false)
  assert.equal(result.refused, undefined)

  assert.deepEqual(fake.created, [])
  // It does not even consult the panel, because there is nothing to compare.
  assert.deepEqual(fake.listCalls, [])

  /*
   * And the prompt tells the model this is the expected answer when nobody asked
   * for work, so an empty list is the model answering correctly rather than
   * failing.
   */
  assert.equal(DRAFTING_PROMPT.includes('"tasks":[]'), true)
})

/* ================================================================== *
 * The limits of a card
 * ================================================================== */

test('a title or a note outside the bounds is refused by the schema', () => {
  const one = (draft) => draftedTasksSchema.safeParse({ tasks: [draft] })

  /*
   * The title floor is three characters and the floor is inclusive, so two are
   * refused and three are accepted. Stated with both sides because the boundary
   * matters more than the rule: a test that only checked "short is refused" would
   * pass on a schema that also refused the shortest real title.
   */
  assert.equal(one({ title: 'ab' }).success, false)
  assert.equal(one({ title: 'abc' }).success, true)
  assert.equal(one({ title: '' }).success, false)

  // The ceiling, on both sides.
  assert.equal(one({ title: 'a'.repeat(120) }).success, true)
  assert.equal(one({ title: 'a'.repeat(121) }).success, false)

  // A note is a paragraph rather than a name, and has a paragraph's allowance.
  assert.equal(one({ title: 'Email the client', notes: 'n'.repeat(600) }).success, true)
  assert.equal(one({ title: 'Email the client', notes: 'n'.repeat(601) }).success, false)

  // A due hint is a phrase, not a date the model is allowed to invent at length.
  assert.equal(one({ title: 'Email the client', dueHint: 'd'.repeat(40) }).success, true)
  assert.equal(one({ title: 'Email the client', dueHint: 'd'.repeat(41) }).success, false)

  /*
   * One bad draft refuses the answer whole rather than letting the others through.
   * That is the same choice as the five-draft cap: an answer that had to be
   * partly thrown away is an answer that has stopped reading the conversation, and
   * half of it on the panel would hide that from the person.
   */
  assert.equal(
    draftedTasksSchema.safeParse({
      tasks: [{ title: 'Email the client' }, { title: 'ab' }],
    }).success,
    false,
  )

  /*
   * Three spaces pass the schema, because a floor that counts characters cannot see
   * that they mean nothing. The service is the second guard: it trims the title and
   * skips a draft whose name is empty, so no empty card is ever written. Asserted
   * rather than assumed, because "the schema will catch it" is exactly the belief
   * that leaves a blank row on a panel.
   */
  const blank = draftedTasksSchema.parse({ tasks: [{ title: '   ' }] })
  const fake = fakeRepositories()
  assert.deepEqual(
    applyProposals(fake.repositories, SCOPE, THREAD_ID, blank, 'user_message'),
    { added: 0 },
  )
  assert.deepEqual(fake.created, [], 'a draft with no name was written')
})

/* ================================================================== *
 * A draft the repository refuses
 * ================================================================== */

test('a draft the repository refuses is skipped, and the drafts after it are still offered', () => {
  /*
   * The repository refuses a row for reasons this module does not own: a thread
   * that is not this business's, or its own schema. That refusal is not worth
   * failing a conversation over, and it must not stop the drafts that follow it, so
   * it is caught and skipped.
   */
  const fake = fakeRepositories({
    refuseWhen: (input) => input.title === 'Call the plumber about the leak',
  })

  const asked = drafts(
    { title: 'Email the Tilley invoice' },
    { title: 'Call the plumber about the leak' },
    { title: 'File the June receipts' },
  )

  const result = applyProposals(fake.repositories, SCOPE, THREAD_ID, asked, 'user_message')

  // Two of three. The count is what the caller reports, so it has to agree with
  // what is actually on the panel.
  assert.deepEqual(result, { added: 2 })

  // All three were attempted, in the order they were offered: the refusal stopped
  // that one write and nothing else.
  assert.deepEqual(
    fake.created.map((input) => input.title),
    ['Email the Tilley invoice', 'Call the plumber about the leak', 'File the June receipts'],
  )

  // And the two that succeeded are the two the fake actually holds.
  assert.deepEqual(
    fake.rows.map((row) => row.title),
    ['Email the Tilley invoice', 'File the June receipts'],
  )

  /*
   * The refused title is not remembered as seen, because the module cannot tell
   * "this was refused" from "this was never offered". A later pass over the same
   * answer therefore tries it once more, fails once more, and still does not
   * duplicate the two cards that exist. Recorded here because it is the honest
   * shape of the behaviour, not because a retry is wrong: the panel is the truth,
   * and the refused draft never reached it.
   */
  const again = applyProposals(fake.repositories, SCOPE, THREAD_ID, asked, 'user_message')
  assert.deepEqual(again, { added: 0 })
  /*
   * Four, not six: the two cards already on the panel are recognised and never
   * attempted again, so the second pass tries only the refused title. A count of
   * six would mean the module had written nothing the first time and was
   * duplicating on every pass.
   */
  assert.equal(fake.created.length, 4)
})
