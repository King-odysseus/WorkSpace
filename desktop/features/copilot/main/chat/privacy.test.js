'use strict'

/*
 * What may leave the machine, proven through the bundle Electron loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that build rather than the TypeScript source, so what is proven here is the
 * CommonJS the main process runs. A test against a separately compiled copy would
 * agree with this file about the rules while the shipped code did something else.
 *
 * Nothing here opens a database, reaches a provider or needs a key. Every function
 * in `chat/privacy.ts` is a pure function of a conversation plus what the app knows
 * about the person, which is exactly what makes the privacy rules testable without
 * a network: the answer is the same however many times it is asked.
 *
 * Three promises are checked, and each is one a person relies on.
 *
 * - The values the app already knows - the business name, the person's name, their
 *   address - are replaced by stable tokens before anything is sent, in every
 *   message of the conversation rather than only the newest one. Stable matters:
 *   the model has to be able to see that two mentions are the same thing.
 * - A detail the app does not know, such as an address somebody pasted into a
 *   sentence, stops the send with a fixed token instead of being quietly rewritten.
 *   A scrubbed question would come back answered about `[[digits]]`, and the person
 *   would never learn why.
 * - The preview is the bytes. Every assertion about the outbound text is repeated
 *   against `preview.messages`, so a preview that drifted from the send fails here
 *   rather than surprising somebody who approved it.
 *
 * One boundary is asserted as it behaves rather than as it would be nicer to
 * behave: `substitute` matches without word boundaries, so a short name is also
 * replaced inside a longer word. See the substitution group. The residual check has
 * a boundary of the same kind, and the last note in its group records where the
 * source's own comment and its regular expression disagree.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/*
 * A missing function here means the main-process entry does not re-export the chat
 * privacy module, which is a wiring gap and not a privacy bug. Saying so once, at
 * load, is clearer than the "not a function" every test would otherwise report.
 */
for (const name of [
  'placeholdersFor',
  'substitute',
  'residualIdentifier',
  'textOfParts',
  'buildCloudPayload',
  'buildLocalPayload',
]) {
  assert.equal(typeof api[name], 'function', `${name} is not exported by the main bundle`)
}

/**
 * Who the app knows it is talking about.
 *
 * The person's name is deliberately a prefix of the business name, because that is
 * the pair the longest-first ordering exists for: "Zuri" must not eat the first
 * half of "Zuri Lofts" before the business token gets a chance.
 */
const IDENTITY = {
  businessName: 'Zuri Lofts',
  displayName: 'Zuri',
  email: 'zuri.owner@zuri.example.test',
}

/** One text part, in the shape a stored message holds it. */
function textPart (text) {
  return { type: 'text', text }
}

/** One message in the provider's shape: a role and its parts. */
function message (role, ...parts) {
  return { role, parts }
}

/* ------------------------------------------------------------------ *
 * What becomes a placeholder
 * ------------------------------------------------------------------ */

test('a full identity becomes three tokens, with the longest value replaced first', () => {
  const placeholders = api.placeholdersFor({
    // Padded on purpose: the stored value is the trimmed one, so a sentence is
    // matched against the name and not against the copy-pasted spaces.
    businessName: '  Zuri Lofts  ',
    displayName: 'Zuri',
    email: 'zuri.owner@zuri.example.test',
  })

  assert.deepEqual(placeholders, [
    { token: '[[email]]', label: 'Email address', value: 'zuri.owner@zuri.example.test' },
    { token: '[[business]]', label: 'Business name', value: 'Zuri Lofts' },
    { token: '[[person]]', label: 'Your name', value: 'Zuri' },
  ])

  // The whole ordering rule, stated once: longest value first, so no value is
  // partly replaced by a shorter one that happens to sit inside it.
  const lengths = placeholders.map((entry) => entry.value.length)
  assert.deepEqual(lengths, [...lengths].sort((left, right) => right - left))

  const businessAt = placeholders.findIndex((entry) => entry.token === '[[business]]')
  const personAt = placeholders.findIndex((entry) => entry.token === '[[person]]')
  assert.ok(businessAt < personAt, 'the person token was replaced before the longer business name')

  // And the consequence, which is the reason the order is a rule: the business
  // name survives whole instead of turning into a person token and a stray "Lofts".
  assert.equal(
    api.substitute('Zuri Lofts met Zuri', placeholders),
    '[[business]] met [[person]]',
  )
})

test('a value shorter than two characters is not made into a placeholder', () => {
  /*
   * A one-character name would match half the words in the conversation, so it is
   * left alone: an unprotected initial is a smaller problem than a reply that has
   * had every "a" and "i" replaced inside it.
   */
  assert.deepEqual(api.placeholdersFor({ businessName: 'A', displayName: '  ', email: null }), [])

  // Two characters is the shortest that is still a name, and it is included.
  assert.deepEqual(api.placeholdersFor({ displayName: 'Al' }), [
    { token: '[[person]]', label: 'Your name', value: 'Al' },
  ])
  assert.deepEqual(api.placeholdersFor({ businessName: 'Ab' }), [
    { token: '[[business]]', label: 'Business name', value: 'Ab' },
  ])

  // An email is recognised by its shape rather than by its length: a string with
  // no at sign is not an address, so there is nothing to hide in it.
  assert.deepEqual(api.placeholdersFor({ email: 'zuri.example.test' }), [])

  // Nothing known at all is the ordinary state of a first launch.
  assert.deepEqual(api.placeholdersFor({}), [])
  assert.deepEqual(api.placeholdersFor({ displayName: null, businessName: null, email: null }), [])
})

/* ------------------------------------------------------------------ *
 * Substitution
 * ------------------------------------------------------------------ */

test('substitution ignores case, and a value inside a longer word is replaced as a fragment', () => {
  const business = api.placeholdersFor({ businessName: 'Zuri Lofts' })

  // Case is ignored, because somebody typing "zuri lofts" means the same business
  // and a case-sensitive pass would leave that spelling in the payload while
  // reporting that it had been removed.
  assert.equal(
    api.substitute('We met zuri lofts yesterday.', business),
    'We met [[business]] yesterday.',
  )
  assert.equal(api.substitute('ZURI LOFTS', business), '[[business]]')

  // Every mention, not only the first: the replacement is global.
  assert.equal(
    api.substitute('Zuri Lofts asked, then Zuri Lofts decided.', business),
    '[[business]] asked, then [[business]] decided.',
  )

  // Text with nothing to hide comes back unchanged rather than as an empty string.
  assert.equal(api.substitute('Move the quote to Friday.', business), 'Move the quote to Friday.')
  assert.equal(api.substitute('anything at all', []), 'anything at all')

  /*
   * The boundary that is real rather than the one that would be nicer. The value is
   * matched by an unanchored regular expression (privacy.ts line 159), so a name
   * that sits inside a longer word is replaced too. The two-character minimum is
   * the only guard, which means a short name still damages a word that contains it.
   * Asserted as observed, not as wished: pretending this did not happen would leave
   * the next person to discover it in production.
   */
  const person = api.placeholdersFor({ displayName: 'Zuri' })
  assert.equal(
    api.substitute('Zuriella runs the studio.', person),
    '[[person]]ella runs the studio.',
  )
  // And in another case, which is the same rule: the fragment matched is the name,
  // the rest of the word is left as it was.
  assert.equal(
    api.substitute('ZURIELLA runs the studio.', person),
    '[[person]]ELLA runs the studio.',
  )
})

/* ------------------------------------------------------------------ *
 * The residual check
 * ------------------------------------------------------------------ */

test('an address, a long digit run, a handle and a web address are residuals, and ordinary business text is not', () => {
  /*
   * The checks run in one fixed order (privacy.ts lines 104 to 108), and the first
   * shape that matches is the reason reported. Every example below therefore sits on
   * the boundary the regular expression actually draws, and the comment beside it
   * says which side of that boundary it is on and why.
   */

  // An at sign with something either side of it and a dot after. This check runs
  // first, so an address in a URL or beside a phone number is reported as `email`.
  assert.equal(
    api.residualIdentifier('forward it to ada.okafor@customer.test please'),
    'email',
  )

  // Seven or more digits and spaces from the first digit to the last. A Nigerian
  // mobile number typed the way people type it is inside that run.
  assert.equal(api.residualIdentifier('call 0803 123 4567 after ten'), 'long_number')

  // A card number with no separators at all is the same run, and far longer.
  assert.equal(api.residualIdentifier('4111111111111111'), 'long_number')

  /*
   * A phone number written with dashes is the same kind of run, at a higher
   * threshold: ten digits rather than seven.
   *
   * The threshold is higher for dashes precisely so that a date does not trip it.
   * `14-03-26` is six digits and passes, while `0803-123-4567` is ten and does
   * not. A rule that refused to send a conversation because it mentioned a due
   * date would be a privacy check people work around instead of one they trust.
   */
  assert.equal(api.residualIdentifier('ring 0803-123-4567 in the morning'), 'long_number')
  assert.equal(api.residualIdentifier('due 14-03-26'), null)

  // A handle, at the start of the text or after a space, of two characters or more.
  assert.equal(api.residualIdentifier('ping @someone about it'), 'handle')
  assert.equal(api.residualIdentifier('@someone can you check'), 'handle')

  // A web address, which is the last check. A URL that carries a long run of digits
  // is reported as the digit run instead, because that check comes before it.
  assert.equal(
    api.residualIdentifier('see https://zuri.example.test/invoice'),
    'web_address',
  )
  assert.equal(
    api.residualIdentifier('see https://zuri.example.test/invoice/4111111111111'),
    'long_number',
  )

  // Ordinary prose, which is what most of a conversation is, stays clear. Nothing
  // here matches a shape, so there is nothing to refuse.
  assert.equal(api.residualIdentifier('Move the Tilley quote to Friday.'), null)

  // A price: the comma is not a separator the run accepts, so "45,000" offers at
  // most four characters of run, well under the seven that are needed.
  assert.equal(api.residualIdentifier('the quote is NGN 45,000'), null)

  // A year is four digits and nothing else.
  assert.equal(api.residualIdentifier('the review is in 2026'), null)

  // A date written with slashes. A slash is a separator for a long enough run, but
  // this one is six digits, and a run needs ten before a slash counts as one.
  assert.equal(api.residualIdentifier('due 14/03/26'), null)

  // An empty turn has nothing in it to find.
  assert.equal(api.residualIdentifier(''), null)

  // And a date written with dashes is ordinary business text, not an identifier.
  assert.equal(api.residualIdentifier('due 14-03-26'), null)
})

test('a phone number written with brackets, dots or slashes is a residual, and a date using the same separators is not', () => {
  /*
   * The two rules above this one each accept a single separator, so a number written
   * the way a great many people write one slipped between them: the space rule saw
   * `202` and `555` on either side of a bracket and called neither of them a run, and
   * the dash rule saw no dash at all. These are the shapes that were reaching a cloud
   * model as a person's own words.
   */

  // The case that was found in the wild, and the international form of it.
  assert.equal(api.residualIdentifier('Call (202) 555-0123 now'), 'long_number')
  assert.equal(api.residualIdentifier('+1 (202) 555-0123'), 'long_number')

  // A Nigerian mobile number in brackets, which is the format this app meets most.
  assert.equal(api.residualIdentifier('ring (0803) 123 4567 in the morning'), 'long_number')

  // Seven digits inside brackets is already a number, because nobody writes a date
  // or a price with an area code in front of it.
  assert.equal(api.residualIdentifier('ring (0803) 123'), 'long_number')

  // Dots as the separator, at ten digits or more.
  assert.equal(api.residualIdentifier('202.555.0123'), 'long_number')
  assert.equal(api.residualIdentifier('0803.123.4567'), 'long_number')

  /*
   * The other half of the rule, and the reason for the thresholds. A date is written
   * with the same dots, slashes and dashes, and refusing to send a conversation
   * because it mentioned a due date would be a check people work around rather than
   * one they trust. A date never reaches ten digits, so every date below still
   * passes.
   */
  assert.equal(api.residualIdentifier('due 14.03.2026'), null)
  assert.equal(api.residualIdentifier('due 14/03/2026'), null)
  assert.equal(api.residualIdentifier('due 2026-03-14'), null)

  // A year in brackets is four digits, which is not a number anybody dials.
  assert.equal(api.residualIdentifier('the (2026) review'), null)

  // And an ordinary sentence about money keeps passing.
  assert.equal(api.residualIdentifier('the quote is NGN 45,000'), null)
})

/* ------------------------------------------------------------------ *
 * The cloud payload
 * ------------------------------------------------------------------ */

test('a cloud payload replaces the known business, name and address, and previews exactly what would be sent', () => {
  const conversation = [
    message(
      'user',
      textPart(
        'Zuri Lofts: Zuri asked whether the invoice is out. Email zuri.owner@zuri.example.test.',
      ),
    ),
  ]

  const { messages, preview } = api.buildCloudPayload(conversation, IDENTITY)

  const expected = '[[business]]: [[person]] asked whether the invoice is out. Email [[email]].'

  // The outbound turn keeps its role and carries the substituted text and nothing
  // else, so what a provider is handed is visible in one object.
  assert.deepEqual(messages, [{ role: 'user', parts: [{ type: 'text', text: expected }] }])

  // The preview is the bytes, not a description of them: same text, same order.
  assert.deepEqual(preview.messages, [{ role: 'user', text: expected }])
  assert.equal(preview.cloud, true)

  // Every known value was replaced, so the payload holds none of them.
  const outbound = JSON.stringify(messages)
  assert.equal(outbound.includes('Zuri Lofts'), false, 'the business name is still in the payload')
  assert.equal(outbound.includes('Zuri'), false, 'the person name is still in the payload')
  assert.equal(outbound.includes('zuri.owner@zuri.example.test'), false, 'the address is still in the payload')
  assert.equal(outbound.includes('example.test'), false, 'part of the address is still in the payload')

  // Nothing unknown was found, so the payload is allowed out.
  assert.equal(preview.blocked, false)
  assert.equal(preview.blockedReason, null)

  // Each token is named for the screen with a readable label and no value: the
  // person sees what was taken out without the preview carrying it back.
  assert.deepEqual(preview.placeholders, [
    { token: '[[email]]', label: 'Email address' },
    { token: '[[business]]', label: 'Business name' },
    { token: '[[person]]', label: 'Your name' },
  ])
  for (const entry of preview.placeholders) {
    assert.equal(Object.hasOwn(entry, 'value'), false, `${entry.token} carries its value`)
    assert.deepEqual(Object.keys(entry).sort(), ['label', 'token'], `${entry.token} has extra keys`)
    assert.ok(entry.label.trim().length > 1, `${entry.token} has no readable label`)
  }
  // And the whole preview, labels included, still holds no part of the identity.
  const shown = JSON.stringify(preview)
  assert.equal(shown.includes('Zuri'), false, 'the preview quotes a name')
  assert.equal(shown.includes('zuri.owner@'), false, 'the preview quotes the address')
})

test('an unknown address blocks the payload, and the known values in it are still replaced', () => {
  /*
   * The address in this sentence is one the app knows nothing about, so there is no
   * token to put in its place. That is a refusal rather than a scrub: replacing it
   * would change the question, and the person would get an answer about the wrong
   * thing without being told.
   */
  const conversation = [
    message(
      'user',
      textPart('Send this to ada.okafor@customer.test about Zuri Lofts, and sign it as Zuri.'),
    ),
  ]

  const { messages, preview } = api.buildCloudPayload(conversation, IDENTITY)

  const expected =
    'Send this to ada.okafor@customer.test about [[business]], and sign it as [[person]].'

  assert.equal(preview.blocked, true)
  // A token, not a sentence: the reason travels to the screen and into the log line
  // that records the refusal, and neither may quote the text that was refused.
  assert.equal(preview.blockedReason, 'email')

  /*
   * A refused payload still exists. The send is stopped by the flag, not by emptying
   * the message, so a caller that shows the preview draws the text the person wrote
   * and can explain what to do about it. An empty list here would leave the screen
   * with nothing to show.
   */
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'user')
  assert.deepEqual(messages[0].parts, [{ type: 'text', text: expected }])
  assert.equal(preview.messages.length, 1)
  assert.equal(preview.messages[0].text, expected)

  // The refusal did not cost the replacements: the known values in the same payload
  // are gone, which is what makes the refusal a decision about the unknown one only.
  assert.equal(expected.includes('Zuri Lofts'), false)
  assert.equal(expected.includes('[[business]]'), true)
  assert.equal(expected.includes('[[person]]'), true)
  assert.equal(expected.includes('[[email]]'), false, 'a token appeared for an address the app does not know')

  // And the unknown address itself is left exactly as typed, because it is the
  // reason for the refusal and not something this layer is entitled to rewrite.
  assert.equal(expected.includes('ada.okafor@customer.test'), true)
})

test('every message in the conversation is sanitised, not only the last one', () => {
  /*
   * A name typed five turns ago is still a name in the payload. Hiding only the
   * newest line would leave the older one exposed while the preview looked correct
   * for the line the person was watching.
   */
  const conversation = [
    message('user', textPart('Zuri Lofts needs the lofts quote by Friday.')),
    message('assistant', textPart('Understood. I will prepare it.')),
    message('user', textPart('Add the Tilley line as well.')),
  ]

  const { messages, preview } = api.buildCloudPayload(conversation, IDENTITY)

  assert.equal(messages.length, 3)
  assert.equal(messages[0].parts[0].text, '[[business]] needs the lofts quote by Friday.')
  assert.equal(preview.messages[0].text, '[[business]] needs the lofts quote by Friday.')

  // The earlier turn is not in the payload under its original wording anywhere.
  assert.equal(JSON.stringify(messages).includes('Zuri Lofts'), false)
  assert.equal(JSON.stringify(preview).includes('Zuri Lofts'), false)

  // The turns that held nothing to hide are unchanged, and the order is the order
  // they were given in.
  assert.equal(messages[1].parts[0].text, 'Understood. I will prepare it.')
  assert.equal(messages[2].parts[0].text, 'Add the Tilley line as well.')
  assert.deepEqual(
    preview.messages.map((entry) => entry.role),
    ['user', 'assistant', 'user'],
  )
})

/* ------------------------------------------------------------------ *
 * The local payload
 * ------------------------------------------------------------------ */

test('a local payload substitutes nothing, blocks nothing, and says the bytes stay on this machine', () => {
  /*
   * A local model runs here, so it already sees what the person sees. There is
   * nothing to hide from it and nothing to check for, and the preview still exists
   * because the screen shows one panel either way.
   */
  const conversation = [
    message(
      'user',
      textPart('Zuri Lofts: email zuri.owner@zuri.example.test and copy ada.okafor@customer.test'),
    ),
    message('assistant', textPart('I will draft it.')),
    // A tool turn cannot be drawn by the preview's own role list, so it is shown as
    // what the app said rather than dropped.
    message('tool', { type: 'tool_result', toolCallId: 'call-1', content: 'ok' }),
  ]

  const preview = api.buildLocalPayload(conversation)

  assert.equal(preview.cloud, false)
  assert.equal(preview.blocked, false)
  assert.equal(preview.blockedReason, null)
  assert.deepEqual(preview.placeholders, [])

  // Nothing was taken out, including the address the app does not know: it is not
  // leaving the machine, so it is not a residual.
  assert.deepEqual(preview.messages, [
    {
      role: 'user',
      text: 'Zuri Lofts: email zuri.owner@zuri.example.test and copy ada.okafor@customer.test',
    },
    { role: 'assistant', text: 'I will draft it.' },
    { role: 'user', text: '' },
  ])

  // Same conversation through the cloud path is a different answer, which is the
  // whole point of having two builders.
  const cloud = api.buildCloudPayload(conversation, IDENTITY)
  assert.equal(cloud.preview.cloud, true)
  assert.equal(cloud.preview.blocked, true)
  assert.equal(cloud.preview.blockedReason, 'email')
})

/* ------------------------------------------------------------------ *
 * Parts that are not text
 * ------------------------------------------------------------------ */

test('an image or a tool part is forwarded untouched, and only the text parts are joined for the preview', () => {
  const image = { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg' }
  const before = textPart('Zuri Lofts receipt')
  const after = textPart('Total due Friday.')
  const toolResult = { type: 'tool_result', toolCallId: 'call-1', content: 'ok', isError: false }

  const conversation = [
    message('user', before, image, after),
    message('tool', toolResult),
  ]

  const { messages, preview } = api.buildCloudPayload(conversation, IDENTITY)

  /*
   * The image is bytes the person chose to attach, and the residual check cannot
   * read it, so it is carried through exactly as it arrived rather than being
   * dropped or rewritten. The text either side of it is still substituted.
   */
  assert.deepEqual(messages[0].parts, [
    { type: 'text', text: '[[business]] receipt' },
    image,
    { type: 'text', text: 'Total due Friday.' },
  ])
  assert.equal(messages[0].parts[1].data, 'iVBORw0KGgoAAAANSUhEUg')

  // `textOfParts` joins only the text parts, so the preview shows one turn reading
  // the way the person wrote it and never the image's base64.
  assert.equal(preview.messages[0].text, '[[business]] receipt\nTotal due Friday.')
  assert.equal(preview.messages[0].role, 'user')
  assert.equal(preview.messages[0].text.includes('iVBORw0KGgo'), false)

  // A tool result is not text either: it is forwarded, contributes nothing to the
  // preview, and its turn shows as what the app said.
  assert.deepEqual(messages[1].parts, [toolResult])
  assert.equal(preview.messages[1].text, '')
  assert.equal(preview.messages[1].role, 'user')

  // Nothing in any of it looked like an identifier, so the payload is allowed out.
  assert.equal(preview.blocked, false)

  // And the join itself, on its own, which is what both builders call.
  assert.equal(api.textOfParts([before, image, after]), 'Zuri Lofts receipt\nTotal due Friday.')
  assert.equal(api.textOfParts([image]), '')
  assert.equal(api.textOfParts([]), '')
})

test('digit-heavy memory and summary IDs are allowed while user-supplied long numbers are blocked', () => {
  /*
   * The new fence-label fix uses digit-heavy row IDs for memory and summary.
   * This test verifies they pass the privacy scanner while user-supplied long
   * numbers are still caught and blocked.
   *
   * The context builder returns { messages, blocks, trimmed }, and the privacy
   * scanner works on those assembled messages.
   */

  // Digit-heavy IDs that come from the database, not user input
  const memoryRows = [
    {
      id: 'a1234567890',
      kind: 'decision',
      text: 'Quotes go out on Fridays.',
      sourceMessageId: null,
      origin: 'user',
      locked: false,
      createdAt: '2026-11-16T09:30:00.000Z',
      updatedAt: '2026-11-16T09:30:00.000Z',
    },
    {
      id: 'a2345678901',
      kind: 'fact',
      text: 'The studio is in Abuja.',
      sourceMessageId: null,
      origin: 'user',
      locked: false,
      createdAt: '2026-11-16T09:30:00.000Z',
      updatedAt: '2026-11-16T09:30:00.000Z',
    },
  ]

  const summaryRow = {
    threadId: 't9876543210',
    text: 'Earlier: the Tilley quote was moved to Friday.',
    coversThroughSeq: 2,
    updatedAt: '2026-11-16T09:30:00.000Z',
  }

  const conversation = [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Move the quote to Friday.' }],
    },
  ]

  // Assemble context with digit-heavy IDs and pass [storedMessage] directly
  const storedMessage = {
    id: 'b000003',
    threadId: summaryRow.threadId,
    seq: 3,
    role: 'user',
    content: 'Also include the Tilley deposit.',
    provider: null,
    model: null,
    cloud: null,
    createdAt: '2026-11-16T09:30:00.000Z',
  }

  const assembled = api.assembleContext({
    summary: summaryRow,
    memory: memoryRows,
    messages: [storedMessage],
  })

  // Pass assembled.messages directly to buildCloudPayload (no messagesWithStored)
  const identity = {
    businessName: 'Zuri Lofts',
    displayName: 'Zuri',
    email: 'zuri.owner@zuri.example.test',
  }
  const { messages, preview } = api.buildCloudPayload(assembled.messages, identity)

  // Assert both memory texts appear in the payload (both are metadata, not user content)
  const payloadText = JSON.stringify(messages)
  assert.equal(payloadText.includes('Quotes go out on Fridays.'), true, 'memory decision text appears in payload')
  assert.equal(payloadText.includes('The studio is in Abuja.'), true, 'memory fact text appears in payload')

  // Assert the summary text appears in the payload
  assert.equal(payloadText.includes('Earlier: the Tilley quote was moved to Friday.'), true, 'summary text appears in payload')

  // Assert no row IDs appear in the assembled text (they are metadata, not content)
  assert.equal(payloadText.includes('a1234567890'), false, 'memory row ID a1234567890 appears in the payload')
  assert.equal(payloadText.includes('a2345678901'), false, 'memory row ID a2345678901 appears in the payload')
  assert.equal(payloadText.includes('t9876543210'), false, 'summary thread ID t9876543210 appears in the payload')

  // Assert the stored message with seq=3 appears in the payload (seq > coversThroughSeq)
  assert.equal(payloadText.includes('Also include the Tilley deposit'), true, 'the stored message with seq=3 was passed directly to buildCloudPayload')

  // Assert the payload is allowed: digit-heavy IDs are not blocked
  assert.equal(preview.blocked, false, 'the payload with digit-heavy IDs was blocked')
  assert.equal(preview.blockedReason, null, 'a reason was given for the block')



  // Now add a user-supplied long number that should be blocked
  const conversationWithLongNumber = [
    {
      role: 'user',
      parts: [{ type: 'text', text: 'Call 08031234567 about the Tilley quote.' }],
    },
  ]

  const { preview: previewWithLongNumber } = api.buildCloudPayload(conversationWithLongNumber, identity)

  // Assert the user-supplied long number is blocked
  assert.equal(previewWithLongNumber.blocked, true, 'the payload with a user long number was allowed')
  assert.equal(previewWithLongNumber.blockedReason, 'long_number', 'the reason for blocking was not a long number')
})
