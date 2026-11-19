'use strict'

/*
 * What the assistant is allowed to remember, proven through the bundle Electron
 * loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS
 * the main process runs. A test against a separately compiled copy would agree with
 * this file about the rules while the shipped code did something else.
 *
 * Nothing here opens a database, reaches a provider or needs a key. `applyExtraction`
 * is a function of a batch of rows, an item list and the memory repository, so the
 * repository below is a hand-built object that records every write. That is what
 * makes "nothing was stored" checkable rather than assumed: this file asserts both
 * that a write happened and that one did not, which is the half a passing test of the
 * happy path always misses.
 *
 * Three promises are checked, and each is one a person relies on.
 *
 * - Traceability. Every stored item names the message it came from, and a citation
 *   resolves by the sequence number the prompt asked for rather than by array
 *   position. An item citing a number the batch never contained is dropped, because
 *   a remembered claim nobody can point at is an opinion the app formed.
 * - Only the person's words. An item sourced from an assistant turn is dropped, which
 *   is the rule that stops the model's own suggestion from becoming a decision the
 *   moment it is repeated back.
 * - Nothing is learned twice. Three guards, three different ways the same thing
 *   arrives again: twice in one answer, once from another message, and a second pass
 *   over a message that already produced an item of that kind. The last one is what
 *   makes a hand edit stick.
 *
 * Two things are recorded here as they behave rather than as they would be nicer to
 * behave, because both are visible from outside the module and both would leave the
 * next person guessing:
 *
 * 1. `normaliseItem` keys an item by its sentence alone, so the same words offered a
 *    second time under another kind are `already_known`. See the group about duplicates.
 * 2. `numberedBatch` labels every turn that is not the assistant "Person", including a
 *    system turn, while `applyExtraction` refuses an item sourced from one. The
 *    citation is dropped rather than stored, which is the safe half of the
 *    disagreement, but it is a disagreement. See the group about where an item may
 *    come from.
 *
 * One limit this file cannot prove and does not pretend to: the repository's `list`
 * answers at most the newest two hundred items, so the "already known" guards only see
 * that window. A business that has accumulated more than that can be told the same
 * sentence again. It is a repository cap plus a service that reads one page, so it
 * belongs in the test that opens a database, not here.
 *
 * No timestamps are compared anywhere: every fixture shares one instant, because these
 * rules are about text and ids rather than about a clock.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/**
 * What this file needs the bundle to export, and what each thing must be.
 *
 * Checked once at load: a missing export is a wiring gap in the main entry, and saying
 * so once is clearer than every test failing with "not a function". The two limits are
 * numbers rather than functions, and the schema tests below use them instead of
 * repeating the literals, so a cap that moves is a smaller change to this file than it
 * would be otherwise.
 */
const REQUIRED_EXPORTS = {
  applyExtraction: 'function',
  extractedMemorySchema: 'object',
  normaliseItem: 'function',
  numberedBatch: 'function',
  EXTRACTION_PROMPT: 'string',
  MAX_ITEMS: 'number',
  MAX_ITEM_TEXT: 'number',
}

for (const [name, type] of Object.entries(REQUIRED_EXPORTS)) {
  assert.equal(
    typeof api[name],
    type,
    `${name} is not exported by the main bundle (run npm run build:main)`,
  )
}

const {
  applyExtraction,
  extractedMemorySchema,
  normaliseItem,
  numberedBatch,
  EXTRACTION_PROMPT,
  MAX_ITEMS,
  MAX_ITEM_TEXT,
} = api

/** The conversation every fixture in this file belongs to. */
const THREAD_ID = 't1a2b3c4'

/** One instant every fixture shares: these rules are about text and ids, not time. */
const AT = '2026-11-16T09:30:00.000Z'

/** The business a pass is working in. The second one only appears as a foreign id. */
const SCOPE = { serverHost: 'zuri.example.test', userId: 7, businessId: 'b1' }

/** The four kinds, written out here as a second statement of the storage vocabulary. */
const KINDS = Object.freeze(['decision', 'fact', 'assumption', 'open_question'])

/* ------------------------------------------------------------------ *
 * Rows, in the storage contract's own shapes
 * ------------------------------------------------------------------ */

/** A stored message's id, derived from its sequence number so a citation is readable. */
function messageId (seq) {
  return `m000${String(seq).padStart(4, '0')}`
}

/**
 * One stored message.
 *
 * `provider`, `model` and `cloud` are null because this is a person's own turn:
 * inventing an attribution for a question would misreport the chip the screen draws.
 * Nothing in an extraction pass reads those fields, and the nulls are here so every
 * fixture is a row the contract would accept.
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

/** A turn the person took, numbered the way the prompt asks an item to cite it. */
function personSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'user', content })
}

/** A turn the assistant took. It is in the batch as context, never as knowledge. */
function assistantSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'assistant', content })
}

/** A turn the app or the thread setup inserted. Neither the person nor the model. */
function systemSays (seq, content) {
  return messageRow({ id: messageId(seq), seq, role: 'system', content })
}

/**
 * One remembered item, as the memory repository returns it.
 *
 * The default is an item the last extraction stored: `origin: 'ai'` and unlocked. An
 * edited item overrides all three of the fields a correction changes, and the group
 * about hand edits does so explicitly.
 */
function memoryRow (overrides = {}) {
  return {
    id: 'a0000001',
    kind: 'decision',
    text: 'Quotes go out on Fridays.',
    sourceMessageId: null,
    origin: 'ai',
    locked: false,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  }
}

/** One item of the model's answer, in the shape the schema accepts. */
function item (kind, text, source) {
  return { kind, text, source }
}

/* ------------------------------------------------------------------ *
 * A memory repository that records instead of storing
 * ------------------------------------------------------------------ */

/**
 * The one repository an extraction pass touches.
 *
 * `list` answers what has been stored so far and records the scope it was asked
 * about, because a pass that read another business's memory would dedupe against rows
 * that business never had. `add` records the input it was given before answering with
 * the row it would have written, and pushes that row into `existing` so a second pass
 * over the same conversation sees what the first one stored.
 *
 * `refuse` stands in for the repository's own checks: the ownership check that refuses
 * a source message belonging to another business, a column constraint, a row that fails
 * its schema. The real `add` raises `StorageError` for those, and this file throws a
 * plain `Error` on purpose: a pass that only contained one error class would let a
 * constraint failure take down a conversation.
 *
 * `list` and `listRemoved` answer two separate lists, exactly as the real repository
 * does: live items and tombstones. A fake that answered both from one list could not
 * show that a removed item blocks the same sentence without also putting that item in
 * the panel's own listing.
 */
function memoryRepositories (options = {}) {
  const existing = [...(options.existing ?? [])]
  const removed = [...(options.removed ?? [])]
  const written = []
  const listedScopes = []
  const removedScopes = []
  const addScopes = []
  const refuse = options.refuse

  return {
    memory: {
      list (scope) {
        listedScopes.push(scope)
        return existing.slice()
      },
      listRemoved (scope) {
        removedScopes.push(scope)
        return removed.slice()
      },
      add (scope, input) {
        addScopes.push(scope)
        if (refuse !== undefined && refuse(input)) {
          throw new Error('the repository refused this row')
        }
        written.push(input)
        const row = {
          id: `a000${String(written.length).padStart(4, '0')}`,
          kind: input.kind,
          text: input.text,
          sourceMessageId: input.sourceMessageId ?? null,
          origin: input.origin ?? 'ai',
          locked: false,
          createdAt: AT,
          updatedAt: AT,
        }
        existing.push(row)
        return row
      },
    },

    /* What the assertions read. */
    existing,
    removed,
    written,
    listedScopes,
    removedScopes,
    addScopes,
  }
}

/* ================================================================== *
 * A well-formed answer
 * ================================================================== */

test('a well-formed answer stores each item, attributed to its own kind of source', () => {
  const batch = [
    personSays(1, 'We decided to hold the Tilley invoice until Friday.'),
    assistantSays(2, 'Noted. Is there anything else on it?'),
    personSays(3, 'The rebrand budget is five million naira.'),
  ]

  const repositories = memoryRepositories()
  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('decision', '  Hold the Tilley invoice until Friday.  ', 1),
      item('fact', 'The rebrand budget is five million naira.', 3),
    ],
  })

  assert.equal(result.added, 2)
  // No reason keys at all on a clean pass: a `dropped` map that always held zeroes
  // would make "something was refused" indistinguishable from "nothing was".
  assert.deepEqual(result.dropped, {})

  /*
   * Exactly the two rows, in the order the answer gave them. Pinned as whole objects
   * rather than field by field, because a pass that added an id of its own or a guessed
   * timestamp would be inventing a row the repository is the only thing allowed to
   * create, and that would pass a field-by-field check.
   */
  assert.equal(repositories.written.length, 2)
  assert.deepEqual(repositories.written, [
    {
      kind: 'decision',
      text: 'Hold the Tilley invoice until Friday.',
      sourceMessageId: messageId(1),
      origin: 'ai',
    },
    {
      kind: 'fact',
      text: 'The rebrand budget is five million naira.',
      sourceMessageId: messageId(3),
      origin: 'ai',
    },
  ])

  // The leading and trailing spaces are gone, and only those: the row holds what the
  // model wrote rather than a rewritten sentence, so nothing inside the text moved.
  assert.equal(repositories.written[0].text, 'Hold the Tilley invoice until Friday.')
  assert.equal(repositories.written[0].text.trim(), repositories.written[0].text)

  // Every row is filed under the business scope the pass was given, and the existing
  // items were read once, before any write.
  assert.deepEqual(repositories.addScopes, [SCOPE, SCOPE])
  assert.deepEqual(repositories.listedScopes, [SCOPE])

  // The answer is the two numbers and nothing else: no items echoed back, no error text.
  assert.deepEqual(Object.keys(result).sort(), ['added', 'dropped'])

  /*
   * The batch the model reads: one line per message, prefixed with the sequence number
   * an item is asked to cite and labelled with who spoke. That label is how the model
   * is meant to tell the person's own words from the assistant's, which is the rule the
   * third group enforces from the other side.
   */
  assert.deepEqual(numberedBatch(batch), [
    '1. Person: We decided to hold the Tilley invoice until Friday.',
    '2. Assistant: Noted. Is there anything else on it?',
    '3. Person: The rebrand budget is five million naira.',
  ])

  /*
   * And the instruction asks for exactly what the schema accepts. A prompt naming a
   * kind the enum refuses, or a shape with a field the parser rejects, would produce a
   * correct answer that is thrown away as `malformed` on every single conversation.
   */
  for (const kind of KINDS) {
    assert.equal(EXTRACTION_PROMPT.includes(kind), true, `the prompt never names the ${kind} kind`)
  }
  assert.equal(
    EXTRACTION_PROMPT.includes('kind is one of: decision, fact, assumption, open_question.'),
    true,
  )
  assert.equal(EXTRACTION_PROMPT.includes('Answer with JSON only'), true)
  // Without this the model answers inside a code fence and the parse fails.
  assert.equal(EXTRACTION_PROMPT.includes('no code fence'), true)
  // The cap the schema enforces, stated to the model so it is not guessing at it.
  assert.equal(EXTRACTION_PROMPT.includes(`at most ${MAX_ITEMS} items`), true)
  // The rule the not_the_person guard enforces when the model ignores it.
  assert.equal(EXTRACTION_PROMPT.includes('Do not record anything the assistant suggested'), true)
  // The three fields, in the shape the schema parses.
  assert.equal(
    EXTRACTION_PROMPT.includes('{"items":[{"kind":"decision","text":"one short sentence","source":3}]}'),
    true,
  )
})

/* ================================================================== *
 * Where an item may come from
 * ================================================================== */

test('an item citing a number the batch does not contain is dropped, and a citation resolves by sequence number', () => {
  /*
   * A batch is the tail of a thread, so its sequence numbers start wherever the thread
   * got to. These two rows sit at four and five, and they are given out of order: an
   * implementation that resolved `source` as an array index would land on the wrong row
   * for every batch that is not the whole thread from turn one, and would silently drop
   * correct citations on a tail.
   */
  const batch = [
    personSays(5, 'The studio is in Abuja.'),
    personSays(4, 'Quotes go out on Fridays.'),
  ]

  const repositories = memoryRepositories()
  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('fact', 'The client prefers email.', 3),
      item('decision', 'Deposits are half up front.', 9),
    ],
  })

  // A citation nothing in the batch answers is the model pointing at a message it was
  // never given. Storing it would mean the item could not be shown next to the words
  // that produced it, which is the whole reason an item carries a source at all.
  assert.equal(result.added, 0)
  assert.deepEqual(result.dropped, { unknown_source: 2 })
  assert.deepEqual(repositories.written, [])

  // The same rows, cited correctly, land on the message that owns the number: turn four
  // is the *second* line of the batch, so position and sequence are distinguishable here.
  const again = memoryRepositories()
  const resolved = applyExtraction(again, SCOPE, batch, {
    items: [item('decision', 'Quotes go out on Fridays.', 4)],
  })

  assert.equal(resolved.added, 1)
  assert.deepEqual(resolved.dropped, {})
  assert.equal(again.written.length, 1)
  assert.equal(again.written[0].sourceMessageId, messageId(4))
  // Not the id of the first line of the batch, which is what an index lookup would use.
  assert.notEqual(again.written[0].sourceMessageId, messageId(5))
})

test('an item sourced from the assistant, or from a system turn, is dropped and only the person is stored', () => {
  const batch = [
    personSays(1, 'Hold the Tilley invoice until Friday.'),
    assistantSays(2, 'You could raise the price by ten percent.'),
    systemSays(3, 'Context supplied by the app.'),
  ]

  const repositories = memoryRepositories()
  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('decision', 'Raise the price by ten percent.', 2),
      item('fact', 'The app supplied context.', 3),
      item('decision', 'Hold the Tilley invoice until Friday.', 1),
    ],
  })

  // One item stored, from the person's turn, and the other two refused one at a time: a
  // pass that refused the whole answer because one citation was the assistant's would
  // lose the two things the person did say.
  assert.equal(result.added, 1)
  assert.deepEqual(result.dropped, { not_the_person: 2 })
  assert.equal(repositories.written.length, 1)
  assert.equal(repositories.written[0].sourceMessageId, messageId(1))

  /*
   * The suggestion is not stored under any wording. This is the rule the phase exists
   * for: an assistant that offers an idea and then remembers it as a decision has put
   * words in the business's mouth, and the next conversation would open with the app
   * asserting something nobody agreed to.
   */
  assert.deepEqual(repositories.written.map((input) => input.text), ['Hold the Tilley invoice until Friday.'])
  assert.equal(repositories.existing.some((row) => row.text.includes('ten percent')), false)

  /*
   * A system turn is named as a system turn, not folded in with the person.
   *
   * The two roles are separate because the extractor refuses an item sourced from
   * anything but the person's own words: labelling a system turn "Person" invited
   * exactly the citation it then had to throw away, which is a prompt that works
   * against itself.
   */
  assert.equal(
    numberedBatch([systemSays(3, 'Context supplied by the app.')])[0],
    '3. System: Context supplied by the app.',
  )
})

/* ================================================================== *
 * Nothing is learned twice
 * ================================================================== */

test('the same sentence is stored once, whether it comes back in a later pass or twice in one answer', () => {
  const batch = [
    personSays(1, 'Quotes go out on Fridays.'),
    personSays(2, 'The studio is in Abuja.'),
  ]
  const extraction = { items: [item('decision', 'Quotes go out on Fridays.', 1)] }

  const repositories = memoryRepositories()
  const first = applyExtraction(repositories, SCOPE, batch, extraction)
  assert.equal(first.added, 1)
  assert.deepEqual(first.dropped, {})
  assert.equal(repositories.written.length, 1)

  /*
   * The same pass run again over the same conversation, which is what a re-open, a
   * retry or a second window does. The repository lists what it stored, so the guard
   * sees the row; without that read every re-run would double the memory panel.
   */
  const second = applyExtraction(repositories, SCOPE, batch, extraction)
  assert.equal(second.added, 0)
  assert.deepEqual(second.dropped, { already_known: 1 })
  assert.equal(repositories.written.length, 1, 'the second pass wrote a second row')
  assert.equal(repositories.existing.length, 1)

  /*
   * The same sentence twice inside one answer, twice over: once with different
   * typography and once from another message. Both are the same claim, so both are
   * dropped; a guard that only compared exact strings would store the capitalised
   * version and the panel would read like it was stuttering.
   */
  const oneAnswer = memoryRepositories()
  const twice = applyExtraction(oneAnswer, SCOPE, batch, {
    items: [
      item('fact', 'The studio is in Abuja.', 1),
      item('fact', '  the studio is in Abuja  ', 1),
      item('fact', 'The Studio is in Abuja', 2),
    ],
  })

  assert.equal(twice.added, 1)
  assert.deepEqual(twice.dropped, { already_known: 2 })
  assert.equal(oneAnswer.written.length, 1)

  /*
   * And the recorded boundary: the comparison key is the sentence alone, so the same
   * words offered again under another kind are already known. Recorded as it behaves.
   * Whether "the studio is in Abuja" said as an assumption should sit beside the same
   * sentence said as a fact is a product decision, and today it does not, which is
   * defensible: it is the same claim either way.
   */
  const otherKind = memoryRepositories()
  const asTwoKinds = applyExtraction(otherKind, SCOPE, batch, {
    items: [
      item('fact', 'The studio is in Abuja.', 1),
      item('assumption', 'The studio is in Abuja.', 2),
    ],
  })
  assert.equal(asTwoKinds.added, 1)
  assert.deepEqual(asTwoKinds.dropped, { already_known: 1 })
})

test('one message yields one item of a kind, and a hand-edited item still blocks the wording it replaced', () => {
  const batch = [
    personSays(1, 'The studio is in Abuja. There are three rooms. Quotes go out on Fridays.'),
  ]

  const repositories = memoryRepositories()
  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('fact', 'The studio is in Abuja.', 1),
      item('fact', 'The studio has three rooms.', 1),
      item('assumption', 'The Abuja studio is the only one.', 1),
    ],
  })

  /*
   * Two of the three are stored, because the key is the kind plus the message, not the
   * message alone. One message genuinely carries a fact and an assumption, and refusing
   * the second on the grounds that the first existed would lose what the person said.
   */
  assert.equal(result.added, 2)
  assert.deepEqual(result.dropped, { same_source: 1 })
  assert.deepEqual(repositories.written.map((input) => input.kind), ['fact', 'assumption'])
  assert.deepEqual(repositories.written.map((input) => input.sourceMessageId), [messageId(1), messageId(1)])

  /*
   * The same conversation after a person corrected one item by hand. An edit rewrites
   * the wording, marks the item as theirs and locks it, and it keeps the two fields that
   * identify where the claim came from: the kind and the message. That pair is what the
   * next pass is matched against, so the row the person rewrote cannot be added again
   * under the model's original wording.
   */
  const corrected = memoryRow({
    id: 'a0000001',
    kind: 'decision',
    text: 'Quotes go out on Thursday.',
    sourceMessageId: messageId(1),
    origin: 'user',
    locked: true,
  })
  const afterEdit = memoryRepositories({ existing: [corrected] })
  const retried = applyExtraction(afterEdit, SCOPE, batch, {
    items: [item('decision', 'Quotes go out on Fridays.', 1)],
  })

  assert.equal(retried.added, 0)
  /*
   * Not `already_known`: the row no longer holds this wording, so the text check has
   * nothing to match. The source key is what catches it, and that is the point of
   * having it as a separate guard rather than relying on the text alone.
   */
  assert.deepEqual(retried.dropped, { same_source: 1 })
  assert.deepEqual(afterEdit.written, [])

  // The correction is untouched: no row was added, and no row was rewritten in place.
  assert.equal(afterEdit.existing.length, 1)
  assert.equal(afterEdit.existing[0].text, 'Quotes go out on Thursday.')
  assert.equal(afterEdit.existing[0].origin, 'user')
  assert.equal(afterEdit.existing[0].locked, true)
})

test('an item the person removed is not learned again from the message it came from', () => {
  /*
   * The deletion half of the same promise. An edit keeps its row, so the source guard
   * catches a later pass by itself. A removal keeps nothing but a tombstone, and a
   * listing that hides tombstones would leave the model free to store the sentence
   * again the next time the thread is re-read - which is a housekeeping step the person
   * never asked for, quietly undoing a choice they made.
   */
  const batch = [personSays(1, 'The quote moves to Friday. There is no deposit.')]

  const removed = memoryRow({
    id: 'a0000001',
    kind: 'decision',
    text: 'The quote moves to Friday.',
    sourceMessageId: messageId(1),
    origin: 'ai',
    locked: false,
  })
  const afterRemoval = memoryRepositories({ removed: [removed] })

  const offered = { items: [item('decision', 'The quote moves to Friday.', 1)] }
  const again = applyExtraction(afterRemoval, SCOPE, batch, offered)

  assert.equal(again.added, 0, 'a removed item was written back')
  // The wording guard is what catches the same sentence: the tombstone still holds the
  // text it was given, so the comparison key matches.
  assert.deepEqual(again.dropped, { already_known: 1 })
  assert.deepEqual(afterRemoval.written, [])
  assert.deepEqual(afterRemoval.existing, [], 'the removed item reappeared in the panel list')

  /*
   * And the wording is not the only guard. A model that re-offers the claim in its own
   * words would slip past a text-only check, so the tombstone is matched by kind and
   * source message as well: this is the half that stops the same message producing the
   * same kind of item a second time, however the sentence is phrased.
   */
  const reworded = applyExtraction(afterRemoval, SCOPE, batch, {
    items: [item('decision', 'The quote slides to Friday.', 1)],
  })
  assert.equal(reworded.added, 0)
  assert.deepEqual(reworded.dropped, { same_source: 1 })
  assert.deepEqual(afterRemoval.written, [])

  /*
   * The tombstone was read from its own list, not from the live one. Recording the
   * scopes shows the pass asked this business for its removals rather than answering
   * from another business's rows.
   */
  assert.deepEqual(afterRemoval.listedScopes, [SCOPE, SCOPE])
  assert.deepEqual(afterRemoval.removedScopes, [SCOPE, SCOPE])

  /*
   * A removal blocks the wording it held, not the whole message: a different claim from
   * the same turn is still learned, so taking one item back does not silence the rest of
   * what the person said.
   */
  const rest = applyExtraction(afterRemoval, SCOPE, batch, {
    items: [item('fact', 'There is no deposit.', 1)],
  })
  assert.equal(rest.added, 1)
  assert.deepEqual(rest.dropped, {})
})

/* ================================================================== *
 * Another business's message
 * ================================================================== */

test('a message id belonging to another business cannot become a stored item', () => {
  /*
   * A message row carries no business id, so this pass cannot tell whose message it is
   * looking at: the batch it is handed is the caller's claim about what this business
   * said. What stops a foreign id is the repository's ownership check, which refuses a
   * memory row whose source message is not in this business, so `refuse` below stands in
   * for that check and the assertions are about what the pass does with the refusal: it
   * counts it and stores nothing.
   */
  const ownMessages = new Set([messageId(1)])
  const repositories = memoryRepositories({
    refuse: (input) => input.sourceMessageId !== null && !ownMessages.has(input.sourceMessageId),
  })

  // The second row is another business's conversation, reached by a batch that should
  // never have contained it.
  const batch = [
    personSays(1, 'The studio is in Abuja.'),
    messageRow({ id: 'm9000001', seq: 2, role: 'user', content: 'Tijha Books ships on Mondays.' }),
  ]

  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('fact', 'Tijha Books ships on Mondays.', 2),
      item('fact', 'The studio is in Abuja.', 1),
    ],
  })

  // One item stored, the one from this business's own message, and one refused.
  assert.equal(result.added, 1)
  assert.deepEqual(result.dropped, { refused: 1 })
  assert.deepEqual(repositories.written.map((input) => input.sourceMessageId), [messageId(1)])

  // The other business's sentence is nowhere: not stored, and not recorded as seen.
  assert.equal(repositories.existing.length, 1)
  assert.equal(repositories.existing.some((row) => row.text === 'Tijha Books ships on Mondays.'), false)

  /*
   * The ordinary route in which a foreign id is no threat at all: an id that is not in
   * the batch is a citation to nothing. The pass resolves citations against the rows it
   * was given, so a foreign id can only matter if the caller put the row itself in the
   * batch, which is the case above.
   */
  const unnamed = memoryRepositories()
  const unknown = applyExtraction(unnamed, SCOPE, [personSays(1, 'The studio is in Abuja.')], {
    items: [item('fact', 'Tijha Books has two staff.', 9_000_001)],
  })
  assert.equal(unknown.added, 0)
  assert.deepEqual(unknown.dropped, { unknown_source: 1 })
  assert.deepEqual(unnamed.written, [])
})

/* ================================================================== *
 * A refusal from below
 * ================================================================== */

test('a repository that refuses a row is counted, and the rest of the answer is still stored', () => {
  const batch = [
    personSays(1, 'The studio is in Abuja, three rooms, and quotes go out on Fridays.'),
  ]

  const refusedTexts = new Set(['The studio is in Abuja.', 'The client prefers email.'])
  const repositories = memoryRepositories({ refuse: (input) => refusedTexts.has(input.text) })

  const result = applyExtraction(repositories, SCOPE, batch, {
    items: [
      item('fact', 'The studio is in Abuja.', 1),
      item('decision', 'Quotes go out on Fridays.', 1),
      item('assumption', 'The client prefers email.', 1),
    ],
  })

  /*
   * The middle item survives. A pass that let one refusal end the loop would answer with
   * the first failure and lose every later item, which on a long answer is most of what
   * the person said.
   */
  assert.equal(result.added, 1)
  assert.deepEqual(result.dropped, { refused: 2 })
  assert.deepEqual(repositories.written.map((input) => input.text), ['Quotes go out on Fridays.'])

  /*
   * A refusal is reported as a count and a fixed word, never as the error and never as
   * the row: an error message here is a database message, and a database message can
   * quote a bound value, which is a sentence somebody typed.
   */
  assert.deepEqual(Object.keys(result).sort(), ['added', 'dropped'])
  for (const reason of Object.keys(result.dropped)) {
    assert.equal(/^[a-z_]+$/.test(reason), true, `the reason "${reason}" is not a fixed token`)
  }
  assert.equal(JSON.stringify(result).includes('Abuja'), false)
  assert.equal(JSON.stringify(result).includes('refused this row'), false)

  // And nothing half-written is left behind: the counts are the whole account of the pass.
  assert.equal(repositories.existing.length, 1)
})

/* ================================================================== *
 * The answer's own shape
 * ================================================================== */

test('the answer schema refuses what the pass could not store, and normalisation is what makes two spellings one item', () => {
  const one = (overrides) => ({ items: [{ kind: 'fact', text: 'The studio is in Abuja.', source: 1, ...overrides }] })

  // The happy shape, so every refusal below is a refusal of one field and not of the
  // fixture.
  assert.equal(extractedMemorySchema.safeParse(one({})).success, true)
  // An empty answer is the ordinary case for a conversation that settled nothing.
  assert.equal(extractedMemorySchema.safeParse({ items: [] }).success, true)

  // A kind outside the storage vocabulary. The four kinds are the contract's list, so a
  // fifth would be a row the memory screen has no place to draw.
  for (const kind of ['suggestion', 'Decision', 'open-question', '']) {
    assert.equal(
      extractedMemorySchema.safeParse(one({ kind })).success,
      false,
      `the schema accepted the kind ${JSON.stringify(kind)}`,
    )
  }
  // The other half, so the refusals above are about the list and not about the field.
  for (const kind of KINDS) {
    assert.equal(extractedMemorySchema.safeParse(one({ kind })).success, true, `the schema refused ${kind}`)
  }

  /*
   * The cap, from both sides. A maximum that is never reached is untested, and a maximum
   * that is off by one is a conversation whose answer is thrown away entirely rather
   * than trimmed.
   */
  const itemsOfCount = (count) => ({
    items: Array.from({ length: count }, (_, index) => ({
      kind: 'fact',
      text: `Fact number ${index + 1}.`,
      source: 1,
    })),
  })
  assert.equal(extractedMemorySchema.safeParse(itemsOfCount(MAX_ITEMS)).success, true)
  assert.equal(extractedMemorySchema.safeParse(itemsOfCount(MAX_ITEMS + 1)).success, false)

  // The text bounds, from both sides: a fragment too short to be a sentence is refused,
  // and so is a transcript.
  assert.equal(extractedMemorySchema.safeParse(one({ text: 'ab' })).success, false)
  assert.equal(extractedMemorySchema.safeParse(one({ text: 'abc' })).success, true)
  assert.equal(extractedMemorySchema.safeParse(one({ text: 'x'.repeat(MAX_ITEM_TEXT) })).success, true)
  assert.equal(extractedMemorySchema.safeParse(one({ text: 'x'.repeat(MAX_ITEM_TEXT + 1) })).success, false)

  /*
   * The source is a sequence number, so a fraction, a negative and a string are all
   * citations that could never match a row. Accepting any of them would turn a model's
   * slip into an `unknown_source` drop later rather than a refused answer now, and the
   * difference matters: one is retried, the other is a bug in a conversation.
   */
  for (const source of [1.5, -1, '1', null]) {
    assert.equal(
      extractedMemorySchema.safeParse(one({ source })).success,
      false,
      `the schema accepted the source ${JSON.stringify(source)}`,
    )
  }
  assert.equal(extractedMemorySchema.safeParse({ items: [{ kind: 'fact', text: 'abc' }] }).success, false)

  /*
   * Unknown keys are refused at both levels. A confident-looking extra field is how a
   * provider's own wrapper (`{"items":..., "model":"..."}`) arrives, and silently
   * ignoring it means the app accepts an answer it does not fully understand.
   */
  assert.equal(extractedMemorySchema.safeParse({ items: [], extra: true }).success, false)
  assert.equal(extractedMemorySchema.safeParse({ items: [], model: 'x' }).success, false)
  assert.equal(extractedMemorySchema.safeParse(one({ confidence: 0.9 })).success, false)
  // Nor is the top level a bare list: the shape is an object with one field.
  assert.equal(extractedMemorySchema.safeParse([{ kind: 'fact', text: 'abc', source: 1 }]).success, false)

  /*
   * `normaliseItem` is the comparison key, and it drops typography rather than meaning:
   * case, spacing and trailing punctuation are not part of the claim being made.
   */
  assert.equal(normaliseItem('Budget is 5m.'), normaliseItem('budget is  5m'))
  assert.equal(normaliseItem('Budget is 5m.'), 'budget is 5m')
  assert.equal(normaliseItem('  Quotes go out on Fridays!  '), 'quotes go out on fridays')
  assert.equal(normaliseItem('Quotes go out on Fridays;'), normaliseItem('quotes go out on fridays'))
  // Only the tail is treated as punctuation. A full stop inside the sentence separates
  // two claims and stays, so two different sentences cannot be folded into one.
  assert.equal(normaliseItem('Budget is 5m. Check it.'), 'budget is 5m. check it')
  // Whitespace with no words in it normalises to nothing, which is why the pass needs an
  // `empty` guard of its own: three spaces satisfy the schema's minimum length.
  assert.equal(normaliseItem('   '), '')
  assert.equal(normaliseItem('...'), '')
  assert.equal(extractedMemorySchema.safeParse(one({ text: '   ' })).success, true)

  const repositories = memoryRepositories()
  const result = applyExtraction(repositories, SCOPE, [personSays(1, 'Nothing was decided.')], {
    items: [item('fact', '   ', 1)],
  })
  assert.equal(result.added, 0)
  assert.deepEqual(result.dropped, { empty: 1 })
  assert.deepEqual(repositories.written, [])
})
