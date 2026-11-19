/*
 * Which of the shell's pages this document is.
 *
 * One bundle serves every local view, so Electron loads this page with a hash
 * that names the view: #chrome draws the title bar and the rail, #copilot draws
 * the assistant screen and its docked shape. A page loaded without a hash is the
 * Phase 0 status screen, which the probe smoke test still drives, and which has
 * no shell bridge at all.
 *
 * Mode is owned by the main process, never by a page: the rail asks for a
 * change, the main process decides, and the new state arrives on the push
 * channel. That is why this file holds a copy of the state and no setters.
 */
import { useEffect, useState } from 'react'

import type { ShellBridge, ShellState } from '../../features/copilot/shared/shell-contract'
import { CopilotView } from './CopilotView'
import ProbeView from './ProbeView'
import { ShellChrome } from './ShellChrome'

type LocalView = 'chrome' | 'copilot'

function localView (): LocalView | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash.replace(/^#/, '')
  if (hash === 'chrome') return 'chrome'
  if (hash === 'copilot') return 'copilot'
  return null
}

function readBridge (): ShellBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.zuriShell
}

/**
 * Paint the shell with the palette the main process reports.
 *
 * Both palettes in the token sheet are keyed off the document: `data-theme`
 * carries the variables and the `dark` class drives Tailwind's variant. The OS
 * preference is read in the main process, so this copies the pushed value onto
 * the document instead of guessing at it here, and `color-scheme` keeps native
 * scrollbars and focus rings in the same palette.
 */
function useTheme (theme: ShellState['theme'] | null) {
  useEffect(() => {
    if (theme === null) return
    const root = document.documentElement
    root.dataset.theme = theme
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])
}

/**
 * The current state, or null until the first answer arrives.
 *
 * The push subscription is taken before the first read so a mode change that
 * lands mid-read cannot be lost, and the cleanup removes exactly that listener:
 * a development double-mount would otherwise leave two subscriptions behind and
 * apply every state twice.
 */
function useShellState (bridge: ShellBridge | undefined): ShellState | null {
  const [state, setState] = useState<ShellState | null>(null)

  useEffect(() => {
    if (!bridge) return
    let listening = true
    const unsubscribe = bridge.onState(next => {
      if (listening) setState(next)
    })

    bridge.getState().then(
      answer => { if (listening) setState(answer) },
      error => {
        // A refusal is a fixed token, never a stack: log it, do not guess a mode.
        if (listening) console.warn('zuricopilot shell: state refused', error)
      }
    )

    return () => {
      listening = false
      unsubscribe()
    }
  }, [bridge])

  return state
}

export default function App () {
  const view = localView()
  const bridge = readBridge()
  const state = useShellState(view === null ? undefined : bridge)
  useTheme(state === null ? null : state.theme)

  // The status screen owns its own bridge (`window.copilot`), so it is chosen
  // before any shell state exists.
  if (view === null) return <ProbeView />

  if (!bridge || state === null) {
    // Nothing to draw yet: an empty surface is better than a rail whose buttons
    // would have no bridge to call during the first few frames.
    return <div className="h-full w-full bg-surface" />
  }

  if (view === 'copilot') {
    // The dock is the same screen in a narrow column, so the surface follows the
    // mode rather than being a separate page.
    const surface = state.mode === 'workspace' && state.dockOpen ? 'dock' : 'full'
    return <CopilotView bridge={bridge} state={state} surface={surface} />
  }

  return <ShellChrome bridge={bridge} state={state} />
}
