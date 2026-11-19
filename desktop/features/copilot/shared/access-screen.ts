/*
 * What the assistant view draws, decided in one function rather than in a branch
 * inside the view.
 *
 * The point of the table is the first case. The view used to draw its normal
 * content whenever `window.zuriAccess` was missing, on the theory that a page
 * opened in a browser for design work has no bridge and should still render. But
 * the page that renders this view is only reached with a shell bridge present:
 * `App` draws an empty surface when `window.zuriShell` is absent, so a copilot
 * page with no shell bridge never gets this far. That leaves exactly one way to
 * arrive with no access bridge - a preload that exposed half its surface, or a
 * push channel that never registered - and drawing the assistant then hands
 * content to a person nobody has checked. Unverified is therefore its own answer,
 * and it is a locked one.
 *
 * Kept out of the view so the decision can be tested without a renderer: the
 * desktop package runs its tests on node's runner, which has no DOM.
 */
import type { AccessBridge, AccessState } from './access-contract.js'

export type AccessScreen =
  /** No access bridge: nothing can be verified, so nothing is drawn. */
  | { kind: 'unverified' }
  /** The bridge exists but has not answered yet: also nothing, never content. */
  | { kind: 'pending' }
  /** Locked: sign in, ask an owner, or check again. */
  | { kind: 'gate'; bridge: AccessBridge; state: AccessState }
  /** Unlocked but no workspace chosen: the list, and an owner's grant controls. */
  | { kind: 'panel'; bridge: AccessBridge; state: AccessState }
  /** Unlocked on a workspace: the assistant layout. */
  | { kind: 'content' }

const UNVERIFIED: AccessScreen = Object.freeze({ kind: 'unverified' })
const PENDING: AccessScreen = Object.freeze({ kind: 'pending' })
const CONTENT: AccessScreen = Object.freeze({ kind: 'content' })

/**
 * The screen for one moment.
 *
 * The bridge and the state travel with the gate and panel answers so the view
 * cannot pair one moment's state with another's bridge: the type is the
 * connection, not a convention.
 */
export function accessScreenFor (
  bridge: AccessBridge | undefined,
  state: AccessState | null,
): AccessScreen {
  if (bridge === undefined) return UNVERIFIED
  if (state === null) return PENDING
  if (state.status === 'locked') return { kind: 'gate', bridge, state }
  if (state.selectedWorkspaceId === null) return { kind: 'panel', bridge, state }
  return CONTENT
}
