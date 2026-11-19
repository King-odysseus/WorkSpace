/*
 * The screen the assistant draws instead of its content while access is locked.
 *
 * The main process decides why the assistant is closed to this person and pushes
 * that reason as a fixed token. This file turns each token into one instruction,
 * because the five situations ask for five different actions: sign in, ask an
 * owner, sign in again, accept that a grant was withdrawn, or reload the account
 * that is actually signed in now. Collapsing them into a single "no access" note
 * would tell a person who is signed in perfectly well to sign in.
 *
 * Every call here is a request, never a decision. A reply carries nothing but a
 * refusal sentence; on success the pushed state arrives on `onState`, the parent
 * swaps this screen for the panel, and no state is kept here.
 *
 * Square corners, no borders, no shadows, and no inline styles: the page's
 * Content-Security-Policy is style-src 'self', so every rule below is a Tailwind
 * utility and separation comes from the surface tints.
 */
import { useState } from 'react'

import type {
  AccessBridge,
  AccessFailure,
  AccessState,
  LockReason,
} from '../../features/copilot/shared/access-contract'

export interface AccessGateProps {
  bridge: AccessBridge
  state: AccessState
}

/**
 * Focus rings depend on what sits behind them, not on the control itself.
 * Controls on navy get bronze, which reads against navy in both themes; controls
 * on the app surface get info in light and bronze in dark, because bronze on the
 * light surface is too close to white to count as a visible ring.
 */
const NAVY_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze'

const SURFACE_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info dark:focus-visible:outline-bronze'

const GENERIC_FAILURE = 'Something went wrong. Please try again in a moment.'

/**
 * The sentence shown when a refusal arrives. Each branch reads the fixed token
 * and never echoes anything from the request, so a page cannot be tricked into
 * rendering a message the main process did not send. The default covers a token
 * from a newer main process: it reads as ordinary English instead of an
 * identifier the person cannot act on.
 */
function failureMessage (reason: AccessFailure): string {
  switch (reason) {
    case 'untrusted_sender':
      return 'This window is not allowed to ask for that. Please reopen ZuriCopilot.'
    case 'invalid_request':
      return 'That request could not be understood. Please try again.'
    case 'not_signed_in':
      return 'You are not signed in. Sign in through the WorkSpace window first.'
    case 'no_access':
      return 'No workspace gives you assistant access yet. An owner has to turn it on.'
    case 'not_owner':
      return 'Only an owner of this workspace can do that.'
    case 'network':
      return 'WorkSpace could not be reached. Check your connection, then try again.'
    case 'rejected':
      return 'WorkSpace turned that request down. Please try again.'
    case 'internal_error':
      return 'WorkSpace hit a problem on its side. Please try again.'
    default:
      return GENERIC_FAILURE
  }
}

/** The headline for a lock reason, kept per reason so each one names its own case. */
function gateTitle (reason: LockReason): string {
  switch (reason) {
    case 'signed_out':
      return 'Sign in to use the assistant'
    case 'no_access':
      return 'You do not have assistant access yet'
    case 'expired':
      return 'Your sign-in ended'
    case 'revoked':
      return 'Assistant access was turned off'
    case 'account_changed':
      return 'A different account is signed in'
    default:
      return 'The assistant is not available right now'
  }
}

/**
 * What the person should do next. `no_access` is the only reason that names the
 * person and the workspaces they belong to: with those two facts the screen can
 * say which owner to ask, and without them it would be a dead end.
 */
function gateBody (reason: LockReason, state: AccessState): string {
  const name = state.identity?.name ?? null

  switch (reason) {
    case 'signed_out':
      return 'Open the WorkSpace window and sign in. When you are signed in, come back here and check again.'
    case 'no_access':
      return name === null
        ? 'An owner of a workspace has to turn on assistant access for you before you can use ZuriCopilot.'
        : `You are signed in as ${name}. An owner of a workspace has to turn on assistant access for you before you can use ZuriCopilot.`
    case 'expired':
      return 'Your sign-in ended while the app was open. Sign in again in the WorkSpace window, then check again.'
    case 'revoked':
      return 'An owner turned off assistant access for you. If you think that is a mistake, ask an owner to turn it back on.'
    case 'account_changed':
      return 'A different account signed in to WorkSpace while this screen was open. Check again to load the access for the account that is signed in now.'
    default:
      return 'The assistant is not open to this account right now. Check again in a moment.'
  }
}

/**
 * One short sentence where a call went wrong. A live region rather than an
 * alert: a refusal belongs next to the button that caused it, and it should not
 * interrupt whatever the person is reading.
 */
export function AccessFailureNote ({ message }: { message: string | null }) {
  if (message === null) return null

  return (
    <p
      role="status"
      className="mt-4 bg-surface px-3 py-2 text-left text-sm leading-relaxed break-words text-text-primary"
    >
      {message}
    </p>
  )
}

export function AccessGate ({ bridge, state }: AccessGateProps) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  /*
   * The contract allows a locked state without a reason, for example in the first
   * frame before the server has answered. "Not signed in" is the only instruction
   * that is safe in that case: it asks for nothing and loses nothing.
   */
  const reason: LockReason = state.reason ?? 'signed_out'

  async function checkAgain (): Promise<void> {
    setBusy(true)
    setFailure(null)

    try {
      const reply = await bridge.refresh()
      if (!reply.ok) setFailure(failureMessage(reply.reason))
    } catch (error: unknown) {
      // A refusal is a reply, so a throw means the channel itself broke. Say so
      // in the same fixed words rather than leaving a silent, dead button.
      console.error('AccessGate: refresh failed', error)
      setFailure(failureMessage('internal_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="Assistant access"
      aria-busy={busy}
      data-access="gate"
      data-reason={reason}
      className="flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-center overflow-y-auto bg-surface px-6 py-10"
    >
      <div className="w-full max-w-[420px] bg-surface-secondary px-6 py-8 text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-10 place-items-center bg-bronze text-base font-bold leading-none text-navy-dark"
        >
          Z
        </span>

        <h1 className="mt-5 text-lg font-semibold break-words text-text-primary">
          {gateTitle(reason)}
        </h1>

        <p className="mt-2 text-sm leading-relaxed break-words text-text-secondary">
          {gateBody(reason, state)}
        </p>

        {/*
          The workspace names are the one concrete thing a person can take to an
          owner, so the ask screen lists them instead of describing the problem
          only. They are not buttons: an ungranted workspace cannot be selected,
          and offering a control that would be refused is worse than naming it.
        */}
        {reason === 'no_access' && state.workspaces.length > 0 && (
          <ul
            aria-label="Workspaces you belong to"
            className="mt-4 flex flex-col gap-1 text-left"
          >
            {state.workspaces.map(entry => (
              <li
                key={entry.id}
                className="bg-surface px-3 py-2 text-sm break-words text-text-primary"
              >
                {entry.name}
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          data-access="check-again"
          disabled={busy}
          onClick={() => { void checkAgain() }}
          className={`mt-6 bg-navy px-5 py-2.5 text-sm font-medium text-text-on-navy transition-colors hover:bg-navy-hover disabled:cursor-default disabled:bg-surface disabled:text-text-muted ${NAVY_FOCUS}`}
        >
          {busy ? 'Checking...' : 'Check again'}
        </button>

        <AccessFailureNote message={failure} />
      </div>
    </section>
  )
}
