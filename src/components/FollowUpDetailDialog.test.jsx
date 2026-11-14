import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FollowUpDetailDialog } from './RecordDialogs.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

const followUp = { id: 9, note: 'We should schedule a meeting with the partner to agree next steps.', status: 'open', assigned_to_name: 'Anthony', due_date: '2026-11-16', task_id: 4 }

const show = (props = {}) => render(
  <FollowUpDetailDialog followUp={followUp} linkedTaskTitle="Send quotes" canUpdate canEdit onClose={() => {}} onChanged={() => {}} onEdit={() => {}} {...props} />,
)

describe('follow-up detail', () => {
  it('shows the whole note, who it is for, and the comments', async () => {
    mockApi({ '/follow-ups/9/comments/': { comments: [{ id: 1, author_name: 'Mia', body: 'Booked for Thursday.' }] } })
    show()
    expect(screen.getByText(followUp.note)).toBeTruthy()
    expect(screen.getByText('Anthony')).toBeTruthy()
    expect(screen.getByText('Send quotes')).toBeTruthy()
    expect(await screen.findByText('Booked for Thursday.')).toBeTruthy()
  })

  it('adds a comment', async () => {
    const fetchMock = mockApi({ '/follow-ups/9/comments/': { comments: [], comment: { id: 2, author_name: 'Me', body: 'On it.' } } })
    show()
    fireEvent.change(screen.getByLabelText('Add a comment'), { target: { value: 'On it.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }))
    expect(await screen.findByText('On it.')).toBeTruthy()
    expect(JSON.parse(expectRequest(fetchMock, '/follow-ups/9/comments/', 'POST')[1].body)).toEqual({ body: 'On it.' })
  })

  it('marks it complete and tells the page', async () => {
    const onChanged = vi.fn()
    const fetchMock = mockApi({ '/follow-ups/9/comments/': { comments: [] }, '/follow-ups/9/': { follow_up: { ...followUp, status: 'completed' } } })
    show({ onChanged })
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' })))
    expect(JSON.parse(expectRequest(fetchMock, '/follow-ups/9/', 'PATCH')[1].body)).toEqual({ status: 'completed' })
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy()
  })

  it('lets someone who cannot update it read and comment, and says why there is no complete button', async () => {
    mockApi({ '/follow-ups/9/comments/': { comments: [] } })
    show({ canUpdate: false, canEdit: false })
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull()
    expect(screen.getByText(/Only the person who made it/)).toBeTruthy()
    expect(screen.getByLabelText('Add a comment')).toBeTruthy()
  })

  it('shows what the server refuses', async () => {
    mockApi({ '/follow-ups/9/comments/': { comments: [] }, '/follow-ups/9/': { status: 403, body: { error: 'Not allowed.' } } })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.')
  })
})
