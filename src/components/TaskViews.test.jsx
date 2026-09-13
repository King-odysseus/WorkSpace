import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { mockApi } from '../test/setup-tests.js'
import { AssigneePicker, TaskDetailDrawer } from './TaskViews.jsx'

const task = {
  id: 91,
  title: 'Design UI',
  description: '',
  assignee_id: '',
  project_id: '',
  status: 'todo',
  priority: 'normal',
  due_date: '',
  recurrence: 'none',
  bucket: 'Backlog',
  labels: [],
  blocked_by_ids: [],
  blocking_ids: [],
  can_edit: true,
}

it('closes the task drawer and confirms an update after updating task fields', async () => {
  const onClose = vi.fn()
  const onTaskUpdated = vi.fn()
  const notices = []
  const captureNotice = event => notices.push(event.detail)
  window.addEventListener('workspace:notice', captureNotice)
  mockApi({
    '/api/tasks/91/comments/': { comments: [] },
    '/api/tasks/91/subtasks/': { subtasks: [] },
    '/api/tasks/91/attachments/': { attachments: [] },
    '/api/tasks/91/': { task: { ...task, title: 'Updated UI' } },
  })

  try {
    render(
      <TaskDetailDrawer
        task={task}
        workspaceId={1}
        onClose={onClose}
        onTaskUpdated={onTaskUpdated}
      />,
    )

    const updateButton = await screen.findByRole('button', { name: 'Update task' })
    fireEvent.submit(updateButton.closest('form'))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated UI' }))
    expect(notices).toEqual(['Task updated.'])
  } finally {
    window.removeEventListener('workspace:notice', captureNotice)
  }
})

const members = [
  { id: 1, first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
  { id: 2, first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com' },
  { id: 3, first_name: '', last_name: '', email: 'solo@example.com' },
]

function ControlledPicker({ initial = [] }) {
  const [value, setValue] = useState(initial)
  return <AssigneePicker members={members} value={value} onChange={setValue} />
}

const rows = () => screen.getAllByRole('checkbox')
// Every member name appears twice - once in the collapsed summary and once in
// the list - so the summary needs its own query.
const summaryText = () => screen.getByText(/./, { selector: 'summary' }).textContent
const rowFor = index => rows()[index].closest('label').textContent

it('keeps the first ticked member as the primary as more are added', () => {
  render(<ControlledPicker />)
  expect(summaryText()).toBe('Unassigned')

  fireEvent.click(rows()[0])
  expect(summaryText()).toBe('Ada Lovelace')
  expect(rowFor(0)).toContain('Primary')
  expect(rowFor(1)).not.toContain('Primary')

  // The second tick appends rather than reordering, so the original primary holds.
  fireEvent.click(rows()[1])
  expect(summaryText()).toBe('Ada Lovelace + 1')
  expect(rowFor(0)).toContain('Primary')
  expect(rowFor(1)).not.toContain('Primary')
})

it('promotes the next remaining member when the primary is unticked', () => {
  render(<ControlledPicker initial={['1', '2']} />)
  expect(summaryText()).toBe('Ada Lovelace + 1')

  fireEvent.click(rows()[0])
  expect(summaryText()).toBe('Grace Hopper')
  expect(rowFor(1)).toContain('Primary')
})

it('falls back to the email when a member has no name', () => {
  render(<ControlledPicker initial={['3']} />)
  expect(summaryText()).toBe('solo@example.com')
})
