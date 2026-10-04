// The global search field used to open a page rather than a record: a task hit
// opened the task drawer only when the board already held that task, and every
// other kind switched to its destination and stopped there. These tests run
// against the real shell because the defect lived in the wiring between the
// search response and the navigation, which neither side shows on its own.
//
// main.jsx mounts itself into #root at module scope, so this file mounts the app
// exactly once (see App.test.jsx) and gives each search its own stubbed response,
// keyed by the query it asks with.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { expectRequest, mockApi } from './test/setup-tests.js'

// Chats is lazy-loaded, so its own view claims the hand-off on mount. Spying on
// the stash is what proves the message id made it across rather than the view
// merely being asked to open.
vi.mock('./lib/chat-navigation.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, requestChatThread: vi.fn(actual.requestChatThread) }
})
const { requestChatThread } = await import('./lib/chat-navigation.js')

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

const apiTask = {
  id: 404,
  title: 'Renew the domain',
  description: 'The auto-renew lapsed.',
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

let fetchMock
const routes = {
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/tasks/404/': { task: apiTask },
    '/api/tasks/404/comments/': { comments: [] },
    '/api/tasks/404/subtasks/': { subtasks: [] },
    '/api/tasks/404/attachments/': { attachments: [] },
    // The record a hit names, for the case where it is no longer there.
    '/api/tasks/501/': { status: 404, body: { error: 'Not found' } },
    '/api/workspaces/1/check-ins/': {
      check_ins: [
        { id: 4, user_id: 9, user_name: 'Ada West', date: '2026-10-02', completed: 'Wrote the audit', next_steps: '', blockers: '' },
        { id: 5, user_id: 8, user_name: 'Bella Ortiz', date: '2026-10-03', completed: 'Finished the walkthrough', next_steps: '', blockers: '' },
      ],
    },
    '/api/workspaces/1/check-ins/5/comments/': { comments: [] },
    '/api/workspaces/1/chat-channels/': { channels: [] },
    '/api/workspaces/1/search/?q=renew': {
      results: [{ kind: 'task', id: 404, title: 'Renew the domain', snippet: 'The auto-renew lapsed.', target_type: 'task', target_id: 404, meta: 'todo' }],
      query: 'renew',
    },
    '/api/workspaces/1/search/?q=walkthrough': {
      results: [{ kind: 'check_in', id: 5, title: 'Bella Ortiz - 2026-10-03', snippet: 'Finished the walkthrough', target_type: 'check_in', target_id: 5, meta: '2026-10-03' }],
      query: 'walkthrough',
    },
    '/api/workspaces/1/search/?q=deck': {
      results: [{ kind: 'chat_message', id: 55, title: '#design', snippet: 'the launch deck', target_type: 'chat_channel', target_id: 'design', meta: 'Nate Foster' }],
      query: 'deck',
    },
    '/api/workspaces/1/search/?q=gone': {
      results: [{ kind: 'task', id: 501, title: 'Retired cleanup script', snippet: '', target_type: 'task', target_id: 501, meta: 'todo' }],
      query: 'gone',
    },
    '/api/workspaces/1/search/?q=broken': {
      status: 500,
      body: { error: 'Search is unavailable right now.' },
    },
    '/api/workspaces/1/search/?q=empty': { results: [], query: 'empty' },
}

// The shared setup unstubs globals after every test, so the app mounted once in
// beforeAll needs the routing table put back for each test that follows.
beforeAll(async () => {
  mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  fetchMock = mockApi(routes)
})

const searchFor = async (query) => {
  const fields = await screen.findAllByLabelText('Search workspace', {}, { timeout: 30000 })
  fireEvent.change(fields[0], { target: { value: query } })
}

const clickResult = async (title) => {
  const label = await screen.findByText(title, {}, { timeout: 15000 })
  fireEvent.click(label.closest('button'))
}

const searchRequestCount = (query) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(`/search/?q=${query}`)).length

it('opens the exact task a hit names, loading it when the board does not hold it', async () => {
  await searchFor('renew')
  await clickResult('Renew the domain')

  // The board never loaded this task, so the only way it can be on screen is the
  // fetch the hit now triggers.
  await waitFor(() => expectRequest(fetchMock, '/api/tasks/404/'), { timeout: 15000 })
  const drawer = await waitFor(() => {
    const element = document.querySelector('.task-dialog')
    expect(element).not.toBeNull()
    return element
  }, { timeout: 15000 })
  expect(within(drawer).getAllByText('Renew the domain').length).toBeGreaterThan(0)
}, 60000)

it('opens the check-in a hit names rather than only the check-ins page', async () => {
  await searchFor('walkthrough')
  await clickResult('Bella Ortiz - 2026-10-03')

  const dialog = await waitFor(() => {
    const element = document.querySelector('.checkin-detail-dialog')
    expect(element).not.toBeNull()
    return element
  }, { timeout: 15000 })
  expect(within(dialog).getAllByText('Bella Ortiz').length).toBeGreaterThan(0)
  expect(within(dialog).queryByText('Ada West')).toBeNull()
}, 60000)

it('opens the chat thread on the message a hit names', async () => {
  requestChatThread.mockClear()
  await searchFor('deck')
  await clickResult('#design')

  // The hit names the channel and the message separately, and losing the second
  // half is what left the reader at the top of a long thread.
  await waitFor(() =>
    expect(requestChatThread).toHaveBeenCalledWith('chat_channel', 'design', '55'),
  )
}, 60000)

it('says so when the record a hit names cannot be opened', async () => {
  await searchFor('gone')
  await clickResult('Retired cleanup script')

  expect(await screen.findByText('That task is no longer available.', {}, { timeout: 15000 })).toBeInTheDocument()
}, 60000)

it('shows a search that is running before it knows the answer', async () => {
  const fields = await screen.findAllByLabelText('Search workspace', {}, { timeout: 30000 })
  fireEvent.change(fields[0], { target: { value: 'empty' } })

  expect(screen.getByText('Searching…')).toBeInTheDocument()
  expect(await screen.findByText('No matches for "empty".', {}, { timeout: 15000 })).toBeInTheDocument()
}, 60000)

it('shows a failed search as a failure with a retry, never as no matches', async () => {
  await searchFor('broken')

  expect(await screen.findByText('Search is unavailable right now.', {}, { timeout: 15000 })).toBeInTheDocument()
  // The whole point of the fix: a search that never ran cannot read as a search
  // that found nothing.
  expect(screen.queryByText(/No matches for/)).toBeNull()

  const before = searchRequestCount('broken')
  fireEvent.click(screen.getByRole('button', { name: 'Retry search' }))

  // The retry repeats the query that failed, rather than the box being reset or
  // the retry reusing whatever was typed first.
  await waitFor(() => expect(searchRequestCount('broken')).toBe(before + 1))
}, 60000)
