'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  PROBE_RESULT_FIELDS,
  isSanitizedProbeResult,
  sanitizeProbeResult,
} = require('../../shared/probe-contract.js')
const { createWorkspaceClient } = require('./client.js')
const { MARKER_PREFIX, createProbe } = require('./probe.js')
const { createWorkspaceProbe, WORKSPACE_PARTITION } = require('./index.js')
const {
  DEFAULT_ME,
  TEST_CSRF_TOKEN,
  createHttpSession,
  createStubSession,
  startFakeWorkspaceServer,
} = require('./fixtures/fake-session.js')

const SERVER = 'https://workspace.example.test'
const WORKSPACE_ID = 7
const TASK_ID = 4242
// A fixed clock: checkedAt is asserted against the contract's ISO pattern and
// durationMs against an exact number.
const CHECKED_AT = '2026-11-14T09:00:00.000Z'
function fixedClock () {
  let ticks = 1000
  return { now: () => (ticks += 5), iso: () => CHECKED_AT }
}

function me (workspaces, { authenticated = true } = {}) {
  return {
    status: 200,
    body: authenticated
      ? { authenticated: true, user: { id: 1, first_name: 'Probe', workspaces } }
      : { authenticated: false },
  }
}

const OWNER_WORKSPACE = {
  id: WORKSPACE_ID,
  name: 'Isolated probe workspace',
  role: 'owner',
  status: 'active',
  permissions: ['create_tasks', 'edit_team_tasks'],
}

/** Route a stubbed session by endpoint, so each test states only what it changes. */
function routed ({ me: meAnswer = DEFAULT_ME, create, remove } = {}) {
  return call => {
    if (call.url.endsWith('/api/auth/csrf/')) return { status: 200, body: { status: 'ok' } }
    if (call.url.endsWith('/api/auth/me/')) return meAnswer
    if (call.method === 'POST') {
      return create ? create(call) : { status: 201, body: { task: { id: TASK_ID, assignee: null } } }
    }
    if (call.method === 'DELETE') {
      return remove ? remove(call) : { status: 200, body: { deleted: TASK_ID, permanent: true } }
    }
    throw new Error(`unexpected request ${call.method} ${call.url}`)
  }
}

function buildProbe (options = {}) {
  const stub = createStubSession({
    handler: routed(options),
    csrfToken: options.csrfToken === undefined ? TEST_CSRF_TOKEN : options.csrfToken,
  })
  const client = createWorkspaceClient({ session: stub.session, serverUrl: SERVER })
  return {
    probe: createProbe({ client, workspaceId: WORKSPACE_ID, clock: fixedClock() }),
    calls: stub.calls,
  }
}

function assertContractShape (outcome) {
  // Every outcome has to survive the shared sanitizer, or the IPC layer would have to
  // invent fields. This also proves no extra key travels with it.
  const sanitized = sanitizeProbeResult(outcome)
  assert.ok(isSanitizedProbeResult(sanitized))
  assert.deepEqual(Object.keys(sanitized).sort(), [...PROBE_RESULT_FIELDS].sort())
  return sanitized
}

test('read reports the workspaces from user.workspaces', async () => {
  const { probe } = buildProbe({
    me: me([OWNER_WORKSPACE, { ...OWNER_WORKSPACE, id: 9, name: 'Second' }]),
  })

  const outcome = await probe.run('read')
  const sanitized = assertContractShape(outcome)

  assert.equal(sanitized.status, 'ok')
  assert.equal(sanitized.errorCode, null)
  assert.equal(sanitized.httpStatus, 200)
  assert.equal(sanitized.workspaceCount, 2)
  // Only the explicitly selected workspace is named back.
  assert.equal(sanitized.workspaceId, WORKSPACE_ID)
  assert.equal(sanitized.checkedAt, CHECKED_AT)
  assert.equal(sanitized.durationMs, 5)
})

test('read treats authenticated:false as signed out even though the status is 200', async () => {
  const { probe } = buildProbe({ me: { status: 200, body: { authenticated: false } } })

  const sanitized = assertContractShape(await probe.run('read'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.errorCode, 'not_signed_in')
  assert.equal(sanitized.httpStatus, 200)
  assert.equal(sanitized.workspaceCount, null)
})

test('read reports a refused session and a server error as codes', async () => {
  const unauthorised = buildProbe({ me: { status: 401, body: { error: 'Authentication is required.' } } })
  assert.equal((await unauthorised.probe.run('read')).errorCode, 'http_error')
  assert.equal((await unauthorised.probe.run('read')).httpStatus, 401)

  const refused = buildProbe({ me: { status: 403, body: '<html>CSRF verification failed.</html>' } })
  assert.equal((await refused.probe.run('read')).errorCode, 'csrf_rejected')

  const serverError = buildProbe({ me: { status: 500, body: '<html>oops</html>' } })
  assert.equal((await serverError.probe.run('read')).errorCode, 'http_error')
})

test('read does not read a changed answer as a user with no workspaces', async () => {
  const { probe } = buildProbe({ me: { status: 200, body: { authenticated: true, user: { id: 1 } } } })

  const sanitized = assertContractShape(await probe.run('read'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.errorCode, 'unknown')
})

test('read survives a transport failure without echoing it', async () => {
  const { probe } = buildProbe({ me: new Error(`getaddrinfo ENOTFOUND ${SERVER}`) })

  const sanitized = assertContractShape(await probe.run('read'))

  assert.equal(sanitized.errorCode, 'network_error')
  assert.equal(JSON.stringify(sanitized).includes('ENOTFOUND'), false)
})

test('write creates one marked, unassigned task and removes it permanently', async () => {
  const { probe, calls } = buildProbe()

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'ok')
  assert.equal(sanitized.errorCode, null)
  assert.equal(sanitized.httpStatus, 201)
  assert.equal(sanitized.cleanupHttpStatus, 200)
  assert.equal(sanitized.workspaceId, WORKSPACE_ID)
  assert.equal(sanitized.taskCreated, true)
  assert.equal(sanitized.taskDeleted, true)

  const write = calls.find(call => call.method === 'POST')
  assert.equal(write.url, `${SERVER}/api/workspaces/${WORKSPACE_ID}/tasks/`)
  const body = JSON.parse(write.body)
  assert.deepEqual(Object.keys(body), ['title'])
  assert.ok(body.title.startsWith(MARKER_PREFIX), `expected a marked title, got ${body.title}`)

  const remove = calls.find(call => call.method === 'DELETE')
  assert.equal(remove.url, `${SERVER}/api/tasks/${TASK_ID}/?permanent=true`)

  // Exactly one write of each kind: a retry loop would leave rows behind.
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(calls.filter(call => call.method === 'DELETE').length, 1)
})

test('each run carries its own marker, so a leftover row can be found by its title', async () => {
  const first = buildProbe()
  const second = buildProbe()
  await first.probe.run('write')
  await second.probe.run('write')

  const titles = [first, second].map(({ calls }) => {
    const write = calls.find(call => call.method === 'POST')
    const { title } = JSON.parse(write.body)
    assert.ok(title.startsWith(MARKER_PREFIX))
    assert.ok(title.length <= 200)
    return title
  })

  assert.notEqual(titles[0], titles[1])
})

test('write refuses a signed-out session before touching the workspace', async () => {
  const { probe, calls } = buildProbe({ me: { status: 200, body: { authenticated: false } } })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.errorCode, 'not_signed_in')
  assert.equal(calls.some(call => call.method === 'POST'), false)
})

test('write refuses a workspace the user does not own or cannot write in', async () => {
  const cases = [
    ['a member, not an owner', me([{ ...OWNER_WORKSPACE, role: 'member' }])],
    ['an archived workspace', me([{ ...OWNER_WORKSPACE, status: 'archived' }])],
    ['no task permission', me([{ ...OWNER_WORKSPACE, permissions: ['edit_own_tasks'] }])],
    ['a workspace that is not in the list', me([{ ...OWNER_WORKSPACE, id: 99 }])],
    ['no workspaces at all', me([])],
  ]

  for (const [label, meAnswer] of cases) {
    const { probe, calls } = buildProbe({ me: meAnswer })
    const sanitized = assertContractShape(await probe.run('write'))

    assert.equal(sanitized.status, 'failed', label)
    assert.equal(sanitized.errorCode, 'no_workspace', label)
    assert.equal(sanitized.taskCreated, null, label)
    assert.equal(calls.some(call => call.method === 'POST'), false, label)
  }
})

test('a denied permission from the server stops the run and cleans nothing up', async () => {
  const { probe, calls } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    create: () => ({ status: 403, body: { error: 'You do not have permission to assign tasks.' } }),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'failed')
  // A 403 that carries JSON came from the view: the session was fine, the permission
  // was not. Only Django's HTML 403 means the CSRF check failed.
  assert.equal(sanitized.errorCode, 'http_error')
  assert.equal(sanitized.httpStatus, 403)
  assert.equal(sanitized.taskCreated, false)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('a write refused for its CSRF token is reported as such', async () => {
  const { probe, calls } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    create: () => ({ status: 403, body: '<html>CSRF verification failed.</html>' }),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.errorCode, 'csrf_rejected')
  assert.equal(sanitized.httpStatus, 403)
  assert.equal(sanitized.taskCreated, false)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('a session with no CSRF token never writes', async () => {
  const { probe, calls } = buildProbe({ me: me([OWNER_WORKSPACE]), csrfToken: null })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.errorCode, 'csrf_rejected')
  assert.equal(calls.some(call => call.method === 'POST'), false)
})

test('a created task whose id cannot be read is reported, not claimed as deleted', async () => {
  const { probe, calls } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    create: () => ({ status: 201, body: { task: { title: 'no id here' } } }),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.errorCode, 'unknown')
  assert.equal(sanitized.taskCreated, true)
  assert.equal(sanitized.taskDeleted, false)
  assert.equal(calls.some(call => call.method === 'DELETE'), false)
})

test('failed cleanup is reported as a task that still exists', async () => {
  const { probe } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    remove: () => ({ status: 500, body: { error: 'Server error.' } }),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.errorCode, 'http_error')
  assert.equal(sanitized.httpStatus, 201)
  assert.equal(sanitized.cleanupHttpStatus, 500)
  assert.equal(sanitized.taskCreated, true)
  assert.equal(sanitized.taskDeleted, false)
})

test('an archived task is not a deleted task', async () => {
  // What the endpoint answers when `permanent` is missing: 200, and the row is still
  // there. Treating this as success would leave probe rows in the workspace forever.
  const { probe } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    remove: () => ({ status: 200, body: { deleted: TASK_ID, archived: true, task: { id: TASK_ID } } }),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.status, 'failed')
  assert.equal(sanitized.taskDeleted, false)
  assert.equal(sanitized.cleanupHttpStatus, 200)
})

test('a cleanup that never reached the server still reports the created task', async () => {
  const { probe } = buildProbe({
    me: me([OWNER_WORKSPACE]),
    remove: () => new Error('socket hang up'),
  })

  const sanitized = assertContractShape(await probe.run('write'))

  assert.equal(sanitized.errorCode, 'network_error')
  assert.equal(sanitized.taskCreated, true)
  assert.equal(sanitized.taskDeleted, false)
})

test('an unknown action is a caller bug, not a result to render', async () => {
  const { probe } = buildProbe()

  await assert.rejects(probe.run('delete'), TypeError)
  await assert.rejects(probe.run(''), TypeError)
  await assert.rejects(probe.run(undefined), TypeError)
})

test('no credential appears in any result, whichever step fails', async () => {
  const sessionCookie = 'sessionid-secret-value'
  const failures = {
    signedOut: { me: { status: 200, body: { authenticated: false } } },
    denied: { me: me([OWNER_WORKSPACE]), create: () => ({ status: 403, body: { error: 'no' } }) },
    cleanup: { me: me([OWNER_WORKSPACE]), remove: () => ({ status: 500, body: { error: 'no' } }) },
    network: { me: new Error(`boom ${SERVER}`) },
  }

  for (const [label, options] of Object.entries(failures)) {
    for (const action of ['read', 'write']) {
      const { probe } = buildProbe(options)
      const serialised = JSON.stringify(assertContractShape(await probe.run(action)))

      for (const secret of [TEST_CSRF_TOKEN, sessionCookie, '@', 'example.test', 'password']) {
        // "@" would only appear if an address leaked; the server origin only if a URL did.
        assert.equal(serialised.includes(secret), false, `${label}/${action} leaked ${secret}`)
      }
    }
  }
})

test('the probe writes through a real session, and the server sees the CSRF shield', async () => {
  const server = await startFakeWorkspaceServer()
  try {
    const probe = createProbe({
      client: createWorkspaceClient({ session: createHttpSession(), serverUrl: server.origin }),
      workspaceId: WORKSPACE_ID,
      clock: fixedClock(),
    })

    const sanitized = assertContractShape(await probe.run('write'))

    assert.equal(sanitized.status, 'ok')
    assert.equal(sanitized.taskCreated, true)
    assert.equal(sanitized.taskDeleted, true)
    assert.equal(sanitized.workspaceId, WORKSPACE_ID)

    const methods = server.requests.map(request => `${request.method} ${request.path}`)
    // One read, one CSRF mint (the jar starts empty, as on a fresh launch), then the
    // write and its cleanup. The second write sends the cookie it already has.
    assert.deepEqual(methods, [
      'GET /api/auth/me/',
      'GET /api/auth/csrf/',
      `POST /api/workspaces/${WORKSPACE_ID}/tasks/`,
      `DELETE /api/tasks/${TASK_ID}/`,
    ])

    const write = server.requests.find(request => request.method === 'POST')
    // The header matches the cookie the session holds, which is exactly what Django
    // compares, and the forged origin headers are what CsrfViewMiddleware accepts.
    assert.equal(write.headers['x-csrftoken'], server.csrfToken)
    assert.equal(write.headers.origin, server.origin)
    assert.equal(write.headers.referer, `${server.origin}/`)
    assert.equal(write.headers['content-type'], 'application/json')
    assert.ok(write.headers.cookie.includes(`csrftoken=${server.csrfToken}`))
    assert.deepEqual(Object.keys(JSON.parse(write.body)), ['title'])

    const remove = server.requests.find(request => request.method === 'DELETE')
    assert.equal(remove.search, '?permanent=true')
    assert.equal(remove.headers['x-csrftoken'], server.csrfToken)

    // The session cookie value never reaches the result.
    assert.equal(JSON.stringify(sanitized).includes(server.csrfToken), false)
  } finally {
    await server.close()
  }
})

test('a workspace id configured as a string, as the environment supplies it, still writes', async () => {
  const stub = createStubSession({ handler: routed({ me: me([OWNER_WORKSPACE]) }) })
  const warnings = []
  const probe = createWorkspaceProbe({
    session: stub.session,
    serverUrl: SERVER,
    // process.env only ever holds strings, so this is how the real id arrives.
    workspaceId: String(WORKSPACE_ID),
    clock: fixedClock(),
    log: { warn: message => warnings.push(message) },
  })

  const read = assertContractShape(await probe.run('read'))
  assert.equal(read.status, 'ok')
  assert.equal(read.workspaceId, WORKSPACE_ID)

  const write = assertContractShape(await probe.run('write'))
  assert.equal(write.status, 'ok')
  assert.equal(write.errorCode, null)
  assert.equal(write.workspaceId, WORKSPACE_ID)
  assert.equal(write.taskCreated, true)
  assert.equal(write.taskDeleted, true)

  const create = stub.calls.find(call => call.method === 'POST')
  assert.equal(create.url, `${SERVER}/api/workspaces/${WORKSPACE_ID}/tasks/`)
  const remove = stub.calls.find(call => call.method === 'DELETE')
  assert.equal(remove.url, `${SERVER}/api/tasks/${TASK_ID}/?permanent=true`)

  // A valid id is not a configuration problem, so nothing is warned about.
  assert.deepEqual(warnings, [])
})

test('only a whole-number string is accepted as the configured workspace id', async () => {
  for (const value of [' 7 ', '007']) {
    const stub = createStubSession({ handler: routed({ me: me([OWNER_WORKSPACE]) }) })
    const probe = createWorkspaceProbe({
      session: stub.session,
      serverUrl: SERVER,
      workspaceId: value,
      clock: fixedClock(),
      log: { warn () {} },
    })

    assert.equal((await probe.run('read')).workspaceId, WORKSPACE_ID, `accepting ${JSON.stringify(value)}`)
  }

  // Anything that is not a whole number is refused rather than rounded or truncated
  // into a workspace the caller never named.
  for (const value of ['7abc', '0', '-7', '7.5', '0x10', '']) {
    const stub = createStubSession({ handler: routed({ me: me([OWNER_WORKSPACE]) }) })
    const warnings = []
    const probe = createWorkspaceProbe({
      session: stub.session,
      serverUrl: SERVER,
      workspaceId: value,
      clock: fixedClock(),
      log: { warn: message => warnings.push(message) },
    })

    const sanitized = assertContractShape(await probe.run('write'))
    assert.equal(sanitized.status, 'failed', `refusing ${JSON.stringify(value)}`)
    assert.equal(sanitized.errorCode, 'no_workspace', `refusing ${JSON.stringify(value)}`)
    assert.equal(stub.calls.some(call => call.method === 'POST'), false, `refusing ${JSON.stringify(value)}`)
    // The misconfiguration is reported once, without echoing the value itself.
    assert.equal(warnings.length, 1, `refusing ${JSON.stringify(value)}`)
    if (value !== '') assert.equal(warnings[0].includes(value), false)
  }
})

test('the module surface answers not_implemented when no session exists yet', async () => {
  assert.equal(WORKSPACE_PARTITION, 'persist:ws')

  const warnings = []
  const log = { warn: message => warnings.push(message) }

  const missingSession = createWorkspaceProbe({ serverUrl: SERVER, workspaceId: WORKSPACE_ID, log })
  const outcome = await missingSession.run('write')
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.errorCode, 'not_implemented')
  assert.ok(isSanitizedProbeResult(sanitizeProbeResult(outcome)))
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].includes(SERVER), false)

  // A plain-http address for a real host is refused the same way, and still no throw.
  const refusedAddress = createWorkspaceProbe({
    session: { fetch () {}, cookies: { get () {} } },
    serverUrl: 'http://workspace.example.test',
    log,
  })
  assert.equal((await refusedAddress.run('read')).errorCode, 'not_implemented')

  await assert.rejects(missingSession.run('everything'), TypeError)
})
