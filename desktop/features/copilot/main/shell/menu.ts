/*
 * The native application menu, described as data.
 *
 * The menu bar is the third way into the same two decisions the rail and the
 * keyboard make (which mode, dock open or closed), so the accelerators come from
 * the shared contract and the checked flags come from ShellState. Nothing here
 * imports Electron: the caller hands the finished template to
 * Menu.buildFromTemplate, which is what lets the test runner assert the whole
 * menu bar without a display or an Electron process.
 */
import {
  MODE_ACCELERATORS,
  TOGGLE_DOCK_ACCELERATOR,
  type ShellMode,
  type ShellState,
} from '../../shared/shell-contract.js'

/** The product name, spelled once so the app menu and the tray tooltip agree. */
export const APP_NAME = 'WorkSpace'

/** The assistant's name. It is a product name, not the window title. */
export const COPILOT_NAME = 'ZuriCopilot'

/** Mode names as people read them, shared by the menu bar and the tray. */
export const SHELL_MODE_LABELS: Readonly<Record<ShellMode, string>> = Object.freeze({
  workspace: 'Workspace',
  copilot: COPILOT_NAME,
})

/*
 * A structural stand-in for Electron's MenuItemConstructorOptions. The template
 * is a plain object array, so a local shape is enough and keeps this file free of
 * the electron package, which the main tsconfig does not have.
 */
export interface MenuItemLike {
  label?: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  role?: string
  accelerator?: string
  checked?: boolean
  enabled?: boolean
  click?: () => void
  submenu?: MenuItemLike[]
}

/**
 * Every click in the menu ends in one of these. The menu never reaches for a
 * window, a session or Electron itself, so the same template can be asserted by
 * counting calls to a fake.
 */
export interface ShellMenuActions {
  setMode: (mode: ShellMode) => void
  toggleDock: () => void
  minimizeToTray: () => void
  quit: () => void
}

/**
 * One mode, as a radio.
 *
 * The two modes must stay adjacent in the submenu: Electron groups radio items
 * by runs of neighbours, so a separator between them would let both show
 * checked at once.
 */
function modeMenuItem (mode: ShellMode, state: ShellState, actions: ShellMenuActions): MenuItemLike {
  return {
    label: SHELL_MODE_LABELS[mode],
    type: 'radio',
    accelerator: MODE_ACCELERATORS[mode],
    checked: state.mode === mode,
    click: () => actions.setMode(mode),
  }
}

export function buildMenuTemplate (
  state: ShellState,
  actions: ShellMenuActions,
  options: { platform?: string } = {}
): MenuItemLike[] {
  // The state already carries the platform, but allowing an override lets the
  // tests prove both menu bars from one state object.
  const platform = options.platform ?? state.platform
  const isMac = platform === 'darwin'

  const template: MenuItemLike[] = []

  /*
   * macOS expects a menu named after the application holding the platform-only
   * roles. Windows and Linux have no such menu, so it is simply absent there
   * rather than present and empty. Quit is not repeated here because the File
   * menu owns it on both platforms.
   */
  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
      ],
    })
  }

  template.push({
    label: 'File',
    submenu: [
      { label: 'Minimize to Tray', click: () => actions.minimizeToTray() },
      { type: 'separator' },
      isMac
        // 'quit' is the platform's own item on macOS, accelerator included.
        ? { role: 'quit' }
        // Elsewhere the role does nothing, so the item needs its own accelerator
        // and handler or the menu would offer a Quit that never quits.
        : { label: 'Quit', accelerator: 'Ctrl+Q', click: () => actions.quit() },
    ],
  })

  template.push({
    label: 'View',
    submenu: [
      modeMenuItem('workspace', state, actions),
      modeMenuItem('copilot', state, actions),
      { type: 'separator' },
      {
        label: 'Dock panel',
        type: 'checkbox',
        accelerator: TOGGLE_DOCK_ACCELERATOR,
        checked: state.dockOpen,
        click: () => actions.toggleDock(),
      },
    ],
  })

  template.push({
    label: 'Window',
    submenu: isMac
      // 'zoom' is the macOS name for maximise; on the other platforms it is a
      // label nobody recognises, so those two roles are all they get.
      ? [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  })

  template.push({
    label: 'Help',
    submenu: [
      /*
       * Exactly one About entry in the whole menu bar. Electron only implements
       * the 'about' role on macOS, and this builder is given no show-about
       * action, so on the other platforms the entry stays visible but disabled
       * instead of offering a click that would do nothing.
       */
      isMac
        ? { label: `About ${COPILOT_NAME}`, role: 'about' }
        : { label: `About ${COPILOT_NAME}`, enabled: false },
    ],
  })

  return template
}
