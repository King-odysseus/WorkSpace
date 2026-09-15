import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatWorkspaceView } from './ChatViews.jsx'
import { mockApi } from '../test/setup-tests.js'
import { requestChatThread } from '../lib/chat-navigation.js'

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

const launchMembers = [
  { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
  { id: 9, first_name: 'Dana', last_name: 'Reed' },
  { id: 8, first_name: 'Priya', last_name: 'Shah' },
  { id: 10, first_name: 'Omar', last_name: 'Khan' },
]

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

it('loads older chat history without losing the newest page or scroll position', async () => {
  const latestMessages = Array.from({ length: 10 }, (_, index) => ({
    id: index + 5,
    author_name: 'Dana Reed',
    message: `Message ${index + 5}`,
    created_at: `2026-09-12T10:${String(index).padStart(2, '0')}:00Z`,
  }))
  const olderMessages = Array.from({ length: 4 }, (_, index) => ({
    id: index + 1,
    author_name: 'Dana Reed',
    message: `Message ${index + 1}`,
    created_at: `2026-09-12T09:${String(index).padStart(2, '0')}:00Z`,
  }))
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/?before=5&limit=10': { messages: olderMessages, has_more: false, next_before: null },
    '/direct-conversations/11/messages/': { messages: latestMessages, has_more: true, next_before: 5 },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByText('Message 14')

  const initialCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/11/messages/') && (init.method || 'GET') === 'GET')
  expect(initialCall[0]).toContain('limit=10')

  const scroller = document.querySelector('.chat-message-scroll')
  let currentScrollHeight = 500
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => currentScrollHeight })
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 100 })
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 0 })

  fireEvent.scroll(scroller)
  currentScrollHeight = 650

  expect(await screen.findByText('Message 1')).toBeInTheDocument()
  expect(screen.getByText('Message 14')).toBeInTheDocument()
  const olderCall = fetchMock.mock.calls.find(([url]) => String(url).includes('before=5') && String(url).includes('limit=10'))
  expect(olderCall).toBeTruthy()
  await waitFor(() => expect(scroller.scrollTop).toBe(150))

  fireEvent.click(screen.getByRole('button', { name: 'Jump to latest messages' }))
  expect(scroller.scrollTop).toBe(650)
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

it('creates a private conversation with yourself', async () => {
  const selfConversation = {
    id: 31,
    title: 'Ada Lane',
    is_group: false,
    is_self: true,
    participants: [{ id: currentUserId, name: 'Ada Lane', email: 'ada@example.com' }],
    last_message: '',
  }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/31/messages/': { messages: [] },
    '/direct-conversations/': { conversation: selfConversation },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({ ...dataFor(), members: launchMembers, directConversations: [] })

  fireEvent.click(screen.getAllByRole('button', { name: 'New chat' })[0])
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Message yourself' }))
  expect(screen.getByText('Private notes')).toBeInTheDocument()
  fireEvent.submit(screen.getByRole('dialog'))

  await waitFor(() => {
    const createCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/') && init.method === 'POST')
    expect(createCall).toBeTruthy()
    expect(JSON.parse(createCall[1].body)).toEqual({ participant_ids: [currentUserId] })
  })
})

it('replies to your own message in a private conversation', async () => {
  const selfConversation = {
    id: 31,
    title: 'Ada Lane',
    is_group: false,
    is_self: true,
    participants: [{ id: currentUserId, name: 'Ada Lane', email: 'ada@example.com' }],
    last_message: 'Remember the launch checklist.',
  }
  const original = {
    id: 1,
    author_id: currentUserId,
    author_name: 'Ada Lane',
    message: 'Remember the launch checklist.',
    created_at: '2026-09-15T10:00:00Z',
  }
  const sent = {
    id: 2,
    author_id: currentUserId,
    author_name: 'Ada Lane',
    message: 'Checked the launch checklist.',
    created_at: '2026-09-15T10:01:00Z',
    parent_id: 1,
  }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/31/messages/': { messages: [original], message: sent },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({
    ...dataFor(),
    members: [{ id: currentUserId, first_name: 'Ada', last_name: 'Lane' }],
    directConversations: [selfConversation],
  })

  fireEvent.click(await screen.findByRole('button', { name: /^Message yourself/ }))
  const originalRow = (await screen.findByText('Remember the launch checklist.', { selector: '.chat-message-bubble p' })).closest('.chat-message')
  fireEvent.click(within(originalRow).getByRole('button', { name: 'Reply' }))
  expect(screen.getByText(/Replying to/)).toBeInTheDocument()
  expect(screen.getByText('Ada Lane', { selector: '.reply-context strong' })).toBeInTheDocument()

  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Checked the launch checklist.' } })
  fireEvent.submit(input.closest('form'))

  await waitFor(() => {
    const sendCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/31/messages/') && init.method === 'POST')
    expect(sendCall).toBeTruthy()
    expect(JSON.parse(sendCall[1].body)).toMatchObject({ message: 'Checked the launch checklist.', parent_id: 1 })
  })
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

it('offers Reply on a reply and sends the reply id as the parent', async () => {
  const messages = [
    { id: 1, author_id: 9, author_name: 'Dana Reed', message: 'Can you review this?', created_at: '2026-09-12T10:00:00Z', reply_count: 1 },
    { id: 2, author_id: currentUserId, author_name: 'Ada Lane', message: 'Yes, I will.', created_at: '2026-09-12T10:01:00Z', parent_id: 1 },
  ]
  const sent = { id: 3, author_id: currentUserId, author_name: 'Ada Lane', message: 'Thanks again.', created_at: '2026-09-12T10:02:00Z', parent_id: 2 }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages, message: sent },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByText('Yes, I will.')

  const replyButton = screen.getByRole('button', { name: 'Reply' })
  expect(replyButton.closest('.chat-message-actions')).not.toBeNull()
  expect(replyButton.closest('.chat-message-bubble')).toBeNull()
  fireEvent.click(replyButton)
  expect(screen.getByText(/Replying to/)).toBeInTheDocument()

  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Thanks again.' } })
  fireEvent.submit(input.closest('form'))

  await waitFor(() => {
    const sendCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/11/messages/') && init.method === 'POST')
    expect(sendCall).toBeTruthy()
    expect(JSON.parse(sendCall[1].body)).toMatchObject({ message: 'Thanks again.', parent_id: 2 })
  })
})

it('offers Reply on a channel reply and sends the reply id as the parent', async () => {
  const messages = [
    { id: 1, author_id: 9, author_name: 'Dana Reed', message: 'Can you review this?', created_at: '2026-09-12T10:00:00Z', channel: 'general', reply_count: 1 },
    { id: 2, author_id: currentUserId, author_name: 'Ada Lane', message: 'Yes, I will.', created_at: '2026-09-12T10:01:00Z', channel: 'general', parent_id: 1 },
  ]
  const sent = { id: 3, author_id: currentUserId, author_name: 'Ada Lane', message: 'Thanks again.', created_at: '2026-09-12T10:02:00Z', channel: 'general', parent_id: 2 }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/chat-messages/?channel=general': { messages },
    '/chat-messages/': { message: sent },
    '/notifications/': { status: 200, body: {} },
  })
  render(
    <ChatWorkspaceView
      viewType="channels"
      data={{ ...dataFor(), channels: [{ id: 20, name: 'general', created_by: 9, is_private: false, member_ids: [] }] }}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )
  const reply = await screen.findByText('Yes, I will.')
  const replyRow = reply.closest('.chat-message')

  fireEvent.click(within(replyRow).getByRole('button', { name: 'Reply' }))
  expect(screen.getByText(/Replying to/)).toBeInTheDocument()

  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Thanks again.' } })
  fireEvent.submit(input.closest('form'))

  await waitFor(() => {
    const sendCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/chat-messages/') && init.method === 'POST')
    expect(sendCall).toBeTruthy()
    expect(JSON.parse(sendCall[1].body)).toMatchObject({ channel: 'general', message: 'Thanks again.', parent_id: 2 })
  })
})

it('shows both edit actions and saves a message from the bottom composer', async () => {
  const original = { id: 1, author_id: currentUserId, author_name: 'Ada Lane', message: 'Before the edit.', created_at: '2026-09-12T10:00:00Z' }
  const updated = { ...original, message: 'After the edit.', edited_at: '2026-09-12T10:05:00Z' }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [original] },
    '/direct-messages/1/': { message: updated },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({
    ...dataFor(),
    members: [
      { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
      { id: 9, first_name: 'Dana', last_name: 'Reed' },
    ],
  })
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByText('Before the edit.')

  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const save = screen.getByRole('button', { name: 'Save changes' })
  expect(save).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()

  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'After the edit.' } })
  fireEvent.click(save)

  await waitFor(() => {
    const editCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-messages/1/') && init.method === 'PATCH')
    expect(editCall).toBeTruthy()
    expect(JSON.parse(editCall[1].body)).toMatchObject({ message: 'After the edit.' })
  })
  expect(await screen.findByText('After the edit.')).toBeInTheDocument()
})

it('loads and highlights the channel message a notification names', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/chat-messages/?channel=general': { messages: [{ id: 44, author_id: 9, author_name: 'Dana Reed', message: 'Deployment is ready.', created_at: '2026-09-12T10:00:00Z', channel: 'general' }] },
    '/notifications/': { status: 200, body: {} },
  })
  requestChatThread('chat_channel', 'general', 44)

  render(
    <ChatWorkspaceView
      viewType="channels"
      data={{ ...dataFor(), channels: [{ id: 20, name: 'general', created_by: 9, is_private: false, member_ids: [] }] }}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )

  const targeted = await screen.findByText('Deployment is ready.')
  const row = targeted.closest('.chat-message')
  expect(row).toHaveAttribute('data-message-id', '44')
  expect(row).toHaveClass('chat-message-highlight')
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('around=44') && String(url).includes('limit=10'))).toBe(true)
})

it('keeps Delete available on an archived chat message', async () => {
  const archived = { ...conversation, is_archived: true }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 7, author_id: currentUserId, author_name: 'Ada Lane', message: 'Remove this.', created_at: '2026-09-12T10:00:00Z' }] },
    '/direct-messages/7/': { message: { id: 7, deleted_at: '2026-09-12T11:00:00Z' } },
    '/notifications/': { status: 200, body: {} },
  })
  const onConfirm = vi.fn().mockResolvedValue(true)
  renderChat({ ...dataFor(), directConversations: [], archivedConversations: [archived] }, vi.fn(), onConfirm)

  fireEvent.click(await screen.findByRole('tab', { name: /^Archived/ }))
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  const message = await screen.findByText('Remove this.')
  const row = message.closest('.chat-message')
  expect(row).toHaveClass('chat-message-archived')

  fireEvent.click(within(row).getByRole('button', { name: 'Delete message' }))

  await waitFor(() => {
    const deleteCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-messages/7/') && init.method === 'DELETE')
    expect(deleteCall).toBeTruthy()
  })
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

it('keeps the composer controls inside one compact message row', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor())
  await openConversation()

  const input = screen.getByRole('textbox', { name: 'Message' })
  const composeRow = input.closest('.chat-compose-input')
  expect(input).toHaveAttribute('rows', '1')
  expect(composeRow).not.toBeNull()
  expect(within(composeRow).getByRole('button', { name: 'Mention a teammate' })).toBeInTheDocument()
  expect(within(composeRow).getByRole('button', { name: 'Add emoji' })).toBeInTheDocument()
  expect(within(composeRow).getByTitle('Attach file')).toBeInTheDocument()
  expect(within(composeRow).getByRole('button', { name: 'Send' })).toBeInTheDocument()
  expect(composeRow.querySelector('.chat-compose-toolbar')).toBeNull()
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

it('archives a conversation through the confirm dialog', async () => {
  const onRefresh = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(true)
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/': { archived: 11 },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor(), onRefresh, onConfirm)

  fireEvent.click(await screen.findByRole('button', { name: 'Archive Dana Reed chat' }))

  await waitFor(() => expect(onConfirm).toHaveBeenCalled())
  // The prompt has to say the chat goes away for both sides, because that is
  // what it does now - the old copy promised new messages would bring it back.
  expect(onConfirm.mock.calls[0][0]).toMatch(/everyone in the chat/i)
  const archiveCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/11/') && init.method === 'DELETE')
  expect(archiveCall).toBeTruthy()
  expect(onRefresh).toHaveBeenCalled()
})

it('permanently deletes a conversation and its history through the confirm dialog', async () => {
  const onRefresh = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(true)
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/delete/': { deleted: 11 },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat(dataFor(), onRefresh, onConfirm)

  fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation with Dana Reed' }))

  await waitFor(() => expect(onConfirm).toHaveBeenCalled())
  expect(onConfirm.mock.calls[0][0]).toMatch(/all of its messages for everyone/i)
  expect(onConfirm.mock.calls[0][0]).toMatch(/cannot be undone/i)
  const deleteCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/11/delete/') && init.method === 'DELETE')
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

it('reduces a group to a direct chat by unticking a participant', async () => {
  const group = {
    id: 13,
    title: 'Launch team',
    is_group: true,
    participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }],
    last_message: 'Ready to launch',
  }
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/13/': { conversation: group },
    '/notifications/': { status: 200, body: {} },
  })
  const onRefresh = vi.fn()
  renderChat({ ...dataFor(), members: launchMembers, directConversations: [group] }, onRefresh)

  fireEvent.click(await screen.findByRole('button', { name: 'Edit participants for Launch team' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit participants' })
  fireEvent.click(screen.getByLabelText('Priya Shah'))

  // One other member left is a direct chat, not a group.
  expect(screen.getByText('Direct chat')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Save participants' })).toBeEnabled()

  fireEvent.submit(dialog)

  await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  const patchCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/13/') && init.method === 'PATCH')
  expect(patchCall).toBeTruthy()
  expect(JSON.parse(patchCall[1].body)).toEqual({ participant_ids: [9] })
})

it('opens the member editor from the chat header', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/notifications/': { status: 200, body: {} },
  })
  const group = {
    id: 13,
    title: 'Launch team',
    is_group: true,
    participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }],
    last_message: 'Ready to launch',
  }
  renderChat({ ...dataFor(), members: launchMembers, directConversations: [group] })

  fireEvent.click(await screen.findByRole('button', { name: /^Launch team/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Add or remove members' }))

  expect(await screen.findByRole('dialog', { name: 'Edit participants' })).toBeInTheDocument()
  expect(screen.getByLabelText('Priya Shah')).toBeChecked()
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

  expect(screen.getByRole('button', { name: 'product-launch, 1 unread message' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'general' })).not.toBeInTheDocument()
})

it('shows the unread boundary before the first new channel message', async () => {
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/chat-messages/?channel=general': { messages: [] },
    '/chat-messages/?channel=product-launch': {
      messages: [
        { id: 41, author_id: 9, author_name: 'Dana Reed', message: 'Earlier update.', created_at: '2026-09-12T09:00:00Z', channel: 'product-launch' },
        { id: 42, author_id: 9, author_name: 'Dana Reed', message: 'Deployment is ready.', created_at: '2026-09-12T10:00:00Z', channel: 'product-launch' },
        { id: 43, author_id: 8, author_name: 'Priya Shah', message: 'Thanks, checking now.', created_at: '2026-09-12T10:05:00Z', channel: 'product-launch' },
      ],
    },
    '/notifications/': { status: 200, body: {} },
  })
  render(
    <ChatWorkspaceView
      viewType="channels"
      data={{
        members: [{ id: 9, first_name: 'Dana', last_name: 'Reed' }],
        channels: [
          { id: 20, name: 'general', created_by: 9, is_private: false, member_ids: [] },
          { id: 21, name: 'product-launch', created_by: 9, is_private: false, member_ids: [] },
        ],
        messages: [],
        directConversations: [],
        notifications: [
          { target_type: 'chat_channel', target_id: 'product-launch', group_key: 'message:42', read: false },
          { target_type: 'chat_channel', target_id: 'product-launch', group_key: 'message:43', read: false },
        ],
      }}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={vi.fn()}
      onError={vi.fn()}
      onConfirm={vi.fn()}
      onNavigate={vi.fn()}
    />,
  )

  fireEvent.click(await screen.findByRole('button', { name: 'product-launch, 2 unread messages' }))

  const divider = await screen.findByRole('separator', { name: 'New messages' })
  expect(divider.nextElementSibling).toHaveAttribute('data-message-id', '42')
  expect(divider.nextElementSibling).toHaveTextContent('Deployment is ready.')
  expect(fetchMock.mock.calls.some(([url, init = {}]) => String(url).includes('/notifications/') && init.method === 'PATCH' && JSON.parse(init.body).target_id === 'product-launch')).toBe(true)
})

it('shows the unread boundary in a direct conversation', async () => {
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': {
      messages: [
        { id: 1, author_name: 'Dana Reed', message: 'Earlier note.', created_at: '2026-09-12T09:00:00Z' },
        { id: 2, author_name: 'Dana Reed', message: 'Latest note.', created_at: '2026-09-12T10:00:00Z' },
      ],
    },
    '/notifications/': { status: 200, body: {} },
  })
  renderChat({
    ...dataFor(),
    notifications: [{ target_type: 'direct_conversation', target_id: '11', group_key: 'message:2', read: false }],
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Dana Reed, 1 unread message' }))

  const divider = await screen.findByRole('separator', { name: 'New messages' })
  expect(divider.nextElementSibling).toHaveAttribute('data-message-id', '2')
  expect(divider.nextElementSibling).toHaveTextContent('Latest note.')
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

it('opens the thread a chat notification names without a click', async () => {
  // The bell used to switch to Chats and leave the reader on no thread at all,
  // so a direct-message alert never reached the message it was about.
  mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [{ id: 1, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' }] },
    '/notifications/': { status: 200, body: {} },
  })
  requestChatThread('direct_conversation', conversation.id)

  renderChat(dataFor())

  await screen.findByText('See you then.')
})

it('points the feed at the message a chat notification names', async () => {
  // The alert names the thread, but the message inside it is what the reader was
  // sent to see, so it has to be marked - in the fetched thread, which arrives
  // after the view has already decided which thread to show.
  const fetchMock = mockApi({
    '/documents/': { documents: [] },
    '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [
      { id: 4, author_name: 'Dana Reed', message: 'Earlier note.', created_at: '2026-09-12T09:00:00Z' },
      { id: 9, author_name: 'Dana Reed', message: 'See you then.', created_at: '2026-09-12T10:00:00Z' },
    ] },
    '/notifications/': { status: 200, body: {} },
  })
  requestChatThread('direct_conversation', conversation.id, 9)

  renderChat(dataFor())

  const targeted = await screen.findByText('See you then.')
  const row = targeted.closest('.chat-message')
  expect(row).toHaveAttribute('data-message-id', '9')
  expect(row).toHaveClass('chat-message-highlight')
  expect(screen.getByText('Earlier note.').closest('.chat-message')).not.toHaveClass('chat-message-highlight')
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('around=9') && String(url).includes('limit=10'))).toBe(true)
})


it.each(['direct', 'channels'])('edits %s messages in the composer and preserves the unsent draft', async viewType => {
  localStorage.clear()
  const original = { id: 51, author_id: currentUserId, author_name: 'Ada Lane', channel: 'general', message: 'Original message', created_at: '2026-09-12T10:00:00Z' }
  const endpoint = viewType === 'direct' ? '/direct-messages/51/' : '/chat-messages/51/'
  const fetchMock = mockApi({
    '/documents/': { documents: [] }, '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [original] },
    '/chat-messages/?': { messages: [original] },
    [endpoint]: { message: { ...original, message: 'Updated message' } },
    '/notifications/': { body: {} },
  })
  const props = { viewType, data: { ...dataFor(), members: launchMembers, channels: [{ id: 1, name: 'general' }], messages: [original] }, workspaceId, currentUserId, onRefresh: vi.fn(), onConfirm: vi.fn(), onError: vi.fn(), onNavigate: vi.fn() }
  const { rerender } = render(<ChatWorkspaceView {...props} />)
  if (viewType === 'direct') fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByText('Original message')
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Unsent draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('textbox', { name: 'Edit message' })
  expect(editor.closest('.chat-inline-composer')).toBeTruthy()
  expect(editor.closest('.chat-message')).toBeNull()
  expect(editor).toHaveValue('Original message')
  expect(editor).toHaveFocus()
  expect(screen.getByText('Original message', { selector: 'p' })).toBeVisible()
  fireEvent.change(editor, { target: { value: 'Discarded edit' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Unsent draft')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.change(editor, { target: { value: 'Updated message' } })
  fireEvent.submit(editor.closest('form'))
  await screen.findByText('Updated message', { selector: 'p' })
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Unsent draft')
  expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes(endpoint) && init.method === 'PATCH')).toHaveLength(1)
  expect(fetchMock.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  rerender(<ChatWorkspaceView {...props} workspaceId={5} />)
  expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
})

it('keeps failed edits available for retry and cancels with Escape', async () => {
  const original = { id: 51, author_id: currentUserId, author_name: 'Ada Lane', message: 'Original message', created_at: '2026-09-12T10:00:00Z' }
  mockApi({
    '/documents/': { documents: [] }, '/files/': { files: [] },
    '/direct-conversations/11/messages/': { messages: [original] },
    '/direct-messages/51/': { status: 500, body: { error: 'Save failed' } },
    '/notifications/': { body: {} },
  })
  renderChat({ ...dataFor(), members: launchMembers })
  fireEvent.click(await screen.findByRole('button', { name: /^DA Dana Reed/ }))
  await screen.findByText('Original message')
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('textbox', { name: 'Edit message' })
  fireEvent.change(editor, { target: { value: 'Try again' } })
  fireEvent.submit(editor.closest('form'))
  await screen.findByText('Save failed')
  expect(editor).toHaveValue('Try again')
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  fireEvent.keyDown(editor, { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: 'Edit message' })).not.toBeInTheDocument()
  expect(screen.queryByText('Save failed')).not.toBeInTheDocument()
})
