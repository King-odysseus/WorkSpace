'use strict'

/*
 * The pinned transport, tested against real local sockets.
 *
 * This file exists because of one question: when the guard decides a destination
 * is local, what stops the next DNS answer from pointing somewhere else? The answer
 * has to be a socket, not a promise, so most of these tests stand up real HTTP
 * servers on loopback and check which of them actually receives the bytes.
 *
 * The central test is "a resolver that changes its answer cannot receive the
 * payload": two servers, one at the verified address and one at another loopback
 * address, and a resolver that would answer with the second one if asked twice.
 * Both the count of lookups and the empty request list of the second server are
 * asserted, because either alone could pass by accident.
 *
 * The name `rebind.invalid` is load-bearing. `.invalid` is reserved and never
 * resolves, so a test that reaches a server through it proves the address came from
 * the pin: had the transport asked DNS, the call would have failed with ENOTFOUND
 * rather than connected.
 *
 * TLS is checked through the options a pinned https request is built with, not
 * through a handshake: minting a certificate for a reserved name at test time would
 * need a dependency this project has not approved. What is asserted is the part
 * that would be broken by a careless fix, namely that the verified name is still
 * the name presented, and that certificate verification is never switched off.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')

const api = require('../../../../build/main/ipc.cjs')

const CANARY = 'sk-canary-pinned-transport'
const LOCAL = '127.0.0.1'
const ELSEWHERE = '127.0.0.2'
/** A name no resolver can answer. Reaching a server through it proves the pin worked. */
const UNRESOLVABLE = 'rebind.invalid'

/**
 * A real HTTP server on the given loopback address, recording what it receives.
 *
 * `connections` is counted separately from `requests` on purpose: a test about a
 * call that must not be made needs to see a refused or cancelled connection too, and
 * a request that never finished sending a body would not appear in `requests`.
 */
async function startServer (t, options = {}) {
  const host = options.host ?? LOCAL
  const requests = []
  const connections = []

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(record)
      if (typeof options.onRequest === 'function') options.onRequest(req, res, record)
      else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      }
    })
  })

  server.on('connection', socket => {
    connections.push(socket.remoteAddress ?? '')
  })

  server.listen(0, host)
  await once(server, 'listening')
  const { port } = server.address()

  t.after(async () => {
    // A response body a test deliberately never read would otherwise hold the
    // socket open and stop the run from finishing.
    server.closeAllConnections?.()
    await new Promise(resolve => server.close(resolve))
  })

  return { server, port, requests, connections, origin: `http://${host}:${port}` }
}

/*
 * The URL a test calls. The pinned name, not the address: a URL whose host is an
 * IP literal skips the lookup entirely, which would leave the pin untested.
 */
function urlFor (server, path = '/v1/chat') {
  return `http://${UNRESOLVABLE}:${server.port}${path}`
}

function guardContext (overrides = {}) {
  return {
    businessId: 1,
    providerId: 'ollama',
    userId: 7,
    purpose: 'chat_strategy',
    localOnly: true,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * The address on the socket
 * ------------------------------------------------------------------ */

test('the transport dials the verified address instead of resolving the name', async t => {
  const server = await startServer(t)
  const transport = api.createPinnedTransport()

  const response = await transport(`${urlFor(server)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: CANARY }),
    pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
  })

  assert.equal(response.status, 200)
  assert.equal(response.connectedAddress, LOCAL)
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0].body, JSON.stringify({ message: CANARY }))
  // The name survives for the Host header even though only the address was dialled.
  assert.equal(server.requests[0].headers.host, `${UNRESOLVABLE}:${server.port}`)
})

test('a resolver that changes its answer cannot receive the payload', async t => {
  /*
   * The rebinding this module exists to stop. The guard classifies the name from
   * the first answer, which is local. A transport that resolved again at connect
   * time would land on the second answer and hand it the request.
   */
  const verified = await startServer(t)
  const attacker = await startServer(t, { host: ELSEWHERE })

  const asked = []
  const resolve = async hostname => {
    asked.push(hostname)
    return asked.length === 1 ? [LOCAL] : [ELSEWHERE]
  }

  // No fetchImpl: this is the guard's own shipped transport doing the dialling.
  const guard = api.createEgressGuard({ resolve, audit: api.createAuditSink() })

  const response = await guard.fetch(
    guardContext(),
    `http://${UNRESOLVABLE}:${verified.port}/v1/chat`,
    { method: 'POST', body: CANARY },
  )

  assert.equal(response.status, 200)
  assert.equal(asked.length, 1, 'the host must be resolved exactly once, before the request')
  assert.equal(verified.requests.length, 1)
  assert.equal(verified.requests[0].body, CANARY)
  // The assertion the whole module exists for: the second answer was never dialled.
  assert.equal(attacker.connections.length, 0, 'the second address must never be contacted')
  assert.equal(attacker.requests.length, 0)
})

test('a host verified at several addresses is tried until one answers', async t => {
  const server = await startServer(t)
  const transport = api.createPinnedTransport()

  // 127.0.0.3 is a verified address with nothing listening: the first attempt is
  // refused, and the second must carry the request rather than the call failing.
  const response = await transport(`http://${UNRESOLVABLE}:${server.port}/v1/chat`, {
    pin: { hostname: UNRESOLVABLE, addresses: ['127.0.0.3', LOCAL] },
  })

  assert.equal(response.status, 200)
  assert.equal(response.connectedAddress, LOCAL)
  assert.equal(server.requests.length, 1)
})

test('a guard with no transport installed still builds and uses the pinned one', () => {
  const guard = api.createEgressGuard({ resolve: async () => [LOCAL] })
  assert.equal(typeof guard.fetch, 'function')
})

/* ------------------------------------------------------------------ *
 * The lookup itself
 * ------------------------------------------------------------------ */

test('the pinned lookup answers only for the name that was verified', async () => {
  const options = api.buildPinnedRequestOptions(
    { hostname: UNRESOLVABLE, addresses: [LOCAL] },
    LOCAL,
    { method: 'GET' },
  )
  const lookup = options.lookup

  const answered = await new Promise(resolve => {
    lookup(UNRESOLVABLE, {}, (error, address, family) => resolve({ error, address, family }))
  })
  assert.equal(answered.error, null)
  assert.equal(answered.address, LOCAL)
  assert.equal(answered.family, 4)

  // A lookup asked about any other name refuses, because answering would resolve
  // a name the guard never classified.
  const refused = await new Promise(resolve => {
    lookup('somewhere.else.invalid', {}, error => resolve(error))
  })
  assert.equal(refused.code, 'EPINNEDHOST')

  // Node asks for every address at once in some paths, and the shape has to match.
  const all = await new Promise(resolve => {
    lookup(UNRESOLVABLE, { all: true }, (error, addresses) => resolve({ error, addresses }))
  })
  assert.equal(all.error, null)
  assert.deepEqual(all.addresses, [{ address: LOCAL, family: 4 }])
})

/* ------------------------------------------------------------------ *
 * TLS identity
 * ------------------------------------------------------------------ */

test('a pinned https request keeps the verified name for the certificate', () => {
  const options = api.buildPinnedRequestOptions(
    { hostname: 'api.example.com', addresses: ['93.184.216.34'] },
    '93.184.216.34',
    { method: 'POST' },
  )

  // The name, not the address: a certificate for api.example.com must still be the
  // one that has to be presented, or pinning would quietly disable verification.
  assert.equal(options.servername, 'api.example.com')
  assert.equal(options.rejectUnauthorized, undefined)
  assert.equal(typeof options.lookup, 'function')
  assert.equal(options.method, 'POST')
})

test('an IPv6 destination presents no server name and still dials the address', () => {
  const options = api.buildPinnedRequestOptions(
    { hostname: '[::1]', addresses: ['::1'] },
    '::1',
    { method: 'GET' },
  )
  // SNI forbids an address literal, so none is presented. The certificate check
  // still runs against the host the URL named.
  assert.equal(options.servername, undefined)
  assert.equal(typeof options.lookup, 'function')
})

/* ------------------------------------------------------------------ *
 * What the transport will not do
 * ------------------------------------------------------------------ */

test('a redirect is handed back, never followed', async t => {
  const attacker = await startServer(t, { host: ELSEWHERE })
  const verified = await startServer(t, {
    onRequest: (req, res) => {
      // A provider asking the app to continue somewhere else. The guard follows
      // hops itself, so the transport must stop here.
      res.writeHead(302, { location: `${attacker.origin}/steal` })
      res.end()
    },
  })
  const transport = api.createPinnedTransport()

  const response = await transport(`http://${UNRESOLVABLE}:${verified.port}/v1/chat`, {
    method: 'POST',
    body: CANARY,
    pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
  })

  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `${attacker.origin}/steal`)
  assert.equal(attacker.connections.length, 0)
})

test('a pin with no verified address is refused before anything is dialled', async () => {
  const transport = api.createPinnedTransport()

  await assert.rejects(
    transport(`http://${UNRESOLVABLE}:1/v1/chat`, {
      pin: { hostname: UNRESOLVABLE, addresses: [] },
    }),
    error => error.code === 'EPINNOPIN',
  )
})

test('a body that is neither text nor bytes is refused', async () => {
  const transport = api.createPinnedTransport()

  await assert.rejects(
    transport(`http://${UNRESOLVABLE}:1/v1/chat`, {
      method: 'POST',
      // A plain object would be sent as "[object Object]", which the provider would
      // report much later as a malformed request.
      body: { message: CANARY },
      pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
    }),
    TypeError,
  )
})

/* ------------------------------------------------------------------ *
 * Failure and cancellation
 * ------------------------------------------------------------------ */

test('a connection failure carries a code and no address', async () => {
  const transport = api.createPinnedTransport()

  await assert.rejects(
    transport(`http://${UNRESOLVABLE}:1/v1/chat`, {
      pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
    }),
    error => {
      assert.equal(typeof error.code, 'string')
      // The rebuilt message is what makes this safe to surface to a page.
      assert.equal(String(error.message).includes(LOCAL), false)
      assert.equal(String(error.message).includes(UNRESOLVABLE), false)
      return true
    },
  )
})

test('a call cancelled before it starts sends nothing', async t => {
  const server = await startServer(t)
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    api.createPinnedTransport()(`${urlFor(server)}`, {
      signal: controller.signal,
      pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
    }),
    error => error.name === 'AbortError',
  )

  assert.equal(server.connections.length, 0)
})

test('a cancellation mid-flight ends the call as a cancellation', async t => {
  // A provider that accepts the connection and then says nothing at all.
  const server = await startServer(t, { onRequest: () => {} })
  const controller = new AbortController()
  const pending = api.createPinnedTransport()(`${urlFor(server)}`, {
    signal: controller.signal,
    pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
  })

  setTimeout(() => controller.abort(), 50)

  await assert.rejects(pending, error => {
    assert.equal(error.name, 'AbortError')
    assert.equal(String(error.message).includes(LOCAL), false)
    return true
  })
})

/* ------------------------------------------------------------------ *
 * Bounded reads
 * ------------------------------------------------------------------ */

test('a response larger than the cap is refused rather than buffered', async t => {
  const server = await startServer(t, {
    onRequest: (req, res) => {
      res.writeHead(200)
      res.end('x'.repeat(4096))
    },
  })

  const response = await api.createPinnedTransport({ maxResponseBytes: 1024 })(
    `${urlFor(server)}`,
    { pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] } },
  )

  await assert.rejects(response.text(), error => error.code === 'RESPONSE_TOO_LARGE')
})

test('a body below the cap is read once and answers both text and json', async t => {
  const server = await startServer(t)
  const response = await api.createPinnedTransport()(`${urlFor(server)}`, {
    pin: { hostname: UNRESOLVABLE, addresses: [LOCAL] },
  })

  assert.deepEqual(await response.json(), { ok: true })
  // The stream can only be read once, so a second read must answer from the cache
  // rather than hanging or throwing.
  assert.equal(await response.text(), '{"ok":true}')
})

/* ------------------------------------------------------------------ *
 * The resolver the guard is given in production
 * ------------------------------------------------------------------ */

test('the resolver answers with every address and refuses an empty answer', async () => {
  const resolve = api.createDnsResolver({
    resolve: async () => [{ address: LOCAL }, { address: '::1' }],
  })
  assert.deepEqual(await resolve('anything.invalid'), [LOCAL, '::1'])

  // An empty answer is a failure rather than "no cloud addresses here", which a
  // caller could read as a local host.
  await assert.rejects(
    api.createDnsResolver({ resolve: async () => [] })('gone.invalid'),
    error => error.code === 'ENOTFOUND',
  )
})
