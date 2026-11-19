/*
 * Models: which provider the assistant may talk to, and what it can do.
 *
 * The screen is deliberately plain about what it knows. Every claim it makes comes
 * from one of three places, and it never guesses at a fourth:
 *
 * - The catalogue, which is this build's own list of providers.
 * - The stored configuration, which is what the person saved last.
 * - The provider's answer, which arrives from a call the person asked for.
 *
 * So a newly saved entry does not claim to be connected until a test says so, and
 * a model list is only ever the list a provider actually reported. The decisions
 * that could go wrong - what "Ready" means, which chips a model gets, what a
 * failure reads as - live in `models-screen.ts` so they are tested without a DOM.
 * This file arranges them.
 *
 * Two rules are load-bearing and easy to lose in a rewrite:
 *
 * 1. The key field is cleared only after a successful save. Clearing it on a
 *    refusal deletes what the person typed and hides whether the key ever left
 *    the page.
 * 2. Nothing here reads the state after unmount. A sign-out replaces this whole
 *    surface with the access gate, and a late reply from the previous account must
 *    not be able to write into a screen that is no longer theirs.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import type {
  ProviderBridge,
  ProviderChallenge,
  ProviderConnectionResult,
  ProviderCredentialSaved,
  ProviderDiscovery,
  ProviderEntry,
  ProviderModels,
  ProviderReply,
  ProviderSettingsFailure,
  ProviderSettingsState,
} from '../../features/copilot/shared/providers/settings-contract.js'
import type { ModelInfo } from '../../features/copilot/shared/providers/types.js'
import {
  availability,
  capabilityChips,
  connectionView,
  contextLabel,
  failureMessage,
  modelLabel,
  modelsEmptyMessage,
  originLabel,
  secretFieldAfter,
  type ConnectionTone,
} from '../../features/copilot/shared/providers/models-screen.js'

/*
 * Focus rings are the app's own token rather than the browser's, so a keyboard
 * user sees the same shape in both themes and on every control.
 *
 * The corner and the border are not set here. The application's token sheet rounds
 * controls to a pill with `!important` and leaves a hairline border on inputs, so a
 * utility would lose and read as intent while doing nothing. `shell.css` owns those
 * two properties for this screen, once, for every control inside it.
 */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze'
const QUIET = 'text-text-secondary'
const CHIP = 'bg-surface-secondary px-1.5 py-0.5 text-[11px] font-medium text-text-secondary'

/** Which provider the form is editing. Every field is a string, as inputs are. */
interface Draft {
  readonly presetId: string
  readonly baseUrl: string
  readonly defaultModel: string
  readonly secret: string
}

const EMPTY_DRAFT: Draft = { presetId: '', baseUrl: '', defaultModel: '', secret: '' }

export interface ModelsPanelProps {
  readonly bridge: ProviderBridge
}

export function ModelsPanel ({ bridge }: ModelsPanelProps) {
  const [state, setState] = useState<ProviderSettingsState | null>(null)
  const [readFailure, setReadFailure] = useState<ProviderSettingsFailure | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<ProviderSettingsFailure | null>(null)
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null)
  const [connection, setConnection] = useState<{ tone: ConnectionTone; result?: ProviderConnectionResult }>({ tone: 'idle' })
  const [models, setModels] = useState<ProviderModels | null>(null)
  const [discovery, setDiscovery] = useState<ProviderDiscovery | null>(null)

  /*
   * A ref rather than state: this answers "may I still write" and a render must
   * not be triggered by the answer. It is cleared on unmount, which is the moment
   * the gate replaces this surface after a sign-out.
   */
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const applyState = useCallback((next: ProviderSettingsState) => {
    if (!live.current) return
    setState(next)
    setReadFailure(null)
  }, [])

  useEffect(() => {
    if (!bridge || typeof bridge.readState !== 'function') {
      setReadFailure('internal_error')
      return undefined
    }

    /*
     * Subscribe before the first read, so a change that lands between the two is
     * applied rather than missed. The push and the read carry the same shape, so
     * the later one simply wins.
     */
    const unsubscribe = bridge.onState(applyState)

    void bridge.readState().then(reply => {
      if (!live.current) return
      if (reply.ok) applyState(reply.value)
      else setReadFailure(reply.reason)
    })

    return unsubscribe
  }, [bridge, applyState])

  /** Begin a call, run it, and keep the person's place if it is refused. */
  const run = useCallback(async <T,>(key: string, call: () => Promise<ProviderReply<T>>): Promise<T | null> => {
    setBusy(key)
    setNotice(null)
    try {
      const reply = await call()
      if (!live.current) return null
      if (!reply.ok) {
        setNotice(reply.reason)
        return null
      }
      return reply.value
    } finally {
      if (live.current) setBusy(null)
    }
  }, [])

  const selected = state === null ? null : state.catalog.find(entry => entry.id === draft.presetId) ?? null

  const saved = state === null ? [] : state.providers
  const editing = saved.find(entry => entry.presetId === draft.presetId) ?? null

  function pickPreset (presetId: string): void {
    const entry = state === null ? null : state.catalog.find(row => row.id === presetId) ?? null
    setDraft(prev => ({
      presetId,
      // Prefill from the stored entry when there is one, then from the catalogue.
      // A person reopening an entry expects to see what they saved, not a blank.
      baseUrl: saved.find(row => row.presetId === presetId)?.baseUrl ?? entry?.baseUrl ?? '',
      defaultModel: saved.find(row => row.presetId === presetId)?.defaultModel ?? entry?.defaultModel ?? '',
      secret: prev.presetId === presetId ? prev.secret : '',
    }))
    setNotice(null)
    setSavedFingerprint(null)
    setConnection({ tone: 'idle' })
    setModels(null)
  }

  async function saveProvider (event: FormEvent): Promise<void> {
    event.preventDefault()
    if (selected === null) {
      setNotice('invalid_request')
      return
    }
    const value = await run('save', () => bridge.saveProvider({
      presetId: draft.presetId,
      baseUrl: draft.baseUrl,
      defaultModel: draft.defaultModel,
    }))
    if (value !== null) applyState(value)
  }

  async function saveKey (): Promise<void> {
    if (selected === null || draft.secret.trim().length === 0) {
      setNotice('missing_credential')
      return
    }

    /*
     * The pass is issued for this account and this entry, and the store decided
     * what may be shown back. A challenge that cannot be issued is reported as the
     * refusal it is: storage being unavailable is worth saying before the person
     * types a key that has nowhere to go.
     */
    const issued = await run<ProviderChallenge>('key', () => bridge.beginCredential(draft.presetId))
    if (issued === null) return

    const stored = await run<ProviderCredentialSaved>(
      'key',
      () => bridge.saveCredential(draft.presetId, issued.nonce, draft.secret),
    )
    if (stored === null) return

    if (secretFieldAfter(true) === 'clear') setDraft(prev => ({ ...prev, secret: '' }))
    setSavedFingerprint(stored.fingerprint)

    const refreshed = await bridge.readState()
    if (live.current && refreshed.ok) applyState(refreshed.value)
  }

  async function forget (presetId: string): Promise<void> {
    const value = await run(`remove:${presetId}`, () => bridge.removeProvider(presetId))
    if (value === null) return
    applyState(value)
    if (draft.presetId === presetId) setDraft(EMPTY_DRAFT)
  }

  async function test (presetId: string): Promise<void> {
    setConnection({ tone: 'testing' })
    setModels(null)

    const result = await run<ProviderConnectionResult>(`test:${presetId}`, () => bridge.testConnection(presetId))
    if (result === null) {
      if (live.current) setConnection({ tone: 'failed' })
      return
    }
    if (!live.current) return

    setConnection({ tone: result.ok ? 'ok' : 'failed', result })
    if (!result.ok) return

    // A connection that worked is the natural moment to show what it offers, so
    // the list arrives without a second click.
    const listed = await run<ProviderModels>(`models:${presetId}`, () => bridge.listModels(presetId))
    if (listed !== null) setModels(listed)
  }

  async function discover (): Promise<void> {
    const found = await run<ProviderDiscovery>('discover', () => bridge.discoverLocal())
    if (found === null) return
    setDiscovery(found)
  }

  if (readFailure !== null) {
    return (
      <Wrapper>
        <Notice tone="danger">{failureMessage(readFailure)}</Notice>
      </Wrapper>
    )
  }

  if (state === null) {
    return (
      <Wrapper>
        <p className={QUIET} role="status">Reading model settings...</p>
      </Wrapper>
    )
  }

  const connectionLine = connectionView(connection.tone, connection.result)

  return (
    <Wrapper>
      <p className={`mt-1 text-sm ${QUIET}`}>
        Keys are stored in this machine's encrypted storage and never leave the main process.
      </p>

      {notice !== null && (
        <Notice tone="danger">{failureMessage(notice)}</Notice>
      )}

      {!state.signedIn && (
        <Notice tone="info">
          Sign in through the WorkSpace window to add a provider.
        </Notice>
      )}

      {/* Saved providers, each with the same three facts: state, endpoint, key. */}
      {saved.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Configured providers">
          {saved.map(entry => (
            <SavedRow
              key={entry.presetId}
              entry={entry}
              busy={busy}
              onTest={() => { void test(entry.presetId) }}
              onEdit={() => pickPreset(entry.presetId)}
              onRemove={() => { void forget(entry.presetId) }}
            />
          ))}
        </ul>
      )}

      {/* The form. One entry at a time, because a person configures one provider. */}
      <form className="mt-4 bg-surface-secondary p-3" onSubmit={event => { void saveProvider(event) }}>
        <h2 className="text-sm font-semibold text-text-primary">Add or change a provider</h2>

        <div className="mt-3 flex flex-col gap-3">
          <Field label="Provider" htmlFor="provider-preset">
            <select
              id="provider-preset"
              data-shell="models-preset"
              value={draft.presetId}
              disabled={!state.signedIn}
              onChange={event => pickPreset(event.target.value)}
              className={`w-full bg-surface px-2 py-1.5 text-sm text-text-primary ${FOCUS}`}
            >
              <option value="">Choose a provider</option>
              {state.catalog.map(entry => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}{entry.local ? ' (local)' : ''}
                </option>
              ))}
            </select>
          </Field>

          {selected !== null && (
            <>
              <Field
                label="Address"
                htmlFor="provider-base-url"
                hint={selected.needsBaseUrl ? 'Required for this provider.' : 'Leave as it is unless you use a gateway.'}
              >
                <input
                  id="provider-base-url"
                  data-shell="models-base-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.baseUrl}
                  disabled={!state.signedIn}
                  placeholder={selected.baseUrl}
                  onChange={event => setDraft(prev => ({ ...prev, baseUrl: event.target.value }))}
                  className={`w-full bg-surface px-2 py-1.5 text-sm text-text-primary ${FOCUS}`}
                />
              </Field>

              <Field
                label="Starting model"
                htmlFor="provider-model"
                hint={selected.requiresKey ? undefined : 'Optional for a local server.'}
              >
                <input
                  id="provider-model"
                  data-shell="models-default-model"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.defaultModel}
                  disabled={!state.signedIn}
                  placeholder={selected.defaultModel.length > 0 ? selected.defaultModel : 'Choose from the list after connecting'}
                  onChange={event => setDraft(prev => ({ ...prev, defaultModel: event.target.value }))}
                  className={`w-full bg-surface px-2 py-1.5 text-sm text-text-primary ${FOCUS}`}
                />
              </Field>

              <button
                type="submit"
                data-shell="models-save"
                disabled={!state.signedIn || busy !== null}
                className={`self-start bg-navy px-3 py-1.5 text-sm font-medium text-text-on-navy transition-colors hover:bg-navy-hover disabled:opacity-50 ${FOCUS}`}
              >
                Save provider
              </button>

              <Field
                label="API key"
                htmlFor="provider-secret"
                hint={editing?.hasCredential === true
                  ? `A key is already stored (${editing.fingerprint ?? 'hidden'}). Enter a new one to replace it.`
                  : selected.requiresKey ? 'Required for this provider.' : 'Only if your server asks for one.'}
              >
                <div className="flex gap-2">
                  <input
                    id="provider-secret"
                    data-shell="models-secret"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.secret}
                    disabled={!state.signedIn}
                    onChange={event => setDraft(prev => ({ ...prev, secret: event.target.value }))}
                    className={`min-w-0 flex-1 bg-surface px-2 py-1.5 text-sm text-text-primary ${FOCUS}`}
                  />
                  <button
                    type="button"
                    data-shell="models-save-key"
                    disabled={!state.signedIn || busy !== null}
                    onClick={() => { void saveKey() }}
                    className={`shrink-0 bg-surface px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50 ${FOCUS}`}
                  >
                    Save key
                  </button>
                </div>
              </Field>

              {savedFingerprint !== null && (
                <p className="text-xs text-text-secondary" role="status">
                  Key stored, ending {savedFingerprint}.
                </p>
              )}
            </>
          )}
        </div>
      </form>

      {/* Connection and models. Absent until the person asks for them. */}
      {saved.length > 0 && (
        <section className="mt-4" aria-label="Connection">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-shell="models-discover"
              disabled={busy !== null}
              onClick={() => { void discover() }}
              className={`bg-surface-secondary px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50 ${FOCUS}`}
            >
              Look for local models
            </button>
          </div>

          <p
            data-shell="models-connection"
            data-connection={connectionLine.tone}
            aria-live="polite"
            className={`mt-3 text-sm ${connectionLine.tone === 'failed' ? 'text-danger' : QUIET}`}
          >
            {connectionLine.message}
          </p>

          {models !== null && (
            <ModelList models={models.models} cloud={models.cloud} presetLabel={labelFor(state, models.presetId)} />
          )}
        </section>
      )}

      {discovery !== null && <Discovery candidates={discovery.candidates} />}
    </Wrapper>
  )
}

function Wrapper ({ children }: { children: ReactNode }) {
  return (
    <div
      data-shell="models-screen"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface px-6 py-5"
    >
      <h1 className="text-lg font-semibold text-text-primary">Models</h1>
      {children}
    </div>
  )
}

function Field ({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">{label}</label>
      {children}
      {hint !== undefined && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  )
}

function Notice ({ tone, children }: { tone: 'danger' | 'info'; children: ReactNode }) {
  const skin = tone === 'danger'
    ? 'bg-alert-danger-fill text-alert-danger-text'
    : 'bg-alert-info-fill text-alert-info-text'
  return (
    <p role="status" className={`mt-3 px-3 py-2 text-sm ${skin}`}>{children}</p>
  )
}

function SavedRow ({
  entry,
  busy,
  onTest,
  onEdit,
  onRemove,
}: {
  entry: ProviderEntry
  busy: string | null
  onTest: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const state = availability(entry)
  return (
    <li className="bg-surface-secondary p-3" data-shell="models-row" data-preset={entry.presetId}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{entry.label}</span>
        <span className={CHIP}>{originLabel(!entry.local)}</span>
        <span
          className={CHIP}
          data-availability={state.tone}
        >
          {state.label}
        </span>
      </div>

      <p className="mt-1 truncate text-xs text-text-secondary">{entry.baseUrl}</p>
      <p className="mt-0.5 text-xs text-text-muted">
        {entry.defaultModel.length > 0 ? entry.defaultModel : 'No starting model'}
        {entry.hasCredential ? ` - key ${entry.fingerprint ?? 'stored'}` : ''}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          data-shell="models-test"
          disabled={busy !== null}
          onClick={onTest}
          className={`bg-surface px-2.5 py-1 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50 ${FOCUS}`}
        >
          Test connection
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={onEdit}
          className={`bg-surface px-2.5 py-1 text-xs font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50 ${FOCUS}`}
        >
          Change
        </button>
        <button
          type="button"
          data-shell="models-remove"
          disabled={busy !== null}
          onClick={onRemove}
          className={`bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-50 ${FOCUS}`}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

function ModelList ({ models, cloud, presetLabel }: { models: readonly ModelInfo[]; cloud: boolean; presetLabel: string }) {
  if (models.length === 0) {
    return <p className="mt-3 text-sm text-text-secondary">{modelsEmptyMessage(presetLabel, cloud)}</p>
  }

  return (
    <div className="mt-3" data-shell="models-list" data-cloud={cloud ? 'true' : 'false'}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {originLabel(cloud)} models
      </h3>
      <ul className="mt-2 flex flex-col gap-1">
        {models.map(model => (
          <li key={model.id} className="flex flex-wrap items-center gap-1.5 bg-surface-secondary px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{modelLabel(model.id, model.label)}</span>
            <span className={CHIP}>{originLabel(model.cloud)}</span>
            {capabilityChips(model.capabilities).map(chip => (
              <span key={chip} className={CHIP}>{chip}</span>
            ))}
            <span className={CHIP}>{contextLabel(model.capabilities.contextWindow)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Discovery ({ candidates }: { candidates: ProviderDiscovery['candidates'] }) {
  return (
    <section className="mt-4" aria-label="Local servers" data-shell="models-discovery">
      <h2 className="text-sm font-semibold text-text-primary">Local servers</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {candidates.map(entry => (
          <li key={entry.presetId} className="bg-surface-secondary p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{entry.label}</span>
              <span className={CHIP}>{entry.reachable ? `${entry.models.length} found` : 'Not running'}</span>
            </div>
            <p className="mt-1 truncate text-xs text-text-secondary">{entry.baseUrl}</p>
            {!entry.reachable && entry.failure !== null && (
              <p className="mt-1 text-xs text-text-muted">{failureMessage('network')}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function labelFor (state: ProviderSettingsState, presetId: string): string {
  const entry = state.catalog.find(row => row.id === presetId)
  return entry?.label ?? presetId
}
