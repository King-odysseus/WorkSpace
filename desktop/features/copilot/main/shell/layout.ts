/*
 * Where each view sits, as arithmetic.
 *
 * The window manager never computes a rectangle itself: it asks for a layout and
 * applies it. That makes the three modes pure data, so the test runner can
 * resize a hundred widths with no display, and the smoke test can compare what
 * Electron actually did against the same maths.
 *
 * Coordinates are relative to the window's content area, in CSS pixels, origin
 * top left. A null rectangle means "not on screen"; it never means "destroy",
 * because the web view keeps its session while it is hidden.
 */
import {
  DOCK_WIDTH,
  MIN_WEB_WIDTH,
  RAIL_WIDTH,
  TITLE_BAR_HEIGHT,
  type ShellMode,
} from '../../shared/shell-contract.js'

export interface ShellRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellLayout {
  /** The chrome view sits behind everything: it draws the title bar and rail. */
  chrome: ShellRect
  web: ShellRect | null
  copilot: ShellRect | null
  /** True when the dock is on screen, which is what the chrome's toggle shows. */
  docked: boolean
}

export interface ShellLayoutInput {
  width: number
  height: number
  mode: ShellMode
  dockOpen: boolean
}

function toPixels (value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.round(value))
}

/**
 * How much width the dock may take beside the web app.
 *
 * The dock asks for 360px and gets less only when the window is too narrow to
 * leave the web app MIN_WEB_WIDTH. It never returns a sliver: a 40px panel would
 * be unusable, so below MIN_WEB_WIDTH the dock gives up entirely.
 */
export function resolveDockWidth (availableWidth: number): number {
  const available = toPixels(availableWidth)
  const spare = available - MIN_WEB_WIDTH
  if (spare <= 0) return 0
  return Math.min(DOCK_WIDTH, spare)
}

export function computeShellLayout (input: ShellLayoutInput): ShellLayout {
  const width = toPixels(input.width)
  const height = toPixels(input.height)
  const chrome: ShellRect = { x: 0, y: 0, width, height }

  // The title bar and rail are clipped, not scaled, when the window is smaller
  // than they are, so a tiny window still shows a usable strip rather than
  // rectangles hanging off the edge.
  const contentX = Math.min(RAIL_WIDTH, width)
  const contentY = Math.min(TITLE_BAR_HEIGHT, height)
  const contentWidth = width - contentX
  const contentHeight = height - contentY
  const content: ShellRect = { x: contentX, y: contentY, width: contentWidth, height: contentHeight }

  const wantsDock = input.mode === 'workspace' && input.dockOpen
  const dockWidth = wantsDock ? resolveDockWidth(contentWidth) : 0

  if (input.mode === 'copilot') {
    // ZuriCopilot takes the content area; the web view stays loaded but off
    // screen, which is what keeps its session and scroll position.
    return { chrome, web: null, copilot: content, docked: false }
  }

  if (dockWidth <= 0) {
    return { chrome, web: content, copilot: null, docked: false }
  }

  const webWidth = contentWidth - dockWidth
  return {
    chrome,
    web: { x: content.x, y: content.y, width: webWidth, height: contentHeight },
    copilot: { x: content.x + webWidth, y: content.y, width: dockWidth, height: contentHeight },
    docked: true,
  }
}
