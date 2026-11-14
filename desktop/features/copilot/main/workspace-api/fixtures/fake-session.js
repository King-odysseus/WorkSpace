'use strict'

/*
 * Test doubles for the workspace client and probe. Not part of the app: the files
 * here are only loaded by the *.test.js files next to them.
 *
 * Two kinds of double, because the two kinds of check need different things:
 *
 * - `createStubSession` answers from a scripted handler, which is how a signed-out
 *   response, a 403, a 500 or a network failure is produced exactly.
 * - `startFakeWorkspaceServer` plus `createHttpSession` is a real HTTP server with a
 *   real cookie jar, which is the only way to show that the CSRF header, Origin and
 *   Referer arrive, and that the request carries a session cookie at all.
 */

const http = require('node:http')

const TEST_CSRF_TOKEN = 'test-csrf-token-8f3a9c'
const TEST_SESSION_COOKIE = 'test-session-cookie-do-not-log'

/**
 * A body delivered the way fetch delivers one: a byte stream, not a string. The client
 * reads that stream with a running size limit, so a double that only offered `text()`
 * would test a path the real app never takes.
 */
function streamFromChunks (chunks) {
  return new ReadableStream({
    start (controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function encode (text) {
  return new TextEncoder().encode(text)
}

function jsonResponse (status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { status, body: streamFromChunks([encode(text)]) }
}

/**
 * A session with no network. `handler` receives the recorded call and returns either
 * `{ status, body }` or throws, which is how a transport failure is simulated.
 * `csrfToken` seeds the cookie jar; pass null for a jar without a token. An answer may
 * carry `setCookie: { name: value }` to change the jar, which is how a minted token is
 * modelled without a server. An answer may instead carry `bodyStream`, a ReadableStream,
 * to model a slow, chunked or oversized body that a plain string cannot describe.
 */
function createStubSession ({ handler, csrfToken = TEST_CSRF_TOKEN }) {
  const calls = []
  const jar = new Map()
  if (csrfToken) jar.set('csrftoken', csrfToken)

  const session = {
    async fetch (url, init = {}) {
      const call = {
        url,
        method: (init.method || 'GET').toUpperCase(),
        headers: { ...(init.headers || {}) },
        body: init.body === undefined ? null : init.body,
      }
      calls.push(call)
      const answer = await handler(call)
      if (answer instanceof Error) throw answer
      if (!answer) throw new Error('stub handler returned nothing')
      if (answer.setCookie && typeof answer.setCookie === 'object') {
        for (const [name, value] of Object.entries(answer.setCookie)) jar.set(name, value)
      }
      if (answer.bodyStream) return { status: answer.status, body: answer.bodyStream }
      return jsonResponse(answer.status, answer.body === undefined ? '' : answer.body)
    },
    cookies: {
      async get (filter = {}) {
        const name = filter.name || 'csrftoken'
        return jar.has(name) ? [{ name, value: jar.get(name), domain: 'localhost', path: '/' }] : []
      },
    },
  }

  return { session, calls }
}

function parseCookieHeader (header) {
  const jar = new Map()
  if (typeof header !== 'string') return jar
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }
  return jar
}

/** A session backed by node:http with its own cookie jar, so Set-Cookie round-trips. */
function createHttpSession () {
  const jar = new Map()

  const session = {
    async fetch (url, init = {}) {
      const target = new URL(url)
      const cookieHeader = [...jar].map(([name, value]) => `${name}=${value}`).join('; ')
      const headers = { ...(init.headers || {}) }
      if (cookieHeader) headers.Cookie = cookieHeader

      return new Promise((resolve, reject) => {
        const request = http.request(
          {
            hostname: target.hostname,
            port: target.port,
            path: `${target.pathname}${target.search}`,
            method: (init.method || 'GET').toUpperCase(),
            headers,
          },
          response => {
            for (const raw of response.headers['set-cookie'] || []) {
              const [pair] = raw.split(';')
              const index = pair.indexOf('=')
              if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
            }
            // Hand the client a real stream, so the size limit is exercised against a
            // body that arrives in pieces rather than one that is already in memory.
            let settled = false
            const stream = new ReadableStream({
              start (controller) {
                const finish = error => {
                  if (settled) return
                  settled = true
                  try {
                    if (error) controller.error(error)
                    else controller.close()
                  } catch {
                    // The client already abandoned the body.
                  }
                }
                response.on('data', chunk => {
                  if (settled) return
                  try {
                    controller.enqueue(new Uint8Array(chunk))
                  } catch {
                    finish()
                  }
                })
                response.on('end', () => finish())
                response.on('error', error => finish(error))
                response.on('aborted', () => finish(new Error('response aborted')))
              },
              cancel () {
                settled = true
                response.destroy()
              },
            })
            resolve({ status: response.statusCode, body: stream })
          },
        )
        request.on('error', reject)
        // The signal the client passes is for Electron; a local server answers too
        // fast to need one, and node:http does not accept it directly.
        if (init.body) request.write(init.body)
        request.end()
      })
    },
    cookies: {
      async get (filter = {}) {
        const name = filter.name || 'csrftoken'
        return jar.has(name) ? [{ name, value: jar.get(name), path: '/' }] : []
      },
    },
  }

  return session
}

const DEFAULT_ME = {
  status: 200,
  body: {
    authenticated: true,
    user: {
      id: 1,
      first_name: 'Probe',
      workspaces: [
        {
          id: 7,
          name: 'Isolated probe workspace',
          role: 'owner',
          status: 'active',
          permissions: ['create_tasks', 'edit_team_tasks', 'assign_tasks'],
        },
      ],
    },
  },
}

/** Django's CSRF refusal: a 403 before the view runs, with an HTML body. */
const CSRF_REFUSAL = { status: 403, body: '<html><body>CSRF verification failed.</body></html>' }

/**
 * A real server that behaves like the endpoints the probe calls, including the CSRF
 * check, so a missing or mismatched token fails the way Django fails it.
 */
async function startFakeWorkspaceServer (options = {}) {
  const requests = []
  const csrfToken = options.csrfToken || TEST_CSRF_TOKEN
  const taskId = options.taskId || 4242
  const me = options.me || DEFAULT_ME
  const create = options.create || null
  const remove = options.remove || null

  function send (response, answer) {
    const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body === undefined ? {} : answer.body)
    response.writeHead(answer.status, {
      'Content-Type': typeof answer.body === 'string' ? 'text/html; charset=utf-8' : 'application/json',
      'Content-Length': Buffer.byteLength(body),
    })
    response.end(body)
  }

  function csrfAccepted (request) {
    const jar = parseCookieHeader(request.headers.cookie)
    const token = jar.get('csrftoken')
    if (!token || token !== request.headers['x-csrftoken']) return false
    const origin = request.headers.origin
    const referer = request.headers.referer
    return origin === `http://127.0.0.1:${server.address().port}` || typeof referer === 'string'
  }

  const server = http.createServer((request, response) => {
    let raw = ''
    request.on('data', chunk => { raw += chunk })
    request.on('end', () => {
      const target = new URL(request.url, 'http://127.0.0.1')
      const record = {
        method: request.method,
        path: target.pathname,
        search: target.search,
        headers: { ...request.headers },
        body: raw,
      }
      requests.push(record)

      if (target.pathname === '/api/auth/csrf/' && request.method === 'GET') {
        response.setHeader('Set-Cookie', `csrftoken=${csrfToken}; Path=/; SameSite=Lax`)
        return send(response, { status: 200, body: { status: 'ok' } })
      }

      if (target.pathname === '/api/auth/me/' && request.method === 'GET') {
        return send(response, me)
      }

      const createMatch = target.pathname.match(/^\/api\/workspaces\/(\d+)\/tasks\/$/)
      if (createMatch && request.method === 'POST') {
        if (!csrfAccepted(request)) return send(response, CSRF_REFUSAL)
        if (create) return send(response, create(record))
        const payload = raw ? JSON.parse(raw) : {}
        return send(response, { status: 201, body: { task: { id: taskId, title: payload.title, assignee: null } } })
      }

      const deleteMatch = target.pathname.match(/^\/api\/tasks\/(\d+)\/$/)
      if (deleteMatch && request.method === 'DELETE') {
        if (!csrfAccepted(request)) return send(response, CSRF_REFUSAL)
        if (remove) {
          const answer = remove(record)
          return send(response, answer === 'archived'
            ? { status: 200, body: { deleted: Number(deleteMatch[1]), archived: true, task: { id: Number(deleteMatch[1]) } } }
            : answer)
        }
        // Exactly what the real endpoint answers for `?permanent=true`.
        return send(response, { status: 200, body: { deleted: Number(deleteMatch[1]), permanent: true } })
      }

      send(response, { status: 404, body: { error: 'Not found.' } })
    })
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`

  return {
    origin,
    requests,
    csrfToken,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

module.exports = {
  CSRF_REFUSAL,
  DEFAULT_ME,
  TEST_CSRF_TOKEN,
  TEST_SESSION_COOKIE,
  createHttpSession,
  createStubSession,
  encode,
  jsonResponse,
  streamFromChunks,
  parseCookieHeader,
  startFakeWorkspaceServer,
}
