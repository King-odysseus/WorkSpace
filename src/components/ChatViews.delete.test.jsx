// Deleting a message, kept in its own file: it is a self-contained behaviour
// and the composer and reaction suites are already long enough.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatWorkspaceView } from './ChatViews.jsx'
import { mockApi } from '../test/setup-tests.js'

const workspaceId = 4
const currentUserId = 1

const conversation = { id: 11, title: 'Dana Reed', is_group: false, participants: [{ id: 9 }], last_message: 'See you then' }

const dataFor = () => ({
  members: [
    { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
    { id: 9, first_name: 'Dana', last_name: 'Reed' },
  ],
  channels: [],
  messages: [],
  directConversations: [conversation],
  notifications: [],
})

const renderChat = (data, onConfirm = vi.fn(async () => true)) => {
  const result = render(
    <ChatWorkspaceView
      viewType="direct"
      data={data}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={onConfirm}
      onNavigate={vi.fn()}
    />,
  )
  return { ...result, onConfirm }
}

const openConversation = async () => {
  // The row's own delete button carries her name in its label too, so click the
  // name itself and walk up to the row rather than matching by accessible name.
  fireEvent.click((await screen.findByText('Dana Reed')).closest('button'))
  await screen.findByRole('textbox', { name: 'Message' })
}

const ownMessage = (overrides = {}) => ({
  id: 1,
  author_id: currentUserId,
  author_name: 'Ada Lane',
  message: 'See you then.',
  created_at: '2026-09-12T10:00:00Z',
  ...overrides,
})

it('deletes an own message through the confirm dialog and leaves a tombstone', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [ownMessage()] },
    '/direct-messages/1/': { message: { ...ownMessage(), message: '', deleted_at: '2026-09-13T10:30:00Z' } },
    '/notifications/': { status: 200, body: {} },
  })
  const { onConfirm } = renderChat(dataFor())
  await openConversation()

  fireEvent.click(await screen.findByRole('button', { name: 'Delete message' }))

  await waitFor(() => expect(onConfirm).toHaveBeenCalled())
  await screen.findByText('This message was deleted')
  expect(screen.queryByText('See you then.')).not.toBeInTheDocument()
  const deleteCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-messages/1/') && init.method === 'DELETE')
  expect(deleteCall).toBeTruthy()
})

it('keeps the message when the confirm is declined', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [ownMessage()] },
    '/direct-messages/1/': { message: { ...ownMessage(), message: '', deleted_at: '2026-09-13T10:30:00Z' } },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor(), vi.fn(async () => false))
  await openConversation()

  fireEvent.click(await screen.findByRole('button', { name: 'Delete message' }))

  expect(screen.getByText('See you then.')).toBeInTheDocument()
  expect(screen.queryByText('This message was deleted')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([url, init = {}]) => String(url).includes('/direct-messages/1/') && init.method === 'DELETE')).toBe(false)
})

it('offers no delete on a message the viewer did not send', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [ownMessage({ author_id: 9, author_name: 'Dana Reed' })] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  expect(await screen.findByText('See you then.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
})

it('renders a tombstone on arrival with no tick and no reactions', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [ownMessage({ message: '', deleted_at: '2026-09-13T10:30:00Z', delivered: true, read: true })] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  expect(await screen.findByText('This message was deleted')).toBeInTheDocument()
  expect(document.querySelector('.chat-receipt')).not.toBeInTheDocument()
  expect(document.querySelector('.chat-reactions')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument()
})
