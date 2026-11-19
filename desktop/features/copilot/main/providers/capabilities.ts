/*
 * What a model can do, worked out from the preset and from what the provider
 * said about itself.
 *
 * Section 9.1 makes capabilities per model, because one provider serves a
 * vision model, a text-only model and an embedding model. Three sources answer
 * the question, in increasing authority:
 *
 * 1. The preset's default profile. It is the only answer available before the
 *    first network call, and it is deliberately conservative: claiming a model
 *    can stream and then failing is worse than saying it cannot.
 * 2. The preset's per-model rules, matched on the model id. This is where a
 *    known family that differs from its provider's default is described.
 * 3. The model list. OpenRouter publishes each model's context length and
 *    accepted parameters, and LM Studio says whether an entry chats or embeds.
 *    That is evidence about the model in front of us, so it wins.
 *
 * An unsupported feature is refused by the adapter before any request is sent
 * (`ProviderError('unsupported')`), which is the "fail clearly" half of the
 * acceptance rule: the person reads a sentence they can act on, and no key is
 * spent on a request the provider would have rejected anyway.
 */

import { ProviderError } from '../../shared/providers/errors.js'
import type { ModelInfo, ProviderCapabilities, ToolSupport } from '../../shared/providers/types.js'
import type { ProviderPreset } from './presets.js'
import { asArray, asNonNegativeInteger, asPositiveInteger, asRecord, asString } from './wire.js'

/** Facts a model list reported about one model. Everything here is optional. */
export interface CapabilityEvidence {
  readonly contextWindow?: number
  readonly maxOutput?: number
  readonly vision?: boolean
  readonly tools?: ToolSupport
  readonly streaming?: boolean
  readonly embeddings?: boolean
  readonly jsonMode?: boolean
}

export interface ModelListEntry {
  readonly id: string
  readonly label: string
  readonly raw: Record<string, unknown>
}

/**
 * An embedding model cannot chat, stream a reply or call a tool. `maxOutput` is
 * 1 because the capability contract requires a positive number and this model
 * produces no output tokens.
 */
const EMBEDDING_ONLY: Partial<ProviderCapabilities> = Object.freeze({
  contextWindow: 8_191,
  maxOutput: 1,
  tools: 'none',
  vision: false,
  webSearch: false,
  streaming: false,
  embeddings: true,
  jsonMode: false,
})

const MAX_MODEL_ID = 200
const MAX_LABEL = 200

/**
 * Read a model list, refusing a payload that is not one.
 *
 * Several shapes are accepted because the compatible services are not
 * identical: `{data: [...]}` (OpenAI, Anthropic, OpenRouter, LM Studio) and
 * `{models: [...]}` (some self-hosted gateways), or a bare array. Entries
 * without an id are skipped rather than guessed at; an empty list is a valid
 * answer from a local server with nothing loaded, so it is not an error.
 */
export function parseModelList(payload: unknown): ModelListEntry[] {
  const record = asRecord(payload)
  const candidate = record === null ? payload : (record.data ?? record.models)
  const list = asArray(candidate)
  if (list === null) throw new ProviderError('malformed_response')

  const entries: ModelListEntry[] = []
  for (const item of list) {
    const raw = asRecord(item)
    if (raw === null) continue

    const id = asString(raw.id) ?? asString(raw.name) ?? asString(raw.model)
    if (id === null) continue

    const label = asString(raw.display_name) ?? asString(raw.name) ?? id
    entries.push({
      id: id.slice(0, MAX_MODEL_ID),
      label: label.slice(0, MAX_LABEL),
      raw,
    })
  }
  return entries
}

/** The model ids a list marks as embedding-only, for callers that need a default. */
export function isEmbeddingEntry(preset: ProviderPreset, raw: Record<string, unknown>): boolean {
  return probeEvidence(preset, raw).embeddings === true
}

/**
 * Read the extra facts this provider's model list publishes.
 *
 * Only the fields the provider documents are read. Anything else is ignored
 * rather than inferred, because a capability guessed from a model's name is a
 * capability the app will one day claim wrongly.
 */
export function probeEvidence(preset: ProviderPreset, raw: Record<string, unknown>): CapabilityEvidence {
  const evidence: {
    contextWindow?: number
    maxOutput?: number
    vision?: boolean
    tools?: ToolSupport
    streaming?: boolean
    embeddings?: boolean
    jsonMode?: boolean
  } = {}

  if (preset.probe === 'openrouter') {
    const context = asPositiveInteger(raw.context_length)
    if (context !== null) evidence.contextWindow = context

    const provider = asRecord(raw.top_provider)
    const maxOutput = provider === null ? null : asPositiveInteger(provider.max_completion_tokens)
    if (maxOutput !== null) evidence.maxOutput = maxOutput

    const architecture = asRecord(raw.architecture)
    const modalities = architecture === null ? null : asArray(architecture.input_modalities)
    if (modalities !== null) {
      evidence.vision = modalities.some((entry) => entry === 'image')
    }

    const parameters = asArray(raw.supported_parameters)
    if (parameters !== null) {
      const names = parameters.filter((entry): entry is string => typeof entry === 'string')
      evidence.tools = names.includes('tools') ? 'native' : 'none'
      evidence.jsonMode = names.includes('response_format') || names.includes('structured_outputs')
    }
  }

  if (preset.probe === 'lmstudio') {
    const type = asString(raw.type)
    if (type === 'embeddings') {
      Object.assign(evidence, EMBEDDING_ONLY)
    } else if (type === 'vlm' || type === 'vision') {
      evidence.vision = true
    }

    const context = asPositiveInteger(raw.max_context_length)
    if (context !== null) evidence.contextWindow = context

    const capabilities = asArray(raw.capabilities)
    if (capabilities !== null) {
      const names = capabilities.filter((entry): entry is string => typeof entry === 'string')
      if (names.includes('tool_use')) evidence.tools = 'native'
      if (names.includes('vision')) evidence.vision = true
    }
  }

  if (preset.probe === 'ollama') {
    const details = asRecord(raw.details)

    /*
     * A newer server publishes the model's own capability list, and when it does
     * that list is the answer: it is the server saying what the model can run.
     * A model that publishes a list without `tools` therefore has none, which is
     * why the negative is recorded too - otherwise the family rule in the preset
     * would be free to claim tool support the server just denied.
     */
    const capabilities = asArray(raw.capabilities)
    if (capabilities !== null) {
      const names = capabilities.filter((entry): entry is string => typeof entry === 'string')
      if (names.includes('embedding')) {
        Object.assign(evidence, EMBEDDING_ONLY)
      } else {
        evidence.tools = names.includes('tools') ? 'native' : 'none'
        if (names.includes('vision')) evidence.vision = true
      }
    } else {
      /*
       * An older server publishes only the model's family, which is still its own
       * metadata rather than a guess from the id. An embedding model's family is
       * a bert one; a chat model's is llama, qwen, gemma and so on.
       */
      const families = details === null ? null : asArray(details.families)
      const names = families === null
        ? []
        : families.filter((entry): entry is string => typeof entry === 'string')
      const family = details === null ? null : asString(details.family)
      const all = family === null ? names : [family, ...names]
      if (all.some((entry) => /bert/i.test(entry))) Object.assign(evidence, EMBEDDING_ONLY)
    }

    // Some builds report the context they were configured with; most do not.
    const context = asPositiveInteger(raw.context_length) ??
      (details === null ? null : asPositiveInteger(details.context_length))
    if (context !== null) evidence.contextWindow = context
  }

  return evidence
}

/** Drop undefined fields so an unknown fact cannot erase a known one. */
function definedOnly(evidence: CapabilityEvidence): Partial<ProviderCapabilities> {
  const result: {
    contextWindow?: number
    maxOutput?: number
    vision?: boolean
    tools?: ToolSupport
    streaming?: boolean
    embeddings?: boolean
    jsonMode?: boolean
  } = {}
  if (evidence.contextWindow !== undefined) result.contextWindow = evidence.contextWindow
  if (evidence.maxOutput !== undefined) result.maxOutput = evidence.maxOutput
  if (evidence.vision !== undefined) result.vision = evidence.vision
  if (evidence.tools !== undefined) result.tools = evidence.tools
  if (evidence.streaming !== undefined) result.streaming = evidence.streaming
  if (evidence.embeddings !== undefined) result.embeddings = evidence.embeddings
  if (evidence.jsonMode !== undefined) result.jsonMode = evidence.jsonMode
  return result
}

/** Keep the numbers inside the contract's bounds and inside each other. */
function clamp(capabilities: ProviderCapabilities): ProviderCapabilities {
  const contextWindow = Math.max(1, Math.trunc(capabilities.contextWindow))
  const maxOutput = Math.min(Math.max(1, Math.trunc(capabilities.maxOutput)), contextWindow)
  return { ...capabilities, contextWindow, maxOutput }
}

/**
 * The capability profile for one model.
 *
 * Rules are first-match-wins rather than cumulative: a family rule describes
 * the whole model, and applying two overlapping rules would produce a model
 * that is half one thing and half another.
 */
export function resolveCapabilities(
  preset: ProviderPreset,
  modelId: string,
  evidence?: CapabilityEvidence,
): ProviderCapabilities {
  let resolved: ProviderCapabilities = { ...preset.capabilities }

  for (const rule of preset.modelRules) {
    if (rule.match.test(modelId)) {
      resolved = { ...resolved, ...rule.capabilities }
      break
    }
  }

  if (evidence !== undefined) resolved = { ...resolved, ...definedOnly(evidence) }
  return clamp(resolved)
}

/** One model, as every feature sees it. */
export function describeModel(
  preset: ProviderPreset,
  providerId: string,
  entry: ModelListEntry,
  cloud: boolean,
): ModelInfo {
  return {
    id: entry.id,
    providerId,
    label: entry.label,
    cloud,
    capabilities: resolveCapabilities(preset, entry.id, probeEvidence(preset, entry.raw)),
  }
}

/**
 * Every model in a list payload, with the probe applied.
 *
 * `cloud` is passed in rather than derived per model because every model behind
 * one endpoint leaves through the same host.
 */
export function modelsFromPayload(
  preset: ProviderPreset,
  providerId: string,
  cloud: boolean,
  payload: unknown,
): ModelInfo[] {
  return parseModelList(payload).map((entry) => describeModel(preset, providerId, entry, cloud))
}

/** Read an output-token budget from a request or fall back to the model's limit. */
export function outputBudget(requested: number | undefined, capabilities: ProviderCapabilities): number {
  const value = requested === undefined ? capabilities.maxOutput : requested
  const integer = asNonNegativeInteger(value)
  if (integer === null || integer < 1) return capabilities.maxOutput
  return Math.min(integer, capabilities.maxOutput)
}
