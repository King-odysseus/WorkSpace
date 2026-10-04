// The workspace loader used to read about twenty collections into one batch and
// write them to state only when the last of them came back, so the day's work
// waited on the reports summary, the templates and the archived conversations.
// It also had nothing to say about the difference between "nothing is assigned
// to you today" and "your tasks have not arrived yet", and showed the first when
// it meant the second.
//
// This file holds the slow endpoints open and makes the app prove both halves.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
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

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [task], pagination: { has_next: false } },
}

// The endpoints the daily view has no use for. Each is held open for the whole
// test, so anything that appears has appeared without them.
const SLOW = ['/reports/summary/', '/task-templates/', '/project-templates/', '/direct-conversations/']

const held = []

const okResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const release = (fragment, body) => {
  const pending = held.filter((entry) => entry.url.includes(fragment))
  pending.forEach((entry) => entry.resolve(okResponse(body)))
  return pending.length
}

beforeAll(async () => {
  const base = mockApi(routes)
  vi.stubGlobal(
    'fetch',
    vi.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      if (SLOW.some((fragment) => url.includes(fragment)) || url.includes('/api/tasks/')) {
        return new Promise((resolve) => held.push({ url, resolve }))
      }
      return base(input, init)
    }),
  )
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

const taskPanel = () => {
  const panel = document.querySelector('[data-panel="tasks"]')
  expect(panel).not.toBeNull()
  return panel
}

it('shows the day as it arrives, without the endpoints it has no use for', async () => {
  // The task read is one of the held ones, so nothing about the day has arrived
  // yet. The panel must say so rather than claim the day is clear.
  expect(await screen.findByText('Loading your tasks...', {}, { timeout: 30000 })).toBeInTheDocument()
  expect(screen.queryByText('Nothing is assigned to you today.')).toBeNull()

  expect(release('/api/tasks/', { tasks: [task], pagination: { has_next: false } })).toBeGreaterThan(0)

  await waitFor(
    () => expect(within(taskPanel()).getAllByText('Design the UI').length).toBeGreaterThan(0),
    { timeout: 30000 },
  )
  // And the reports, templates and archived conversations are still outstanding,
  // which is the whole claim: the day did not wait for them.
  expect(held.some((entry) => entry.url.includes('/reports/summary/'))).toBe(true)
  expect(held.some((entry) => entry.url.includes('/task-templates/'))).toBe(true)
}, 60000)
