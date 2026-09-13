import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

const renderChat = (data, onRefresh = vi.fn(), onConfirm = vi.fn().mockResolvedValue(true), onError = vi.fn()) => {
  const result = render(
    <ChatWorkspaceView
      viewType="direct"
      data={data}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={onRefresh}
      onError={onError}
      onConfirm={onConfirm}
      onNavigate={vi.fn()}
    />,
  )
  return { ...result, onRefresh }
}

const openConversation = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
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
  fireEvent.click(screen.getByRole('button', { name: /^PR Priya Shah/ }))

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

// The ticks are the only sign an author gets that a message landed. Two flags
// carry three states, and the tick count is the part that matters, so these
// assert on the number of paths the icon draws rather than the label alone.
const tickedMessage = (delivered, read, overrides = {}) => ({
  id: 1,
  author_id: currentUserId,
  author_name: 'Ada Lane',
  message: 'See you then.',
  created_at: '2026-09-12T10:00:00Z',
  delivered,
  read,
  ...overrides,
})

const renderThreadWith = async messages => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({
    ...dataFor(),
    members: [
      { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
      { id: 9, first_name: 'Dana', last_name: 'Reed' },
    ],
  })
  await openConversation()
}

const drawnTicks = () => {
  const receipt = document.querySelector('.chat-receipt')
  return receipt ? receipt.querySelectorAll('path').length : 0
}

it('sends a single tick while nobody else has the message', async () => {
  await renderThreadWith([tickedMessage(false, false)])

  expect(await screen.findByLabelText('Sent')).toBeInTheDocument()
  expect(drawnTicks()).toBe(1)
})

it('shows a second tick once the other side is around', async () => {
  await renderThreadWith([tickedMessage(true, false)])

  expect(await screen.findByLabelText('Delivered')).toBeInTheDocument()
  expect(drawnTicks()).toBe(2)
  expect(document.querySelector('.chat-receipt-read')).not.toBeInTheDocument()
})

it('shows two ticks in colour once the other side has read', async () => {
  await renderThreadWith([tickedMessage(true, true)])

  expect(await screen.findByLabelText('Read')).toBeInTheDocument()
  expect(drawnTicks()).toBe(2)
  expect(document.querySelector('.chat-receipt-read')).toBeInTheDocument()
})

it('never ticks a message the viewer did not send', async () => {
  await renderThreadWith([tickedMessage(true, true, { author_id: 9, author_name: 'Dana Reed' })])

  expect(document.querySelector('.chat-receipt')).not.toBeInTheDocument()
})

it('deletes a conversation from the current user chat list', async () => {
  const onRefresh = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(true)
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/': { dismissed: true },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor(), onRefresh, onConfirm)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete Dana Reed chat' }))

  await waitFor(() => expect(onConfirm).toHaveBeenCalled())
  const deleteCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/11/') && init.method === 'DELETE')
  expect(deleteCall).toBeTruthy()
  expect(onRefresh).toHaveBeenCalled()
})

it('edits the participants of a group chat', async () => {
  const group = {
    id: 13,
    title: 'Launch team',
    is_group: true,
    participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }],
    last_message: 'Ready to launch',
  }
  const data = {
    ...dataFor(),
    members: [
      { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
      { id: 9, first_name: 'Dana', last_name: 'Reed' },
      { id: 8, first_name: 'Priya', last_name: 'Shah' },
      { id: 10, first_name: 'Omar', last_name: 'Khan' },
    ],
    directConversations: [group],
  }
  const onRefresh = vi.fn()
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/13/': { conversation: group },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(data, onRefresh)

  fireEvent.click(await screen.findByRole('button', { name: 'Edit participants for Launch team' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit participants' })
  fireEvent.click(screen.getByLabelText('Priya Shah'))
  fireEvent.click(screen.getByLabelText('Omar Khan'))
  fireEvent.submit(dialog)

  await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  const patchCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/13/') && init.method === 'PATCH')
  expect(patchCall).toBeTruthy()
  expect(JSON.parse(patchCall[1].body)).toEqual({ participant_ids: [9, 10] })
})

it('groups conversations and filters the list to unread chats', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/notifications/': { status: 200, body: {} },
  })
  const group = {
    id: 12,
    title: 'Launch team',
    is_group: true,
    participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }],
    last_message: 'Ready to launch',
  }
  renderChat({
    ...dataFor(),
    members: [
      { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
      { id: 9, first_name: 'Dana', last_name: 'Reed' },
      { id: 8, first_name: 'Priya', last_name: 'Shah' },
    ],
    directConversations: [conversation, group],
    notifications: [{ target_type: 'direct_conversation', target_id: '11', read: false }],
  })

  expect(await screen.findByRole('heading', { name: /Group chats/ })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Direct messages/ })).toBeInTheDocument()
  expect(screen.getByText('Launch team')).toBeInTheDocument()
  expect(screen.getByText('Dana Reed')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: /^Unread/ }))

  expect(screen.getByText('Dana Reed')).toBeInTheDocument()
  expect(screen.queryByText('Launch team')).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Group chats/ })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('tab', { name: /^All/ }))

  expect(screen.getByText('Launch team')).toBeInTheDocument()
})

it('filters the channel list to unread channels', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/notifications/': { status: 200, body: {} },
  })
  render(
    <ChatWorkspaceView
      viewType="channels"
      data={{
        members: [{ id: currentUserId, first_name: 'Ada', last_name: 'Lane' }],
        channels: [
          { id: 20, name: 'general', created_by: 9, is_private: false, member_ids: [] },
          { id: 21, name: 'product-launch', created_by: 9, is_private: false, member_ids: [] },
        ],
        messages: [],
        directConversations: [],
        notifications: [{ target_type: 'chat_channel', target_id: 'product-launch', read: false }],
      }}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )

  expect(await screen.findByRole('button', { name: 'general' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /^Unread/ }))

  expect(screen.getByRole('button', { name: 'product-launch 1' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'general' })).not.toBeInTheDocument()
})

it('collects shared files and documents in the Files pane', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': {
      messages: [{
        id: 1,
        author_name: 'Dana Reed',
        message: 'Files attached.',
        created_at: '2026-09-12T10:00:00Z',
        shared_files: [{ id: 5, original_name: 'launch-brief.pdf', url: 'https://files.example/launch-brief.pdf' }],
        shared_documents: [{ id: 6, title: 'Project brief' }],
      }],
    },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByRole('textbox', { name: 'Message' })

  fireEvent.click(screen.getByRole('tab', { name: /^Files/ }))

  const fileLink = screen.getByRole('link', { name: /launch-brief.pdf/ })
  expect(fileLink).toHaveAttribute('href', 'https://files.example/launch-brief.pdf')
  expect(screen.getByText('Project brief').closest('a')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
})

it('shows conversation context in the About pane', async () => {
  const group = {
    id: 12,
    title: 'Launch team',
    is_group: true,
    participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }],
    last_message: 'Ready to launch',
  }
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/12/messages/': { messages: [] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({
    ...dataFor(),
    members: [
      { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
      { id: 9, first_name: 'Dana', last_name: 'Reed' },
      { id: 8, first_name: 'Priya', last_name: 'Shah' },
    ],
    directConversations: [group],
  })
  fireEvent.click(await screen.findByText('Launch team').then(element => element.closest('button')))

  fireEvent.click(screen.getByRole('tab', { name: 'About' }))

  const about = screen.getByLabelText('About this conversation')
  expect(within(about).getByText('Group members')).toBeInTheDocument()
  expect(within(about).getByText('Participants')).toBeInTheDocument()
  expect(within(about).getByText('Ada Lane')).toBeInTheDocument()
})

it('toggles the conversation details panel', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByRole('textbox', { name: 'Message' })

  fireEvent.click(screen.getByRole('button', { name: 'Show conversation details' }))

  const details = await screen.findByLabelText('Conversation details')
  expect(within(details).getByText('Dana Reed')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Close details' }))

  expect(screen.queryByLabelText('Conversation details')).not.toBeInTheDocument()
})

it('restores a separate draft for each conversation', async () => {
  window.localStorage.clear()
  const other = { id: 12, title: 'Priya Shah', is_group: false, participants: [{ id: 8 }], last_message: '' }
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [] },
    '/direct-conversations/12/messages/': { messages: [] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({ ...dataFor(), directConversations: [conversation, other] })
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByRole('textbox', { name: 'Message' })

  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Dana draft' } })
  fireEvent.click(screen.getByText('Priya Shah').closest('button'))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''))
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Priya draft' } })
  fireEvent.click(screen.getByText('Dana Reed').closest('button'))

  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Dana draft'))
  fireEvent.click(screen.getByText('Priya Shah').closest('button'))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Priya draft'))
})
