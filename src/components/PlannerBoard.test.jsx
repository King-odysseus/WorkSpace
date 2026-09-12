import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import PlannerBoard from './PlannerBoard.jsx'

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

it('exposes accessible names and pressed state for planner controls', () => {
  renderPlanner()

  expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /board/i })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /table/i })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('0 of 0 tasks')).toHaveAttribute('aria-live', 'polite')
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

it('leaves a borrowed lane out of the reorder controls', () => {
  // The lane belongs to another scope, so it is drawn here but must not be nudged
  // around as though it were this project's own.
  const { container } = renderPlanner({
    buckets: [{ id: 19, name: 'Design', project_id: 2 }],
    scopeMode: 'projects',
    projectFilter: '8',
    canManageBuckets: true,
    tasks: [{ id: 91, title: 'Design UI', bucket: 'Design', project_id: 8, status: 'todo', priority: 'normal' }],
  })

  expect(columnNames(container)).toEqual(['Design'])
  expect(container.querySelectorAll('.planner-bucket-move')).toHaveLength(0)
})
