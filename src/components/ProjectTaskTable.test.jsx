import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import ProjectTaskTable from './ProjectTaskTable.jsx'

const members = [
  { id: 7, first_name: 'Amara', last_name: 'Okafor', avatar_url: '/amara.png' },
  { id: 8, first_name: 'Dana', last_name: 'Reed' },
]

const tasks = [
  { id: 1, title: 'Rebuild settings nav', status: 'in_progress', priority: 'urgent', assignee_id: 7, assignee_ids: [7], member: 'Amara Okafor', bucket: 'Discovery', due_date: '2026-09-20', estimate_minutes: 240, can_edit: true },
  { id: 2, title: 'Fix billing webhooks', status: 'blocked', priority: 'high', assignee_id: 8, assignee_ids: [8], member: 'Dana Reed', bucket: 'Build', due_date: '2026-09-25', estimate_minutes: 120, can_edit: true },
  { id: 3, title: 'Migrate billing tests', status: 'review', priority: 'normal', assignee_id: null, assignee_ids: [], member: 'Unassigned', bucket: 'Build', due_date: '', estimate_minutes: 0, can_edit: true },
  { id: 4, title: 'Onboarding copy pass', status: 'todo', priority: 'low', assignee_id: 7, assignee_ids: [7], member: 'Amara Okafor', bucket: 'Discovery', due_date: '2026-09-28', estimate_minutes: 60, can_edit: true },
  { id: 5, title: 'Legal review of SOW', status: 'on_hold', priority: 'high', assignee_id: 8, assignee_ids: [8], member: 'Dana Reed', bucket: 'Review', due_date: '2026-09-29', estimate_minutes: 180, can_edit: true },
  { id: 6, title: 'Rewrite download emails', status: 'todo', priority: 'normal', assignee_id: 7, assignee_ids: [7], member: 'Amara Okafor', bucket: 'Content', due_date: '2026-09-30', estimate_minutes: 60, can_edit: true },
  { id: 7, title: 'Audit empty states', status: 'todo', priority: 'normal', assignee_id: 8, assignee_ids: [8], member: 'Dana Reed', bucket: 'Build', due_date: '2026-10-01', estimate_minutes: 120, can_edit: true },
  { id: 8, title: 'Ship design tokens', status: 'done', priority: 'normal', assignee_id: 7, assignee_ids: [7], member: 'Amara Okafor', bucket: 'Discovery', due_date: '2026-09-18', estimate_minutes: 240, can_edit: true },
  { id: 9, title: 'Close launch checklist', status: 'todo', priority: 'low', assignee_id: 8, assignee_ids: [8], member: 'Dana Reed', bucket: 'Launch', due_date: '2026-10-03', estimate_minutes: 60, can_edit: true },
  { id: 10, title: 'Archive old briefs', status: 'cancelled', priority: 'low', assignee_id: null, assignee_ids: [], member: 'Unassigned', bucket: 'Archive', due_date: '', estimate_minutes: 0, can_edit: true },
]

const renderTable = (props = {}) => render(
  <ProjectTaskTable
    tasks={tasks}
    members={members}
    canManageTasks
    today="2026-09-21"
    onOpenTask={vi.fn()}
    onComplete={vi.fn()}
    onStatusChange={vi.fn()}
    {...props}
  />,
)

const visibleTaskCount = () => screen.getAllByRole('checkbox').length

async function chooseFilter(user, name, option) {
  await user.click(screen.getByRole('combobox', { name }))
  await user.click(screen.getByRole('option', { name: option }))
}

it('renders every project task with the approved table columns', () => {
  renderTable()

  expect(visibleTaskCount()).toBe(10)
  expect(screen.getByRole('columnheader', { name: 'Task' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Priority' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Assignee' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Bucket' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Due' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Estimate' })).toBeInTheDocument()
  expect(screen.getByText(/10 tasks/)).toHaveTextContent('1 completed')
  expect(screen.getByText(/10 tasks/)).toHaveTextContent('1 blocked')
  expect(screen.getByText(/10 tasks/)).toHaveTextContent('1 overdue')
})

it('searches task copy and filters by status', async () => {
  const user = userEvent.setup({ delay: null })
  renderTable()
  const search = screen.getByRole('textbox', { name: 'Search project tasks' })

  fireEvent.change(search, { target: { value: 'billing' } })
  expect(visibleTaskCount()).toBe(2)
  fireEvent.change(search, { target: { value: '' } })

  await chooseFilter(user, 'Filter by status', 'Blocked')
  expect(visibleTaskCount()).toBe(1)
  expect(screen.getByText('Fix billing webhooks')).toBeInTheDocument()
  await chooseFilter(user, 'Filter by status', 'All statuses')
  expect(visibleTaskCount()).toBe(10)
})

it('filters by assignee and priority', async () => {
  const user = userEvent.setup({ delay: null })
  renderTable()

  await chooseFilter(user, 'Filter by assignee', 'Dana Reed')
  expect(visibleTaskCount()).toBe(4)
  await chooseFilter(user, 'Filter by assignee', 'All assignees')
  expect(visibleTaskCount()).toBe(10)

  await chooseFilter(user, 'Filter by priority', 'Urgent (P1)')
  expect(visibleTaskCount()).toBe(1)
  expect(screen.getByText('Rebuild settings nav')).toBeInTheDocument()
  await chooseFilter(user, 'Filter by priority', 'All priorities')
  expect(visibleTaskCount()).toBe(10)
})

it('filters by bucket and due-date state', async () => {
  const user = userEvent.setup({ delay: null })
  renderTable()

  await chooseFilter(user, 'Filter by bucket', 'Build')
  expect(visibleTaskCount()).toBe(3)
  await chooseFilter(user, 'Filter by bucket', 'All buckets')
  expect(visibleTaskCount()).toBe(10)

  await chooseFilter(user, 'Filter by date', 'Overdue')
  expect(visibleTaskCount()).toBe(1)
  expect(screen.getByText('Rebuild settings nav')).toBeInTheDocument()
  await chooseFilter(user, 'Filter by date', 'No due date')
  expect(visibleTaskCount()).toBe(2)
})

it('sorts through the summary control', async () => {
  const user = userEvent.setup()
  const { container } = renderTable()
  const firstTitle = () => container.querySelector('tbody tr .project-task-title-cell button')?.textContent

  expect(firstTitle()).toBe('Ship design tokens')
  await chooseFilter(user, 'Sort tasks', 'Sort: title')
  expect(firstTitle()).toBe('Archive old briefs')
  expect(screen.getByRole('combobox', { name: 'Sort tasks' })).toHaveTextContent('10 \u00B7 Sort: title')
})

it('completes tasks, changes status, and opens task details through existing callbacks', async () => {
  const user = userEvent.setup()
  const onComplete = vi.fn()
  const onStatusChange = vi.fn()
  const onOpenTask = vi.fn()
  renderTable({ onComplete, onStatusChange, onOpenTask })

  fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Rebuild settings nav' }))
  expect(onComplete).toHaveBeenCalledWith(1)

  await chooseFilter(user, 'Change status for Rebuild settings nav', 'Review')
  expect(onStatusChange).toHaveBeenCalledWith(1, 'review')

  fireEvent.click(screen.getByRole('button', { name: 'Rebuild settings nav' }))
  expect(onOpenTask).toHaveBeenCalledWith(tasks[0])
})

it('keeps read-only tasks from changing completion or status', () => {
  renderTable({
    tasks: [{ ...tasks[0], can_edit: false }],
    canManageTasks: false,
  })

  expect(screen.getByRole('checkbox', { name: 'Complete Rebuild settings nav' })).toBeDisabled()
  expect(screen.queryByRole('combobox', { name: 'Change status for Rebuild settings nav' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('row', { name: /Rebuild settings nav/ })).getByText('In progress')).toBeInTheDocument()
})

it('shows a helpful empty state when filters hide every task', async () => {
  const user = userEvent.setup()
  renderTable()

  await chooseFilter(user, 'Filter by status', 'Cancelled')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search project tasks' }), { target: { value: 'not present' } })

  expect(screen.getByText('No tasks match these filters')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(visibleTaskCount()).toBe(10)
})
