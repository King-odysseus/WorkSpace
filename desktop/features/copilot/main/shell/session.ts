/*
 * Which mode the shell is in, and whether the dock is open.
 *
 * Deliberately separate from the window that renders it: mode changes arrive
 * from three places (the rail, the native menu, the keyboard) and they must all
 * mean the same thing. Holding the rule here means the menu does not have to
 * know that the dock only exists beside the web app.
 */
import type { ShellMode, ShellState, ShellTheme } from '../../shared/shell-contract.js'

export interface ShellSession {
  mode: ShellMode
  dockOpen: boolean
}

export interface ShellSessionSeed {
  mode?: ShellMode
  dockOpen?: boolean
}

/**
 * Facts the window owns and the session does not: theme, maximised state and
 * platform are properties of the desktop, not of the mode.
 */
export interface ShellWindowFacts {
  maximized: boolean
  theme: ShellTheme
  platform: string
}

export function createShellSession (seed: ShellSessionSeed = {}): ShellSession {
  const mode: ShellMode = seed.mode ?? 'workspace'
  // A docked panel is only meaningful beside the web app, so it cannot be the
  // starting state of ZuriCopilot mode.
  const dockOpen = mode === 'workspace' ? Boolean(seed.dockOpen) : false
  return { mode, dockOpen }
}

/** Switching to the mode already on screen is not a change; the caller sees null. */
export function setShellMode (session: ShellSession, mode: ShellMode): ShellSession | null {
  if (mode === session.mode) return null
  // The dock flag survives a trip through ZuriCopilot mode, so coming back to
  // Workspace restores the panel the person had open.
  return { mode, dockOpen: session.dockOpen }
}

/**
 * Toggling the dock on from ZuriCopilot mode is a request to see it, and the only
 * place it exists is beside the web app, so that also switches mode.
 */
export function toggleShellDock (session: ShellSession): ShellSession | null {
  if (session.mode === 'workspace') {
    return { mode: session.mode, dockOpen: !session.dockOpen }
  }
  return { mode: 'workspace', dockOpen: true }
}

export function describeShellState (session: ShellSession, facts: ShellWindowFacts): ShellState {
  return {
    mode: session.mode,
    dockOpen: session.dockOpen,
    maximized: facts.maximized,
    theme: facts.theme,
    platform: facts.platform,
  }
}
