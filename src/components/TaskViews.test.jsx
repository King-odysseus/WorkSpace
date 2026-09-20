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

it('closes the task dialog and confirms an update after updating task fields', async () => {
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
    '/api/workspaces/1/tasks/': { tasks: [] },
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

    const updateButton = await screen.findByRole('button', { name: 'Save changes' })
    fireEvent.click(updateButton)

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated UI' }))
    expect(notices).toEqual(['Task updated.'])
  } finally {
    window.removeEventListener('workspace:notice', captureNotice)
  }
})

it('closes the task dialog on Escape and locks page scrolling', async () => {
  const onClose = vi.fn()
  mockApi({
    '/api/tasks/91/comments/': { comments: [] },
    '/api/tasks/91/subtasks/': { subtasks: [] },
    '/api/tasks/91/attachments/': { attachments: [] },
    '/api/workspaces/1/tasks/': { tasks: [] },
  })

  render(
    <TaskDetailDrawer
      task={task}
      workspaceId={1}
      onClose={onClose}
      onTaskUpdated={vi.fn()}
    />,
  )

  expect(await screen.findByRole('dialog', { name: /Design UI/ })).toBeInTheDocument()
  expect(document.body.style.overflow).toBe('hidden')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
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
const pickerTrigger = () => screen.getByRole('button', { name: /Choose assignees/ })
const openPicker = () => fireEvent.click(pickerTrigger())
const rowFor = index => rows()[index].closest('label').textContent

it('keeps the first ticked member as the primary as more are added', async () => {
  render(<ControlledPicker />)
  expect(pickerTrigger()).toHaveTextContent('Unassigned')
  openPicker()

  fireEvent.click(rows()[0])
  expect(pickerTrigger()).toHaveTextContent('Ada Lovelace')
  expect(rowFor(0)).toContain('Primary')
  expect(rowFor(1)).not.toContain('Primary')

  // The second tick appends rather than reordering, so the original primary holds.
  fireEvent.click(rows()[1])
  expect(pickerTrigger()).toHaveTextContent('Ada Lovelace')
  expect(pickerTrigger()).toHaveTextContent('Grace Hopper')
  expect(pickerTrigger()).not.toHaveTextContent('+ 1')
  expect(rowFor(0)).toContain('Primary')
  expect(rowFor(1)).not.toContain('Primary')
})

it('promotes the next remaining member when the primary is unticked', async () => {
  render(<ControlledPicker initial={['1', '2']} />)
  expect(pickerTrigger()).toHaveTextContent('Ada Lovelace')
  expect(pickerTrigger()).toHaveTextContent('Grace Hopper')
  openPicker()

  fireEvent.click(rows()[0])
  expect(pickerTrigger()).toHaveTextContent('Grace Hopper')
  expect(pickerTrigger()).not.toHaveTextContent('Ada Lovelace')
  expect(rowFor(1)).toContain('Primary')
})

it('falls back to the email when a member has no name', async () => {
  render(<ControlledPicker initial={['3']} />)
  expect(pickerTrigger()).toHaveTextContent('solo@example.com')
  openPicker()
  expect(rows()[2].closest('label')).toHaveTextContent('Primary')
})
