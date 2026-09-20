import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
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

it('loads Team task data for the Pencil capacity screen', async () => {
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
  expect(container.querySelector('.pencil-team-view')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Dana Reed profile' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Team capacity' })).toBeInTheDocument()
})

const todayPanel = name => document.querySelector(`[data-panel="${name}"]`)

it('shows only tasks assigned to the current user today', () => {
  renderDashboard([
    { id: 1, title: 'Mine to do', status: 'todo', assignee_id: 7, member: 'Nate Foster', priority: 'high', tag: 'Ops' },
    { id: 2, title: 'Nobody owns this', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', tag: 'Ops' },
    { id: 3, title: 'Someone else owns this', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'high', tag: 'Ops' },
  ])

  const panel = within(todayPanel('tasks'))
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

  const panel = within(todayPanel('tasks'))
  expect(panel.getByText('Nothing is assigned to you today.')).toBeInTheDocument()
  expect(panel.queryByText('Nobody owns this')).not.toBeInTheDocument()
})

it('shows the real check-in denominator instead of inventing one for an empty workspace', () => {
  // This read `{count} of {members.length || 1}`, so a workspace with nobody in
  // it claimed "0 of 1".
  renderDashboard([])

  expect(screen.queryByText('0 of 1')).not.toBeInTheDocument()
})

it('lists a carried-over event today and keeps future events in the upcoming card', () => {
  // Matching on start_at === today dropped every event carried over from a
  // previous day.
  renderDashboard([], noop, [], {
    events: [
      { id: 1, title: 'Offsite', event_type: 'meeting', start_at: '2026-09-11T12:00:00Z', end_at: '2026-09-12T12:00:00Z' },
      { id: 2, title: 'Future thing', event_type: 'meeting', start_at: '2026-09-13T12:00:00Z', end_at: '2026-09-13T13:00:00Z' },
    ],
  })

  expect(screen.getByText('Offsite')).toBeInTheDocument()
  const upcomingCard = screen
    .getByRole('heading', { name: 'Upcoming events' })
    .closest('section')
  expect(within(upcomingCard).getByText('Future thing')).toBeInTheDocument()
  // A carried-over event shows the day it began, not a bare time that reads as
  // if it started today.
  expect(screen.getByText(/^11 Sep /)).toBeInTheDocument()
})

it('shows the upcoming events card when no event overlaps today', () => {
  renderDashboard([], noop, [], {
    events: [
      { id: 2, title: 'Future thing', event_type: 'meeting', start_at: '2026-09-13T12:00:00Z', end_at: '2026-09-13T13:00:00Z' },
    ],
  })

  const upcomingCard = screen
    .getByRole('heading', { name: 'Upcoming events' })
    .closest('section')
  expect(within(upcomingCard).getByText('Future thing')).toBeInTheDocument()
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

it('shows who has checked in and who is still pending', () => {
  renderDashboard([], noop, [], {
    checkIns: [{ id: 1, user_id: 1, date: '2026-09-12' }],
    members: [
      { id: 1, first_name: 'Ada', last_name: 'Online', email: 'ada@example.com', presence: 'available', last_seen_at: new Date().toISOString() },
      { id: 2, first_name: 'Dana', last_name: 'Offline', email: 'dana@example.com', presence: 'available', last_seen_at: '2020-01-01T00:00:00Z' },
    ],
  })

  const panel = within(todayPanel('check-ins'))
  expect(panel.getByText('1 of 2')).toBeInTheDocument()
  expect(panel.getByText('Ada Online')).toBeInTheDocument()
  expect(panel.getByText('Dana Offline')).toBeInTheDocument()
  // Who is in and who is not, on the row itself rather than in a separate list.
  expect(panel.getByText('Submitted')).toBeInTheDocument()
  expect(panel.getByText('Pending')).toBeInTheDocument()
  expect(panel.getByText('1 member is still pending')).toBeInTheDocument()
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

  // Completed work moved behind the rail's "Recently completed" card, which
  // swaps the list for the completed one rather than adding a tab beside it.
  fireEvent.click(screen.getByRole('button', { name: 'View all completed' }))
  const completed = screen.getByRole('checkbox', { name: 'Reopen Review copy' })
  expect(completed).toHaveAttribute('aria-checked', 'true')
  expect(completed).toHaveAttribute('title', 'Reopen task')
})

it('opens the board on the tasks its tile counted, not the personal queue', () => {
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
      {
        id: 2,
        title: 'Due today',
        status: 'todo',
        assignee_id: 7,
        member: 'Nate Foster',
        priority: 'high',
        tag: 'Ops',
        due_date: '2026-09-12',
      },
    ],
    onOpenBoard,
  )

  const tile = container.querySelector('[data-metric="due-today"]')
  expect(tile).not.toBeNull()
  // One task falls due today and one is already late, and both read off the
  // same filter set the tile opens.
  expect(tile.textContent).toContain('1 overdue')

  fireEvent.click(tile)
  expect(onOpenBoard).toHaveBeenCalledWith('due-today')
})

it('renders the Pencil capacity table from live members', () => {
  const tasks = [
    { id: 1, title: 'Late and unowned', status: 'todo', assignee_id: null, member: 'Unassigned', priority: 'high', due_date: dayOffset(-3) },
    { id: 2, title: 'Late for Dana', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'normal', due_date: dayOffset(-1) },
    { id: 3, title: 'Someday', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'low', due_date: dayOffset(20) },
  ]
  renderBoard({ tasks, focus: 'overdue' })

  expect(screen.getByRole('button', { name: 'Open Dana Reed profile' })).toBeInTheDocument()
  expect(screen.getAllByText('Available').length).toBeGreaterThan(0)
})

it('shows P9 availability filters', () => {
  renderBoard({ tasks: [] })
  expect(screen.getByRole('tablist', { name: 'Team capacity filters' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /At capacity/ })).toBeInTheDocument()
})

it('does not turn cancelled work into capacity allocation', () => {
  const { container } = renderBoard({
    tasks: [
      { id: 1, title: 'Open work', status: 'todo', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
      { id: 2, title: 'Cancelled overdue work', status: 'cancelled', assignee_id: null, member: 'Unassigned', priority: 'urgent', due_date: dayOffset(-4) },
    ],
  })

  const counts = [...container.querySelectorAll('.pencil-team-task-count')].map(node => node.textContent)
  expect(counts).toEqual(['1 tasks'])
  expect(screen.queryByText('Cancelled overdue work')).not.toBeInTheDocument()
})

it('keeps the Team member profile action available', () => {
  renderBoard({
    tasks: [
      { id: 1, title: 'Finished work', status: 'done', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
      { id: 2, title: 'Cancelled work', status: 'cancelled', assignee_id: 9, member: 'Dana Reed', priority: 'normal' },
    ],
  })

  fireEvent.click(screen.getByRole('button', { name: 'Open Dana Reed profile' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('keeps the admin invitation action on the Pencil Team screen', () => {
  const memberView = renderBoard({ tasks: [] })

  expect(screen.queryByRole('button', { name: 'Invite' })).not.toBeInTheDocument()

  memberView.unmount()
  renderBoard({ tasks: [], canManageMembers: true })
  expect(screen.getByRole('button', { name: 'Invite' })).toBeInTheDocument()
})
