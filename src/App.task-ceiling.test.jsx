// A workspace can hold more tasks than the board will read.
//
// The loader stops after a fixed number of pages rather than reading until the
// end, which is a guard against a workspace so large the tab never settles. It
// used to stop silently, so the board showed a fraction of the work as though it
// were all of it - the difference between a limit and a lie.
//
// The ceiling is far more tasks than a fixture can hold, so the endpoint here
// simply claims there is always another page. Fifty mocked responses later the
// loader gives up, and what it says about that is the thing under test.
import { screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
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
  title: 'One of very many',
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

it('says so when a workspace holds more tasks than the board will read', async () => {
  mockApi({
    '/api/auth/me/': session,
    // Every page claims there is another one, which is what a workspace larger
    // than the ceiling looks like from here.
    '/api/tasks/': { tasks: [task], pagination: { has_next: true } },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  await waitFor(
    () =>
      expect(
        screen.getByText('Showing the first tasks in this workspace'),
      ).toBeInTheDocument(),
    { timeout: 40000 },
  )
  // And it says where the rest of them are, rather than leaving the reader to
  // wonder whether their work has gone.
  expect(screen.getByText(/Search and reports cover all of them/)).toBeInTheDocument()
}, 60000)
