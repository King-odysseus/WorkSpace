/*
 * The tray menu and its tooltip, described as data for the same reason the
 * application menu is: the main process builds the popup here and hands the
 * template to an Electron Tray, so the checked flags, the ordering and the click
 * routing can be asserted without an Electron process.
 */
import type { ShellMode, ShellState } from '../../shared/shell-contract.js'
import { APP_NAME, SHELL_MODE_LABELS, type MenuItemLike } from './menu.js'

export interface ShellTrayActions {
  open: () => void
  setMode: (mode: ShellMode) => void
  toggleDock: () => void
  quit: () => void
}

/**
 * One mode, as a radio that also brings the window back.
 *
 * From the tray the window is usually hidden, so a switch that only changed the
 * mode would look like a click that did nothing. Opening first, then applying
 * the mode, means the person sees the result of what they picked.
 */
function trayModeMenuItem (mode: ShellMode, state: ShellState, actions: ShellTrayActions): MenuItemLike {
  return {
    label: SHELL_MODE_LABELS[mode],
    type: 'radio',
    checked: state.mode === mode,
    /*
     * No accelerator here. The contract's shortcuts belong to the application
     * menu, and repeating them in the tray would suggest they only work while
     * the popup is open.
     */
    click: () => {
      actions.setMode(mode)
      actions.open()
    },
  }
}

export function buildTrayMenuTemplate (state: ShellState, actions: ShellTrayActions): MenuItemLike[] {
  return [
    { label: `Open ${APP_NAME}`, click: () => actions.open() },
    { type: 'separator' },
    trayModeMenuItem('workspace', state, actions),
    trayModeMenuItem('copilot', state, actions),
    {
      label: 'Dock panel',
      type: 'checkbox',
      checked: state.dockOpen,
      click: () => actions.toggleDock(),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => actions.quit() },
  ]
}

/**
 * The tooltip is the only sentence the tray shows, so it names the current mode
 * in words rather than relying on a badge or an icon changing colour.
 */
export function trayTooltip (state: ShellState): string {
  return `${APP_NAME} - ${SHELL_MODE_LABELS[state.mode]} mode`
}
