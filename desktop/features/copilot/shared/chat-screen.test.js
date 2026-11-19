'use strict'

/*
 * The conversation screen's decisions, tested through the bundle Electron loads.
 *
 * `ChatPanel.tsx` is a layout: it reads a bridge, keeps a little state and draws.
 * Every sentence a person reads on that screen - which model an answer is
 * attributed to, what a privacy preview says before a send, which kinds of
 * remembered item exist and in what order, what a draft card is allowed to show -
 * is decided in `chat-screen.ts` as a pure function of rows this file hands it.
 * That is what makes the answers testable with no browser, no database and no
 * model, and it is why this file is pure too.
 *
 * Four of these functions exist because of a specific way a chat screen lies:
 *
 * - A chip that credits a reply to the model the person picked rather than the one
 *   that answered, or that draws an origin nobody recorded as `Local`. The second
 *   is the worse of the two: it invites somebody to relax about a cloud call.
 * - A reassuring privacy line shown before the check has run, or after it refused.
 * - A draft card that spreads a free-form payload onto the screen, and so draws an
 *   assignee or a task id the app never agreed to.
 * - A reply from a turn that outlived a business switch, appended to whatever
 *   conversation happens to be on screen now.
 *
 * The fixtures are parsed by the contract's own schemas, so a fixture cannot prove
 * something about a row the app could not actually produce. Every row shares one
 * instant, because these rules are about text, ids and order rather than a clock.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../build/main/ipc.cjs')

/**
 * What this file needs the bundle to export, and what each thing must be.
 *
 * Checked once at load: a missing export is a wiring gap in the main entry, and
 * saying so once is clearer than every case below failing with "not a function".
 */
const REQUIRED_EXPORTS = {
  originOf: 'function',
  originLabelOf: 'function',
  answerAttribution: 'function',
  privacyView: 'function',
  memorySections: 'function',
  memoryCount: 'function',
  isEditedItem: 'function',
  proposalCard: 'function',
  pendingProposals: 'function',
  shortDate: 'function',
  threadRows: 'function',
  composerState: 'function',
  pickerModels: 'function',
  chosenModelLabel: 'function',
  eventBelongsTo: 'function',
  failureSentence: 'function',
  NO_FALLBACK_NOTE: 'string',
  NO_SOURCES_NOTE: 'string',
  PROPOSAL_NOTE: 'string',
  MEMORY_LOCALITY_NOTE: 'string',
  MEMORY_KIND_LABELS: 'object',
  MEMORY_KIND_ORDER: 'object',
  NO_MODEL_CHOSEN: 'string',
}

for (const [name, type] of Object.entries(REQUIRED_EXPORTS)) {
  assert.equal(
    typeof api[name],
    type,
    `${name} is not exported by the main bundle - run npm run build:main first`,
  )
}

const {
  originOf,
  originLabelOf,
  answerAttribution,
  privacyView,
  memorySections,
  memoryCount,
  isEditedItem,
  proposalCard,
  pendingProposals,
  shortDate,
  threadRows,
  composerState,
  pickerModels,
  chosenModelLabel,
  eventBelongsTo,
  failureSentence,
  MEMORY_KIND_LABELS,
  MEMORY_KIND_ORDER,
  NO_MODEL_CHOSEN,
  NO_FALLBACK_NOTE,
  NO_SOURCES_NOTE,
  PROPOSAL_NOTE,
  MEMORY_LOCALITY_NOTE,
} = api

/** The conversation every fixture belongs to. */
const THREAD_ID = 't1a2b3c4'

/** One instant every fixture shares: nothing here is about a clock. */
const AT = '2026-11-16T09:30:00.000Z'

/* ------------------------------------------------------------------ *
 * Rows, in the storage contract's own shapes
 * ------------------------------------------------------------------ */

/**
 * One stored message.
 *
 * The three attribution fields are nullable because a person's own turn was not
 * produced by a model; every case that is about attribution sets them explicitly.
 */
function messageRow (overrides = {}) {
  return api.messageRowSchema.parse({
    id: 'm0000001',
    threadId: THREAD_ID,
    seq: 1,
    role: 'assistant',
    content: 'Three are overdue.',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cloud: true,
    createdAt: AT,
    ...overrides,
  })
}

/** One remembered item. Newest last, which is the order the panel receives them in. */
function memoryRow (overrides = {}) {
  return api.memoryRowSchema.parse({
    id: 'a0000001',
    kind: 'decision',
    text: 'Quotes go out on Fridays.',
    sourceMessageId: null,
    origin: 'ai',
    locked: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  })
}

/** One thread, as the sidebar list receives it. */
function threadRow (overrides = {}) {
  return api.threadRowSchema.parse({
    id: 'aaaaaaaa',
    title: 'Overdue invoices',
    pinned: false,
    createdAt: AT,
    updatedAt: AT,
    closedAt: null,
    messageCount: 4,
    ...overrides,
  })
}

/** One drafted task. `payload` is free-form in the database, which is the point. */
function proposalRow (overrides = {}) {
  return api.proposalRowSchema.parse({
    id: 'prop-0001',
    threadId: THREAD_ID,
    kind: 'task',
    status: 'pending',
    title: 'Email the Tilley invoice',
    payload: { title: 'Email the Tilley invoice' },
    idempotencyKey: 'key-0001',
    expiresAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  })
}

/** One payload preview, as the privacy check answers it. */
function preview (overrides = {}) {
  return api.payloadPreviewReplySchema.parse({
    cloud: true,
    messages: [{ role: 'user', text: 'Which tasks are overdue?' }],
    placeholders: [],
    blocked: false,
    blockedReason: null,
    ...overrides,
  })
}

/** One model's capability profile, in the shape the adapters hand over. */
function capabilities (overrides = {}) {
  return api.providerCapabilitiesSchema.parse({
    contextWindow: 200_000,
    maxOutput: 8_192,
    tools: 'native',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
    ...overrides,
  })
}

/** One model a provider offers, as the Models layer discovered it. */
function model (overrides = {}) {
  return api.modelInfoSchema.parse({
    id: 'claude-sonnet-4-5',
    providerId: 'anthropic',
    label: 'Claude Sonnet 4.5',
    cloud: true,
    capabilities: capabilities(),
    ...overrides,
  })
}

/* ================================================================== *
 * Where an answer came from
 * ================================================================== */

test('an origin nobody recorded is unknown, and is never drawn as Cloud or Local', () => {
  assert.equal(originOf(true), 'cloud')
  assert.equal(originOf(false), 'local')
  // Null is not false. A row written by a path that did not know whether the call
  // was local is the one case where a guess is dangerous: `Local` is the label that
  // would make a person relax about a cloud call, so an unrecorded origin says so.
  assert.equal(originOf(null), 'unknown')
  assert.equal(originOf(undefined), 'unknown')

  const attribution = answerAttribution(messageRow({ cloud: null, model: 'gpt-4o', provider: 'openai' }))

  assert.equal(attribution.origin, 'unknown')
  assert.equal(attribution.originLabel, 'Origin not recorded')
  assert.notEqual(attribution.originLabel, 'Cloud')
  assert.notEqual(attribution.originLabel, 'Local')
  // The note is the other half of the same promise: it states what was not
  // recorded rather than describing an answer nobody can vouch for.
  assert.match(attribution.note, /did not record where it ran/)

  /*
   * And the three labels are distinct, so the unknown state cannot collapse into
   * either of the two real ones when a screen draws a chip from the label alone.
   */
  assert.equal(new Set([originLabelOf('cloud'), originLabelOf('local'), originLabelOf('unknown')]).size, 3)
})

/* ================================================================== *
 * What is written above an answer
 * ================================================================== */

test('an answer is attributed to the model that answered, and a blank model says so', () => {
  const attribution = answerAttribution(messageRow({
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cloud: true,
  }))

  // The row's own values, not the picker's: a chip is a report of what happened.
  assert.equal(attribution.label, 'claude-sonnet-4-5')
  assert.equal(attribution.provider, 'anthropic')
  assert.equal(attribution.origin, 'cloud')
  assert.equal(attribution.originLabel, 'Cloud')
  assert.match(attribution.note, /cloud model/)

  // A padded model name is the same model, and a chip with spaces around it looks
  // like a different one on a narrow row.
  assert.equal(answerAttribution(messageRow({ model: '  claude-sonnet-4-5  ' })).label, 'claude-sonnet-4-5')

  /*
   * A reply with no model recorded is not a reply with an empty chip. An empty chip
   * reads as "model not shown here"; the sentence reads as "this was not recorded",
   * which is what is true and what a person could report.
   */
  for (const model of [null, '', '   ', '\t\n']) {
    const blank = answerAttribution(messageRow({ model }))
    assert.equal(blank.label, 'Model not recorded', `model ${JSON.stringify(model)}`)
  }

  // The provider passes through untouched, including null: guessing one from the
  // model name would be an attribution nobody stored.
  assert.equal(answerAttribution(messageRow({ provider: null })).provider, null)

  // The label always agrees with the origin it was built from, so the chip and its
  // word cannot disagree when a screen draws one above an answer.
  for (const [cloud, origin] of [[true, 'cloud'], [false, 'local'], [null, 'unknown']]) {
    const row = answerAttribution(messageRow({ cloud }))
    assert.equal(row.origin, origin)
    assert.equal(row.originLabel, originLabelOf(origin))
  }
})

test('a streaming flag adds that it is still writing and changes no attribution', () => {
  const row = messageRow({ provider: 'ollama', model: 'qwen2.5:7b', cloud: false })

  const settled = answerAttribution(row, false)
  const running = answerAttribution(row, true)

  // The person can see an answer arriving, so the note has to say the sentence is
  // not finished yet; a note that read the same would describe half a sentence as
  // the whole reply.
  assert.match(running.note, /Still writing/)
  assert.equal(running.note.startsWith(settled.note), true)

  // Streaming is the screen's own state, not a property of the stored row, so it
  // must not touch what the row is being credited with.
  assert.equal(running.label, settled.label)
  assert.equal(running.provider, settled.provider)
  assert.equal(running.origin, settled.origin)
  assert.equal(running.originLabel, settled.originLabel)

  // The default is a finished answer, so a caller that forgets the flag does not
  // accidentally claim a reply is still arriving.
  assert.equal(answerAttribution(row).note, settled.note)
})

/* ================================================================== *
 * The privacy line above the composer
 * ================================================================== */

test('a preview that has not arrived says it is checking, and never blocks', () => {
  const view = privacyView(null)

  // Null is "not asked yet", not "safe". A green line before the check has run is
  // reassurance about a check that has not happened.
  assert.equal(view.tone, 'checking')
  assert.equal(view.blocks, false)
  assert.match(view.headline, /Checking/)
  assert.match(view.detail, /before anything leaves/)
})

test('a blocked preview blocks, and explains itself in the preview own words', () => {
  const view = privacyView(preview({ blocked: true, blockedReason: 'The text names the business.' }))

  assert.equal(view.tone, 'blocked')
  assert.equal(view.blocks, true)
  assert.match(view.headline, /not be sent/)
  assert.equal(view.detail, 'The text names the business.')

  // A block whose reason was not carried still blocks, and still says something a
  // person can act on rather than drawing an empty line under a refusal.
  const unexplained = privacyView(preview({ blocked: true, blockedReason: null }))
  assert.equal(unexplained.tone, 'blocked')
  assert.equal(unexplained.blocks, true)
  assert.ok(unexplained.detail.trim().length > 1)
  assert.match(unexplained.detail, /identifies somebody/)
})

test('a local preview is not a privacy event, and a cloud one with nothing to hide says so', () => {
  /*
   * A preview for a model on this machine has no substitution to report, so it must
   * not claim any: saying "sent as written" about a request that was never sent
   * anywhere teaches a person the wrong thing about their text.
   */
  const local = privacyView(preview({ cloud: false }))
  assert.equal(local.tone, 'direct')
  assert.equal(local.blocks, false)
  assert.match(local.headline, /this machine/)
  assert.match(local.detail, /not sent anywhere/)

  // The cloud case with nothing replaced is the only one that may say the text was
  // sent as it stands, and it is a different sentence from the local one.
  const clean = privacyView(preview({ cloud: true, placeholders: [] }))
  assert.equal(clean.tone, 'direct')
  assert.equal(clean.blocks, false)
  assert.match(clean.headline, /as written/)
  assert.notEqual(clean.detail, local.detail)
})

test('a client name passes the checks, and the line names what was checked and what was not', () => {
  /*
   * The case the previous sentence got wrong. "Tilley" is a client, and nothing in
   * this sentence looks like an email address, a number, a handle or a web address,
   * so the residual check lets it through untouched and the send is not blocked.
   * Telling the person that nothing identified a person or the business was
   * therefore false, and the wording below is the honest version of that line.
   */
  const typed = 'Chase the Tilley quote on Friday.'
  assert.equal(api.residualIdentifier(typed), null)

  const cloud = api.buildCloudPayload(
    [{ role: 'user', parts: [{ type: 'text', text: typed }] }],
    { businessName: null, displayName: null, email: null },
  )
  assert.equal(cloud.preview.blocked, false)
  assert.deepEqual(cloud.preview.placeholders, [])
  assert.equal(cloud.preview.messages[0].text, typed)

  // The same sentence on a configured account: the business and the person's name
  // are replaced, and the client's name is not. That is the limit the line states.
  const known = api.buildCloudPayload(
    [{ role: 'user', parts: [{ type: 'text', text: typed }] }],
    { businessName: 'Zuri Lofts', displayName: 'Zuri', email: null },
  )
  assert.match(known.preview.messages[0].text, /Tilley/)

  const view = privacyView(preview({ cloud: true, messages: cloud.preview.messages, placeholders: [] }))
  assert.equal(view.tone, 'direct')
  assert.equal(view.blocks, false)
  assert.match(view.headline, /as written/)

  // The anonymity assurance is gone, because this sentence disproves it.
  assert.equal(/nothing/i.test(view.detail), false)
  assert.equal(/identified a person/i.test(view.detail), false)

  // What ran is named, so "checked" means something the person can understand.
  assert.match(view.detail, /email address/i)
  assert.match(view.detail, /number/i)
  assert.match(view.detail, /handle/i)
  assert.match(view.detail, /web address/i)

  // And so is the limit: a client name or a postal address stays in the text.
  assert.match(view.detail, /client/i)
  assert.match(view.detail, /not checked/i)
  assert.match(view.detail, /still be sent/)
})

test('a substituted preview counts the replacements and names each distinct label once', () => {
  const view = privacyView(preview({
    cloud: true,
    placeholders: [
      { token: '[BUSINESS_1]', label: 'Business name' },
      { token: '[EMAIL_1]', label: 'Email address' },
      { token: '[EMAIL_2]', label: 'Email address' },
    ],
  }))

  assert.equal(view.tone, 'substituted')
  assert.equal(view.blocks, false)
  // The count is the number of details replaced, because that is what the person is
  // being asked to accept.
  assert.match(view.headline, /3 details replaced/)

  // The list of names is a list of kinds of thing, not of occurrences: "Email
  // address, Email address" reads like a rendering bug and makes the list longer
  // than the sentence beside it.
  const occurrences = view.detail.split('Email address').length - 1
  assert.equal(occurrences, 1)
  assert.match(view.detail, /Business name/)
  assert.match(view.detail, /not the name/)
  // The limit is not dropped when something was replaced: a client's name is not
  // one of the configured values, so it travels beside the tokens just the same.
  assert.match(view.detail, /not checked/)
  assert.match(view.detail, /still be sent/)

  // One replacement is singular, because a line reading "1 details replaced" is the
  // kind of text that makes a person distrust the rest of the screen.
  const single = privacyView(preview({
    cloud: true,
    placeholders: [{ token: '[BUSINESS_1]', label: 'Business name' }],
  }))
  assert.match(single.headline, /1 detail replaced/)
  assert.equal(/1 details/.test(single.headline), false)
})

/* ================================================================== *
 * Remembered items
 * ================================================================== */

test('remembered items are grouped by kind in the order of what changes an answer', () => {
  // Deliberately shuffled, and with the two assumptions newest last: an
  // implementation that drew them in the order they arrived would look right on a
  // freshly extracted panel and wrong on every other day.
  const memory = [
    memoryRow({ id: 'a0000001', kind: 'open_question', text: 'Is the deposit paid?' }),
    memoryRow({ id: 'a0000002', kind: 'assumption', text: 'The client prefers email.' }),
    memoryRow({ id: 'a0000003', kind: 'fact', text: 'The studio is in Abuja.' }),
    memoryRow({ id: 'a0000004', kind: 'decision', text: 'Quotes go out on Fridays.' }),
    memoryRow({ id: 'a0000005', kind: 'assumption', text: 'The lease renews in March.' }),
  ]

  const sections = memorySections(memory)

  assert.deepEqual(sections.map((section) => section.kind), [
    'decision', 'fact', 'assumption', 'open_question',
  ])
  assert.deepEqual(sections.map((section) => section.kind), [...MEMORY_KIND_ORDER])
  assert.deepEqual(sections.map((section) => section.label), [
    MEMORY_KIND_LABELS.decision,
    MEMORY_KIND_LABELS.fact,
    MEMORY_KIND_LABELS.assumption,
    MEMORY_KIND_LABELS.open_question,
  ])

  /*
   * A kind with nothing in it is omitted rather than drawn as an empty heading. An
   * empty "Settled decisions" section reads as "there are no decisions", which is a
   * claim this screen has no way to make: it only knows what was extracted.
   */
  const partial = memorySections(memory.filter((row) => row.kind !== 'fact'))
  assert.deepEqual(partial.map((section) => section.kind), ['decision', 'assumption', 'open_question'])
  assert.equal(partial.some((section) => section.items.length === 0), false)
  assert.deepEqual(memorySections([]), [])
})

test('remembered items read newest first inside a group, and the array given is untouched', () => {
  // The repository hands items over oldest first, so the panel has to reverse to
  // put a correction above the wording it corrected.
  const memory = [
    memoryRow({ id: 'a0000001', kind: 'fact', text: 'The studio is in Abuja.' }),
    memoryRow({ id: 'a0000002', kind: 'fact', text: 'The studio has three rooms.' }),
    memoryRow({ id: 'a0000003', kind: 'fact', text: 'The studio moved to Wuse.' }),
  ]
  const before = memory.map((row) => row.id)

  const [facts] = memorySections(memory)

  assert.deepEqual(facts.items.map((row) => row.id), ['a0000003', 'a0000002', 'a0000001'])
  assert.equal(facts.items[0].text, 'The studio moved to Wuse.')

  /*
   * Reversing a copy rather than the caller's array: the same list is drawn twice
   * on this screen (a rail and a count), and a function that sorted in place would
   * make the second draw depend on the first.
   */
  assert.deepEqual(memory.map((row) => row.id), before)
  assert.notEqual(facts.items, memory)
})

test('the memory count is the live items, and an edit is the person own wording or a locked row', () => {
  assert.equal(memoryCount([]), 0)
  assert.equal(memoryCount([memoryRow({ id: 'a0000001' }), memoryRow({ id: 'a0000002' })]), 2)

  /*
   * A count that subtracted something, or that counted sections, would disagree with
   * the list beside it. Every live row is one item, whatever its kind.
   */
  const mixed = [
    memoryRow({ id: 'a0000001', kind: 'decision' }),
    memoryRow({ id: 'a0000002', kind: 'fact' }),
    memoryRow({ id: 'a0000003', kind: 'open_question' }),
  ]
  assert.equal(memoryCount(mixed), 3)
  assert.equal(
    memoryCount(mixed),
    memorySections(mixed).reduce((total, section) => total + section.items.length, 0),
  )

  // Either fact marks the row as the person's: an edit sets both, but a locked row
  // that came from somewhere else is still not a model's suggestion.
  assert.equal(isEditedItem(memoryRow({ origin: 'user', locked: false })), true)
  assert.equal(isEditedItem(memoryRow({ origin: 'ai', locked: true })), true)
  assert.equal(isEditedItem(memoryRow({ origin: 'user', locked: true })), true)

  // And an untouched extraction is not marked, which is what keeps the badge
  // meaning "somebody corrected this" rather than appearing on every row.
  assert.equal(isEditedItem(memoryRow({ origin: 'ai', locked: false })), false)
})

/* ================================================================== *
 * Drafted work
 * ================================================================== */

test('a draft card reads three payload keys by name and cannot surface a fourth', () => {
  const proposal = proposalRow({
    status: 'pending',
    payload: {
      title: 'Email the Tilley invoice',
      notes: 'Ask for the signed copy.',
      dueHint: 'Friday',
      // The two fields a model is most likely to add and the app never agreed to.
      assigneeId: 'user-3',
      taskId: 'task-9',
    },
  })

  const card = proposalCard(proposal)

  /*
   * Read key by key rather than spread: the payload is free-form, so a spread card
   * would draw whatever a model happened to include, including a field that means
   * something to a later phase and would then look like an agreement.
   */
  assert.equal(JSON.stringify(card).includes('user-3'), false, 'the assignee reached the card')
  assert.equal(JSON.stringify(card).includes('task-9'), false, 'the task id reached the card')
  assert.equal(card.notes, 'Ask for the signed copy.')
  assert.equal(card.dueHint, 'Friday')

  // The card's own keys, so a field added here is a change a reviewer sees rather
  // than a value that quietly appears on the screen.
  assert.deepEqual(Object.keys(card).sort(), [
    'decided', 'dueHint', 'executes', 'id', 'note', 'notes', 'statusLabel', 'title',
  ])

  // Nothing here executes. Approving records a decision, and the sentence with it is
  // the one the card carries, not a second wording written by the view.
  assert.equal(card.executes, false)
  assert.equal(card.note, PROPOSAL_NOTE)
  assert.match(card.note, /Nothing is created or sent/)
})

test('a note or a due hint is trimmed, and a blank one is null rather than an empty line', () => {
  const card = proposalCard(proposalRow({
    payload: { title: 'Email the Tilley invoice', notes: '  Send the June statement.  ', dueHint: '   ' },
  }))

  assert.equal(card.notes, 'Send the June statement.')
  // Null, not an empty string: the card omits the line entirely, where "" draws a
  // gap the person reads as a missing part of the draft.
  assert.equal(card.dueHint, null)

  // A value that is not text cannot be drawn as text, whatever a model sent.
  const odd = proposalCard(proposalRow({
    payload: { title: 'Email the Tilley invoice', notes: 7, dueHint: { when: 'Friday' } },
  }))
  assert.equal(odd.notes, null)
  assert.equal(odd.dueHint, null)

  // A payload with neither field is the ordinary case and carries no blanks.
  const bare = proposalCard(proposalRow())
  assert.equal(bare.notes, null)
  assert.equal(bare.dueHint, null)
  assert.equal(bare.title, 'Email the Tilley invoice')
})

test('a card reports its status, and only a pending one still offers a decision', () => {
  const pending = proposalCard(proposalRow({ status: 'pending' }))
  assert.equal(pending.statusLabel, 'Pending')
  assert.equal(pending.decided, false)

  const approved = proposalCard(proposalRow({ status: 'approved' }))
  assert.equal(approved.statusLabel, 'Approved')
  assert.equal(approved.decided, true)

  const rejected = proposalCard(proposalRow({ status: 'rejected' }))
  assert.equal(rejected.statusLabel, 'Rejected')
  assert.equal(rejected.decided, true)

  /*
   * A decided card stops offering the buttons, which is what `decided` is read for.
   * An expired row is decided too: a draft that timed out is not waiting on anybody,
   * so offering Approve would record a decision about something that has moved on.
   */
  const expired = proposalCard(proposalRow({ status: 'expired' }))
  assert.equal(expired.statusLabel, 'Expired')
  assert.equal(expired.decided, true)

  // No status lets the card claim it could execute anything.
  for (const status of ['pending', 'approved', 'rejected', 'expired']) {
    assert.equal(proposalCard(proposalRow({ status })).executes, false, status)
  }
})

test('only pending drafts are listed, and they are listed in the order they arrived', () => {
  const proposals = [
    proposalRow({ id: 'prop-0001', status: 'pending', title: 'First' }),
    proposalRow({ id: 'prop-0002', status: 'approved', title: 'Decided already' }),
    proposalRow({ id: 'prop-0003', status: 'pending', title: 'Second' }),
    proposalRow({ id: 'prop-0004', status: 'rejected', title: 'Turned down' }),
  ]

  const listed = pendingProposals(proposals)

  /*
   * A card the person already answered must not come back: the panel would offer a
   * second decision on the same draft, and the oldest unanswered one would wait
   * behind it. Order is kept so the oldest pending card is answered first.
   */
  assert.deepEqual(listed.map((row) => row.id), ['prop-0001', 'prop-0003'])
  assert.deepEqual(listed.map((row) => row.title), ['First', 'Second'])
  assert.equal(listed.some((row) => row.status !== 'pending'), false)

  // The rows come back whole, because the card is built from the row rather than
  // from a projection done here.
  assert.equal(listed[0], proposals[0])

  assert.deepEqual(pendingProposals([]), [])
  assert.deepEqual(pendingProposals([proposalRow({ status: 'expired' })]), [])
})

/* ================================================================== *
 * Dates and the thread list
 * ================================================================== */

test('a stored instant is drawn as DD-MM-YY, and an unreadable one as nothing at all', () => {
  // The design system's format, and the day stored rather than a reformatted guess.
  assert.equal(shortDate('2026-11-16T09:30:00.000Z'), '16-11-26')

  /*
   * The date part is taken from the string, so the stored day is the day drawn
   * whatever the reader's offset. Both of these sit near midnight UTC: a Date-based
   * reader would call the first one the 17th east of UTC and the second one the 15th
   * west of it, and a person would see a thread filed under the wrong day.
   */
  assert.equal(shortDate('2026-11-16T23:30:00.000Z'), '16-11-26')
  assert.equal(shortDate('2026-11-16T00:30:00.000Z'), '16-11-26')

  // A bare date is the same day, so a caller holding one is not punished for it.
  assert.equal(shortDate('2026-11-16'), '16-11-26')

  /*
   * An unreadable value is empty, not "Invalid Date" and not a crash: a list row
   * with the words Invalid Date on it tells a person the app is broken when all that
   * happened was one timestamp it could not read.
   */
  for (const value of ['', '   ', 'not a date', '2026/11/16', '16-11-2026', '2026-11']) {
    assert.equal(shortDate(value), '', JSON.stringify(value))
  }
})

test('pinned threads come first, then the most recently touched, and the id settles a tie', () => {
  /*
   * Two rows that differ in one field at a time, so each assertion is about the rule
   * and not about two unrelated differences.
   */
  const old = threadRow({ id: 'aaaaaaaa', title: 'Old but pinned', pinned: true, updatedAt: '2026-11-01T09:00:00.000Z' })
  const recent = threadRow({ id: 'bbbbbbbb', title: 'Recent', pinned: false, updatedAt: '2026-11-15T09:00:00.000Z' })

  // Pinning is a request to keep something in reach, so it outranks recency.
  assert.deepEqual(threadRows([recent, old]).map((row) => row.id), ['aaaaaaaa', 'bbbbbbbb'])

  // Inside one group the newest touch is first, which is what puts the conversation
  // somebody was just having at the top.
  const newer = threadRow({ id: 'aaaaaaaa', title: 'Newer', pinned: false, updatedAt: '2026-11-16T09:00:00.000Z' })
  const older = threadRow({ id: 'bbbbbbbb', title: 'Older', pinned: false, updatedAt: '2026-11-14T09:00:00.000Z' })
  assert.deepEqual(threadRows([older, newer]).map((row) => row.id), ['aaaaaaaa', 'bbbbbbbb'])

  /*
   * Two rows written in the same millisecond are the ordinary case for a thread
   * created and renamed at once. The id settles it so the list does not reshuffle
   * between two identical states, and the answer is the same whichever order the
   * store returned them in.
   */
  const first = threadRow({ id: 'aaaaaaaa', title: 'First', updatedAt: AT })
  const second = threadRow({ id: 'bbbbbbbb', title: 'Second', updatedAt: AT })

  assert.deepEqual(threadRows([first, second]).map((row) => row.id), ['aaaaaaaa', 'bbbbbbbb'])
  assert.deepEqual(threadRows([second, first]).map((row) => row.id), ['aaaaaaaa', 'bbbbbbbb'])
})

test('a thread row carries its day, its count and a name even when the title is blank', () => {
  const row = threadRows([threadRow({
    id: 'aaaaaaaa',
    title: '  Overdue invoices  ',
    updatedAt: '2026-11-16T09:30:00.000Z',
    messageCount: 6,
  })])[0]

  // The day rather than the instant: the list is a list of conversations, and a
  // timestamp to the millisecond is noise beside a title.
  assert.equal(row.when, '16-11-26')
  assert.equal(row.messageCount, 6)
  assert.equal(row.label, 'Overdue invoices')

  /*
   * A new thread is stored with no title until the first message names it, and an
   * empty row in a sidebar looks like a rendering failure rather than a conversation
   * nobody has started yet.
   */
  for (const title of ['', '   ', '\t']) {
    assert.equal(threadRows([threadRow({ title })])[0].label, 'New conversation', JSON.stringify(title))
  }

  // The sort key is internal: a screen that read it would draw a timestamp where a
  // label belongs, so it must not survive the mapping.
  assert.deepEqual(Object.keys(row).sort(), ['id', 'label', 'messageCount', 'pinned', 'when'])
  assert.deepEqual(threadRows([]), [])
})

/* ================================================================== *
 * The composer
 * ================================================================== */

test('the send button is refused for one reason at a time, in the order a person meets them', () => {
  const fine = { text: 'Which tasks are overdue?', busy: false, signedIn: true, hasBusiness: true }
  assert.deepEqual(composerState(fine), { canSend: true, hint: null })

  const signedOut = composerState({ ...fine, signedIn: false })
  const noBusiness = composerState({ ...fine, hasBusiness: false })
  const busy = composerState({ ...fine, busy: true })
  const empty = composerState({ ...fine, text: '   ' })

  for (const state of [signedOut, noBusiness, busy, empty]) {
    assert.equal(state.canSend, false)
    // An unavailable button with no explanation is a person clicking a dead control.
    assert.equal(typeof state.hint, 'string')
    assert.ok(state.hint.trim().length > 1)
  }

  // Four problems, four sentences: one sentence for all of them would leave a
  // signed-out person retyping a message that was never the problem.
  assert.equal(new Set([signedOut.hint, noBusiness.hint, busy.hint, empty.hint]).size, 4)

  /*
   * The order is the order the person meets the problems: nothing can be sent while
   * signed out, so that is what is said even when everything else is also wrong.
   * Without a fixed order the hint would depend on which check ran last.
   */
  const all = composerState({ text: '', busy: true, signedIn: false, hasBusiness: false })
  assert.equal(all.hint, signedOut.hint)
  assert.equal(composerState({ ...fine, hasBusiness: false, busy: true }).hint, noBusiness.hint)
  assert.equal(composerState({ ...fine, busy: true, text: '' }).hint, busy.hint)

  // Whitespace is nothing typed. A message of spaces would be stored as a turn with
  // no question in it, and the model would answer the air.
  for (const text of ['', ' ', '\n\n', '\t']) {
    assert.equal(composerState({ ...fine, text }).canSend, false, JSON.stringify(text))
  }
})

/* ================================================================== *
 * The model picker
 * ================================================================== */

test('a picker row carries the provider it came from, its labels and its chips', () => {
  const rows = pickerModels('anthropic', [model()])

  /*
   * The preset id travels with the model because the send call needs both. A picker
   * that offered a model without the provider it belongs to would be offering
   * something that cannot be sent.
   */
  assert.deepEqual(rows, [{
    id: 'claude-sonnet-4-5',
    presetId: 'anthropic',
    label: 'Claude Sonnet 4.5',
    originLabel: 'Cloud',
    cloud: true,
    chips: ['Tools'],
  }])
  /*
   * The origin travels as the provider's own boolean as well as its word, so the
   * screen can decide whether a turn is local without comparing a label. Wording a
   * chip is not a thing a badge should depend on.
   */
  assert.deepEqual(Object.keys(rows[0]).sort(), ['chips', 'cloud', 'id', 'label', 'originLabel', 'presetId'])

  // The origin word is the endpoint's own answer, and a local server says so.
  const local = pickerModels('ollama', [
    model({
      id: 'qwen2.5:7b',
      providerId: 'ollama',
      label: 'Qwen 2.5 7B',
      cloud: false,
      capabilities: capabilities({ tools: 'none' }),
    }),
  ])
  assert.equal(local[0].originLabel, 'Local')
  assert.equal(local[0].presetId, 'ollama')
  // The chips are the Models screen's, so the two surfaces cannot describe the same
  // model differently.
  assert.deepEqual(local[0].chips, ['No tools'])

  assert.deepEqual(pickerModels('anthropic', [model()])[0].chips, api.capabilityChips(model().capabilities))
  assert.deepEqual(pickerModels('anthropic', []), [])

  /*
   * The chip builder is injectable, and the default is the Models screen's. Asserted
   * because a picker that ignored the override would silently be a second
   * implementation of the chips, which is the drift this arrangement avoids.
   */
  const custom = pickerModels(
    'anthropic',
    [model()],
    (caps) => [`window ${caps.contextWindow}`],
  )
  assert.deepEqual(custom[0].chips, ['window 200000'])

  /*
   * A label of spaces cannot be drawn, so the model's id stands in for it. Hand-built
   * on purpose: the schema refuses an empty label, and this is the guard that keeps a
   * padded one from producing a blank row on a narrow list.
   */
  const padded = pickerModels('anthropic', [{
    id: 'claude-sonnet-4-5',
    providerId: 'anthropic',
    label: '   ',
    cloud: true,
    capabilities: capabilities(),
  }])
  assert.equal(padded[0].label, 'claude-sonnet-4-5')
})

test('the picker trigger names the chosen model, and says what to do when nothing is chosen', () => {
  // An empty trigger that just said "Model" would look like a model was selected.
  assert.equal(NO_MODEL_CHOSEN, 'Choose a model')
  assert.equal(chosenModelLabel(null), NO_MODEL_CHOSEN)

  const chosen = pickerModels('anthropic', [model()])[0]
  assert.equal(chosenModelLabel(chosen), 'Claude Sonnet 4.5')
  assert.equal(chosenModelLabel(chosen), chosen.label)

  // The trigger and the row it names cannot disagree, so a screen showing both draws
  // the same word twice rather than two spellings of one model.
  assert.notEqual(chosenModelLabel(chosen), NO_MODEL_CHOSEN)
  assert.equal(chosenModelLabel(null).trim().length > 1, true)
})

/* ================================================================== *
 * The turn that is running
 * ================================================================== */

test('an event belongs to the turn only when the turn and both thread ids agree', () => {
  const running = { turnId: 'turn-1', threadId: 'thread-a', text: 'Half an answer' }
  const event = { turnId: 'turn-1', threadId: 'thread-a' }

  // Nothing is being drawn, so nothing can be appended to it.
  assert.equal(eventBelongsTo(null, 'thread-a', event), false)

  assert.equal(eventBelongsTo(running, 'thread-a', event), true)

  // An event from another turn on the same conversation: a cancelled turn that is
  // still finishing must not write into the turn that replaced it.
  assert.equal(eventBelongsTo(running, 'thread-a', { turnId: 'turn-2', threadId: 'thread-a' }), false)

  /*
   * The business switch, which is the case this function exists for. The turn keeps
   * running and its id still matches, but the event carries the thread that was left
   * behind, so it must not be appended to the conversation now on screen.
   */
  assert.equal(eventBelongsTo(running, 'thread-a', { turnId: 'turn-1', threadId: 'thread-b' }), false)

  // And the same rule from the screen's side: a turn belonging to a conversation the
  // person has moved away from cannot publish into the one they are looking at.
  assert.equal(eventBelongsTo(running, 'thread-b', event), false)

  /*
   * Comparing the thread alone would append every straggling event twice, so an
   * empty turn id is not a match even when the conversation is the one on screen.
   */
  assert.equal(eventBelongsTo(running, 'thread-a', { turnId: '', threadId: 'thread-a' }), false)
  assert.equal(eventBelongsTo(running, 'thread-a', { turnId: ' turn-1', threadId: 'thread-a' }), false)
})

/* ================================================================== *
 * Refusal sentences
 * ================================================================== */

test('a known refusal token becomes its sentence, and an unknown one never becomes itself', () => {
  const messages = api.CHAT_FAILURE_MESSAGES

  assert.equal(failureSentence(messages, 'blocked_content'), messages.blocked_content)
  assert.match(failureSentence(messages, 'blocked_content'), /identifies a person or a business/)
  assert.equal(failureSentence(messages, 'provider_unauthorized'), messages.provider_unauthorized)

  /*
   * A token from a newer main process falls through to the generic sentence. A token
   * on screen is an identifier the person cannot act on and cannot report, so the
   * fallback must be a sentence and must not carry the token inside it.
   */
  const unknown = failureSentence(messages, 'a_token_this_build_does_not_have')
  assert.equal(unknown, 'Something went wrong. Try again.')
  assert.equal(unknown.includes('a_token_this_build_does_not_have'), false)
  assert.equal(unknown.includes('_'), false)
  assert.equal(Object.values(messages).includes(unknown), false)
  assert.match(unknown, / [A-Z]/)

  // Every token the contract lists has its own sentence, so no refusal reaches the
  // screen as an identifier. A token added in a newer build fails here rather than
  // shipping without one.
  const failures = api.CHAT_FAILURES
  assert.ok(failures.length > 0, 'the contract lists no failure tokens')
  for (const token of failures) {
    const sentence = failureSentence(messages, token)
    assert.ok(sentence.trim().length > 1, `${token}: the sentence is empty`)
    assert.equal(sentence.includes(token), false, `${token}: the token reached the screen`)
    assert.equal(sentence.includes('_'), false, `${token}: the sentence carries an identifier`)
    assert.equal(/https?:\/\//i.test(sentence), false, `${token}: the sentence carries a URL`)
    assert.equal(/[\u2013\u2014]/.test(sentence), false, `${token}: the sentence carries a long dash`)
  }

  // And a caller holding an empty map still gets a usable sentence rather than
  // undefined drawn on the screen.
  assert.equal(failureSentence({}, 'blocked_content'), 'Something went wrong. Try again.')
})

/* ================================================================== *
 * The lines the screen repeats word for word
 * ================================================================== */

test('the fixed notes and the memory vocabulary are frozen and say only what is true now', () => {
  /*
   * Frozen because these are the sentences a screen repeats, and a caller that could
   * reassign one could change what every card says from somewhere else in the app.
   */
  assert.equal(Object.isFrozen(MEMORY_KIND_LABELS), true)
  assert.equal(Object.isFrozen(MEMORY_KIND_ORDER), true)

  // The four kinds, and nothing else: a fifth would be a row the memory panel has no
  // heading to draw.
  assert.deepEqual(Object.keys(MEMORY_KIND_LABELS).sort(), ['assumption', 'decision', 'fact', 'open_question'])
  assert.deepEqual([...MEMORY_KIND_ORDER].sort(), [...api.memoryKinds].sort())
  assert.equal(MEMORY_KIND_ORDER.length, new Set(MEMORY_KIND_ORDER).size)
  for (const kind of MEMORY_KIND_ORDER) {
    assert.ok(MEMORY_KIND_LABELS[kind].trim().length > 1, `${kind}: no heading`)
  }

  /*
   * `NO_FALLBACK_NOTE` is the honesty rule from the module's own header: fallback is a
   * later phase, so the line under an answer says none is configured rather than
   * inventing one that happened.
   */
  assert.match(NO_FALLBACK_NOTE, /No fallback/)
  assert.match(NO_FALLBACK_NOTE, /model you chose/)

  // Documents are not part of this phase either, so the absence of citations is
  // stated rather than left as an empty list a person would read as "nothing found".
  assert.match(NO_SOURCES_NOTE, /no sources/i)

  // A draft card says a decision is recorded and an action is not taken; without it
  // an approved card would look like work had been created somewhere.
  assert.match(PROPOSAL_NOTE, /Nothing is created or sent/)
  assert.match(PROPOSAL_NOTE, /Phase 6/)

  // The memory rail says where the words are kept and that another business cannot
  // see them, which is the promise the whole local store rests on.
  assert.match(MEMORY_LOCALITY_NOTE, /on this device/i)
  assert.match(MEMORY_LOCALITY_NOTE, /Another business/)

  for (const note of [NO_FALLBACK_NOTE, NO_SOURCES_NOTE, PROPOSAL_NOTE, MEMORY_LOCALITY_NOTE]) {
    assert.equal(typeof note, 'string')
    assert.ok(note.trim().length > 1)
    // Long dashes do not render everywhere this text is shown.
    assert.equal(/[\u2013\u2014]/.test(note), false)
  }
})
