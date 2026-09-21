import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import ProjectKanbanBoard, { DEFAULT_PROJECT_KANBAN_COLUMN_ORDER, normalizeProjectKanbanColumnOrder, projectKanbanColumnForTask } from './ProjectKanbanBoard.jsx'

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
  expect(taskCard).toHaveClass('is-dragging')
  const targetTaskCard = screen.getByText('Review copy').closest('.project-kanban-task')
  fireEvent.dragEnter(reviewColumn, { dataTransfer })
  expect(reviewColumn).toHaveClass('is-drop-target')
  fireEvent.dragEnter(targetTaskCard, { dataTransfer })
  expect(targetTaskCard).toHaveClass('is-drop-target')
  fireEvent.drop(reviewColumn, { dataTransfer })

  expect(onStatusChange).toHaveBeenCalledWith(91, 'review')
  expect(container.querySelector('.project-kanban-task.is-dragging')).not.toBeInTheDocument()
  expect(container.querySelector('.project-kanban-task.is-drop-target')).not.toBeInTheDocument()
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

it('normalizes a persisted column order and appends any missing status lanes', () => {
  expect(normalizeProjectKanbanColumnOrder(['done', 'backlog', 'done', 'unknown'])).toEqual([
    'done',
    'backlog',
    'todo',
    'in-progress',
    'review',
    'blocked',
    'on-hold',
  ])
})

it('reorders project kanban columns by drag and drop', () => {
  const onColumnReorder = vi.fn()
  renderBoard({ onColumnReorder, canReorderColumns: true })
  const backlogColumn = screen.getByRole('region', { name: 'Backlog column' })
  const reviewColumn = screen.getByRole('region', { name: 'Review column' })
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn(),
    getData: vi.fn(() => 'column:backlog'),
  }

  fireEvent.dragStart(backlogColumn.querySelector('.project-kanban-column-heading'), { dataTransfer })
  fireEvent.dragEnter(reviewColumn, { dataTransfer })

  expect(reviewColumn).toHaveClass('is-column-drop-target')
  expect(backlogColumn).toHaveClass('is-column-source')

  fireEvent.drop(reviewColumn, { dataTransfer })

  expect(onColumnReorder).toHaveBeenCalledWith([
    'todo',
    'in-progress',
    'review',
    'backlog',
    'blocked',
    'on-hold',
    'done',
  ])
})

it('offers keyboard-reachable project lane move controls', async () => {
  const user = userEvent.setup()
  const onColumnReorder = vi.fn()
  renderBoard({ onColumnReorder, canReorderColumns: true })

  await user.click(screen.getByRole('button', { name: 'Move Backlog right' }))

  expect(onColumnReorder).toHaveBeenCalledWith([
    'todo',
    'backlog',
    'in-progress',
    'review',
    'blocked',
    'on-hold',
    'done',
  ])
})

it('can nudge a project lane across the full board and back again', async () => {
  const user = userEvent.setup()
  const onColumnReorder = vi.fn()

  function ReorderableBoard() {
    const [columnOrder, setColumnOrder] = useState(DEFAULT_PROJECT_KANBAN_COLUMN_ORDER)
    return <ProjectKanbanBoard
      tasks={tasks}
      onOpenTask={vi.fn()}
      onStatusChange={vi.fn()}
      canManageTasks
      columnOrder={columnOrder}
      canReorderColumns
      onColumnReorder={nextOrder => {
        onColumnReorder(nextOrder)
        setColumnOrder(nextOrder)
      }}
    />
  }

  render(<ReorderableBoard />)
  const laneNames = () => screen.getAllByRole('region').map(region => region.getAttribute('aria-label').replace(' column', ''))

  for (let step = 0; step < 6; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Move Backlog right' }))
  }
  expect(laneNames()).toEqual(['To do', 'In progress', 'Review', 'Blocked', 'On hold', 'Done', 'Backlog'])

  for (let step = 0; step < 6; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Move Backlog left' }))
  }
  expect(laneNames()).toEqual(['Backlog', 'To do', 'In progress', 'Review', 'Blocked', 'On hold', 'Done'])
})

it('scrolls the project lane board toward the pointer while dragging and reveals the moved lane', async () => {
  const user = userEvent.setup()
  const scrolledElements = []
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scrollIntoViewMock() {
    scrolledElements.push(this)
  })

  function ReorderableBoard() {
    const [columnOrder, setColumnOrder] = useState(DEFAULT_PROJECT_KANBAN_COLUMN_ORDER)
    return <ProjectKanbanBoard
      tasks={tasks}
      onOpenTask={vi.fn()}
      onStatusChange={vi.fn()}
      canManageTasks
      columnOrder={columnOrder}
      canReorderColumns
      onColumnReorder={setColumnOrder}
    />
  }

  const { container } = render(<ReorderableBoard />)
  const board = screen.getByLabelText('Project Kanban board')
  vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(board, 'scrollWidth', { configurable: true, value: 2200 })
  Object.defineProperty(board, 'clientWidth', { configurable: true, value: 1000 })
  const sourceHeading = container.querySelector('.project-kanban-column-heading')
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'column:backlog') }

  fireEvent.dragStart(sourceHeading, { dataTransfer })
  board.scrollLeft = 500
  const dragOverAt = clientX => {
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperties(event, {
      clientX: { value: clientX },
      pageX: { value: clientX },
      dataTransfer: { value: dataTransfer },
    })
    fireEvent(board, event)
  }
  dragOverAt(20)
  expect(board.scrollLeft).toBeLessThan(500)
  dragOverAt(980)
  expect(board.scrollLeft).toBeGreaterThan(450)
  fireEvent.dragEnd(sourceHeading, { dataTransfer })

  await user.click(screen.getByRole('button', { name: 'Move Backlog right' }))
  await waitFor(() => expect(scrolledElements.some(element => element.dataset.columnId === 'backlog')).toBe(true))
  scrollIntoView.mockRestore()
})
