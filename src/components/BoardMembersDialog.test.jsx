import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BoardMembersDialog from './BoardMembersDialog.jsx'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const members = [
  { id: 1, first_name: 'Nate', last_name: 'Owner', email: 'nate@example.test', role: 'owner' },
  { id: 2, first_name: 'Ada', last_name: 'Okafor', email: 'ada@example.test', role: 'member' },
  { id: 3, first_name: 'Ben', last_name: 'Eze', email: 'ben@example.test', role: 'member' },
]

it('shows who is on a board and saves the changed list', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/4/boards/workstream/9/members/': { member_ids: [2], members: [], is_private: false },
  })
  const onClose = vi.fn()
  render(<BoardMembersDialog workspaceId={4} kind="workstream" board={{ id: 9, name: 'Daily operations' }} members={members} onClose={onClose} />)

  expect(await screen.findByText('People on Daily operations')).toBeInTheDocument()
  const ada = await screen.findByRole('switch', { name: 'Put Ada Okafor on Daily operations' })
  expect(ada).toHaveAttribute('aria-checked', 'true')
  const ben = screen.getByRole('switch', { name: 'Put Ben Eze on Daily operations' })
  expect(ben).toHaveAttribute('aria-checked', 'false')
  expect(screen.getByText('Owner - sees every board')).toBeInTheDocument()

  fireEvent.click(ben)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
  const [, request] = expectRequest(fetchMock, '/api/workspaces/4/boards/workstream/9/members/', 'PUT')
  expect(JSON.parse(request.body).member_ids.sort()).toEqual([2, 3])
})

it('says why a board cannot be changed instead of failing silently', async () => {
  mockApi({
    '/api/workspaces/4/boards/project/2/members/': { status: 404, body: { error: 'Board was not found.' } },
  })
  render(<BoardMembersDialog workspaceId={4} kind="project" board={{ id: 2, name: 'Hidden' }} members={members} onClose={vi.fn()} />)
  expect(await screen.findByText('Board was not found.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})
