import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import PlannerBoard from './PlannerBoard.jsx'

it('exposes accessible names and pressed state for planner controls', () => {
  render(
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
    />,
  )

  expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /board/i })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /table/i })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('0 of 0 tasks')).toHaveAttribute('aria-live', 'polite')
})
