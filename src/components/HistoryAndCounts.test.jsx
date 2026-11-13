import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import RequestsPanel from './RequestsPanel.jsx'
import LeaveView from './LeaveView.jsx'
import MemosView from './MemosView.jsx'
import { NavCountsFeeder } from '../lib/use-nav-counts.js'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

const request = (id, title, status, requester = 9) => ({ id, requester_id: requester, requester_name: 'Mia', title, details: '', status, needed_by: null, created_at: '2026-11-01T10:00:00Z', reviewer_name: 'Max', review_note: '' })

describe('history keeps the pages clean', () => {
  it('shows waiting requests and tucks answered ones into History', async () => {
    mockApi({ '/requests/': { requests: [request(1, 'Open one', 'pending'), request(2, 'Done one', 'approved')], can_manage: true } })
    render(<RequestsPanel workspaceId={4} currentUserId={1} />)
    expect(await screen.findByText('Open one')).toBeTruthy()
    const history = screen.getByText('History (1)').closest('details')
    expect(history.open).toBe(false)
    expect(within(history).getByText('Done one')).toBeTruthy()
  })

  it('tucks over, declined and withdrawn leave into History', async () => {
    const leave = (id, status, start, end) => ({ id, user_id: 1, user_name: 'Me', kind: 'annual', start_date: start, end_date: end, start_half: false, end_half: false, status, note: '', reviewer_name: '', review_note: '' })
    mockApi({ '/time-off/': { mine: [leave(1, 'pending', '2099-01-05', '2099-01-06'), leave(2, 'declined', '2099-02-01', '2099-02-02'), leave(3, 'approved', '2020-01-01', '2020-01-02')], team: [], to_decide: [], recent: [], can_approve: false } })
    render(<LeaveView workspaceId={4} role="member" />)
    expect(await screen.findByText('History (2)')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1)
  })

  it('loads archived memos only when History is opened, and restores one', async () => {
    const memo = { id: 7, workspace_id: 4, author_id: 9, author_name: 'Max', title: 'Old news', body: 'x', kind: 'memo', created_at: '2026-10-01T09:00:00Z', banner_active: false, dismissed: false, archived: true }
    const fetchMock = mockApi({ '/memos/7/': { memo: { ...memo, archived: false } }, '/memos/': { memos: [], can_post: true } })
    render(<MemosView workspaceId={4} currentUserId={9} role="manager" />)
    const summary = await screen.findByText(/History: archived memos/)
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('archived=1'))).toBe(false)
    fetchMock.mockImplementation(async (url, init = {}) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => (String(url).includes('archived=1') ? { memos: [memo] } : init.method === 'PATCH' ? { memo } : { memos: [], can_post: true }), text: async () => '{}' }))
    const details = summary.closest('details')
    details.open = true
    fireEvent(details, new Event('toggle'))
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old news' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes('/memos/7/') && init?.method === 'PATCH')).toBe(true))
  })
})

describe('sidebar counts', () => {
  it('counts request memos waiting for me and requests and leave waiting for my decision', async () => {
    mockApi({
      '/memos/': { memos: [{ id: 1, kind: 'request', author_id: 2, my_response: null }, { id: 2, kind: 'request', author_id: 2, my_response: { note: '' } }, { id: 3, kind: 'memo', author_id: 2 }], can_post: false },
      '/requests/': { requests: [request(5, 'A', 'pending', 9), request(6, 'B', 'approved', 9)], can_manage: true },
      '/time-off/': { mine: [], team: [], to_decide: [{ id: 1 }, { id: 2 }], recent: [], can_approve: true },
    })
    const seen = []
    render(<NavCountsFeeder workspaceId={4} userId={1} onChange={counts => seen.push(counts)} />)
    await waitFor(() => expect(seen.at(-1)).toEqual({ memos: 2, timeOff: 2 }))
  })

  it('counts nothing for people with nothing to answer or decide', async () => {
    mockApi({
      '/memos/': { memos: [], can_post: false },
      '/requests/': { requests: [request(5, 'Mine', 'pending', 1)], can_manage: false },
      '/time-off/': { mine: [], team: [], to_decide: [], recent: [], can_approve: false },
    })
    const seen = []
    render(<NavCountsFeeder workspaceId={4} userId={1} onChange={counts => seen.push(counts)} />)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen.at(-1)).toEqual({ memos: 0, timeOff: 0 })
  })
})
