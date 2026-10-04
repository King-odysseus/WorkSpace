// Any change used to cost a full refresh: a message arriving refetched the task
// table, the calendar, the reports summary and the audit log along with the
// chat. The pulse now says which domains moved, and only those are refetched.
//
// The dangerous half of that is the fallback. A client that cannot tell what
// moved must refetch everything rather than quietly refresh nothing, because a
// collection nobody refreshes stops updating and never says so. Both directions
// are tested here.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { mockApi } from './test/setup-tests.js'

const session = {
  user: {
    id: 7,
    email: 'nate@example.com',
    first_name: 'Nate',
    last_name: 'Foster',
    default_workspace_id: 1,
    workspaces: [{ id: 1, name: 'Northstar', role: 'owner', permissions: [] }],
  },
}

const task = {
  id: 91,
  title: 'Design the UI',
  description: '',
  assignee_id: 7,
  assignee_name: 'Nate Foster',
  project: '',
  project_id: null,
  status: 'todo',
  priority: 'normal',
  due_date: null,
  bucket: 'Backlog',
  recurrence: 'none',
  labels: [],
  code: 'T-91',
  state: 'active',
  workstream: '',
  position: 0,
  progress_percent: 0,
  blocked_by_ids: [],
  blocking_ids: [],
  supporter_ids: [],
}

// The pulse answers from a live object, so a test can move one domain and watch
// what the client decides to refetch.
const FIRST = { tasks: 't1', chat: 'c1', calendar: 'k1', members: 'm1' }
let pulse = { fingerprint: 'first', domains: FIRST }

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [task], pagination: { has_next: false } },
  '/api/workspaces/1/pulse/': {
    get fingerprint() {
      return pulse.fingerprint
    },
    get domains() {
      return pulse.domains
    },
  },
}

let fetchMock

beforeAll(async () => {
  fetchMock = mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  pulse = { fingerprint: 'first', domains: FIRST }
  fetchMock = mockApi(routes)
  window.localStorage.clear()
})

// Reconnecting asks the pulse straight away, which is the cheapest way to make
// the client look without waiting out the fifteen second timer.
const reconnect = () => window.dispatchEvent(new Event('online'))

const requestsSince = (mark) =>
  fetchMock.mock.calls.slice(mark).map(([url]) => String(url))

const settled = () =>
  waitFor(() => expect(screen.queryByText('Loading workspace data...')).toBeNull(), {
    timeout: 30000,
  })

it('refetches only the collections whose domain moved', async () => {
  await settled()
  await waitFor(
    () => expect(document.querySelector('[data-panel="tasks"]')).not.toBeNull(),
    { timeout: 30000 },
  )

  // A message arrives, and nothing else.
  pulse = { fingerprint: 'second', domains: { ...FIRST, chat: 'c2' } }
  const mark = fetchMock.mock.calls.length
  reconnect()

  // Every read a refresh decides on is issued in the same tick, so once the
  // last of the chat's four has landed, nothing else is on its way.
  await waitFor(
    () => {
      const asked = requestsSince(mark)
      expect(asked.some((url) => url.includes('/chat-channels/'))).toBe(true)
      expect(
        asked.some((url) => url.includes('/direct-conversations/?archived=true')),
      ).toBe(true)
    },
    { timeout: 30000 },
  )

  const asked = requestsSince(mark)
  // The chat came back...
  expect(asked.some((url) => url.includes('/chat-channels/'))).toBe(true)
  // ...and nothing else was asked for again.
  for (const path of [
    '/api/tasks/',
    '/reports/summary/',
    '/calendar-events/',
    '/audit-logs/',
    '/follow-ups/',
    '/activity/',
  ]) {
    expect(
      asked.some((url) => url.includes(path)),
      `${path} was refetched. Everything asked for was: ${asked.join(' | ')}`,
    ).toBe(false)
  }
}, 120000)

it('refetches everything when it cannot tell what moved', async () => {
  await settled()
  // A domain this client has no mapping for. Guessing would mean never
  // refreshing whatever that domain covers.
  pulse = { fingerprint: 'third', domains: { ...FIRST, mystery: 'x1' } }
  const mark = fetchMock.mock.calls.length
  reconnect()

  await waitFor(
    () => expect(requestsSince(mark).some((url) => url.includes('/reports/summary/'))).toBe(true),
    { timeout: 30000 },
  )

  const asked = requestsSince(mark)
  expect(asked.some((url) => url.includes('/api/tasks/'))).toBe(true)
  expect(asked.some((url) => url.includes('/calendar-events/'))).toBe(true)
  expect(asked.some((url) => url.includes('/follow-ups/'))).toBe(true)
}, 120000)

it('does nothing at all when nothing moved', async () => {
  await settled()
  const mark = fetchMock.mock.calls.length
  reconnect()

  // Give the pulse a chance to answer and any refresh a chance to start.
  await waitFor(() => expect(requestsSince(mark).some((url) => url.includes('/pulse/'))).toBe(true), {
    timeout: 30000,
  })
  await new Promise((resolve) => setTimeout(resolve, 250))

  const asked = requestsSince(mark).filter((url) => !url.includes('/pulse/'))
  expect(asked).toEqual([])
}, 120000)
