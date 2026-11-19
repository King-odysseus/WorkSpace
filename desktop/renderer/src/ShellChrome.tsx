/*
 * The ZuriCopilot desktop chrome: the 36px title bar across the top and the
 * 76px rail down the left. Nothing else.
 *
 * The web app and the ZuriCopilot screens are separate Electron views that the
 * main process lays out to the right of the rail and below the title bar. This
 * page therefore draws no content area and no background for one: if that
 * layout ever slipped, the gap would show the page through instead of a
 * plausible looking empty panel that hides the mistake.
 *
 * Square corners, no borders, no shadows, and no inline styles. The page's
 * Content-Security-Policy is style-src 'self', so every rule here is a Tailwind
 * utility, and the drag region is a utility too rather than a style attribute.
 */
import type { ReactNode } from 'react'

import type { ShellBridge, ShellState } from '../../features/copilot/shared/shell-contract'

export interface ShellChromeProps {
  bridge: ShellBridge
  state: ShellState
}

/*
 * Geometry lives in the shared contract, but Tailwind only emits a class it can
 * read in the source, so the numbers are spelled out in the class names below:
 * h-9 is TITLE_BAR_HEIGHT (36px) and w-[76px] is RAIL_WIDTH (76px). The shell
 * smoke test reads both back off the built page and compares them with the
 * constants, so changing the contract fails the test instead of letting the
 * page drift out of step with the main process layout.
 */

/** The mode name shown in the title bar, keyed by the contract's own union. */
const MODE_LABELS: Record<ShellState['mode'], string> = {
  workspace: 'Workspace',
  copilot: 'ZuriCopilot',
}

/**
 * Every control is fire and forget. The main process owns mode and dock state
 * and pushes the result back on the state channel, so there is nothing here to
 * render from a reply. A rejection still needs handling: left alone it becomes
 * an unhandled rejection in the page with no trace of which call failed.
 */
function fire (call: () => Promise<unknown>): void {
  void call().catch((error: unknown) => {
    console.error('ShellChrome: bridge call failed', error)
  })
}

/** Join the class strings this component builds from state. */
function cx (...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

/*
 * Icons are inline paths, not a library. The renderer loads no images and no
 * fonts, and currentColor keeps every glyph legible in both themes.
 */
type IconSize = 14 | 18

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

/** Four panes: the WorkSpace web app. */
function WorkspaceIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </Glyph>
  )
}

/** A large spark with a small one: ZuriCopilot. */
function CopilotIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <path d="M10.5 3l1.6 4.4 4.4 1.6-4.4 1.6-1.6 4.4-1.6-4.4L4.5 9l4.4-1.6z" />
      <path d="M17.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </Glyph>
  )
}

/** A frame with its right panel marked: the dock. */
function DockIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="4" width="18" height="16" />
      <path d="M15 4v16" />
    </Glyph>
  )
}

/** A gear: app settings. */
function SettingsIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" />
    </Glyph>
  )
}

function MinimizeIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <path d="M5 12h14" />
    </Glyph>
  )
}

function MaximizeIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <rect x="6" y="6" width="12" height="12" />
    </Glyph>
  )
}

/** Two overlapping frames: the window is already maximized. */
function RestoreIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <path d="M9 9V4.5h10.5V15H15" />
      <rect x="4.5" y="9" width="10.5" height="10.5" />
    </Glyph>
  )
}

function CloseIcon ({ size }: { size: IconSize }) {
  return (
    <Glyph size={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Glyph>
  )
}

/*
 * Rail item geometry: 56px tall (h-14), square, an 18px glyph over a 10px
 * label. The rail's 8px side padding gives each item the mockup's block width.
 * Focus is drawn outside the item, on the navy rail, so the bronze ring keeps
 * its contrast whether the item is the white current one or a transparent idle
 * one.
 */
const RAIL_ITEM = 'flex h-14 w-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] font-medium leading-[1.15] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze'

/** The current mode is a white block with navy ink, as in the approved mockup. */
const RAIL_CURRENT = 'bg-white text-navy'

const RAIL_IDLE = 'text-white/70 hover:bg-white/10 hover:text-white dark:text-white/65 dark:hover:bg-white/15'

/*
 * The dock is dimmed outside Workspace mode because it is not the natural next
 * step there, but it stays enabled: toggling it from ZuriCopilot is a supported
 * shortcut back to the docked layout.
 */
const RAIL_DIM = 'text-white/55 hover:bg-white/5 hover:text-white/85 dark:text-white/50 dark:hover:bg-white/10'

/*
 * Title bar buttons. The bar is a drag region, so each control opts out or the
 * window would be dragged instead of clicked. Their focus ring is inset because
 * the close button sits on the window's right edge and an outside ring there
 * would be clipped.
 */
const WINDOW_BUTTON = 'grid h-9 w-11 place-items-center text-white/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bronze dark:text-white/70 dark:hover:bg-white/15 [-webkit-app-region:no-drag]'

export function ShellChrome ({ bridge, state }: ShellChromeProps) {
  const workspace = state.mode === 'workspace'

  return (
    <div
      data-mode={state.mode}
      data-docked={state.dockOpen ? 'true' : 'false'}
      className="flex h-screen w-screen min-w-0 select-none flex-col overflow-hidden"
    >
      {/*
        The drag region is the bar itself, never the buttons inside it: a button
        that inherited drag would swallow its own click. The bar stays navy in
        both themes because it is chrome, not a surface of the app, so the dark:
        variants below only adjust the translucent layers over that navy.
      */}
      <header
        data-shell="title-bar"
        className="flex h-9 w-full shrink-0 items-center gap-2 bg-navy-dark pl-3 [-webkit-app-region:drag]"
      >
        <span
          aria-hidden="true"
          className="grid size-4 shrink-0 place-items-center bg-bronze text-[10px] font-bold leading-none text-navy-dark"
        >
          Z
        </span>
        <span className="shrink-0 text-xs font-semibold tracking-wide text-white">WorkSpace</span>
        <span className="min-w-0 truncate text-xs text-white/60 dark:text-white/50">
          {MODE_LABELS[state.mode]}
        </span>

        <div
          role="group"
          aria-label="Window controls"
          className="ml-auto flex shrink-0 [-webkit-app-region:no-drag]"
        >
          <button
            type="button"
            data-shell="window-minimize"
            aria-label="Minimize"
            title="Minimize"
            onClick={() => { fire(() => bridge.windowAction('minimize')) }}
            className={WINDOW_BUTTON}
          >
            <MinimizeIcon size={14} />
          </button>
          <button
            type="button"
            data-shell="window-maximize"
            aria-label={state.maximized ? 'Restore' : 'Maximize'}
            title={state.maximized ? 'Restore' : 'Maximize'}
            onClick={() => { fire(() => bridge.windowAction('toggle-maximize')) }}
            className={WINDOW_BUTTON}
          >
            {state.maximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
          </button>
          <button
            type="button"
            data-shell="window-close"
            aria-label="Close"
            title="Close"
            onClick={() => { fire(() => bridge.windowAction('close')) }}
            className={WINDOW_BUTTON}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      </header>

      {/* The row exists only to give the rail the full height below the bar. */}
      <div className="flex min-h-0 min-w-0 flex-1">
        <nav
          aria-label="Primary"
          data-shell="rail"
          className="flex w-[76px] shrink-0 flex-col gap-1.5 bg-navy-dark px-2 py-3"
        >
          <div role="group" aria-label="Mode" className="flex flex-col gap-1.5">
            <button
              type="button"
              data-shell="mode-workspace"
              aria-label="Workspace mode"
              aria-current={workspace ? 'page' : undefined}
              title="Show the WorkSpace web app"
              onClick={() => { fire(() => bridge.setMode('workspace')) }}
              className={cx(RAIL_ITEM, workspace ? RAIL_CURRENT : RAIL_IDLE)}
            >
              <WorkspaceIcon size={18} />
              <span className="max-w-full break-words">Workspace</span>
            </button>
            <button
              type="button"
              data-shell="mode-copilot"
              aria-label="ZuriCopilot mode"
              aria-current={workspace ? undefined : 'page'}
              title="Show ZuriCopilot"
              onClick={() => { fire(() => bridge.setMode('copilot')) }}
              className={cx(RAIL_ITEM, workspace ? RAIL_IDLE : RAIL_CURRENT)}
            >
              <CopilotIcon size={18} />
              <span className="max-w-full break-words">ZuriCopilot</span>
            </button>
          </div>

          <button
            type="button"
            data-shell="dock-toggle"
            aria-label="Dock panel"
            aria-pressed={state.dockOpen}
            title={state.dockOpen ? 'Close the Copilot panel beside the web app' : 'Open the Copilot panel beside the web app'}
            onClick={() => { fire(() => bridge.toggleDock()) }}
            className={cx(RAIL_ITEM, workspace ? RAIL_IDLE : RAIL_DIM)}
          >
            <DockIcon size={18} />
            <span className="max-w-full">Dock</span>
          </button>

          {/*
            Settings is disabled rather than hidden: the rail keeps its shape and
            the control says why it does nothing, because that screen is not
            built yet and an enabled button that silently no-ops is worse.
          */}
          <button
            type="button"
            aria-label="App settings"
            aria-disabled={true}
            disabled
            title="App settings arrive in a later phase"
            className={cx(RAIL_ITEM, 'mt-auto cursor-default text-white/45 hover:bg-white/5 dark:text-white/40')}
          >
            <SettingsIcon size={18} />
            <span className="max-w-full">Settings</span>
          </button>
        </nav>
      </div>
    </div>
  )
}
