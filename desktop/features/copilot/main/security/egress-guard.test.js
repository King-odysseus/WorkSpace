'use strict'

/*
 * The egress guard, tested through the bundle Electron loads.
 *
 * This is the module that decides whether bytes may leave the machine, so the
 * tests are written around the moments where a wrong answer is unrecoverable:
 *
 * - A local-only business sending to a cloud host. The assertion is not only that
 *   it threw, but that the transport was never called, because a guard that sent
 *   the request and then changed its mind has already leaked the payload.
 * - A redirect. Every hop is classified again, and a hop that is not the same
 *   origin must not carry the Authorization header.
 * - A host that resolves to both kinds of address. It is cloud, because taking
 *   the friendlier answer is how a stray record becomes an egress.
 * - A host that rebinds between the check and the connect. Without a pinned
 *   socket the guard cannot prevent the connection, so it discards the answer, and
 *   that is what is asserted.
 *
 * The resolver is injected throughout: a test that dialled real DNS would be
 * testing the resolver, and the guard's job is to classify what it is told.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const api = require('../../../../build/main/ipc.cjs')

const CANARY = 'sk-canary-4d8e2f'
const CLOUD_IP = '93.184.216.34'
const LOCAL_IP = '127.0.0.1'

/** A context for a business that must never reach the cloud. */
function context (overrides = {}) {
  return {
    businessId: 1,
    providerId: 'openai-compatible:deepseek',
    userId: 7,
    purpose: 'chat_strategy',
    localOnly: true,
    ...overrides,
  }
}

/** A response shaped the way the guard reads one. */
function response (options = {}) {
  const status = options.status ?? 200
  const headers = options.headers ?? {}
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[String(name).toLowerCase()] ?? null },
    text: async () => options.text ?? '{}',
    json: async () => JSON.parse(options.text ?? '{}'),
    url: options.url ?? '',
    // Only present when a test is about what the transport says it reached.
    connectedAddress: options.connectedAddress,
  }
}

/** A transport that records every call and answers with a queue of responses. */
function fakeFetch (queue = []) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (next instanceof Error) throw next
    return next !== undefined ? next : response()
  }
  return { calls, fetchImpl }
}

/** A resolver that answers from a table, and counts how often it was asked. */
function fakeResolver (table) {
  const asked = []
  const resolve = async hostname => {
    asked.push(hostname)
    const answer = table[hostname]
    if (answer === undefined) throw new Error('no such host')
    return Array.isArray(answer) ? answer : [answer]
  }
  return { asked, resolve }
}

function build ({ fetchImpl, resolve, maxRedirects } = {}) {
  const audit = api.createAuditSink()
  const guard = api.createEgressGuard({
    fetchImpl: fetchImpl ?? fakeFetch().fetchImpl,
    resolve: resolve ?? fakeResolver({}).resolve,
    audit,
    maxRedirects,
  })
  return { guard, audit }
}

/* ------------------------------------------------------------------ *
 * Local-only enforcement
 * ------------------------------------------------------------------ */

test('a cloud destination is blocked under a local-only policy before anything is sent', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'https://api.deepseek.com/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )

  // The point of the test: no transport call happened at all.
  assert.equal(transport.calls.length, 0)

  const [record] = audit.entries()
  assert.equal(record.outcome, 'blocked')
  assert.equal(record.reason, 'local_only')
  assert.equal(record.cloud, true)
  assert.equal(record.target.host, 'api.deepseek.com')
})

test('the same call is allowed when the business is not local only', async () => {
  const transport = fakeFetch([response({ status: 200 })])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  const answer = await guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat')

  assert.equal(answer.status, 200)
  assert.equal(transport.calls.length, 1)
  const [record] = audit.entries()
  assert.equal(record.outcome, 'allowed')
  assert.equal(record.cloud, true)
  assert.equal(record.status, 200)
})

test('a local destination is allowed under a local-only policy', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await guard.fetch(context(), 'http://localhost:11434/api/chat')
  assert.equal(transport.calls.length, 1)
})

test('a host with one cloud address counts as cloud, not local', async () => {
  const transport = fakeFetch([response()])
  // A stray public record next to a loopback one is the case a friendlier rule
  // would let through.
  const resolver = fakeResolver({ 'mixed.example': [LOCAL_IP, CLOUD_IP] })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'http://mixed.example/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )
  assert.equal(transport.calls.length, 0)
})

test('an unclassifiable address is refused rather than assumed local', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({ 'weird.example': 'not-an-address' })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'http://weird.example/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'invalid_target',
  )
  assert.equal(transport.calls.length, 0)
})

test('IPv4 and IPv6 loc al ranges are recognised without asking a resolver', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({})
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  for (const host of ['127.0.0.1', '10.1.2.3', '192.168.1.10', '169.254.1.1', '172.16.0.5']) {
    await guard.fetch(context(), `http://${host}:8080/v1/chat`)
  }
  for (const host of ['[::1]', '[fe80::1]', '[fd00::1]']) {
    await guard.fetch(context(), `http://${host}:8080/v1/chat`)
  }

  assert.equal(transport.calls.length, 8)
  // An IP literal is its own answer, so the resolver is never consulted.
  assert.deepEqual(resolver.asked, [])
})

test('a public IP literal is cloud and is blocked for a local-only business', async () => {
  const transport = fakeFetch([response()])
  const { guard } = build({ fetchImpl: transport.fetchImpl })

  await assert.rejects(
    guard.fetch(context(), 'http://8.8.8.8/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )
  assert.equal(transport.calls.length, 0)
})

test('a scheme that is not http or https is refused before a resolver is touched', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({})
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'file:///C:/Windows/System32/config/SAM'),
    error => error instanceof api.EgressBlockedError && error.reason === 'unsafe_scheme',
  )
  assert.equal(transport.calls.length, 0)
  assert.equal(audit.entries()[0].reason, 'unsafe_scheme')
})

/* ------------------------------------------------------------------ *
 * Redirects
 * ------------------------------------------------------------------ */

test('a redirect to a cloud host is re-classified and blocked at that hop', async () => {
  const transport = fakeFetch([
    response({ status: 302, headers: { location: 'https://api.deepseek.com/v1/chat' } }),
    response(),
  ])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP, 'api.deepseek.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'http://localhost:11434/api/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )

  // Only the first hop was requested; the cloud hop never was.
  assert.equal(transport.calls.length, 1)
  const records = audit.entries()
  assert.equal(records[records.length - 1].reason, 'local_only')
})

/* ------------------------------------------------------------------ *
 * Unredacted text
 * ------------------------------------------------------------------ */

/*
 * The privacy rules rewrite a conversation for a cloud model and leave the person's
 * own words untouched for a local one, so "the endpoint looked local" is the whole
 * reason an unredacted body is safe to send. The decision is made once, from the
 * base address, before any request goes out. These tests are about what happens when
 * the endpoint changes its mind afterwards, which is the one moment the decision can
 * turn out to be wrong.
 */
const UNREDACTED = Object.freeze({ localOnly: false, unredactedContent: true })

test('a local endpoint cannot redirect unredacted text to a cloud host', async () => {
  /*
   * A 307 and a 308 both keep the method and the body, so both ask the transport to
   * re-send the person's own words to whatever address the redirect names. That is
   * exactly the shape that used to get through: the business was not local-only, so
   * the only rule that could have stopped it was the one about the text itself.
   */
  for (const status of [307, 308]) {
    const transport = fakeFetch([
      response({ status, headers: { location: 'https://api.deepseek.com/v1/chat' } }),
      response(),
    ])
    const resolver = fakeResolver({ 'localhost': LOCAL_IP, 'api.deepseek.com': CLOUD_IP })
    const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

    await assert.rejects(
      guard.fetch(
        context(UNREDACTED),
        'http://localhost:11434/api/chat',
        { method: 'POST', body: { messages: [{ role: 'user', content: 'the Tilley quote' }] } },
      ),
      error => error instanceof api.EgressBlockedError && error.reason === 'unredacted_content',
      `status ${status}`,
    )

    // The assertion that matters: the body never reached the cloud hop at all.
    assert.equal(transport.calls.length, 1, `status ${status} made more than one call`)
    assert.equal(transport.calls[0].url, 'http://localhost:11434/api/chat')

    const record = audit.entries()[audit.entries().length - 1]
    assert.equal(record.outcome, 'blocked')
    assert.equal(record.reason, 'unredacted_content')
    assert.equal(record.cloud, true)
  }
})

test('redacted text still follows a redirect, because that is an ordinary cloud turn', async () => {
  /*
   * The rule must not become "a redirect is always refused". A cloud turn whose text
   * was rewritten is ordinary traffic, and a provider that moved its endpoint should
   * still answer.
   */
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://api.deepseek.com/v1/chat' } }),
    response({ status: 200 }),
  ])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP, 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  const answer = await guard.fetch(
    context({ localOnly: false, unredactedContent: false }),
    'http://localhost:11434/api/chat',
    { method: 'POST', body: { messages: [] } },
  )

  assert.equal(answer.status, 200)
  assert.equal(transport.calls.length, 2)
})

test('unredacted text that stays on the local machine is allowed', async () => {
  // The ordinary case: a local model answering a local model's question.
  const transport = fakeFetch([response({ status: 200 })])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  const answer = await guard.fetch(context(UNREDACTED), 'http://localhost:11434/api/chat', {
    method: 'POST',
    body: { messages: [{ role: 'user', content: 'the Tilley quote' }] },
  })

  assert.equal(answer.status, 200)
  assert.equal(transport.calls.length, 1)
})

test('a local-only business keeps its own reason, so the audit line says which rule fired', async () => {
  /*
   * Both rules can demand the same thing, and they mean different things. Reporting
   * the content rule for a local-only business would point a reader at the wrong
   * cause: nothing was wrong with the text, the business simply may not use a cloud
   * model.
   */
  const transport = fakeFetch([response()])
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl })

  await assert.rejects(
    guard.fetch(context({ localOnly: true, unredactedContent: true }), 'http://8.8.8.8/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )
  assert.equal(transport.calls.length, 0)
  assert.equal(audit.entries()[0].reason, 'local_only')
})

test('an answer that came from an address the guard did not verify is discarded', async () => {
  /*
   * The backstop, for a transport that ignored the pin and still says where it
   * connected. An unredacted request answered from a public address is a leak even
   * though the status was 200, so the answer is thrown away rather than returned.
   */
  const transport = fakeFetch([response({ status: 200, connectedAddress: CLOUD_IP })])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(UNREDACTED), 'http://localhost:11434/api/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'unredacted_content',
  )
  assert.equal(audit.entries()[0].reason, 'unredacted_content')
})

test('a cross-origin redirect carrying credentials is refused', async () => {
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://collector.example/steal' } }),
    response(),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP, 'collector.example': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(
      context({ localOnly: false }),
      'https://api.deepseek.com/v1/chat',
      { headers: { Authorization: `Bearer ${CANARY}` } },
    ),
    error => error instanceof api.EgressBlockedError && error.reason === 'cross_origin_redirect',
  )

  // The assertion that matters: the key was never offered to the other origin.
  assert.equal(transport.calls.length, 1)
  assert.equal(JSON.stringify(transport.calls).includes('collector.example'), false)
})

test('a same-origin redirect is followed and keeps its credentials', async () => {
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://api.deepseek.com/v1/chat/final' } }),
    response({ status: 200 }),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  const answer = await guard.fetch(
    context({ localOnly: false }),
    'https://api.deepseek.com/v1/chat',
    { headers: { Authorization: `Bearer ${CANARY}` } },
  )

  assert.equal(answer.status, 200)
  assert.equal(transport.calls.length, 2)
  assert.equal(transport.calls[1].url, 'https://api.deepseek.com/v1/chat/final')
  assert.equal(transport.calls[1].init.headers.authorization, `Bearer ${CANARY}`)
})

test('an http to https upgrade on the same host may keep its credentials', () => {
  const from = new URL('http://api.deepseek.com/v1/chat')
  const to = new URL('https://api.deepseek.com/v1/chat')
  const elsewhere = new URL('https://collector.example/steal')

  assert.equal(api.egressMayCarryCredentials(from, to), true)
  assert.equal(api.egressMayCarryCredentials(from, elsewhere), false)
  // The same host on a different port is a different origin.
  assert.equal(api.egressMayCarryCredentials(from, new URL('http://api.deepseek.com:8443/x')), false)
})

test('a redirect loop is stopped at the configured limit', async () => {
  const transport = fakeFetch([
    response({ status: 302, headers: { location: 'https://api.deepseek.com/again' } }),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve, maxRedirects: 2 })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'too_many_redirects',
  )
  // The first request plus two redirects, and no more.
  assert.equal(transport.calls.length, 3)
})

test('a 303 after a POST becomes a bodyless GET', async () => {
  const transport = fakeFetch([
    response({ status: 303, headers: { location: 'https://api.deepseek.com/v1/result' } }),
    response({ status: 200 }),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await guard.fetch(
    context({ localOnly: false }),
    'https://api.deepseek.com/v1/chat',
    { method: 'POST', body: '{"messages":[]}', headers: { 'content-type': 'application/json' } },
  )

  assert.equal(transport.calls[1].init.method, 'GET')
  assert.equal(transport.calls[1].init.body, undefined)
  assert.equal(transport.calls[1].init.headers['content-type'], undefined)
})

/* ------------------------------------------------------------------ *
 * Rebinding
 * ------------------------------------------------------------------ */

test('a host is resolved once and the verified address is handed to the transport', async () => {
  const transport = fakeFetch([response({ status: 200 })])
  let asked = 0
  const resolve = async () => {
    asked += 1
    // Local when checked, cloud if anything asked again.
    return asked === 1 ? [LOCAL_IP] : [CLOUD_IP]
  }
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve })

  const answer = await guard.fetch(context(), 'http://rebind.example/v1/chat')

  assert.equal(answer.status, 200)
  /*
   * One lookup, made before the request. There is no second answer for an
   * attacker to win, because the transport connects to the address that was
   * classified instead of asking the resolver again.
   */
  assert.equal(asked, 1)
  assert.deepEqual(transport.calls[0].init.pin, {
    hostname: 'rebind.example',
    addresses: [LOCAL_IP],
  })
})

test('a response from an address the guard did not verify is discarded', async () => {
  // A transport that ignored the pin and says so. The answer is not returned.
  const transport = fakeFetch([response({ status: 200, connectedAddress: CLOUD_IP })])
  const resolver = fakeResolver({ 'localhost': LOCAL_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context(), 'http://localhost:11434/api/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'local_only',
  )

  assert.equal(audit.entries()[0].outcome, 'blocked')
  assert.equal(audit.entries()[0].reason, 'local_only')
})

test('the pin names the verified addresses on every hop', async () => {
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://api.deepseek.com/v1/final' } }),
    response({ status: 200 }),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat')

  assert.equal(transport.calls.length, 2)
  for (const call of transport.calls) {
    assert.deepEqual(call.init.pin, { hostname: 'api.deepseek.com', addresses: [CLOUD_IP] })
  }
})

/* ------------------------------------------------------------------ *
 * Audit records
 * ------------------------------------------------------------------ */

test('a key in the URL query never reaches the audit record', async () => {
  const transport = fakeFetch([response()])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await guard.fetch(
    context({ localOnly: false }),
    `https://api.deepseek.com/v1/chat?key=${CANARY}&model=x`,
    { headers: { Authorization: `Bearer ${CANARY}` } },
  )

  const [record] = audit.entries()
  const serialized = JSON.stringify(record)
  assert.equal(serialized.includes(CANARY), false, 'the audit record leaked the key')
  assert.deepEqual(Object.keys(record.target).sort(), ['host', 'port', 'scheme'])
  assert.equal(record.target.scheme, 'https')
  assert.equal(record.target.port, null)
})

test('a transport failure is recorded as failed and comes back sanitized', async () => {
  const failure = Object.assign(new Error(`connect ECONNREFUSED https://x/?key=${CANARY}`), {
    code: 'ECONNREFUSED',
  })
  const transport = fakeFetch([failure])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat'),
    error => {
      /*
       * A new error, not the transport's own: that message carried the URL, and a
       * provider URL can carry a key. The code survives because it is the part a
       * person acts on.
       */
      assert.notEqual(error, failure)
      assert.equal(error instanceof api.EgressTransportError, true)
      assert.equal(error.code, 'ECONNREFUSED')
      assert.equal(error.cause, undefined)
      assert.equal(String(error.message).includes(CANARY), false)
      return true
    },
  )

  const [record] = audit.entries()
  assert.equal(record.outcome, 'failed')
  assert.equal(JSON.stringify(record).includes(CANARY), false)
})

test('an error code that is not a plain token never reaches the caller', async () => {
  const failure = Object.assign(new Error('boom'), {
    code: `sk-live-${CANARY}`,
    name: 'weird name with spaces',
  })
  const transport = fakeFetch([failure])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat'),
    error => error instanceof api.EgressTransportError && error.code === 'unknown',
  )
})

test('a cancelled call still comes back as a cancellation', async () => {
  // Providers tell a cancellation from a failure by name, so the name survives
  // while the transport's own message does not.
  const cancelled = Object.assign(new Error(`aborted ${CANARY}`), { name: 'AbortError' })
  const transport = fakeFetch([cancelled])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'https://api.deepseek.com/v1/chat'),
    error => error.name === 'AbortError' && String(error.message).includes(CANARY) === false,
  )
})

test('the guard cannot be built without a transport or a resolver', () => {
  assert.throws(() => api.createEgressGuard({}), TypeError)
  assert.throws(() => api.createEgressGuard({ fetchImpl: async () => response() }), TypeError)
})

/* ------------------------------------------------------------------ *
 * Refusals that used to escape the audit trail
 * ------------------------------------------------------------------ */

test('a URL that cannot be parsed is recorded rather than thrown raw', async () => {
  const transport = fakeFetch([response()])
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl })

  await assert.rejects(
    guard.fetch(context(), 'http://[::1'),
    error => error instanceof api.EgressBlockedError && error.reason === 'invalid_target',
  )

  assert.equal(transport.calls.length, 0)
  const [record] = audit.entries()
  assert.equal(record.outcome, 'blocked')
  assert.equal(record.reason, 'invalid_target')
  // Nothing to reduce to a target, so the record names none rather than guessing.
  assert.equal(record.target, null)
})

test('a resolver that refuses is recorded and nothing is sent', async () => {
  const transport = fakeFetch([response()])
  // fakeResolver throws for a host it does not know, which is what a real one does.
  const resolver = fakeResolver({})
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'https://missing.example/v1/chat'),
    error => error instanceof api.EgressBlockedError && error.reason === 'invalid_target',
  )

  assert.equal(transport.calls.length, 0)
  const [record] = audit.entries()
  assert.equal(record.outcome, 'blocked')
  assert.equal(record.reason, 'invalid_target')
  assert.equal(record.target.host, 'missing.example')
})

/* ------------------------------------------------------------------ *
 * Credentials across a redirect: ports matter
 * ------------------------------------------------------------------ */

test('an upgrade to a non-default port is a different origin', () => {
  const insecure = new URL('http://api.deepseek.com/v1/chat')

  // The ordinary upgrade is still followed with its credentials.
  assert.equal(api.egressMayCarryCredentials(insecure, new URL('https://api.deepseek.com/v1/chat')), true)
  // The same upgrade landing on another listener is not.
  assert.equal(
    api.egressMayCarryCredentials(insecure, new URL('https://api.deepseek.com:8443/v1/chat')),
    false,
  )
  // Nor is leaving a non-default http port for the default https one.
  assert.equal(
    api.egressMayCarryCredentials(
      new URL('http://api.deepseek.com:8080/v1/chat'),
      new URL('https://api.deepseek.com/v1/chat'),
    ),
    false,
  )
})

test('a redirect that upgrades the scheme onto another port is refused', async () => {
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://api.example.com:8443/steal' } }),
    response(),
  ])
  const resolver = fakeResolver({ 'api.example.com': CLOUD_IP })
  const { guard, audit } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await assert.rejects(
    guard.fetch(context({ localOnly: false }), 'http://api.example.com:8080/v1/chat', {
      headers: { Authorization: `Bearer ${CANARY}` },
    }),
    error => error instanceof api.EgressBlockedError && error.reason === 'cross_origin_redirect',
  )

  // The second listener was never contacted.
  assert.equal(transport.calls.length, 1)
  const records = audit.entries()
  assert.equal(records[records.length - 1].reason, 'cross_origin_redirect')
})

test('an adapter body reaches the transport as text, and the same text on every hop', async () => {
  /*
   * Every adapter builds its request as an object, and the shipped transport sends
   * strings. The two met nowhere: an object body reached `bodyBytes` in the pinned
   * transport, which refuses anything that is not text, and the guard reported it as
   * an unreachable provider. So no real model call could succeed through the app,
   * while every adapter test passed - because their stand-in transport accepts
   * whatever it is handed.
   *
   * The object is serialised in the guard, once, before the first hop. Serialising
   * per hop would let a redirect carry a different body from the one the access
   * decision was made about, so both hops are asserted to carry identical text.
   */
  const body = { model: 'deepseek-flash', messages: [{ role: 'user', content: 'the Tilley quote' }] }
  const transport = fakeFetch([
    response({ status: 307, headers: { location: 'https://api.deepseek.com/v1/chat' } }),
    response({ status: 200 }),
  ])
  const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
  const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

  await guard.fetch(
    context({ localOnly: false, unredactedContent: false }),
    'https://api.deepseek.com/v1/chat',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
  )

  assert.equal(transport.calls.length, 2, 'the redirect was not followed')
  const first = transport.calls[0].init.body
  const second = transport.calls[1].init.body

  // Text, not an object: the transport refuses anything else.
  assert.equal(typeof first, 'string')
  assert.deepEqual(JSON.parse(first), body)
  // The same bytes on the hop that followed, not a re-encoding of them.
  assert.equal(second, first)
})

test('a body that is already text or bytes is sent unchanged', async () => {
  /*
   * The fix must not become "every body is JSON". A string is what an adapter may
   * legitimately build itself, and a Buffer is bytes - running either through
   * `JSON.stringify` would send a quoted string or a list of numbers.
   */
  for (const body of ['{"messages":[]}', Buffer.from('{"messages":[]}', 'utf8')]) {
    const transport = fakeFetch([response({ status: 200 })])
    const resolver = fakeResolver({ 'api.deepseek.com': CLOUD_IP })
    const { guard } = build({ fetchImpl: transport.fetchImpl, resolve: resolver.resolve })

    await guard.fetch(
      context({ localOnly: false, unredactedContent: false }),
      'https://api.deepseek.com/v1/chat',
      { method: 'POST', body },
    )

    assert.equal(transport.calls[0].init.body, body)
  }
})
