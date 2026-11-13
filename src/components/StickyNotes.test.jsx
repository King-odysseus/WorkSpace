import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PersonalPlanner from './PersonalPlanner.jsx'
import TodayStickyNotes from './TodayStickyNotes.jsx'
import TodayQuickNote from './TodayQuickNote.jsx'
import { TaskProgressActions } from './TaskProgressBar.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); try { localStorage.clear() } catch { /* nothing to clear */ } })

const planner = { id: 3, name: 'My day', task_count: 3, position: 0 }
const item = (id, title, position, extra = {}) => ({ id, planner_id: 3, title, notes: '', due_date: '', due_time: '', is_done: false, completed_at: null, progress_percent: 0, position, color: '', pos_x: null, pos_y: null, is_archived: false, ...extra })
const tasks = [item(1, 'First thing', 0), item(2, 'Second thing', 1), item(3, 'Third thing', 2)]

const patches = fetchMock => fetchMock.mock.calls
  .filter(([url, init]) => /\/personal\/tasks\/\d+\//.test(String(url)) && init?.method === 'PATCH')
  .map(([url, init]) => ({ id: Number(String(url).match(/tasks\/(\d+)/)[1]), body: JSON.parse(init.body) }))

const openBoard = async fetchMock => {
  localStorage.setItem('planner-view', 'board')
  render(<PersonalPlanner workspaceId={4} />)
  return screen.findByRole('list', { name: 'My planner as sticky notes' })
}

describe('My planner as sticky notes', () => {
  it('shows the open items as notes, and the choice is remembered', async () => {
    mockApi({ '/personal/planners/': { planners: [planner], tasks } })
    render(<PersonalPlanner workspaceId={4} />)
    fireEvent.click(await screen.findByRole('button', { name: /Notes/ }))
    expect(await screen.findByRole('list', { name: 'My planner as sticky notes' })).toBeTruthy()
    expect(screen.getByDisplayValue('Second thing')).toBeTruthy()
    expect(localStorage.getItem('planner-view')).toBe('board')
  })

  it('moves a note anywhere by dragging its bar, and saves where it was dropped', async () => {
    const fetchMock = mockApi({ '/personal/planners/': { planners: [planner], tasks }, '/personal/tasks/': { task: item(2, 'Second thing', 1, { pos_x: 140, pos_y: 120 }) } })
    const board = await openBoard(fetchMock)
    const card = within(board).getByLabelText(/Sticky note: Second thing/)
    const bar = card.querySelector('.sticky-bar')
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 240, clientY: 220 })
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 240, clientY: 220 })
    await waitFor(() => expect(patches(fetchMock).length).toBe(1))
    const [saved] = patches(fetchMock)
    expect(saved.id).toBe(2)
    expect(saved.body.pos_x).toBeGreaterThan(0)
    expect(saved.body.pos_y).toBeGreaterThan(0)
  })

  it('moves a focused note with the arrow keys', async () => {
    const fetchMock = mockApi({ '/personal/planners/': { planners: [planner], tasks: [item(1, 'First thing', 0, { pos_x: 100, pos_y: 100 })] }, '/personal/tasks/': { task: item(1, 'First thing', 0, { pos_x: 116, pos_y: 100 }) } })
    const board = await openBoard(fetchMock)
    fireEvent.keyDown(within(board).getByLabelText(/Sticky note: First thing/), { key: 'ArrowRight' })
    await waitFor(() => expect(patches(fetchMock)).toEqual([{ id: 1, body: { pos_x: 116, pos_y: 100 } }]))
  })

  it('changes a notes colour, title and text', async () => {
    const fetchMock = mockApi({ '/personal/planners/': { planners: [planner], tasks: [tasks[0]] }, '/personal/tasks/': { task: item(1, 'First thing', 0, { color: 'pink' }) } })
    await openBoard(fetchMock)
    fireEvent.click(screen.getByRole('button', { name: 'Change colour of First thing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Pink for First thing' }))
    await waitFor(() => expect(patches(fetchMock).some(entry => entry.body.color === 'pink')).toBe(true))
    const title = screen.getByLabelText('Title of First thing')
    fireEvent.change(title, { target: { value: 'First thing, renamed' } })
    fireEvent.blur(title)
    await waitFor(() => expect(patches(fetchMock).some(entry => entry.body.title === 'First thing, renamed')).toBe(true))
    const text = screen.getByLabelText('Notes for First thing')
    fireEvent.change(text, { target: { value: 'Ask the branch manager' } })
    fireEvent.blur(text)
    await waitFor(() => expect(patches(fetchMock).some(entry => entry.body.notes === 'Ask the branch manager')).toBe(true))
  })

  it('archives a note so it can be restored, and deletes one for good', async () => {
    const fetchMock = mockApi({
      '/personal/planners/': { planners: [planner], tasks: [tasks[0], tasks[1]], archived_tasks: [] },
      '/personal/tasks/1/': { task: item(1, 'First thing', 0, { is_archived: true }) },
      '/personal/tasks/2/': { deleted: 2 },
    })
    await openBoard(fetchMock)
    fireEvent.click(screen.getByRole('button', { name: 'Remove First thing' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Remove First thing' })).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByText('Archived notes (1)')).toBeTruthy()
    expect(screen.queryByLabelText('Title of First thing')).toBeNull()
    expect(patches(fetchMock)[0].body).toEqual({ archived: true })
    fireEvent.click(screen.getByRole('button', { name: 'Restore First thing' }))
    expect(await screen.findByLabelText('Title of First thing')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Second thing' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Remove Second thing' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expectRequest(fetchMock, '/personal/tasks/2/', 'DELETE'))
    await waitFor(() => expect(screen.queryByLabelText('Title of Second thing')).toBeNull())
  })
})

describe('Today sticky notes', () => {
  const planData = { '/personal/day-plan/': { note: { date: '2026-11-13', body: '23:00-23:59 Late block (1h)', notes: {} } }, '/personal/planners/': { planners: [planner], tasks: [item(1, 'Call the bank', 0, { due_date: '2026-11-20' })] } }

  it('is closed by default, opens on request, and remembers that', async () => {
    mockApi(planData)
    const first = render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    const toggle = await screen.findByRole('button', { name: /day plan/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Call the bank')).toBeNull()
    fireEvent.click(toggle)
    expect(await screen.findByText('Call the bank')).toBeTruthy()
    first.unmount()
    mockApi(planData)
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    expect(await screen.findByText('Call the bank')).toBeTruthy()
  })

  it('switches to a list and remembers the view; selecting a note opens the planner', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const open = vi.fn()
    mockApi(planData)
    const first = render(<TodayStickyNotes workspaceId={4} onOpenPlanner={open} />)
    fireEvent.click(await screen.findByRole('button', { name: /List/ }))
    expect(await screen.findByRole('list', { name: 'Sticky notes as a list' })).toBeTruthy()
    expect(localStorage.getItem('today-sticky-view')).toBe('list')
    first.unmount()
    mockApi(planData)
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={open} />)
    expect(await screen.findByRole('list', { name: 'Sticky notes as a list' })).toBeTruthy()
  })

  it('opens the planner from a note on the board', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const open = vi.fn()
    mockApi(planData)
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={open} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open planner: Call the bank' }))
    expect(open).toHaveBeenCalled()
  })

  it('reorders notes by dragging one onto another, and remembers the order', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const two = { '/personal/day-plan/': { note: null }, '/personal/planners/': { planners: [planner], tasks: [item(1, 'Alpha', 0, { due_date: '2026-11-20' }), item(2, 'Beta', 1, { due_date: '2026-11-21' })] } }
    mockApi(two)
    const first = render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    const titles = () => screen.getAllByRole('listitem').map(node => node.querySelector('h3')?.textContent)
    await screen.findByText('Alpha')
    expect(titles()).toEqual(['Alpha', 'Beta'])
    const data = {}
    const dataTransfer = { setData: (key, value) => { data[key] = value }, getData: key => data[key], effectAllowed: '', dropEffect: '' }
    const [alpha, beta] = screen.getAllByRole('listitem')
    fireEvent.dragStart(beta, { dataTransfer })
    fireEvent.dragOver(alpha, { dataTransfer })
    fireEvent.drop(alpha, { dataTransfer })
    expect(titles()).toEqual(['Beta', 'Alpha'])
    first.unmount()
    mockApi(two)
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    await screen.findByText('Alpha')
    expect(titles()).toEqual(['Beta', 'Alpha'])
  })

  it('reorders a focused note with Alt and an arrow key', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    mockApi({ '/personal/day-plan/': { note: null }, '/personal/planners/': { planners: [planner], tasks: [item(1, 'Alpha', 0, { due_date: '2026-11-20' }), item(2, 'Beta', 1, { due_date: '2026-11-21' })] } })
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    await screen.findByText('Alpha')
    const titles = () => screen.getAllByRole('listitem').map(node => node.querySelector('h3')?.textContent)
    fireEvent.keyDown(screen.getAllByRole('listitem')[0], { key: 'ArrowRight', altKey: true })
    expect(titles()).toEqual(['Beta', 'Alpha'])
  })

  it('shows the subtitle with a real apostrophe', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    mockApi(planData)
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    expect(await screen.findByText(/Zuri's plan for today/)).toBeTruthy()
  })

  it('says so when there is nothing yet', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    mockApi({ '/personal/day-plan/': { note: null }, '/personal/planners/': { planners: [], tasks: [] } })
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy()
  })
})

describe('Today sticky notes: finishing tasks', () => {
  const team = { id: 21, title: 'Send the offer pack', status: 'in progress', progress_percent: 30, due_date: '2026-11-12', project: 'Tijha Academy' }
  const planData = { '/personal/day-plan/': { note: null }, '/personal/planners/': { planners: [planner], tasks: [item(1, 'Call the bank', 0)] } }
  const patchBodies = fetchMock => fetchMock.mock.calls.filter(([url, init]) => /personal\/tasks\/\d+\//.test(String(url)) && init?.method === 'PATCH').map(([, init]) => JSON.parse(init.body))

  it('ticks a team task complete, offers undo, and sets its percentage', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    localStorage.setItem('today-sticky-view', 'list')
    mockApi(planData)
    const complete = vi.fn()
    const progress = vi.fn()
    render(<TaskProgressActions.Provider value={progress}><TodayStickyNotes workspaceId={4} teamTasks={[team]} onCompleteTask={complete} onOpenPlanner={() => {}} /></TaskProgressActions.Provider>)
    expect(await screen.findByText('Send the offer pack')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Percent complete for Send the offer pack'), { target: { value: '60' } })
    expect(progress).toHaveBeenCalledWith(team, 60)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Send the offer pack complete' }))
    expect(complete).toHaveBeenCalledWith(21)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('saves a personal items percentage', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const fetchMock = mockApi({ ...planData, '/personal/tasks/1/': { task: item(1, 'Call the bank', 0, { progress_percent: 40 }) } })
    render(<TodayStickyNotes workspaceId={4} teamTasks={[]} onOpenPlanner={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Percent complete for Call the bank'), { target: { value: '40' } })
    await waitFor(() => expect(patchBodies(fetchMock)).toContainEqual({ progress_percent: 40 }))
  })

  it('ticks a personal item complete and can undo it', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const fetchMock = mockApi({ ...planData, '/personal/tasks/1/': { task: item(1, 'Call the bank', 0, { is_done: true, progress_percent: 100 }) } })
    render(<TodayStickyNotes workspaceId={4} teamTasks={[]} onOpenPlanner={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Call the bank complete' }))
    await waitFor(() => expect(patchBodies(fetchMock)).toContainEqual({ is_done: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(patchBodies(fetchMock)).toContainEqual({ is_done: false }))
  })

  it('lets a plan block be ticked done, but gives it no percentage', async () => {
    localStorage.setItem('today-sticky-open', 'true')
    const fetchMock = mockApi({
      '/personal/day-plan/': { note: { date: '2026-11-13', body: '23:00-23:59 Late block (1h)', notes: {}, done: [], layout: {} } },
      '/personal/planners/': { planners: [], tasks: [] },
    })
    render(<TodayStickyNotes workspaceId={4} teamTasks={[]} onOpenPlanner={() => {}} />)
    expect(await screen.findByText('Late block')).toBeTruthy()
    expect(screen.queryByLabelText(/Percent complete/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark Late block done' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/day-plan/') && init?.method === 'PUT' && JSON.parse(init.body).done?.[0] === '23:00')).toBe(true))
  })
})

describe('Today quick note', () => {
  it('saves what you type after a pause, changes colour, and clears', async () => {
    const fetchMock = mockApi({ '/personal/quick-note/': { note: { body: '', color: 'yellow' } } })
    render(<TodayQuickNote workspaceId={4} />)
    const box = await screen.findByLabelText('Quick note text')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.change(box, { target: { value: 'Ring Sam at 3' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    const put = () => fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/quick-note/') && init?.method === 'PUT').map(([, init]) => JSON.parse(init.body))
    await waitFor(() => expect(put()).toContainEqual({ body: 'Ring Sam at 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    await waitFor(() => expect(put()).toContainEqual({ color: 'green' }))
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    await waitFor(() => expectRequest(fetchMock, '/quick-note/', 'DELETE'))
    expect(box).toHaveValue('')
  })
})
