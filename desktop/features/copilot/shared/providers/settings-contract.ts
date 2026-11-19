/*
 * The Models screen's contract: what a page may ask about providers, and the
 * only shapes it can be answered with.
 *
 * Three rules shape this file, and they are the same three the access channel
 * keeps, because a second style of IPC is how a codebase ends up with one
 * careful channel and one careless one.
 *
 * 1. A page names a preset, never a URL, a header, a channel or an account. The
 *    endpoint comes from the catalogue or from a value the main process already
 *    validated, and the account comes from the signed-in session. There is no
 *    field here a page could use to address somebody else's credential.
 * 2. Every request and every reply is a strict schema, so an unknown field is a
 *    refusal rather than something quietly ignored. The reply schemas are parsed
 *    in the main process before anything leaves it, which means a service bug
 *    fails there instead of drawing a broken screen.
 * 3. A secret is submitted once, against a single-use pass, and the answer never
 *    contains it. `saveCredential` returns a fingerprint - the last four
 *    characters of the key - which is enough to tell a person their key is
 *    stored and not enough to reconstruct it.
 *
 * Models are not part of the settings state. Reading them is a network call, and
 * a screen that had to wait for one before it could draw a form would be a form
 * that appears to be broken on a slow connection. So the state carries what is
 * stored, and the model list arrives from its own channel with its own failure.
 */

import { z } from 'zod'

import { PROVIDER_FAILURES } from './errors.js'
import { modelInfoSchema } from './types.js'

/** Bumped only when a field changes meaning. The page refuses what it cannot read. */
export const PROVIDER_SETTINGS_VERSION = 1

/**
 * The channel names, as a frozen table rather than loose strings.
 *
 * The preload copies these literally, because a preload that imported this
 * module would need a bundler in the sandbox. A drift guard in the preload tests
 * fails the day the two lists disagree, which is the same arrangement the shell
 * and access channels use.
 */
export const PROVIDER_CHANNELS = Object.freeze({
  readState: 'zuri:providers:read-state',
  saveProvider: 'zuri:providers:save-provider',
  removeProvider: 'zuri:providers:remove-provider',
  beginCredential: 'zuri:providers:begin-credential',
  saveCredential: 'zuri:providers:save-credential',
  testConnection: 'zuri:providers:test-connection',
  listModels: 'zuri:providers:list-models',
  discoverLocal: 'zuri:providers:discover-local',
  stateChanged: 'zuri:providers:state-changed',
} as const)

export type ProviderChannelName = (typeof PROVIDER_CHANNELS)[keyof typeof PROVIDER_CHANNELS]

export type ProviderChannelKey = keyof typeof PROVIDER_CHANNELS

/** The request channels, in the order the bridge declares its methods. */
export const PROVIDER_REQUEST_CHANNELS = Object.freeze([
  PROVIDER_CHANNELS.readState,
  PROVIDER_CHANNELS.saveProvider,
  PROVIDER_CHANNELS.removeProvider,
  PROVIDER_CHANNELS.beginCredential,
  PROVIDER_CHANNELS.saveCredential,
  PROVIDER_CHANNELS.testConnection,
  PROVIDER_CHANNELS.listModels,
  PROVIDER_CHANNELS.discoverLocal,
] as const)

/**
 * Why a call was refused. Fixed tokens only.
 *
 * `untrusted_sender` and `invalid_request` are the same two the other channels
 * use, so a page that draws the wrong window's refusal reads one sentence in one
 * style. `stale` is this channel's own: a call that was in flight when the person
 * signed out or a different account signed in is answered with it rather than
 * completing into a screen that no longer belongs to them.
 */
export const PROVIDER_SETTINGS_FAILURES = Object.freeze([
  'untrusted_sender',
  'invalid_request',
  'not_signed_in',
  'unknown_preset',
  'missing_credential',
  'storage_unavailable',
  'stale',
  'network',
  'rejected',
  'internal_error',
] as const)

export type ProviderSettingsFailure = (typeof PROVIDER_SETTINGS_FAILURES)[number]

/** One catalogue entry, as the screen needs it. No credential field, by shape. */
export const providerCatalogEntrySchema = z.strictObject({
  id: z.string().min(1).max(64),
  providerId: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
  kind: z.enum(['anthropic', 'openai-compatible', 'ollama']),
  /** Empty for the custom entry until a person types one. */
  baseUrl: z.string().max(500),
  defaultModel: z.string().max(200),
  requiresKey: z.boolean(),
  /** True when the catalogue's endpoint does not leave this machine. */
  local: z.boolean(),
  /** True when the entry has no endpoint until one is supplied. */
  needsBaseUrl: z.boolean(),
})

export type ProviderCatalogEntry = z.infer<typeof providerCatalogEntrySchema>

/**
 * One provider the person has set up.
 *
 * `fingerprint` is null when nothing is stored, and is never the key: it is the
 * tail the credential store already chooses to expose, or a mask for a short key.
 */
export const providerEntrySchema = z.strictObject({
  presetId: z.string().min(1).max(64),
  providerId: z.string().min(1).max(200),
  label: z.string().min(1).max(120),
  baseUrl: z.string().max(500),
  defaultModel: z.string().max(200),
  local: z.boolean(),
  requiresKey: z.boolean(),
  hasCredential: z.boolean(),
  fingerprint: z.string().max(16).nullable(),
})

export type ProviderEntry = z.infer<typeof providerEntrySchema>

/**
 * The whole state the screen draws.
 *
 * Signed out, this is `signedIn: false` with no providers: the catalogue is
 * still listed, because the catalogue is this build's own data and holds nothing
 * about a person, while a configured entry is somebody's and disappears with
 * them.
 */
export const providerSettingsStateSchema = z.strictObject({
  version: z.literal(PROVIDER_SETTINGS_VERSION),
  signedIn: z.boolean(),
  catalog: z.array(providerCatalogEntrySchema).max(64),
  providers: z.array(providerEntrySchema).max(64),
})

export type ProviderSettingsState = z.infer<typeof providerSettingsStateSchema>

/** What a connection test answers: a count, or a fixed token. Never a body. */
export const providerConnectionResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    modelCount: z.number().int().nonnegative(),
    /** True when the endpoint the adapter dialled is not on this machine. */
    cloud: z.boolean(),
  }),
  z.strictObject({ ok: z.literal(false), failure: z.enum(PROVIDER_FAILURES) }),
])

export type ProviderConnectionResult = z.infer<typeof providerConnectionResultSchema>

/** The model list, with the endpoint's own cloud answer repeated beside it. */
export const providerModelsSchema = z.strictObject({
  presetId: z.string().min(1).max(64),
  cloud: z.boolean(),
  models: z.array(modelInfoSchema).max(2000),
})

export type ProviderModels = z.infer<typeof providerModelsSchema>

/** One local server's answer, as the discovery module reports it. */
export const providerLocalDetectionSchema = z.strictObject({
  presetId: z.string().min(1).max(64),
  baseUrl: z.string().max(500),
  label: z.string().min(1).max(120),
  reachable: z.boolean(),
  models: z.array(modelInfoSchema).max(2000),
  failure: z.enum(PROVIDER_FAILURES).nullable(),
})

export type ProviderLocalDetection = z.infer<typeof providerLocalDetectionSchema>

export const providerDiscoverySchema = z.strictObject({
  candidates: z.array(providerLocalDetectionSchema).max(16),
})

export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>

/** The single-use pass a key is submitted against. */
export const providerChallengeSchema = z.strictObject({
  nonce: z.string().min(16).max(128).regex(/^[a-f0-9]+$/),
  expiresAt: z.number().int().positive(),
})

export type ProviderChallenge = z.infer<typeof providerChallengeSchema>

export const providerCredentialSavedSchema = z.strictObject({
  presetId: z.string().min(1).max(64),
  fingerprint: z.string().min(1).max(16),
})

export type ProviderCredentialSaved = z.infer<typeof providerCredentialSavedSchema>

/* ------------------------------------------------------------------ *
 * Requests
 *
 * Every one is a closed object. `presetId` is bounded and pattern-checked here
 * so an entry the catalogue does not have is refused as a bad request rather
 * than travelling into a lookup.
 * ------------------------------------------------------------------ */

const presetIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/)

export const providerEmptyRequestSchema = z.strictObject({})

export const providerSaveRequestSchema = z.strictObject({
  presetId: presetIdSchema,
  /** Empty means "use the catalogue's endpoint". */
  baseUrl: z.string().max(500),
  /** Empty means "use the catalogue's default". */
  defaultModel: z.string().max(200),
})

export type ProviderSaveRequest = z.infer<typeof providerSaveRequestSchema>

export const providerPresetRequestSchema = z.strictObject({
  presetId: presetIdSchema,
})

export type ProviderPresetRequest = z.infer<typeof providerPresetRequestSchema>

/**
 * A key being submitted.
 *
 * No `scope` field: the account is the signed-in session, resolved in the main
 * process. A page that could name the account could write into another
 * person's entry, which is exactly the thing the credential boundary exists to
 * make impossible.
 */
export const providerCredentialRequestSchema = z.strictObject({
  presetId: presetIdSchema,
  nonce: z.string().min(16).max(128).regex(/^[a-f0-9]+$/),
  secret: z.string().min(1).max(4096),
})

export type ProviderCredentialRequest = z.infer<typeof providerCredentialRequestSchema>

/* ------------------------------------------------------------------ *
 * Replies
 * ------------------------------------------------------------------ */

export type ProviderReply<T> = { ok: true; value: T } | { ok: false; reason: ProviderSettingsFailure }

export const providerFailureReply = (reason: ProviderSettingsFailure): ProviderReply<never> => ({
  ok: false,
  reason,
})

export const providerValueReply = <T>(value: T): ProviderReply<T> => ({ ok: true, value })

const providerFailureReplySchema = z.strictObject({
  ok: z.literal(false),
  reason: z.enum(PROVIDER_SETTINGS_FAILURES),
})

const okReply = <S extends z.ZodType>(value: S) =>
  z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), value }), providerFailureReplySchema])

export const providerStateReplySchema = okReply(providerSettingsStateSchema)
export const providerConnectionReplySchema = okReply(providerConnectionResultSchema)
export const providerModelsReplySchema = okReply(providerModelsSchema)
export const providerDiscoveryReplySchema = okReply(providerDiscoverySchema)
export const providerChallengeReplySchema = okReply(providerChallengeSchema)
export const providerCredentialReplySchema = okReply(providerCredentialSavedSchema)

/**
 * Which reply shape each request channel answers with.
 *
 * A table rather than a branch, so adding a channel without a reply schema is a
 * compile error instead of an unchecked default.
 */
export const PROVIDER_REPLY_SCHEMAS = Object.freeze({
  [PROVIDER_CHANNELS.readState]: providerStateReplySchema,
  [PROVIDER_CHANNELS.saveProvider]: providerStateReplySchema,
  [PROVIDER_CHANNELS.removeProvider]: providerStateReplySchema,
  [PROVIDER_CHANNELS.beginCredential]: providerChallengeReplySchema,
  [PROVIDER_CHANNELS.saveCredential]: providerCredentialReplySchema,
  [PROVIDER_CHANNELS.testConnection]: providerConnectionReplySchema,
  [PROVIDER_CHANNELS.listModels]: providerModelsReplySchema,
  [PROVIDER_CHANNELS.discoverLocal]: providerDiscoveryReplySchema,
} as const)

/** The request schema for one channel. None takes no body; all take an object. */
export const PROVIDER_REQUEST_SCHEMAS = Object.freeze({
  [PROVIDER_CHANNELS.readState]: providerEmptyRequestSchema,
  [PROVIDER_CHANNELS.saveProvider]: providerSaveRequestSchema,
  [PROVIDER_CHANNELS.removeProvider]: providerPresetRequestSchema,
  [PROVIDER_CHANNELS.beginCredential]: providerPresetRequestSchema,
  [PROVIDER_CHANNELS.saveCredential]: providerCredentialRequestSchema,
  [PROVIDER_CHANNELS.testConnection]: providerPresetRequestSchema,
  [PROVIDER_CHANNELS.listModels]: providerPresetRequestSchema,
  [PROVIDER_CHANNELS.discoverLocal]: providerEmptyRequestSchema,
} as const)

export type ProviderRequestChannelName = Exclude<ProviderChannelName, typeof PROVIDER_CHANNELS.stateChanged>

/**
 * The bridge the sandboxed preload exposes as `window.zuriProviders`.
 *
 * Every method is a fixed channel with a typed payload, so the page can name a
 * preset and a key and nothing else. `onState` is the push side: the main process
 * sends the state it already validated, and calling the returned function removes
 * exactly that listener.
 */
export interface ProviderBridge {
  readState(): Promise<ProviderReply<ProviderSettingsState>>
  /** Never carries the key: only the endpoint and the model to start with. */
  saveProvider(request: ProviderSaveRequest): Promise<ProviderReply<ProviderSettingsState>>
  removeProvider(presetId: string): Promise<ProviderReply<ProviderSettingsState>>
  /** A single-use pass, so a key is submitted once and expires in a minute. */
  beginCredential(presetId: string): Promise<ProviderReply<ProviderChallenge>>
  saveCredential(
    presetId: string,
    nonce: string,
    secret: string,
  ): Promise<ProviderReply<ProviderCredentialSaved>>
  testConnection(presetId: string): Promise<ProviderReply<ProviderConnectionResult>>
  listModels(presetId: string): Promise<ProviderReply<ProviderModels>>
  discoverLocal(): Promise<ProviderReply<ProviderDiscovery>>
  onState(listener: (state: ProviderSettingsState) => void): () => void
}
