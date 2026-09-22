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
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { expectRequest, mockApi } from './test/setup-tests.js'
import { toDateKey } from './lib/workspace-format.js'
import { syncVisualViewportVariables } from './lib/visual-viewport.js'

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
  window.localStorage.removeItem('workspace-sidebar-upgrade-card-dismissed-7')
  const fetchMock = mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [task], pagination: { has_next: false } },
    '/api/tasks/91/comments/': { comments: [] },
    '/api/tasks/91/subtasks/': { subtasks: [] },
    '/api/tasks/91/attachments/': { attachments: [] },
    '/api/workspaces/1/activity/': {
      activity: [{
        id: 41,
        actor_id: 7,
        actor_name: 'Nate Foster',
        kind: 'task_created',
        message: 'Nate Foster created task Check-In Reminder.',
        created_at: new Date().toISOString(),
      }],
      pagination: { page: 1, page_size: 15, total_items: 1, total_pages: 1, has_next: false, has_previous: false },
      filters: { actors: [{ id: 7, name: 'Nate Foster' }], kinds: ['task_created'] },
      summary: { total_events: 1, today_events: 1, week_events: 1, active_actors: 1 },
    },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
  return fetchMock
}

it('renders the workspace shell and opens a task from the today bar', async () => {
  const fetchMock = await mountApp()

  // The shell is up once it has rendered its own navigation.
  await waitFor(() => expect(document.querySelectorAll('button').length).toBeGreaterThan(5), { timeout: 20000 })
  expect(screen.getAllByRole('button', { name: 'Hard refresh WorkSpace' })).toHaveLength(2)

  // The mobile bar is the design's TabBar: five equal fifths along the bottom
  // edge. Four are pages and the fifth opens the drawer. Zuri has moved up into
  // the AppBar, so this bar no longer carries it.
  const nav = await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
  const tabs = [...nav.children]

  expect(nav.className).toContain('bottom-4')
  expect(nav.className).toContain('rounded-[32px]')
  expect(nav.className).toContain('bg-navy')
  expect(tabs).toHaveLength(5)
  expect(tabs.every(tab => tab.className.includes('flex-1'))).toBe(true)
  expect(tabs[0]).toHaveTextContent('Today')
  expect(tabs[1]).toHaveTextContent('My tasks')
  expect(tabs[2]).toHaveTextContent('Planner')
  expect(tabs[3]).toHaveTextContent('Chats')
  expect(tabs[4]).toHaveTextContent('More')
  expect(within(nav).queryByRole('button', { name: 'Open Zuri' })).toBeNull()

  // The Today page's activity strip is gone, so Activity is reached from the
  // nav. What is still worth pinning here is that it titles itself once.
  fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
  expect(await screen.findAllByRole('heading', { name: 'Activity' })).toHaveLength(1)
  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/activity/?page=1&page_size=15'))

  fireEvent.click(screen.getByRole('button', { name: 'Channels' }))
  await waitFor(
    () => expect(document.querySelector('.chat-workspace-view')).not.toBeNull(),
    { timeout: 20000 },
  )
  expect(document.body.innerText).not.toContain('could not render this view')
  fireEvent.click(screen.getAllByRole('button', { name: 'Today' })[0])

  const todayTasks = document.querySelector('[data-panel="tasks"]')
  const opener = await within(todayTasks).findByText('Desingn UI', {}, { timeout: 20000 })
  fireEvent.click(opener)

  await waitFor(
    () => expect(document.querySelector('.task-dialog')).not.toBeNull(),
    { timeout: 20000 },
  )
  expect(document.body.innerText).not.toContain('could not render this view')
}, 60000)

it('tracks visual viewport geometry for mobile editors', () => {
  const setProperty = vi.fn()
  syncVisualViewportVariables(
    {
      visualViewport: { width: 320, height: 480, offsetTop: 8, offsetLeft: 4 },
      innerWidth: 1024,
      innerHeight: 768,
    },
    { documentElement: { style: { setProperty } } },
  )

  expect(setProperty).toHaveBeenCalledWith('--workspace-visual-viewport-top', '8px')
  expect(setProperty).toHaveBeenCalledWith('--workspace-visual-viewport-left', '4px')
  expect(setProperty).toHaveBeenCalledWith('--workspace-visual-viewport-width', '320px')
  expect(setProperty).toHaveBeenCalledWith('--workspace-visual-viewport-height', '480px')
})
