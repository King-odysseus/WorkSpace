import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { mockApi } from '../test/setup-tests.js'
import { TaskDetailDrawer } from './TaskViews.jsx'

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
