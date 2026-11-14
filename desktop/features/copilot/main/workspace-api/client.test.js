'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  MAX_BODY_BYTES,
  WorkspaceApiError,
  createWorkspaceClient,
  resolveServerUrl,
} = require('./client.js')
const { TEST_CSRF_TOKEN, createStubSession, encode } = require('./fixtures/fake-session.js')

const SERVER = 'https://workspace.example.test'

function buildClient (options = {}) {
  const stub = createStubSession(options)
  const client = createWorkspaceClient({ session: stub.session, serverUrl: options.serverUrl || SERVER })
  return { client, calls: stub.calls }
}

function isWorkspaceApiError (code) {
  return error => {
    assert.ok(error instanceof WorkspaceApiError, `expected a WorkspaceApiError, got ${error && error.name}`)
    assert.equal(error.code, code)
    // The message is the code and nothing else: no URL, no request, no token.
    assert.equal(error.message, code)
    return true
  }
}

test('a session without fetch or a cookie jar is refused, not worked around', () => {
  assert.throws(() => createWorkspaceClient({ session: null, serverUrl: SERVER }), TypeError)
  assert.throws(() => createWorkspaceClient({ session: {}, serverUrl: SERVER }), TypeError)
  assert.throws(() => createWorkspaceClient({ session: { fetch () {} }, serverUrl: SERVER }), TypeError)
  assert.throws(() => createWorkspaceClient({ session: { fetch () {}, cookies: {} }, serverUrl: SERVER }), TypeError)
})

test('the server address must be one the session cookies may travel to', () => {
  assert.equal(resolveServerUrl('https://workspace.example.test/').origin, 'https://workspace.example.test')
  assert.equal(resolveServerUrl('https://workspace.example.test').origin, 'https://workspace.example.test')
  // The local Django server is the one plain-http case the spike needs.
  assert.equal(resolveServerUrl('http://127.0.0.1:8099/').origin, 'http://127.0.0.1:8099')
  assert.equal(resolveServerUrl('http://localhost:5183').origin, 'http://localhost:5183')

  const refused = [
    '',
    'not a url',
    'ftp://workspace.example.test',
    'file:///etc/passwd',
    // Cookies must never be handed to a real host over clear text.
    'http://workspace.example.test',
    // An address with credentials would put a secret in the request line.
    'https://user:secret@workspace.example.test',
  ]
  for (const value of refused) {
    assert.throws(() => resolveServerUrl(value), TypeError, `expected ${value} to be refused`)
  }
})

test('the read sends no token and no body', async () => {
  const { client, calls } = buildClient({ handler: () => ({ status: 200, body: { authenticated: true } }) })

  const answer = await client.getMe()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'GET')
  assert.equal(calls[0].url, 'https://workspace.example.test/api/auth/me/')
  assert.equal(calls[0].body, null)
  assert.equal(calls[0].headers[CSRF_HEADER_NAME], undefined)
  assert.equal(calls[0].headers.Accept, 'application/json')
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.payload, { authenticated: true })
})

test('the token comes from the shared cookie jar, and is minted only when absent', async () => {
  const present = buildClient({ handler: () => ({ status: 200, body: { status: 'ok' } }) })
  assert.equal(await present.client.ensureCsrfToken(), TEST_CSRF_TOKEN)
  // A signed-in session already holds one, so no extra round trip is made.
  assert.equal(present.calls.length, 0)

  const empty = buildClient({
    csrfToken: null,
    handler: () => ({ status: 200, body: { status: 'ok' }, setCookie: { csrftoken: 'minted-token' } }),
  })
  assert.equal(await empty.client.ensureCsrfToken(), 'minted-token')
  assert.equal(empty.calls.length, 1)
  assert.equal(empty.calls[0].url, 'https://workspace.example.test/api/auth/csrf/')
})

test('a jar with no token reports none instead of inventing one', async () => {
  const { client } = buildClient({ csrfToken: null, handler: () => ({ status: 200, body: { status: 'ok' } }) })

  assert.equal(await client.ensureCsrfToken(), null)
  assert.equal(CSRF_COOKIE_NAME, 'csrftoken')
})

test('a write carries the four headers Django checks and a title-only body', async () => {
  const { client, calls } = buildClient({ handler: () => ({ status: 201, body: { task: { id: 5 } } }) })

  const answer = await client.createTask(7, { title: '  Probe task marker  ' })

  assert.deepEqual(calls.map(call => call.method), ['POST'])
  const write = calls[0]
  assert.equal(write.url, 'https://workspace.example.test/api/workspaces/7/tasks/')
  assert.equal(write.headers['Content-Type'], 'application/json')
  assert.equal(write.headers[CSRF_HEADER_NAME], TEST_CSRF_TOKEN)
  assert.equal(write.headers.Origin, 'https://workspace.example.test')
  assert.equal(write.headers.Referer, 'https://workspace.example.test/')

  // Only the title, which is what keeps the created task unassigned and unowned.
  assert.deepEqual(JSON.parse(write.body), { title: 'Probe task marker' })

  // The request holds the token; the value handed back to the caller does not.
  assert.equal(answer.status, 201)
  assert.equal(JSON.stringify(answer).includes(TEST_CSRF_TOKEN), false)
})

test('a write without a token is refused before anything is sent', async () => {
  const { client, calls } = buildClient({ csrfToken: null, handler: () => ({ status: 200, body: {} }) })

  await assert.rejects(client.createTask(7, { title: 'Probe task marker' }), isWorkspaceApiError('csrf_rejected'))
  await assert.rejects(client.deleteTaskPermanently(5), isWorkspaceApiError('csrf_rejected'))

  assert.equal(calls.filter(call => call.method !== 'GET').length, 0)
})

test('cleanup asks for a permanent delete and never an archive', async () => {
  const { client, calls } = buildClient({ handler: () => ({ status: 200, body: { deleted: 5, permanent: true } }) })

  const answer = await client.deleteTaskPermanently(5)

  const remove = calls[0]
  assert.equal(remove.method, 'DELETE')
  assert.equal(remove.url, 'https://workspace.example.test/api/tasks/5/?permanent=true')
  assert.equal(remove.headers[CSRF_HEADER_NAME], TEST_CSRF_TOKEN)
  assert.equal(remove.body, null)
  assert.deepEqual(answer.payload, { deleted: 5, permanent: true })
})

test('a transport failure becomes a code, and the thrown error keeps nothing else', async () => {
  const { client } = buildClient({
    handler: () => new Error(`connect ECONNREFUSED ${SERVER}/api/auth/me/`),
  })

  await assert.rejects(client.getMe(), error => {
    isWorkspaceApiError('network_error')(error)
    const serialised = JSON.stringify(error)
    assert.equal(serialised.includes('ECONNREFUSED'), false)
    assert.equal(serialised.includes('api/auth/me'), false)
    return true
  })
})

test('an answer that is not JSON is reported as no payload, not as a crash', async () => {
  const { client } = buildClient({ handler: () => ({ status: 500, body: '<html>server error</html>' }) })

  assert.deepEqual(await client.getMe(), { status: 500, payload: null })
})

test('an oversized chunked answer is cancelled mid-stream, not buffered', async () => {
  const CHUNK_SIZE = 64 * 1024
  const CHUNK_COUNT = 40
  let produced = 0
  let cancelled = false
  // Valid JSON in every chunk, so only the size limit can reject this answer. The body is
  // pulled on demand: if the client drained it, `produced` would reach CHUNK_COUNT.
  const bodyStream = new ReadableStream({
    pull (controller) {
      if (produced >= CHUNK_COUNT) {
        controller.close()
        return
      }
      produced += 1
      const padding = 'x'.repeat(CHUNK_SIZE - '{"padding":""}'.length)
      controller.enqueue(encode(`{"padding":"${padding}"}`))
    },
    cancel () { cancelled = true },
  })

  const stub = createStubSession({ handler: () => ({ status: 200, bodyStream }) })
  const client = createWorkspaceClient({ session: stub.session, serverUrl: SERVER })

  const answer = await client.getMe()

  // Too big to trust is the same as unreadable: no payload, not a crash.
  assert.deepEqual(answer, { status: 200, payload: null })
  assert.equal(cancelled, true, 'the oversized body must be cancelled so the socket is released')
  assert.ok(produced < CHUNK_COUNT, `read ${produced} of ${CHUNK_COUNT} chunks`)
  // At most the chunk that crossed the limit plus the one chunk the stream prefetches.
  assert.ok(
    produced <= Math.ceil(MAX_BODY_BYTES / CHUNK_SIZE) + 2,
    `read ${produced} chunks, more than the limit allows`,
  )
})

test('a response with no readable stream is not read whole', async () => {
  // Guard against a quiet return to `response.text()`, which buffers an untrusted body
  // before any size check can run.
  let textCalled = false
  const session = {
    async fetch () {
      return {
        status: 200,
        text: async () => {
          textCalled = true
          return JSON.stringify({ authenticated: true })
        },
      }
    },
    cookies: {
      async get () {
        return [{ name: CSRF_COOKIE_NAME, value: TEST_CSRF_TOKEN }]
      },
    },
  }
  const client = createWorkspaceClient({ session, serverUrl: SERVER })

  assert.deepEqual(await client.getMe(), { status: 200, payload: null })
  assert.equal(textCalled, false)
})

test('a request with an unusable id or title is a caller bug, raised before any network call', async () => {
  const { client, calls } = buildClient({ handler: () => ({ status: 201, body: { task: { id: 5 } } }) })

  for (const bad of [0, -1, 1.5, 'seven', null, undefined, true]) {
    await assert.rejects(client.createTask(bad, { title: 'Probe task marker' }), TypeError)
    await assert.rejects(client.deleteTaskPermanently(bad), TypeError)
  }
  await assert.rejects(client.createTask(7, {}), TypeError)
  await assert.rejects(client.createTask(7, { title: '   ' }), TypeError)

  assert.equal(calls.length, 0)
})
