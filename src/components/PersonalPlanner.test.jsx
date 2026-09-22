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

  const { container } = render(<PersonalPlanner workspaceId={4} />)

  expect(await screen.findByRole('button', { name: /^My day/ })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^My day/ })).toHaveAttribute('aria-current', 'page')
  expect(container.querySelector('.personal-planner-layout')).toBeInTheDocument()
  expect(container.querySelector('.personal-planner-rail')).toHaveClass('personal-planner-rail')
  expect(container.querySelector('.personal-task-shell')).toBeInTheDocument()
  expect(screen.getByText('0 of 2 done - 1 overdue')).toBeInTheDocument()
  expect(screen.getByDisplayValue('Draft handover')).toBeInTheDocument()
  // The due date is shown the way the rest of the app shows days.
  expect(screen.getByText('Due 05-01-20')).toBeInTheDocument()

  const [url] = expectRequest(fetchMock, '/personal/planners/')
  expect(String(url)).toContain('/api/workspaces/4/')
})

it('waits for a workspace before loading the private planner', async () => {
  const fetchMock = loadPlanner()

  const { rerender } = render(<PersonalPlanner workspaceId={null} />)

  expect(screen.getByRole('status', { name: 'Loading your planner' })).toBeInTheDocument()
  expect(fetchMock).not.toHaveBeenCalled()

  rerender(<PersonalPlanner workspaceId={4} />)

  expect(await screen.findByRole('button', { name: /^My day/ })).toBeInTheDocument()
  const urls = fetchMock.mock.calls.map(([url]) => String(url))
  expect(urls.some(url => url.includes('/api/workspaces/null/'))).toBe(false)
})

it('ticks an item off into the Done band and shows the day it was finished', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/7/': { task: { ...tasks[0], is_done: true, completed_at: '2024-03-09T09:30:00Z' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Finish Draft handover' }))

  // The tick moves the item out of the day's list and into the folded Done band.
  expect(await screen.findByRole('button', { name: 'Show Done (1 item)' })).toBeInTheDocument()
  expect(screen.getByText('1 of 2 done')).toBeInTheDocument()
  expect(screen.queryByText('Done 09-03-24')).not.toBeInTheDocument()
  expect(screen.queryByText('Due 05-01-20')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Show Done (1 item)' }))
  expect(screen.getByText('Done 09-03-24')).toBeInTheDocument()

  const [, init] = expectRequest(fetchMock, '/personal/tasks/7/', 'PATCH')
  expect(JSON.parse(init.body)).toEqual({ is_done: true })
})

it('reopens a finished item from the Done band back into the day list', async () => {
  mockApi({
    '/personal/planners/': {
      planners: [planner],
      tasks: [
        tasks[0],
        { id: 8, planner_id: 3, title: 'Book the van', notes: '', due_date: '', is_done: true, completed_at: '2024-03-09T09:30:00Z', position: 1 },
      ],
    },
    '/personal/tasks/8/': {
      task: { id: 8, planner_id: 3, title: 'Book the van', notes: '', due_date: '', is_done: false, completed_at: '', position: 1 },
    },
  })

  render(<PersonalPlanner workspaceId={4} />)

  expect(await screen.findByText('1 of 2 done - 1 overdue')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('Book the van')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Show Done (1 item)' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reopen Book the van' }))

  expect(await screen.findByDisplayValue('Book the van')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Show Done/ })).not.toBeInTheDocument()
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

  // Wait on the row, not on the value: the composer holds the same string until
  // the save lands, so a value query matches the composer and then races the
  // clear. The row only exists once the POST has come back.
  expect(await screen.findByLabelText('Title for Ring the dentist')).toBeInTheDocument()
  await waitFor(() => expect(composer).toHaveValue(''))

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

it('updates a task due date from the inline editor', async () => {
  const fetchMock = loadPlanner({
    '/personal/tasks/8/': { task: { ...tasks[1], due_date: '2026-10-02' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Notes' }))
  const dueDate = screen.getByLabelText('Due date for Book the van')
  fireEvent.change(dueDate, { target: { value: '2026-10-02' } })

  await waitFor(() => {
    const patches = fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0][1].body)).toEqual({ due_date: '2026-10-02' })
  })
})

it('renames a planner from its management controls', async () => {
  const fetchMock = loadPlanner({
    '/personal/planners/3/': { planner: { ...planner, name: 'This week' } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage My day' }))
  fireEvent.click(screen.getByRole('button', { name: 'Rename My day' }))
  const name = screen.getByLabelText('Planner name')
  fireEvent.change(name, { target: { value: 'This week' } })
  fireEvent.submit(name.closest('form'))

  expect(await screen.findByRole('button', { name: /^This week/ })).toBeInTheDocument()
  const [, init] = expectRequest(fetchMock, '/personal/planners/3/', 'PATCH')
  expect(JSON.parse(init.body)).toEqual({ name: 'This week' })
})

it('deletes a planner only after the confirmation, and takes its tasks with it', async () => {
  const fetchMock = loadPlanner({ '/personal/planners/3/': { deleted: 3 } })

  render(<PersonalPlanner workspaceId={4} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage My day' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete My day' }))

  // Nothing has been sent yet: the first click only asks.
  expect(fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'DELETE')).toHaveLength(0)
  expect(screen.getByDisplayValue('Draft handover')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('Create a planner to start planning your day')).toBeInTheDocument()
  expect(screen.queryByDisplayValue('Draft handover')).not.toBeInTheDocument()
  expectRequest(fetchMock, '/personal/planners/3/', 'DELETE')
})

it('moves a task to another private planner without changing the API shape', async () => {
  const secondPlanner = { ...planner, id: 5, name: 'This week', position: 1, task_count: 0 }
  const fetchMock = loadPlanner({
    '/personal/planners/': { planners: [planner, secondPlanner], tasks },
    '/personal/tasks/7/': { task: { ...tasks[0], planner_id: 5 } },
  })

  render(<PersonalPlanner workspaceId={4} />)
  const move = await screen.findByLabelText('Planner for Draft handover')
  fireEvent.change(move, { target: { value: '5' } })

  await waitFor(() => {
    const patches = fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')
    expect(patches).toHaveLength(1)
    expect(JSON.parse(patches[0][1].body)).toEqual({ planner_id: 5 })
  })
})

it('renders the loading shell and keeps a server error visible', async () => {
  loadPlanner({ '/personal/planners/': { status: 500, body: { error: 'Could not load your planner.' } } })

  render(<PersonalPlanner workspaceId={4} />)
  expect(screen.getByRole('status', { name: 'Loading your planner' })).toBeInTheDocument()

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your planner.')
  expect(screen.getByText('Create a planner to start planning your day')).toBeInTheDocument()
})
