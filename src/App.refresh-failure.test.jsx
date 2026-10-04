// The workspace loader used to answer a failed endpoint with an empty fallback
// and then write that fallback over the records it had already loaded, so a
// refresh that hit one bad response could make existing work look deleted. There
// was no user-facing sign that anything had gone wrong, either.
//
// These tests run against the real shell, because the defect lived in the merge
// between the reads and the state they feed, and they deliberately load a
// complete workspace first: the reader only has something to lose once a load
// has succeeded.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { mockApi } from './test/setup-tests.js'
import { toDateKey } from './lib/workspace-format.js'

const session = {
  user: {
    id: 7,
    email: 'nate@example.com',
    first_name: 'Nate',
    last_name: 'Foster',
    default_workspace_id: 1,
    workspaces: [
      { id: 1, name: 'Northstar', role: 'owner', permissions: [] },
      { id: 2, name: 'Beacon', role: 'owner', permissions: [] },
    ],
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

const emptyPagination = { has_next: false }

// Every collection the loader reads, so a test can start from a load in which
// nothing at all failed. Anything left out would show up as a failure.
const healthyRoutes = (taskBody) => ({
  '/api/auth/me/': session,
  '/api/notifications/summary/': { unread_count: 0, latest_unread_id: null },
  '/api/tasks/': taskBody,
  '/api/workspaces/1/members/': { members: [] },
  '/api/workspaces/1/projects/': { projects: [] },
  '/api/workspaces/1/lookup-values/': { lookup_values: [] },
  '/api/workspaces/1/task-templates/': { task_templates: [] },
  '/api/workspaces/1/project-templates/': { project_templates: [] },
  '/api/workspaces/1/chat-messages/': { messages: [] },
  '/api/workspaces/1/chat-channels/': { channels: [] },
  '/api/workspaces/1/direct-conversations/': { conversations: [] },
  '/api/workspaces/1/follow-ups/': { follow_ups: [] },
  '/api/workspaces/1/calendar-events/': { events: [] },
  '/api/workspaces/1/check-ins/': { check_ins: [] },
  '/api/workspaces/1/work-shifts/': { work_shifts: [] },
  '/api/workspaces/1/notifications/': { notifications: [], unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 0 } },
  '/api/workspaces/1/activity/': { activity: [] },
  '/api/workspaces/1/plan-buckets/': { buckets: [] },
  '/api/workspaces/1/invitations/': { invitations: [] },
  '/api/workspaces/1/reports/summary/': { summary: null },
  '/api/workspaces/1/audit-logs/': { audit_logs: [] },
  '/api/workspaces/2/members/': { members: [] },
  '/api/workspaces/2/projects/': { projects: [] },
  '/api/workspaces/2/lookup-values/': { lookup_values: [] },
  '/api/workspaces/2/task-templates/': { task_templates: [] },
  '/api/workspaces/2/project-templates/': { project_templates: [] },
  '/api/workspaces/2/chat-messages/': { messages: [] },
  '/api/workspaces/2/chat-channels/': { channels: [] },
  '/api/workspaces/2/direct-conversations/': { conversations: [] },
  '/api/workspaces/2/follow-ups/': { follow_ups: [] },
  '/api/workspaces/2/calendar-events/': { events: [] },
  '/api/workspaces/2/check-ins/': { check_ins: [] },
  '/api/workspaces/2/work-shifts/': { work_shifts: [] },
  '/api/workspaces/2/notifications/': { notifications: [], unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 0 } },
  '/api/workspaces/2/activity/': { activity: [] },
  '/api/workspaces/2/plan-buckets/': { buckets: [] },
  '/api/workspaces/2/invitations/': { invitations: [] },
  '/api/workspaces/2/reports/summary/': { summary: null },
  '/api/workspaces/2/audit-logs/': { audit_logs: [] },
})

// What the task endpoint answers next. Tests flip this between a good response
// and a failure, then re-stub, which is how a refresh is made to go wrong.
let taskBody = { tasks: [task], pagination: emptyPagination }
let fetchMock

const restub = () => {
  fetchMock = mockApi(healthyRoutes(taskBody))
}

beforeAll(async () => {
  restub()
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  taskBody = { tasks: [task], pagination: emptyPagination }
  restub()
})

// Leaving Team is what asks the shell for a fresh copy of everything, so it is
// the cheapest honest way to make a refresh happen on demand.
const refreshByLeavingTeam = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Team' }, { timeout: 30000 }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Today' })[0])
}

const todayTaskTitles = () => {
  const panel = document.querySelector('[data-panel="tasks"]')
  return panel ? panel.innerText : ''
}

it('keeps the records it already has when a refresh fails, and says what is stale', async () => {
  await waitFor(() => expect(todayTaskTitles()).toContain('Desingn UI'), { timeout: 30000 })

  taskBody = { status: 500, body: { error: 'Tasks are unavailable.' } }
  restub()
  await refreshByLeavingTeam()

  // The banner is drawn by the same update that decides the task list, so
  // waiting for it is what makes the next assertion mean anything: checking
  // sooner only proves the failed refresh has not landed yet.
  expect(await screen.findByText('Some workspace data could not be refreshed', {}, { timeout: 30000 })).toBeInTheDocument()
  expect(screen.getByText(/Could not refresh tasks\./)).toBeInTheDocument()
  expect(todayTaskTitles()).toContain('Desingn UI')
}, 90000)

it('clears the records when a response is genuinely empty', async () => {
  // The app is mounted once for the whole file, so an earlier test can have left
  // the board empty. Every test starts by refreshing into a known good state.
  await refreshByLeavingTeam()
  await waitFor(() => expect(todayTaskTitles()).toContain('Desingn UI'), { timeout: 30000 })

  // The opposite of a failure: the endpoint answered, and the answer was that
  // there is nothing. Retaining here would be the same bug in reverse.
  taskBody = { tasks: [], pagination: emptyPagination }
  restub()
  await refreshByLeavingTeam()

  await waitFor(() => expect(todayTaskTitles()).not.toContain('Desingn UI'), { timeout: 30000 })
  expect(screen.queryByText('Some workspace data could not be refreshed')).toBeNull()
}, 90000)

it('does not carry records from one workspace across to another', async () => {
  await refreshByLeavingTeam()
  await waitFor(() => expect(todayTaskTitles()).toContain('Desingn UI'), { timeout: 30000 })

  // Beacon's task read fails, so nothing can legitimately fill the board. What
  // must not happen is Northstar's task standing in for it.
  taskBody = { status: 500, body: { error: 'Tasks are unavailable.' } }
  restub()

  // The switcher is drawn once per shell variant, all sharing one open state, so
  // both the trigger and the menu it opens appear more than once.
  const switchers = await screen.findAllByRole('button', { name: /Northstar/ }, { timeout: 30000 })
  fireEvent.click(switchers[0])
  const beaconButtons = await screen.findAllByRole('button', { name: 'Beacon' })
  fireEvent.click(beaconButtons[0])

  // Beacon's own load has to finish before the board means anything, and it
  // failed, so the banner is that signal. Northstar's task must not be standing
  // in for records Beacon never loaded.
  expect(await screen.findByText('Some workspace data could not be refreshed', {}, { timeout: 30000 })).toBeInTheDocument()
  expect(todayTaskTitles()).not.toContain('Desingn UI')
}, 90000)
