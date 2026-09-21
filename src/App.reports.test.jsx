// Regression: the Reports view used to crash on the workspace summary alone.
//
// /reports/summary/ returns workspace-wide counters and nothing else - no
// progress_by_project, progress_by_priority, stale, on_hold, cancelled, or kpis.
// The view applied its defaults only when the summary was missing entirely, so a
// real summary kept those fields undefined and `report.progress_by_project.length`
// threw, tripping the error boundary instead of falling back to the summary.
//
// The summary stub below is deliberately the exact key set tasks/views.py
// report_summary returns, and the detail endpoint fails, so the view stays on the
// summary-only path for the whole test. Widening either stub hides the bug again.
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

const summary = {
  total_tasks: 12,
  status_counts: { todo: 7, done: 5 },
  overdue_tasks: 3,
  due_this_week: 2,
  unassigned_tasks: 4,
  completion_rate: 42,
  blocked_tasks: 1,
  check_ins_today: 0,
  members: 2,
  workload: [{ user_id: 7, user_name: 'Nate Foster', total: 12, open: 7, blocked: 1 }],
  time_clock: {
    shift_count: 1,
    total_seconds: 7200,
    break_seconds: 1800,
    average_seconds: 7200,
    open_shifts: 0,
    by_member: [{
      user_id: 7,
      user_name: 'Nate Foster',
      worked_seconds: 7200,
      break_seconds: 1800,
      day_count: 1,
    }],
    recent: [{
      id: 41,
      user_name: 'Nate Foster',
      date: toDateKey(new Date()),
      started_at: '2026-09-21T09:00:00Z',
      ended_at: '2026-09-21T11:00:00Z',
      worked_seconds: 7200,
      break_seconds_total: 1800,
      is_open: false,
      is_on_break: false,
    }],
  },
}

it('falls back to the workspace summary when the detail report fails', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': {
      tasks: [{
        id: 91, title: 'Load signal', description: '', assignee_id: 7,
        assignee_name: 'Nate Foster', project: '', project_id: null,
        status: 'todo', priority: 'normal', due_date: toDateKey(new Date()),
        bucket: 'Backlog', recurrence: 'none', labels: [], code: 'T-91',
        state: 'active', workstream: '', position: 0, progress_percent: 0,
        blocked_by_ids: [], blocking_ids: [], supporter_ids: [],
      }],
      pagination: { has_next: false },
    },
    '/api/workspaces/1/reports/summary/': { summary },
    '/api/workspaces/1/reports/': {
      status: 500,
      contentType: 'application/json',
      body: { error: 'Report data could not be loaded.' },
    },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  // The task list and the workspace summary arrive in the same refresh, so seeing
  // this title means the view is rendering against the real summary rather than
  // its empty initial state.
  await waitFor(
    () => expect(document.body.innerText).toContain('Load signal'),
    { timeout: 20000 },
  )

  const [reportsNav] = await screen.findAllByRole('button', { name: 'Reports' }, { timeout: 20000 })
  fireEvent.click(reportsNav)

  expect(await screen.findByText('Priority delivery', {}, { timeout: 20000 })).toBeInTheDocument()
  expect(screen.getByText('Project progress')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Team workload' })).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Time clock by team member' })).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Recent time clock entries' })).toBeInTheDocument()
  // The summary counts still render, proving the fallback is real data not an empty shell.
  expect(screen.getByText('42% complete - 0% average progress')).toBeInTheDocument()
  expect(document.body.innerText).not.toContain('could not render this view')
}, 60000)
