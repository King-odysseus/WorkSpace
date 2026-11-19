/*
 * The one place that turns a person's choice into a provider.
 *
 * Every other module knows a preset, or a key, or an adapter. This file is the
 * only one that knows both adapters, so no adapter can be reached by a path that
 * skipped the checks below. That is deliberate: it is the seam where the
 * catalogue and the wire formats meet, and keeping it to one file is what makes
 * "which adapter is this, exactly?" a question with a single answer.
 *
 * The checks are ordered by what they cost. An unknown preset, a custom entry
 * with no endpoint, and a missing key all fail before an adapter is built, which
 * is also before any socket could be opened. A missing key is not a provider
 * problem yet: it is a configuration problem, and discovering it after a round
 * trip would spend a request to learn something this module already knows.
 *
 * The credential is a parameter and is handed straight to the adapter that was
 * chosen. It is never held in module state, never written to one of the options
 * objects this file keeps, and never appears in a failure: `ProviderError` is
 * built from a token, so a message naming an id, a URL or a key is impossible by
 * construction rather than by care.
 *
 * Dispatch is on `preset.kind` and never on `preset.id`. Adding a catalogue entry
 * therefore adds no branch here: it inherits whichever adapter its kind names,
 * and the guard, the contract suite and the failure tokens with it.
 */

import { ProviderError } from '../../shared/providers/errors.js'
import type { AIProvider } from '../../shared/providers/types.js'
import { createAnthropicProvider } from './adapters/anthropic.js'
import { createOllamaProvider } from './adapters/ollama.js'
import { createOpenAiCompatibleProvider } from './adapters/openai-compatible.js'
import {
  findPreset,
  providerIdFor,
  PROVIDER_PRESETS,
  type ProviderKind,
  type ProviderPreset,
} from './presets.js'
import type { ProviderTransport } from './transport.js'
import { endpointIsCloud } from './wire.js'

/** What a stored provider entry carries. Everything here is per entry. */
export interface ProviderConfig {
  /** Which catalogue entry this provider answers to. */
  readonly presetId: string
  /** The key, when the preset takes one. Passed through, never kept. */
  readonly credential: string | null
  /** Overrides the preset's endpoint. Required for the custom entry. */
  readonly baseUrl?: string
  /** Overrides the preset's starting model. */
  readonly defaultModel?: string
  /** Overrides the protocol version Anthropic stamps on each request. */
  readonly apiVersion?: string
}

export interface ProviderDeps {
  /**
   * The only way to the network an adapter is given. Required rather than
   * defaulted: a factory that quietly made its own transport could step around
   * the egress guard, and that mistake would look like a working app.
   */
  readonly transport: ProviderTransport
}

/**
 * True when a value was supplied and is more than whitespace.
 *
 * A key of only spaces is a key someone cleared, a base URL of only spaces is
 * the custom entry before it was filled in, and an empty default model means
 * "the person has not chosen one". All three mean "not set", and treating them
 * as values would send a request that is wrong in an obscure way.
 */
function hasText (value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim().length > 0
}

/**
 * The endpoint the adapter will dial.
 *
 * A preset with an empty base URL has nothing to dial: only the custom entry is
 * built that way, and it is waiting for a URL the person has not typed yet.
 * Checking here keeps the failure at the boundary that knows what was selected;
 * the adapter would otherwise refuse the same way, later, from `joinUrl`.
 */
function resolveBaseUrl (config: ProviderConfig, preset: ProviderPreset): string {
  if (hasText(config.baseUrl)) return config.baseUrl
  if (hasText(preset.baseUrl)) return preset.baseUrl
  throw new ProviderError('internal_error')
}

/**
 * The model the adapter starts with.
 *
 * An empty override falls back to the preset's default, and an empty default
 * stays undefined rather than becoming a model id of "". Undefined is the one
 * value that can only mean "not chosen"; "" would be a model that names nothing
 * and would be sent as if someone had picked it.
 */
function resolveDefaultModel (config: ProviderConfig, preset: ProviderPreset): string | undefined {
  if (hasText(config.defaultModel)) return config.defaultModel
  return hasText(preset.defaultModel) ? preset.defaultModel : undefined
}

/**
 * One provider, ready to use.
 *
 * Synchronous on purpose: everything that can be refused here is configuration
 * or catalogue data, and none of it needs the network. A caller learns that its
 * entry is unusable before it holds a provider it might otherwise save.
 */
export function createProvider (config: ProviderConfig, deps: ProviderDeps): AIProvider {
  const preset = findPreset(config.presetId)

  /*
   * A miss means a stored entry refers to a preset this build does not have,
   * which is a bug in this app, not a provider failure. Only the token is
   * reported: the constructor takes nothing else, so the id a caller supplied
   * cannot end up in a log line or on a screen.
   */
  if (preset === null) throw new ProviderError('internal_error')

  const baseUrl = resolveBaseUrl(config, preset)
  const credential = config.credential ?? null

  /*
   * Fail before the adapter exists. The same token would arrive one round trip
   * later, and `credentialHeaders` would raise it after a request was built,
   * which is a worse place to learn about a cleared key.
   */
  if (preset.requiresKey && !hasText(credential)) {
    throw new ProviderError('provider_unauthorized')
  }

  const options = {
    preset,
    credential,
    baseUrl,
    defaultModel: resolveDefaultModel(config, preset),
  }

  switch (preset.kind) {
    case 'anthropic':
      return createAnthropicProvider(
        { ...options, apiVersion: config.apiVersion ?? preset.apiVersion },
        deps,
      )

    case 'openai-compatible':
      return createOpenAiCompatibleProvider(options, deps)

    case 'ollama':
      // The key is optional here, and the preset says so: a bare server on a
      // default port takes none, while one behind a reverse proxy may.
      return createOllamaProvider(options, deps)

    default:
      /*
       * `ProviderKind` has exactly the members above, so this branch is
       * unreachable while the types hold. It stays because sending an unknown
       * kind down a default adapter would speak the wrong wire format at a real
       * endpoint, and a refused call is the cheaper mistake.
       */
      throw new ProviderError('internal_error')
  }
}

/**
 * A catalogue entry as the Models screen needs it.
 *
 * There is no credential field, and that is by shape rather than by omission: a
 * summary is built before anyone has typed a key, and one that carried a secret
 * would put it one IPC call away from every window.
 */
export interface ProviderPresetSummary {
  readonly id: string
  readonly providerId: string
  readonly label: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  readonly requiresKey: boolean
  readonly defaultModel: string
  /** True when the endpoint does not leave this machine. */
  readonly local: boolean
}

/**
 * The catalogue, safe to hand to a renderer.
 *
 * Built fresh and frozen on each call: a caller that sorts or labels the list in
 * place cannot change what the next caller sees, and a frozen copy is cheap for
 * eight entries. The labels are the preset's own, so the list does not have to
 * be kept in step with a second set of names.
 */
export function providerPresetSummaries (): readonly ProviderPresetSummary[] {
  return Object.freeze(
    PROVIDER_PRESETS.map((preset) =>
      Object.freeze({
        id: preset.id,
        providerId: providerIdFor(preset),
        label: preset.label,
        kind: preset.kind,
        baseUrl: preset.baseUrl,
        requiresKey: preset.requiresKey,
        defaultModel: preset.defaultModel,
        /*
         * The custom entry has no endpoint until one is typed, and
         * `endpointIsCloud` treats an address it cannot parse as cloud. An
         * entry with nothing to dial is therefore never presented as local.
         */
        local: !endpointIsCloud(preset.baseUrl),
      }),
    ),
  )
}
