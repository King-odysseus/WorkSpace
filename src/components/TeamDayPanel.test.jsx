import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeamDayPanel, { cellTone, hours, rebalanceHints } from './TeamDayPanel.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear() } catch { /* nothing to clear */ } })

const member = (id, name, extra = {}) => ({
  id, name, role: 'member', planned_minutes: 0, planned_count: 0, capacity_minutes: 450, leave_share: 0, location: null, location_source: 'none',
  done_count: 0, done_minutes: 0, logged_minutes: 0, clocked_in: false, on_break: false, checked_in: false, expects_check_in: true,
  open_count: 0, blocked_count: 0, overdue_count: 0, missing_estimates: 0, last_done: null, ...extra,
})
const summary = { members: 3, checked_in: 1, expected_check_ins: 3, clocked_in: 1, done_today: 4, blocked: 1, overdue: 2, on_leave: 1, at_home: 1, in_office: 0, planned_minutes: 600, capacity_minutes: 1200, unassigned: 1, missing_estimates: 5 }
const dayPayload = {
  date: '2026-11-13', summary,
  members: [
    member(1, 'Ada Lovelace', { planned_minutes: 480, planned_count: 3, done_count: 2, done_minutes: 90, logged_minutes: 240, clocked_in: true, checked_in: true, blocked_count: 1, location: 'home', location_source: 'set', missing_estimates: 1 }),
    member(2, 'Bo Peep', { overdue_count: 2, leave_share: 1, capacity_minutes: 0 }),
    member(3, 'Cy Young', {}),
  ],
  unassigned: [{ id: 90, title: 'Nobody owns this', due_date: '2026-11-14', estimate_minutes: null }],
}

describe('number helpers', () => {
  it('formats hours and picks a tone for planned against capacity', () => {
    expect([hours(0), hours(45), hours(60), hours(90), hours(450)]).toEqual(['0h', '45m', '1h', '1.5h', '7.5h'])
    expect([cellTone(0, 450), cellTone(300, 450), cellTone(420, 450), cellTone(500, 450), cellTone(0, 0), cellTone(60, 0)]).toEqual(['empty', 'ok', 'full', 'over', 'off', 'over'])
  })
  it('suggests moving a task from an overbooked day to the person with most room', () => {
    const cell = (planned, capacity, tasks = []) => ({ planned_minutes: planned, capacity_minutes: capacity, task_count: tasks.length, tasks })
    const members = [
      { id: 1, name: 'Ada', days: { '2026-11-12': cell(600, 450, [{ id: 5, title: 'Big', minutes: 180 }, { id: 6, title: 'Small', minutes: 60 }]) } },
      { id: 2, name: 'Bo', days: { '2026-11-12': cell(420, 450) } },
      { id: 3, name: 'Cy', days: { '2026-11-12': cell(60, 450) } },
    ]
    const [hint] = rebalanceHints(members)
    expect(hint.from.name).toBe('Ada')
    expect(hint.to.name).toBe('Cy')
    expect(hint.task.title).toBe('Big')
  })
  it('suggests nothing when nobody has room', () => {
    const full = { planned_minutes: 450, capacity_minutes: 450, task_count: 0, tasks: [] }
    const over = { planned_minutes: 700, capacity_minutes: 450, task_count: 1, tasks: [{ id: 1, title: 'X', minutes: 250 }] }
    expect(rebalanceHints([{ id: 1, name: 'A', days: { d: over } }, { id: 2, name: 'B', days: { d: full } }])).toEqual([])
  })
})

describe('TeamDayPanel', () => {
  it('shows nothing, and asks for nothing, for anyone who is not an owner or manager', () => {
    const fetchMock = mockApi({})
    const { container } = render(<TeamDayPanel workspaceId={4} isLeader={false} />)
    expect(container.firstChild).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the strip, planned against capacity, done, logged and check-in for each person', async () => {
    mockApi({ '/team-day/': dayPayload })
    render(<TeamDayPanel workspaceId={4} isLeader onNavigate={() => {}} />)
    expect(await screen.findByRole('img', { name: '1 of 3 checked in' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /4 done today/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Team load 50%/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Ada Lovelace: 8h planned of 7.5h/ })).toBeTruthy()
    expect(screen.getByText('Checked in', { selector: 'span.team-day-yes' })).toBeTruthy()
    expect(screen.getByText(/clocked in/, { selector: 'small' })).toBeTruthy()
    expect(screen.getAllByText('On leave').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /5 open tasks have no estimate/ })).toBeTruthy()
  })

  it('filters the list from Needs attention, and Everyone clears it', async () => {
    mockApi({ '/team-day/': dayPayload })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    fireEvent.click(await screen.findByRole('button', { name: /2 overdue/ }))
    expect(screen.getByText('Bo Peep')).toBeTruthy()
    expect(screen.queryByText('Ada Lovelace')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Everyone' }))
    expect(screen.getByText('Ada Lovelace')).toBeTruthy()
  })

  it('opens a persons day with their tasks, check-in and weekly trend', async () => {
    mockApi({
      '/team-day/1/': { date: '2026-11-13', done: [{ id: 1, title: 'Shipped it', estimate_minutes: 60 }], in_progress: [{ id: 2, title: 'Writing docs', estimate_minutes: null }], blocked: [{ id: 3, title: 'Waiting on legal', estimate_minutes: 30 }], overdue: [], due_today: [], check_in: { completed: 'Finished the report', next_steps: '', blockers: 'Need access' }, weekly_done: [2, 4, 3, 5] },
      '/team-day/': dayPayload,
    })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    fireEvent.click(await screen.findByRole('button', { name: "Show Ada Lovelace's day" }))
    expect(await screen.findByText('Shipped it')).toBeTruthy()
    expect(screen.getByText('Waiting on legal')).toBeTruthy()
    expect(screen.getByText(/Finished the report/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /last four weeks: 2, 4, 3, 5/ })).toBeTruthy()
  })

  it('reassigns an unassigned task and refreshes', async () => {
    const fetchMock = mockApi({ '/api/tasks/90/': { task: { id: 90 } }, '/team-day/': dayPayload })
    const user = userEvent.setup()
    render(<TeamDayPanel workspaceId={4} isLeader />)
    await user.click(await screen.findByRole('combobox', { name: 'Reassign Nobody owns this' }))
    await user.click(await screen.findByRole('option', { name: 'Cy Young' }))
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/90/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/api/tasks/90/', 'PATCH')[1].body)).toEqual({ assignee_id: 3 })
  })

  it('deletes an unassigned task only after a second press, and keeps it on Keep', async () => {
    const fetchMock = mockApi({ '/api/tasks/90/': { deleted: 90 }, '/team-day/': dayPayload })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Nobody owns this' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Nobody owns this?' })).getByRole('button', { name: 'Keep' }))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/api/tasks/90/') && init?.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete Nobody owns this' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Nobody owns this?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/90/', 'DELETE'))
  })

  it('lists the first few unassigned tasks and the rest on request', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: 100 + index, title: `Orphan ${index}`, due_date: null, estimate_minutes: null }))
    mockApi({ '/team-day/': { ...dayPayload, unassigned: many, summary: { ...summary, unassigned: 12 } } })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    await screen.findByText('Orphan 0')
    expect(screen.queryByText('Orphan 11')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12 listed' }))
    expect(screen.getByText('Orphan 11')).toBeTruthy()
  })

  it('asks the shell to open the board a task is on when its title is selected', async () => {
    const heard = vi.fn()
    window.addEventListener('workspace:open-task-board', heard)
    mockApi({ '/team-day/': dayPayload })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nobody owns this' }))
    window.removeEventListener('workspace:open-task-board', heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard.mock.calls[0][0].detail).toEqual({ taskId: 90 })
  })

  it('shows the week grid with a move suggestion, and the move reassigns the task', async () => {
    localStorage.setItem('team-day-mode', 'week')
    const cell = (planned, capacity, tasks = []) => ({ planned_minutes: planned, capacity_minutes: capacity, leave_share: 0, location: null, source: 'none', task_count: tasks.length, tasks })
    const weekPayload = {
      start: '2026-11-09', end: '2026-11-15',
      members: [
        { id: 1, name: 'Ada Lovelace', days: { '2026-11-12': cell(660, 450, [{ id: 5, title: 'Big report', minutes: 240, estimated: true }]) } },
        { id: 3, name: 'Cy Young', days: { '2026-11-12': cell(30, 450) } },
      ],
    }
    const fetchMock = mockApi({ '/api/tasks/5/': { task: { id: 5 } }, '/team-week/': weekPayload, '/team-day/': dayPayload })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    const hints = await screen.findByLabelText('Suggested moves')
    expect(within(hints).getByText(/Big report/)).toBeTruthy()
    fireEvent.click(within(hints).getByRole('button', { name: 'Move to Cy' }))
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/5/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/api/tasks/5/', 'PATCH')[1].body)).toEqual({ assignee_id: 3 })
  })

  it('remembers whether you were looking at today or the week', async () => {
    mockApi({ '/team-day/': dayPayload, '/team-week/': { start: '2026-11-09', end: '2026-11-15', members: [] } })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    fireEvent.click(await screen.findByRole('button', { name: 'This week' }))
    expect(localStorage.getItem('team-day-mode')).toBe('week')
  })

  it('says what the server refused', async () => {
    mockApi({ '/team-day/': { status: 403, body: { error: 'Only owners and managers can see the daily team view.' } } })
    render(<TeamDayPanel workspaceId={4} isLeader />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Only owners and managers')
  })
})
