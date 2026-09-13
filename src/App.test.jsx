// Smoke test for the real application shell.
//
// main.jsx mounts itself into #root at module scope, so importing it here runs
// the app exactly as the browser does. Everything else in the workspace load
// falls back to empty when its endpoint is unstubbed (see the `read` helper),
// which keeps this test down to the session and the tasks that a click needs.
//
// It exists because the shell once rendered fine until a task was opened - the
// drawer was handed an identifier the shell never defined - and no
// component-level test renders the shell.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mockApi } from './test/setup-tests.js'
import { toDateKey } from './lib/workspace-format.js'

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
  title: 'Desingn UI',
  description: '',
  assignee_id: 7,
  assignee_name: 'Nate Foster',
  project: '',
  project_id: null,
  status: 'todo',
  priority: 'normal',
  // The today bar only lists tasks due today or later, so a fixed date made this
  // test pass until that date and fail every day after. Keep it relative.
  due_date: toDateKey(new Date()),
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

const mountApp = async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [task], pagination: { has_next: false } },
    '/api/tasks/91/comments/': { comments: [] },
    '/api/tasks/91/subtasks/': { subtasks: [] },
    '/api/tasks/91/attachments/': { attachments: [] },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}

it('renders the workspace shell and opens a task from the today bar', async () => {
  await mountApp()

  // The shell is up once it has rendered its own navigation.
  await waitFor(() => expect(document.querySelectorAll('button').length).toBeGreaterThan(5), { timeout: 20000 })

  const opener = await screen.findByText('Desingn UI', {}, { timeout: 20000 })
  fireEvent.click(opener)

  await waitFor(
    () => expect(document.querySelector('.task-drawer')).not.toBeNull(),
    { timeout: 20000 },
  )
  expect(document.body.innerText).not.toContain('could not render this view')
}, 60000)
