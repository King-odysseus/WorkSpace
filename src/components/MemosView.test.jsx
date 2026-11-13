import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MemosView from './MemosView.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

const base = { workspace_id: 4, author_id: 2, author_name: 'Max', created_at: '2026-11-10T09:00:00Z', banner_active: false, dismissed: false, archived: false }
const plain = { ...base, id: 1, title: 'Office closed', body: 'Friday.', kind: 'memo', due_date: null }
const ask = { ...base, id: 2, title: 'Send timesheets', body: 'By Friday please.', kind: 'request', due_date: '2026-12-04', my_response: null, response_count: 0 }

describe('MemosView', () => {
  it('shows a request memo as needing the readers answer, and sends it', async () => {
    const fetchMock = mockApi({
      '/memos/2/respond/': { memo: { ...ask, my_response: { note: 'Sent', created_at: '2026-11-11T09:00:00Z' } } },
      '/memos/': { memos: [plain, ask], can_post: false },
    })
    render(<MemosView workspaceId={4} currentUserId={9} role="member" />)
    expect(await screen.findByText(/needs your answer by/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send timesheets' }))
    fireEvent.change(await screen.findByLabelText('Your answer (optional)'), { target: { value: 'Sent' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mark as done' }))
    await waitFor(() => expectRequest(fetchMock, '/memos/2/respond/', 'POST'))
    expect(JSON.parse(expectRequest(fetchMock, '/memos/2/respond/', 'POST')[1].body)).toEqual({ note: 'Sent' })
  })

  it('shows the author who has answered and who is still owed', async () => {
    const mine = { ...ask, author_id: 9, response_count: 1, responses: [{ user_id: 3, name: 'Mia', note: 'Done', created_at: '2026-11-11T09:00:00Z' }], waiting: [{ user_id: 4, name: 'Sam' }] }
    mockApi({ '/memos/': { memos: [mine], can_post: true } })
    render(<MemosView workspaceId={4} currentUserId={9} role="manager" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Send timesheets' }))
    expect(await screen.findByText('1 answered, 1 waiting')).toBeTruthy()
    expect(screen.getByText(/Still to answer: Sam/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as done' })).toBeNull()
  })

  it('lets a poster ask the team from the new memo form, and hides that choice from members', async () => {
    const fetchMock = mockApi({ '/memos/': { memos: [], can_post: true } })
    render(<MemosView workspaceId={4} currentUserId={9} role="manager" />)
    fireEvent.click(await screen.findByRole('button', { name: /New memo/ }))
    fireEvent.change(await screen.findByLabelText('Type'), { target: { value: 'request' } })
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Holiday dates' } })
    fireEvent.change(screen.getByLabelText('Memo'), { target: { value: 'Tell me yours.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post memo' }))
    await waitFor(() => expectRequest(fetchMock, '/memos/', 'POST'))
    expect(JSON.parse(expectRequest(fetchMock, '/memos/', 'POST')[1].body)).toMatchObject({ kind: 'request', title: 'Holiday dates' })
  })

  it('has a Requests tab for everyone', async () => {
    mockApi({ '/memos/': { memos: [], can_post: false }, '/requests/': { requests: [], can_manage: false } })
    render(<MemosView workspaceId={4} currentUserId={9} role="member" />)
    fireEvent.click(await screen.findByRole('tab', { name: 'Requests' }))
    expect(await screen.findByLabelText('New request')).toBeTruthy()
  })
})
