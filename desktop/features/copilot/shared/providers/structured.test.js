'use strict'

/*
 * The prompted-tool check, tested through the bundle Electron loads.
 *
 * Section 9.4 of the plan allows exactly one repair retry for a model that
 * cannot call tools natively and answers with JSON that does not match the
 * schema. "Exactly one" is the whole contribution of this module, so the tests
 * are mostly about counting asks:
 *
 * - A good reply costs one ask and no repair.
 * - A bad reply costs two, and the second one is told what was wrong.
 * - A second bad reply stops there: the error is `schema_mismatch`, the ask is
 *   made exactly twice, and neither the reply nor the issue text travels in the
 *   thrown error, because a reply can contain a document excerpt.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { z } = require('zod')

const api = require('../../../../build/main/ipc.cjs')

/** The shape a feature would ask a weaker model for. */
const TASK_SCHEMA = z.strictObject({
  title: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']),
})

/** An asker that replays a script of replies and records what it was told. */
function scriptedAsk (replies) {
  const attempts = []
  return {
    attempts,
    ask (attempt) {
      attempts.push({ attempt: attempt.attempt, repair: attempt.repair, issues: [...attempt.issues] })
      const reply = replies[Math.min(attempts.length - 1, replies.length - 1)]
      if (reply instanceof Error) throw reply
      return Promise.resolve(reply)
    },
  }
}

const GOOD = '{"title":"Send invoices","priority":"high"}'

test('a valid reply is accepted on the first ask, with no repair', async () => {
  const asker = scriptedAsk([GOOD])

  const value = await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })

  assert.deepEqual(value, { title: 'Send invoices', priority: 'high' })
  assert.equal(asker.attempts.length, 1)
  assert.equal(asker.attempts[0].repair, false)
  assert.deepEqual(asker.attempts[0].issues, [])
})

test('a fenced code block is read, because that is how models wrap JSON', async () => {
  for (const reply of [`\`\`\`json\n${GOOD}\n\`\`\``, `\`\`\`\n${GOOD}\n\`\`\``, `  ${GOOD}  `]) {
    const asker = scriptedAsk([reply])
    const value = await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })
    assert.equal(value.title, 'Send invoices')
    assert.equal(asker.attempts.length, 1)
  }
})

test('a reply that does not match the schema is repaired once', async () => {
  const asker = scriptedAsk(['{"title":"Send invoices"}', GOOD])

  const value = await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })

  assert.equal(value.priority, 'high')
  assert.equal(asker.attempts.length, 2)
  assert.equal(asker.attempts[1].attempt, 2)
  assert.equal(asker.attempts[1].repair, true)
  // The repair has to say what was wrong, or it is just the same question twice.
  assert.ok(asker.attempts[1].issues.length > 0)
  assert.ok(asker.attempts[1].issues.some(issue => issue.includes('priority')))
})

test('a reply that is not JSON at all also gets the one repair', async () => {
  const asker = scriptedAsk(['I am sorry, I cannot do that.', GOOD])

  const value = await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })

  assert.equal(value.title, 'Send invoices')
  assert.equal(asker.attempts.length, 2)
  assert.deepEqual(asker.attempts[1].issues, ['reply was not valid JSON'])
})

test('two bad replies stop after exactly one repair and carry nothing', async () => {
  const prose = 'The customer number is 4417 and the invoice is overdue.'
  const asker = scriptedAsk([prose, prose])

  let thrown = null
  try {
    await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })
  } catch (error) {
    thrown = error
  }

  assert.ok(thrown instanceof api.ProviderError)
  assert.equal(thrown.failure, 'schema_mismatch')
  assert.equal(asker.attempts.length, 2)

  // The reply can be a document excerpt, so neither it nor the issue text may
  // reach an error that a log or an IPC reply could carry.
  assert.equal(thrown.message.includes('4417'), false)
  assert.equal(thrown.message.includes('overdue'), false)
})

test('an unknown key is refused, because the schema a feature passes is strict', async () => {
  // The extra key is what a model adds when it decides to be helpful. A loose
  // schema would accept it, so the strictness has to come from the schema and be
  // exercised here rather than assumed.
  const asker = scriptedAsk(['{"title":"Send invoices","priority":"high","notes":"extra"}', GOOD])

  const value = await api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask })

  assert.deepEqual(value, { title: 'Send invoices', priority: 'high' })
  assert.equal(asker.attempts.length, 2)
})

test('the issues reported back are capped, so a repair stays a prompt', async () => {
  const wide = z.strictObject({
    a: z.string(),
    b: z.string(),
    c: z.string(),
    d: z.string(),
    e: z.string(),
    f: z.string(),
    g: z.string(),
    h: z.string(),
  })
  const asker = scriptedAsk(['{}', '{}'])

  await assert.rejects(
    api.requestStructuredOutput({ schema: wide, ask: asker.ask }),
    (error) => error instanceof api.ProviderError && error.failure === 'schema_mismatch',
  )

  assert.equal(asker.attempts[1].issues.length, api.MAX_REPORTED_ISSUES)
})

test('an ask that throws is not swallowed into a schema failure', async () => {
  // A cancelled or unauthorised call is the transport's failure to report, not a
  // shape mismatch; collapsing them would tell the person the wrong thing.
  const asker = scriptedAsk([new api.ProviderError('aborted')])

  await assert.rejects(
    api.requestStructuredOutput({ schema: TASK_SCHEMA, ask: asker.ask }),
    (error) => error instanceof api.ProviderError && error.failure === 'aborted',
  )
  assert.equal(asker.attempts.length, 1)
})

test('parseJsonReply separates "not JSON" from a valid null', () => {
  assert.deepEqual(api.parseJsonReply('{"a":1}'), { ok: true, value: { a: 1 } })
  // null is valid JSON, so it must not read as a parse failure.
  assert.deepEqual(api.parseJsonReply('null'), { ok: true, value: null })

  assert.deepEqual(api.parseJsonReply(''), { ok: false })
  assert.deepEqual(api.parseJsonReply('   '), { ok: false })
  assert.deepEqual(api.parseJsonReply('not json'), { ok: false })
  assert.deepEqual(api.parseJsonReply('```\n\n```'), { ok: false })
})
