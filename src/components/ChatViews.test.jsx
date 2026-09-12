import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatWorkspaceView } from './ChatViews.jsx'
import { mockApi } from '../test/setup-tests.js'

const workspaceId = 4
const currentUserId = 1

const conversation = { id: 11, title: 'Dana Reed', is_group: false, participants: [{ id: 9 }], last_message: 'See you then' }

const dataFor = () => ({
  members: [{ id: 9, first_name: 'Dana', last_name: 'Reed' }],
  channels: [],
  messages: [],
  directConversations: [conversation],
  notifications: [],
})

const renderChat = (data, onRefresh = vi.fn()) => {
  const result = render(
    <ChatWorkspaceView
      viewType="direct"
      data={data}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={onRefresh}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )
  return { ...result, onRefresh }
}

const openConversation = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Dana Reed/ }))
  await screen.findByText('See you then.')
}

it('keeps an open chat thread on screen while the workspace reloads it', async () => {
  // The workspace refresh re-delivers directConversations as a fresh array
  // whenever anything in the workspace changes, which re-runs the fetch in the
  // thread. The list used to be replaced by the loading placeholder on every
  // re-run, so unrelated activity blanked the conversation you were reading.
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/notifications/': { status: 200, body: {} },
  })
  const { rerender, onRefresh } = renderChat(dataFor())

  await openConversation()
  await waitFor(() => expect(onRefresh).toHaveBeenCalled())

  // Same conversation, brand new array and object identities: what a poll
  // delivering unchanged content looks like to React.
  rerender(
    <ChatWorkspaceView
      viewType="direct"
      data={dataFor()}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={onRefresh}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )

  expect(screen.getByText('See you then.')).toBeInTheDocument()
  expect(screen.queryByText('Loading messages…')).not.toBeInTheDocument()
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/messages/')).length).toBeGreaterThan(1)
})

it('shows no messages yet rather than the previous conversation', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/direct-conversations/12/messages/': { messages: [] },
    '/notifications/': { status: 200, body: {} },
  })
  const other = { id: 12, title: 'Priya Shah', is_group: false, participants: [{ id: 8 }], last_message: '' }
  const data = { ...dataFor(), directConversations: [conversation, other] }

  const { rerender } = renderChat(data)
  await openConversation()

  rerender(
    <ChatWorkspaceView
      viewType="direct"
      data={data}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Priya Shah/ }))

  expect(await screen.findByText('No messages yet')).toBeInTheDocument()
  expect(screen.queryByText('See you then.')).not.toBeInTheDocument()
})
