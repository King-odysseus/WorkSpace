import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { expectRequest, mockApi } from '../test/setup-tests.js'
import RemindersPanel from './RemindersPanel.jsx'

const soon = new Date(Date.now() + 3600000).toISOString()
const reminder = { id: 4, target_type: 'task', target_id: 9, label: 'T-9 Prepare brief', note: 'Before the review', remind_at: soon, delivered_at: null }

it('lists pending reminders with their note', async () => {
  mockApi({ '/api/workspaces/1/reminders/': { reminders: [reminder] } })
  render(<RemindersPanel workspaceId={1} />)
  expect(await screen.findByText('T-9 Prepare brief')).toBeInTheDocument()
  expect(screen.getByText(/Before the review/)).toBeInTheDocument()
  expect(screen.getByText('1 pending')).toBeInTheDocument()
})

it('says how to set one when there are none', async () => {
  mockApi({ '/api/workspaces/1/reminders/': { reminders: [] } })
  render(<RemindersPanel workspaceId={1} />)
  expect(await screen.findByText(/No reminders set/)).toBeInTheDocument()
})

it('cancels a reminder and removes it from the list', async () => {
  const fetchMock = mockApi({ '/api/workspaces/1/reminders/': { reminders: [reminder] }, '/api/workspaces/1/reminders/4/': { deleted: 4 } })
  render(<RemindersPanel workspaceId={1} />)
  fireEvent.click(await screen.findByRole('button', { name: /Cancel reminder: T-9 Prepare brief/ }))
  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/reminders/4/', 'DELETE'))
  await waitFor(() => expect(screen.queryByText('T-9 Prepare brief')).toBeNull())
})

it('shows a failed load as an error rather than an empty list', async () => {
  mockApi({ '/api/workspaces/1/reminders/': { status: 500, body: {} } })
  render(<RemindersPanel workspaceId={1} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Reminders could not be loaded.')
  expect(screen.queryByText(/No reminders set/)).toBeNull()
})
