/*
 * ZuriCopilot's desktop status screen: the bridge's presence, its contract, and
 * the last call's result. Read-only by design, so the bridge is optional here
 * and every reply is treated as untrusted data rather than as a type to believe.
 *
 * This is the Phase 0 screen, not product UI: it is what the probe view opens to
 * prove the boundary works. It is written with the shared Tailwind tokens like
 * the rest of the desktop renderer, so the shell ships one visual vocabulary and
 * no hand-written stylesheet of its own.
 */
import { useEffect, useRef, useState } from 'react'

import type { ContractInfoResult, CopilotBridge, ProbeResult, RefusalReason } from './copilot-bridge'

/** The value the contract channel answers with when it accepts the call. */
type ContractValue = Extract<ContractInfoResult, { ok: true }>['value']

/**
 * The probe fields this screen shows. The rest of a reply is deliberately not
 * read, so nothing outside this list can reach the DOM.
 */
type ProbeView = {
  action: 'read' | 'write'
  status: 'ok' | 'failed'
  errorCode: ProbeResult['errorCode']
  httpStatus: number | null
  durationMs: number | null
  checkedAt: string | null
}

/** A reply after guarding: the only shapes this screen will render. */
type Reply =
  | { kind: 'contract'; value: ContractValue }
  | { kind: 'refusal'; reason: RefusalReason }
  | { kind: 'probe'; probe: ProbeView }
  | { kind: 'unrecognised' }
  | { kind: 'error'; message: string | null }

type ContractCard =
  | { kind: 'idle' }
  | { kind: 'ok'; value: ContractValue }
  | { kind: 'problem'; message: string }

const REFUSAL_REASONS: readonly RefusalReason[] = [
  'internal_error', 'invalid_request', 'invalid_response', 'untrusted_sender',
]

type ProbeErrorCode = NonNullable<ProbeResult['errorCode']>

const PROBE_ERROR_CODES: readonly ProbeErrorCode[] = [
  'csrf_rejected', 'http_error', 'network_error', 'no_workspace', 'not_implemented', 'not_signed_in', 'unknown',
]

// A rejection message is the one outside string that can reach this page, so it
// is capped and never laid out in full.
const MAX_ERROR_MESSAGE = 200

const UNRECOGNISED: Reply = { kind: 'unrecognised' }

/*
 * The screen's shapes, in one place.
 *
 * Square corners, no border, no shadow: a card is a fill and a button is a fill
 * with a label. Separation comes from the surface tint and spacing, which is the
 * rule the rest of the product follows.
 */
const CARD = 'mt-4 bg-surface p-4'
const CARD_TITLE = 'mb-3 text-[15px] font-semibold uppercase tracking-[0.08em]'
const MUTED_TEXT = 'text-[13px] text-text-secondary'
const ACTIONS = 'mt-3 flex flex-wrap gap-2'
const BUTTON = 'bg-bronze px-4 py-2.5 text-[15px] text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary disabled:bg-bronze/40 disabled:text-text-secondary'

/** The chip carries the state, so its colour is derived rather than keyed off an attribute. */
function chipClass (state: string): string {
  const tone = state === 'ready'
    ? 'text-bronze'
    : state === 'none'
      ? 'text-danger'
      : 'text-text-primary'
  return `ml-auto bg-surface px-2 py-0.5 text-[13px] tracking-[0.04em] ${tone}`
}

function readBridge (): CopilotBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.copilot
}

/** Keep a value only when it is one of the allowed tokens. */
function pick<T extends string> (allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' ? allowed.find(entry => entry === value) ?? null : null
}

function numberOrNull (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function guardContractValue (value: unknown): Reply {
  if (typeof value !== 'object' || value === null) return UNRECOGNISED
  const record = value as Record<string, unknown>
  if (record.contractVersion !== 1 || !Array.isArray(record.channels)) return UNRECOGNISED

  const listed: unknown[] = record.channels
  const channels: string[] = []
  for (const channel of listed) {
    if (typeof channel !== 'string') return UNRECOGNISED
    channels.push(channel)
  }

  return { kind: 'contract', value: { contractVersion: 1, channels } }
}

function guardProbe (record: Record<string, unknown>): Reply {
  const { action, status, errorCode, httpStatus, durationMs, checkedAt } = record
  if (record.contractVersion !== 1) return UNRECOGNISED
  if (action !== 'read' && action !== 'write') return UNRECOGNISED
  if (status !== 'ok' && status !== 'failed') return UNRECOGNISED

  // A field of the wrong type becomes null (shown as n/a). Rebuilding the reply
  // here is what keeps an unexpected key from being handed to the renderer.
  const probe: ProbeView = {
    action,
    status,
    errorCode: pick(PROBE_ERROR_CODES, errorCode),
    httpStatus: numberOrNull(httpStatus),
    durationMs: numberOrNull(durationMs),
    checkedAt: typeof checkedAt === 'string' ? checkedAt : null,
  }

  return { kind: 'probe', probe }
}

function guardReply (value: unknown): Reply {
  if (typeof value !== 'object' || value === null) return UNRECOGNISED
  const record = value as Record<string, unknown>
  const { ok } = record

  if (ok === false) {
    const reason = pick(REFUSAL_REASONS, record.reason)
    return reason === null ? UNRECOGNISED : { kind: 'refusal', reason }
  }
  if (ok === true) return guardContractValue(record.value)
  // `ok` present but not a boolean is not a reply this screen knows.
  if (ok !== undefined) return UNRECOGNISED
  // The contract channel answers an ok envelope; the probe channel answers a
  // bare probe object, so a missing `ok` falls through to that shape.
  return guardProbe(record)
}

function errorMessage (error: unknown): string | null {
  // Only a string message is shown; the error object is never stringified,
  // because its stack can name local paths.
  if (typeof error !== 'object' || error === null) return null
  const { message } = error as { message?: unknown }
  if (typeof message !== 'string' || message.trim() === '') return null
  return message.slice(0, MAX_ERROR_MESSAGE)
}

function contractProblem (reply: Reply): string {
  if (reply.kind === 'refusal') return `The bridge refused the check (${reply.reason}).`
  if (reply.kind === 'error') return 'The bridge did not answer.'
  return 'Unrecognised reply'
}

function show (value: string | number | boolean | null): string {
  return value === null ? 'n/a' : String(value)
}

function chipText (busy: boolean, hasBridge: boolean, ready: boolean): string {
  if (busy) return 'Working'
  if (!hasBridge) return 'No bridge'
  return ready ? 'Bridge ready' : 'Local window'
}

function Row ({ label, value, mono = false, danger = false }: {
  label: string; value: string; mono?: boolean; danger?: boolean
}) {
  const classes = 'text-text-primary [overflow-wrap:anywhere] tabular-nums' +
    (mono ? ' font-mono text-[13px]' : '') +
    (danger ? ' text-danger' : '')
  return (
    <div className="grid grid-cols-[minmax(96px,152px)_1fr] items-baseline gap-x-4">
      <span className="text-[13px] text-text-secondary">{label}</span>
      <span className={classes}>{value}</span>
    </div>
  )
}

function ContractRows ({ value }: { value: ContractValue }) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      <Row label="Contract version" value={show(value.contractVersion)} mono />
      {value.channels.map(channel => <Row key={channel} label="Channel" value={channel} mono />)}
    </div>
  )
}

function ContractDetail ({ contract }: { contract: ContractCard }) {
  if (contract.kind === 'idle') return <p className={MUTED_TEXT}>No contract check yet.</p>
  if (contract.kind === 'problem') return <p className="text-[13px] text-danger">{contract.message}</p>
  return <ContractRows value={contract.value} />
}

function ReplyDetail ({ reply }: { reply: Reply }) {
  if (reply.kind === 'unrecognised') return <p className="text-[13px] text-text-secondary">Unrecognised reply</p>
  if (reply.kind === 'error') {
    return (
      <div>
        <p className={MUTED_TEXT}>The bridge did not answer.</p>
        {reply.message === null ? null : <p className="font-mono text-[13px] text-text-secondary">{reply.message}</p>}
      </div>
    )
  }
  if (reply.kind === 'refusal') {
    return (
      <div className="mt-3 flex flex-col gap-1">
        <Row label="Reason" value={reply.reason} mono danger />
      </div>
    )
  }
  if (reply.kind === 'contract') return <ContractRows value={reply.value} />

  const probe = reply.probe
  return (
    <div className="mt-3 flex flex-col gap-1">
      <Row label="Action" value={probe.action} mono />
      <Row label="Status" value={probe.status} mono danger={probe.status === 'failed'} />
      <Row label="Error code" value={show(probe.errorCode)} mono danger={probe.errorCode !== null} />
      <Row label="HTTP status" value={show(probe.httpStatus)} mono />
      <Row label="Duration" value={probe.durationMs === null ? 'n/a' : `${probe.durationMs} ms`} mono />
      <Row label="Checked at" value={show(probe.checkedAt)} mono />
    </div>
  )
}

export default function ProbeView () {
  const bridge = readBridge()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Reply | null>(null)
  const [contract, setContract] = useState<ContractCard>({ kind: 'idle' })

  /**
   * The one path every bridge call takes. A ref, not state, holds the in-flight
   * flag so two calls cannot start in the same tick, and a rejected promise
   * becomes a reply shape instead of an unhandled rejection.
   */
  async function send (call: () => Promise<unknown>): Promise<Reply | null> {
    if (running.current) return null
    running.current = true
    setBusy(true)
    try {
      return guardReply(await call())
    } catch (error) {
      return { kind: 'error', message: errorMessage(error) }
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  async function checkContract (): Promise<void> {
    const target = bridge
    if (!target) return
    const outcome = await send(() => target.contract())
    if (outcome === null) return

    // Typed before it is stored so the card union stays narrow: a probe or
    // unrecognised answer means the check did not answer with a contract.
    const card: ContractCard = outcome.kind === 'contract'
      ? { kind: 'ok', value: outcome.value }
      : { kind: 'problem', message: contractProblem(outcome) }

    setReply(outcome)
    setContract(card)
  }

  async function runProbe (action: 'read' | 'write'): Promise<void> {
    const target = bridge
    if (!target) return
    const outcome = await send(() => (action === 'read' ? target.probe.read() : target.probe.write()))
    if (outcome !== null) setReply(outcome)
  }

  // One contract check on mount, and only when a bridge exists: on a plain page
  // there is nothing to call and nothing to report.
  useEffect(() => {
    if (!bridge) return
    void checkContract()
  }, [bridge])

  const ready = contract.kind === 'ok'
  const state = busy ? 'working' : bridge === undefined ? 'none' : ready ? 'ready' : 'local'

  return (
    <main className="mx-auto max-w-[720px] p-6 text-text-primary">
      <header className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="m-0 text-[15px] font-semibold tracking-[0.02em]">ZuriCopilot</h1>
        <span className={chipClass(state)} data-state={state}>{chipText(busy, bridge !== undefined, ready)}</span>
      </header>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>Bridge</h2>
        {bridge === undefined
          ? <p className="m-0">This page is not running inside the desktop shell, so there is no bridge and no messages are possible.</p>
          : (
            <>
              <p className="m-0 mb-2">window.copilot is present. Every call goes through the desktop main process; this page sends nothing itself.</p>
              <div className={ACTIONS}>
                <button type="button" className={BUTTON} disabled={busy} onClick={() => { void checkContract() }}>Check contract</button>
              </div>
              <ContractDetail contract={contract} />
            </>
            )}
      </section>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>Last reply</h2>
        {reply === null
          ? <p className={MUTED_TEXT}>{busy ? 'Waiting for the bridge.' : 'No call has been made yet.'}</p>
          : <ReplyDetail reply={reply} />}
      </section>

      <section className={CARD}>
        <h2 className={CARD_TITLE}>Probe</h2>
        <div className={ACTIONS}>
          <button
            type="button"
            className={BUTTON}
            disabled={bridge === undefined || busy}
            onClick={() => { void runProbe('read') }}
          >
            Run read
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={bridge === undefined || busy}
            onClick={() => { void runProbe('write') }}
          >
            Run write
          </button>
        </div>
        <p className={`${MUTED_TEXT} mt-3`}>Run write creates one task and deletes it again. It is the only write this bridge performs.</p>
      </section>
    </main>
  )
}
