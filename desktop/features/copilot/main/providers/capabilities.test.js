'use strict'

/*
 * Capability resolution is what makes "unsupported features fail clearly" true.
 * These cases pin the three sources and their order: preset default, model rule,
 * then what the model list reported.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

test('a model list without a list is a malformed reply, an empty one is not', () => {
  assert.throws(
    () => api.parseModelList({ object: 'list' }),
    (error) => error instanceof api.ProviderError && error.failure === 'malformed_response',
  )
  assert.deepEqual(api.parseModelList({ data: [] }), [])

  const entries = api.parseModelList({
    data: [{ id: 'a', display_name: 'Model A' }, { name: 'b' }, { notAnId: true }],
  })
  assert.deepEqual(entries, [
    { id: 'a', label: 'Model A', raw: { id: 'a', display_name: 'Model A' } },
    { id: 'b', label: 'b', raw: { name: 'b' } },
  ])

  assert.equal(api.parseModelList([{ id: 'bare-array' }]).length, 1)
  assert.equal(api.parseModelList({ models: [{ id: 'gateway' }] }).length, 1)
})

test('OpenRouter metadata overrides the preset table', () => {
  const preset = api.findPreset('openrouter')
  const entry = {
    id: 'vendor/model-x',
    context_length: 64000,
    architecture: { input_modalities: ['text', 'image'] },
    supported_parameters: ['tools', 'response_format'],
    top_provider: { max_completion_tokens: 4096 },
  }

  const models = api.modelsFromPayload(preset, api.providerIdFor(preset), true, { data: [entry] })

  assert.deepEqual(models[0].capabilities, {
    contextWindow: 64000,
    maxOutput: 4096,
    tools: 'native',
    vision: true,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  })
  assert.equal(models[0].cloud, true)
  assert.equal(models[0].providerId, 'openai-compatible:openrouter')
})

test('a model that does not accept tools is not advertised as able to', () => {
  const preset = api.findPreset('openrouter')
  const models = api.modelsFromPayload(preset, api.providerIdFor(preset), true, {
    data: [{ id: 'vendor/plain', supported_parameters: ['temperature'] }],
  })

  assert.equal(models[0].capabilities.tools, 'none')
  assert.equal(models[0].capabilities.jsonMode, false)
})

test('LM Studio entry types become embedding and vision facts', () => {
  const preset = api.findPreset('lmstudio')
  const models = api.modelsFromPayload(preset, api.providerIdFor(preset), false, {
    data: [
      { id: 'nomic-embed', type: 'embeddings' },
      { id: 'qwen-vl', type: 'vlm', max_context_length: 32768 },
      { id: 'plain', type: 'llm', capabilities: ['tool_use'] },
    ],
  })

  assert.equal(models[0].capabilities.embeddings, true)
  assert.equal(models[0].capabilities.tools, 'none')
  assert.equal(models[0].cloud, false)
  assert.equal(models[1].capabilities.vision, true)
  assert.equal(models[1].capabilities.contextWindow, 32768)
  assert.equal(models[2].capabilities.tools, 'native')
})

test('a preset rule wins over the provider default, and evidence wins over both', () => {
  const preset = api.findPreset('openai')

  const defaulted = api.resolveCapabilities(preset, 'gpt-4.1')
  assert.equal(defaulted.contextWindow, 128000)
  assert.equal(defaulted.jsonMode, true)

  const reasoning = api.resolveCapabilities(preset, 'o3-mini')
  assert.equal(reasoning.jsonMode, false)

  const evidence = api.resolveCapabilities(preset, 'o3-mini', { jsonMode: true, contextWindow: 1000 })
  assert.equal(evidence.jsonMode, true)
  assert.equal(evidence.contextWindow, 1000)
})

test('one rule is applied, so a model cannot be half of two families', () => {
  const preset = api.findPreset('together')
  // Matches both the embedding rule and the vision rule; the first one wins.
  const capabilities = api.resolveCapabilities(preset, 'BAAI/bge-vl-embed')
  assert.equal(capabilities.embeddings, true)
  assert.equal(capabilities.streaming, false)
})

test('the output budget is capped by the model, never invented', () => {
  const capabilities = api.resolveCapabilities(api.findPreset('anthropic'), 'claude-sonnet-4-5')
  assert.equal(api.outputBudget(undefined, capabilities), capabilities.maxOutput)
  assert.equal(api.outputBudget(100, capabilities), 100)
  assert.equal(api.outputBudget(10_000_000, capabilities), capabilities.maxOutput)
  assert.equal(api.outputBudget(0, capabilities), capabilities.maxOutput)
})

test('an endpoint is classified by its address, not its name', () => {
  assert.equal(api.endpointIsCloud('http://127.0.0.1:1234/v1'), false)
  assert.equal(api.endpointIsCloud('http://localhost:11434'), false)
  assert.equal(api.endpointIsCloud('http://192.168.1.20:1234/v1'), false)
  assert.equal(api.endpointIsCloud('https://api.openai.com'), true)
  // A URL this module cannot parse is treated as cloud: refusing is the safe
  // answer for a local-only business.
  assert.equal(api.endpointIsCloud(''), true)
  assert.equal(api.endpointIsCloud('not a url'), true)
})
