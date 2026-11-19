/*
 * The access store: the one place that holds whether the assistant is unlocked,
 * for whom, and on which workspace.
 *
 * Two jobs, and the second is the subtle one.
 *
 * 1. State transitions. Every transition returns the new validated state, so the
 *    renderer never invents a state the contract does not allow.
 *
 * 2. Staleness. Every protected read is a network round trip that may finish
 *    after the world moved on: after a sign-out, after a different account
 *    signed in, after an owner revoked the grant, after another workspace was
 *    selected. A late answer applied on top of the new world is the classic way
 *    a revoked grant quietly comes back. `beginRequest()` hands out a ticket,
 *    `isLatest()` says whether that ticket is still the newest, and every lock or
 *    selection calls `invalidate()` so answers already in flight can never
 *    restore what was just cleared.
 *
 * The store does no I/O and knows nothing about HTTP, so all of this is testable
 * by calling methods in an order rather than by faking a server.
 */
import {
  ACCESS_VERSION,
  type AccessIdentity,
  type AccessState,
  type AccessWorkspace,
  type LockReason,
} from '../../shared/access-contract.js'

export interface AccessStoreSeed {
  /** Start unlocked with these workspaces, which is how a test seeds a session. */
  identity?: AccessIdentity
  workspaces?: AccessWorkspace[]
  selectedWorkspaceId?: number | null
}

export interface AccessStore {
  getState(): AccessState
  subscribe(listener: (state: AccessState) => void): () => void
  isEligible(workspaceId: number): boolean
  isOwner(workspaceId: number): boolean
  beginRequest(): number
  isLatest(ticket: number): boolean
  invalidate(): void
  unlock(input: { identity: AccessIdentity; workspaces: AccessWorkspace[] }): AccessState
  lock(reason: LockReason): AccessState
  select(workspaceId: number): AccessState | null
  applyWorkspaces(workspaces: AccessWorkspace[]): AccessState
  dropWorkspace(workspaceId: number, reason: LockReason): AccessState
}

const LOCKED_STATE: AccessState = Object.freeze({
  version: ACCESS_VERSION,
  status: 'locked',
  reason: null,
  identity: null,
  workspaces: [],
  selectedWorkspaceId: null,
})

/** A workspace can be used only when the server granted this person the permission. */
function usable (workspace: AccessWorkspace): boolean {
  return workspace.granted
}

/**
 * Pick the workspace to keep selected.
 *
 * The previous selection wins while it is still usable, so a refresh does not
 * move the person's cursor. Otherwise the first usable workspace is taken, and
 * with none the selection is null.
 */
function chooseSelection (
  workspaces: readonly AccessWorkspace[],
  preferred: number | null,
): number | null {
  if (preferred !== null) {
    const kept = workspaces.find(workspace => workspace.id === preferred && usable(workspace))
    if (kept) return kept.id
  }
  const first = workspaces.find(usable)
  return first ? first.id : null
}

/**
 * The state for a set of workspaces: ready only when at least one is usable.
 *
 * An empty list and a list of ungranted manager rows both mean the same thing to
 * the person, which is "an owner has to turn this on", so both land on
 * `no_access` with the rows kept for the explanation.
 */
function stateFor (
  identity: AccessIdentity,
  workspaces: readonly AccessWorkspace[],
  preferred: number | null,
): AccessState {
  const selected = chooseSelection(workspaces, preferred)
  if (selected === null) {
    return {
      version: ACCESS_VERSION,
      status: 'locked',
      reason: 'no_access',
      identity,
      workspaces: [...workspaces],
      selectedWorkspaceId: null,
    }
  }
  return {
    version: ACCESS_VERSION,
    status: 'ready',
    reason: null,
    identity,
    workspaces: [...workspaces],
    selectedWorkspaceId: selected,
  }
}

export function createAccessStore (seed: AccessStoreSeed = {}): AccessStore {
  let state: AccessState =
    seed.identity && seed.workspaces
      ? stateFor(seed.identity, seed.workspaces, seed.selectedWorkspaceId ?? null)
      : LOCKED_STATE

  let ticket = 0
  const listeners = new Set<(next: AccessState) => void>()

  function publish (next: AccessState): AccessState {
    state = Object.freeze(next)
    // Copied before iterating: a listener that unsubscribes itself must not
    // change the set being walked.
    for (const listener of [...listeners]) {
      try {
        listener(state)
      } catch {
        // A renderer callback that throws is a rendering bug. Letting it unwind
        // here would abandon the remaining listeners and leave the page half
        // updated, so it is swallowed and the next push carries the truth.
      }
    }
    return state
  }

  function workspaceById (workspaceId: number): AccessWorkspace | null {
    const found = state.workspaces.find(workspace => workspace.id === workspaceId)
    return found ?? null
  }

  function isEligible (workspaceId: number): boolean {
    const found = workspaceById(workspaceId)
    return found !== null && usable(found)
  }

  return {
    getState () {
      return state
    },

    subscribe (listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    isEligible,

    isOwner (workspaceId) {
      const found = workspaceById(workspaceId)
      return found !== null && found.role === 'owner'
    },

    /**
     * Start a protected read. The returned ticket is compared with `isLatest`
     * after the await, so a superseded answer is dropped instead of applied.
     */
    beginRequest () {
      ticket += 1
      return ticket
    },

    isLatest (candidate) {
      return candidate === ticket
    },

    invalidate () {
      ticket += 1
    },

    unlock ({ identity, workspaces }) {
      // A different person, or the same person re-read, invalidates every answer
      // in flight: the workspaces they were about are no longer this session's.
      ticket += 1
      return publish(stateFor(identity, workspaces, state.selectedWorkspaceId))
    },

    lock (reason) {
      ticket += 1
      return publish({
        version: ACCESS_VERSION,
        status: 'locked',
        reason,
        identity: null,
        workspaces: [],
        selectedWorkspaceId: null,
      })
    },

    /**
     * Select a workspace. A workspace that is not usable cannot be selected: the
     * answer is null and the state is left alone, so a stray click cannot open
     * the assistant on a workspace whose grant was withdrawn.
     */
    select (workspaceId) {
      if (!isEligible(workspaceId)) return null
      ticket += 1
      return publish({
        ...state,
        status: 'ready',
        reason: null,
        selectedWorkspaceId: workspaceId,
      })
    },

    /**
     * Replace the workspace list after a fresh read, keeping the person's
     * selection where it still makes sense.
     */
    applyWorkspaces (workspaces) {
      if (state.identity === null) {
        // Locked states have no list to update. Reaching here means a read
        // finished for a session that no longer exists, so there is nothing to
        // apply and the lock stands.
        return state
      }
      return publish(stateFor(state.identity, workspaces, state.selectedWorkspaceId))
    },

    /**
     * Drop one workspace, which is what a revoked grant looks like.
     *
     * If it was the selected one the person moves to another usable workspace,
     * and is locked with the given reason when none is left. Falling back to
     * locked rather than to a silent no-op is deliberate: continuing as if
     * nothing happened would leave a switched-off assistant looking available.
     */
    dropWorkspace (workspaceId, reason) {
      ticket += 1
      if (state.identity === null) return state
      const remaining = state.workspaces.filter(workspace => workspace.id !== workspaceId)
      const next = stateFor(state.identity, remaining, state.selectedWorkspaceId)
      if (next.status === 'locked') return publish({ ...next, reason })
      return publish(next)
    },
  }
}
