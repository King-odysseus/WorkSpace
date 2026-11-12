import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import RoutinesPanel, { routinesDoneThisWeek, routinesFrom } from './RoutinesPanel.jsx'

const today = '2026-11-12'
const task = (id, over = {}) => ({ id, title: `Routine ${id}`, recurrence: 'daily', project_id: null, status: 'todo', state: 'active', due_date: today, ...over })

it('lists only open recurring work that is not part of a project, soonest first', () => {
  const tasks = [
    task(1, { due_date: '2026-11-14' }),
    task(2, { due_date: '2026-11-11' }),
    task(3, { recurrence: 'none' }),
    task(4, { project_id: 5 }),
    task(5, { status: 'done' }),
    task(6, { status: 'cancelled' }),
    task(7, { state: 'archived' }),
  ]
  expect(routinesFrom(tasks).map(item => item.id)).toEqual([2, 1])
})

it('counts routines finished in the last seven days', () => {
  const tasks = [
    task(1, { status: 'done', completed_at: '2026-11-10T09:00:00Z' }),
    task(2, { status: 'done', completed_at: '2026-10-01T09:00:00Z' }),
    task(3, { status: 'todo' }),
  ]
  expect(routinesDoneThisWeek(tasks, today)).toBe(1)
})

it('shows each routine with its cadence and marks one done through the status change', () => {
  const onStatusChange = vi.fn()
  const onOpenTask = vi.fn()
  render(<RoutinesPanel today={today} onStatusChange={onStatusChange} onOpenTask={onOpenTask} tasks={[task(1, { recurrence: 'weekly', due_date: '2026-11-10' }), task(2)]} />)

  expect(screen.getByText('2 due to run')).toBeInTheDocument()
  expect(screen.getByText('Every week')).toBeInTheDocument()
  expect(screen.getByText('Was due 2026-11-10')).toBeInTheDocument()
  expect(screen.getByText('Due today')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Mark Routine 1 done' }))
  expect(onStatusChange).toHaveBeenCalledWith(1, 'done')
  fireEvent.click(screen.getByRole('button', { name: 'Routine 2' }))
  expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
})

it('renders nothing when there are no routines at all', () => {
  const { container } = render(<RoutinesPanel today={today} tasks={[task(1, { recurrence: 'none' })]} />)
  expect(container).toBeEmptyDOMElement()
})
