'use strict'

/*
 * Checks on the evaluation sets themselves.
 *
 * The plan asks for 20 to 30 prompts per feature with explicit expectations, and
 * the numbers in the report are only as good as the sets behind them. Counting
 * cases by hand once is how the earlier report ended up with 15 per feature while
 * saying it had the set the plan required. These checks fail if the sets drift out
 * of range, lose their negative cases, lose the misses they exist to catch, or
 * collect an expectation the judging code does not understand.
 *
 * The judging code is tested here too, with synthetic answers, because a matcher
 * that quietly says yes to everything would make every result meaningless.
 *
 * Run with:  cd desktop && npm run test:eval
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { judgeMemory, judgeDrafting, matchClauses } = require('./expectations.js')

const MEMORY_ALLOWED_EXPECT_KEYS = new Set(['items', 'silent', 'forbidden', 'maxItems', 'minItems', 'preSendBlocked'])
const DRAFTING_ALLOWED_EXPECT_KEYS = new Set(['tasks', 'silent', 'exactCount', 'minTasks', 'maxTasks', 'forbidInText', 'dueHint', 'distinct'])

function loadSets () {
  return [
    require('./memory-extraction-cases.js'),
    require('./drafting-cases.js'),
  ]
}

test('both evaluation sets exist and sit in the range the plan requires', () => {
  const sets = loadSets()
  assert.equal(sets.length, 2)

  for (const set of sets) {
    assert.ok(['memory_extraction', 'task_drafting'].includes(set.feature), `${set.feature} is not a known feature`)
    assert.equal(typeof set.promptConstant, 'string')
    assert.ok(
      set.cases.length >= 20 && set.cases.length <= 30,
      `${set.feature} has ${set.cases.length} cases; the plan requires 20 to 30`,
    )
  }
})

test('every case is complete, unique and has an explicit expectation', () => {
  for (const set of loadSets()) {
    const seen = new Set()

    for (const caseDef of set.cases) {
      assert.equal(typeof caseDef.id, 'string', `${set.feature} has a case with no id`)
      assert.ok(!seen.has(caseDef.id), `duplicate id ${caseDef.id}`)
      seen.add(caseDef.id)

      assert.equal(typeof caseDef.title, 'string', `${caseDef.id} has no title`)
      assert.ok(caseDef.title.trim().length > 10, `${caseDef.id} has a title too short to say what it proves`)
      assert.equal(typeof caseDef.origin, 'string', `${caseDef.id} has no origin`)

      const expect = caseDef.expect
      assert.equal(typeof expect, 'object', `${caseDef.id} has no expectation`)
      assert.ok(expect !== null, `${caseDef.id} has a null expectation`)

      const allowed = set.feature === 'memory_extraction' ? MEMORY_ALLOWED_EXPECT_KEYS : DRAFTING_ALLOWED_EXPECT_KEYS
      for (const key of Object.keys(expect)) {
        assert.ok(allowed.has(key), `${caseDef.id} uses an expectation key the judge does not read: ${key}`)
      }

      const silent = expect.silent === true
      const blocked = expect.preSendBlocked !== undefined
      assert.ok(
        silent || blocked || (expect.items ?? expect.tasks ?? []).length > 0,
        `${caseDef.id} expects nothing in particular: no items, no silence and no block`,
      )
      assert.ok(
        !(silent && blocked),
        `${caseDef.id} is marked both silent and blocked, which are different outcomes`,
      )

      const clauses = expect.items ?? expect.tasks ?? []
      for (const clause of clauses) {
        assert.equal(typeof clause.label, 'string', `${caseDef.id} has a clause with no label`)
        assert.ok(clause.label.trim().length > 8, `${caseDef.id} has a clause label too short to read in a report`)
        assert.ok(Array.isArray(clause.all) && clause.all.length > 0, `${caseDef.id} has a clause with no tokens`)
        for (const clauseKey of Object.keys(clause)) {
          assert.ok(
            ['label', 'kind', 'all', 'none'].includes(clauseKey),
            `${caseDef.id} has a clause key the judge does not read: ${clauseKey}`,
          )
        }
      }
    }

    assert.ok(seen.size >= 20, `${set.feature} has only ${seen.size} cases`)
  }
})

test('memory cases carry a two message exchange in the shape production reads', () => {
  const set = require('./memory-extraction-cases.js')
  for (const caseDef of set.cases) {
    assert.ok(Array.isArray(caseDef.exchange), `${caseDef.id} has no exchange`)
    assert.equal(caseDef.exchange.length, 2, `${caseDef.id} must be the last two messages, not more`)
    assert.equal(caseDef.exchange[0].role, 'user', `${caseDef.id} does not start with the person`)
    assert.equal(caseDef.exchange[1].role, 'assistant', `${caseDef.id} does not end with the assistant`)
    for (const message of caseDef.exchange) {
      assert.equal(typeof message.content, 'string')
      assert.ok(message.content.trim().length > 0, `${caseDef.id} has an empty message`)
    }
  }
})

test('drafting cases carry one message and a reach expectation', () => {
  const set = require('./drafting-cases.js')
  for (const caseDef of set.cases) {
    assert.equal(typeof caseDef.message, 'string', `${caseDef.id} has no message`)
    assert.ok(caseDef.message.trim().length > 0)
    assert.ok(
      ['should-draft', 'should-stay-silent'].includes(caseDef.reach),
      `${caseDef.id} does not say whether a person would expect a card`,
    )
  }
})

test('both sets keep negative cases and the misses that were seen in use', () => {
  const memory = require('./memory-extraction-cases.js')
  const drafting = require('./drafting-cases.js')

  const memorySilent = memory.cases.filter((caseDef) => caseDef.expect.silent === true)
  assert.ok(memorySilent.length >= 5, `memory has ${memorySilent.length} cases where the answer is nothing`)

  const draftingSilent = drafting.cases.filter((caseDef) => caseDef.expect.silent === true)
  assert.ok(draftingSilent.length >= 3, `drafting has ${draftingSilent.length} cases where no card should appear`)

  for (const set of [memory, drafting]) {
    const observed = set.cases.filter((caseDef) => caseDef.origin === 'observed-miss')
    assert.ok(observed.length >= 2, `${set.feature} no longer includes the misses that were seen in use`)
    for (const caseDef of observed) {
      assert.ok(caseDef.expect.silent === true || (caseDef.expect.items ?? caseDef.expect.tasks ?? []).length > 0,
        `${caseDef.id} is an observed miss with no expectation`)
    }
  }
})

test('the sets contain no secret-shaped or non-ascii text', () => {
  const raw = [
    require('node:fs').readFileSync(require('node:path').join(__dirname, 'memory-extraction-cases.js'), 'utf8'),
    require('node:fs').readFileSync(require('node:path').join(__dirname, 'drafting-cases.js'), 'utf8'),
  ].join('\n')

  assert.ok(!/sk-[A-Za-z0-9]{16,}/u.test(raw), 'an api key shape is in a case file')
  assert.ok(!/[\u2010-\u2015\u2018\u2019\u201c\u201d]/u.test(raw), 'curly quotes or long dashes are in a case file')
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(raw), 'an emoji is in a case file')
})

test('the memory judge separates a right answer from a right answer of the wrong kind', () => {
  const expect = {
    items: [{ label: 'the open question stays a question', kind: 'open_question', all: ['deposit', 'paid'] }],
    maxItems: 2,
  }

  const right = judgeMemory(expect, [{ kind: 'open_question', text: 'Whether the deposit has been paid is unknown.' }])
  assert.equal(right.verdict, 'pass')

  const wrongKind = judgeMemory(expect, [{ kind: 'fact', text: 'The deposit has been paid.' }])
  assert.equal(wrongKind.verdict, 'fail')
  assert.match(wrongKind.failed.join(' '), /open question/u)
})

test('the memory judge fails a silent case that stored something', () => {
  assert.equal(judgeMemory({ silent: true }, []).verdict, 'pass')
  assert.equal(judgeMemory({ silent: true }, [{ kind: 'fact', text: 'Anything at all.' }]).verdict, 'fail')
})

test('the memory judge fails an answer that kept a name it was told not to keep', () => {
  const judged = judgeMemory({
    items: [{ label: 'the quote is stored', kind: 'fact', all: ['roof', 'quote'] }],
    forbidden: [{ label: 'the name is not stored', all: ['chinedu'] }],
  }, [{ kind: 'fact', text: 'Chinedu said the roof quote is two million naira.' }])

  assert.equal(judged.verdict, 'fail')
  assert.match(judged.failed.join(' '), /name/u)
})

test('the drafting judge fails one card that pretends to be two', () => {
  const oneCard = [{ title: 'Chase the invoice and book the site visit', text: 'Chase the invoice and book the site visit' }]
  const expect = {
    tasks: [
      { label: 'the invoice is chased', all: ['invoice'] },
      { label: 'the site visit is booked', all: ['site visit'] },
    ],
    exactCount: 2,
  }

  assert.equal(judgeDrafting(expect, oneCard).verdict, 'fail')
  assert.equal(judgeDrafting(expect, [
    { title: 'Chase the invoice', text: 'Chase the invoice' },
    { title: 'Book the site visit', text: 'Book the site visit' },
  ]).verdict, 'pass')
})

test('the drafting judge fails an invented deadline and a missing one', () => {
  const expect = { tasks: [{ label: 'the call is drafted', all: ['surveyor'] }], dueHint: 'absent' }
  assert.equal(judgeDrafting(expect, [{ title: 'Call the surveyor', text: 'Call the surveyor', dueHint: 'Friday' }]).verdict, 'fail')
  assert.equal(judgeDrafting(expect, [{ title: 'Call the surveyor', text: 'Call the surveyor', dueHint: null }]).verdict, 'pass')

  const wanted = { tasks: [{ label: 'the call is drafted', all: ['surveyor'] }], dueHint: 'present' }
  assert.equal(judgeDrafting(wanted, [{ title: 'Call the surveyor', text: 'Call the surveyor', dueHint: null }]).verdict, 'fail')
})

test('a clause with no tokens matches everything, so no case may write one', () => {
  // Documents why the set check insists on at least one token per clause: an
  // empty token list would pass against any row at all.
  assert.equal(matchClauses([{ text: 'anything' }], [{ label: 'nothing in particular', all: [] }])[0].ok, true)
  for (const set of loadSets()) {
    for (const caseDef of set.cases) {
      for (const clause of (caseDef.expect.items ?? caseDef.expect.tasks ?? [])) {
        assert.ok(clause.all.length > 0, `${caseDef.id} has a clause that would match anything`)
      }
    }
  }
})
