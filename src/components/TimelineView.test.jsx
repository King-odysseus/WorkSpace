import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import TimelineView, { barSpan, dayNumber, isoFromDay, linkConflict } from './TimelineView.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear() } catch { /* nothing to clear */ } })

const task = (id, title, extra = {}) => ({ id, title, status: 'todo', state: 'active', start_date: '', due_date: '', progress_percent: 0, blocked_by_ids: [], milestone_id: null, ...extra })
const milestone = (id, title, due, extra = {}) => ({ id, title, due_date: due, notes: '', task_count: 0, done_count: 0, complete: false, manually_completed: false, is_late: false, project_id: null, ...extra })

describe('timeline helpers', () => {
  it('turns dates into day numbers and back, and gives a bar its first and last day', () => {
    expect(isoFromDay(dayNumber('2026-11-13'))).toBe('2026-11-13')
    expect(dayNumber('2026-11-14') - dayNumber('2026-11-13')).toBe(1)
    expect(barSpan(task(1, 'a', { start_date: '2026-11-10', due_date: '2026-11-12' }))).toEqual({ start: dayNumber('2026-11-10'), end: dayNumber('2026-11-12') })
    expect(barSpan(task(2, 'b', { due_date: '2026-11-12' }))).toEqual({ start: dayNumber('2026-11-12'), end: dayNumber('2026-11-12') })
    expect(barSpan(task(3, 'c', { start_date: '2026-11-15', due_date: '2026-11-12' })).start).toBe(dayNumber('2026-11-12'))
  })
  it('flags a link whose later task starts before the earlier one ends', () => {
    const first = task(1, 'first', { start_date: '2026-11-10', due_date: '2026-11-14' })
    expect(linkConflict(first, task(2, 'later', { start_date: '2026-11-15', due_date: '2026-11-16' }))).toBe(false)
    expect(linkConflict(first, task(3, 'early', { start_date: '2026-11-13', due_date: '2026-11-16' }))).toBe(true)
  })
})

describe('TimelineView', () => {
  const tasks = [
    task(1, 'Design', { start_date: '2026-11-09', due_date: '2026-11-12', milestone_id: 7, progress_percent: 50 }),
    task(2, 'Build', { start_date: '2026-11-13', due_date: '2026-11-20', milestone_id: 7, blocked_by_ids: [1] }),
    task(3, 'Loose end', { due_date: '2026-11-18' }),
    task(4, 'Undated chore'),
  ]
  const api = { '/milestones/': { milestones: [milestone(7, 'Beta release', '2026-11-20', { task_count: 2, done_count: 0 })] } }

  it('shows each task as a bar under its milestone, with the undated ones listed apart', async () => {
    mockApi(api)
    render(<TimelineView workspaceId={4} tasks={tasks} isLeader canEdit onOpenTask={() => {}} />)
    expect((await screen.findAllByText('Beta release')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /^Design, 2026-11-09 to 2026-11-12, 50% done/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Build, 2026-11-13 to 2026-11-20/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Loose end, 2026-11-18/ })).toBeTruthy()
    expect(screen.getAllByText('No milestone').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'Milestone Beta release, 2026-11-20' })).toBeTruthy()
    expect(screen.getByText(/1 task has no dates/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Link: Build waits for Design' })).toBeTruthy()
  })

  it('opens the task when a bar is selected', async () => {
    const open = vi.fn()
    mockApi(api)
    render(<TimelineView workspaceId={4} tasks={tasks} canEdit onOpenTask={open} />)
    const bar = await screen.findByRole('button', { name: /^Design,/ })
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 100 })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('moves a bar by dragging it and saves both dates', async () => {
    const fetchMock = mockApi({ ...api, '/api/tasks/1/': { task: { id: 1 } } })
    render(<TimelineView workspaceId={4} tasks={tasks} canEdit onOpenTask={() => {}} onTaskPatched={() => {}} />)
    const bar = await screen.findByRole('button', { name: /^Design,/ })
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 100 + 34 * 2 })
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 100 + 34 * 2 })
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/1/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/api/tasks/1/', 'PATCH')[1].body)).toEqual({ start_date: '2026-11-11', due_date: '2026-11-14' })
  })

  it('does not let someone who cannot edit drag or link', async () => {
    mockApi(api)
    render(<TimelineView workspaceId={4} tasks={tasks} onOpenTask={() => {}} />)
    await screen.findByRole('button', { name: /^Design,/ })
    expect(screen.queryByRole('button', { name: 'Link from Design' })).toBeNull()
    expect(screen.queryByLabelText('New milestone title')).toBeNull()
  })

  it('links two tasks: pick the first, then the one that must wait', async () => {
    const fetchMock = mockApi({ ...api, '/api/tasks/3/': { task: { id: 3 } } })
    render(<TimelineView workspaceId={4} tasks={tasks} canEdit onOpenTask={() => {}} onTaskPatched={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link from Design' }))
    expect(screen.getByRole('status')).toHaveTextContent('must wait for Design')
    fireEvent.click(screen.getByRole('button', { name: /^Loose end, 2026-11-18/ }))
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/3/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/api/tasks/3/', 'PATCH')[1].body)).toEqual({ blocked_by_ids: [1] })
  })

  it('removes a link from the arrow', async () => {
    const fetchMock = mockApi({ ...api, '/api/tasks/2/': { task: { id: 2 } } })
    render(<TimelineView workspaceId={4} tasks={tasks} canEdit onOpenTask={() => {}} onTaskPatched={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Link: Build waits for Design' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    await waitFor(() => expectRequest(fetchMock, '/api/tasks/2/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/api/tasks/2/', 'PATCH')[1].body)).toEqual({ blocked_by_ids: [] })
  })

  it('adds a milestone, and deleting asks twice', async () => {
    const fetchMock = mockApi({ '/milestones/7/': { deleted: 7 }, '/milestones/': { milestones: [milestone(7, 'Beta release', '2026-11-20')], milestone: milestone(8, 'Launch', '2026-12-01') } })
    render(<TimelineView workspaceId={4} tasks={[]} isLeader canEdit onOpenTask={() => {}} />)
    await screen.findAllByText('Beta release')
    fireEvent.change(screen.getByLabelText('New milestone title'), { target: { value: 'Launch' } })
    fireEvent.change(screen.getByLabelText('New milestone date'), { target: { value: '2026-12-01' } })
    fireEvent.click(screen.getByRole('button', { name: /Add milestone/ }))
    await waitFor(() => expect(JSON.parse(expectRequest(fetchMock, '/milestones/', 'POST')[1].body)).toMatchObject({ title: 'Launch', due_date: '2026-12-01' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Beta release' }))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/milestones/7/') && init?.method === 'DELETE')).toBe(false)
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Beta release?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expectRequest(fetchMock, '/milestones/7/', 'DELETE'))
  })

  it('remembers the zoom', async () => {
    mockApi(api)
    render(<TimelineView workspaceId={4} tasks={tasks} onOpenTask={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Weeks' }))
    expect(localStorage.getItem('timeline-zoom')).toBe('month')
  })
})
