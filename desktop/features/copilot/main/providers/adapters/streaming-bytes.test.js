'use strict'

/*
 * Provider replies that stream: bytes in, deltas out, while the body is still open.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires that
 * build rather than the TypeScript source, so what is proven here is the CommonJS
 * the main process runs.
 *
 * Every case below is about one property a buffering reader would also satisfy on
 * the answer and would break on the timing, so each test states the timing and
 * then holds the reader to it:
 *
 * - the reader hands the first event on while the body source is still parked on a
 *   promise this test owns, so the event cannot be a fragment of a finished body;
 * - a character cut in half by a chunk boundary comes out whole, because a reply
 *   in Yoruba or Arabic decoded byte by byte would arrive with replacement
 *   characters;
 * - an adapter delivers its first delta before the second half of the body exists,
 *   which is the entire difference between streaming and waiting for the last
 *   word;
 * - and an adapter still answers when the transport offers only a whole body, so a
 *   recorded fixture keeps exercising the same parsing code instead of a second
 *   copy of it.
 *
 * No socket is opened and no key is real. Every transport here is a hand-built
 * object whose `bytes()` yields the chunks this file chose, in this file's order;
 * `text()` answers the same body as one string and records that it was asked, so
 * an adapter that quietly took the whole-body route fails here rather than looking
 * correct. Where a test has to wait, it waits on a promise it releases itself: a
 * sleep would pass on a fast machine and fail on a loaded one, which is the one
 * thing an ordering test must never do.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../../build/main/ipc.cjs')

/*
 * A missing export here is a wiring gap in the main entry, not a reader bug, and
 * saying so once at load is clearer than the same "not a function" in every test.
 */
for (const name of [
  'parseSse',
  'parseSseStream',
  'streamLines',
  'readSse',
  'createAnthropicProvider',
  'createOllamaProvider',
  'findPreset',
  'createCallContext',
]) {
  assert.equal(typeof api[name], 'function', `${name} is not exported by the main bundle`)
}

/* One model per protocol, named so a capabilities lookup can find it. */
const ANTHROPIC_MODEL = 'claude-sonnet-4-5'
const OLLAMA_MODEL = 'qwen2.5:7b'

/* ------------------------------------------------------------------ *
 * Waiting on the test, not on the clock
 * ------------------------------------------------------------------ */

/**
 * A promise and the function that settles it.
 *
 * The chunk sources below await one of these in the middle of their body, so the
 * test decides when the rest of a reply exists. That is what makes "the first
 * delta arrived before the body ended" a fact rather than a hope.
 */
function deferred () {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release: () => release() }
}

/* ------------------------------------------------------------------ *
 * Bodies and transports
 * ------------------------------------------------------------------ */

/** The chunks a test named, in the order it named them. */
async function* chunksOf (...parts) {
  for (const part of parts) yield part
}

/** Every item an async iterable produces, which is how a generator is driven. */
async function drain (iterable) {
  const items = []
  for await (const item of iterable) items.push(item)
  return items
}

/**
 * A transport whose reply arrives as bytes, with the whole body kept alongside.
 *
 * `open` is called once per request so a retried call starts its stream again.
 * `state` is what the assertions read: `streamRead` proves the byte door was used
 * and `wholeBodyRead` proves it was not. `text()` answers the same reply as one
 * string rather than throwing, so a fallback that happened by accident produces a
 * failing assertion here instead of an unrelated parse error.
 */
function streamingTransport (open, wholeBody) {
  const calls = []
  const state = { streamRead: false, wholeBodyRead: false }

  return {
    calls,
    state,
    async request (ctx, url, init) {
      const response = {
        status: 200,
        ok: true,
        text: async () => {
          state.wholeBodyRead = true
          return wholeBody
        },
        json: async () => JSON.parse(wholeBody),
        bytes: () => {
          state.streamRead = true
          return open()
        },
      }
      calls.push({ ctx, url, init, response })
      return response
    },
  }
}

/**
 * A transport of the older shape: a complete body and nothing else.
 *
 * `bytes` is absent on purpose, and absent rather than undefined, because that is
 * what a recorded fixture and the guarded transport both look like.
 */
function wholeBodyTransport (body) {
  const calls = []
  return {
    calls,
    async request (ctx, url, init) {
      const response = {
        status: 200,
        ok: true,
        text: async () => body,
        json: async () => JSON.parse(body),
      }
      calls.push({ ctx, url, init, response })
      return response
    },
  }
}

/* ------------------------------------------------------------------ *
 * The two wire formats, written by hand
 * ------------------------------------------------------------------ */

/** One server-sent event, in the shape the Anthropic stream uses. */
function sse (event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

function anthropicStart () {
  return sse('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_1',
      model: ANTHROPIC_MODEL,
      usage: { input_tokens: 12, output_tokens: 0 },
    },
  })
}

function anthropicDelta (text) {
  return sse('content_block_delta', {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  })
}

function anthropicEnd () {
  return (
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 2 },
    }) + sse('message_stop', { type: 'message_stop' })
  )
}

/** One newline-delimited record, as `/api/chat` sends it with `stream: true`. */
function ollamaRecord (content) {
  return `${JSON.stringify({
    model: OLLAMA_MODEL,
    message: { role: 'assistant', content },
    done: false,
  })}\n`
}

/** The closing record, which is the only place usage is reported. */
const OLLAMA_END = `${JSON.stringify({
  model: OLLAMA_MODEL,
  message: { role: 'assistant', content: '' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 26,
  eval_count: 4,
})}\n`

/* ------------------------------------------------------------------ *
 * Providers over those transports
 * ------------------------------------------------------------------ */

function anthropicWith (transport) {
  return api.createAnthropicProvider(
    {
      preset: api.findPreset('anthropic'),
      credential: 'test-key',
      defaultModel: ANTHROPIC_MODEL,
    },
    { transport },
  )
}

function ollamaWith (transport) {
  return api.createOllamaProvider(
    {
      preset: api.findPreset('ollama'),
      // A bare local server takes no key, which is the normal case.
      credential: null,
      defaultModel: OLLAMA_MODEL,
    },
    { transport },
  )
}

function ctxFor (provider, signal) {
  return api.createCallContext(
    { businessId: 1, providerId: provider.id, userId: 1, purpose: 'chat_strategy' },
    signal,
  )
}

function chatRequest (modelId) {
  return {
    modelId,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say hello.' }] }],
  }
}

/* ------------------------------------------------------------------ *
 * The event reader itself
 * ------------------------------------------------------------------ */

test('the first event is handed on while the body is still arriving', async () => {
  const gate = deferred()
  const progress = { released: false, finished: false }

  async function* chunks () {
    yield Buffer.from('event: greeting\ndata: first\n\n', 'utf8')
    await gate.promise
    progress.released = true
    yield Buffer.from('event: farewell\ndata: second\n\n', 'utf8')
    progress.finished = true
  }

  const events = api.parseSseStream(chunks())

  const first = await events.next()
  assert.equal(first.done, false)
  assert.deepEqual(first.value, { event: 'greeting', data: 'first' })

  /*
   * The assertion a buffering reader cannot satisfy. The rest of the body is still
   * behind a promise only this test can settle, so the event in hand was produced
   * from the first chunk alone rather than from a body that had ended.
   */
  assert.equal(progress.released, false, 'the first event only appeared after the gate was released')
  assert.equal(progress.finished, false, 'the body had already ended when the first event arrived')

  gate.release()

  const second = await events.next()
  assert.deepEqual(second.value, { event: 'farewell', data: 'second' })
  // And the second event is proof the gate was what held it back.
  assert.equal(progress.released, true)

  const end = await events.next()
  assert.equal(end.done, true)
  assert.equal(progress.finished, true)
})

test('a character split across two chunks is decoded whole, not as two broken halves', async () => {
  /*
   * The bytes are written out rather than typed, for two reasons: this file is
   * ASCII, and the subject is the exact byte boundary. U+1ECD is three bytes and
   * U+00E9 is two, and each one is cut in the middle below. A decoder fed without
   * `stream: true` would answer with replacement characters at both cuts, which is
   * how a reply in Yoruba arrives broken rather than wrong-looking.
   */
  const oDotBelow = Buffer.from([0xe1, 0xbb, 0x8d])
  const eAcute = Buffer.from([0xc3, 0xa9])

  const body = Buffer.concat([
    Buffer.from('data: ', 'utf8'),
    oDotBelow,
    Buffer.from(' and ', 'utf8'),
    eAcute,
    Buffer.from('\n\n', 'utf8'),
  ])
  // One byte into each character, so both are straddling a chunk boundary.
  const firstCut = body.indexOf(oDotBelow) + 1
  const secondCut = body.indexOf(eAcute) + 1
  const chunks = chunksOf(
    body.subarray(0, firstCut),
    body.subarray(firstCut, secondCut),
    body.subarray(secondCut),
  )

  const events = await drain(api.parseSseStream(chunks))
  assert.equal(events.length, 1)
  assert.equal(events[0].event, null)

  // Built from the same bytes rather than typed, so the expectation is the
  // character itself and not this file's spelling of it.
  const expected = Buffer.concat([oDotBelow, Buffer.from(' and ', 'utf8'), eAcute]).toString('utf8')
  assert.equal(events[0].data, expected)
  assert.equal(events[0].data.includes('\uFFFD'), false, 'a character was decoded as a broken half')

  // The line reader shares the decoder, so a newline-delimited protocol is held to
  // the same rule. Two of the three bytes land in the first chunk here.
  const line = Buffer.concat([Buffer.from('line with ', 'utf8'), oDotBelow, Buffer.from('\n', 'utf8')])
  const lineCut = line.indexOf(oDotBelow) + 2
  const lines = await drain(api.streamLines(chunksOf(line.subarray(0, lineCut), line.subarray(lineCut))))
  assert.deepEqual(lines, [`line with ${oDotBelow.toString('utf8')}`])
})

test('CRLF endings and a leading colon are read the way the whole-body parser reads them', async () => {
  const body = [
    ': keep-alive, not an event',
    'event: note',
    'data: first line',
    'data: second line',
    '',
    ': another comment, with no data at all',
    '',
    'event: final',
    'data: last',
    '',
  ].join('\r\n')

  /*
   * The cut falls between a carriage return and its line feed, which is exactly
   * where a chunk boundary lands on a slow socket. A reader that treated `\r\n` as
   * two endings would invent a blank line here and split one event into two.
   */
  const cut = body.indexOf('\r') + 1
  const streamed = await drain(api.parseSseStream(chunksOf(
    Buffer.from(body.slice(0, cut), 'utf8'),
    Buffer.from(body.slice(cut), 'utf8'),
  )))

  // The same body through both readers: the streamed path must not be a second
  // interpretation of the event-stream rules.
  assert.deepEqual(streamed, [...api.parseSse(body)])
  assert.deepEqual(streamed, [
    { event: 'note', data: 'first line\nsecond line' },
    { event: 'final', data: 'last' },
  ])

  // A comment carries no event, so the keep-alive produced nothing at all: drawn as
  // an event it would put an empty delta on the screen.
  assert.equal(streamed.length, 2)
  assert.equal(streamed.some((event) => event.data.includes('keep-alive')), false)
  assert.equal(streamed.some((event) => event.data.includes('another comment')), false)
})

/* ------------------------------------------------------------------ *
 * The adapters that read a stream
 * ------------------------------------------------------------------ */

test('an anthropic delta arrives before the second half of the reply body exists', async () => {
  const gate = deferred()
  const progress = { released: false, finished: false }

  async function* open () {
    yield Buffer.from(anthropicStart(), 'utf8')
    yield Buffer.from(anthropicDelta('Hello'), 'utf8')
    await gate.promise
    progress.released = true
    yield Buffer.from(anthropicDelta(' there'), 'utf8')
    yield Buffer.from(anthropicEnd(), 'utf8')
    progress.finished = true
  }

  const wholeBody = anthropicStart() + anthropicDelta('Hello') + anthropicDelta(' there') + anthropicEnd()
  const transport = streamingTransport(open, wholeBody)
  const provider = anthropicWith(transport)

  const seen = []
  for await (const delta of provider.stream(chatRequest(ANTHROPIC_MODEL), ctxFor(provider))) {
    if (delta.type !== 'text') continue
    seen.push(delta.text)

    if (seen.length === 1) {
      /*
       * The ordering the whole feature exists for. The body source is parked on the
       * gate, so the delta just received cannot be a fragment of a reply that was
       * read to its end before the first word was shown.
       */
      assert.equal(progress.released, false, 'the first delta only appeared after the gate was released')
      assert.equal(progress.finished, false, 'the body had already ended when the first delta arrived')
      gate.release()
    }
  }

  assert.deepEqual(seen, ['Hello', ' there'])
  // Reaching the second delta at all means the gate was what held it back, not a
  // missing second chunk.
  assert.equal(progress.released, true)
  assert.equal(progress.finished, true)

  assert.equal(transport.state.streamRead, true, 'the byte door was never used')
  assert.equal(transport.state.wholeBodyRead, false, 'the reply was read as one string')
})

test('ollama hands each record on as it arrives instead of after the last one', async () => {
  const gate = deferred()
  const progress = { released: false, finished: false }

  async function* open () {
    yield Buffer.from(ollamaRecord('Hel'), 'utf8')
    await gate.promise
    progress.released = true
    yield Buffer.from(ollamaRecord('lo!') + OLLAMA_END, 'utf8')
    progress.finished = true
  }

  const wholeBody = ollamaRecord('Hel') + ollamaRecord('lo!') + OLLAMA_END
  const transport = streamingTransport(open, wholeBody)
  const provider = ollamaWith(transport)

  const seen = []
  let result = null
  for await (const delta of provider.stream(chatRequest(OLLAMA_MODEL), ctxFor(provider))) {
    if (delta.type === 'text') {
      seen.push(delta.text)
      if (seen.length === 1) {
        // This protocol answers in newline-delimited JSON rather than events, so
        // the proof is the same and the reader above is a different one.
        assert.equal(progress.released, false, 'the first record only appeared after the gate was released')
        assert.equal(progress.finished, false, 'the body had already ended when the first record arrived')
        gate.release()
      }
      continue
    }
    if (delta.type === 'done') result = delta.result
  }

  assert.deepEqual(seen, ['Hel', 'lo!'])
  assert.deepEqual(result.parts, [{ type: 'text', text: 'Hello!' }])
  assert.deepEqual(result.usage, { in: 26, out: 4 })
  assert.equal(result.finishReason, 'stop')

  assert.equal(transport.state.streamRead, true, 'the byte door was never used')
  assert.equal(transport.state.wholeBodyRead, false, 'the newline-delimited body was read as one string')
})

/* ------------------------------------------------------------------ *
 * The transport that offers no stream
 * ------------------------------------------------------------------ */

test('a transport with only a whole body still streams through the same adapters', async () => {
  /*
   * A recorded fixture, and the guarded transport when it cannot pass bytes on,
   * both look like this: `text()` and nothing else. The adapters must then take the
   * fallback route rather than fail or hang, or every recorded reply would stop
   * working the day streaming arrived.
   */
  const anthropicBody = anthropicStart() + anthropicDelta('Hello') + anthropicDelta(' there') + anthropicEnd()
  const anthropicTransport = wholeBodyTransport(anthropicBody)
  const anthropicProvider = anthropicWith(anthropicTransport)

  const anthropicDeltas = await drain(
    anthropicProvider.stream(chatRequest(ANTHROPIC_MODEL), ctxFor(anthropicProvider)),
  )
  const anthropicText = anthropicDeltas.filter((delta) => delta.type === 'text').map((delta) => delta.text)
  assert.deepEqual(anthropicText, ['Hello', ' there'])

  const anthropicDone = anthropicDeltas[anthropicDeltas.length - 1]
  assert.equal(anthropicDone.type, 'done')
  assert.deepEqual(anthropicDone.result.parts, [{ type: 'text', text: 'Hello there' }])
  assert.equal(anthropicDone.result.finishReason, 'stop')

  // And the response really did have no `bytes`, so the route above was the fallback.
  assert.equal(Object.hasOwn(anthropicTransport.calls[0].response, 'bytes'), false)

  const ollamaBody = ollamaRecord('Hel') + ollamaRecord('lo!') + OLLAMA_END
  const ollamaTransport = wholeBodyTransport(ollamaBody)
  const ollamaProvider = ollamaWith(ollamaTransport)

  const ollamaDeltas = await drain(ollamaProvider.stream(chatRequest(OLLAMA_MODEL), ctxFor(ollamaProvider)))
  assert.deepEqual(
    ollamaDeltas.filter((delta) => delta.type === 'text').map((delta) => delta.text),
    ['Hel', 'lo!'],
  )
  assert.deepEqual(ollamaDeltas[ollamaDeltas.length - 1].result.parts, [{ type: 'text', text: 'Hello!' }])

  assert.equal(Object.hasOwn(ollamaTransport.calls[0].response, 'bytes'), false)
})
