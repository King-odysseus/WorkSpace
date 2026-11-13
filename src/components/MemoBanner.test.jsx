import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import MemoBanner from './MemoBanner.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

const memo = (id, title, extra = {}) => ({ id, title, body: `${title} body`, banner_active: true, dismissed: false, kind: 'memo', ...extra })

describe('announcement banner', () => {
  it('has no counter when there is one memo', async () => {
    mockApi({ '/memos/': { memos: [memo(1, 'Only one')], can_post: false } })
    render(<MemoBanner workspaceId={4} onOpen={() => {}} />)
    expect(await screen.findByText('Only one')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Announcements' })).toBeNull()
  })

  it('shows "1 of 3" and steps through the memos with the arrows, wrapping round', async () => {
    mockApi({ '/memos/': { memos: [memo(1, 'First'), memo(2, 'Second'), memo(3, 'Third')], can_post: false } })
    render(<MemoBanner workspaceId={4} onOpen={() => {}} />)
    expect(await screen.findByText('1 of 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next announcement' }))
    expect(screen.getByText('Second')).toBeTruthy()
    expect(screen.getByText('2 of 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next announcement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next announcement' }))
    expect(screen.getByText('First')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous announcement' }))
    expect(screen.getByText('Third')).toBeTruthy()
  })

  it('opens the memo that is showing, and dismissing it brings up the next one', async () => {
    const open = vi.fn()
    const fetchMock = mockApi({ '/memos/2/dismiss/': { memo: memo(2, 'Second', { dismissed: true }) }, '/memos/': { memos: [memo(1, 'First'), memo(2, 'Second')], can_post: false } })
    render(<MemoBanner workspaceId={4} onOpen={open} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Next announcement' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open memo: Second' }))
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }))
    await waitFor(() => expectRequest(fetchMock, '/memos/2/dismiss/', 'POST'))
    expect(await screen.findByText('First')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Announcements' })).toBeNull()
  })
})
