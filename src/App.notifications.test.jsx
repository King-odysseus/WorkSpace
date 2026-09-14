import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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

const activityCreatedAt = new Date(2026, 8, 14, 10, 44).toISOString()
const activityNotification = {
  id: 18,
  kind: 'deployment',
  title: 'Deployment finished',
  body: 'The production build is live.',
  target_type: 'workspace',
  target_id: '1',
  group_key: 'workspace:1',
  read: false,
  created_at: activityCreatedAt,
}

const chatNotification = {
  id: 19,
  kind: 'direct_message',
  title: 'New direct message',
  body: 'Can you review this?',
  target_type: 'direct_conversation',
  target_id: '9',
  group_key: 'message:41',
  read: false,
  created_at: new Date(2026, 8, 14, 10, 45).toISOString(),
}

const channelNotification = {
  id: 20,
  kind: 'channel_message',
  title: 'New channel message',
  body: 'Launch updates are ready.',
  target_type: 'chat_channel',
  target_id: 'general',
  group_key: 'message:42',
  read: false,
  created_at: new Date(2026, 8, 14, 10, 46).toISOString(),
}

const mountApp = async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/': { notifications: [channelNotification, chatNotification, activityNotification] },
    '/api/notifications/summary/': { unread_count: 3, latest_unread_id: channelNotification.id },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}

it('separates message alerts from workspace activity across the header and mobile nav', async () => {
  await mountApp()

  const mobileNav = await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
  expect(within(mobileNav).getByRole('button', { name: /Chats/ })).toBeInTheDocument()
  expect(within(mobileNav).queryByRole('button', { name: /Planner/ })).not.toBeInTheDocument()

  const messageButton = await screen.findByRole('button', { name: 'Open messages' }, { timeout: 20000 })
  expect(within(messageButton).getByLabelText('2 unread messages')).toBeInTheDocument()

  const bellButton = screen.getByRole('button', { name: 'Open workspace activity notifications' })
  expect(within(bellButton).getByLabelText('1 unread workspace notifications')).toBeInTheDocument()
  fireEvent.click(bellButton)

  const popoutRow = await screen.findByRole('button', { name: 'Open Deployment finished' }, { timeout: 20000 })
  expect(within(popoutRow).getByText('Deployment finished')).toHaveClass('text-xs')
  expect(within(popoutRow).getByText('The production build is live.')).toHaveClass('text-[11px]')
  const popoutTime = within(popoutRow).getByText('14-09-2026 10:44')
  expect(popoutTime.tagName).toBe('TIME')
  expect(popoutTime).toHaveAttribute('dateTime', activityCreatedAt)
  expect(screen.queryByText('New direct message')).not.toBeInTheDocument()
  expect(screen.queryByText('New channel message')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'View all workspace activity' }))

  await screen.findByText('Notifications outside chats and channels.')
  await waitFor(() => expect(screen.getAllByText('14-09-2026 10:44')).toHaveLength(1))
  const historyRow = screen.getByText('Deployment finished').closest('button')
  expect(within(historyRow).getByText('Unread')).toBeInTheDocument()
  expect(within(historyRow).getByText('14-09-2026 10:44')).toHaveAttribute('dateTime', activityCreatedAt)
  expect(screen.queryByText('New direct message')).not.toBeInTheDocument()
  expect(screen.queryByText('New channel message')).not.toBeInTheDocument()
}, 30000)
