/*
 * The access controller: the gate between the renderer's requests and the
 * session on disk.
 *
 * Every method answers with the contract's reply envelope, never with an
 * exception. That is what keeps a failed write from reaching the page as a
 * stack trace, and it is what lets the page show one kind of failure line
 * instead of branching on which layer broke.
 *
 * The locking rules, in one place because they are the point of this file:
 *
 * - Signed out, or a read says nobody is signed in: locked, `signed_out`.
 * - A protected call answers "not signed in": the session ended while the app
 *   was open, so locked, `expired`, and every in-flight answer is dropped.
 * - A different person answers than the one this session belonged to: locked,
 *   `account_changed`. The new session is not adopted silently, because the
 *   workspaces and permissions of the previous person are still on screen.
 * - The selected workspace loses its grant: locked, `revoked`.
 * - A network blip on a refresh leaves the state alone: a temporary failure is
 *   not evidence that access changed, and locking on every blip would make the
 *   assistant unusable on a flaky connection.
 * - Signing out locks at once and stays locked. When the server call fails the
 *   session cookie survives, so a later read would find a perfectly valid session
 *   and hand the assistant back to whoever sits down at the machine next.
 */
import {
  accessValueReply,
  type AccessFailure,
  type AccessManagers,
  type AccessPermission,
  type AccessReply,
  type AccessState,
} from '../../shared/access-contract.js'

import type { AccessService } from './service.js'
import { AccessServiceError } from './service.js'
import type { AccessStore } from './store.js'

export interface AccessRefreshOptions {
  /**
   * True for a read the main process starts by itself: the window gaining focus,
   * or the web view finishing a load. Absent means the person asked, and a
   * person's request is the only kind allowed to undo their own sign-out.
   */
  automatic?: boolean
}

export interface AccessController {
  getState(): AccessState
  subscribe(listener: (state: AccessState) => void): () => void
  refresh(options?: AccessRefreshOptions): Promise<AccessReply<AccessState>>
  selectWorkspace(workspaceId: number): Promise<AccessReply<AccessState>>
  listManagers(workspaceId: number): Promise<AccessReply<AccessManagers>>
  setPermission(
    workspaceId: number,
    userId: number,
    granted: boolean,
  ): Promise<AccessReply<AccessPermission>>
  signOut(): Promise<AccessReply<AccessState>>
}

function failure (reason: AccessFailure): AccessReply<never> {
  return { ok: false, reason }
}

function failureOf (error: unknown): AccessFailure {
  if (error instanceof AccessServiceError) return error.failure
  return 'internal_error'
}

export function createAccessController (
  store: AccessStore,
  service: AccessService,
): AccessController {
  /**
   * The last identity this session belongs to, kept across a lock.
   *
   * It survives a sign-out on purpose: signing out clears the screen but not the
   * memory of whose screen it was, which is the only way a later read can notice
   * that a different person signed in.
   */
  let knownIdentityId: number | null = null

  /**
   * True from an explicit sign-out until a read succeeds again.
   *
   * The lock always happens locally, but the server may not have ended the
   * session: a failed sign-out call leaves the cookie alive, and an automatic
   * refresh would then read that session and unlock the assistant the person had
   * just closed. While this is set, an automatic refresh answers the locked state
   * without touching the network; a refresh the person asked for still clears it,
   * because asking again is the one thing that proves they want back in.
   */
  let signedOutByPerson = false

  async function refresh (options: AccessRefreshOptions = {}): Promise<AccessReply<AccessState>> {
    if (signedOutByPerson && options.automatic === true) {
      // See signedOutByPerson: focus and page-load refreshes are not the person
      // asking, so they answer what is on screen instead of reading the session.
      return accessValueReply(store.getState())
    }

    const ticket = store.beginRequest()
    let read: Awaited<ReturnType<AccessService['readSession']>>
    try {
      read = await service.readSession()
    } catch (error) {
      // Superseded while the read was in flight: the newer attempt owns the
      // outcome, and applying this one would fight it.
      if (!store.isLatest(ticket)) return failure('stale')
      const reason = failureOf(error)
      if (reason === 'not_signed_in') {
        store.lock('expired')
        return failure('not_signed_in')
      }
      return failure(reason)
    }

    if (!store.isLatest(ticket)) return failure('stale')

    // The read succeeded, so the session this lock was guarding against is no
    // longer unknown and the next automatic refresh may read again.
    signedOutByPerson = false

    if (read.kind === 'signed_out') {
      knownIdentityId = null
      store.lock('signed_out')
      return accessValueReply(store.getState())
    }

    if (knownIdentityId !== null && knownIdentityId !== read.identity.id) {
      // Locked, not adopted. The person confirms the new account by asking
      // again, and the confirmation is what clears the previous person's screen.
      knownIdentityId = read.identity.id
      store.lock('account_changed')
      return accessValueReply(store.getState())
    }

    const before = store.getState()
    const wasSelected = before.status === 'ready' ? before.selectedWorkspaceId : null

    knownIdentityId = read.identity.id

    /*
     * Checked before unlocking, not after: unlocking publishes a ready state, and
     * a ready state is the page's signal to draw the assistant. Doing it the
     * other way round pushed a ready frame on a workspace whose grant had just
     * been withdrawn, which is exactly the frame the header promises never to
     * show. One empty frame today is real assistant content in a later phase.
     */
    if (wasSelected !== null) {
      const stillGranted = read.workspaces.some(
        workspace => workspace.id === wasSelected && workspace.granted,
      )
      if (!stillGranted) {
        // The workspace in use no longer carries the permission. Continuing in a
        // different workspace would carry an assistant session across a grant
        // boundary, so the session is closed and the person is told why.
        store.lock('revoked')
        return accessValueReply(store.getState())
      }
    }

    store.unlock({ identity: read.identity, workspaces: read.workspaces })
    return accessValueReply(store.getState())
  }

  async function selectWorkspace (workspaceId: number): Promise<AccessReply<AccessState>> {
    if (store.getState().identity === null) return failure('not_signed_in')
    if (!store.isEligible(workspaceId)) return failure('no_access')
    const next = store.select(workspaceId)
    if (next === null) return failure('no_access')
    return accessValueReply(next)
  }

  /**
   * The owner-only manager list.
   *
   * The owner check happens here as well as on the server: a manager who calls
   * this by hand gets a refusal without a request leaving the machine, and the
   * server refuses the same thing if the check were ever wrong.
   */
  async function listManagers (workspaceId: number): Promise<AccessReply<AccessManagers>> {
    if (store.getState().identity === null) return failure('not_signed_in')
    if (!store.isOwner(workspaceId)) return failure('not_owner')

    const ticket = store.beginRequest()
    let members: AccessManagers
    try {
      members = await service.listManagers(workspaceId)
    } catch (error) {
      if (!store.isLatest(ticket)) return failure('stale')
      const reason = failureOf(error)
      if (reason === 'not_signed_in') {
        store.lock('expired')
        return failure('not_signed_in')
      }
      return failure(reason)
    }

    if (!store.isLatest(ticket)) return failure('stale')
    // The workspace may have been revoked or deselected while the list was
    // loading. Answering anyway would show one owner's member list under
    // another workspace's heading.
    if (!store.isEligible(workspaceId)) return failure('no_access')
    return accessValueReply(members)
  }

  async function setPermission (
    workspaceId: number,
    userId: number,
    granted: boolean,
  ): Promise<AccessReply<AccessPermission>> {
    if (store.getState().identity === null) return failure('not_signed_in')
    if (!store.isOwner(workspaceId)) return failure('not_owner')

    const ticket = store.beginRequest()
    let permission: AccessPermission
    try {
      permission = await service.setPermission(workspaceId, userId, granted)
    } catch (error) {
      if (!store.isLatest(ticket)) return failure('stale')
      const reason = failureOf(error)
      if (reason === 'not_signed_in') {
        store.lock('expired')
        return failure('not_signed_in')
      }
      return failure(reason)
    }

    if (!store.isLatest(ticket)) return failure('stale')
    return accessValueReply(permission)
  }

  /**
   * Lock first, then tell the server.
   *
   * The lock comes before the call and does not depend on it: the screen closes
   * at once, and a slow or unreachable server cannot leave the assistant open.
   * The call is still made, and its failure is reported rather than swallowed -
   * an unreachable server means the session cookie is still alive, and a reply
   * saying "signed out" would be a claim the main process cannot make. The state
   * is locked either way, so the refusal costs the person nothing but the truth.
   */
  async function signOut (): Promise<AccessReply<AccessState>> {
    store.invalidate()
    knownIdentityId = null
    // Set before the lock so an automatic refresh landing after this point
    // already sees it, and cleared only by a read that succeeds.
    signedOutByPerson = true
    store.lock('signed_out')

    try {
      await service.signOut()
    } catch (error) {
      return failure(failureOf(error))
    }

    return accessValueReply(store.getState())
  }

  // A push on every transition is what keeps the rail, the dock and the access
  // panel from each holding a different idea of who is signed in.
  return {
    getState: () => store.getState(),
    subscribe: listener => store.subscribe(listener),
    refresh,
    selectWorkspace,
    listManagers,
    setPermission,
    signOut,
  }
}
