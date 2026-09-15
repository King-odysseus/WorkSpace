import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import PersonalPlanner from './PersonalPlanner.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

const planner = { id: 3, name: 'My day', position: 0, task_count: 2, created_at: '2026-09-01T08:00:00Z' }

const tasks = [
  // Deliberately long past, so "overdue" does not depend on the day the suite runs.
  { id: 7, planner_id: 3, title: 'Draft handover', notes: '', due_date: '2020-01-05', is_done: false, completed_at: '', position: 0 },
  { id: 8, planner_id: 3, title: 'Book the van', notes: 'Ask about the bigger one', due_date: '', is_done: false, completed_at: '', position: 1 },
]

const loadPlanner = (extra = {}) => mockApi({
  '/personal/planners/': { planners: [planner], tasks },
  ...extra,
})

it('lists the member own planners and tasks, with no team data in the request', async () => {
  const fetchMock = loadPlanner()

  render(<PersonalPlanner workspaceId={4} />)

  expect(await screen.findByRole('button', { name: /^My day/ })).toBeInTheDocument()
  expect(screen.getByText('0 of 2 done - 1 overdue')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Draft handover')).toBeInTheDocument()
  // The due date is shown the way the rest of the app shows days.
  expect(screen.getByText('Due 05-01-20')).toBeInTheDocument()

  const [url] = expectRequest(fetchMock, '/personal/planners/')
  expect(String(url)).toContain('/api/workspaces/4/')
})

it('ticks an item off and shows the day it was finished', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/7/': { task: { ...tasks[0], is_done: true, completed_at: '2024-03-09T09:30:00Z' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Finish Draft handover' }))

  expect(await screen.findByText('Done 09-03-24')).toBeInTheDocument()
  expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
  expect(screen.queryByText('Due 05-01-20')).not.toBeInTheDocument()

  const [, init] = expectRequest(fetchMock, '/personal/tasks/7/', 'PATCH')
  expect(JSON.parse(init.body)).toEqual({ is_done: true })
})

it('puts the tick back when the save fails, and says why', async () => {
  loadPlanner({ '/personal/tasks/7/': { status: 500, body: { error: 'Could not save that.' } } })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Finish Draft handover' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that.')
  // Still offering to finish it, because the server never recorded the tick.
  expect(screen.getByRole('button', { name: 'Finish Draft handover' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText('0 of 2 done - 1 overdue')).toBeInTheDocument()
})

it('adds a task to the open planner', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/': { status: 201, body: { task: { id: 9, planner_id: 3, title: 'Ring the dentist', notes: '', due_date: '', is_done: false, completed_at: '', position: 2 } } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  const composer = await screen.findByLabelText('Add to my day')
  fireEvent.change(composer, { target: { value: 'Ring the dentist' } })
  fireEvent.submit(composer.closest('form'))

  expect(await screen.findByDisplayValue('Ring the dentist')).toBeInTheDocument()
  expect(composer).toHaveValue('')

  const [, init] = expectRequest(fetchMock, '/personal/tasks/', 'POST')
  expect(JSON.parse(init.body)).toEqual({ title: 'Ring the dentist', planner_id: 3 })
})

it('keeps a new planner and opens it', async () => {
  const fetchMock = loadPlanner({
    '/personal/planners/': { status: 201, body: { planner: { ...planner, id: 11, name: 'Weekend', task_count: 0 } } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: /New planner/ }))
  const name = screen.getByLabelText('New planner name')
  fireEvent.change(name, { target: { value: 'Weekend' } })
  fireEvent.submit(name.closest('form'))

  // Anchored, because the rename and delete buttons carry the planner name too.
  expect(await screen.findByRole('button', { name: /^Weekend/ })).toBeInTheDocument()
  // An empty planner looks empty rather than showing the previous one's items.
  expect(screen.getByText('Nothing planned yet.')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('Draft handover')).not.toBeInTheDocument()

  const [, init] = expectRequest(fetchMock, '/personal/planners/', 'POST')
  expect(JSON.parse(init.body)).toEqual({ name: 'Weekend' })
})

it('saves a renamed title once, on blur, and refuses to save an empty one', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/7/': { task: { ...tasks[0], title: 'Draft the handover notes' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  const title = await screen.findByLabelText('Title for Draft handover')

  fireEvent.change(title, { target: { value: '   ' } })
  fireEvent.blur(title)
  // A blank title is not a title; the old one comes back rather than erroring.
  expect(title).toHaveValue('Draft handover')
  expect(fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')).toHaveLength(0)

  fireEvent.change(title, { target: { value: 'Draft the handover notes' } })
  fireEvent.blur(title)

  expect(await screen.findByDisplayValue('Draft the handover notes')).toBeInTheDocument()
  const patches = fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')
  expect(patches).toHaveLength(1)
  expect(JSON.parse(patches[0][1].body)).toEqual({ title: 'Draft the handover notes' })
})

it('opens the notes on a row and saves them', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/8/': { task: { ...tasks[1], notes: 'Ask about the van with the tail lift' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  // Notes stay folded away until asked for, so a list of ten errands is still scannable.
  expect(screen.queryByLabelText('Notes for Book the van')).not.toBeInTheDocument()

  fireEvent.click(await screen.findByRole('button', { name: 'Notes' }))
  const notes = screen.getByLabelText('Notes for Book the van')
  expect(notes).toHaveValue('Ask about the bigger one')

  fireEvent.change(notes, { target: { value: 'Ask about the van with the tail lift' } })
  fireEvent.blur(notes)

  await waitFor(() => {
    const patches = fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0][1].body)).toEqual({ notes: 'Ask about the van with the tail lift' })
  })
})

it('deletes a planner only after the confirmation, and takes its tasks with it', async () => {
  const fetchMock = loadPlanner({ '/personal/planners/3/': { deleted: 3 } })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete My day' }))

  // Nothing has been sent yet: the first click only asks.
  expect(fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'DELETE')).toHaveLength(0)
  expect(screen.getByDisplayValue('Draft handover')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('Create a planner to start planning your day.')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('Draft handover')).not.toBeInTheDocument()
  expectRequest(fetchMock, '/personal/planners/3/', 'DELETE')
})
