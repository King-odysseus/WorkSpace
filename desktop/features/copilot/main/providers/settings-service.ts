/*
 * The Models screen's main-process half: what is configured, what is stored, and
 * the only code that turns a person's choice into a provider.
 *
 * Five decisions carry the rest.
 *
 * 1. The account comes from the session, never from the request. A page names a
 *    preset; the scope - which server and which user - is read here from the
 *    signed-in identity. A page that could name the account could store a key
 *    into somebody else's entry, so there is no field through which it can.
 *
 * 2. A key is never held by this module. It goes from the credential entry
 *    boundary into the encrypted store, and a provider call reads it back for the
 *    length of one request. Nothing here returns it, and no reply carries it.
 *
 * 3. Configuration is not a secret, and it is stored separately from the key.
 *    That way an entry can be pointed at a new endpoint without re-entering a key,
 *    and a persisted configuration file that leaks reveals a model name rather
 *    than a credential. The file holds no secret by shape.
 *
 * 4. Every provider call goes through the injected transport, which is the
 *    guarded one in production. This module cannot make a request of its own, so
 *    the rule that listing models and testing a key obey the egress guard is
 *    enforced by the type of `transport` rather than by remembering.
 *
 * 5. A failure is a fixed token. The service throws `ProviderSettingsError`, which
 *    carries a token and a fixed sentence, so no provider body, URL or key can
 *    reach a reply or a log line. The IPC layer turns the token into a refusal.
 */

import { ProviderError, toProviderFailure } from '../../shared/providers/errors.js'
import type { ProviderFailure } from '../../shared/providers/errors.js'
import {
  PROVIDER_SETTINGS_VERSION,
  type ProviderCatalogEntry,
  type ProviderChallenge,
  type ProviderConnectionResult,
  type ProviderCredentialSaved,
  type ProviderDiscovery,
  type ProviderEntry,
  type ProviderModels,
  type ProviderSettingsFailure,
  type ProviderSettingsState,
} from '../../shared/providers/settings-contract.js'
import { createCallContext } from '../../shared/providers/types.js'
import type { AIProvider, CallContext, ModelInfo } from '../../shared/providers/types.js'
import { probeEvidence, resolveCapabilities } from './capabilities.js'
import { detectLocalProviders, LOCAL_CANDIDATES, type LocalDetection } from './discovery.js'
import { findPreset, providerIdFor, PROVIDER_PRESETS, type ProviderPreset } from './presets.js'
import { createProvider } from './registry.js'
import type { ProviderTransport } from './transport.js'
import { endpointIsCloud } from './wire.js'
import type { CredentialEntry } from '../security/credential-entry.js'
import type { CredentialScope, CredentialStore } from '../security/credentials.js'

/** One entry's stored configuration. Deliberately has no secret field. */
export interface ProviderConfigRecord {
  readonly presetId: string
  readonly baseUrl: string
  readonly defaultModel: string
}

/**
 * Where configuration lives between runs.
 *
 * Injected rather than baked in, so the service can be tested without a file and
 * so "where does this go" stays the caller's decision. `save` returns false when
 * the write did not land, which the service reports rather than swallowing: a
 * configuration that vanished at restart is worse than one that refused to save.
 */
export interface ProviderConfigPersistence {
  load: () => unknown
  save: (records: Readonly<Record<string, readonly ProviderConfigRecord[]>>) => boolean
}

export interface ProviderSettingsLogger {
  warn: (message: string) => void
}

export interface ProviderSettingsServiceOptions {
  /** The guarded transport. Production passes the only implementation that ships. */
  transport: ProviderTransport
  credentials: CredentialStore
  entry: CredentialEntry
  /**
   * The signed-in account, or null. A function rather than a value because a
   * sign-out must take effect on the very next call, not at the next restart.
   */
  scope: () => CredentialScope | null
  persistence?: ProviderConfigPersistence
  log?: ProviderSettingsLogger
}

/**
 * A refusal with a fixed token and a fixed sentence.
 *
 * The sentence is for a developer reading a log; the screen maps the token to its
 * own words, so a token added later still reads as English rather than as an
 * identifier.
 */
export class ProviderSettingsError extends Error {
  readonly failure: ProviderSettingsFailure

  constructor (failure: ProviderSettingsFailure) {
    super(PROVIDER_SETTINGS_SENTENCES[failure])
    this.name = 'ProviderSettingsError'
    this.failure = failure
  }
}

const PROVIDER_SETTINGS_SENTENCES: Readonly<Record<ProviderSettingsFailure, string>> = Object.freeze({
  untrusted_sender: 'That window is not allowed to ask for this.',
  invalid_request: 'That request could not be understood.',
  not_signed_in: 'Nobody is signed in.',
  unknown_preset: 'That provider is not in this build.',
  missing_credential: 'That provider needs a key before it can be used.',
  storage_unavailable: 'Encrypted storage is not available on this machine.',
  stale: 'That request belonged to a session that has ended.',
  network: 'The provider could not be reached.',
  rejected: 'The provider turned that request down.',
  internal_error: 'Something went wrong on this side.',
})

/**
 * A provider the chat layer may use, and the two facts it must not guess.
 *
 * The provider is built from stored configuration on every call rather than
 * cached, so a sign-out ends the decrypted key in memory immediately. `cloud` is
 * the classification of the address actually dialled, not of the provider's name,
 * because the same entry is local or cloud depending on where it points.
 */
export interface RoutedProvider {
  readonly provider: AIProvider
  readonly presetId: string
  /** The model the entry starts from, or null when nobody has chosen one. */
  readonly modelId: string | null
  readonly cloud: boolean
  /** Throws `stale` when the account behind this provider has ended. */
  readonly assertCurrent: () => void
}

export interface ProviderSettingsService {
  readState: () => ProviderSettingsState
  saveProvider: (presetId: string, baseUrl: string, defaultModel: string) => ProviderSettingsState
  removeProvider: (presetId: string) => ProviderSettingsState
  beginCredential: (presetId: string) => ProviderChallenge
  saveCredential: (presetId: string, nonce: string, secret: string) => ProviderCredentialSaved
  testConnection: (presetId: string) => Promise<ProviderConnectionResult>
  listModels: (presetId: string) => Promise<ProviderModels>
  discoverLocal: () => Promise<ProviderDiscovery>
  /**
   * One provider, ready to make a call, with the model it starts from and whether
   * its endpoint is a cloud one.
   *
   * This is how the chat layer reaches a model without ever holding a key: the key
   * is read here, handed to the adapter factory, and never returned. The returned
   * `assertCurrent` is the caller's to use after an await - a reply that outlives
   * its account must not be handed to whoever is on screen by then, and the guard
   * for that is this one function rather than a rule each caller remembers.
   */
  openProvider: (presetId: string, modelId?: string | null) => RoutedProvider
  /**
   * Sign-out and account switch. Drops live credentials, revokes every pending
   * key submission, refuses every provider call still in flight, and forgets which
   * account the stored configuration belonged to, so the next read cannot present
   * one person's providers to another.
   */
  forgetAccount: () => void
}

/**
 * What a call remembers about the account it started under.
 *
 * A provider call takes time, and the account can end during it. The key is the
 * comparable identity, and the epoch is the counter that moves when the account
 * changes. Both are needed: a switch between two people shows up in the key, while
 * a sign-out followed by a sign-in as the same person shows up only in the
 * counter, because the scope reads exactly as it did before.
 */
interface AccountClaim {
  readonly scope: CredentialScope
  readonly key: string
  readonly epoch: number
}

/** Host shapes the credential store accepts. Colons and slashes are refused there. */
function scopeKeyFor (scope: CredentialScope): string {
  return `${scope.serverHost.trim().toLowerCase()}|${scope.userId}`
}

/** A stored base URL is only usable if it is an absolute http or https address. */
function parseEndpoint (value: string): URL | null {
  if (value.trim().length === 0) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return url
}

function configFromUnknown (value: unknown): ProviderConfigRecord[] {
  if (!Array.isArray(value)) return []
  const records: ProviderConfigRecord[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const presetId = typeof candidate.presetId === 'string' ? candidate.presetId : null
    if (presetId === null || findPreset(presetId) === null) continue
    records.push({
      presetId,
      baseUrl: typeof candidate.baseUrl === 'string' ? candidate.baseUrl.slice(0, 500) : '',
      defaultModel: typeof candidate.defaultModel === 'string' ? candidate.defaultModel.slice(0, 200) : '',
    })
  }
  return records
}

/**
 * The catalogue, as the screen needs it.
 *
 * `needsBaseUrl` is derived rather than listed: an entry whose catalogue endpoint
 * is empty is waiting for the person to type one, and the screen has to know that
 * before it can decide whether Save is a control or a decoration.
 */
function catalogEntryFor (preset: ProviderPreset): ProviderCatalogEntry {
  return {
    id: preset.id,
    providerId: providerIdFor(preset),
    label: preset.label,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    defaultModel: preset.defaultModel,
    requiresKey: preset.requiresKey,
    local: !endpointIsCloud(preset.baseUrl),
    needsBaseUrl: preset.baseUrl.trim().length === 0,
  }
}

/** True when a value was supplied and is more than whitespace, as the registry asks. */
function hasText (value: string): boolean {
  return value.trim().length > 0
}

export function createProviderSettingsService (
  options: ProviderSettingsServiceOptions,
): ProviderSettingsService {
  const { transport, credentials, entry, persistence, log } = options
  if (!transport || typeof transport.request !== 'function') {
    throw new TypeError('createProviderSettingsService needs a transport')
  }
  if (!credentials || typeof credentials.read !== 'function') {
    throw new TypeError('createProviderSettingsService needs a credential store')
  }
  if (!entry || typeof entry.submit !== 'function') {
    throw new TypeError('createProviderSettingsService needs a credential entry boundary')
  }
  if (typeof options.scope !== 'function') {
    throw new TypeError('createProviderSettingsService needs a scope reader')
  }

  /*
   * Configuration for the account that is signed in now. Held as one map keyed by
   * scope rather than as the current account's list, because the same person
   * signing in to two servers keeps two sets and neither may leak into the other.
   * Non-secret, so it survives a sign-out on disk; `providers` in the state does
   * not, because only the signed-in account's entries are ever presented.
   */
  const stored = new Map<string, ProviderConfigRecord[]>()

  function loadFromPersistence (): void {
    if (!persistence || typeof persistence.load !== 'function') return
    let loaded: unknown
    try {
      loaded = persistence.load()
    } catch (error) {
      warn(`could not read stored configuration (${nameOf(error)})`)
      return
    }
    if (loaded === null || typeof loaded !== 'object') return
    for (const [key, value] of Object.entries(loaded as Record<string, unknown>)) {
      const records = configFromUnknown(value)
      if (records.length > 0) stored.set(key, records)
    }
  }

  function persist (): void {
    if (!persistence || typeof persistence.save !== 'function') return
    const snapshot: Record<string, readonly ProviderConfigRecord[]> = {}
    for (const [key, records] of stored) snapshot[key] = records
    let landed = false
    try {
      landed = persistence.save(snapshot) === true
    } catch (error) {
      warn(`could not write stored configuration (${nameOf(error)})`)
      return
    }
    /*
     * Reported, not thrown: the entry was applied for this run, and the person can
     * still use it. But a silent false is how a configuration quietly forgets
     * itself at the next start, so it is worth one line.
     */
    if (!landed) warn('stored configuration did not reach the disk')
  }

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot providers: ${message}`)
  }

  function nameOf (error: unknown): string {
    return (error as { name?: string } | null)?.name ?? 'unknown'
  }

  function currentScope (): CredentialScope {
    const scope = options.scope()
    if (scope === null) throw new ProviderSettingsError('not_signed_in')
    return scope
  }

  /*
   * An in-flight reply belongs to the account that asked for it.
   *
   * Providers take seconds to answer, and two things can happen in that time: the
   * person signs out, or somebody else signs in. Either way the answer describes an
   * account that is no longer on screen, and returning it would show one person's
   * provider list - or the fact that a key exists at all - to another.
   *
   * The counter is the half a scope comparison cannot do. Signing out and back in
   * as the same person leaves the scope reading exactly as it did, so
   * `forgetAccount`, which the caller runs at that moment, moves the counter and a
   * call that started under an older one is refused.
   */
  let accountEpoch = 0

  function claimAccount (): AccountClaim {
    const scope = currentScope()
    return { scope, key: scopeKeyFor(scope), epoch: accountEpoch }
  }

  /**
   * Whether the account that started a call is still the one signed in.
   *
   * A session that cannot be read counts as gone. Failing closed costs a refused
   * call; failing open would hand an answer to whoever is on screen now, which is
   * the failure this check exists to prevent.
   */
  function claimHolds (claim: AccountClaim): boolean {
    if (accountEpoch !== claim.epoch) return false
    let now: CredentialScope | null
    try {
      now = options.scope()
    } catch (error) {
      warn(`could not read the session while answering (${nameOf(error)})`)
      return false
    }
    return now !== null && scopeKeyFor(now) === claim.key
  }

  /** Refuse a reply whose account has ended, rather than return it to a new one. */
  function assertClaim (claim: AccountClaim): void {
    if (claimHolds(claim)) return
    throw new ProviderSettingsError('stale')
  }

  function presetOrThrow (presetId: string): ProviderPreset {
    const preset = findPreset(presetId)
    if (preset === null) throw new ProviderSettingsError('unknown_preset')
    return preset
  }

  function recordsFor (scope: CredentialScope): ProviderConfigRecord[] {
    return stored.get(scopeKeyFor(scope)) ?? []
  }

  /** The stored configuration for one entry, or the catalogue's own defaults. */
  function recordFor (scope: CredentialScope, presetId: string): ProviderConfigRecord {
    const found = recordsFor(scope).find(record => record.presetId === presetId)
    return found ?? { presetId, baseUrl: '', defaultModel: '' }
  }

  /**
   * The endpoint an adapter will dial.
   *
   * A stored override wins, then the catalogue. An entry with neither has nothing
   * to dial, which is the custom entry before it was filled in.
   */
  function resolvedBaseUrl (record: ProviderConfigRecord, preset: ProviderPreset): string {
    if (hasText(record.baseUrl)) return record.baseUrl.trim()
    if (hasText(preset.baseUrl)) return preset.baseUrl
    throw new ProviderSettingsError('invalid_request')
  }

  function resolvedModel (record: ProviderConfigRecord, preset: ProviderPreset): string | undefined {
    if (hasText(record.defaultModel)) return record.defaultModel.trim()
    return hasText(preset.defaultModel) ? preset.defaultModel : undefined
  }

  /**
   * The key for one entry, read from the encrypted store.
   *
   * A preset that requires one refuses here, before an adapter is built, so a
   * missing key never spends a round trip to learn something this module already
   * knows. A local server takes none, and answers null.
   */
  function credentialFor (scope: CredentialScope, preset: ProviderPreset): string | null {
    const read = credentials.read(scope, preset.id)
    if (!read.ok) {
      if (preset.requiresKey) throw new ProviderSettingsError('missing_credential')
      return null
    }
    if (read.secret.trim().length === 0) {
      if (preset.requiresKey) throw new ProviderSettingsError('missing_credential')
      return null
    }
    return read.secret
  }

  /**
   * A provider built from stored configuration and a stored key.
   *
   * Built per call rather than cached: a cached provider would hold a decrypted
   * key in memory for as long as the screen is open, and a sign-out is supposed to
   * end that immediately.
   */
  function providerFor (presetId: string): { provider: ReturnType<typeof createProvider>; preset: ProviderPreset; cloud: boolean; claim: AccountClaim } {
    const preset = presetOrThrow(presetId)
    const claim = claimAccount()
    const record = recordFor(claim.scope, preset.id)
    const baseUrl = resolvedBaseUrl(record, preset)
    const credential = credentialFor(claim.scope, preset)

    const provider = createProvider(
      {
        presetId: preset.id,
        credential,
        baseUrl,
        defaultModel: resolvedModel(record, preset),
      },
      { transport },
    )

    return { provider, preset, cloud: endpointIsCloud(baseUrl), claim }
  }

  /** The call context every provider call carries. No business is chosen yet. */
  function contextFor (providerId: string, scope: CredentialScope, purpose: 'model_list' | 'connection_test'): CallContext {
    return createCallContext(
      {
        businessId: null,
        providerId,
        userId: scope.userId,
        purpose,
      },
      undefined,
    )
  }

  /**
   * Whatever an adapter threw, as one of this channel's tokens.
   *
   * An `unsupported` or `aborted` answer is not this screen's business - nothing
   * here streams or cancels - so both collapse into a token the person can act on
   * rather than leaking a provider's own vocabulary onto the screen.
   */
  function failureFrom (error: unknown): ProviderFailure {
    if (error instanceof ProviderError) return error.failure
    return toProviderFailure(error)
  }

  function credentialEntryFailure (error: unknown): ProviderSettingsFailure {
    if (error instanceof ProviderSettingsError) return error.failure
    const reason = (error as { reason?: string } | null)?.reason
    if (reason === 'storage_unavailable' || reason === 'not_encrypted' || reason === 'not_persisted') {
      return 'storage_unavailable'
    }
    return 'internal_error'
  }

  function stateFor (): ProviderSettingsState {
    const scope = options.scope()
    if (scope === null) {
      /*
       * Signed out: the catalogue is this build's own data and is still listed, so
       * the screen can explain what exists. Configured entries are somebody's and
       * disappear with them, which is the whole of "clear displayed account
       * state" - there is nothing left on the page to read.
       */
      return {
        version: PROVIDER_SETTINGS_VERSION,
        signedIn: false,
        catalog: PROVIDER_PRESETS.map(catalogEntryFor),
        providers: [],
      }
    }

    const providers: ProviderEntry[] = recordsFor(scope).map(record => {
      const preset = findPreset(record.presetId)
      if (preset === null) {
        // A stored entry for a preset this build no longer has. Dropped rather
        // than shown as a broken row; the next save rewrites the list.
        return null
      }
      const described = credentials.describe(scope, preset.id)
      const baseUrl = hasText(record.baseUrl) ? record.baseUrl.trim() : preset.baseUrl
      return {
        presetId: preset.id,
        providerId: providerIdFor(preset),
        label: preset.label,
        baseUrl,
        defaultModel: hasText(record.defaultModel) ? record.defaultModel : preset.defaultModel,
        local: !endpointIsCloud(baseUrl),
        requiresKey: preset.requiresKey,
        hasCredential: described.ok,
        // The store chooses how much of a key may be shown, and masks a short one.
        fingerprint: described.ok ? described.fingerprint : null,
      }
    }).filter((entry): entry is ProviderEntry => entry !== null)

    return {
      version: PROVIDER_SETTINGS_VERSION,
      signedIn: true,
      catalog: PROVIDER_PRESETS.map(catalogEntryFor),
      providers,
    }
  }

  loadFromPersistence()

  /**
   * One provider for a conversation turn, and the two facts a caller must not
   * guess.
   *
   * `modelId` from the caller wins over the stored default, because the model
   * picker chooses per conversation. A caller that passes nothing gets the
   * entry's own default, and an entry with neither refuses rather than sending a
   * model id of "".
   */
  function openProvider (presetId: string, modelId?: string | null): RoutedProvider {
    const routed = providerFor(presetId)
    const stored = resolvedModel(recordFor(routed.claim.scope, routed.preset.id), routed.preset)
    const chosen = typeof modelId === 'string' && modelId.trim().length > 0
      ? modelId.trim()
      : (stored ?? null)

    // No model at all is a configuration gap, and the screen already has words for
    // it: the entry needs a key or a default before it can answer anything.
    if (chosen === null) throw new ProviderSettingsError('missing_credential')

    return {
      provider: routed.provider,
      presetId: routed.preset.id,
      modelId: chosen,
      cloud: routed.cloud,
      assertCurrent: () => { assertClaim(routed.claim) },
    }
  }

  return {
    openProvider,
    readState: stateFor,

    saveProvider (presetId, baseUrl, defaultModel) {
      const preset = presetOrThrow(presetId)
      const scope = currentScope()

      /*
       * A custom entry is the only one whose endpoint comes from the person, and
       * it must be a real http or https address. Validated here rather than in the
       * adapter, so a typo is a sentence on the screen instead of a failed request
       * to a host that does not exist.
       */
      let storedBaseUrl = baseUrl.trim()
      if (hasText(storedBaseUrl)) {
        const parsed = parseEndpoint(storedBaseUrl)
        if (parsed === null) throw new ProviderSettingsError('invalid_request')
        storedBaseUrl = parsed.origin + parsed.pathname.replace(/\/$/, '')
        if (storedBaseUrl.endsWith('/')) storedBaseUrl = storedBaseUrl.slice(0, -1)
      }
      if (storedBaseUrl.length === 0 && !hasText(preset.baseUrl)) {
        throw new ProviderSettingsError('invalid_request')
      }

      const key = scopeKeyFor(scope)
      const records = recordsFor(scope).filter(record => record.presetId !== preset.id)
      records.push({
        presetId: preset.id,
        baseUrl: storedBaseUrl,
        defaultModel: defaultModel.trim(),
      })
      stored.set(key, records)
      persist()
      return stateFor()
    },

    removeProvider (presetId) {
      const preset = presetOrThrow(presetId)
      const scope = currentScope()

      /*
       * The key goes first, and a key that could not be deleted stops the whole
       * removal. Deleting the row first and then discovering the secret is still
       * on disk would leave a credential behind an entry nobody can see, which is
       * the one outcome a Remove button must never produce. A key that was never
       * there is not a failure.
       */
      const removal = credentials.remove(scope, preset.id)
      if (!removal.ok && removal.reason !== 'not_found') {
        throw new ProviderSettingsError('storage_unavailable')
      }

      const key = scopeKeyFor(scope)
      stored.set(key, recordsFor(scope).filter(record => record.presetId !== preset.id))
      persist()

      return stateFor()
    },

    beginCredential (presetId) {
      const preset = presetOrThrow(presetId)
      const scope = currentScope()

      const issued = entry.issueChallenge(scope)
      if (!issued.ok) throw new ProviderSettingsError(credentialEntryFailure(issued))
      return { nonce: issued.challenge.nonce, expiresAt: issued.challenge.expiresAt }
    },

    saveCredential (presetId, nonce, secret) {
      const preset = presetOrThrow(presetId)
      const scope = currentScope()

      /*
       * The scope is attached here, not taken from the request. The boundary binds
       * a pass to the account that asked for it, so a nonce obtained by one person
       * cannot be used to write into another's entry.
       */
      const submitted = entry.submit({ nonce, scope, name: preset.id, secret })
      if (!submitted.ok) throw new ProviderSettingsError(credentialEntryFailure(submitted))
      return { presetId: preset.id, fingerprint: submitted.fingerprint }
    },

    async testConnection (presetId) {
      const { provider, claim, cloud } = providerFor(presetId)

      let result
      try {
        result = await provider.testConnection(
          contextFor(provider.id, claim.scope, 'connection_test'),
        )
      } catch (error) {
        /*
         * Checked before the failure is reported. A call whose account ended is
         * stale whatever it did, and "the provider turned it down" would send the
         * person looking in the wrong place.
         */
        assertClaim(claim)
        return { ok: false, failure: failureFrom(error) }
      }

      assertClaim(claim)

      if (!result.ok) return { ok: false, failure: result.failure }
      return { ok: true, modelCount: result.modelCount, cloud }
    },

    async listModels (presetId) {
      const { provider, preset, claim, cloud } = providerFor(presetId)

      let models: ModelInfo[]
      try {
        models = await provider.listModels(contextFor(provider.id, claim.scope, 'model_list'))
      } catch (error) {
        assertClaim(claim)
        throw new ProviderSettingsError(failureTokenFor(failureFrom(error)))
      }

      /*
       * A list that arrives after the account changed is refused rather than
       * returned. This is the reply that would otherwise put one person's model
       * names, and the knowledge that their key works, on another person's screen.
       */
      assertClaim(claim)

      /*
       * The adapter already resolved each model's capabilities from the provider's
       * own list, and its `cloud` from the endpoint it dialled. Nothing is
       * recomputed here: a second opinion is a second answer that can disagree.
       */
      return { presetId: preset.id, cloud, models }
    },

    async discoverLocal () {
      /*
       * Detection is a set of network calls, so it needs a signed-in account for
       * the same reason a model call does: the guard records who asked. It needs
       * no credential, because a default local port does not want one.
       */
      const claim = claimAccount()

      let found: readonly LocalDetection[]
      try {
        found = await detectLocalProviders({
          transport,
          ctx: contextFor('ollama', claim.scope, 'model_list'),
        })
      } catch (error) {
        assertClaim(claim)
        throw new ProviderSettingsError(failureTokenFor(failureFrom(error)))
      }

      assertClaim(claim)

      return {
        candidates: found.map(entry => ({
          presetId: entry.presetId,
          baseUrl: entry.baseUrl,
          label: entry.label,
          reachable: entry.reachable,
          /*
           * Rows are capped so a server that reports thousands of entries cannot
           * make one reply the largest thing this channel ever sends. The screen
           * shows the first page anyway.
           */
          models: entry.models.slice(0, MAX_DISCOVERED_MODELS),
          failure: entry.failure,
        })),
      }
    },

    forgetAccount () {
      /*
       * The counter moves first, before anything is cleared, so a reply already on
       * its way is refused the moment the account ends rather than only once the
       * store has been emptied.
       */
      accountEpoch += 1
      credentials.signOut()
      entry.revokeAll()
    },
  }
}

/** A discovery reply is capped, and so is the list a screen can be handed. */
const MAX_DISCOVERED_MODELS = 500

/**
 * A provider failure, as one of this channel's tokens.
 *
 * The two vocabularies do not line up one for one. Everything an adapter can say
 * about a call that never got an answer is a network problem from the screen's
 * point of view, and everything it can say about a reply it could not read is a
 * rejection, because the person's next move is the same either way.
 */
function failureTokenFor (failure: ProviderFailure): ProviderSettingsFailure {
  switch (failure) {
    case 'network':
    case 'timeout':
      return 'network'
    case 'provider_unauthorized':
    case 'provider_rate_limited':
    case 'provider_unavailable':
    case 'provider_rejected':
    case 'malformed_response':
    case 'schema_mismatch':
    case 'context_too_long':
    case 'model_not_found':
    case 'egress_blocked':
      return 'rejected'
    case 'unsupported':
      return 'invalid_request'
    case 'aborted':
      return 'stale'
    default:
      return 'internal_error'
  }
}

/**
 * The capability profile for one model.
 *
 * Exported so the screen's tests can build a row without a network call, and so a
 * later feature that needs "what can this model do" asks the same rules rather
 * than a second copy of them.
 */
export function capabilitiesFor (presetId: string, modelId: string): ModelInfo['capabilities'] | null {
  const preset = findPreset(presetId)
  if (preset === null) return null
  return resolveCapabilities(preset, modelId)
}
