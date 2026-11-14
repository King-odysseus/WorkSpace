'use strict'

/*
 * Behaviour of the evidence sanitiser.
 *
 * The live verification run writes request headers and bodies to a file on
 * disk, so the sanitiser is the only thing keeping the session cookie, the CSRF
 * token and the throwaway password out of that file. These tests assert what a
 * reviewer reads in the evidence: the shape of the request stays, the secrets
 * do not.
 */

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const {
  MAX_HEADER_CHARS,
  REDACTED,
  SAFE_HEADERS,
  describeCookies,
  findLeakedSecrets,
  sanitizeHeaderValue,
  sanitizeHeaders,
  sanitizePath,
  sanitizeQuery,
  sanitizeRequestBody,
} = require('./sanitize')

describe('sanitizeHeaderValue: Cookie header', () => {
  it('replaces the cookie values and lists the cookie names sorted', () => {
    const header = sanitizeHeaderValue('Cookie', 'sessionid=abc123session; theme=dark; csrftoken=xyz987csrf')

    assert.equal(
      header,
      `${REDACTED}; names: csrftoken, sessionid, theme`,
      'the cookie header should keep its names in sorted order and no values',
    )
    assert.equal(header.includes('abc123session'), false, 'the session cookie value must not be recorded')
    assert.equal(header.includes('xyz987csrf'), false, 'the csrf cookie value must not be recorded')
    assert.equal(header.includes('dark'), false, 'no cookie value is safe to record, even a cosmetic one')
  })

  it('records the redaction marker alone when the cookie header has no names', () => {
    assert.equal(sanitizeHeaderValue('Cookie', ''), REDACTED)
    assert.equal(sanitizeHeaderValue('Cookie', '; ;'), REDACTED)
  })
})

describe('sanitizeHeaderValue: credential headers', () => {
  it('keeps the CSRF token length but never the token', () => {
    const token = 'a1b2c3d4e5f6g7h8'
    const header = sanitizeHeaderValue('X-CSRFToken', token)

    assert.equal(header, `${REDACTED}; 16 chars`, 'the token length is the evidence, the token is not')
    assert.equal(header.includes(token), false, 'the CSRF token value must not be recorded')
    assert.equal(
      sanitizeHeaderValue('X-Csrftoken', token),
      header,
      'the header name should be matched case-insensitively',
    )
  })

  it('fully redacts Authorization, Proxy-Authorization and Set-Cookie', () => {
    const cases = [
      { name: 'Authorization', value: 'Bearer abc.def.ghi' },
      { name: 'Proxy-Authorization', value: 'Basic dXNlcjpwYXNzd29yZA==' },
      { name: 'Set-Cookie', value: 'sessionid=abc123session; HttpOnly; Path=/' },
    ]

    for (const { name, value } of cases) {
      assert.equal(sanitizeHeaderValue(name, value), REDACTED, `${name} should be replaced outright`)
      assert.equal(
        sanitizeHeaderValue(name.toLowerCase(), value),
        REDACTED,
        `${name.toLowerCase()} should be replaced outright too`,
      )
    }
  })

  it('redacts a header value given as an array', () => {
    assert.equal(
      sanitizeHeaderValue('Set-Cookie', ['sessionid=abc123session', 'csrftoken=xyz987csrf']),
      REDACTED,
      'a repeated Set-Cookie header is still a credential header',
    )
  })
})

describe('sanitizeHeaderValue: headers that describe the request', () => {
  it('keeps Origin, Referer, Content-Type and Accept verbatim', () => {
    const cases = [
      { name: 'Origin', value: 'http://127.0.0.1:8099' },
      { name: 'Referer', value: 'http://127.0.0.1:8099/app/' },
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ]

    for (const { name, value } of cases) {
      assert.equal(sanitizeHeaderValue(name, value), value, `${name} should be kept as sent`)
    }
  })

  it('collapses whitespace and trims the value', () => {
    assert.equal(
      sanitizeHeaderValue('Accept', '  application/json,   text/plain  '),
      'application/json, text/plain',
      'the recorded value should be one tidy line',
    )
  })

  it('truncates a long value at the recorded maximum', () => {
    const long = 'a'.repeat(MAX_HEADER_CHARS + 50)
    const header = sanitizeHeaderValue('Accept', long)

    assert.equal(header.length, MAX_HEADER_CHARS, 'a long safe header should be cut to MAX_HEADER_CHARS')
    assert.equal(header, long.slice(0, MAX_HEADER_CHARS))
  })

  it('keeps a Referer path but redacts a token in its query', () => {
    const header = sanitizeHeaderValue(
      'Referer',
      'http://localhost:5183/app/?access_token=token-value-0123456789&permanent=true',
    )

    assert.equal(header, `http://localhost:5183/app/?access_token=${REDACTED}&permanent=true`)
    assert.equal(header.includes('token-value-0123456789'), false, 'a token in a Referer query must not be recorded')
    assert.equal(header.includes('permanent=true'), true, 'the allowlisted query value is still evidence')
  })

  it('withholds a Referer that is not a parsable URL', () => {
    assert.equal(
      sanitizeHeaderValue('Referer', 'token-value-0123456789'),
      REDACTED,
      'a value pasted into Referer is not a URL and must not be kept',
    )
  })
})

describe('sanitizeHeaderValue: the allowlist decides, not a denylist', () => {
  it('withholds an unlisted credential header such as X-API-Key', () => {
    const apiKey = 'sk-live-0123456789abcdef'
    const header = sanitizeHeaderValue('X-API-Key', apiKey)

    assert.equal(header, REDACTED, 'a credential header the harness does not know is withheld outright')
    assert.equal(header.includes(apiKey), false, 'the API key must never be recorded in any form')
  })

  it('withholds any header that is not on the allowlist, even a harmless one', () => {
    for (const name of ['X-Request-Id', 'X-Custom-Trace', 'Sec-WebSocket-Protocol']) {
      assert.equal(
        sanitizeHeaderValue(name, 'value-that-is-not-a-secret'),
        REDACTED,
        `${name} is not on the allowlist, so its value must fail closed`,
      )
    }
  })

  it('keeps the header set visible while no unlisted value is recorded', () => {
    const safe = sanitizeHeaders({
      'X-API-Key': 'sk-live-0123456789abcdef',
      'X-Request-Id': 'request-0123456789',
      Accept: 'application/json',
    })
    const serialised = JSON.stringify(safe)

    assert.deepEqual(Object.keys(safe), ['X-API-Key', 'X-Request-Id', 'Accept'], 'the names are the evidence')
    assert.equal(serialised.includes('sk-live-0123456789abcdef'), false)
    assert.equal(serialised.includes('request-0123456789'), false)
    assert.equal(safe.Accept, 'application/json')
  })

  it('exposes the allowlist so the rule can be reviewed', () => {
    assert.equal(SAFE_HEADERS instanceof Set, true)
    assert.equal(SAFE_HEADERS.has('accept'), true)
    assert.equal(SAFE_HEADERS.has('x-api-key'), false, 'a credential header must not be on the allowlist')
    for (const name of SAFE_HEADERS) {
      assert.equal(name, name.toLowerCase(), 'allowlist entries are lowercase for case-insensitive matching')
    }
  })
})

describe('sanitizeHeaders', () => {
  it('keeps the header names in their original case', () => {
    const token = 'a1b2c3d4e5f6g7h8'
    const safe = sanitizeHeaders({
      'X-CSRFToken': token,
      Origin: 'http://127.0.0.1:8099',
      'Set-Cookie': 'sessionid=abc123session',
    })

    assert.deepEqual(Object.keys(safe), ['X-CSRFToken', 'Origin', 'Set-Cookie'])
    assert.equal(safe['X-CSRFToken'], `${REDACTED}; ${token.length} chars`)
    assert.equal(safe.Origin, 'http://127.0.0.1:8099')
    assert.equal(safe['Set-Cookie'], REDACTED)
    assert.equal(
      Object.prototype.hasOwnProperty.call(safe, 'x-csrftoken'),
      false,
      'a header name should not be duplicated in lower case',
    )
  })

  it('returns an empty map when there are no headers to record', () => {
    assert.deepEqual(sanitizeHeaders(), {})
    assert.deepEqual(sanitizeHeaders(null), {})
  })
})

describe('sanitizePath', () => {
  it('keeps the path and query and drops the origin', () => {
    const path = sanitizePath('http://127.0.0.1:8099/api/workspaces/7/tasks/?permanent=true')

    assert.equal(path, '/api/workspaces/7/tasks/?permanent=true')
    assert.equal(path.includes('127.0.0.1'), false, 'the origin should not be repeated on every request row')
    assert.equal(path.includes('http'), false, 'the scheme should not be recorded with the path')
  })

  it('keeps a path that has no query string', () => {
    assert.equal(sanitizePath('http://127.0.0.1:8099/api/workspaces/'), '/api/workspaces/')
  })

  it('marks an unparsable value instead of throwing', () => {
    assert.equal(sanitizePath('not a url'), '<unparsable-url>')
    assert.equal(sanitizePath(''), '<unparsable-url>')
  })

  it('redacts a token query value and keeps its name and the allowlisted value', () => {
    assert.equal(
      sanitizePath('http://127.0.0.1:8099/api/workspaces/1/tasks/?access_token=token-value-0123456789&permanent=true'),
      `/api/workspaces/1/tasks/?access_token=${REDACTED}&permanent=true`,
    )
    assert.equal(
      sanitizePath('http://localhost:5183/api/workspaces/1/tasks/?access_token=token-value-0123456789'),
      `/api/workspaces/1/tasks/?access_token=${REDACTED}`,
      'a second origin gets the same treatment',
    )
  })

  it('redacts every query value whose name is not on an allowlist', () => {
    assert.equal(
      sanitizePath('http://127.0.0.1:8099/api/?foo=bar&baz=qux'),
      `/api/?foo=${REDACTED}&baz=${REDACTED}`,
    )
  })

  it('redacts credential-shaped query names', () => {
    for (const name of ['api_key', 'apiKey', 'token', 'password', 'passwd', 'signature', 'csrf', 'ticket', 'code']) {
      assert.equal(
        sanitizePath(`http://127.0.0.1:8099/api/?${name}=secret-value-0123456789`),
        `/api/?${name}=${REDACTED}`,
        `${name} looks like a credential and must always be redacted`,
      )
    }
  })

  it('keeps a numeric pagination value only when it really is numeric', () => {
    assert.equal(
      sanitizePath('http://127.0.0.1:8099/api/?page=2&page_size=50'),
      '/api/?page=2&page_size=50',
    )
    assert.equal(sanitizePath('http://127.0.0.1:8099/api/?page=two'), `/api/?page=${REDACTED}`)
    assert.equal(
      sanitizePath('http://127.0.0.1:8099/api/?page=123456789012345'),
      `/api/?page=${REDACTED}`,
      'an unexpectedly long value is not a page number',
    )
  })

  it('keeps a bare flag with no value and drops an empty query', () => {
    assert.equal(
      sanitizePath('http://127.0.0.1:8099/api/?debug'),
      '/api/?debug',
      'there is no value to leak',
    )
    assert.equal(sanitizePath('http://127.0.0.1:8099/api/?'), '/api/')
  })

  it('drops the fragment, which can carry an implicit-flow token', () => {
    const path = sanitizePath('http://127.0.0.1:8099/app/#access_token=token-value-0123456789')

    assert.equal(path, '/app/')
    assert.equal(path.includes('token-value-0123456789'), false)
  })

  it('sanitizeQuery applies the same rule to a raw query string', () => {
    assert.equal(sanitizeQuery('?a=1&permanent=false'), `?a=${REDACTED}&permanent=false`)
    assert.equal(sanitizeQuery(''), '')
    assert.equal(sanitizeQuery(null), '')
  })
})

describe('sanitizeRequestBody', () => {
  const markerPrefix = 'Probe task'

  it('keeps the marked title and the sorted key names', () => {
    const body = sanitizeRequestBody({ workspace: 7, title: 'Probe task 7f3a' }, { markerPrefix })

    assert.deepEqual(body, {
      kind: 'json',
      keys: ['title', 'workspace'],
      title: 'Probe task 7f3a',
    })
  })

  it('omits every value when the title lacks the marker prefix', () => {
    const body = sanitizeRequestBody({ title: 'Something else', password: 'hunter2hunter2' }, { markerPrefix })

    assert.deepEqual(body, {
      kind: 'json',
      keys: ['password', 'title'],
      valuesOmitted: true,
    })
    assert.equal('title' in body, false, 'a body that is not the probe task should not keep its title')
    assert.equal(JSON.stringify(body).includes('hunter2hunter2'), false, 'a body value must never be recorded')
  })

  it('omits the title when no marker prefix is given', () => {
    assert.deepEqual(
      sanitizeRequestBody({ title: 'Probe task 7f3a' }),
      { kind: 'json', keys: ['title'], valuesOmitted: true },
      'without the marker prefix the title cannot be proved to be the probe task',
    )
  })

  it('parses a JSON string body before deciding what to keep', () => {
    assert.deepEqual(
      sanitizeRequestBody(JSON.stringify({ title: 'Probe task 7f3a', workspace: 7 }), { markerPrefix }),
      { kind: 'json', keys: ['title', 'workspace'], title: 'Probe task 7f3a' },
    )
    assert.deepEqual(
      sanitizeRequestBody(JSON.stringify({ password: 'hunter2hunter2' }), { markerPrefix }),
      { kind: 'json', keys: ['password'], valuesOmitted: true },
    )
  })

  it('reduces a non-JSON text body to its length', () => {
    const raw = 'sessionid=abc123session; not json at all'
    const body = sanitizeRequestBody(raw)

    assert.deepEqual(body, { kind: 'text', length: raw.length })
    assert.equal(JSON.stringify(body).includes('sessionid'), false, 'a text body must not be copied out')
  })

  it('keeps null for a request that had no body', () => {
    assert.equal(sanitizeRequestBody(null), null)
    assert.equal(sanitizeRequestBody(undefined), null)
  })

  it('marks arrays and primitive bodies as non-object', () => {
    assert.deepEqual(
      sanitizeRequestBody([{ title: 'Probe task 7f3a' }]),
      { kind: 'non-object' },
      'an array has no named fields to prove anything with',
    )
    assert.deepEqual(sanitizeRequestBody('[1,2,3]', { markerPrefix }), { kind: 'non-object' })
    assert.deepEqual(sanitizeRequestBody('42'), { kind: 'non-object' })
  })
})

describe('describeCookies', () => {
  it('reports the count and the sorted unique cookie names, with no values', () => {
    const cookies = [
      { name: 'sessionid', value: 'cookie-value-1234', domain: '.localhost' },
      { name: 'csrftoken', value: 'csrf-value-5678', domain: '.localhost' },
      { name: 'sessionid', value: 'cookie-value-9012', domain: '.localhost' },
    ]
    const summary = describeCookies(cookies)

    assert.deepEqual(summary, { count: 3, names: ['csrftoken', 'sessionid'] })
    assert.equal(JSON.stringify(summary).includes('cookie-value-1234'), false, 'a cookie value must not be recorded')
    assert.equal(JSON.stringify(summary).includes('csrf-value-5678'), false, 'a cookie value must not be recorded')
    assert.equal(JSON.stringify(summary).includes('.localhost'), false, 'cookie domains are not evidence either')
  })

  it('treats anything that is not a cookie array as an empty jar', () => {
    assert.deepEqual(describeCookies(null), { count: 0, names: [] })
    assert.deepEqual(describeCookies(undefined), { count: 0, names: [] })
    assert.deepEqual(describeCookies({ name: 'sessionid' }), { count: 0, names: [] })
  })
})

describe('findLeakedSecrets', () => {
  it('names the labels of secrets that appear verbatim', () => {
    const text = '{"Cookie":"sessionid=session-value-0123456789"}'
    const leaked = findLeakedSecrets(text, [
      { label: 'session cookie', value: 'session-value-0123456789' },
      { label: 'csrf token', value: 'csrf-token-abcdef' },
    ])

    assert.deepEqual(leaked, ['session cookie'], 'only the secret that is present should be reported')
  })

  it('returns labels only, never the secret values', () => {
    const leaked = findLeakedSecrets('token=csrf-token-abcdef', [
      { label: 'csrf token', value: 'csrf-token-abcdef' },
    ])

    assert.deepEqual(leaked, ['csrf token'])
    for (const entry of leaked) {
      assert.equal(typeof entry, 'string')
      assert.equal(entry.includes('csrf-token-abcdef'), false, 'the report must not repeat the secret')
    }
  })

  it('ignores entries shorter than six characters', () => {
    const text = 'text that genuinely contains abc12 and t0k3n'
    const leaked = findLeakedSecrets(text, [
      { label: 'short csrf', value: 'abc12' },
      { label: 'short password', value: 't0k3n' },
    ])

    assert.deepEqual(leaked, [], 'short values would match ordinary words, so they are not searched for')
  })

  it('ignores entries with no label', () => {
    const leaked = findLeakedSecrets('sessionid=session-value-0123456789', [
      { label: '', value: 'session-value-0123456789' },
    ])

    assert.deepEqual(leaked, [], 'an unlabelled finding could not be reported or acted on')
  })

  it('returns an empty list for missing input', () => {
    assert.deepEqual(findLeakedSecrets(null, [{ label: 'session cookie', value: 'session-value-0123456789' }]), [])
    assert.deepEqual(findLeakedSecrets('serialised evidence', null), [])
  })

  it('finds nothing in a sanitised request row while the cookie names survive', () => {
    const sessionCookieValue = 'session-value-0123456789'
    const csrfToken = 'csrf-token-abcdef123456'
    const password = 'hunter2hunter2'

    const row = {
      headers: sanitizeHeaders({
        Cookie: `sessionid=${sessionCookieValue}; csrftoken=${csrfToken}`,
        'X-CSRFToken': csrfToken,
        Origin: 'http://127.0.0.1:8099',
      }),
      body: sanitizeRequestBody({ title: 'Probe task 7f3a', password }, { markerPrefix: 'Probe task' }),
    }
    const serialised = JSON.stringify(row)

    const leaked = findLeakedSecrets(serialised, [
      { label: 'session cookie', value: sessionCookieValue },
      { label: 'csrf token', value: csrfToken },
      { label: 'password', value: password },
    ])

    assert.deepEqual(leaked, [], 'a sanitised row must carry no cookie value, csrf token or password')
    assert.equal(serialised.includes(sessionCookieValue), false)
    assert.equal(serialised.includes(csrfToken), false)
    assert.equal(serialised.includes(password), false)
    assert.equal(serialised.includes('sessionid'), true, 'the cookie name is the proof the session was used')
    assert.equal(serialised.includes('csrftoken'), true, 'the csrf cookie name is evidence too')
    assert.equal(serialised.includes('Probe task 7f3a'), true, 'the marked title is what cleanup is checked against')
  })

  it('a sanitised request row leaks neither an unexpected header nor a query token', () => {
    const apiKey = 'sk-live-0123456789abcdef'
    const accessToken = 'token-value-0123456789'
    const sessionCookieValue = 'session-value-0123456789'
    const csrfToken = 'csrf-token-abcdef123456'

    const row = {
      path: sanitizePath(
        `http://127.0.0.1:8099/api/workspaces/1/tasks/?access_token=${accessToken}&permanent=true`,
      ),
      headers: sanitizeHeaders({
        'X-API-Key': apiKey,
        Cookie: `sessionid=${sessionCookieValue}; csrftoken=${csrfToken}`,
        'X-CSRFToken': csrfToken,
        Origin: 'http://localhost:5183',
        Referer: `http://localhost:5183/app/?access_token=${accessToken}`,
        Accept: 'application/json',
      }),
    }
    const serialised = JSON.stringify(row)

    assert.equal(serialised.includes(apiKey), false, 'an unlisted credential header must not reach the record')
    assert.equal(serialised.includes(accessToken), false, 'a query token must not reach the record')
    assert.equal(serialised.includes(sessionCookieValue), false)
    assert.equal(serialised.includes(csrfToken), false)
    assert.equal(row.path, `/api/workspaces/1/tasks/?access_token=${REDACTED}&permanent=true`)
    assert.equal(row.headers.Referer, `http://localhost:5183/app/?access_token=${REDACTED}`)
    assert.equal(row.headers.Origin, 'http://localhost:5183')
    assert.equal(row.headers.Accept, 'application/json')

    // The leak scan is the second line of defence; the allowlist is what stops
    // the unexpected value before the scan would ever see it.
    assert.deepEqual(
      findLeakedSecrets(serialised, [
        { label: 'api key', value: apiKey },
        { label: 'access token', value: accessToken },
        { label: 'session cookie', value: sessionCookieValue },
        { label: 'csrf token', value: csrfToken },
      ]),
      [],
    )
  })
})
