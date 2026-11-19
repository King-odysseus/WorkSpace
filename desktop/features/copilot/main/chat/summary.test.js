'use strict'

/*
 * Compressing the older part of a conversation, proven through the bundle Electron
 * loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS
 * the main process runs. A test against a separately compiled copy would agree with
 * this file about the rules while the shipped code did something else.
 *
 * Nothing here opens a database, reaches a provider or needs a key. Four of the five
 * functions in `chat/summary.ts` are pure: they take rows plus a watermark and answer
 * with a verdict, a plan or a batch. `applySummary` is the one that writes, and the
 * repository below is a hand-built object that records what it was handed, so
 * "exactly these three fields reached the store" is checkable rather than assumed.
 *
 * Each group below is one question a person's conversation depends on.
 *
 * - When a pass happens. The trigger counts the turns *since* the summary rather
 *   than the length of the thread. Without that, a thread summarised once would be
 *   summarised again on every following turn, which is a model call per message for
 *   the rest of the conversation's life.
 * - What a pass may take. The newest kept window is never planned, because those
 *   turns are what the next question is about, and a summary of "what did I just
 *   ask" is a summary of the question itself.
 * - Where it may start. Turns the previous summary already covers are never planned
 *   twice, and the watermark in the plan is the sequence number of the last turn it
 *   took, which is what the repository compares against.
 * - What the model reads. The previous summary first, then the new turns, each
 *   numbered by its own sequence number rather than by its position in the batch,
 *   with the assistant labelled apart from the person.
 * - What may come back. An empty answer, an answer past the cap and an answer with a
 *   field the row does not hold are all refused, and the prompt asks for exactly the
 *   shape the schema parses.
 *
 * Two boundaries are recorded here as they behave rather than as they would be nicer
 * to behave, because both are visible from outside the module and both would leave
 * the next person guessing:
 *
 * 1. `summaryBatch` labels every turn that is not the assistant "Person", including a
 *    system turn, because `messageRowSchema` has a system role and the label is a
 *    two-way choice. An app-inserted turn inside the planned range is therefore read
 *    by the model as something the person said. See the batch group.
 * 2. `summaryReplySchema` checks length before anything is trimmed, so a
 *    whitespace-only answer passes the schema and `applySummary` then hands the
 *    repository an empty string, which the summaries repository refuses as
 *    `invalid_request`. Nothing is corrupted - the recall pass catches the refusal
 *    and reports a warning - but the schema is one trim short of the emptiness rule
 *    its `min(1)` states. See the schema group.
 *
 * No timestamps are compared except the one the fake repository answers with: every
 * fixture shares one instant, because these rules are about sequence numbers and
 * text rather than about a clock.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/**
 * What this file needs the bundle to export, and what each thing must be.
 *
 * Checked once at load: a missing export is a wiring gap in the main entry, and
 * saying so once is clearer than every test failing with "not a function". The two
 * limits are numbers rather than functions, and the tests below use them instead of
 * repeating the literals, so a window that moves is a smaller change to this file
 * than it would be otherwise.
 */
const REQUIRED_EXPORTS = {
  needsSummary: 'function',
  planSummary: 'function',
  summaryBatch: 'function',
  applySummary: 'function',
  summaryReplySchema: 'object',
  SUMMARY_KEEP_RECENT: 'number',
  MAX_SUMMARY_TEXT: 'number',
  SUMMARY_PROMPT: 'string',
}

for (const [name, type] of Object.entries(REQUIRED_EXPORTS)) {
  assert.equal(
    typeof api[name],
    type,
    `${name} is not exported by the main bundle (run npm run build:main)`,
  )
}

const {
  needsSummary,
  planSummary,
  summaryBatch,
  applySummary,
  summaryReplySchema,
  SUMMARY_KEEP_RECENT,
  MAX_SUMMARY_TEXT,
  SUMMARY_PROMPT,
} = api

/** The conversation every fixture in this file belongs to. */
const THREAD_ID = 'th1'

/** One instant every fixture shares: these rules are about ids and text, not time. */
const AT = '2026-11-16T09:30:00.000Z'

/** The business a pass is working in. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7, businessId: 'b1' }

/* ------------------------------------------------------------------ *
 * Rows, in the storage contract's own shapes
 * ------------------------------------------------------------------ */

/** A stored message's id, derived from its sequence number so a plan reads clearly. */
function messageId (seq) {
  return `m000${String(seq).padStart(4, '0')}`
}

/**
 * One stored message.
 *
 * `provider`, `model` and `cloud` are null because this is a turn nothing is known
 * about yet: inventing an attribution for a question would misreport the chip the
 * screen draws, and a summary pass reads none of the three. The nulls are here so
 * every fixture is a row the storage contract would accept.
 */
function messageRow (overrides = {}) {
  return {
    id: 'm0000001',
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

/** A turn the person took. */
function personSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'user', content })
}

/** A turn the model took, which is summarised as a reply rather than as knowledge. */
function assistantSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'assistant', content })
}

/** A turn the app inserted. It is a role the contract knows and the batch labels. */
function systemSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'system', content })
}

/**
 * A thread of `turns` messages, alternating person and assistant, seq from 1.
 *
 * Built by number rather than written out, because the cases below are about counts
 * at twenty and thirty and a hand-written fixture of that length is a place for an
 * off-by-one to hide. The odd turns are the person's, so turn 21 is a question:
 * that is what makes the kept window start on a question in the thirty-turn case.
 */
function threadOf (turns) {
  const rows = []
  for (let seq = 1; seq <= turns; seq += 1) {
    const person = seq % 2 === 1
    rows.push(person
      ? personSays(seq, `Turn ${seq}: which tasks are overdue?`)
      : assistantSays(seq, `Turn ${seq}: three are overdue.`))
  }
  return rows
}

/* ------------------------------------------------------------------ *
 * A summary repository that records instead of storing
 * ------------------------------------------------------------------ */

/**
 * The one repository an apply touches.
 *
 * `upsert` records the scope and the input it was given, then answers with the row it
 * would have written - including the `updatedAt` only the store's own clock can
 * produce. Recording rather than storing is what makes "these three fields and no
 * others" checkable: a caller that invented an id, came up with a timestamp of its
 * own, or handed over the untrimmed text would all be visible in `written`.
 */
function summaryRepositories () {
  const written = []
  const scopes = []

  return {
    summaries: {
      upsert (scope, input) {
        scopes.push(scope)
        written.push(input)
        return {
          threadId: input.threadId,
          text: input.text,
          coversThroughSeq: input.coversThroughSeq,
          updatedAt: AT,
        }
      },
    },

    /* What the assertions read. */
    written,
    scopes,
  }
}

/* ================================================================== *
 * When a pass is worth making
 * ================================================================== */

test('a short thread is left alone, and a thread is summarised once rather than on every turn after that', () => {
  /*
   * The trigger is `fresh > keepRecent * 2`, so the interesting numbers are the two
   * either side of twenty. Every one of them is asserted rather than only the case
   * that passes, because a trigger that fires at once and a trigger that never fires
   * both look correct when only the true answer is checked.
   */
  assert.equal(SUMMARY_KEEP_RECENT, 10, 'the kept window moved; every count below is stated against ten')

  // A conversation that has barely started costs nothing to send whole.
  assert.equal(needsSummary([], 0), false)
  assert.equal(needsSummary(threadOf(1), 0), false)
  assert.equal(needsSummary(threadOf(5), 0), false)

  /*
   * Twice the kept window exactly is still no pass, which is the half of the rule
   * that keeps the call off a thread that has only just grown. One turn later it is
   * worth one call: that is the crossing, stated either side.
   */
  assert.equal(needsSummary(threadOf(20), 0), false)
  assert.equal(needsSummary(threadOf(21), 0), true)

  /*
   * And then it goes quiet again. A summary that reached turn twenty leaves ten turns
   * fresh, which is inside the window, so the turns after the pass cost nothing.
   * This is the assertion the whole count exists for: a thread summarised once must
   * not be summarised again on every turn forever.
   */
  assert.equal(needsSummary(threadOf(30), 20), false)
  assert.equal(needsSummary(threadOf(31), 20), false)

  // Twenty turns after the watermark is still inside the bar, twenty one is over it,
  // which is the same crossing as above measured from a watermark instead of from 0.
  assert.equal(needsSummary(threadOf(40), 20), false)
  assert.equal(needsSummary(threadOf(41), 20), true)

  // A watermark at the end of the thread means nothing is fresh, which is the state
  // after a pass that covered everything that had been read.
  assert.equal(needsSummary(threadOf(30), 30), false)
  // A watermark past the end cannot be produced by the plan, and it still answers no
  // rather than counting a negative number of turns.
  assert.equal(needsSummary(threadOf(30), 99), false)

  /*
   * The window is a parameter, so the same rule holds for a smaller one. This is what
   * lets a caller tune the cost without a second code path, and it proves the literal
   * ten is a default rather than a constant baked into the comparison.
   */
  assert.equal(needsSummary(threadOf(2), 0, 1), false)
  assert.equal(needsSummary(threadOf(3), 0, 1), true)
  // With the window at zero every turn is over the bar, which is a degenerate case a
  // caller may ask for rather than one this module invented.
  assert.equal(needsSummary(threadOf(1), 0, 0), true)
})

/* ================================================================== *
 * What a pass may take
 * ================================================================== */

test('a plan takes the older turns and never the newest kept window', () => {
  /*
   * Nothing to compress is null rather than an empty plan: "there is nothing to
   * summarise" and "summarise nothing" are different instructions, and only one of
   * them should produce a model call.
   */
  assert.equal(planSummary([], 0), null)
  assert.equal(planSummary(threadOf(5), 0), null)
  assert.equal(planSummary(threadOf(SUMMARY_KEEP_RECENT), 0), null)

  const messages = threadOf(30)
  const plan = planSummary(messages, 0)
  assert.notEqual(plan, null)

  // Thirty turns with ten kept: twenty are compressed, and they are the twenty
  // oldest, in the order they were said.
  assert.equal(plan.toSummarise.length, 20)
  assert.deepEqual(plan.toSummarise.map((row) => row.seq), [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  ])

  // The watermark is the last turn taken, not the last turn in the thread: the other
  // answer would make the ten kept turns look as if they had already been folded in,
  // and the context builder would skip them.
  assert.equal(plan.coversThroughSeq, 20)
  assert.equal(plan.toSummarise[plan.toSummarise.length - 1].seq, plan.coversThroughSeq)

  /*
   * The newest ten are absent by id as well as by number. They are the turns a
   * follow-up question is about, so a second copy of them inside a summary is at best
   * wasted tokens and at worst two versions of the same turn.
   */
  const kept = messages.slice(messages.length - SUMMARY_KEEP_RECENT)
  assert.deepEqual(kept.map((row) => row.seq), [
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  ])
  assert.equal(kept[0].role, 'user', 'the kept window starts on a question in this fixture')

  const planned = new Set(plan.toSummarise.map((row) => row.id))
  for (const row of kept) {
    assert.equal(planned.has(row.id), false, `turn ${row.seq} was planned and should have been kept`)
  }

  // A plan is a new list, so a caller that appends to it cannot change the thread it
  // was given, and the thread itself is untouched by planning.
  assert.notEqual(plan.toSummarise, messages)
  assert.equal(messages.length, 30)

  // The plan carries the two fields its caller reads and nothing else.
  assert.deepEqual(Object.keys(plan).sort(), ['coversThroughSeq', 'toSummarise'])

  /*
   * Eleven is what the first pass over a thread at the trigger actually compresses:
   * twenty one fresh turns with ten kept. It is written down because it is the number
   * a reader wants and it is not obvious from either constant on its own.
   *
   * The cut is by count rather than by exchange, so it can land inside a pair: the
   * eleven turns taken here end on turn 11, a question, and the kept window then
   * starts with the answer to it. That is acceptable for a summary - the model reads
   * the batch as a sequence, not as pairs - but the boundary is stated so nobody reads
   * the plan as pair-aware.
   */
  const firstPass = planSummary(threadOf(21), 0)
  assert.equal(firstPass.toSummarise.length, 11)
  assert.equal(firstPass.coversThroughSeq, 11)
  assert.equal(firstPass.toSummarise[firstPass.toSummarise.length - 1].seq, 11)
})

/* ================================================================== *
 * Where a pass may start
 * ================================================================== */

test('turns at or before the watermark are never planned a second time', () => {
  const plan = planSummary(threadOf(40), 20)
  assert.notEqual(plan, null)

  // Only what came after the stored summary: ten turns, and the watermark moves to
  // the thirtieth, which is the last one taken.
  assert.deepEqual(plan.toSummarise.map((row) => row.seq), [
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  ])
  assert.equal(plan.coversThroughSeq, 30)

  // The rule itself, rather than only the list above: nothing at or before the
  // watermark is planned again.
  for (const row of plan.toSummarise) {
    assert.ok(row.seq > 20, `turn ${row.seq} was planned but the stored summary already covers it`)
  }

  /*
   * The other half: a long thread whose uncovered turns fit the kept window plans
   * nothing at all. Length is not the question - what is left after the watermark is -
   * so a hundred-turn thread that was summarised at ninety costs nothing.
   */
  assert.equal(planSummary(threadOf(30), 20), null)
  assert.equal(planSummary(threadOf(100), 90), null)

  /*
   * A watermark that does not line up with a kept-window boundary is the real case,
   * because the ten kept turns shift with every pass. Four covered leaves thirty six
   * fresh turns (seq 5 to 40), ten are kept and twenty six are compressed, from the
   * fifth turn to the thirtieth.
   */
  const deep = planSummary(threadOf(40), 4)
  assert.equal(deep.toSummarise[0].seq, 5)
  assert.equal(deep.toSummarise.length, 26)
  assert.equal(deep.coversThroughSeq, 30)
  // The plan never reaches back over the watermark to make a round number of turns.
  assert.ok(deep.toSummarise.every((row) => row.seq > 4))
})

/* ================================================================== *
 * What the model reads
 * ================================================================== */

test('the batch reads the previous summary first, then each new turn numbered by its own sequence', () => {
  const previous = {
    threadId: THREAD_ID,
    text: 'Quotes go out on Fridays. The Tilley invoice is still open.',
    coversThroughSeq: 6,
    updatedAt: AT,
  }

  const plan = {
    toSummarise: [
      personSays(7, 'Which tasks are overdue?'),
      assistantSays(8, 'Three are overdue, and the Tilley quote is not sent.'),
      personSays(9, 'Move it to Friday.'),
    ],
    coversThroughSeq: 9,
  }

  const batch = summaryBatch(previous, plan)

  /*
   * The whole batch as one string. Three things are visible in it and none of them is
   * visible from an `includes` check: the previous summary is the first thing the
   * model reads, the turns follow in the order they were said, and the number in front
   * of each one is its sequence number rather than its position in this list.
   */
  assert.equal(batch, [
    'Summary so far:',
    'Quotes go out on Fridays. The Tilley invoice is still open.',
    '7. Person: Which tasks are overdue?',
    '8. Assistant: Three are overdue, and the Tilley quote is not sent.',
    '9. Person: Move it to Friday.',
  ].join('\n'))

  // The heading comes before every turn, so the turns cannot be read as part of the
  // summary the model was given.
  assert.equal(batch.split('\n')[0], 'Summary so far:')
  assert.ok(
    batch.indexOf('Summary so far:') < batch.indexOf('7. Person:'),
    'the heading is not ahead of the turns',
  )

  /*
   * The previous summary's text is carried whole and unnumbered, because it is not a
   * turn: it is a reading of turns the model is asked to carry forward. Numbering it
   * would put a number in the batch that no message owns.
   */
  assert.equal(batch.split('\n')[1], previous.text)
  assert.equal(batch.includes('1. Summary so far'), false)

  // The order of the turns is the order they were said, which is what makes the
  // numbers meaningful rather than decorative.
  assert.ok(batch.indexOf('7. Person:') < batch.indexOf('8. Assistant:'))
  assert.ok(batch.indexOf('8. Assistant:') < batch.indexOf('9. Person:'))

  /*
   * The assistant is labelled apart from the person. Without the label a summary of a
   * conversation reads as though everything in it was said by the business owner,
   * which is exactly the mistake the extraction pass refuses an item for.
   */
  assert.equal(batch.includes('Person: Which tasks are overdue?'), true)
  assert.equal(batch.includes('Assistant: Three are overdue'), true)
  assert.equal(batch.includes('Assistant: Move it to Friday.'), false)

  /*
   * A system turn is named as a system turn. A summary batch is not an attribution
   * record, but a turn the app inserted reading as something the person said is the
   * kind of drift that becomes a wrong answer two messages later.
   */
  const withSystem = summaryBatch(null, {
    toSummarise: [systemSays(4, 'Context supplied by the app.')],
    coversThroughSeq: 4,
  })
  assert.equal(withSystem, '4. System: Context supplied by the app.')
})

test('a first pass starts straight at the turns, with no empty heading above them', () => {
  const plan = {
    toSummarise: [
      personSays(1, 'Quotes go out on Fridays.'),
      assistantSays(2, 'Noted. Is the Tilley invoice out?'),
    ],
    coversThroughSeq: 2,
  }

  const batch = summaryBatch(null, plan)

  assert.equal(batch, [
    '1. Person: Quotes go out on Fridays.',
    '2. Assistant: Noted. Is the Tilley invoice out?',
  ].join('\n'))

  /*
   * No heading, and no blank first line where a heading would have been. A model that
   * read "Summary so far:" followed by nothing would be told the thread has a previous
   * summary which says nothing, and the first pass is the ordinary case for a thread
   * that has just outgrown the window.
   */
  assert.equal(batch.includes('Summary so far'), false)
  assert.equal(batch.startsWith('1. Person:'), true)
  assert.equal(batch.split('\n')[0].trim().length > 0, true)
  assert.equal(batch.split('\n').length, 2)

  // An empty plan says nothing at all rather than a lone heading. The guard against
  // storing that is the schema's, not this function's, and `planSummary` answering
  // null is what stops such a batch ever reaching a model in the first place.
  assert.equal(summaryBatch(null, { toSummarise: [], coversThroughSeq: 0 }), '')
  assert.equal(
    summaryBatch(
      { threadId: THREAD_ID, text: 'Only the summary.', coversThroughSeq: 6, updatedAt: AT },
      { toSummarise: [], coversThroughSeq: 6 },
    ),
    'Summary so far:\nOnly the summary.',
  )
})

/* ================================================================== *
 * The one function that writes
 * ================================================================== */

test('applying a summary writes exactly the thread, the trimmed text and the watermark, and answers with the stored row', () => {
  const repositories = summaryRepositories()

  const stored = applySummary(repositories, SCOPE, THREAD_ID, '  Quotes go out on Fridays.  ', 12)

  /*
   * Three fields and no others. A row id and an `updatedAt` belong to the store: a
   * caller that supplied them would be writing a row with a timestamp it invented, and
   * a stale summary would then look newer than the one it replaced.
   */
  assert.deepEqual(repositories.written, [
    { threadId: THREAD_ID, text: 'Quotes go out on Fridays.', coversThroughSeq: 12 },
  ])
  assert.deepEqual(Object.keys(repositories.written[0]).sort(), ['coversThroughSeq', 'text', 'threadId'])

  // The business travels with the write, because the row belongs to one business
  // inside one signed-in account and the repository scopes every statement by both.
  assert.deepEqual(repositories.scopes, [SCOPE])

  /*
   * The answer is the stored row rather than a copy of the input: `updatedAt` here is
   * the repository's own instant, which this function cannot know, so a value that came
   * back whole is the proof that the row was read back rather than rebuilt.
   */
  assert.deepEqual(stored, {
    threadId: THREAD_ID,
    text: 'Quotes go out on Fridays.',
    coversThroughSeq: 12,
    updatedAt: AT,
  })

  // Whitespace at either end goes, and only that: the words the model wrote are kept as
  // written, so a figure inside the text is not reflowed on the way to the database.
  applySummary(repositories, SCOPE, THREAD_ID, '\n\n  Hold the Tilley invoice.  \n', 13)
  assert.equal(repositories.written[1].text, 'Hold the Tilley invoice.')
  assert.equal(repositories.written[1].text.trim(), repositories.written[1].text)

  // A watermark far into a long thread is passed through unchanged: the sequence number
  // is the caller's, and this function does not recompute it from anything.
  applySummary(repositories, SCOPE, THREAD_ID, 'Later reading.', 412)
  assert.equal(repositories.written[2].coversThroughSeq, 412)
  assert.equal(repositories.written[2].threadId, THREAD_ID)
  assert.equal(repositories.written.length, 3)
})

/* ================================================================== *
 * What may come back
 * ================================================================== */

test('the summary schema refuses an empty answer, an answer past the cap and a field the row does not hold', () => {
  // The well-formed answer first, so every refusal below is a refusal of one thing.
  const good = { summary: 'Quotes go out on Fridays. The Tilley invoice is still open.' }
  assert.equal(summaryReplySchema.safeParse(good).success, true)
  assert.deepEqual(summaryReplySchema.parse(good), good)

  // An empty summary is the model answering nothing. Storing it would tell the context
  // builder that the older half of the thread had been read when it had not.
  assert.equal(summaryReplySchema.safeParse({ summary: '' }).success, false)
  // A missing field, a body that is not an object and a number where the text belongs
  // are the same refusal from three directions.
  assert.equal(summaryReplySchema.safeParse({}).success, false)
  assert.equal(summaryReplySchema.safeParse(null).success, false)
  assert.equal(summaryReplySchema.safeParse({ summary: 7 }).success, false)

  /*
   * The cap is inclusive and is the schema's own limit: exactly MAX_SUMMARY_TEXT
   * characters are allowed and one more is refused. The over-long case is a run of
   * characters with no prose in it at all, which is what a model writes when it decides
   * to be thorough instead of short, and length is the only rule this schema owns.
   */
  assert.equal(MAX_SUMMARY_TEXT, 4_000)
  assert.equal(summaryReplySchema.safeParse({ summary: 'a'.repeat(MAX_SUMMARY_TEXT) }).success, true)
  assert.equal(summaryReplySchema.safeParse({ summary: 'a'.repeat(MAX_SUMMARY_TEXT + 1) }).success, false)

  /*
   * An extra field is refused rather than ignored. `coversThroughSeq` is the one that
   * matters: a model that read the batch number and offered its own watermark would
   * otherwise be deciding how much of the thread the app may skip. The watermark is the
   * plan's, and the repository refuses a rewrite below the stored one.
   */
  assert.equal(summaryReplySchema.safeParse({ ...good, coversThroughSeq: 12 }).success, false)
  assert.equal(summaryReplySchema.safeParse({ ...good, threadId: THREAD_ID }).success, false)

  /*
   * A whitespace-only answer is refused here, not later. `applySummary` trims before
   * it writes, so without the trim in the schema an answer of three spaces passed as
   * "not empty" and then reached the repository as "", which is one trim short of the
   * emptiness rule the schema states.
   */
  assert.equal(summaryReplySchema.safeParse({ summary: '   ' }).success, false)
  assert.equal('   '.trim().length, 0)
})

/* ================================================================== *
 * What the prompt asks for
 * ================================================================== */

test('the prompt asks for JSON only and forbids inventing or rounding a figure', () => {
  /*
   * The two instructions a summary cannot survive without. A reply in prose is thrown
   * away as a schema mismatch after the call has been paid for, and a rounded figure is
   * the failure a business notices: a quote of 450,000 coming back as "about half a
   * million" is a different quote, and the assistant will repeat it confidently.
   */
  assert.equal(SUMMARY_PROMPT.includes('Answer with JSON only'), true)
  assert.equal(
    SUMMARY_PROMPT.includes('Do not invent, and do not round a figure you were given.'),
    true,
  )
  // The rounding rule is stated about a figure somebody gave, not about arithmetic in
  // general: a summary may do no sums and must not appear to have done one.
  assert.equal(/do not round a figure/i.test(SUMMARY_PROMPT), true)
  assert.equal(/keep[^.]*any figure or date/i.test(SUMMARY_PROMPT), true)

  /*
   * The shape the model is shown is the shape the schema parses, and the example is
   * itself a payload the schema accepts. A model that echoes the example verbatim is
   * then refused for what it said rather than for a shape it was invited to copy.
   */
  const example = SUMMARY_PROMPT.slice(SUMMARY_PROMPT.indexOf('{"summary"'))
  assert.equal(example, '{"summary":"..."}')
  assert.deepEqual(JSON.parse(example), { summary: '...' })
  assert.equal(summaryReplySchema.safeParse(JSON.parse(example)).success, true)
  assert.equal(summaryReplySchema.safeParse({ summary: example }).success, true)

  // The length the prompt states and the cap the schema enforces are the same promise
  // in two places, and a reader needs to see both.
  assert.equal(SUMMARY_PROMPT.includes('at most ten sentences'), true)

  // Plain text, because the row holds a sentence a person reads and the context builder
  // prefixes it with its own heading: markdown in here would be drawn as markdown.
  assert.equal(SUMMARY_PROMPT.includes('Write plain text'), true)

  /*
   * No provider and no address. This prompt is written once and sent to whichever model
   * the person chose, cloud or local, so naming one would be wrong on every other, and
   * an address in a prompt is how an endpoint ends up somewhere it was not meant to be.
   */
  const lowered = SUMMARY_PROMPT.toLowerCase()
  for (const name of ['openai', 'anthropic', 'ollama', 'gemini', 'http://', 'https://']) {
    assert.equal(lowered.includes(name), false, `the prompt names ${name}`)
  }

  // The model is not asked for a watermark, which is the same rule the strict schema
  // enforces from the other side.
  assert.equal(SUMMARY_PROMPT.includes('coversThroughSeq'), false)
  // And nothing in it invites a fenced block, which the parser would refuse.
  assert.equal(SUMMARY_PROMPT.includes('```'), false)
})
