// Archiving a chat, kept in its own file: it is a self-contained behaviour and
// the composer and tick suites are already long enough.
//
// Archiving itself (the DELETE and the confirm prompt) is covered in
// ChatViews.test.jsx. This file covers the Archived tab and restoring.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ChatWorkspaceView } from './ChatViews.jsx'
import { mockApi } from '../test/setup-tests.js'

const workspaceId = 4
const currentUserId = 1

const activeChat = { id: 11, title: 'Dana Reed', is_group: false, participants: [{ id: 9 }], last_message: 'See you then' }
const archivedChat = { id: 12, title: 'Launch team', is_group: true, participants: [{ id: currentUserId }, { id: 9 }, { id: 8 }], last_message: 'Ready to launch' }

const dataFor = archived => ({
  members: [
    { id: currentUserId, first_name: 'Ada', last_name: 'Lane' },
    { id: 9, first_name: 'Dana', last_name: 'Reed' },
    { id: 8, first_name: 'Priya', last_name: 'Shah' },
  ],
  channels: [],
  messages: [],
  directConversations: [activeChat],
  archivedConversations: archived,
  notifications: [],
})

const renderChat = (data, onRefresh = vi.fn(), onConfirm = vi.fn().mockResolvedValue(true)) => {
  const result = render(
    <ChatWorkspaceView
      viewType="direct"
      data={data}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      onRefresh={onRefresh}
      onError={vi.fn()}
      onConfirm={onConfirm}
      onNavigate={vi.fn()}
    />,
  )
  return { ...result, onRefresh, onConfirm }
}

const stubCommon = {
  '/documents/': { documents: [] },
  '/files/': { files: [] },
  '/notifications/': { status: 200, body: {} },
}

const openArchivedTab = async () => {
  fireEvent.click(await screen.findByRole('tab', { name: /^Archived/ }))
}

it('keeps archived chats out of All and lists them under the Archived tab', async () => {
  mockApi(stubCommon)
  renderChat(dataFor([archivedChat]))

  expect(await screen.findByText('Dana Reed')).toBeInTheDocument()
  expect(screen.queryByText('Launch team')).not.toBeInTheDocument()

  await openArchivedTab()

  expect(screen.getByText('Launch team')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /^Archived/ })).toBeInTheDocument()
  // The active chat belongs to the other side of the tab split.
  expect(screen.queryByText('Dana Reed')).not.toBeInTheDocument()
})

it('counts the archived chats on the tab', async () => {
  mockApi(stubCommon)
  renderChat(dataFor([archivedChat]))

  expect(await screen.findByRole('tab', { name: 'Archived 1' })).toBeInTheDocument()
})

it('offers restore rather than archive, and no roster editor, on an archived chat', async () => {
  mockApi(stubCommon)
  renderChat(dataFor([archivedChat]))

  await openArchivedTab()

  expect(await screen.findByRole('button', { name: 'Restore Launch team chat' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Archive Launch team chat' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Edit participants for Launch team' })).not.toBeInTheDocument()
})

it('restores an archived chat without asking for confirmation', async () => {
  const fetchMock = mockApi({
    ...stubCommon,
    '/direct-conversations/12/restore/': { conversation: { ...archivedChat, is_archived: false } },
  })
  const { onRefresh, onConfirm } = renderChat(dataFor([archivedChat]))

  await openArchivedTab()
  fireEvent.click(await screen.findByRole('button', { name: 'Restore Launch team chat' }))

  await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  // Restoring is one click back, so it is not worth a prompt.
  expect(onConfirm).not.toHaveBeenCalled()
  const restoreCall = fetchMock.mock.calls.find(([url, init = {}]) => String(url).includes('/direct-conversations/12/restore/') && init.method === 'POST')
  expect(restoreCall).toBeTruthy()
})

it('says so when nothing is archived', async () => {
  mockApi(stubCommon)
  renderChat(dataFor([]))

  await openArchivedTab()

  expect(screen.getByText('No archived chats.')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Archived 0' })).toBeInTheDocument()
})
