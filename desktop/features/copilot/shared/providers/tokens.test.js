'use strict'

/*
 * The local token estimate, tested through the bundle Electron loads.
 *
 * `countTokens` exists so a size check can run before a call is made, which
 * means the estimate has two jobs that matter more than its precision:
 *
 * - It never touches the network, so it can run while a person types.
 * - It never throws, because it is fed model output and tool arguments, and an
 *   estimator that threw would turn a size display into a failed request.
 *
 * The rest of the file pins the behaviour that makes the number useful at all:
 * empty is zero, an image costs what an image costs regardless of its length,
 * and a longer request never estimates smaller than a shorter one.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** One user turn of plain text. */
function turn (text) {
  return { role: 'user', parts: [{ type: 'text', text }] }
}

test('plain text is a character count over the divisor, and empty text is zero', () => {
  assert.equal(api.estimateTextTokens(''), 0)
  assert.equal(api.estimateTextTokens('a'.repeat(api.CHARS_PER_TOKEN)), 1)
  assert.equal(api.estimateTextTokens('a'.repeat(api.CHARS_PER_TOKEN + 1)), 2)
  assert.equal(api.estimateTextTokens('a'.repeat(4000)), 1000)

  // One character still occupies a token once the turn is framed.
  assert.equal(api.estimateTextTokens('a'), 1)
})

test('a longer request never estimates smaller than a shorter one', () => {
  let previous = 0
  for (const length of [0, 1, 10, 100, 1000, 10_000]) {
    const estimate = api.estimateTextTokens('a'.repeat(length))
    assert.ok(estimate >= previous, `${length} chars estimated below the shorter case`)
    previous = estimate
  }
})

test('an image costs the flat figure, not its base64 length', () => {
  const small = api.estimatePartTokens({ type: 'image', mediaType: 'image/png', data: 'AAAA' })
  const large = api.estimatePartTokens({
    type: 'image',
    mediaType: 'image/png',
    data: 'A'.repeat(100_000),
  })

  assert.equal(small, api.IMAGE_TOKEN_ESTIMATE)
  // A length-based count would price a photo by its compression, which is not
  // how a provider bills it.
  assert.equal(large, api.IMAGE_TOKEN_ESTIMATE)
})

test('a tool result is counted like a message, and a tool call counts name and arguments', () => {
  const result = api.estimatePartTokens({
    type: 'tool_result',
    toolCallId: 'call-1',
    content: 'a'.repeat(40),
  })
  assert.equal(result, api.TOOL_RESULT_OVERHEAD_TOKENS + 10)

  const call = api.estimatePartTokens({
    type: 'tool_call',
    id: 'call-1',
    name: 'list_tasks',
    arguments: { workspaceId: 1 },
  })
  // The name plus the serialized arguments, which is what the model emitted.
  assert.equal(call, api.estimateTextTokens('list_tasks') + api.estimateTextTokens('{"workspaceId":1}'))
})

test('a tool call with arguments that cannot be serialized still estimates', () => {
  // Tool arguments come from a model and are untrusted: a cyclic value makes
  // JSON.stringify throw, and a thrown error here would fail the whole request.
  const cyclic = { name: 'loop' }
  cyclic.self = cyclic

  const estimate = api.estimatePartTokens({
    type: 'tool_call',
    id: 'call-1',
    name: 'list_tasks',
    arguments: cyclic,
  })
  assert.equal(estimate, api.estimateTextTokens('list_tasks'))

  // A BigInt is the other common way to break JSON.stringify.
  assert.doesNotThrow(() =>
    api.estimatePartTokens({
      type: 'tool_call',
      id: 'call-1',
      name: 'list_tasks',
      arguments: { id: 1n },
    }),
  )
})

test('a message costs its parts plus the turn framing', () => {
  const text = 'a'.repeat(40)
  assert.equal(
    api.estimateMessageTokens(turn(text)),
    api.MESSAGE_OVERHEAD_TOKENS + api.estimateTextTokens(text),
  )
})

test('a request is the sum of its turns, and nothing for no turns', () => {
  assert.equal(api.estimateChatTokens({ messages: [] }), 0)

  const one = api.estimateChatTokens({ messages: [turn('hello there')] })
  const two = api.estimateChatTokens({ messages: [turn('hello there'), turn('and again')] })

  assert.equal(one, api.estimateMessageTokens(turn('hello there')))
  assert.ok(two > one)
})

test('tool definitions count, because they are resent with every call', () => {
  const withoutTools = { messages: [turn('hello')] }
  const withTools = {
    messages: [turn('hello')],
    tools: [
      {
        name: 'list_tasks',
        description: 'List the tasks in a workspace.',
        parameters: {
          type: 'object',
          properties: { workspaceId: { type: 'number' }, status: { type: 'string' } },
        },
      },
    ],
  }

  const extra = api.estimateChatTokens(withTools) - api.estimateChatTokens(withoutTools)
  assert.ok(extra > api.estimateTextTokens('list_tasks') + api.estimateTextTokens('List the tasks in a workspace.'))
})

test('an image inside a request is counted once, at its flat cost', () => {
  const request = {
    messages: [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'what is this' },
          { type: 'image', mediaType: 'image/png', data: 'A'.repeat(50_000) },
        ],
      },
    ],
  }

  const estimate = api.estimateChatTokens(request)
  assert.ok(estimate >= api.IMAGE_TOKEN_ESTIMATE)
  assert.ok(estimate < api.IMAGE_TOKEN_ESTIMATE * 2)
})
