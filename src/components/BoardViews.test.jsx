import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MyTasksView, ProjectRiskIssuePanel, TeamBoardView, TodayDashboard } from './BoardViews.jsx'
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
  members = [{ id: 9, first_name: 'Dana', last_name: 'Reed', role: 'member' }],
}) =>
  render(
    <TeamBoardView
      tasks={tasks}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      workspaceRole={workspaceRole}
      members={members}
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

it('keeps the legacy risk register heading out of the page and in the toolbar controls', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/1/risks-issues/': { records: [] },
  })
  const { container } = render(
    <ProjectRiskIssuePanel
      projects={[
        { id: 42, name: 'Safron Website' },
        { id: 43, name: 'Billing Migration' },
      ]}
      workspaceId={1}
      canManage
    />,
  )

  const toolbar = container.querySelector('.project-register-toolbar')
  expect(toolbar).not.toBeNull()
  expect(screen.queryByText('Project controls')).not.toBeInTheDocument()
  expect(screen.queryByText('Risk register & issue log')).not.toBeInTheDocument()
  expect(
    within(toolbar).getByRole('combobox', {
      name: 'Select project for risk and issue tracking',
    }),
  ).toBeInTheDocument()
  expect(within(toolbar).getByRole('button', { name: 'Add new' })).toBeInTheDocument()
  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/risks-issues/'))
})

it('presents the project record form as one clear dialog hierarchy', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/1/risks-issues/': { records: [] },
  })
  const user = userEvent.setup()
  render(
    <ProjectRiskIssuePanel
      projects={[{ id: 42, name: 'Safron Website' }]}
      workspaceId={1}
      canManage
    />,
  )

  await user.click(screen.getByRole('button', { name: 'Add new' }))

  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('heading', { name: 'Add a new record' })).toBeInTheDocument()
  expect(within(dialog).getByText("Capture a risk or an active issue to keep this project's controls current.")).toBeInTheDocument()
  expect(within(dialog).queryByText('Project controls')).not.toBeInTheDocument()
  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/risks-issues/'))
})

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
  const memberButton = screen.getByRole('button', { name: 'Open Dana Reed profile' })
  const memberAvatar = memberButton.querySelector('.pencil-team-avatar')
  expect(memberAvatar).toBeInTheDocument()
  expect(memberAvatar.querySelector('.presence-dot')).toBeInTheDocument()
  expect(memberButton.querySelector('.pencil-team-person-copy')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Team capacity' })).toBeInTheDocument()
})

it('filters the Team capacity table from the availability tabs', () => {
  const lastSeenAt = new Date().toISOString()
  const members = [
    { id: 1, first_name: 'Ada', last_name: 'Available', role: 'member', presence: 'available', last_seen_at: lastSeenAt, daily_capacity_minutes: 480, weekly_capacity_minutes: 2400 },
    { id: 2, first_name: 'Ben', last_name: 'Capacity', role: 'member', presence: 'busy', last_seen_at: lastSeenAt, daily_capacity_minutes: 480, weekly_capacity_minutes: 1200 },
    { id: 3, first_name: 'Cara', last_name: 'Overloaded', role: 'member', presence: 'busy', last_seen_at: lastSeenAt, daily_capacity_minutes: 480, weekly_capacity_minutes: 900 },
    { id: 4, first_name: 'Dana', last_name: 'Away', role: 'member', presence: 'away', last_seen_at: lastSeenAt, daily_capacity_minutes: 480, weekly_capacity_minutes: 2400 },
  ]
  const tasks = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      title: `Ben task ${index + 1}`,
      status: 'todo',
      assignee_id: 2,
      member: 'Ben Capacity',
      priority: 'normal',
      tag: 'Ops',
    })),
    ...Array.from({ length: 9 }, (_, index) => ({
      id: index + 20,
      title: `Cara task ${index + 1}`,
      status: 'todo',
      assignee_id: 3,
      member: 'Cara Overloaded',
      priority: 'normal',
      tag: 'Ops',
    })),
  ]

  renderBoard({ tasks, members })

  expect(screen.getByRole('tab', { name: 'All 4' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('button', { name: 'Open Ada Available profile' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Ben Capacity profile' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Cara Overloaded profile' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Dana Away profile' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: 'At capacity 1' }))
  expect(screen.getByRole('tab', { name: 'At capacity 1' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('button', { name: 'Open Ada Available profile' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Ben Capacity profile' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Cara Overloaded profile' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: 'Overloaded 1' }))
  expect(screen.queryByRole('button', { name: 'Open Ben Capacity profile' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Open Cara Overloaded profile' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: 'Available 1' }))
  expect(screen.getByRole('button', { name: 'Open Ada Available profile' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Ben Capacity profile' })).not.toBeInTheDocument()
})

it('uses each members configured daily and weekly hours for Team capacity', () => {
  const members = [{ id: 9, first_name: 'Dana', last_name: 'Reed', role: 'member', daily_capacity_minutes: 360, weekly_capacity_minutes: 1800 }]
  const tasks = [
    { id: 1, title: 'Discovery', status: 'todo', assignee_id: 9, member: 'Dana Reed', estimate_minutes: 600, priority: 'normal', tag: 'Ops' },
    { id: 2, title: 'Delivery', status: 'in progress', assignee_id: 9, member: 'Dana Reed', estimate_minutes: 300, priority: 'normal', tag: 'Ops' },
  ]

  renderBoard({ tasks, members })

  expect(screen.getAllByText('15h / 30h').length).toBeGreaterThan(0)
  expect(screen.getByText('1 member · capacity 30h')).toBeInTheDocument()
  expect(screen.getByText('50% allocated · 15h remaining')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Open Dana Reed profile' }))
  expect(screen.getByText(/of 6h recorded today/)).toBeInTheDocument()
  expect(screen.getByText('30h weekly capacity')).toBeInTheDocument()
})

it('uses server-side estimate totals for paginated Team capacity', async () => {
  mockApi({
    '/api/workspaces/5/tasks/': {
      tasks: [
        { id: 1, title: 'Page one task', status: 'todo', assignee_id: 9, member: 'Dana Reed', estimate_minutes: 600, priority: 'normal', tag: 'Ops' },
      ],
      pagination: {
        page: 1,
        page_size: 25,
        total_items: 3,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      },
      summary: {
        counts: { open: 3, blocked: 0, overdue: 0, unassigned: 0 },
        by_owner: [
          {
            assignee_id: 9,
            total: 3,
            open: 3,
            overdue: 0,
            blocked: 0,
            due_soon: 0,
            urgent: 0,
            high: 0,
            completed: 0,
            tracked: 3,
            estimated_minutes: 1200,
            estimated_open: 2,
          },
        ],
      },
    },
  })

  renderBoard({
    tasks: [],
    workspaceId: 5,
    members: [{ id: 9, first_name: 'Dana', last_name: 'Reed', role: 'member', daily_capacity_minutes: 480, weekly_capacity_minutes: 1800 }],
  })

  expect(await screen.findAllByText('23h / 30h')).not.toHaveLength(0)
  expect(screen.getByText('77% allocated · 7h remaining')).toBeInTheDocument()
})

it('uses saved fractional weekly hours in My Tasks and preserves zero capacity', () => {
  const props = {
    tasks: [],
    currentUserId: 7,
    currentUserName: 'Nate Foster',
    projects: [],
    buckets: [],
    onAddTask: noop,
    onOpenTask: noop,
    onComplete: noop,
    onStatusChange: noop,
    onDelete: noop,
    canManageTasks: false,
  }
  const { rerender } = render(
    <MyTasksView
      {...props}
      members={[{ id: 7, weekly_capacity_minutes: 2250 }]}
    />,
  )

  expect(screen.getByText(/This week .* capacity 37\.5h/)).toBeInTheDocument()

  rerender(
    <MyTasksView
      {...props}
      members={[{ id: 7, weekly_capacity_minutes: 0 }]}
    />,
  )
  expect(screen.getByText(/This week .* capacity 0h/)).toBeInTheDocument()
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

it('renders only the five dashboard task rows from the design', () => {
  renderDashboard(
    Array.from({ length: 6 }, (_, index) => ({
      id: index + 1,
      title: `Dashboard task ${index + 1}`,
      status: 'todo',
      assignee_id: 7,
      member: 'Nate Foster',
      priority: 'normal',
      tag: 'Ops',
    })),
  )

  const panel = within(todayPanel('tasks'))
  expect(panel.getAllByText(/^Dashboard task /)).toHaveLength(5)
  expect(panel.queryByText('Dashboard task 6')).not.toBeInTheDocument()
})

it('keeps the upcoming events card mounted without inventing an empty state', () => {
  renderDashboard([])

  expect(screen.getByRole('heading', { name: 'Upcoming events' })).toBeInTheDocument()
  expect(screen.queryByText('No upcoming events.')).not.toBeInTheDocument()
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

  // The rail's "Recently completed" card is the way into the Done band, which
  // opens below the working list rather than swapping the list out for it.
  fireEvent.click(screen.getByRole('button', { name: 'View all completed' }))
  const completed = screen.getByRole('checkbox', { name: 'Reopen Review copy' })
  expect(completed).toHaveAttribute('aria-checked', 'true')
  expect(completed).toHaveAttribute('title', 'Reopen task')
})

it('holds completed work in a folded Done band under the open list', () => {
  render(
    <MyTasksView
      tasks={[
        { id: 3, title: 'Review copy', status: 'todo', assignee_id: 7, member: 'Nate Foster', priority: 'normal', tag: 'Ops', bucket: 'Backlog' },
        { id: 4, title: 'Ship release', status: 'done', assignee_id: 7, member: 'Nate Foster', priority: 'normal', tag: 'Ops', bucket: 'Backlog', completed_at: '2026-09-11T09:00:00Z' },
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
      canManageTasks
    />,
  )

  // The open task is listed; the finished one is not, and the band counts it.
  expect(screen.getByRole('button', { name: 'Review copy' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Ship release' })).not.toBeInTheDocument()
  const band = screen.getByRole('button', { name: 'Show Done (1 item)' })

  fireEvent.click(band)
  expect(screen.getByRole('button', { name: 'Ship release' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Review copy' })).toBeInTheDocument()
})

it('keeps the P2 row status, due date, owner, and action menu in their own slots', async () => {
  const onDelete = vi.fn()
  const { container } = render(
    <MyTasksView
      tasks={[
        {
          id: 3,
          title: 'Review copy',
          status: 'todo',
          assignee_id: 7,
          member: 'Nate Foster',
          priority: 'normal',
          tag: 'Ops',
          bucket: 'Backlog',
        },
      ]}
      currentUserId={7}
      currentUserName="Nate Foster"
      projects={[]}
      buckets={[{ id: 1, name: 'Backlog' }]}
      onAddTask={noop}
      onOpenTask={noop}
      onComplete={noop}
      onStatusChange={noop}
      onDelete={onDelete}
      canManageTasks
    />,
  )

  const row = container.querySelector('.my-task-row')
  expect(row).not.toBeNull()
  expect(row.querySelector('.my-task-status-slot .task-status-pill')).toHaveTextContent(
    'To do',
  )
  expect(row.querySelector('.my-task-due')).toHaveTextContent('No due date')
  expect(row.querySelector('.row-avatar')).toHaveTextContent('NF')

  const actions = within(row).getByRole('button', {
    name: 'Open actions for Review copy',
  })
  expect(actions).toHaveClass('opacity-0')
  fireEvent.click(actions)
  const archive = await screen.findByRole('button', { name: 'Archive task' })
  fireEvent.click(archive)
  expect(onDelete).toHaveBeenCalledWith(3)
})

it('offers owners a permanent delete action from the My Tasks row menu', async () => {
  const onDeletePermanently = vi.fn()
  const { container } = render(
    <MyTasksView
      tasks={[
        {
          id: 3,
          title: 'Review copy',
          status: 'todo',
          assignee_id: 7,
          member: 'Nate Foster',
          priority: 'normal',
          tag: 'Ops',
          bucket: 'Backlog',
        },
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
      onDeletePermanently={onDeletePermanently}
      canDeletePermanently
      canManageTasks
    />,
  )

  const row = container.querySelector('.my-task-row')
  const actions = within(row).getByRole('button', {
    name: 'Open actions for Review copy',
  })

  fireEvent.click(actions)
  const permanentDelete = await screen.findByRole('button', { name: 'Delete permanently' })
  fireEvent.click(permanentDelete)
  expect(onDeletePermanently).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
})

it('filters the mobile task queue through the P2 All, Overdue, and Blocked chips', () => {
  render(
    <MyTasksView
      tasks={[
        {
          id: 1,
          title: 'Late task',
          status: 'todo',
          assignee_id: 7,
          member: 'Nate Foster',
          priority: 'normal',
          due_date: dayOffset(-1),
        },
        {
          id: 2,
          title: 'Blocked task',
          status: 'blocked',
          assignee_id: 7,
          member: 'Nate Foster',
          priority: 'normal',
          due_date: dayOffset(2),
        },
        {
          id: 3,
          title: 'Future task',
          status: 'todo',
          assignee_id: 7,
          member: 'Nate Foster',
          priority: 'normal',
          due_date: dayOffset(3),
        },
      ]}
      currentUserId={7}
      currentUserName="Nate Foster"
      projects={[]}
      buckets={[]}
      onAddTask={noop}
      onOpenTask={noop}
      onComplete={noop}
      onStatusChange={noop}
      onDelete={noop}
      canManageTasks={false}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: /Overdue 1/ }))
  expect(screen.getByText('Late task')).toBeInTheDocument()
  expect(screen.queryByText('Blocked task')).not.toBeInTheDocument()
  expect(screen.queryByText('Future task')).not.toBeInTheDocument()

  fireEvent.click(
    screen
      .getAllByRole('button', { name: /Blocked 1/ })
      .find((button) => button.classList.contains('my-task-mobile-chip')),
  )
  expect(screen.queryByText('Late task')).not.toBeInTheDocument()
  expect(screen.getByText('Blocked task')).toBeInTheDocument()
  expect(screen.queryByText('Future task')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /All 3/ }))
  expect(screen.getByText('Late task')).toBeInTheDocument()
  expect(screen.getByText('Blocked task')).toBeInTheDocument()
  expect(screen.getByText('Future task')).toBeInTheDocument()
  expect(document.querySelector('.my-task-mobile-sort')).toBeInTheDocument()
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
  expect(screen.getByRole('tab', { name: /At capacity/ })).toBeInTheDocument()
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
