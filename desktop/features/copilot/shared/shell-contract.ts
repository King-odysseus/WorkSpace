/*
 * The shell's one contract: the modes it can be in, the geometry those modes
 * produce, the channel names, and the schemas both processes validate with.
 *
 * Both halves import this file: the main process when it registers channels and
 * lays views out, the preload when it answers the renderer. Keeping the numbers
 * and channel names in one place is what stops the two drifting into "works on
 * my build" bugs, and it lets the tests read them without an Electron runtime.
 */
import { z } from 'zod'

/*
 * Two modes, plus a dock flag rather than a third mode. The dock is the same
 * ZuriCopilot view in a narrower column, so modelling it as a mode would mean
 * three layouts to keep in step instead of two layouts and one width.
 */
export const SHELL_MODES = ['workspace', 'copilot'] as const
export type ShellMode = (typeof SHELL_MODES)[number]

/**
 * Which local view a page is drawing. One bundle serves every view, so the
 * document hash is the only thing that tells them apart.
 */
export const SHELL_VIEWS = ['chrome', 'copilot'] as const
export type ShellView = (typeof SHELL_VIEWS)[number]

export const WINDOW_ACTIONS = ['minimize', 'toggle-maximize', 'close'] as const
export type WindowAction = (typeof WINDOW_ACTIONS)[number]

export const SHELL_THEMES = ['light', 'dark'] as const
export type ShellTheme = (typeof SHELL_THEMES)[number]

/*
 * Geometry in CSS pixels, per the approved design (plan sections 4.1 and 18):
 * a 36px title bar, a 76px rail and a 360px dock.
 *
 * MIN_WEB_WIDTH is the promise that docking never squeezes the web app out of
 * existence: below it the dock gives up its width instead of the web view.
 */
export const TITLE_BAR_HEIGHT = 36
export const RAIL_WIDTH = 76
export const DOCK_WIDTH = 360
export const MIN_WEB_WIDTH = 320

/**
 * Requests are invokes, so the renderer waits for an answer. State is the one
 * push, which is what keeps the rail and the dock showing the same mode after a
 * keyboard shortcut moved it.
 */
export const SHELL_CHANNELS = Object.freeze({
  state: 'shell:state',
  setMode: 'shell:mode:set',
  toggleDock: 'shell:dock:toggle',
  window: 'shell:window:action',
})

export const SHELL_STATE_PUSH_CHANNEL = 'shell:state:changed'

/* Menu accelerators live here so the menu, the README and the smoke test agree. */
export const TOGGLE_DOCK_ACCELERATOR = 'CmdOrCtrl+Shift+D'
export const MODE_ACCELERATORS = Object.freeze({
  workspace: 'CmdOrCtrl+1',
  copilot: 'CmdOrCtrl+2',
})

/** What the renderer is told about the window. */
export interface ShellState {
  mode: ShellMode
  dockOpen: boolean
  maximized: boolean
  theme: ShellTheme
  platform: string
}

/** What the preload hands the renderer. Reads only; every action is a function. */
export interface ShellBridge {
  getState: () => Promise<ShellState>
  setMode: (mode: ShellMode) => Promise<ShellState>
  toggleDock: () => Promise<ShellState>
  windowAction: (action: WindowAction) => Promise<ShellState>
  onState: (listener: (state: ShellState) => void) => () => void
}

export const shellModeSchema = z.enum(SHELL_MODES)
export const windowActionSchema = z.enum(WINDOW_ACTIONS)

export const setModeRequestSchema = z.object({ mode: shellModeSchema }).strict()
export const windowActionRequestSchema = z.object({ action: windowActionSchema }).strict()

export const shellStateSchema = z
  .object({
    mode: shellModeSchema,
    dockOpen: z.boolean(),
    maximized: z.boolean(),
    theme: z.enum(SHELL_THEMES),
    platform: z.string(),
  })
  .strict()

/** Cheap enough to run on every push, so the renderer never draws half a state. */
export function isShellState (value: unknown): value is ShellState {
  return shellStateSchema.safeParse(value).success
}

export function isShellMode (value: unknown): value is ShellMode {
  return typeof value === 'string' && (SHELL_MODES as readonly string[]).includes(value)
}

export function isWindowAction (value: unknown): value is WindowAction {
  return typeof value === 'string' && (WINDOW_ACTIONS as readonly string[]).includes(value)
}

export function isShellView (value: unknown): value is ShellView {
  return typeof value === 'string' && (SHELL_VIEWS as readonly string[]).includes(value)
}

export type ParseResult<T> = { ok: true, value: T } | { ok: false, reason: string }

/** Same shape as the probe contract's validator: a reason token, never a stack. */
function parseWith<T> (schema: z.ZodType<T>, request: unknown, reason: string): ParseResult<T> {
  const parsed = schema.safeParse(request)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason }
}

export function parseSetModeRequest (request: unknown): ParseResult<{ mode: ShellMode }> {
  return parseWith(setModeRequestSchema, request, 'invalid_mode')
}

export function parseWindowActionRequest (request: unknown): ParseResult<{ action: WindowAction }> {
  return parseWith(windowActionRequestSchema, request, 'invalid_action')
}

/**
 * Where a view lives. The main process uses this when it loads the page and the
 * page uses it to decide which view to draw.
 */
export function shellPageHash (view: ShellView): string {
  return `#${view}`
}

export function shellViewFromHash (hash: string): ShellView {
  const name = String(hash || '').replace(/^#/, '')
  return isShellView(name) ? name : 'chrome'
}

/**
 * Which shape the ZuriCopilot view draws. The dock is the same page in a narrow
 * column, so this is layout, not a second screen.
 */
export function shellSurface (view: ShellView, state: ShellState): 'full' | 'dock' {
  if (view !== 'copilot') return 'full'
  return state.mode === 'workspace' && state.dockOpen ? 'dock' : 'full'
}
