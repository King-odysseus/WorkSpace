// The help centre has listed "N - new task", "Shift N - open notifications" and
// "Ctrl \\ - toggle sidebar" for as long as it has listed "/ - search", and only
// the search key ever did anything. A shortcut list that is wrong is worse than
// no list, so these tests hold the page to its own words - and hold the keys to
// their promise never to eat a character somebody meant to type.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx) and every scenario shares it.
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

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
}

let fetchMock

beforeAll(async () => {
  fetchMock = mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  // The shared setup unstubs globals after every test, so the app mounted once
  // in beforeAll needs its routing table put back.
  fetchMock = mockApi(routes)
  window.localStorage.clear()
})

const press = (key, options = {}) =>
  fireEvent.keyDown(document.body, { key, ...options })

const quickCaptureField = () => document.getElementById('quick-task-capture')
const taskForm = () => screen.queryByRole('dialog', { name: 'Add a task' })

it('puts the caret in the capture field, because that is the shorter path', async () => {
  await screen.findByRole('button', { name: 'Activity' }, { timeout: 30000 })
  expect(quickCaptureField()).not.toBeNull()

  press('n')

  expect(document.activeElement).toBe(quickCaptureField())
}, 90000)

it('stands down while the caret is in a field, so it never eats a character', async () => {
  // Off Today, so the only thing that could answer is the full form - which is
  // exactly what must not happen to someone typing the word "note" into search.
  fireEvent.click(await screen.findByRole('button', { name: 'Projects' }, { timeout: 30000 }))
  await waitFor(() => expect(quickCaptureField()).toBeNull())

  const search = screen.getAllByLabelText('Search workspace')[0]
  search.focus()
  fireEvent.keyDown(search, { key: 'n' })

  expect(taskForm()).toBeNull()
  expect(document.activeElement).toBe(search)
}, 90000)

it('opens the full form when the page has no capture field of its own', async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Projects' }, { timeout: 30000 }))
  await waitFor(() => expect(quickCaptureField()).toBeNull())

  press('n')

  expect(await screen.findByRole('dialog', { name: 'Add a task' }, { timeout: 30000 })).toBeInTheDocument()
  // The fuller form is still there for anyone who wants it.
  expect(screen.getByLabelText('Task name')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close add task dialog' }))
  await waitFor(() => expect(taskForm()).toBeNull())
}, 90000)

it('opens the notifications the help centre says it will', async () => {
  expect(document.querySelector('.workspace-popup-panel')).toBeNull()

  press('N', { shiftKey: true })

  await waitFor(() => expect(document.querySelectorAll('.workspace-popup-panel')).toHaveLength(1))
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => expect(document.querySelector('.workspace-popup-panel')).toBeNull())
}, 90000)
