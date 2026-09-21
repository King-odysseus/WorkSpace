import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mockApi } from './test/setup-tests.js'

const session = {
  user: {
    id: 7,
    email: 'nate@example.com',
    first_name: 'Nate',
    last_name: 'Foster',
    default_workspace_id: 1,
    workspaces: [{ id: 1, name: 'Northstar', role: 'owner', permissions: [] }],
  },
}

const documentNotification = {
  id: 77,
  kind: 'document_shared',
  title: 'Nate Foster shared "Launch brief" with you',
  body: 'You have comment access.',
  target_type: 'document',
  target_id: '5',
  read: false,
  created_at: new Date(2026, 8, 16, 11, 30).toISOString(),
}

const workspaceDocument = {
  id: 5,
  title: 'Launch brief',
  kind: 'document',
  content: { html: '<p>Ready for review.</p>', text: 'Ready for review.' },
  updated_at: '2026-09-16T11:30:00Z',
  created_by: 7,
  permission: 'comment',
}

it('opens the exact document named by a notification history row', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/?exclude_chat=1': {
      notifications: [documentNotification],
      unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 1 },
    },
    '/api/workspaces/1/notifications/?only_conversation=1': {
      notifications: [],
      unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 1 },
    },
    '/api/workspaces/1/notifications/?page=': {
      notifications: [documentNotification],
      summary: {
        unread_count: 1,
        weekly_total: 1,
        categories: { task_updates: 1, messages_mentions: 0, risks_members: 0 },
      },
      pagination: { page: 1, page_size: 7, total_items: 1, total_pages: 1, has_next: false, has_previous: false },
    },
    '/api/workspaces/1/notifications/77/': {
      status: 200,
      body: { notification: { ...documentNotification, read: true } },
    },
    '/api/workspaces/1/notifications/': {
      status: 200,
      body: { notification: { ...documentNotification, read: true } },
    },
    '/api/workspaces/1/documents/5/comments/': { comments: [] },
    '/api/workspaces/1/documents/5/shares/': { shares: [] },
    '/api/workspaces/1/documents/': { documents: [{ ...workspaceDocument, id: 3, title: 'Another file' }, workspaceDocument] },
    '/api/workspaces/1/files/': { files: [] },
    '/api/workspaces/1/members/': { members: [] },
    '/api/notifications/summary/': { unread_count: 1, latest_unread_id: documentNotification.id },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  fireEvent.click(await screen.findByRole('button', { name: 'Open workspace activity notifications' }, { timeout: 20000 }))
  fireEvent.click(await screen.findByRole('button', { name: 'View all workspace activity' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Open Nate Foster shared "Launch brief" with you' }))

  expect(await screen.findByDisplayValue('Launch brief', {}, { timeout: 20000 })).toBeInTheDocument()
  expect(screen.getByText('Ready for review.')).toBeInTheDocument()
}, 30000)
