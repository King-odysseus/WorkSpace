import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PersonalPlanner from './PersonalPlanner.jsx'
import TodayStickyNotes from './TodayStickyNotes.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear() } catch { /* nothing to clear */ } })

const planner = { id: 3, name: 'My day', task_count: 3, position: 0 }
const item = (id, title, position, extra = {}) => ({ id, planner_id: 3, title, notes: '', due_date: '', due_time: '', is_done: false, completed_at: null, progress_percent: 0, position, ...extra })
const tasks = [item(1, 'First thing', 0), item(2, 'Second thing', 1), item(3, 'Third thing', 2)]

describe('My planner as sticky notes', () => {
  it('shows the open items as notes, and the choice is remembered', async () => {
    mockApi({ '/personal/planners/': { planners: [planner], tasks } })
    render(<PersonalPlanner workspaceId={4} />)
    fireEvent.click(await screen.findByRole('button', { name: /Notes/ }))
    expect(await screen.findByRole('list', { name: 'My planner as sticky notes' })).toBeTruthy()
    expect(screen.getByText('Second thing')).toBeTruthy()
    expect(localStorage.getItem('planner-view')).toBe('board')
  })

  it('moves a note with the arrows and saves the new order as positions', async () => {
    localStorage.setItem('planner-view', 'board')
    const fetchMock = mockApi({ '/personal/planners/': { planners: [planner], tasks }, '/personal/tasks/': { task: item(1, 'First thing', 1) } })
    render(<PersonalPlanner workspaceId={4} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Move First thing later' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/personal/tasks/') && init?.method === 'PATCH').length).toBe(2))
    const bodies = fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/personal/tasks/') && init?.method === 'PATCH').map(([url, init]) => [String(url).match(/tasks\/(\d+)/)[1], JSON.parse(init.body).position])
    expect(bodies.sort()).toEqual([['1', 1], ['2', 0]])
  })

  it('drops a note onto another to reorder', async () => {
    localStorage.setItem('planner-view', 'board')
    const fetchMock = mockApi({ '/personal/planners/': { planners: [planner], tasks }, '/personal/tasks/': { task: item(3, 'Third thing', 0) } })
    render(<PersonalPlanner workspaceId={4} />)
    const board = await screen.findByRole('list', { name: 'My planner as sticky notes' })
    const notes = within(board).getAllByRole('listitem')
    const dataTransfer = { setData: () => {}, effectAllowed: '' }
    fireEvent.dragStart(notes[2], { dataTransfer })
    fireEvent.dragOver(notes[0], { dataTransfer })
    fireEvent.drop(notes[0], { dataTransfer })
    await waitFor(() => expectRequest(fetchMock, '/personal/tasks/3/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/personal/tasks/3/', 'PATCH')[1].body).position).toBe(0)
  })
})

describe('Today sticky notes', () => {
  it('shows the plan blocks first, then open planner items, and opens the planner', async () => {
    const open = vi.fn()
    mockApi({
      '/personal/day-plan/': { note: { date: '2026-11-13', body: '23:00-23:59 Late block (1h)', notes: {} } },
      '/personal/planners/': { planners: [planner], tasks: [item(1, 'Call the bank', 0, { due_date: '2026-11-20' })] },
    })
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={open} />)
    expect(await screen.findByText('Late block')).toBeTruthy()
    expect(screen.getByText('Call the bank')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open planner: Call the bank' }))
    expect(open).toHaveBeenCalled()
  })

  it('says so when there is nothing yet', async () => {
    mockApi({ '/personal/day-plan/': { note: null }, '/personal/planners/': { planners: [], tasks: [] } })
    render(<TodayStickyNotes workspaceId={4} onOpenPlanner={() => {}} />)
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy()
  })
})
