import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import PlannerBoard from './PlannerBoard.jsx'
import { toDateKey } from '../lib/workspace-format.js'

const renderPlanner = (props = {}) => render(
  <PlannerBoard
    buckets={[{ id: 1, name: 'Backlog' }]}
    tasks={[]}
    members={[]}
    searchQuery=""
    onSearchChange={vi.fn()}
    onStatusChange={vi.fn()}
    onOpenTask={vi.fn()}
    onDeleteTask={vi.fn()}
    onAddTask={vi.fn()}
    onTaskMove={vi.fn()}
    onBucketReorder={vi.fn()}
    onProjectFilterChange={vi.fn()}
    onCreateBucket={vi.fn()}
    onCreateWorkstream={vi.fn()}
    newBucketName=""
    setNewBucketName={vi.fn()}
    newWorkstreamName=""
    setNewWorkstreamName={vi.fn()}
    {...props}
  />,
)

const columnNames = container =>
  [...container.querySelectorAll('.planner-column-heading strong')].map(node => node.textContent)

const firePointerDrag = (element, type, dataTransfer, clientY) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientY: { value: clientY },
    dataTransfer: { value: dataTransfer },
  })
  fireEvent(element, event)
}

const fireHorizontalPointerDrag = (element, type, dataTransfer, clientX) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    dataTransfer: { value: dataTransfer },
  })
  fireEvent(element, event)
}

it('exposes accessible names for the planner toolbar', () => {
  renderPlanner()

  expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Work scope' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Workstream' })).toBeInTheDocument()
  expect(screen.getByText(/Showing operations only . 1 bucket/)).toBeInTheDocument()
})

const workspaceBuckets = [
  { id: 2, name: 'Backlog', project_id: null },
  { id: 3, name: 'New', project_id: null },
  { id: 19, name: 'Prototyping', project_id: 2 },
]

it('draws every lane when the planner is scoped to all projects', () => {
  // Scoping to a project narrows the board, but "all projects" narrows it to
  // nothing - and an empty lane list left every task in no column at all.
  const { container } = renderPlanner({
    buckets: workspaceBuckets,
    scopeMode: 'projects',
    projectFilter: 'all',
  })

  expect(columnNames(container)).toEqual(['Backlog', 'New', 'Prototyping'])
})

it('draws the operations lanes when no workstream is chosen', () => {
  const { container } = renderPlanner({
    buckets: workspaceBuckets,
    scopeMode: 'operations',
    projectFilter: 'operations',
  })

  expect(columnNames(container)).toEqual(['Backlog', 'New'])
})

it('shows a task filed in a project lane even when the task carries no project', () => {
  const { container } = renderPlanner({
    buckets: workspaceBuckets,
    scopeMode: 'projects',
    projectFilter: '2',
    tasks: [{ id: 91, title: 'Desingn UI', bucket: 'Prototyping', project_id: '', status: 'todo', priority: 'normal' }],
  })

  expect(screen.getByText('Desingn UI')).toBeInTheDocument()
  expect(columnNames(container)).toEqual(['Prototyping'])
})

it('keeps a project lane task out of the other projects', () => {
  const { container } = renderPlanner({
    buckets: workspaceBuckets,
    scopeMode: 'projects',
    projectFilter: '7',
    tasks: [{ id: 91, title: 'Desingn UI', bucket: 'Prototyping', project_id: '', status: 'todo', priority: 'normal' }],
  })

  expect(screen.queryByText('Desingn UI')).not.toBeInTheDocument()
  expect(columnNames(container)).toEqual([])
})

it('tells the user to add a lane when the chosen project has none', () => {
  renderPlanner({ buckets: workspaceBuckets, scopeMode: 'projects', projectFilter: '7' })

  expect(screen.getByText('This scope has no lanes yet. Add a bucket to start planning.')).toBeInTheDocument()
})

it('collapses lanes that share a name across projects into one column', () => {
  // Tasks name their lane by name alone, so two lanes called Design would draw the
  // same cards twice under "all projects".
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Design', project_id: 2 },
      { id: 24, name: 'Design', project_id: 8 },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
  })

  expect(columnNames(container)).toEqual(['Backlog', 'Design'])
})

const sharedLaneBuckets = [
  { id: 2, name: 'Backlog', project_id: null },
  { id: 19, name: 'Design', project_id: 2 },
  { id: 24, name: 'Design', project_id: 8 },
]
const projectlessTask = { id: 91, title: 'Design UI', bucket: 'Design', project_id: '', status: 'todo', priority: 'normal' }

it('shows a lane task with no project under all projects', () => {
  renderPlanner({
    buckets: sharedLaneBuckets,
    scopeMode: 'projects',
    projectFilter: 'all',
    tasks: [projectlessTask],
  })

  expect(screen.getByText('Design UI')).toBeInTheDocument()
})

it('does not guess a project for a lane two projects both name', () => {
  // The lane name is the only link between a task and its lane, so a task with no
  // project of its own cannot be claimed by either project that uses the name.
  const { container } = renderPlanner({
    buckets: sharedLaneBuckets,
    scopeMode: 'projects',
    projectFilter: '8',
    tasks: [projectlessTask],
  })

  expect(screen.queryByText('Design UI')).not.toBeInTheDocument()
  expect(columnNames(container)).toEqual(['Design'])
})

it('draws a borrowed lane for a project task that sits outside the project lanes', () => {
  // Moving a task to a project leaves it in whatever lane it was already in, and a
  // lane with no column draws the task nowhere - so the scope that claimed the task
  // used to be the one scope that hid it.
  const { container } = renderPlanner({
    buckets: workspaceBuckets,
    scopeMode: 'projects',
    projectFilter: '2',
    tasks: [{ id: 91, title: 'Design UI', bucket: 'Backlog', project_id: 2, status: 'todo', priority: 'normal' }],
  })

  expect(screen.getByText('Design UI')).toBeInTheDocument()
  expect(columnNames(container)).toEqual(['Prototyping', 'Backlog'])
})

it('shows a project task when the project owns no lanes at all', () => {
  const { container } = renderPlanner({
    buckets: [{ id: 2, name: 'Backlog', project_id: null }],
    scopeMode: 'projects',
    projectFilter: '2',
    tasks: [{ id: 91, title: 'Design UI', bucket: 'Backlog', project_id: 2, status: 'todo', priority: 'normal' }],
  })

  expect(screen.getByText('Design UI')).toBeInTheDocument()
  expect(columnNames(container)).toEqual(['Backlog'])
})

it('leaves a borrowed lane out of the reorder controls', async () => {
  // The lane belongs to another scope, so it is drawn here but must not be nudged
  // around as though it were this project's own.
  const user = userEvent.setup()
  const { container } = renderPlanner({
    buckets: [{ id: 19, name: 'Design', project_id: 2 }],
    scopeMode: 'projects',
    projectFilter: '8',
    canManageBuckets: true,
    tasks: [{ id: 91, title: 'Design UI', bucket: 'Design', project_id: 8, status: 'todo', priority: 'normal' }],
  })

  expect(columnNames(container)).toEqual(['Design'])
  await user.click(screen.getByRole('button', { name: 'Open actions for Design' }))
  expect(screen.getByRole('menuitem', { name: 'Rename Design' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Move Design left' })).not.toBeInTheDocument()
})

it('offers lifecycle actions on every lane the design draws a menu on', async () => {
  const user = userEvent.setup()
  renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Prototyping', project_id: 2 },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Prototyping' }))
  expect(screen.getByRole('menuitem', { name: 'Rename Prototyping' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Archive Prototyping' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Delete Prototyping' })).toBeInTheDocument()

  // Backlog is the default landing lane by name, not by position, so it can be
  // reordered like every other bucket. The open menu hides the rest of the board
  // from the accessibility tree, so close it first.
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Open actions for Backlog' }))
  expect(screen.getByRole('menuitem', { name: 'Rename Backlog' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Archive Backlog' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Delete Backlog' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Move Backlog left' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Move Backlog right' })).toBeInTheDocument()
})

it('moves Backlog to another lane position without changing its landing role', async () => {
  const user = userEvent.setup()
  const onBucketReorder = vi.fn()
  renderPlanner({
    buckets: [
      { id: 'backlog', name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
      { id: 24, name: 'Delivery', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Backlog' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Backlog right' }))

  expect(onBucketReorder).toHaveBeenCalledWith(
    [19, 'backlog', 24],
    { project_id: null, workstream_id: null },
  )
})

it('shows the designed insertion state while dragging a bucket', () => {
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Review', project_id: 2 },
      { id: 24, name: 'Done', project_id: 2 },
    ],
    scopeMode: 'projects',
    projectFilter: '2',
    canManageBuckets: true,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:19') }
  const sourceHeading = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column-heading')
  const sourceSurface = sourceHeading.querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Done').closest('.planner-column')

  expect(sourceHeading).toHaveAttribute('data-reorderable', 'true')
  expect(sourceSurface).toHaveAttribute('draggable', 'true')
  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireEvent.dragEnter(targetColumn, { dataTransfer })

  expect(container.querySelector('.planner-board')).toHaveClass('is-bucket-dragging')
  expect(sourceHeading.closest('.planner-column')).toHaveClass('is-bucket-source')
  expect(targetColumn).toHaveClass('is-bucket-drop-target')
  expect(screen.getByText('Drop here')).toBeInTheDocument()
  expect(screen.getByText('Review lands at position 2')).toBeInTheDocument()
})

it('persists a bucket order when the lane heading is dropped on a sibling', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Review', project_id: 2 },
      { id: 24, name: 'Done', project_id: 2 },
    ],
    scopeMode: 'projects',
    projectFilter: '2',
    canManageBuckets: true,
    onBucketReorder,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:19') }
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Done').closest('.planner-column')

  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireEvent.dragEnter(targetColumn, { dataTransfer })
  fireEvent.drop(targetColumn, { dataTransfer })

  expect(onBucketReorder).toHaveBeenCalledWith([24, 19], { project_id: '2' })
})

it('moves a planner bucket across multiple lanes to the pointer side', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
      { id: 24, name: 'Review', project_id: null, workstream_id: null },
      { id: 25, name: 'Done', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:2') }
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Backlog').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column')
  vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({ left: 600, right: 904, width: 304, top: 0, bottom: 744, height: 744, x: 600, y: 0, toJSON: () => ({}) })

  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireHorizontalPointerDrag(targetColumn, 'dragEnter', dataTransfer, 850)
  fireHorizontalPointerDrag(targetColumn, 'drop', dataTransfer, 850)

  expect(onBucketReorder).toHaveBeenCalledWith([19, 24, 2, 25], { project_id: null, workstream_id: null })
})

it('moves a planner bucket left across multiple lanes to the pointer side', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
      { id: 24, name: 'Review', project_id: null, workstream_id: null },
      { id: 25, name: 'Done', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:25') }
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Done').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Discovery').closest('.planner-column')
  vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({ left: 300, right: 604, width: 304, top: 0, bottom: 744, height: 744, x: 300, y: 0, toJSON: () => ({}) })

  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireHorizontalPointerDrag(targetColumn, 'dragEnter', dataTransfer, 550)
  fireHorizontalPointerDrag(targetColumn, 'drop', dataTransfer, 550)

  expect(onBucketReorder).toHaveBeenCalledWith([2, 19, 25, 24], { project_id: null, workstream_id: null })
})

it('reorders planner buckets with a touch or pen pointer drag', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
      { id: 24, name: 'Review', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Backlog').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column')
  const board = container.querySelector('.planner-board')
  vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({ left: 600, right: 904, width: 304, top: 0, bottom: 744, height: 744, x: 600, y: 0, toJSON: () => ({}) })

  fireEvent.pointerDown(sourceSurface, { pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10 })
  fireEvent.pointerMove(board, { pointerId: 7, pointerType: 'touch', clientX: 850, clientY: 80 })
  expect(targetColumn).toHaveClass('is-bucket-drop-target')
  fireEvent.pointerUp(board, { pointerId: 7, pointerType: 'touch', clientX: 850, clientY: 80 })

  expect(onBucketReorder).toHaveBeenCalledWith([19, 24, 2], { project_id: null, workstream_id: null })
})

it('moves a planner bucket left with a pointer drag', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
      { id: 24, name: 'Review', project_id: null, workstream_id: null },
      { id: 25, name: 'Done', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Done').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Discovery').closest('.planner-column')
  const board = container.querySelector('.planner-board')
  vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({ left: 300, right: 604, width: 304, top: 0, bottom: 744, height: 744, x: 300, y: 0, toJSON: () => ({}) })

  fireEvent.pointerDown(sourceSurface, { pointerId: 9, pointerType: 'pen', clientX: 1000, clientY: 10 })
  fireEvent.pointerMove(board, { pointerId: 9, pointerType: 'pen', clientX: 350, clientY: 80 })
  fireEvent.pointerUp(board, { pointerId: 9, pointerType: 'pen', clientX: 350, clientY: 80 })

  expect(onBucketReorder).toHaveBeenCalledWith([2, 25, 19, 24], { project_id: null, workstream_id: null })
})

it('clears planner bucket drag state when pointer capture is lost', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Discovery', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const sourceColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Backlog').closest('.planner-column')
  const sourceSurface = sourceColumn.querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Discovery').closest('.planner-column')
  const board = container.querySelector('.planner-board')
  vi.spyOn(targetColumn, 'getBoundingClientRect').mockReturnValue({ left: 300, right: 604, width: 304, top: 0, bottom: 744, height: 744, x: 300, y: 0, toJSON: () => ({}) })

  fireEvent.pointerDown(sourceSurface, { pointerId: 8, pointerType: 'mouse', clientX: 10, clientY: 10 })
  fireEvent.pointerMove(board, { pointerId: 8, pointerType: 'mouse', clientX: 350, clientY: 80 })
  expect(sourceColumn).toHaveClass('is-bucket-source')
  fireEvent.lostPointerCapture(board, { pointerId: 8 })

  expect(sourceColumn).not.toHaveClass('is-bucket-source')
  expect(targetColumn).not.toHaveClass('is-bucket-drop-target')
  expect(onBucketReorder).not.toHaveBeenCalled()
})

it('orders lanes of different scopes together when one board draws them side by side', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 19, name: 'Review', project_id: null, workstream_id: null },
      { id: 24, name: 'Design', project_id: 2, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:19') }
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Design').closest('.planner-column')

  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireEvent.dragEnter(targetColumn, { dataTransfer })
  // A board that draws both lanes has to let them be ordered against each
  // other. Reordering never changes a lane's scope, only where it sits.
  expect(targetColumn).toHaveClass('is-bucket-drop-target')
  fireEvent.drop(targetColumn, { dataTransfer })

  expect(onBucketReorder).toHaveBeenCalledWith([24, 19], { board: true })
})

it('keeps the bucket grip decorative and offers keyboard-reachable move actions', async () => {
  const user = userEvent.setup()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Review', project_id: 2 },
      { id: 24, name: 'Done', project_id: 2 },
    ],
    scopeMode: 'projects',
    projectFilter: '2',
    canManageBuckets: true,
  })

  expect(container.querySelector('.planner-column-grip')).toHaveAttribute('aria-hidden', 'true')
  await user.click(screen.getByRole('button', { name: 'Open actions for Review' }))
  expect(screen.getByRole('menuitem', { name: 'Move Review left' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Move Review right' })).toBeInTheDocument()
})

it('reorders unscoped buckets in the all-projects view', async () => {
  const user = userEvent.setup()
  const onBucketReorder = vi.fn()
  renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Review', project_id: null, workstream_id: null },
      { id: 24, name: 'Done', project_id: null, workstream_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onBucketReorder,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Review' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Review right' }))

  expect(onBucketReorder).toHaveBeenCalledWith(
    [2, 24, 19],
    { project_id: null, workstream_id: null },
  )
})

it('reorders workstream buckets from the all-operations view', () => {
  const onBucketReorder = vi.fn()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
      { id: 19, name: 'Intake', project_id: null, workstream_id: 7 },
      { id: 24, name: 'Rota', project_id: null, workstream_id: 7 },
    ],
    scopeMode: 'operations',
    canManageBuckets: true,
    onBucketReorder,
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:19') }
  const sourceSurface = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Intake').closest('.planner-column-heading').querySelector('.planner-column-drag-surface')
  const targetColumn = [...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Rota').closest('.planner-column')

  fireEvent.dragStart(sourceSurface, { dataTransfer })
  fireEvent.dragEnter(targetColumn, { dataTransfer })
  fireEvent.drop(targetColumn, { dataTransfer })

  // The board shows an unscoped Backlog beside the workstream lanes, so the
  // whole visible sequence is what gets saved.
  expect(onBucketReorder).toHaveBeenCalledWith([2, 24, 19], { board: true })
})

it('can nudge a bucket across the full board and back again', async () => {
  const user = userEvent.setup()
  const onBucketReorder = vi.fn()
  const initialBuckets = [
    { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
    { id: 19, name: 'Intake', project_id: null, workstream_id: null },
    { id: 24, name: 'Review', project_id: null, workstream_id: null },
    { id: 25, name: 'Done', project_id: null, workstream_id: null },
  ]

  function ReorderablePlanner() {
    const [buckets, setBuckets] = useState(initialBuckets)
    return <PlannerBoard
      buckets={buckets}
      tasks={[]}
      members={[]}
      searchQuery=""
      onSearchChange={vi.fn()}
      onTaskMove={vi.fn()}
      onAddTask={vi.fn()}
      onBucketReorder={(ids, scope) => {
        onBucketReorder(ids, scope)
        setBuckets(ids.map(id => buckets.find(bucket => String(bucket.id) === String(id))))
      }}
      scopeMode="projects"
      projectFilter="all"
      canManageBuckets
      newBucketName=""
      setNewBucketName={vi.fn()}
    />
  }

  render(<ReorderablePlanner />)

  for (let step = 0; step < 3; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Open actions for Backlog' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move Backlog right' }))
  }
  expect(columnNames(document.body)).toEqual(['Intake', 'Review', 'Done', 'Backlog'])

  for (let step = 0; step < 3; step += 1) {
    await user.click(screen.getByRole('button', { name: 'Open actions for Backlog' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move Backlog left' }))
  }
  expect(columnNames(document.body)).toEqual(['Backlog', 'Intake', 'Review', 'Done'])
})

it('scrolls the planner board toward the pointer while dragging a bucket and reveals the moved lane', async () => {
  const user = userEvent.setup()
  const scrolledElements = []
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function scrollIntoViewMock() {
    scrolledElements.push(this)
  })
  const initialBuckets = [
    { id: 2, name: 'Backlog', project_id: null, workstream_id: null },
    { id: 19, name: 'Review', project_id: null, workstream_id: null },
    { id: 24, name: 'Done', project_id: null, workstream_id: null },
  ]

  function ReorderablePlanner() {
    const [buckets, setBuckets] = useState(initialBuckets)
    return <PlannerBoard
      buckets={buckets}
      tasks={[]}
      members={[]}
      searchQuery=""
      onSearchChange={vi.fn()}
      onTaskMove={vi.fn()}
      onAddTask={vi.fn()}
      onBucketReorder={ids => setBuckets(ids.map(id => buckets.find(bucket => String(bucket.id) === String(id))))}
      scopeMode="projects"
      projectFilter="all"
      canManageBuckets
      newBucketName=""
      setNewBucketName={vi.fn()}
    />
  }

  const { container } = render(<ReorderablePlanner />)
  const board = screen.getByLabelText('Planner board')
  vi.spyOn(board, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 1000, width: 1000, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) })
  Object.defineProperty(board, 'scrollWidth', { configurable: true, value: 2000 })
  Object.defineProperty(board, 'clientWidth', { configurable: true, value: 1000 })
  const sourceSurface = container.querySelector('.planner-column-drag-surface')
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'bucket:2') }

  fireEvent.dragStart(sourceSurface, { dataTransfer })
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
  fireEvent.dragEnd(sourceSurface, { dataTransfer })

  await user.click(screen.getByRole('button', { name: 'Open actions for Backlog' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Backlog right' }))
  await waitFor(() => expect(scrolledElements.some(element => element.dataset.bucketId === '2')).toBe(true))
  scrollIntoView.mockRestore()
})

it('uses the same drag state classes for planner task cards', () => {
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 3, name: 'New', project_id: null },
    ],
    scopeMode: 'projects',
    projectFilter: 'all',
    tasks: [
      { id: 91, title: 'Design UI', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal' },
      { id: 92, title: 'Review copy', bucket: 'New', project_id: '', status: 'todo', priority: 'normal' },
    ],
    canManageTasks: true,
  })
  const sourceCard = screen.getByText('Design UI').closest('.planner-task-card')
  const targetCard = screen.getByText('Review copy').closest('.planner-task-card')
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'task:91') }

  fireEvent.dragStart(sourceCard, { dataTransfer })
  fireEvent.dragOver(targetCard, { dataTransfer })

  expect(sourceCard).toHaveClass('is-dragging')
  expect(targetCard).toHaveClass('is-drop-target')
  expect(container.querySelectorAll('.planner-task-card.is-drop-target')).toHaveLength(1)
})

it('moves a planner card right across multiple cards to the pointer position', () => {
  const onTaskMove = vi.fn()
  const tasks = [
    { id: 91, title: 'Design UI', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 0 },
    { id: 92, title: 'Review copy', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 1 },
    { id: 93, title: 'Build flow', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 2 },
    { id: 94, title: 'Ship release', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 3 },
  ]
  const { container } = renderPlanner({ tasks, canManageTasks: true, onTaskMove })
  const sourceCard = screen.getByText('Design UI').closest('.planner-task-card')
  const column = container.querySelector('.planner-column')
  const cardBounds = [
    [0, 80],
    [90, 80],
    [180, 80],
    [270, 80],
  ]
  const cards = [...container.querySelectorAll('.planner-task-card')]
  cards.forEach((card, index) => {
    const [top, height] = cardBounds[index]
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) })
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'task:91') }

  fireEvent.dragStart(sourceCard, { dataTransfer })
  firePointerDrag(column, 'dragover', dataTransfer, 230)
  firePointerDrag(column, 'drop', dataTransfer, 230)

  expect(onTaskMove).toHaveBeenCalledWith([{ bucket: 'Backlog', task_ids: [92, 93, 91, 94] }])
})

it('moves a planner card left across multiple cards to the pointer position', () => {
  const onTaskMove = vi.fn()
  const tasks = [
    { id: 91, title: 'Design UI', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 0 },
    { id: 92, title: 'Review copy', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 1 },
    { id: 93, title: 'Build flow', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 2 },
    { id: 94, title: 'Ship release', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal', position: 3 },
  ]
  const { container } = renderPlanner({ tasks, canManageTasks: true, onTaskMove })
  const sourceCard = screen.getByText('Ship release').closest('.planner-task-card')
  const column = container.querySelector('.planner-column')
  const cardBounds = [
    [0, 80],
    [90, 80],
    [180, 80],
    [270, 80],
  ]
  const cards = [...container.querySelectorAll('.planner-task-card')]
  cards.forEach((card, index) => {
    const [top, height] = cardBounds[index]
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) })
  })
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn(), getData: vi.fn(() => 'task:94') }

  fireEvent.dragStart(sourceCard, { dataTransfer })
  firePointerDrag(column, 'dragover', dataTransfer, 100)
  firePointerDrag(column, 'drop', dataTransfer, 100)

  expect(onTaskMove).toHaveBeenCalledWith([{ bucket: 'Backlog', task_ids: [91, 94, 92, 93] }])
})

it('opens the mobile filter panel and switches the active bucket tab', async () => {
  const user = userEvent.setup()
  const { container } = renderPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 19, name: 'Review', project_id: 2 },
    ],
    scopeMode: 'projects',
    projectFilter: '2',
    canManageBuckets: true,
  })

  await user.click(screen.getByRole('button', { name: 'Filter' }))
  expect(document.getElementById('planner-mobile-filters').querySelectorAll('[role="combobox"]')).toHaveLength(3)

  await user.click(screen.getByRole('tab', { name: 'Review' }))
  expect(container.querySelectorAll('.planner-column.is-mobile-active')).toHaveLength(1)
  expect([...container.querySelectorAll('.planner-column-name')].find(node => node.textContent === 'Review').closest('.planner-column')).toHaveClass('is-mobile-active')
})

it('filters to genuinely unassigned tasks from the mobile sheet', async () => {
  const user = userEvent.setup()
  cardPlanner({
    tasks: [
      { ...cardTask, id: 91, title: 'Unowned task' },
      { ...cardTask, id: 92, title: 'Owned task', assignee_id: 7, member: 'Nate Boyo' },
    ],
  })

  expect(screen.getByRole('button', { name: 'Unassigned 1' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Unassigned 1' }))

  expect(screen.getByText('Unowned task')).toBeInTheDocument()
  expect(screen.queryByText('Owned task')).not.toBeInTheDocument()
})

const cardTask = { id: 91, title: 'Design UI', bucket: 'Backlog', project_id: '', status: 'todo', priority: 'normal' }
const cardPlanner = (props = {}) => renderPlanner({
  buckets: [{ id: 2, name: 'Backlog', project_id: null }],
  scopeMode: 'projects',
  projectFilter: 'all',
  tasks: [cardTask],
  canManageTasks: true,
  ...props,
})

it('routes each planner card action to its own handler', async () => {
  const onOpenTask = vi.fn()
  const onDeleteTask = vi.fn()
  const onDeletePermanently = vi.fn()
  const user = userEvent.setup()
  cardPlanner({ canDeletePermanently: true, onOpenTask, onDeleteTask, onDeletePermanently })

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  await user.click(screen.getByRole('menuitem', { name: 'Archive Design UI' }))
  expect(onDeleteTask).toHaveBeenCalledWith(91)

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  await user.click(screen.getByRole('menuitem', { name: 'Open Design UI' }))
  expect(onOpenTask).toHaveBeenCalledWith(cardTask)

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  await user.click(screen.getByRole('menuitem', { name: 'Delete Design UI permanently' }))
  expect(onDeletePermanently).toHaveBeenCalledWith(cardTask)
})

it('completes a planner task from the card checkbox', async () => {
  const onStatusChange = vi.fn()
  const user = userEvent.setup()
  cardPlanner({ onStatusChange })

  await user.click(screen.getByRole('checkbox', { name: 'Complete Design UI' }))

  expect(onStatusChange).toHaveBeenCalledWith(91, 'done')
})

it('changes a planner task status from the card selector', async () => {
  const onStatusChange = vi.fn()
  const user = userEvent.setup()
  cardPlanner({ onStatusChange })

  await user.click(screen.getByRole('combobox', { name: 'Change status for Design UI' }))
  await user.click(screen.getByRole('option', { name: 'Review' }))

  expect(onStatusChange).toHaveBeenCalledWith(91, 'review')
})

it('moves a planner task between buckets from the card menu', async () => {
  const onTaskMove = vi.fn()
  const user = userEvent.setup()
  cardPlanner({
    buckets: [
      { id: 2, name: 'Backlog', project_id: null },
      { id: 3, name: 'New', project_id: null },
    ],
    onTaskMove,
  })

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Design UI to New' }))

  expect(onTaskMove).toHaveBeenCalledWith([
    { bucket: 'Backlog', task_ids: [] },
    { bucket: 'New', task_ids: [91] },
  ])
})

it('marks an incomplete past-due task as overdue', () => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dueDate = toDateKey(yesterday)
  cardPlanner({ tasks: [{ ...cardTask, due_date: dueDate }], canManageTasks: false, currentUserId: 7 })

  expect(screen.getByText('Overdue')).toBeInTheDocument()
})

it('does not mark a completed past-due task as overdue', () => {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const dueDate = toDateKey(yesterday)
  cardPlanner({ tasks: [{ ...cardTask, status: 'done', due_date: dueDate }], canManageTasks: false, currentUserId: 7 })

  expect(screen.queryByText('Overdue')).not.toBeInTheDocument()
  expect(screen.getByText(dueDate)).toBeInTheDocument()
})

it('keeps permanent delete out of the card menu for everyone but an owner', async () => {
  const user = userEvent.setup()
  cardPlanner()

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  expect(screen.getByRole('menuitem', { name: 'Archive Design UI' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Delete Design UI permanently' })).not.toBeInTheDocument()
})

it('shows a plain task only the open action', async () => {
  const user = userEvent.setup()
  cardPlanner({ canManageTasks: false, currentUserId: 7 })

  await user.click(screen.getByRole('button', { name: 'Actions for Design UI' }))
  expect(screen.getByRole('menuitem', { name: 'Open Design UI' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Archive Design UI' })).not.toBeInTheDocument()
})

it('renames a custom bucket inline', async () => {
  const onRenameBucket = vi.fn().mockResolvedValue(true)
  const user = userEvent.setup()
  renderPlanner({
    buckets: [{ id: 19, name: 'Prototyping', project_id: 2 }],
    scopeMode: 'projects',
    projectFilter: 'all',
    canManageBuckets: true,
    onRenameBucket,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Prototyping' }))
  await user.click(screen.getByRole('menuitem', { name: 'Rename Prototyping' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Rename Prototyping' }), { target: { value: 'Discovery' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Prototyping name' }))

  expect(onRenameBucket).toHaveBeenCalledWith(expect.objectContaining({ id: 19 }), 'Discovery')
})

it('opens the archive view and restores an archived bucket', () => {
  const onRestoreBucket = vi.fn()
  renderPlanner({
    canManageBuckets: true,
    bucketArchiveOpen: true,
    archivedBuckets: [{ id: 31, name: 'Old lane', project_id: 2, workstream_id: null, is_active: false }],
    projects: [{ id: 2, name: 'Atlas' }],
    onRestoreBucket,
  })

  expect(screen.getByRole('heading', { name: 'Bucket archive' })).toBeInTheDocument()
  expect(screen.getByText('Old lane')).toBeInTheDocument()
  expect(screen.getByText('Atlas')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  expect(onRestoreBucket).toHaveBeenCalledWith(expect.objectContaining({ id: 31 }))
})

// Daily operations draws workspace lanes beside workstream ones. Ordering used
// to run per scope, so the move controls described a list the board was not
// showing: the first workspace lane reported nothing to its left even with a
// workstream lane drawn there.
const mixedScopeBuckets = [
  { id: 41, name: 'Ongoing Tasks', project_id: null, workstream_id: 7 },
  { id: 42, name: 'Clock-in', project_id: null, workstream_id: null },
  { id: 43, name: 'Done', project_id: null, workstream_id: null },
]

it('offers a move left on the second lane of a board that mixes scopes', async () => {
  const user = userEvent.setup()
  renderPlanner({
    buckets: mixedScopeBuckets,
    lookupValues: [{ id: 7, kind: 'workstream', name: 'Support', is_active: true }],
    scopeMode: 'operations',
    projectFilter: 'operations',
    canManageBuckets: true,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Clock-in' }))

  expect(screen.getByRole('menuitem', { name: 'Move Clock-in left' })).not.toHaveAttribute('aria-disabled', 'true')
})

it('nudges a lane past a lane of another scope and saves the whole board order', async () => {
  const user = userEvent.setup()
  const onBucketReorder = vi.fn()
  renderPlanner({
    buckets: mixedScopeBuckets,
    lookupValues: [{ id: 7, kind: 'workstream', name: 'Support', is_active: true }],
    scopeMode: 'operations',
    projectFilter: 'operations',
    canManageBuckets: true,
    onBucketReorder,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Clock-in' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Clock-in left' }))

  expect(onBucketReorder).toHaveBeenCalledWith([42, 41, 43], { board: true })
})

it('keeps the single-scope payload when every lane shares one scope', async () => {
  const user = userEvent.setup()
  const onBucketReorder = vi.fn()
  renderPlanner({
    buckets: [
      { id: 42, name: 'Clock-in', project_id: null, workstream_id: null },
      { id: 43, name: 'Done', project_id: null, workstream_id: null },
    ],
    scopeMode: 'operations',
    projectFilter: 'operations',
    canManageBuckets: true,
    onBucketReorder,
  })

  await user.click(screen.getByRole('button', { name: 'Open actions for Done' }))
  await user.click(screen.getByRole('menuitem', { name: 'Move Done left' }))

  expect(onBucketReorder).toHaveBeenCalledWith([43, 42], { project_id: null, workstream_id: null })
})
