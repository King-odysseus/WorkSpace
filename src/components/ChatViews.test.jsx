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

it('reads the chat list dot from recent activity rather than self-reported presence', async () => {
  // Presence is sticky: someone who picked "Available" days ago still reports it,
  // so a dot driven by that field alone shows a teammate as green while they are
  // offline. Every other surface already resolves presence against last_seen_at.
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/notifications/': { status: 200, body: {} },
  })
  const staleData = {
    ...dataFor(),
    members: [{
      id: 9,
      first_name: 'Dana',
      last_name: 'Reed',
      presence: 'available',
      last_seen_at: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
    }],
  }

  renderChat(staleData)

  expect(await screen.findByTitle('Offline')).toHaveClass('presence-offline')
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

it('offers more than thumbs up and posts the selected reaction', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/direct-messages/1/reactions/': { message: { reactions: [{ emoji: '🎉', count: 1, reacted: true }] } },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  fireEvent.click(await screen.findByRole('button', { name: 'React with Celebrate' }))

  await screen.findByText('🎉 1')
  const reactionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/direct-messages/1/reactions/'))
  expect(reactionCall[0]).toContain('/direct-messages/1/reactions/')
  expect(reactionCall[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ emoji: '🎉' }) })
})

it('opens the full emoji picker from the reaction plus and posts the choice', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/direct-messages/1/reactions/': { message: { reactions: [{ emoji: '🥳', count: 1, reacted: true }] } },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  fireEvent.click(await screen.findByRole('button', { name: 'More reactions' }))
  expect(await screen.findByRole('dialog', { name: 'More reactions for Dana Reed' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: 'React with 🥳' }))

  await screen.findByText('🥳 1')
  const reactionCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/direct-messages/1/reactions/'))
  expect(reactionCall[0]).toContain('/direct-messages/1/reactions/')
  expect(reactionCall[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ emoji: '🥳' }) })
})

it('opens the compact composer emoji popup and inserts the choice', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  fireEvent.click(screen.getByRole('button', { name: 'Add emoji' }))
  expect(await screen.findByRole('dialog', { name: 'Choose an emoji' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('option', { name: 'Insert 🥳' }))

  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('🥳')
  expect(screen.queryByRole('dialog', { name: 'Choose an emoji' })).not.toBeInTheDocument()
})

it('opens the full mention picker immediately and filters as the user types', async () => {
  const data = {
    ...dataFor(),
    members: [
      { id: 9, first_name: 'Dana', last_name: 'Reed', email: 'dana@example.com' },
      { id: 8, first_name: 'Priya', last_name: 'Shah', email: 'priya@example.com' },
    ],
  }
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(data)
  await openConversation()

  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: '@', selectionStart: 1, selectionEnd: 1 } })

  expect(await screen.findByRole('listbox', { name: 'Mention a workspace member' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Mention Dana Reed' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Mention Priya Shah' })).toBeInTheDocument()

  fireEvent.change(input, { target: { value: '@Pr', selectionStart: 3, selectionEnd: 3 } })

  expect(screen.getByRole('option', { name: 'Mention Priya Shah' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Mention Dana Reed' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('option', { name: 'Mention Priya Shah' }))
  expect(input).toHaveValue('@priya ')
})
