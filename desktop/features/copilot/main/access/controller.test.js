'use strict'

/*
 * The access controller, tested through the bundle Electron actually loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and this file requires
 * that bundle, so what is proven is the CommonJS the main process runs.
 *
 * Every method answers with an envelope and never rejects, so each test asserts
 * on the returned object. What is pinned down here is the locking rule and the
 * staleness rule: a withdrawn grant, an ended session, a different account and a
 * network blip each get their own reason, and a late answer is dropped rather
 * than restoring a session that is already gone.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const access = require('../../../../build/main/ipc.cjs')
const { createAccessStore, createAccessController, AccessServiceError } = access

/** A service with every method the controller needs, and no I/O. */
function stubService (overrides = {}) {
  return {
    readSession: async () => ({ kind: 'signed_out' }),
    listManagers: async workspaceId => ({ workspaceId, members: [] }),
    setPermission: async (workspaceId, userId, granted) => ({ workspaceId, userId, granted }),
    signOut: async () => {},
    ...overrides,
  }
}

/** One workspace row, shaped as the server's memberships are mapped. */
function workspace (id, role, granted, name = `Workspace ${id}`) {
  return { id, name, role, granted }
}

/** A signed-in read result, carrying the identity the controller keeps across a lock. */
function signedIn (userId, workspaces) {
  return { kind: 'signed_in', identity: { id: userId, name: `Person ${userId}` }, workspaces }
}

/** A promise settled by hand, so a read can be held open across a transition. */
function deferred () {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

/**
 * A `readSession` that answers from a list and then repeats the last answer:
 * "the session has not moved" is exactly what that answer says, and the tests
 * that read again after a change depend on it.
 */
function scriptedReadSession (answers) {
  let index = 0
  return async () => {
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    return answer
  }
}

/** A store and a controller over one service, with the store kept for direct transitions. */
function harness (service = stubService()) {
  const store = createAccessStore()
  const controller = createAccessController(store, service)
  return { store, controller, service }
}

test('a signed-in owner with one owner workspace unlocks the assistant on it', async () => {
  const owned = workspace(11, 'owner', true)
  const { controller } = harness(stubService({ readSession: async () => signedIn(1, [owned]) }))

  const reply = await controller.refresh()

  assert.equal(reply.ok, true)
  const state = controller.getState()
  assert.equal(state.status, 'ready')
  assert.equal(state.reason, null)
  assert.equal(state.selectedWorkspaceId, 11)
  assert.deepEqual(state.identity, { id: 1, name: 'Person 1' })
  assert.deepEqual(state.workspaces, [owned])
  // The reply and the pushed state are one answer, so a caller that reads only
  // the reply sees what the panel sees.
  assert.deepEqual(reply.value, state)
})

test('a manager without a grant locks with no_access and keeps the rows to ask about', async () => {
  const ungranted = workspace(21, 'manager', false)
  const { controller } = harness(stubService({ readSession: async () => signedIn(1, [ungranted]) }))

  const reply = await controller.refresh()

  assert.equal(reply.ok, true)
  const state = controller.getState()
  assert.equal(state.status, 'locked')
  assert.equal(state.reason, 'no_access')
  assert.equal(state.selectedWorkspaceId, null)
  // Identity and rows survive the lock, so the ask-an-owner screen can name the
  // person and the workspaces instead of being a dead end.
  assert.deepEqual(state.identity, { id: 1, name: 'Person 1' })
  assert.deepEqual(state.workspaces, [ungranted])
})

test('a network failure on refresh answers network and leaves the unlocked state alone', async () => {
  const service = stubService({ readSession: async () => signedIn(1, [workspace(11, 'owner', true)]) })
  const { controller } = harness(service)

  await controller.refresh()
  const before = controller.getState()
  // The stub is mutated rather than replaced: the controller holds this object,
  // so the next read is the one that fails.
  service.readSession = async () => { throw new AccessServiceError('network') }
  const reply = await controller.refresh()

  assert.deepEqual(reply, { ok: false, reason: 'network' })
  // A blip is not evidence that access changed, so nothing is published.
  assert.equal(controller.getState(), before, 'a failed read must not publish a state')
})

test('a read that answers not signed in locks with expired', async () => {
  const service = stubService({ readSession: async () => signedIn(1, [workspace(11, 'owner', true)]) })
  const { controller } = harness(service)

  await controller.refresh()
  service.readSession = async () => { throw new AccessServiceError('not_signed_in') }
  const reply = await controller.refresh()

  assert.deepEqual(reply, { ok: false, reason: 'not_signed_in' })
  const state = controller.getState()
  assert.equal(state.status, 'locked')
  // Expired, not signed out: the session ended while the app was open, which is
  // a different instruction to the person.
  assert.equal(state.reason, 'expired')
  assert.equal(state.identity, null)
  assert.equal(state.selectedWorkspaceId, null)
})

test('a selected workspace that loses its grant locks with revoked', async () => {
  const service = stubService({
    readSession: scriptedReadSession([
      signedIn(1, [workspace(11, 'owner', true)]),
      signedIn(1, [workspace(11, 'owner', false)]),
    ]),
  })
  const { controller } = harness(service)

  await controller.refresh()
  assert.equal(controller.getState().selectedWorkspaceId, 11)
  const reply = await controller.refresh()

  assert.equal(reply.ok, true)
  const state = controller.getState()
  // Continuing in another workspace would carry the assistant session across a
  // grant boundary, so the session is closed instead.
  assert.equal(state.status, 'locked')
  assert.equal(state.reason, 'revoked')
  assert.equal(state.selectedWorkspaceId, null)
  assert.equal(state.identity, null)
})

test('a different person signing in locks with account_changed and is adopted only on the next read', async () => {
  const service = stubService({
    readSession: scriptedReadSession([
      signedIn(1, [workspace(11, 'owner', true)]),
      signedIn(2, [workspace(22, 'owner', true)]),
    ]),
  })
  const { controller } = harness(service)

  await controller.refresh()
  assert.equal(controller.getState().status, 'ready')
  assert.equal(controller.getState().identity.id, 1)
  const changed = await controller.refresh()

  assert.equal(changed.ok, true)
  const locked = controller.getState()
  assert.equal(locked.status, 'locked')
  assert.equal(locked.reason, 'account_changed')
  // Person two's workspaces are not adopted while the screen still shows person
  // one's: nothing of the new account is drawn without a confirmation.
  assert.equal(locked.identity, null)
  assert.deepEqual(locked.workspaces, [])
  assert.equal(locked.selectedWorkspaceId, null)

  // The second read is the confirmation, and it clears the previous person.
  const confirmed = await controller.refresh()

  assert.equal(confirmed.ok, true)
  const ready = controller.getState()
  assert.equal(ready.status, 'ready')
  assert.equal(ready.reason, null)
  assert.deepEqual(ready.identity, { id: 2, name: 'Person 2' })
  assert.deepEqual(ready.workspaces, [workspace(22, 'owner', true)])
  assert.equal(ready.selectedWorkspaceId, 22)
})

test('a read that finishes after sign-out answers stale and cannot restore the session', async () => {
  const held = deferred()
  const { controller } = harness(stubService({ readSession: () => held.promise }))

  const pending = controller.refresh()
  const signedOut = await controller.signOut()
  assert.equal(signedOut.ok, true)
  assert.equal(controller.getState().reason, 'signed_out')

  // A perfectly valid owner payload delivered to a session that no longer
  // exists. Applying it would sign the person back in on a shared machine.
  held.resolve(signedIn(1, [workspace(11, 'owner', true)]))
  const reply = await pending

  assert.deepEqual(reply, { ok: false, reason: 'stale' })
  const state = controller.getState()
  assert.equal(state.status, 'locked')
  assert.equal(state.reason, 'signed_out')
  assert.equal(state.identity, null)
  assert.deepEqual(state.workspaces, [])
})

test('the older of two overlapping refreshes answers stale and does not overwrite the newer state', async () => {
  const first = deferred()
  const second = deferred()
  const service = stubService({ readSession: scriptedReadSession([first.promise, second.promise]) })
  const { controller } = harness(service)

  const older = controller.refresh()
  const newer = controller.refresh()

  second.resolve(signedIn(1, [workspace(11, 'owner', true)]))
  assert.equal((await newer).ok, true)
  assert.deepEqual(controller.getState().workspaces, [workspace(11, 'owner', true)])

  // A wider list than the newer read returned: if it were applied the extra row
  // would appear, so its absence is the proof the answer was dropped.
  first.resolve(signedIn(1, [workspace(11, 'owner', true), workspace(12, 'owner', true)]))
  const olderReply = await older

  assert.deepEqual(olderReply, { ok: false, reason: 'stale' })
  const state = controller.getState()
  assert.equal(state.status, 'ready')
  assert.deepEqual(state.workspaces, [workspace(11, 'owner', true)])
  assert.equal(state.selectedWorkspaceId, 11)
})

test('signOut locks at once and reports a failure it could not deliver to the server', async () => {
  const service = stubService({
    readSession: async () => signedIn(1, [workspace(11, 'owner', true)]),
    signOut: async () => { throw new AccessServiceError('network') },
  })
  const { controller } = harness(service)

  await controller.refresh()
  assert.equal(controller.getState().status, 'ready')
  const reply = await controller.signOut()

  // The lock is what the person asked for and it does not wait for the server, so
  // the screen closes whether or not the call lands.
  const state = controller.getState()
  assert.equal(state.status, 'locked')
  assert.equal(state.reason, 'signed_out')
  assert.equal(state.identity, null)

  // An unreachable server means the session cookie is still alive, so a reply
  // saying "signed out" would be a claim this layer cannot make.
  assert.deepEqual(reply, { ok: false, reason: 'network' })
})

test('selectWorkspace refuses an ungranted row with no_access and any selection while locked', async () => {
  const granted = workspace(11, 'owner', true)
  const ungranted = workspace(21, 'manager', false)
  const { controller } = harness(stubService({
    readSession: scriptedReadSession([signedIn(1, [granted, ungranted]), { kind: 'signed_out' }]),
  }))

  await controller.refresh()
  const before = controller.getState()
  assert.equal(before.status, 'ready')
  assert.equal(before.selectedWorkspaceId, 11)

  const refused = await controller.selectWorkspace(21)

  assert.deepEqual(refused, { ok: false, reason: 'no_access' })
  // The same state object, not merely an equal one: a refusal publishes nothing.
  assert.equal(controller.getState(), before)

  // The session then ends, and a selection has nothing to select on.
  await controller.refresh()
  assert.equal(controller.getState().status, 'locked')
  const locked = await controller.selectWorkspace(11)

  assert.deepEqual(locked, { ok: false, reason: 'not_signed_in' })
  assert.equal(controller.getState().status, 'locked')
})

test('listManagers and setPermission refuse not_owner on a manager workspace without calling the service', async () => {
  const calls = []
  const service = stubService({
    readSession: async () => signedIn(1, [workspace(21, 'manager', true)]),
    listManagers: async workspaceId => {
      calls.push(['listManagers', workspaceId])
      return { workspaceId, members: [] }
    },
    setPermission: async (workspaceId, userId, granted) => {
      calls.push(['setPermission', workspaceId, userId, granted])
      return { workspaceId, userId, granted }
    },
  })
  const { controller } = harness(service)

  await controller.refresh()
  // A granted manager workspace unlocks the assistant, so the refusal below is
  // about the role and not about the lock.
  assert.equal(controller.getState().status, 'ready')
  assert.equal(controller.getState().workspaces[0].role, 'manager')

  const listed = await controller.listManagers(21)
  const written = await controller.setPermission(21, 5, true)

  assert.deepEqual(listed, { ok: false, reason: 'not_owner' })
  assert.deepEqual(written, { ok: false, reason: 'not_owner' })
  // Refused before anything leaves the machine.
  assert.deepEqual(calls, [])
})

test('the manager list and the permission write pass through and return what the service answered', async () => {
  const members = [{ userId: 5, name: 'Person 5', email: 'five@example.test', granted: false }]
  const service = stubService({
    readSession: async () => signedIn(1, [workspace(11, 'owner', true)]),
    listManagers: async workspaceId => ({ workspaceId, members }),
  })
  const { controller } = harness(service)

  await controller.refresh()

  assert.deepEqual(await controller.listManagers(11), { ok: true, value: { workspaceId: 11, members } })
  assert.deepEqual(
    await controller.setPermission(11, 5, true),
    { ok: true, value: { workspaceId: 11, userId: 5, granted: true } },
  )
})

test('the manager list is withheld when the workspace stops being eligible while it loads', async () => {
  const held = [deferred(), deferred()]
  let reads = 0
  const service = stubService({
    readSession: async () => signedIn(1, [workspace(11, 'owner', true)]),
    listManagers: () => {
      const answer = held[reads]
      reads += 1
      if (!answer) throw new Error('the test scripted more manager reads than it expected')
      return answer.promise
    },
  })
  const { store, controller } = harness(service)

  await controller.refresh()

  /*
   * A lock while the list is loading bumps the request ticket, so the late answer
   * is superseded: it answers stale, and nothing of the old owner's member list
   * is applied to a session that has just ended.
   */
  const afterLock = controller.listManagers(11)
  store.lock('revoked')
  held[0].resolve({ workspaceId: 11, members: [{ userId: 5, name: 'Person 5', email: '', granted: true }] })

  assert.deepEqual(await afterLock, { ok: false, reason: 'stale' })
  assert.equal(controller.getState().status, 'locked')

  /*
   * The grant can also disappear without a lock, through a workspace list that no
   * longer carries it. That leaves the ticket newest, so the answer is caught by
   * the eligibility check and refused as no_access rather than shown under a
   * workspace the person cannot use.
   */
  await controller.refresh()
  const afterGrant = controller.listManagers(11)
  store.applyWorkspaces([workspace(11, 'owner', false)])
  held[1].resolve({ workspaceId: 11, members: [] })

  assert.deepEqual(await afterGrant, { ok: false, reason: 'no_access' })
  assert.equal(controller.getState().status, 'locked')
  assert.equal(controller.getState().reason, 'no_access')
})

/* ------------------------------------------------------------------ *
 * What the page is allowed to see on the way to a lock
 * ------------------------------------------------------------------ */

test('a refresh that withdraws the selected grant pushes only a locked state', async () => {
  const service = stubService({
    readSession: scriptedReadSession([
      signedIn(1, [workspace(11, 'owner', true)]),
      // A second workspace is still granted, so a refresh that unlocked first and
      // checked afterwards would continue there and publish a ready frame.
      signedIn(1, [workspace(11, 'owner', false), workspace(12, 'owner', true)]),
    ]),
  })
  const { controller } = harness(service)
  const pushed = []
  controller.subscribe(state => pushed.push(`${state.status}:${state.reason ?? '-'}`))

  await controller.refresh()
  assert.deepEqual(pushed, ['ready:-'])

  const reply = await controller.refresh()

  assert.equal(reply.ok, true)
  // The invariant this file's header states: a person whose grant was withdrawn
  // never sees the assistant, not even for the frame between two states.
  assert.deepEqual(pushed, ['ready:-', 'locked:revoked'])
  assert.equal(controller.getState().selectedWorkspaceId, null)
  assert.equal(controller.getState().workspaces.length, 0)
})

test('an automatic refresh cannot undo a sign-out whose server call failed', async () => {
  let reads = 0
  const service = stubService({
    readSession: async () => {
      reads += 1
      return signedIn(1, [workspace(11, 'owner', true)])
    },
    signOut: async () => { throw new AccessServiceError('network') },
  })
  const { controller } = harness(service)

  await controller.refresh()
  assert.equal(reads, 1)
  assert.deepEqual(await controller.signOut(), { ok: false, reason: 'network' })

  /*
   * A window focus or a web view load: nobody asked, and the cookie the failed
   * sign-out never cleared is still valid. Reading it here would sign the person
   * back in on a machine they had just walked away from.
   */
  const automatic = await controller.refresh({ automatic: true })

  assert.equal(automatic.ok, true)
  assert.equal(automatic.value.status, 'locked')
  assert.equal(automatic.value.reason, 'signed_out')
  assert.equal(reads, 1, 'the automatic refresh did not read the session')
  assert.equal(controller.getState().status, 'locked')

  /*
   * Asking again is a different thing, and it is the one the gate offers: the
   * "Check again" button is the person's own request, so it may find the session
   * that is still there.
   */
  const asked = await controller.refresh()

  assert.equal(asked.ok, true)
  assert.equal(asked.value.status, 'ready')
  assert.equal(reads, 2)

  // One read has succeeded, so the automatic refreshes that watch for a withdrawn
  // grant are working again rather than answering from a stale lock.
  await controller.refresh({ automatic: true })
  assert.equal(reads, 3)
})
