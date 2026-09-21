import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import ProjectKanbanBoard, { projectKanbanColumnForTask } from './ProjectKanbanBoard.jsx'

const tasks = [
  { id: 91, title: 'Design UI', status: 'todo', priority: 'High', can_edit: true },
  { id: 92, title: 'Review copy', status: 'review', priority: 'Normal', can_edit: true },
]

const renderBoard = (props = {}) => render(<ProjectKanbanBoard tasks={tasks} onOpenTask={vi.fn()} onStatusChange={vi.fn()} canManageTasks {...props} />)

it('classifies API statuses into the designed project lanes', () => {
  expect(projectKanbanColumnForTask({ status: 'in_progress' }).label).toBe('In progress')
  expect(projectKanbanColumnForTask({ status: 'on_hold' }).label).toBe('On hold')
  expect(projectKanbanColumnForTask({ status: '' }).label).toBe('Backlog')
})

it('moves a task to another status lane by drag and drop', () => {
  const onStatusChange = vi.fn()
  const { container } = renderBoard({ onStatusChange })
  const taskCard = screen.getByText('Design UI').closest('.project-kanban-task')
  const reviewColumn = screen.getByRole('region', { name: 'Review column' })
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(() => 'task:91'),
  }

  fireEvent.dragStart(taskCard, { dataTransfer })
  fireEvent.dragEnter(reviewColumn, { dataTransfer })
  expect(reviewColumn).toHaveClass('is-drop-target')
  fireEvent.drop(reviewColumn, { dataTransfer })

  expect(onStatusChange).toHaveBeenCalledWith(91, 'review')
  expect(container.querySelector('.project-kanban-task.is-dragging')).not.toBeInTheDocument()
})

it('moves a task to another status from the keyboard-accessible selector', async () => {
  const onStatusChange = vi.fn()
  const user = userEvent.setup()
  renderBoard({ onStatusChange })

  await user.click(screen.getByRole('combobox', { name: 'Change status for Design UI' }))
  await user.click(screen.getByRole('option', { name: 'In progress' }))

  expect(onStatusChange).toHaveBeenCalledWith(91, 'in progress')
})

it('keeps read-only tasks fixed in their lane', () => {
  renderBoard({
    tasks: [{ id: 94, title: 'View-only task', status: 'todo', can_edit: false }],
    canManageTasks: false,
  })

  expect(screen.getByText('View-only task').closest('.project-kanban-task')).toHaveAttribute('draggable', 'false')
  expect(screen.queryByRole('combobox', { name: 'Change status for View-only task' })).not.toBeInTheDocument()
})
