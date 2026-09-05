// Shared setup for the Vitest suite.
//
// The app talks to the API exclusively through `fetch`, so tests stub it rather
// than standing up a server. `mockApi` maps a URL substring to the JSON payload
// (and optional status) that endpoint should answer with, which keeps individual
// tests focused on behaviour instead of request plumbing.

import '@testing-library/jest-dom/vitest'
import { afterEach, expect, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Note for form tests: happy-dom does not implicitly submit a form when a submit
// button is clicked, so use `fireEvent.submit(form)` rather than clicking the
// button when the behaviour under test lives in an onSubmit handler.

/**
 * Stub `fetch` with a routing table.
 *
 * @param {Record<string, unknown | { body?: unknown, status?: number, contentType?: string }>} routes
 *   Keys are matched as substrings of the request URL, longest key first.
 * @returns {import('vitest').Mock} the mock, for asserting on calls.
 */
export function mockApi(routes) {
  // Every mutating call funnels through getCsrfToken(), which fetches this
  // endpoint when the cookie is absent. Stubbing it here keeps that plumbing out
  // of individual tests; a test may still override it by naming it explicitly.
  const withDefaults = { '/api/auth/csrf/': { status: 'ok' }, ...routes }
  const patterns = Object.keys(withDefaults).sort((a, b) => b.length - a.length)
  const fetchMock = vi.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    const match = patterns.find(pattern => url.includes(pattern))
    if (match === undefined) throw new Error(`No stubbed route for ${init.method || 'GET'} ${url}`)
    const route = withDefaults[match]
    const isEnvelope = route && typeof route === 'object' && ('body' in route || 'status' in route || 'contentType' in route)
    const { body = {}, status = 200, contentType = 'application/json' } = isEnvelope ? route : { body: route }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: name => (name.toLowerCase() === 'content-type' ? contentType : null) },
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Assert a request was made to a URL containing `fragment`, optionally with a method. */
export function expectRequest(fetchMock, fragment, method) {
  const call = fetchMock.mock.calls.find(([url, init = {}]) =>
    String(url).includes(fragment) && (!method || (init.method || 'GET') === method))
  expect(call, `expected a ${method || 'GET'} request to ${fragment}`).toBeTruthy()
  return call
}
