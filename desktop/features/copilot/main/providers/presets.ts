/*
 * The provider catalogue, as data.
 *
 * Section 9.1 of the plan names Anthropic and one configurable
 * OpenAI-compatible adapter. Seven entries in this file are that one adapter
 * pointed at seven services: OpenAI, DeepSeek, Kimi, Together, OpenRouter,
 * LM Studio and a custom endpoint. What differs between them is the base URL,
 * the header a key goes in, the three paths, the default model and the default
 * capability profile - and none of that is code, so adding the eighth entry
 * cannot add a code path that skipped the guard or the contract suite.
 *
 * The capability numbers below are defaults, not promises. A model list usually
 * says more than the table can (OpenRouter reports each model's context length
 * and accepted parameters, LM Studio reports whether an entry is a chat or an
 * embedding model), and `capabilities.ts` lets that evidence win.
 */

import type { ProviderCapabilities } from '../../shared/providers/types.js'
import type { AuthStyle } from './wire.js'

export type ProviderKind = 'anthropic' | 'openai-compatible' | 'ollama'

/** Which extra facts this provider's model list reports about each model. */
export type ProbeStyle = 'none' | 'openrouter' | 'lmstudio' | 'ollama'

export interface ModelRule {
  /** Matched against the model id, first match wins. */
  readonly match: RegExp
  readonly capabilities: Partial<ProviderCapabilities>
}

export interface ProviderPaths {
  readonly models: string
  readonly chat: string
  /** Null when the provider has no embedding endpoint at all. */
  readonly embeddings: string | null
  /**
   * The route that loads or releases a resident model, when the provider has one.
   *
   * Only a server that keeps models in memory between calls has a use for it, so
   * it is absent for every hosted service.
   */
  readonly load?: string
}

export interface ProviderPreset {
  /** Short id, unique in this catalogue. */
  readonly id: string
  readonly label: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  /** Empty when the provider has no model that can be assumed: the person picks one. */
  readonly defaultModel: string
  readonly auth: AuthStyle
  /** False for a local server or a gateway that takes no key. */
  readonly requiresKey: boolean
  readonly paths: ProviderPaths
  readonly extraHeaders: Readonly<Record<string, string>>
  /** What a model of this provider can do before its model list says otherwise. */
  readonly capabilities: ProviderCapabilities
  readonly modelRules: readonly ModelRule[]
  readonly probe: ProbeStyle
  /** Anthropic requires a protocol version header on every request. */
  readonly apiVersion?: string
  /**
   * The field that caps output tokens.
   *
   * Defaults to `max_tokens`. OpenAI's newer chat models refuse that name and
   * want `max_completion_tokens`; most compatible servers only understand the
   * older one, so this is a preset fact rather than a global choice.
   */
  readonly maxTokensField?: 'max_tokens' | 'max_completion_tokens'
  /**
   * Whether the server accepts `stream_options.include_usage`.
   *
   * Without it a streamed reply carries no token counts and the ledger records
   * zeros. A strict compatible server may reject the unknown field, so it is
   * opt-in per preset.
   */
  readonly streamUsage?: boolean
  /**
   * How long a local server should keep a model resident, in its own notation.
   *
   * Meaningless to a hosted service, which has no such notion, so it is absent
   * for all of them.
   */
  readonly keepAlive?: string
}

/**
 * An embedding model is a different shape of thing: it cannot chat, stream a
 * reply, or call a tool. `maxOutput` is 1 because the contract requires a
 * positive number and an embedding produces no output tokens.
 */
const EMBEDDING_MODEL: Partial<ProviderCapabilities> = Object.freeze({
  contextWindow: 8_191,
  maxOutput: 1,
  tools: 'none',
  vision: false,
  webSearch: false,
  streaming: false,
  embeddings: true,
  jsonMode: false,
})

const ANTHROPIC: ProviderPreset = Object.freeze({
  id: 'anthropic',
  label: 'Anthropic',
  kind: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  defaultModel: 'claude-sonnet-4-5',
  auth: { kind: 'api-key' as const, header: 'x-api-key' },
  requiresKey: true,
  paths: { models: '/v1/models', chat: '/v1/messages', embeddings: null },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 200_000,
    maxOutput: 8_192,
    tools: 'native',
    vision: true,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
  }),
  modelRules: Object.freeze([
    { match: /haiku/i, capabilities: { maxOutput: 8_192 } },
    { match: /sonnet-4|opus-4/i, capabilities: { maxOutput: 32_000 } },
    { match: /claude-3/i, capabilities: { contextWindow: 200_000, maxOutput: 4_096 } },
  ]),
  probe: 'none',
  apiVersion: '2023-06-01',
})

const OPENAI: ProviderPreset = Object.freeze({
  id: 'openai',
  label: 'OpenAI',
  kind: 'openai-compatible',
  baseUrl: 'https://api.openai.com',
  defaultModel: 'gpt-4.1',
  auth: { kind: 'bearer' as const },
  requiresKey: true,
  paths: { models: '/v1/models', chat: '/v1/chat/completions', embeddings: '/v1/embeddings' },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 128_000,
    maxOutput: 16_384,
    tools: 'native',
    vision: true,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  }),
  maxTokensField: 'max_completion_tokens',
  streamUsage: true,
  modelRules: Object.freeze([
    // An embedding model reached through a chat route would silently look like
    // a very old chat model; say what it is instead.
    { match: /^text-embedding/i, capabilities: EMBEDDING_MODEL },
    { match: /^gpt-3\.5/i, capabilities: { vision: false, jsonMode: true } },
    // The reasoning models refuse response_format, so a caller asking for JSON
    // mode gets a clear refusal instead of a rejected request.
    { match: /^o[1-9]/i, capabilities: { jsonMode: false } },
  ]),
  probe: 'none',
})

const DEEPSEEK: ProviderPreset = Object.freeze({
  id: 'deepseek',
  label: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-chat',
  auth: { kind: 'bearer' as const },
  requiresKey: true,
  paths: { models: '/models', chat: '/chat/completions', embeddings: null },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 64_000,
    maxOutput: 8_192,
    tools: 'native',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  }),
  modelRules: Object.freeze([
    // The reasoner exposes no function calling and no JSON mode.
    { match: /reasoner/i, capabilities: { tools: 'none' as const, jsonMode: false } },
  ]),
  probe: 'none',
  streamUsage: true,
})

const KIMI: ProviderPreset = Object.freeze({
  id: 'kimi',
  label: 'Kimi (Moonshot)',
  kind: 'openai-compatible',
  baseUrl: 'https://api.moonshot.ai/v1',
  defaultModel: 'kimi-k2-0905-preview',
  auth: { kind: 'bearer' as const },
  requiresKey: true,
  paths: { models: '/models', chat: '/chat/completions', embeddings: null },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 256_000,
    maxOutput: 16_384,
    tools: 'native',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  }),
  modelRules: Object.freeze([
    { match: /^moonshot-v1-8k/, capabilities: { contextWindow: 8_192, maxOutput: 2_048 } },
    { match: /^moonshot-v1-32k/, capabilities: { contextWindow: 32_768, maxOutput: 8_192 } },
    { match: /^moonshot-v1-128k/, capabilities: { contextWindow: 128_000, maxOutput: 8_192 } },
  ]),
  probe: 'none',
})

const TOGETHER: ProviderPreset = Object.freeze({
  id: 'together',
  label: 'Together',
  kind: 'openai-compatible',
  baseUrl: 'https://api.together.xyz/v1',
  defaultModel: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
  auth: { kind: 'bearer' as const },
  requiresKey: true,
  paths: { models: '/models', chat: '/chat/completions', embeddings: '/embeddings' },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 32_768,
    maxOutput: 8_192,
    tools: 'native',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  }),
  modelRules: Object.freeze([
    { match: /embed|bge/i, capabilities: EMBEDDING_MODEL },
    { match: /vl$|-vl-|vision/i, capabilities: { vision: true } },
  ]),
  probe: 'none',
  streamUsage: true,
})

const OPENROUTER: ProviderPreset = Object.freeze({
  id: 'openrouter',
  label: 'OpenRouter',
  kind: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-4.1',
  auth: { kind: 'bearer' as const },
  requiresKey: true,
  paths: { models: '/models', chat: '/chat/completions', embeddings: '/embeddings' },
  // OpenRouter attributes traffic by these headers; neither carries a secret.
  extraHeaders: Object.freeze({ 'X-Title': 'Zuri' }),
  capabilities: Object.freeze({
    contextWindow: 128_000,
    maxOutput: 8_192,
    tools: 'native',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: true,
  }),
  modelRules: Object.freeze([]),
  // Every OpenRouter model publishes its context length and accepted
  // parameters, so the model list is the better answer than any table here.
  probe: 'openrouter',
  streamUsage: true,
})

const LM_STUDIO: ProviderPreset = Object.freeze({
  id: 'lmstudio',
  label: 'LM Studio',
  kind: 'openai-compatible',
  // Loopback by default. A person may point this at another machine, and the
  // guard's own address check - not this string - decides local from cloud.
  baseUrl: 'http://127.0.0.1:1234/v1',
  defaultModel: '',
  auth: { kind: 'none' as const },
  requiresKey: false,
  paths: { models: '/models', chat: '/chat/completions', embeddings: '/embeddings' },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 32_768,
    maxOutput: 8_192,
    // LM Studio's tool support depends on the loaded model and its template,
    // so the safe default asks for JSON and validates it. The model list can
    // promote this to native when it says otherwise.
    tools: 'prompted',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
  }),
  modelRules: Object.freeze([]),
  probe: 'lmstudio',
})

const CUSTOM: ProviderPreset = Object.freeze({
  id: 'custom',
  label: 'Custom OpenAI-compatible',
  kind: 'openai-compatible',
  // Supplied by the person when the entry is created.
  baseUrl: '',
  defaultModel: '',
  auth: { kind: 'bearer' as const },
  requiresKey: false,
  paths: { models: '/v1/models', chat: '/v1/chat/completions', embeddings: null },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    contextWindow: 32_768,
    maxOutput: 8_192,
    tools: 'prompted',
    vision: false,
    webSearch: false,
    streaming: true,
    embeddings: false,
    jsonMode: false,
  }),
  modelRules: Object.freeze([]),
  // Unknown servers are not trusted to describe themselves; the person can pick
  // a different preset if the endpoint is one of the known services.
  probe: 'none',
})

const OLLAMA: ProviderPreset = Object.freeze({
  id: 'ollama',
  label: 'Ollama',
  kind: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  // Empty on purpose: a fresh install has nothing pulled, and naming a model the
  // person never chose would fail the first call with an unfamiliar id.
  defaultModel: '',
  // A bare local server takes no key, so none is required. The style is bearer
  // rather than none because a reverse proxy in front of one may demand a key,
  // and then a credential that was entered has somewhere to go.
  auth: { kind: 'bearer' as const },
  requiresKey: false,
  paths: {
    models: '/api/tags',
    chat: '/api/chat',
    embeddings: '/api/embed',
    load: '/api/generate',
  },
  extraHeaders: Object.freeze({}),
  capabilities: Object.freeze({
    // The server does not publish its context window through the model list, and
    // its own default varies by build. The smaller figure is used so the app
    // refuses an oversized prompt instead of letting a server truncate it.
    contextWindow: 4_096,
    maxOutput: 2_048,
    // Not every pulled model can call tools, and the list does not always say.
    // Asking for JSON and validating it works on any model; the model list
    // promotes this to native when the server reports tool support.
    tools: 'prompted',
    vision: false,
    webSearch: false,
    streaming: true,
    // An embedding model is a separate pull from a chat model, so this is off
    // until a model says otherwise.
    embeddings: false,
    jsonMode: true,
  }),
  modelRules: Object.freeze([
    {
      // An embedding model's id carries its family, and these are the families
      // that produce vectors rather than chat. A model whose list entry reports
      // its own capability list overrides this either way.
      match: /(?:^|[/:_-])(bert|embed|bge|mxbai|nomic)/i,
      capabilities: EMBEDDING_MODEL,
    },
  ]),
  probe: 'ollama',
  keepAlive: '5m',
})

/** Every provider this build knows how to talk to. */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = Object.freeze([
  ANTHROPIC,
  OPENAI,
  DEEPSEEK,
  KIMI,
  TOGETHER,
  OPENROUTER,
  LM_STUDIO,
  OLLAMA,
  CUSTOM,
])

export function findPreset(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null
}

/**
 * The id a provider reports, which is also its `providerId` everywhere else.
 *
 * The compatible services share one adapter, so their ids carry the adapter and
 * the preset: two OpenRouter entries with different keys stay distinguishable
 * in the ledger and in the audit trail.
 */
export function providerIdFor(preset: ProviderPreset): string {
  if (preset.kind === 'anthropic') return 'anthropic'
  if (preset.kind === 'ollama') return 'ollama'
  return `openai-compatible:${preset.id}`
}
