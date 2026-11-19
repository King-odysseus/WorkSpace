'use strict'

/*
 * The Models screen's decisions, tested through the bundle Electron loads.
 *
 * The screen itself is React, and the desktop package runs node's runner with no
 * DOM, so every sentence a person reads on that page is produced by
 * `models-screen.ts`. That makes these tests the only place the wording, the
 * ordering and the honesty of the page can be checked, and three of them exist
 * because of a specific way a settings page goes wrong:
 *
 * - A card that looks configured but refuses every call. The endpoint, the key
 *   and the starting model are the three things the service checks, so the
 *   readiness answer is computed from the same three facts and from nothing else.
 * - A chip that promises a capability the provider never reported, which is only
 *   discovered at the first failed tool call or the first rejected image.
 * - A connection line that reports health it never checked, or a refusal that
 *   reaches the screen as a token such as `missing_credential`.
 *
 * The fixtures are parsed by the contract's own schemas, so a fixture cannot
 * prove something about an entry or a capability profile the app could not
 * actually produce.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

/** One stored provider entry, as the screen receives it: no key, only its tail. */
function entry (overrides = {}) {
  return api.providerEntrySchema.parse({
    presetId: 'anthropic',
    providerId: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    local: false,
    requiresKey: true,
    hasCredential: true,
    fingerprint: 'c0de',
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

/* ------------------------------------------------------------------ *
 * Is this entry usable?
 * ------------------------------------------------------------------ */

test('an entry with no endpoint is reported as needing one, even when a key is stored', () => {
  for (const baseUrl of ['', ' ', '   ', '\t\n']) {
    const view = api.availability(entry({ baseUrl, hasCredential: true }))
    // A stored key cannot be sent anywhere without an endpoint, so the missing
    // endpoint is the fact worth showing, not the key that was already given.
    assert.equal(view.tone, 'needs-endpoint', `baseUrl ${JSON.stringify(baseUrl)}`)
    assert.equal(view.label, 'Add an address')
  }
})

test('a key is required only where the catalogue says one is required', () => {
  const missing = api.availability(entry({ requiresKey: true, hasCredential: false }))
  assert.deepEqual(missing, { tone: 'needs-key', label: 'Add a key' })

  const stored = api.availability(entry({ requiresKey: true, hasCredential: true }))
  assert.deepEqual(stored, { tone: 'ready', label: 'Ready' })

  // A local server takes no key, and a null credential is the normal state
  // rather than a gap, which is why the answer reads `requiresKey` at all.
  const local = api.availability(entry({
    presetId: 'ollama',
    providerId: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:7b',
    local: true,
    requiresKey: false,
    hasCredential: false,
    fingerprint: null,
  }))
  assert.deepEqual(local, { tone: 'ready', label: 'Ready' })
})

test('an entry with an endpoint and a key but no model is reported as needing a model', () => {
  for (const defaultModel of ['', '  ']) {
    const view = api.availability(entry({ defaultModel, hasCredential: true }))
    assert.equal(view.tone, 'needs-model', `defaultModel ${JSON.stringify(defaultModel)}`)
    assert.equal(view.label, 'Choose a model')
  }

  // The order is the point: a key that is missing is reported before a model
  // that is missing, because testing the endpoint needs the key first.
  assert.equal(api.availability(entry({ hasCredential: false, defaultModel: '' })).tone, 'needs-key')
})

/* ------------------------------------------------------------------ *
 * Where the bytes go
 * ------------------------------------------------------------------ */

test('the origin label is the endpoint\'s own answer, worded for a person', () => {
  assert.equal(api.originLabel(true), 'Cloud')
  assert.equal(api.originLabel(false), 'Local')
})

/* ------------------------------------------------------------------ *
 * Capability chips
 * ------------------------------------------------------------------ */

test('the capability chips describe only what the provider reported, in a fixed order', () => {
  // One fully capable model and one that can do almost nothing. These two pin
  // the exact arrays, so a chip that appears, disappears or moves is a failure
  // rather than something a reader of the diff has to notice.
  assert.deepEqual(
    api.capabilityChips(capabilities({
      tools: 'native', vision: true, jsonMode: true, embeddings: true, streaming: true,
    })),
    ['Tools', 'Images', 'JSON', 'Embeddings'],
  )

  assert.deepEqual(
    api.capabilityChips(capabilities({
      tools: 'none', vision: false, jsonMode: false, embeddings: false, streaming: false,
    })),
    ['No tools', 'No streaming'],
  )

  // A guided tool call is a weaker promise than a native one, so it gets its own
  // chip: calling both "Tools" would overstate the weaker model.
  assert.deepEqual(
    api.capabilityChips(capabilities({
      tools: 'prompted', vision: false, jsonMode: false, embeddings: false, streaming: true,
    })),
    ['Tools (guided)'],
  )

  // Everything on at once with streaming off, so the tail of the order is pinned
  // as well as the head.
  assert.deepEqual(
    api.capabilityChips(capabilities({
      tools: 'native', vision: true, jsonMode: true, embeddings: true, streaming: false,
    })),
    ['Tools', 'Images', 'JSON', 'Embeddings', 'No streaming'],
  )
})

/* ------------------------------------------------------------------ *
 * The context window
 * ------------------------------------------------------------------ */

test('a context window reads as a compact figure, with a k only once it is thousands', () => {
  assert.equal(api.contextLabel(128_000), '128k context')
  assert.equal(api.contextLabel(4_096), '4k context')
  // A small window keeps its number: "0k context" would be nonsense, and the
  // figure is the only thing that tells a person it is a small model.
  assert.equal(api.contextLabel(400), '400 context')
})

/* ------------------------------------------------------------------ *
 * The connection line
 * ------------------------------------------------------------------ */

test('the connection line is honest about each of its four states', () => {
  const idle = api.connectionView('idle')
  assert.equal(idle.tone, 'idle')
  assert.match(idle.message, /not tested/i)

  const testing = api.connectionView('testing')
  assert.equal(testing.tone, 'testing')
  assert.match(testing.message, /testing/i)

  // A result carries the count and the endpoint's own classification, so the
  // line must repeat both rather than a bare "connected".
  const cloud = api.connectionView('ok', { ok: true, modelCount: 3, cloud: true })
  assert.equal(cloud.tone, 'ok')
  assert.match(cloud.message, /3 models/)
  assert.match(cloud.message, /cloud/)

  const local = api.connectionView('ok', { ok: true, modelCount: 1, cloud: false })
  assert.match(local.message, /1 model\b/)
  assert.match(local.message, /local/)

  // A refusal is a fixed sentence, never the provider's wording and never the
  // token: a raw `network` on screen tells a person nothing they can act on.
  const failed = api.connectionView('failed', { ok: false, failure: 'network' })
  assert.equal(failed.tone, 'failed')
  assert.equal(failed.message, api.failureMessage('network'))
  assert.match(failed.message, /could not be reached/)
  assert.equal(failed.message.includes('network'), false)
  assert.equal(failed.message.includes('_'), false)

  // A failure with no result to explain still says something true.
  const unexplained = api.connectionView('failed')
  assert.equal(unexplained.tone, 'failed')
  assert.equal(unexplained.message, api.failureMessage('internal_error'))
})

test('a successful state carrying a failed result does not claim a connection', () => {
  // The two states come from different places: the tone from the button, the
  // result from the call. A result that says it failed must never be drawn as a
  // connection, with a count and an origin that were never observed.
  const view = api.connectionView('ok', { ok: false, failure: 'network' })

  assert.equal(view.message.includes('Connected'), false)
  // No count and no origin word, because there was no answer to describe.
  assert.equal(/\d/.test(view.message), false)
  assert.notEqual(view.message, api.connectionView('ok', { ok: true, modelCount: 0, cloud: true }).message)
})

/* ------------------------------------------------------------------ *
 * The key box after a submit
 * ------------------------------------------------------------------ */

test('the key box is cleared only after a successful submit', () => {
  assert.equal(api.secretFieldAfter(true), 'clear')
  // Keeping it on a refusal is deliberate: clearing would delete what the person
  // typed and leave them unable to tell a bad key from a key that never left.
  assert.equal(api.secretFieldAfter(false), 'keep')
})

/* ------------------------------------------------------------------ *
 * Refusal sentences
 * ------------------------------------------------------------------ */

test('every refusal token has its own sentence, and no sentence is a token or a URL', () => {
  const failures = api.PROVIDER_SETTINGS_FAILURES
  // Read from the contract rather than written out here, so a token added in a
  // newer build fails this test instead of shipping without a sentence.
  assert.ok(failures.length > 0, 'the contract lists no failure tokens')

  const sentences = failures.map((token) => api.failureMessage(token))
  assert.equal(new Set(sentences).size, failures.length, 'two tokens share one sentence')

  for (const [index, token] of failures.entries()) {
    const message = sentences[index]
    assert.equal(typeof message, 'string', `${token}: not a sentence`)
    assert.ok(message.trim().length > 1, `${token}: the sentence is empty`)
    // An identifier on screen is a bug report the person cannot file.
    assert.equal(message.includes(token), false, `${token}: the token reached the screen`)
    assert.equal(message.includes('_'), false, `${token}: the sentence carries an identifier`)
    assert.equal(/https?:\/\//i.test(message), false, `${token}: the sentence carries a URL`)
    assert.equal(message.includes('://'), false, `${token}: the sentence carries a URL`)
    // Long dashes do not render everywhere this text is shown.
    assert.equal(/[\u2013\u2014]/.test(message), false, `${token}: the sentence carries a long dash`)
  }

  // A token from a newer main process falls through to the generic sentence
  // rather than appearing raw.
  const unknown = api.failureMessage('a_token_this_build_does_not_have')
  assert.ok(unknown.trim().length > 1)
  assert.equal(unknown.includes('_'), false)
  assert.equal(sentences.includes(unknown), false)
})

/* ------------------------------------------------------------------ *
 * An empty model list
 * ------------------------------------------------------------------ */

test('an empty model list names the provider and where it looked', () => {
  const cloud = api.modelsEmptyMessage('OpenAI', true)
  const local = api.modelsEmptyMessage('Ollama', false)

  assert.match(cloud, /OpenAI/)
  assert.match(local, /Ollama/)

  // Cloud and local are different problems with different next steps: a hosted
  // account with nothing enabled, or a server on this machine with nothing
  // pulled. One sentence for both would tell half the people the wrong thing.
  assert.match(cloud, /endpoint/)
  assert.match(local, /local server/)
  assert.notEqual(cloud, local)
})
