import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

it('does not offer cross-scope bucket drops in the all-projects view', () => {
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
  fireEvent.drop(targetColumn, { dataTransfer })

  expect(targetColumn).not.toHaveClass('is-bucket-drop-target')
  expect(onBucketReorder).not.toHaveBeenCalled()
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
