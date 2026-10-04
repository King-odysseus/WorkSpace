// Capturing a task used to mean opening a form with ownership, timing, and
// placement in it, so writing down a one-line job cost five controls. The
// title-first row on Today is the shorter path: one field, the same endpoint,
// the same defaults, and a way into the full form when the task needs more.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx) and every scenario shares it.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { expectRequest, mockApi } from './test/setup-tests.js'

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

const capturedTask = {
  id: 404,
  title: 'Renew the domain',
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
  code: 'T-404',
  state: 'active',
  workstream: '',
  position: 0,
  progress_percent: 0,
  blocked_by_ids: [],
  blocking_ids: [],
  supporter_ids: [],
}

// One route answers both uses of this endpoint: the board reads `tasks`, the
// create reads `task`. The board is a live list rather than a fixed one, because
// a create is followed by a reload - the server is the source of truth for the
// board, and a stub that keeps answering with an empty list would model a server
// that throws away what it just accepted.
let boardTasks = []
const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': {
    get tasks() {
      return boardTasks
    },
    pagination: { has_next: false },
    task: capturedTask,
  },
}

let fetchMock

// Models the other half of the create: once the server has accepted the task, it
// appears in what the board reads back.
const acceptCreatedTasks = () => {
  const base = fetchMock
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      const response = await base(input, init)
      if (url.includes('/api/tasks/') && init.method === 'POST' && response.ok) {
        boardTasks = [capturedTask]
      }
      return response
    }),
  )
}

beforeAll(async () => {
  fetchMock = mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  boardTasks = []
  fetchMock = mockApi(routes)
  window.localStorage.clear()
})

const captureField = () => screen.findByLabelText('Add a task', {}, { timeout: 30000 })

const capture = async (title) => {
  const input = await captureField()
  fireEvent.change(input, { target: { value: title } })
  fireEvent.submit(input.closest('form'))
  return input
}

const sentBody = () => JSON.parse(expectRequest(fetchMock, '/api/tasks/', 'POST')[1].body)

it('writes a task down in one field, from Today', async () => {
  acceptCreatedTasks()
  const input = await capture('Renew the domain')

  expect(await screen.findByText('Added "Renew the domain" to Backlog.')).toBeInTheDocument()

  // The defaults the row names out loud, actually sent.
  expect(sentBody()).toMatchObject({
    title: 'Renew the domain',
    bucket: 'Backlog',
    status: 'todo',
    priority: 'normal',
    recurrence: 'none',
  })
  // Ownership is left to the server's "a member defaults to themselves" rule,
  // the same one the full form relies on, rather than the quick path guessing.
  expect(sentBody()).not.toHaveProperty('assignee_ids')

  // And it is on the board, without the reader having to go and look.
  await waitFor(() => {
    const panel = document.querySelector('[data-panel="tasks"]')
    expect(within(panel).getAllByText('Renew the domain').length).toBeGreaterThan(0)
  })
  await waitFor(() => expect(input.value).toBe(''))
}, 90000)

it('hands a typed title to the full form rather than making the reader retype it', async () => {
  const input = await captureField()
  fireEvent.change(input, { target: { value: 'Draft the launch note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add details' }))

  expect(await screen.findByRole('dialog', { name: 'Add a task' }, { timeout: 30000 })).toBeInTheDocument()
  expect(screen.getByLabelText('Task name').value).toBe('Draft the launch note')

  // Nothing was created on the way in: asking for details is not a save.
  expect(fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'POST')).toHaveLength(0)

  fireEvent.click(screen.getByRole('button', { name: 'Close add task dialog' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a task' })).toBeNull())
}, 90000)

it('keeps the typing when the create is refused', async () => {
  const base = fetchMock
  vi.stubGlobal(
    'fetch',
    vi.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.includes('/api/tasks/') && init.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 400,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'A task needs a name.' }),
          text: async () => '{}',
        })
      }
      return base(input, init)
    }),
  )

  const input = await capture('Renew the domain')

  expect(await screen.findByText('A task needs a name.', {}, { timeout: 15000 })).toBeInTheDocument()
  // Throwing the typing away with the error would make the reader start again.
  expect(input.value).toBe('Renew the domain')
}, 90000)
