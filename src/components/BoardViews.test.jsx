import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MyTasksView, TeamBoardView, TodayDashboard } from './BoardViews.jsx'
import { toDateKey } from '../lib/workspace-format.js'
import { takePendingDirectMessage } from '../lib/chat-navigation.js'
import { expectRequest, mockApi } from '../test/setup-tests.js'

const noop = vi.fn()

const dayOffset = days => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

const renderDashboard = (tasks, onOpenBoard = noop, followUps = [], overrides = {}) =>
  render(
    <TodayDashboard
      today="2026-09-12"
      todayLabel="Saturday, September 12"
      currentUserName="Nate Foster"
      currentUserId={7}
      currentUserPresence="available"
      workspaceName="Northstar"
      tasks={tasks}
      events={[]}
      followUps={followUps}
      checkIns={[]}
      workShifts={[]}
      members={[]}
      canManageMembers={false}
      onAddTask={noop}
      onInvite={noop}
      onOpenTask={noop}
      onNavigate={noop}
      onOpenBoard={onOpenBoard}
      onComplete={noop}
      onStatusChange={noop}
      onSubmitShift={noop}
      onChangePresence={noop}
      {...overrides}
    />,
  )

const renderBoard = ({
  tasks,
  focus = 'all',
  onFocusChange = noop,
  checkIns = [],
  workShifts = [],
  canManageMembers = false,
  workspaceId,
  currentUserId,
  workspaceRole,
}) =>
  render(
    <TeamBoardView
      tasks={tasks}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      workspaceRole={workspaceRole}
      members={[{ id: 9, first_name: 'Dana', last_name: 'Reed', role: 'member' }]}
      projects={[]}
      checkIns={checkIns}
      workShifts={workShifts}
      scope="all"
      onScopeChange={noop}
      focus={focus}
      onFocusChange={onFocusChange}
      invitations={[]}
      canManageMembers={canManageMembers}
      onInvite={noop}
      onComplete={noop}
      onStatusChange={noop}
      onOpenTask={noop}
      onUpdateMemberRole={noop}
      onRemoveMember={noop}
      onCancelInvitation={noop}
      onResendInvitation={noop}
      onNavigate={noop}
    />,
  )

it('loads Team tasks one page at a time with server summary counts', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/5/tasks/': {
      tasks: [
        {
          id: 1,
          title: 'Blocked delivery',
          status: 'blocked',
          priority: 'high',
          assignee_id: 9,
          assignee_name: 'Dana Reed',
          project: 'General',
          state: 'active',
        },
      ],
      pagination: {
        page: 1,
        page_size: 25,
        total_items: 34,
        total_pages: 2,
        has_next: true,
        has_previous: false,
      },
      summary: {
        counts: { open: 34, blocked: 3, overdue: 2, unassigned: 1 },
        by_owner: [],
      },
    },
  })

  const { container } = renderBoard({
    tasks: [],
    workspaceId: 5,
    currentUserId: 7,
    workspaceRole: 'owner',
  })

  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/5/tasks/'))
  const [url] = expectRequest(fetchMock, '/api/workspaces/5/tasks/')
  expect(url).toContain('page_size=25')
  expect(url).toContain('summary=true')
  expect(await screen.findByText('Blocked delivery')).toBeInTheDocument()
  const metrics = container.querySelectorAll('.team-board-metrics button')
  expect(metrics[0].textContent).toContain('34')
  expect(metrics[1].textContent).toContain('3')
})

const myDayPanel = () =>
  screen.getByRole('heading', { name: 'My day' }).closest('.today-panel')

afterEach(() => {
  localStorage.removeItem('workspace-today-panels')
})

it('shows only tasks assigned to the current user in My day', () => {
  renderDashboard([
    { id: 1, title: 'Mine to do', status: 'todo', assignee_id: 7, member: 'Nate Foster', priority: 'high', tag: 'Ops' },
    { id: 2, title: 'Nobody owns this', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', tag: 'Ops' },
    { id: 3, title: 'Someone else owns this', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'high', tag: 'Ops' },
  ])

  const panel = within(myDayPanel())
  expect(panel.getByText('Mine to do')).toBeInTheDocument()
  expect(panel.queryByText('Nobody owns this')).not.toBeInTheDocument()
  expect(panel.queryByText('Someone else owns this')).not.toBeInTheDocument()
})

it('does not treat an unassigned task as yours when the name lookup fails', () => {
  // The filter used to compare the displayed name against member.email, so the
  // lookup fell through to "" and "" === "" put every unassigned task in here.
  // Members is empty, which is exactly the case that used to leak them.
  renderDashboard([
    { id: 1, title: 'Nobody owns this', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', tag: 'Ops' },
  ])

  expect(within(myDayPanel()).getByText('Your day is clear.')).toBeInTheDocument()
})

it('formats dashboard follow-up dates in the app date format', () => {
  renderDashboard([], noop, [
    { id: 1, note: 'Confirm launch approval', status: 'open', due_date: '2026-09-05' },
  ])

  expect(screen.getByText('05-09-2026')).toBeInTheDocument()
  expect(screen.queryByText('2026-09-05')).not.toBeInTheDocument()
})

it('shows the real check-in denominator instead of inventing one for an empty workspace', () => {
  // This read `{count} of {members.length || 1}`, so a workspace with nobody in
  // it claimed "0 of 1".
  renderDashboard([])

  expect(screen.queryByText('0 of 1')).not.toBeInTheDocument()
})

it('keeps overdue follow-ups visible when an undated one is in the list', () => {
  // The list slices to four in source order, so an undated item sitting first
  // used to take a slot from a genuinely overdue follow-up.
  renderDashboard([], noop, [
    { id: 1, note: 'Undated ask', status: 'open', due_date: null },
    { id: 2, note: 'Overdue one', status: 'open', due_date: '2026-09-01' },
    { id: 3, note: 'Overdue two', status: 'open', due_date: '2026-09-02' },
    { id: 4, note: 'Overdue three', status: 'open', due_date: '2026-09-03' },
    { id: 5, note: 'Overdue four', status: 'open', due_date: '2026-09-04' },
  ])

  expect(screen.getByText('Overdue one')).toBeInTheDocument()
  expect(screen.getByText('Overdue two')).toBeInTheDocument()
  expect(screen.getByText('Overdue three')).toBeInTheDocument()
  expect(screen.getByText('Overdue four')).toBeInTheDocument()
})

it('lists an event that started earlier but runs into today', () => {
  // Matching on start_at === today dropped every event carried over from a
  // previous day.
  renderDashboard([], noop, [], {
    events: [
      { id: 1, title: 'Offsite', event_type: 'meeting', start_at: '2026-09-11T12:00:00Z', end_at: '2026-09-12T12:00:00Z' },
      { id: 2, title: 'Future thing', event_type: 'meeting', start_at: '2026-09-13T12:00:00Z', end_at: '2026-09-13T13:00:00Z' },
    ],
  })

  expect(screen.getByText('Offsite')).toBeInTheDocument()
  expect(screen.queryByText('Future thing')).not.toBeInTheDocument()
  // A carried-over event shows the day it began, not a bare time that reads as
  // if it started today.
  expect(screen.getByText('11-09-2026')).toBeInTheDocument()
})

it('opens an agenda event through the supplied action', () => {
  const onOpenEvent = vi.fn()
  renderDashboard([], noop, [], {
    events: [
      { id: 1, title: 'Launch review', event_type: 'meeting', start_at: '2026-09-12T12:00:00Z', end_at: '2026-09-12T13:00:00Z' },
    ],
    onOpenEvent,
  })

  fireEvent.click(screen.getByText('Launch review').closest('button'))

  expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
})

it('separates online teammates from recent activity and names missing check-ins', () => {
  renderDashboard([], noop, [], {
    checkIns: [{ id: 1, user_id: 1, date: '2026-09-12' }],
    members: [
      { id: 1, first_name: 'Ada', last_name: 'Online', email: 'ada@example.com', presence: 'available', last_seen_at: new Date().toISOString() },
      { id: 2, first_name: 'Dana', last_name: 'Offline', email: 'dana@example.com', presence: 'available', last_seen_at: '2020-01-01T00:00:00Z' },
    ],
  })

  const presencePanel = screen.getByRole('heading', { name: 'Team presence' }).closest('.today-panel')
  const presence = within(presencePanel)
  const online = within(presence.getByRole('heading', { name: /Online now/ }).closest('.today-presence-group'))
  const recent = within(presence.getByRole('heading', { name: /Recently active/ }).closest('.today-presence-group'))
  expect(online.getByText('Ada Online')).toBeInTheDocument()
  expect(online.queryByText('Dana Offline')).not.toBeInTheDocument()
  expect(recent.getByText('Dana Offline')).toBeInTheDocument()

  const checkInPanel = screen.getByRole('heading', { name: 'Check-ins' }).closest('.today-panel')
  expect(within(checkInPanel).getByText('1 of 2')).toBeInTheDocument()
  expect(within(checkInPanel).getByText('Dana Offline')).toBeInTheDocument()

  fireEvent.click(within(checkInPanel).getByRole('button', { name: 'Collapse Check-ins' }))
  expect(within(checkInPanel).queryByText('1 of 2')).not.toBeInTheDocument()
  expect(within(checkInPanel).getByRole('button', { name: 'Expand Check-ins' })).toBeInTheDocument()
})

it('hands a messaging target to Chats instead of racing a window event', () => {
  // The Chats view is lazy-loaded, so the old setTimeout(0) event fired before
  // anything was listening and the conversation silently never opened.
  const onNavigate = vi.fn()
  renderDashboard([], noop, [], {
    members: [{ id: 9, first_name: 'Dana', last_name: 'Reed', email: 'dana@example.com', role: 'member' }],
    onNavigate,
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open Dana Reed profile' }))
  fireEvent.click(screen.getByRole('button', { name: /Send message/ }))

  expect(onNavigate).toHaveBeenCalledWith('Chats')
  expect(takePendingDirectMessage()).toBe(9)
  // Claimed once, so a remount cannot reopen the same conversation.
  expect(takePendingDirectMessage()).toBeNull()
})

it('shows an assigned task in My tasks and keeps unassigned work out of the queue', () => {
  render(
    <MyTasksView
      tasks={[
        { id: 1, title: 'Assigned to me', status: 'todo', assignee_id: 7, member: 'Nate Foster', priority: 'normal', tag: 'Ops', bucket: 'Backlog' },
        { id: 2, title: 'Nobody owns this', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'normal', tag: 'Ops', bucket: 'Backlog' },
      ]}
      currentUserId={7}
      currentUserName="Nate Foster"
      projects={[]}
      buckets={[{ id: 1, name: 'Backlog' }]}
      onAddTask={noop}
      onOpenTask={noop}
      onComplete={noop}
      onStatusChange={noop}
      onDelete={noop}
      canManageTasks={false}
    />,
  )

  expect(screen.getByText('Assigned to me')).toBeInTheDocument()
  expect(screen.queryByText('Nobody owns this')).not.toBeInTheDocument()
})

it('presents task completion as a labelled checkbox with the correct next action', () => {
  const onComplete = vi.fn()
  const { rerender } = render(
    <MyTasksView
      tasks={[{ id: 3, title: 'Review copy', status: 'todo', assignee_id: 7, member: 'Nate Foster', priority: 'normal', tag: 'Ops', bucket: 'Backlog' }]}
      currentUserId={7}
      currentUserName="Nate Foster"
      projects={[]}
      buckets={[{ id: 1, name: 'Backlog' }]}
      onAddTask={noop}
      onOpenTask={noop}
      onComplete={onComplete}
      onStatusChange={noop}
      onDelete={noop}
      canManageTasks
    />,
  )

  const completion = screen.getByRole('checkbox', { name: 'Complete Review copy' })
  expect(completion).toHaveAttribute('aria-checked', 'false')
  expect(completion).toHaveAttribute('title', 'Mark task complete')
  fireEvent.click(completion)
  expect(onComplete).toHaveBeenCalledWith(3)

  rerender(
    <MyTasksView
      tasks={[{ id: 3, title: 'Review copy', status: 'done', assignee_id: 7, member: 'Nate Foster', priority: 'normal', tag: 'Ops', bucket: 'Backlog' }]}
      currentUserId={7}
      currentUserName="Nate Foster"
      projects={[]}
      buckets={[{ id: 1, name: 'Backlog' }]}
      onAddTask={noop}
      onOpenTask={noop}
      onComplete={onComplete}
      onStatusChange={noop}
      onDelete={noop}
      canManageTasks
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Completed 1/ }))
  const completed = screen.getByRole('checkbox', { name: 'Reopen Review copy' })
  expect(completed).toHaveAttribute('aria-checked', 'true')
  expect(completed).toHaveAttribute('title', 'Reopen task')
})

it('opens the board on the tasks its headline number counted, not the personal queue', () => {
  // The overdue count covered the whole workspace but the card opened My tasks,
  // which only ever holds work assigned to you. A task nobody had picked up was
  // counted, then not shown - the count and the view behind it disagreed.
  const onOpenBoard = vi.fn()
  const { container } = renderDashboard(
    [
      {
        id: 1,
        title: 'Late and unowned',
        status: 'todo',
        assignee_id: null,
        member: 'Unassigned',
        priority: 'high',
        tag: 'Ops',
        due_date: '2026-09-04',
      },
    ],
    onOpenBoard,
  )

  expect(container.querySelector('.today-metric-overdue strong').textContent).toBe('1')
  fireEvent.click(container.querySelector('.today-metric-overdue'))
  expect(onOpenBoard).toHaveBeenCalledWith('overdue')
})

it('lists exactly the tasks a focus counts, including ones nobody owns', () => {
  // The board's own Unassigned tile counted tasks no member card could ever show,
  // because the people view lists a task only under the member who owns it.
  const tasks = [
    { id: 1, title: 'Late and unowned', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', due_date: dayOffset(-3) },
    { id: 2, title: 'Late for Dana', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'normal', due_date: dayOffset(-1) },
    { id: 3, title: 'Someday', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'low', due_date: dayOffset(20) },
  ]
  renderBoard({ tasks, focus: 'overdue' })

  expect(screen.getByText('Late and unowned')).toBeInTheDocument()
  expect(screen.getByText('Late for Dana')).toBeInTheDocument()
  expect(screen.queryByText('Someday')).not.toBeInTheDocument()
})

it('clears the focus when the tile that set it is pressed again', () => {
  const onFocusChange = vi.fn()
  const { container } = renderBoard({
    tasks: [
      { id: 1, title: 'Late', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', due_date: dayOffset(-3) },
    ],
    focus: 'overdue',
    onFocusChange,
  })

  fireEvent.click(container.querySelector('.team-board-metrics button.active'))
  expect(onFocusChange).toHaveBeenCalledWith('all')
})

it('treats cancelled work as terminal in Team totals', () => {
  const { container } = renderBoard({
    tasks: [
      { id: 1, title: 'Open work', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
      { id: 2, title: 'Cancelled overdue work', status: 'cancelled', assignee_id: null, member: 'Unassigned', priority: 'urgent', due_date: dayOffset(-4) },
    ],
  })

  const counts = [...container.querySelectorAll('.team-board-metrics strong')].map(
    node => node.textContent,
  )
  expect(counts).toEqual(['1', '0', '0', '0'])
  expect(screen.queryByText('Cancelled overdue work')).not.toBeInTheDocument()
})

it('excludes cancelled work from a member completion rate', () => {
  renderBoard({
    tasks: [
      { id: 1, title: 'Finished work', status: 'done', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
      { id: 2, title: 'Cancelled work', status: 'cancelled', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
    ],
  })

  fireEvent.click(screen.getByRole('tab', { name: /Workload/ }))
  const card = screen.getByRole('button', { name: 'Open workload for Dana Reed' })
  expect(within(card).getByText('100%')).toBeInTheDocument()
})

it('keeps access administration inside the admin-only Team tab', () => {
  const memberView = renderBoard({ tasks: [] })

  expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Workload/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Tasks/ })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /Availability/ })).toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: /People & access/ })).not.toBeInTheDocument()

  memberView.unmount()
  renderBoard({ tasks: [], canManageMembers: true })
  fireEvent.click(screen.getByRole('tab', { name: /People & access/ }))
  expect(screen.getByRole('heading', { name: 'People & access' })).toBeInTheDocument()
})
