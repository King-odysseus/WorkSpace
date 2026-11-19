/*
 * What the assistant shows once access is unlocked: the workspaces this person
 * may use it in, and, for an owner, the switch that decides which managers may
 * use it too.
 *
 * Selection is not kept here. A row asks the main process to select a workspace,
 * and the selection the person sees is the one that comes back on the pushed
 * state, so the panel cannot show a workspace the server did not agree to. That
 * is also why a manager row without a grant is a plain, dimmed row: it names the
 * workspace to ask about, and it offers no control that would be refused.
 *
 * Square corners, no borders, no shadows, and no inline styles: the page's
 * Content-Security-Policy is style-src 'self', so every rule below is a Tailwind
 * utility and separation comes from the surface tints.
 */
import { useEffect, useState } from 'react'

import type {
  AccessBridge,
  AccessFailure,
  AccessManager,
  AccessManagers,
  AccessState,
} from '../../features/copilot/shared/access-contract'

export interface WorkspaceAccessPanelProps {
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

/** Join the class strings this component builds from state. */
function cx (...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

const GENERIC_FAILURE = 'Something went wrong. Please try again in a moment.'

/**
 * The sentence for a refused call. Fixed tokens map to fixed sentences, so a
 * reply can never put text of its own on the screen, and a token from a newer
 * main process still reads as English instead of an identifier.
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
      return 'You do not have assistant access to this workspace.'
    case 'not_owner':
      return 'Only an owner of this workspace can change who may use the assistant.'
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

/** A manager row's display name; the contract allows an empty name and email. */
function managerLabel (manager: AccessManager): string {
  if (manager.name !== '') return manager.name
  if (manager.email !== '') return manager.email
  return `User ${manager.userId}`
}

/** The granted state is drawn, not left to colour alone, so it survives a screenshot. */
function CheckMark () {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4 10-10" />
    </svg>
  )
}

export function WorkspaceAccessPanel ({ bridge, state }: WorkspaceAccessPanelProps) {
  /* Failures of the workspace list and of signing out share one line. */
  const [failure, setFailure] = useState<string | null>(null)
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<number | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const [managers, setManagers] = useState<AccessManagers | null>(null)
  const [managersLoading, setManagersLoading] = useState(false)
  const [managersFailure, setManagersFailure] = useState<string | null>(null)
  const [pendingUserId, setPendingUserId] = useState<number | null>(null)

  const selected =
    state.workspaces.find(entry => entry.id === state.selectedWorkspaceId) ?? null

  /*
   * Only an owner may read the manager list or change it. Asking for a manager's
   * workspace would produce a refusal the person cannot act on, so the request
   * is not made at all when the role is manager.
   */
  const ownerWorkspaceId =
    selected !== null && selected.role === 'owner' ? selected.id : null

  useEffect(() => {
    if (ownerWorkspaceId === null) {
      setManagers(null)
      setManagersFailure(null)
      setManagersLoading(false)
      return
    }

    /*
     * The list is keyed on the selected workspace, and a slow answer for the
     * previous one must not land in this one: `listening` is cleared by the
     * cleanup before the next request starts.
     */
    let listening = true
    setManagers(null)
    setManagersFailure(null)
    setManagersLoading(true)

    void (async () => {
      try {
        const reply = await bridge.listManagers(ownerWorkspaceId)
        if (!listening) return
        if (reply.ok) setManagers(reply.value)
        else setManagersFailure(failureMessage(reply.reason))
      } catch (error: unknown) {
        if (!listening) return
        console.error('WorkspaceAccessPanel: manager list failed', error)
        setManagersFailure(failureMessage('internal_error'))
      } finally {
        if (listening) setManagersLoading(false)
      }
    })()

    return () => {
      listening = false
    }
  }, [bridge, ownerWorkspaceId])

  async function chooseWorkspace (workspaceId: number): Promise<void> {
    setPendingWorkspaceId(workspaceId)
    setFailure(null)

    try {
      const reply = await bridge.selectWorkspace(workspaceId)
      // A successful selection arrives again as pushed state, so the answer is
      // not stored here: this panel holds no selection of its own.
      if (!reply.ok) setFailure(failureMessage(reply.reason))
    } catch (error: unknown) {
      console.error('WorkspaceAccessPanel: selecting a workspace failed', error)
      setFailure(failureMessage('internal_error'))
    } finally {
      setPendingWorkspaceId(null)
    }
  }

  async function signOut (): Promise<void> {
    setSigningOut(true)
    setFailure(null)

    try {
      const reply = await bridge.signOut()
      if (!reply.ok) setFailure(failureMessage(reply.reason))
    } catch (error: unknown) {
      console.error('WorkspaceAccessPanel: signing out failed', error)
      setFailure(failureMessage('internal_error'))
    } finally {
      setSigningOut(false)
    }
  }

  async function toggleManager (manager: AccessManager, nextGranted: boolean): Promise<void> {
    const workspaceId = ownerWorkspaceId
    if (workspaceId === null) return

    setPendingUserId(manager.userId)
    setManagersFailure(null)

    try {
      const written = await bridge.setPermission(workspaceId, manager.userId, nextGranted)
      if (!written.ok) {
        setManagersFailure(failureMessage(written.reason))
        return
      }

      /*
       * Re-read instead of flipping the row in place: the switch must show what
       * the server stored, and the permission endpoint is shared with the web
       * app, so the stored list may differ from the one on screen.
       */
      const listed = await bridge.listManagers(workspaceId)
      if (listed.ok) setManagers(listed.value)
      else setManagersFailure(failureMessage(listed.reason))
    } catch (error: unknown) {
      console.error('WorkspaceAccessPanel: changing a permission failed', error)
      setManagersFailure(failureMessage('internal_error'))
    } finally {
      setPendingUserId(null)
    }
  }

  return (
    <section
      aria-label="Assistant access"
      data-access="panel"
      className="flex h-full w-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto bg-surface px-4 py-4"
    >
      <header className="flex shrink-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold break-words text-text-primary">
            Workspaces
          </h1>
          <p className="mt-1 text-xs break-words text-text-secondary">
            Choose the workspace the assistant should work in.
          </p>
        </div>
        <button
          type="button"
          data-access="sign-out"
          disabled={signingOut}
          onClick={() => { void signOut() }}
          className={cx(
            'shrink-0 bg-surface-secondary px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-default disabled:text-text-muted',
            SURFACE_FOCUS
          )}
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </header>

      {failure !== null && (
        <p role="status" className="shrink-0 bg-surface-secondary px-3 py-2 text-sm leading-relaxed break-words text-text-primary">
          {failure}
        </p>
      )}

      {state.workspaces.length === 0 ? (
        <p className="bg-surface-secondary px-3 py-2 text-sm break-words text-text-secondary">
          No workspaces are available to this account.
        </p>
      ) : (
        <section aria-label="Workspace list" className="flex flex-col gap-1">
          {state.workspaces.map(entry => {
            const isSelected = entry.id === state.selectedWorkspaceId
            const roleLabel = entry.role === 'owner' ? 'Owner' : 'Manager'

            /*
             * A manager without a grant cannot use the assistant in this
             * workspace, so the row stays readable but is not a control: it says
             * what to do instead of accepting a click that would be refused.
             */
            if (entry.role === 'manager' && !entry.granted) {
              return (
                <div
                  key={entry.id}
                  data-workspace-id={entry.id}
                  data-granted="false"
                  aria-disabled="true"
                  className="flex items-center gap-2 bg-surface-secondary px-3 py-2 text-text-muted"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                  <span className="shrink-0 text-xs">{roleLabel}</span>
                  <span className="shrink-0 text-xs">ask an owner for access</span>
                </div>
              )
            }

            return (
              <button
                key={entry.id}
                type="button"
                data-workspace-id={entry.id}
                data-granted={entry.granted ? 'true' : 'false'}
                aria-current={isSelected ? 'true' : undefined}
                aria-label={`${entry.name}, ${roleLabel}${isSelected ? ', selected' : ''}`}
                disabled={pendingWorkspaceId !== null}
                onClick={() => { void chooseWorkspace(entry.id) }}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:cursor-default',
                  isSelected
                    ? 'bg-navy font-medium text-text-on-navy hover:bg-navy-hover'
                    : 'bg-surface-secondary text-text-primary hover:bg-surface-hover',
                  isSelected ? NAVY_FOCUS : SURFACE_FOCUS
                )}
              >
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-xs">{roleLabel}</span>
              </button>
            )
          })}
        </section>
      )}

      {ownerWorkspaceId !== null && (
        <section aria-label="Who may use the assistant" className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-text-secondary">
            Managers who can use the assistant
          </h2>

          {managersLoading && (
            <p role="status" className="text-xs text-text-muted">Loading managers...</p>
          )}

          {managersFailure !== null && (
            <p role="status" className="bg-surface-secondary px-3 py-2 text-sm leading-relaxed break-words text-text-primary">
              {managersFailure}
            </p>
          )}

          {managers !== null && managers.members.length === 0 && (
            <p className="bg-surface-secondary px-3 py-2 text-sm break-words text-text-secondary">
              This workspace has no managers yet.
            </p>
          )}

          {managers !== null && managers.members.length > 0 && (
            <ul aria-label="Managers" className="flex flex-col gap-1">
              {managers.members.map(manager => {
                const label = managerLabel(manager)

                return (
                  <li key={manager.userId} className="bg-surface-secondary">
                    {/*
                      A button with a checkbox role rather than a native input:
                      the house style is a square, borderless block, and a native
                      checkbox cannot be drawn that way without a stylesheet this
                      page does not have. Space and Enter both toggle it.
                    */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={manager.granted}
                      aria-label={`Can use the assistant: ${label}`}
                      disabled={pendingUserId === manager.userId}
                      onClick={() => { void toggleManager(manager, !manager.granted) }}
                      className={cx(
                        'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-hover disabled:cursor-default disabled:text-text-muted',
                        SURFACE_FOCUS
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cx(
                          'grid size-4 shrink-0 place-items-center',
                          manager.granted
                            ? 'bg-bronze text-navy-dark'
                            : 'bg-surface text-text-muted'
                        )}
                      >
                        {manager.granted ? <CheckMark /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text-primary">{label}</span>
                        {manager.email !== '' && manager.email !== label && (
                          <span className="block truncate text-xs text-text-muted">{manager.email}</span>
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-text-secondary">
                        Can use the assistant
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </section>
  )
}
