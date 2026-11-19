'use strict'

/*
 * The catalogue is data, so the checks are about the data being coherent: an
 * endpoint per entry, a model per entry, no entry that would send a key nowhere,
 * and two entries that can never collide in the ledger.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

test('every provider this build knows is in the catalogue exactly once', () => {
  const presets = api.PROVIDER_PRESETS
  assert.equal(presets.length, 9)

  const ids = presets.map((preset) => preset.id)
  assert.deepEqual(
    ids.slice().sort(),
    ['anthropic', 'custom', 'deepseek', 'kimi', 'lmstudio', 'ollama', 'openai', 'openrouter', 'together'],
  )
  assert.equal(new Set(ids).size, ids.length)

  const providerIds = presets.map((preset) => api.providerIdFor(preset))
  assert.equal(new Set(providerIds).size, providerIds.length)
  for (const preset of presets) {
    // Each kind names its own id. The two local kinds speak protocols of their
    // own, so neither may be filed under the compatible one.
    const expected = preset.kind === 'anthropic'
      ? 'anthropic'
      : preset.kind === 'ollama'
        ? 'ollama'
        : `openai-compatible:${preset.id}`
    assert.equal(api.providerIdFor(preset), expected, preset.id)
  }
})

test('a key is required where it is needed and never required where it is not', () => {
  const requiresKey = new Set(
    api.PROVIDER_PRESETS.filter((preset) => preset.requiresKey).map((preset) => preset.id),
  )
  // OpenAI, DeepSeek, Kimi, Together, OpenRouter and Anthropic need a key. A
  // local server and a gateway the person runs do not.
  assert.deepEqual(
    [...requiresKey].sort(),
    ['anthropic', 'deepseek', 'kimi', 'openai', 'openrouter', 'together'],
  )
  for (const preset of api.PROVIDER_PRESETS) {
    // The custom entry and a local server may both take an optional bearer key,
    // so their style is not 'none' even though no key is required: a credential
    // that was entered has somewhere to go, and its absence is not an error.
    const optionalKey = new Set(['custom', 'ollama'])
    if (!preset.requiresKey && !optionalKey.has(preset.id)) assert.equal(preset.auth.kind, 'none')
  }
})

test('each entry has a usable endpoint and the paths it needs', () => {
  for (const preset of api.PROVIDER_PRESETS) {
    if (preset.id === 'custom') {
      // The custom entry is filled in by the person, so it deliberately has no
      // endpoint until then.
      assert.equal(preset.baseUrl, '')
      continue
    }
    assert.ok(preset.baseUrl.startsWith('https://') || preset.baseUrl.startsWith('http://'), preset.id)
    assert.ok(preset.paths.models.startsWith('/'), preset.id)
    assert.ok(preset.paths.chat.startsWith('/'), preset.id)
    if (preset.paths.embeddings !== null) assert.ok(preset.paths.embeddings.startsWith('/'), preset.id)
    // A local server has no model until one is pulled or loaded, and the custom
    // entry has none until the person names one. Naming a model nobody has would
    // fail the first call with an id the person never chose.
    if (!['lmstudio', 'ollama'].includes(preset.id)) assert.ok(preset.defaultModel.length > 0, preset.id)
  }

  // Only the local servers may point at this machine by default.
  assert.equal(api.findPreset('lmstudio').baseUrl, 'http://127.0.0.1:1234/v1')
  assert.equal(api.endpointIsCloud(api.findPreset('lmstudio').baseUrl), false)
  assert.equal(api.findPreset('ollama').baseUrl, 'http://127.0.0.1:11434')
  assert.equal(api.endpointIsCloud(api.findPreset('ollama').baseUrl), false)
  assert.equal(api.endpointIsCloud('https://api.openai.com'), true)
})

test('a preset carries no credential-shaped field', () => {
  for (const preset of api.PROVIDER_PRESETS) {
    const keys = Object.keys(preset)
    for (const forbidden of ['credential', 'apiKey', 'key', 'token', 'secret']) {
      assert.equal(keys.includes(forbidden), false, `${preset.id} exposes ${forbidden}`)
    }
  }
})

test('every preset default resolves to a coherent capability profile', () => {
  for (const preset of api.PROVIDER_PRESETS) {
    const capabilities = api.resolveCapabilities(preset, preset.defaultModel)
    assert.ok(capabilities.contextWindow >= 1, preset.id)
    assert.ok(capabilities.maxOutput >= 1, preset.id)
    assert.ok(capabilities.maxOutput <= capabilities.contextWindow, preset.id)
    assert.equal(
      ['native', 'prompted', 'none'].includes(capabilities.tools),
      true,
      `${preset.id} has an unknown tool mode`,
    )
    for (const flag of ['vision', 'streaming', 'embeddings', 'jsonMode', 'webSearch']) {
      assert.equal(typeof capabilities[flag], 'boolean', `${preset.id}.${flag}`)
    }
  }
})

test('the advertised model families differ from their provider default where they must', () => {
  const embedding = api.findPreset('openai')
  assert.equal(api.resolveCapabilities(embedding, 'text-embedding-3-small').embeddings, true)
  assert.equal(api.resolveCapabilities(embedding, 'text-embedding-3-small').streaming, false)

  const reasoner = api.findPreset('deepseek')
  assert.equal(api.resolveCapabilities(reasoner, 'deepseek-reasoner').tools, 'none')
  assert.equal(api.resolveCapabilities(reasoner, 'deepseek-chat').tools, 'native')

  const anthropic = api.findPreset('anthropic')
  assert.equal(api.resolveCapabilities(anthropic, 'claude-sonnet-4-5').contextWindow, 200000)
  assert.ok(
    api.resolveCapabilities(anthropic, 'claude-sonnet-4-5').maxOutput >
      api.resolveCapabilities(anthropic, 'claude-haiku-4-5').maxOutput,
  )
})
