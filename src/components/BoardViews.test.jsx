import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MyTasksView, TeamBoardView, TodayDashboard } from './BoardViews.jsx'
import { toDateKey } from '../lib/workspace-format.js'

const noop = vi.fn()

const dayOffset = days => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

const renderDashboard = (tasks, onOpenBoard = noop) =>
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
      followUps={[]}
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
    />,
  )

const renderBoard = ({ tasks, focus = 'all', onFocusChange = noop }) =>
  render(
    <TeamBoardView
      tasks={tasks}
      members={[{ id: 9, first_name: 'Dana', last_name: 'Reed', role: 'member' }]}
      projects={[]}
      scope="all"
      onScopeChange={noop}
      focus={focus}
      onFocusChange={onFocusChange}
      invitations={[]}
      canManageMembers={false}
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

const myDayPanel = () =>
  screen.getByRole('heading', { name: 'My day' }).closest('.today-panel')

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
