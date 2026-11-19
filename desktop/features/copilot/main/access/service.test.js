'use strict'

/*
 * The access service, tested through the bundle Electron actually loads.
 *
 * `scripts/build-main.mjs` writes `build/main/ipc.cjs`, and these tests require
 * that file rather than the TypeScript source, so what is proven here is the same
 * CommonJS the main process runs.
 *
 * The service is the only part of the access layer that talks to the server, so
 * three things are worth pinning down and each has its own group below:
 *
 * - Eligibility is read off the server's answer, never assumed. A manager without
 *   the permission is reported ungranted rather than hidden, and a member and an
 *   archived workspace never reach the workspace list at all.
 * - A permission write is read, edit, write. The endpoint replaces the stored
 *   list, so the tests assert the exact array sent: one key added or removed and
 *   every other key kept.
 * - Nothing thrown by the transport escapes. A failure becomes one of the fixed
 *   tokens, and the original error, its message and any URL are never carried
 *   out of the service.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const access = require('../../../../build/main/ipc.cjs')

const { createAccessService, AccessServiceError, USE_COPILOT_PERMISSION } = access

/** A well-shaped membership row: the server's own field names. */
function membership ({ id = 4, name = 'Zuri', role = 'owner', status = 'active', permissions = [] } = {}) {
  return { id, name, role, status, permissions }
}

/** A signed-in `/api/auth/me/` answer around the given memberships. */
function mePayload (workspaces, user = {}) {
  return {
    authenticated: true,
    user: {
      id: 11,
      first_name: 'Ada',
      last_name: 'Obi',
      workspaces,
      ...user,
    },
  }
}

/** A member row as the members endpoint returns it. */
function memberRow ({ id = 21, role = 'manager', permissions = [], email = 'manager@example.com' } = {}) {
  return { id, role, permissions, email, first_name: 'Bola', last_name: 'Ade' }
}

/**
 * A stand-in for the workspace client.
 *
 * Every method is async and answers the shape the service narrows. Overrides are
 * spread last so a test replaces only the call it cares about, and the call
 * records below let a test assert what was actually sent.
 */
function stubApi (overrides = {}) {
  const calls = { listMembers: [], updateMemberPermissions: [], signOut: 0 }

  const api = {
    calls,
    async getMe () {
      return { status: 200, payload: mePayload([]) }
    },
    async listMembers (workspaceId) {
      calls.listMembers.push(workspaceId)
      return { members: [] }
    },
    async updateMemberPermissions (workspaceId, userId, permissions) {
      calls.updateMemberPermissions.push({ workspaceId, userId, permissions })
      return { status: 200, payload: {} }
    },
    async signOut () {
      calls.signOut += 1
      return { status: 200, payload: {} }
    },
  }

  return Object.assign(api, overrides)
}

/** A service whose `/me` answer lists exactly these memberships. */
function serviceFor (workspaces, overrides) {
  const api = stubApi({
    async getMe () {
      return { status: 200, payload: mePayload(workspaces) }
    },
    ...overrides,
  })
  return { service: createAccessService(api), api }
}

/** The failure token a rejected promise carries, asserting it is the typed error. */
async function failureOf (promise) {
  let thrown = null
  try {
    await promise
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof AccessServiceError, 'the rejection is an AccessServiceError')
  return thrown
}

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

test('an owner is eligible without the permission key, because the server says so', async () => {
  const { service } = serviceFor([membership({ id: 4, role: 'owner', permissions: [] })])

  const read = await service.readSession()

  assert.equal(read.kind, 'signed_in')
  assert.deepEqual(read.identity, { id: 11, name: 'Ada Obi' })
  assert.deepEqual(read.workspaces, [{ id: 4, name: 'Zuri', role: 'owner', granted: true }])
})

test('a manager holding the permission is eligible', async () => {
  const { service } = serviceFor([
    membership({ id: 7, name: 'Zuri Ops', role: 'manager', permissions: [USE_COPILOT_PERMISSION] }),
  ])

  const read = await service.readSession()

  assert.deepEqual(read.workspaces, [{ id: 7, name: 'Zuri Ops', role: 'manager', granted: true }])
})

test('a manager without the permission is shown ungranted rather than hidden', async () => {
  const { service } = serviceFor([
    membership({ id: 7, name: 'Zuri Ops', role: 'manager', permissions: ['view_reports'] }),
  ])

  const read = await service.readSession()

  // The row survives so the screen can say which workspace to ask an owner about.
  assert.deepEqual(read.workspaces, [{ id: 7, name: 'Zuri Ops', role: 'manager', granted: false }])
})

test('a member never appears, and an archived workspace is dropped', async () => {
  const { service } = serviceFor([
    membership({ id: 1, name: 'Owned', role: 'owner' }),
    membership({ id: 2, name: 'Member only', role: 'member', permissions: [USE_COPILOT_PERMISSION] }),
    membership({ id: 3, name: 'Archived', role: 'owner', status: 'archived' }),
  ])

  const read = await service.readSession()

  assert.deepEqual(read.workspaces, [{ id: 1, name: 'Owned', role: 'owner', granted: true }])
})

test('an unauthenticated answer is a signed-out session, not an error', async () => {
  const api = stubApi({ async getMe () { return { status: 200, payload: { authenticated: false } } } })

  const read = await createAccessService(api).readSession()

  assert.deepEqual(read, { kind: 'signed_out' })
})

test('a name falls back to username, then email, then a neutral label', async () => {
  const byUsername = serviceFor([], {})
  const api = byUsername.api
  api.getMe = async () => ({
    status: 200,
    payload: mePayload([membership()], { first_name: '', last_name: '', username: 'ada', email: 'a@example.com' }),
  })

  const first = await byUsername.service.readSession()
  assert.equal(first.identity.name, 'ada')

  const api2 = stubApi({
    async getMe () {
      return {
        status: 200,
        payload: mePayload([membership()], { first_name: undefined, last_name: undefined, email: 'a@example.com' }),
      }
    },
  })
  const second = await createAccessService(api2).readSession()
  assert.equal(second.identity.name, 'a@example.com')

  const api3 = stubApi({ async getMe () { return { status: 200, payload: mePayload([membership()], { first_name: undefined, last_name: undefined }) } } })
  const third = await createAccessService(api3).readSession()
  assert.equal(third.identity.name, 'Signed-in person')
})

/* ------------------------------------------------------------------ *
 * The owner-only manager list
 * ------------------------------------------------------------------ */

test('the manager list holds managers only, with their grant state', async () => {
  const { service } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return {
        members: [
          { ...memberRow({ id: 21, permissions: [USE_COPILOT_PERMISSION] }) },
          memberRow({ id: 22, permissions: [] }),
          { ...memberRow({ id: 30, role: 'owner', permissions: [USE_COPILOT_PERMISSION] }) },
          { id: 40, role: 'member', permissions: [], email: 'm@example.com' },
        ],
      }
    },
  })

  const listed = await service.listManagers(4)

  assert.equal(listed.workspaceId, 4)
  assert.deepEqual(listed.members, [
    { userId: 21, name: 'Bola Ade', email: 'manager@example.com', granted: true },
    { userId: 22, name: 'Bola Ade', email: 'manager@example.com', granted: false },
  ])
})

test('a member row the service cannot read is skipped, not fatal', async () => {
  const { service } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return {
        members: [
          { id: 'not-a-number', role: 'manager', permissions: [] },
          memberRow({ id: 22, permissions: [USE_COPILOT_PERMISSION] }),
        ],
      }
    },
  })

  const listed = await service.listManagers(4)

  // One unusual row must not hide every other manager on the workspace.
  assert.deepEqual(listed.members.map(entry => entry.userId), [22])
})

/* ------------------------------------------------------------------ *
 * Read, edit, write
 * ------------------------------------------------------------------ */

test('granting keeps every other permission the manager already holds', async () => {
  const { service, api } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return { members: [memberRow({ id: 21, permissions: ['view_reports', 'assign_tasks'] })] }
    },
  })

  const written = await service.setPermission(4, 21, true)

  assert.deepEqual(written, { workspaceId: 4, userId: 21, granted: true })
  assert.deepEqual(api.calls.updateMemberPermissions, [
    { workspaceId: 4, userId: 21, permissions: ['view_reports', 'assign_tasks', USE_COPILOT_PERMISSION] },
  ])
})

test('granting what is already granted sends the list unchanged', async () => {
  const { service, api } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return { members: [memberRow({ id: 21, permissions: [USE_COPILOT_PERMISSION, 'view_reports'] })] }
    },
  })

  await service.setPermission(4, 21, true)

  assert.deepEqual(api.calls.updateMemberPermissions[0].permissions, [USE_COPILOT_PERMISSION, 'view_reports'])
})

test('revoking removes exactly one key and keeps the rest', async () => {
  const { service, api } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return { members: [memberRow({ id: 21, permissions: ['view_reports', USE_COPILOT_PERMISSION, 'assign_tasks'] })] }
    },
  })

  const written = await service.setPermission(4, 21, false)

  assert.deepEqual(written, { workspaceId: 4, userId: 21, granted: false })
  assert.deepEqual(api.calls.updateMemberPermissions, [
    { workspaceId: 4, userId: 21, permissions: ['view_reports', 'assign_tasks'] },
  ])
})

test('an owner, a member and an unknown id are all refused before any write', async () => {
  const target = { role: 'owner' }
  const cases = [
    { label: 'an owner', members: [{ ...memberRow({ id: 21 }), ...target }] },
    { label: 'a member', members: [memberRow({ id: 21, role: 'member' })] },
    { label: 'an unknown id', members: [memberRow({ id: 99 })] },
  ]

  for (const scenario of cases) {
    const { service, api } = serviceFor([membership({ id: 4, role: 'owner' })], {
      async listMembers () {
        return { members: scenario.members }
      },
    })

    const thrown = await failureOf(service.setPermission(4, 21, true))

    assert.equal(thrown.failure, 'rejected', `${scenario.label} is refused`)
    assert.deepEqual(api.calls.updateMemberPermissions, [], `${scenario.label} causes no write`)
  }
})

test('a write the server turns down is a refusal, not a success', async () => {
  const { service } = serviceFor([membership({ id: 4, role: 'owner' })], {
    async listMembers () {
      return { members: [memberRow({ id: 21 })] }
    },
    async updateMemberPermissions () {
      return { status: 500, payload: {} }
    },
  })

  const thrown = await failureOf(service.setPermission(4, 21, true))

  assert.equal(thrown.failure, 'rejected')
})

/* ------------------------------------------------------------------ *
 * Failure tokens, and what must not escape
 * ------------------------------------------------------------------ */

test('a transport failure maps to network', async () => {
  const api = stubApi({
    async getMe () {
      throw Object.assign(new Error('socket hang up'), { code: 'network_error' })
    },
  })

  const thrown = await failureOf(createAccessService(api).readSession())

  assert.equal(thrown.failure, 'network')
})

test('a 401 from either endpoint means the sign-in ended', async () => {
  const unauthorised = stubApi({ async getMe () { return { status: 401, payload: {} } } })
  assert.equal((await failureOf(createAccessService(unauthorised).readSession())).failure, 'not_signed_in')

  const expired = createAccessService(stubApi({
    async listMembers () {
      throw Object.assign(new Error('gone'), { status: 401 })
    },
  }))
  assert.equal((await failureOf(expired.listManagers(4))).failure, 'not_signed_in')
})

test('an unrecognised thrown value becomes a refusal rather than escaping', async () => {
  const api = stubApi({
    async getMe () {
      throw 'not even an error'
    },
  })

  const thrown = await failureOf(createAccessService(api).readSession())

  assert.equal(thrown.failure, 'rejected')
})

test('no URL, token or server text survives a failed call', async () => {
  const api = stubApi({
    async getMe () {
      // A realistic transport error: the address and a credential are in the text.
      throw Object.assign(
        new Error('fetch https://workspace.example.com/api/auth/me/ failed token=abc123'),
        { code: 'network_error' },
      )
    },
  })

  const thrown = await failureOf(createAccessService(api).readSession())

  // The service reduces every failure to its token, and the message is the token.
  assert.equal(thrown.message, 'network')
  for (const leak of ['https://', 'example.com', 'token=', 'abc123']) {
    assert.equal(thrown.message.includes(leak), false, `the message carries ${leak}`)
  }
})

test('a rejected sign-out is reported, and a successful one resolves quietly', async () => {
  const failing = createAccessService(stubApi({
    async signOut () {
      throw Object.assign(new Error('offline'), { code: 'network_error' })
    },
  }))
  assert.equal((await failureOf(failing.signOut())).failure, 'network')

  const { service, api } = serviceFor([])
  await service.signOut()
  assert.equal(api.calls.signOut, 1)
})
