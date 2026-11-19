/*
 * The ZuriCopilot view: one page drawn in two shapes.
 *
 * surface 'full' is Copilot mode: a 240px navy sidebar plus a main column.
 * surface 'dock' is the same view as a 360px column beside the web app, so the
 * person can keep the workspace in sight while the panel is open.
 *
 * This is phase 1 shell content. Chat, approvals, runs, this week's focus and
 * quick ask arrive later, so every screen below is an honest empty state rather
 * than a placeholder conversation or an invented count: a person must never
 * mistake a mock approval for one that is waiting on them. The only controls
 * wired to anything are the ones that move the shell, and they move it through
 * the preload bridge.
 *
 * The access surface sits in front of all of it. Who may use the assistant, and
 * on which workspace, is decided by the main process and arrives on the access
 * push channel, so this file draws one of three things and keeps no opinion of
 * its own about eligibility: the ask-an-owner screen while locked, the workspace
 * panel while nothing is selected, and the content below once a workspace is
 * chosen. A locked person therefore never sees assistant content, even for the
 * frame before the first answer arrives.
 *
 * Square corners, no borders, no shadows, and no inline styles. The page's
 * Content-Security-Policy is style-src 'self', so every rule here is a Tailwind
 * utility and separation comes from the navy and surface tints.
 */
import { useEffect, useState, type ReactNode } from 'react'

import type { AccessBridge, AccessState } from '../../features/copilot/shared/access-contract'
import { accessScreenFor } from '../../features/copilot/shared/access-screen'
import type { ShellBridge, ShellState } from '../../features/copilot/shared/shell-contract'
import { AccessGate } from './AccessGate'
import { WorkspaceAccessPanel } from './WorkspaceAccessPanel'
import { ModelsPanel } from './ModelsPanel'
import { ChatPanel } from './ChatPanel'

export type CopilotSurface = 'full' | 'dock'

export interface CopilotViewProps {
  bridge: ShellBridge
  state: ShellState
  surface: CopilotSurface
}

/*
 * Every control is fire and forget. The main process owns mode and dock state
 * and pushes the result back on the state channel, so there is no reply to
 * render. A rejection still needs handling: left alone it becomes an unhandled
 * rejection in the page with no trace of which call failed.
 */
function fire (call: () => Promise<unknown>): void {
  void call().catch((error: unknown) => {
    console.error('CopilotView: bridge call failed', error)
  })
}

/**
 * The access bridge, or undefined when the preload did not expose one.
 *
 * Optional rather than assumed, because a preload that half-loaded, or a page
 * opened with no preload at all, must be a check instead of a crash on the first
 * property access. What that absence means for the screen is decided in
 * accessScreenFor, and the answer is not "draw the assistant".
 */
function readAccessBridge (): AccessBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.zuriAccess
}

/**
 * The access state, or null until the first answer arrives.
 *
 * The subscription is taken before the first read so a lock that lands mid-read
 * cannot be lost, and the cleanup removes exactly that listener: a development
 * double-mount would otherwise leave two subscriptions applying every state
 * twice. `null` is deliberately distinct from a locked state - the screen below
 * uses it to draw nothing rather than assistant content, because "not known yet"
 * must never look like "allowed".
 */
function useAccessState (bridge: AccessBridge | undefined): AccessState | null {
  const [state, setState] = useState<AccessState | null>(null)

  useEffect(() => {
    if (!bridge) return
    let listening = true

    const unsubscribe = bridge.onState(next => {
      if (listening) setState(next)
    })

    bridge.readState().then(
      answer => {
        if (!listening) return
        // A refusal is a fixed token, never a state: leave the screen locked
        // rather than invent one from a failed read.
        if (answer.ok) setState(answer.value)
        else console.warn('zuricopilot access: state refused', answer.reason)
      },
      error => {
        if (listening) console.warn('zuricopilot access: state call failed', error)
      }
    )

    return () => {
      listening = false
      unsubscribe()
    }
  }, [bridge])

  return state
}

/** Join the class strings this component builds from state. */
function cx (...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/*
 * Icons are inline paths, not a library or a sprite. The renderer loads no
 * images and no fonts, and currentColor keeps every glyph legible in both
 * themes.
 */
type IconSize = 14 | 16

type IconProps = { size: IconSize }

function Glyph ({ size, children }: { size: IconSize; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Four panes: a workspace, drawn for the switcher placeholder. */
function WorkspaceIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="4" y="4" width="6.5" height="6.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" />
    </Glyph>
  )
}

function HomeIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M4 11v9h16v-9" />
      <path d="M3 11l9-7 9 7" />
      <path d="M10 20v-5h4v5" />
    </Glyph>
  )
}

/** A squared speech box: conversations. */
function ConversationsIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M4 4h16v12h-8l-4 4v-4H4z" />
    </Glyph>
  )
}

/** An inbox tray: approvals waiting on the person. */
function ApprovalsIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M4 12l2.5-8h11L20 12v8H4z" />
      <path d="M4 12h5l1.5 3h3L15 12h5" />
    </Glyph>
  )
}

/** A play mark in a frame: runs. */
function RunsIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M10 9l6 3-6 3z" />
    </Glyph>
  )
}

/*
 * A rack of drawers: the shape says "several of these, each with its own label",
 * which is what a provider list is. Drawn rather than imported, because the
 * renderer's CSP allows no icon font and no images.
 */
function ModelsIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="4" y="4" width="16" height="5" />
      <rect x="4" y="15" width="16" height="5" />
    </Glyph>
  )
}

function BackIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </Glyph>
  )
}

function ForwardIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Glyph>
  )
}

function CloseIcon ({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Glyph>
  )
}

/*
 * The brand mark is a square with a letter in it, not an image and not an icon
 * font: the renderer's CSP allows neither images nor fonts, and one glyph in
 * currentColor needs neither. The size and text scale come from the call site,
 * because the mark appears at three sizes (sidebar, empty state, dock header).
 */
function Mark ({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('grid shrink-0 place-items-center bg-bronze font-bold leading-none text-navy-dark', className)}
    >
      Z
    </span>
  )
}

/*
 * Focus rings depend on what sits behind them, not on the button fill. Controls
 * on navy get bronze, which reads against navy in both themes; controls on the
 * app surface get info in light and bronze in dark, because bronze on the light
 * surface is too close to white to count as a visible ring.
 */
const NAVY_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze'

const SURFACE_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info dark:focus-visible:outline-bronze'

interface LaterNavItem {
  label: string
  Icon: (props: IconProps) => ReactNode
}

/*
 * These four are the shape of the assistant's navigation, not its content. They
 * stay in the sidebar so the layout is reviewable, but they are aria-disabled
 * rather than hidden, and not `disabled`: a person can tab to one, hear that
 * the screen arrives later, and see where it will live. `disabled` would drop
 * it from the tab order and hide the reason it does nothing.
 */
const LATER_NAV: readonly LaterNavItem[] = [
  { label: 'Home', Icon: HomeIcon },
  { label: 'Approvals', Icon: ApprovalsIcon },
  { label: 'Runs', Icon: RunsIcon }
]

export function CopilotView ({ bridge, state, surface }: CopilotViewProps) {
  const full = surface === 'full'
  const accessBridge = readAccessBridge()
  const access = useAccessState(accessBridge)
  const screen = accessScreenFor(accessBridge, access)

  /*
   * The frame below stays put - the smoke test reads its data attributes - and
   * only its contents change. Which of the five moments this is comes from
   * accessScreenFor, so the two that cannot be verified, a missing bridge and an
   * answer that has not arrived, draw nothing at all: neither may look like
   * "allowed".
   */
  let content: ReactNode
  switch (screen.kind) {
    case 'gate':
      content = <AccessGate bridge={screen.bridge} state={screen.state} />
      break
    case 'panel':
      // The panel is how a workspace is chosen, and the only place the owner's
      // grant controls live, so it stays up until there is something to work in.
      content = <WorkspaceAccessPanel bridge={screen.bridge} state={screen.state} />
      break
    case 'content':
      content = full
        ? <FullSurface bridge={bridge} access={access} accessBridge={accessBridge} />
        : <DockSurface bridge={bridge} access={access} accessBridge={accessBridge} />
      break
    default:
      // 'unverified' and 'pending': an empty surface, because content nobody has
      // cleared is exactly the fail-open this surface exists to prevent.
      content = null
  }

  return (
    /*
     * data-shell and data-surface are what the Electron smoke test reads back
     * to prove which shape this page drew. data-mode repeats the shell state
     * the chrome draws from, so a mismatch between the two views is visible in
     * one snapshot instead of by eye.
     */
    <section
      aria-label="ZuriCopilot"
      data-shell="copilot"
      data-surface={surface}
      data-mode={state.mode}
      data-access-state={
        screen.kind === 'unverified' ? 'unverified' : access === null ? 'pending' : access.status
      }
      className={cx(
        'flex h-full w-full min-h-0 min-w-0 overflow-hidden',
        full ? 'flex-row' : 'flex-col'
      )}
    >
      {content}
    </section>
  )
}

/** Copilot mode: the sidebar and the main column, with nothing invented in it. */
function FullSurface ({
  bridge,
  access,
  accessBridge,
}: {
  bridge: ShellBridge
  access: AccessState | null
  accessBridge: AccessBridge | undefined
}) {
  /*
   * Which page the main column shows. Local state rather than shell state: this
   * is a navigation within the assistant, not a change to which view the window
   * is showing, and the shell's own mode must survive it untouched.
   */
  const [page, setPage] = useState<'home' | 'chat' | 'models'>('home')
  /*
   * The provider bridge, read once per render. It is absent outside the shell, and
   * a Models page without it cannot store a key, so that case says so instead of
   * drawing a form whose buttons would all fail.
   */
  const providers = typeof window === 'undefined' ? undefined : window.zuriProviders

  /*
   * The business on screen, named from the live access state rather than from a
   * local guess: the store is what the conversation service scopes every read and
   * write by, so a name this file remembered could outlive a withdrawn grant.
   */
  const selectedBusiness = access === null
    ? null
    : access.workspaces.find(workspace => workspace.id === access.selectedWorkspaceId)?.name ?? null

  /** Switch business through the access bridge, which is the only thing that may. */
  const selectWorkspace = (workspaceId: number): void => {
    if (accessBridge === undefined) return
    void accessBridge.selectWorkspace(workspaceId)
  }

  return (
    <>
      {/*
        The sidebar stays navy in both themes, as in the approved mockup: it is
        the assistant's own frame, not a surface of the app, so the dark:
        variants below only adjust the translucent layers over that navy.
      */}
      <aside
        aria-label="ZuriCopilot sidebar"
        className="flex h-full w-[240px] shrink-0 flex-col gap-4 overflow-y-auto bg-navy px-3 py-4 text-white"
      >
        <div className="flex shrink-0 items-center gap-2.5 px-1">
          <Mark className="size-8 text-sm" />
          <span className="min-w-0 truncate text-sm font-semibold tracking-wide text-white">ZuriCopilot</span>
        </div>

        {/*
          The business row now reads the real selection. It stays a label rather
          than a control: the switcher itself lives in the conversation screen's
          header, where the conversation it changes is in front of the person.
        */}
        <div
          title={selectedBusiness === null ? 'No business is available yet' : `Working in ${selectedBusiness}`}
          className="flex shrink-0 items-center gap-2.5 bg-white/10 px-2.5 py-2 text-white/60 dark:bg-white/15 dark:text-white/55"
        >
          <WorkspaceIcon size={14} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {selectedBusiness ?? 'Workspace'}
          </span>
        </div>

        <nav aria-label="ZuriCopilot" className="zuri-rail flex flex-col gap-1">
          {/*
            Home and Models are this phase's real destinations, so they are
            buttons with aria-current rather than aria-disabled rows. The
            remaining three keep the shape of the assistant's navigation and say
            when they arrive.

            The active row deliberately sets no colour and no background: the
            application's stylesheet owns that treatment (a bronze edge and a
            translucent fill) with !important, so a utility here would be dead
            code that reads as intent. Only the corner is overridden, and it is
            overridden once in shell.css.
          */}
          <button
            type="button"
            data-shell="copilot-home"
            aria-current={page === 'home' ? 'page' : undefined}
            onClick={() => { setPage('home') }}
            className={cx(
              'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors',
              page !== 'home' && 'text-white/70 hover:bg-navy-hover hover:text-white',
              NAVY_FOCUS
            )}
          >
            <HomeIcon size={16} />
            <span className="min-w-0 flex-1 truncate">Home</span>
          </button>

          <button
            type="button"
            data-shell="copilot-conversations"
            aria-current={page === 'chat' ? 'page' : undefined}
            onClick={() => { setPage('chat') }}
            className={cx(
              'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors',
              page !== 'chat' && 'text-white/70 hover:bg-navy-hover hover:text-white',
              NAVY_FOCUS
            )}
          >
            <ConversationsIcon size={16} />
            <span className="min-w-0 flex-1 truncate">Conversations</span>
          </button>

          <button
            type="button"
            data-shell="copilot-models"
            aria-current={page === 'models' ? 'page' : undefined}
            onClick={() => { setPage('models') }}
            className={cx(
              'flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium transition-colors',
              page !== 'models' && 'text-white/70 hover:bg-navy-hover hover:text-white',
              NAVY_FOCUS
            )}
          >
            <ModelsIcon size={16} />
            <span className="min-w-0 flex-1 truncate">Models</span>
          </button>

          {LATER_NAV.filter(item => item.label !== 'Home').map(({ label, Icon }) => (
            <button
              key={label}
              type="button"
              aria-disabled={true}
              title={`${label} arrives in a later phase`}
              className={cx(
                'flex w-full cursor-default items-center gap-2.5 px-2.5 py-2 text-left text-sm font-medium text-white/50 transition-colors dark:text-white/45',
                NAVY_FOCUS
              )}
            >
              <Icon size={16} />
              <span className="min-w-0 flex-1 truncate">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        {/* The header band separates itself from the body by tint; no hairline. */}
        <header className="flex h-12 shrink-0 items-center gap-3 bg-surface-secondary px-4">
          <span className="min-w-0 truncate text-sm font-semibold text-text-primary">ZuriCopilot</span>
          <button
            type="button"
            data-shell="copilot-back"
            title="Show the WorkSpace web app"
            onClick={() => { fire(() => bridge.setMode('workspace')) }}
            className={cx(
              'ml-auto flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary',
              SURFACE_FOCUS
            )}
          >
            <BackIcon size={14} />
            Back to WorkSpace
          </button>
        </header>

        {/*
          The empty state is the whole content of this phase, so it is centred
          and scrolls on its own: a short window must not clip the one button
          that works.
        */}
        {page === 'chat' ? (
          access === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center">
              <p className="max-w-[420px] text-sm leading-relaxed text-text-secondary">
                The conversation appears once this person's access has been confirmed.
              </p>
            </div>
          ) : (
            <ChatPanel access={access} onSelectWorkspace={selectWorkspace} compact={false} />
          )
        ) : page === 'models' ? (
          providers === undefined ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-center">
              <p className="max-w-[420px] text-sm leading-relaxed text-text-secondary">
                Model settings are only available inside the desktop app.
              </p>
            </div>
          ) : (
            <ModelsPanel bridge={providers} />
          )
        ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
          <Mark className="size-12 text-lg" />
          <h1 className="mt-5 max-w-[420px] text-xl font-semibold break-words text-text-primary">
            ZuriCopilot is not in this build yet
          </h1>
          <p className="mt-2 max-w-[420px] text-sm leading-relaxed break-words text-text-secondary">
            This phase ships the desktop shell and window layout; the assistant screens come next.
          </p>
          <button
            type="button"
            data-shell="copilot-open-workspace"
            onClick={() => { fire(() => bridge.setMode('workspace')) }}
            className={cx(
              'mt-6 shrink-0 bg-surface-secondary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover',
              SURFACE_FOCUS
            )}
          >
            Open WorkSpace
          </button>
        </div>
        )}
      </div>
    </>
  )
}

/** The 360px column beside the web app: header, the conversation, and one action. */
function DockSurface ({
  bridge,
  access,
  accessBridge,
}: {
  bridge: ShellBridge
  access: AccessState | null
  accessBridge: AccessBridge | undefined
}) {
  const selectWorkspace = (workspaceId: number): void => {
    if (accessBridge === undefined) return
    void accessBridge.selectWorkspace(workspaceId)
  }

  return (
    <div className="flex h-full w-full min-h-0 min-w-0 flex-col bg-surface">
      {/* 44px matches the mockup's compact header; the mark and close fit it. */}
      <header className="flex h-11 shrink-0 items-center gap-2 bg-surface-secondary px-3">
        <Mark className="size-5 text-[10px]" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">ZuriCopilot</span>
        {/*
          Closing the dock is the dock's own action, so it exists here only. The
          full surface hides the panel by leaving Copilot mode, not by this
          control, which is why no equivalent button is drawn there.
        */}
        <button
          type="button"
          data-shell="dock-close"
          aria-label="Close the assistant panel"
          title="Close the assistant panel"
          onClick={() => { fire(() => bridge.toggleDock()) }}
          className={cx(
            'grid size-8 shrink-0 place-items-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary',
            SURFACE_FOCUS
          )}
        >
          <CloseIcon size={14} />
        </button>
      </header>

      {/*
        The dock draws the same conversation in its compact shape: no thread rail
        and no memory rail beside it, because 360px is one column. Threads become a
        picker in the header and remembered items a toggle, which is the same
        content reachable in a third of the width rather than a reduced feature set.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
        {access === null ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4 text-center">
            <p className="text-sm leading-relaxed text-text-secondary">
              The conversation appears once this person's access has been confirmed.
            </p>
          </div>
        ) : (
          <ChatPanel access={access} onSelectWorkspace={selectWorkspace} compact />
        )}
      </div>

      <footer className="shrink-0 px-4 pb-3 pt-2">
        {/*
          The one action with an immediate result today: it changes the shell
          mode, which closes the dock and draws the full ZuriCopilot view.
        */}
        <button
          type="button"
          data-shell="dock-open-full"
          onClick={() => { fire(() => bridge.setMode('copilot')) }}
          className={cx(
            'flex w-full items-center justify-center gap-2 bg-navy px-4 py-2.5 text-sm font-medium text-text-on-navy transition-colors hover:bg-navy-hover',
            SURFACE_FOCUS
          )}
        >
          Open full ZuriCopilot
          <ForwardIcon size={14} />
        </button>
      </footer>
    </div>
  )
}
