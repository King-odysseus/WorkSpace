/*
 * The shell's channel surface: mode, dock, and window controls.
 *
 * These channels do for the title bar and the dock what the probe channel does
 * for the status screen: one narrowly typed request in, one validated answer
 * out, and a sender check before either. Nothing here takes a URL, a channel
 * name, or a free-form string, so a page cannot ask the main process for
 * anything the shell did not intend to offer.
 *
 * The state push is the only channel the main process starts. It goes to the
 * trusted local views only, which is what keeps the rail and the dock showing
 * the same mode after a menu accelerator or a keyboard shortcut moved it.
 */
import {
  SHELL_CHANNELS,
  SHELL_STATE_PUSH_CHANNEL,
  isShellState,
  parseSetModeRequest,
  parseWindowActionRequest,
  type ShellMode,
  type ShellState,
  type WindowAction,
} from '../../shared/shell-contract.js'

/** Refusals are fixed tokens: a log line names the reason, never the payload. */
export const SHELL_REFUSAL_UNTRUSTED_SENDER = 'untrusted_sender'
export const SHELL_REFUSAL_INVALID_REQUEST = 'invalid_request'

export interface ShellLogger {
  warn: (message: string) => void
}

export interface ShellIpcMain {
  handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => void
  removeHandler?: (channel: string) => void
}

/**
 * What the window manager must do when a request arrives. It is injected rather
 * than imported so the channels can be tested without a window, and so the one
 * place that knows how to move a view is the one place that answers.
 */
export interface ShellIpcActions {
  getState: () => ShellState
  setMode: (mode: ShellMode) => ShellState
  toggleDock: () => ShellState
  windowAction: (action: WindowAction) => ShellState
}

export interface RegisterShellIpcOptions {
  ipcMain: ShellIpcMain
  actions: ShellIpcActions
  log?: ShellLogger
}

export interface ShellIpcBridge {
  /** Allow one local view's main frame to use these channels. */
  trust: (webContents: unknown, pageUrl: string) => void
  forget: (webContents: unknown) => void
  isTrustedSender: (event: unknown) => boolean
  /** Push the current state to every trusted view. */
  publish: (state: ShellState) => void
  /**
   * Push any payload to every trusted view.
   *
   * The trusted-view registry lives here, next to the sender check, so a second
   * feature (the access surface) can broadcast without keeping a second list of
   * trusted pages that could disagree with this one about which views exist.
   */
  broadcast: (channel: string, payload: unknown) => void
  dispose: () => void
}

interface TrustedSender {
  contents: { send: (channel: string, payload: unknown) => void }
  pageUrl: string
}

function toWebContents (value: unknown): { id: number, send?: (channel: string, payload: unknown) => void } | null {
  if (value && typeof value === 'object' && Number.isInteger((value as { id?: number }).id)) {
    return value as { id: number, send?: (channel: string, payload: unknown) => void }
  }
  return null
}

/**
 * Whether a frame URL is the local page this view is allowed to speak from.
 *
 * The hash is part of the comparison because both shell views load the same
 * file and are told apart only by it: without it, a stray document at the same
 * path would pass. Parsed rather than compared as strings, so a percent-encoded
 * space in the install path does not break the bridge on Windows.
 */
export function isSameShellPage (frameUrl: string, pageUrl: string): boolean {
  let frame: URL
  let page: URL
  try {
    frame = new URL(String(frameUrl))
    page = new URL(String(pageUrl))
  } catch {
    return false
  }
  if (frame.protocol !== 'file:' || page.protocol !== 'file:') return false
  if (frame.host !== page.host) return false
  if (frame.pathname !== page.pathname) return false
  return frame.hash === page.hash
}

export function registerShellIpc (options: RegisterShellIpcOptions): ShellIpcBridge {
  const { ipcMain, actions, log = console } = options
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('registerShellIpc needs an ipcMain with handle()')
  }
  if (!actions || typeof actions.getState !== 'function') {
    throw new TypeError('registerShellIpc needs a set of shell actions')
  }

  const trusted = new Map<number, TrustedSender>()

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot shell: ${message}`)
  }

  function refuse (reason: string): null {
    warn(`request refused (${reason})`)
    return null
  }

  function isTrustedSender (event: unknown): boolean {
    const sender = (event as { sender?: unknown } | null)?.sender
    const contents = toWebContents(sender)
    if (!contents) return false
    const entry = trusted.get(contents.id)
    if (!entry) return false

    const frame = (event as { senderFrame?: { url?: string, parent?: unknown } | null }).senderFrame
    // No frame means the sender is gone; a parent means it is a subframe, not the view.
    if (!frame || frame.parent) return false
    return isSameShellPage(String(frame.url ?? ''), entry.pageUrl)
  }

  /**
   * Answer a request, or answer nothing.
   *
   * Every handler returns the current state on success and null on refusal, so
   * the renderer never receives a stack trace and never has to invent a mode.
   * A throwing action is caught here: a broken window must not reject the
   * renderer's promise.
   */
  function guard (name: string, run: () => ShellState): ShellState | null {
    try {
      const state = run()
      if (!isShellState(state)) {
        warn(`${name} produced a state the contract refuses`)
        return null
      }
      return state
    } catch (error) {
      warn(`${name} failed (${(error as { name?: string } | null)?.name ?? 'unknown'})`)
      return null
    }
  }

  ipcMain.handle(SHELL_CHANNELS.state, (event: unknown) => {
    if (!isTrustedSender(event)) return refuse(SHELL_REFUSAL_UNTRUSTED_SENDER)
    return guard('state', () => actions.getState())
  })

  ipcMain.handle(SHELL_CHANNELS.setMode, (event: unknown, request: unknown) => {
    if (!isTrustedSender(event)) return refuse(SHELL_REFUSAL_UNTRUSTED_SENDER)
    const parsed = parseSetModeRequest(request)
    if (!parsed.ok) return refuse(parsed.reason)
    return guard('set mode', () => actions.setMode(parsed.value.mode))
  })

  ipcMain.handle(SHELL_CHANNELS.toggleDock, (event: unknown) => {
    if (!isTrustedSender(event)) return refuse(SHELL_REFUSAL_UNTRUSTED_SENDER)
    return guard('toggle dock', () => actions.toggleDock())
  })

  ipcMain.handle(SHELL_CHANNELS.window, (event: unknown, request: unknown) => {
    if (!isTrustedSender(event)) return refuse(SHELL_REFUSAL_UNTRUSTED_SENDER)
    const parsed = parseWindowActionRequest(request)
    if (!parsed.ok) return refuse(parsed.reason)
    return guard('window action', () => actions.windowAction(parsed.value.action))
  })

  function trust (webContents: unknown, pageUrl: string): void {
    const contents = toWebContents(webContents)
    if (!contents) throw new TypeError('trust needs a webContents or a webContents id')

    let page: URL
    try {
      page = new URL(String(pageUrl))
    } catch {
      throw new TypeError('trust needs an absolute page URL')
    }
    // Both shell views are local files. Trusting an http(s) page here would hand
    // the mode switch to whatever the network served.
    if (page.protocol !== 'file:') throw new TypeError('shell views must be local files')
    if (typeof contents.send !== 'function') {
      throw new TypeError('trust needs a webContents that can receive a push')
    }

    trusted.set(contents.id, { contents: contents as TrustedSender['contents'], pageUrl: page.href })
  }

  function forget (webContents: unknown): void {
    const contents = toWebContents(webContents)
    if (!contents) return
    trusted.delete(contents.id)
  }

  function broadcast (channel: string, payload: unknown): void {
    for (const entry of trusted.values()) {
      try {
        entry.contents.send(channel, payload)
      } catch {
        // A view that is closing is not an error worth failing a push on.
      }
    }
  }

  function publish (state: ShellState): void {
    if (!isShellState(state)) {
      warn('refused to push a state the contract refuses')
      return
    }
    broadcast(SHELL_STATE_PUSH_CHANNEL, state)
  }

  function dispose (): void {
    trusted.clear()
    if (typeof ipcMain.removeHandler === 'function') {
      for (const channel of Object.values(SHELL_CHANNELS)) ipcMain.removeHandler(channel)
    }
  }

  return Object.freeze({ trust, forget, isTrustedSender, publish, broadcast, dispose })
}
