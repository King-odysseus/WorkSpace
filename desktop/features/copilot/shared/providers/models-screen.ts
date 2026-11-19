/*
 * What the Models screen draws, decided in one module rather than in a branch
 * inside the view.
 *
 * The desktop package runs its tests on node's runner, which has no DOM, so every
 * decision that is worth a test lives here and the React component only arranges
 * the result. That is the same arrangement the access screen uses, and it exists
 * for a second reason: a decision written once cannot drift between the provider
 * list, the model list and the connection result.
 *
 * Three of these functions exist because of a specific way a settings screen goes
 * wrong.
 *
 * 1. `availability` never says "Ready" for an entry that cannot be used. A card
 *    that looks configured but refuses every call is the most common complaint
 *    about a settings page, and the cure is to compute the answer from the same
 *    three facts the service checks: an endpoint, a key when one is required, and
 *    a model to start with.
 * 2. `secretFieldAfter` clears the key box only on a successful submit. Clearing
 *    it on a refusal would delete what the person typed, and they would have no way
 *    to tell a bad key from a key that never left the page.
 * 3. `capabilityChips` describes only what the provider actually reported. A chip
 *    for "tools" on a model that declares none is a promise the app cannot keep,
 *    and the first failed tool call is where it is discovered.
 */

import type { ProviderCapabilities } from './types.js'
import type {
  ProviderConnectionResult,
  ProviderEntry,
  ProviderSettingsFailure,
} from './settings-contract.js'

/**
 * One sentence per refusal token.
 *
 * A token from a newer main process falls through to the generic sentence rather
 * than appearing on the screen as an identifier.
 */
export function failureMessage (reason: ProviderSettingsFailure): string {
  switch (reason) {
    case 'untrusted_sender':
      return 'This window is not allowed to change model settings. Please reopen the app.'
    case 'invalid_request':
      return 'That change could not be saved. Check the address and try again.'
    case 'not_signed_in':
      return 'Sign in through the WorkSpace window before setting up a provider.'
    case 'unknown_preset':
      return 'This build does not know that provider. Try reopening the app.'
    case 'missing_credential':
      return 'Add an API key for this provider before testing the connection.'
    case 'storage_unavailable':
      return 'This machine cannot store keys securely, so nothing was saved.'
    case 'stale':
      return 'You signed out while that was running. Sign in again to continue.'
    case 'network':
      return 'The provider could not be reached. Check the address and your connection.'
    case 'rejected':
      return 'The provider turned that request down. Check the key and the model.'
    case 'internal_error':
      return 'Something went wrong on this side. Please try again.'
    default:
      return 'Something went wrong. Please try again in a moment.'
  }
}

export type AvailabilityTone = 'ready' | 'needs-key' | 'needs-endpoint' | 'needs-model'

export interface Availability {
  readonly tone: AvailabilityTone
  readonly label: string
}

/**
 * Whether an entry can actually be used, and what is missing if not.
 *
 * Order matters: an entry with no endpoint cannot be tested whatever its key, so
 * the endpoint is reported first. A local server needs no key, and the catalogue
 * says so, which is why this reads `requiresKey` rather than assuming every
 * provider needs one.
 */
export function availability (entry: ProviderEntry): Availability {
  if (entry.baseUrl.trim().length === 0) {
    return { tone: 'needs-endpoint', label: 'Add an address' }
  }
  if (entry.requiresKey && !entry.hasCredential) {
    return { tone: 'needs-key', label: 'Add a key' }
  }
  if (entry.defaultModel.trim().length === 0) {
    return { tone: 'needs-model', label: 'Choose a model' }
  }
  return { tone: 'ready', label: 'Ready' }
}

/** The endpoint's own answer about where the bytes go, worded for a person. */
export function originLabel (cloud: boolean): string {
  return cloud ? 'Cloud' : 'Local'
}

/**
 * The chips for one model, in a fixed order so a row does not reshuffle between
 * refreshes. An empty list means the provider reported nothing worth a chip, and
 * that is drawn as "text only" rather than as an empty space.
 */
export function capabilityChips (capabilities: ProviderCapabilities): string[] {
  const chips: string[] = []

  if (capabilities.tools === 'native') chips.push('Tools')
  else if (capabilities.tools === 'prompted') chips.push('Tools (guided)')
  else chips.push('No tools')

  if (capabilities.vision) chips.push('Images')
  if (capabilities.jsonMode) chips.push('JSON')
  if (capabilities.embeddings) chips.push('Embeddings')
  if (!capabilities.streaming) chips.push('No streaming')

  return chips
}

/** A model's context window, as a compact figure. */
export function contextLabel (contextWindow: number): string {
  /*
   * Rounded down, never up. A context window is a limit, and a figure that reads
   * higher than the real one invites a prompt the model will refuse.
   */
  const thousands = Math.floor(contextWindow / 1000)
  if (thousands >= 1) return `${thousands}k context`
  return `${contextWindow} context`
}

/** How a model's own id should read; never the raw provider string if a label exists. */
export function modelLabel (id: string, label: string): string {
  return label.trim().length > 0 ? label : id
}

export type ConnectionTone = 'idle' | 'testing' | 'ok' | 'failed'

export interface ConnectionView {
  readonly tone: ConnectionTone
  readonly message: string
}

/**
 * What the connection line says.
 *
 * `idle` before anything was tested, so a freshly saved provider does not claim a
 * health it has not checked. A failure carries the provider's fixed token through
 * `failureMessage`, never the provider's own wording.
 */
export function connectionView (state: ConnectionTone, result?: ProviderConnectionResult): ConnectionView {
  switch (state) {
    case 'testing':
      return { tone: 'testing', message: 'Testing the connection...' }
    case 'ok': {
      /*
       * A success tone with a failed result is not a success. The service returns
       * the two together and this is the branch where they can disagree, so the
       * failure wins: claiming a connection the provider refused is worse than
       * saying nothing about it.
       */
      if (result !== undefined && !result.ok) {
        return { tone: 'failed', message: failureMessage(failureTokenOf(result)) }
      }
      if (result === undefined) {
        return { tone: 'ok', message: 'The provider answered.' }
      }
      const count = result.modelCount
      const noun = count === 1 ? 'model' : 'models'
      return {
        tone: 'ok',
        message: `Connected. ${count} ${noun} available on ${originLabel(result.cloud).toLowerCase()}.`,
      }
    }
    case 'failed':
      if (result !== undefined && !result.ok) {
        return { tone: 'failed', message: failureMessage(failureTokenOf(result)) }
      }
      return { tone: 'failed', message: failureMessage('internal_error') }
    default:
      return { tone: 'idle', message: 'Not tested yet.' }
  }
}

/**
 * The token inside a failed connection result.
 *
 * The provider vocabulary is wider than this channel's, and the screen only needs
 * the sentence, so anything it does not recognise becomes a generic refusal.
 */
function failureTokenOf (result: ProviderConnectionResult): ProviderSettingsFailure {
  if (result.ok) return 'internal_error'
  switch (result.failure) {
    case 'network':
    case 'timeout':
      return 'network'
    case 'provider_unauthorized':
    case 'provider_rate_limited':
    case 'provider_unavailable':
    case 'provider_rejected':
    case 'malformed_response':
    case 'context_too_long':
    case 'model_not_found':
    case 'egress_blocked':
      return 'rejected'
    default:
      return 'internal_error'
  }
}

/**
 * What happens to the key box after a submit.
 *
 * Clearing is the only signal a person gets that a key was actually stored rather
 * than quietly held in the field, which is why it happens on success and nowhere
 * else.
 */
export function secretFieldAfter (submitted: boolean): 'clear' | 'keep' {
  return submitted ? 'clear' : 'keep'
}

/** An empty model list is a fact about the provider, not an error. */
export function modelsEmptyMessage (presetLabel: string, cloud: boolean): string {
  if (cloud) {
    return `${presetLabel} reported no models for this endpoint. Check that the key can see them on this account.`
  }
  return `No models were reported by this local server. ${presetLabel} may need a model pulled first.`
}
