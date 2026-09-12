import { render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MyTasksView, TodayDashboard } from './BoardViews.jsx'

const noop = vi.fn()

const renderDashboard = tasks =>
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
      onComplete={noop}
      onStatusChange={noop}
      onSubmitShift={noop}
      onChangePresence={noop}
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
