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

const readActivityNotification = {
  id: 21,
  kind: 'weekly_summary',
  title: 'Weekly summary ready',
  body: 'Your workspace report is available.',
  target_type: 'workspace',
  target_id: '1',
  group_key: 'workspace:1',
  read: true,
  created_at: new Date(2026, 8, 13, 9, 30).toISOString(),
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
  const fetchMock = mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/?exclude_chat=1': {
      notifications: [activityNotification],
      unread_counts: { channel: 1, direct: 1, conversation: 2, activity: 1 },
    },
    '/api/workspaces/1/notifications/?only_conversation=1': {
      notifications: [channelNotification, chatNotification],
      unread_counts: { channel: 1, direct: 1, conversation: 2, activity: 1 },
    },
    '/api/workspaces/1/notifications/?page=': {
      notifications: [activityNotification, readActivityNotification],
      unread_counts: { channel: 1, direct: 1, conversation: 2, activity: 1 },
      summary: {
        unread_count: 1,
        weekly_total: 4,
        categories: { task_updates: 1, messages_mentions: 0, risks_members: 0 },
      },
      pagination: { page: 1, page_size: 7, total_items: 2, total_pages: 1, has_next: false, has_previous: false },
    },
    '/api/workspaces/1/notification-preferences/': {
      preferences: {
        mentions: true,
        direct_messages: true,
        channel_messages: true,
        task_updates: true,
        calendar_reminders: true,
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
        manager_activity: true,
      },
    },
    '/api/notifications/summary/': { unread_count: 3, latest_unread_id: channelNotification.id },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
  return fetchMock
}

it('separates message alerts from workspace activity across the header and mobile nav', async () => {
  const fetchMock = await mountApp()

  const mobileNav = await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
  expect(within(mobileNav).getByRole('button', { name: /Chats/ })).toBeInTheDocument()
  expect(within(mobileNav).getByRole('button', { name: /Planner/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open navigation' })).not.toBeInTheDocument()

  const darkModeButtons = screen.getAllByRole('button', { name: 'Switch to dark mode' })
  expect(darkModeButtons).toHaveLength(2)
  fireEvent.click(darkModeButtons[0])
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  fireEvent.click(screen.getAllByRole('button', { name: 'Switch to light mode' })[0])
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')

  const messageButton = await screen.findByRole('button', { name: 'Open messages' }, { timeout: 20000 })
  expect(await within(messageButton).findByLabelText('2 unread messages')).toBeInTheDocument()

  // The panel lists channel and direct alerts together, newest first, and leaves
  // workspace activity to the bell.
  fireEvent.click(messageButton)
  const alertRows = await screen.findAllByRole(
    'button',
    { name: /^Open New (channel|direct) message$/ },
    { timeout: 20000 },
  )
  expect(alertRows).toHaveLength(2)
  expect(within(alertRows[0]).getByText('New channel message')).toBeInTheDocument()
  expect(within(alertRows[0]).getByText('Launch updates are ready.')).toBeInTheDocument()
  expect(within(alertRows[1]).getByText('New direct message')).toBeInTheDocument()
  expect(within(alertRows[1]).getByText('Can you review this?')).toBeInTheDocument()
  expect(screen.getByText('2 unread')).toBeInTheDocument()
  expect(screen.queryByText('Deployment finished')).not.toBeInTheDocument()
  fireEvent.click(messageButton)

  // The mobile TabBar opens that same panel, so tapping it lists the alerts
  // instead of dropping straight into the newest unread thread.
  const chatsTab = within(mobileNav).getByRole('button', { name: /Chats/ })
  fireEvent.click(chatsTab)
  expect(await screen.findByRole('button', { name: 'Open New direct message' })).toBeInTheDocument()
  fireEvent.click(chatsTab)
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Open New direct message' })).not.toBeInTheDocument())

  const bellButton = screen.getByRole('button', { name: 'Open workspace activity notifications' })
  expect(within(bellButton).getByLabelText('1 unread workspace notifications')).toBeInTheDocument()
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/notifications/?exclude_chat=1&sort=newest'))).toBe(true)
  fireEvent.click(bellButton)

  const popoutRow = await screen.findByRole('button', { name: 'Open Deployment finished' }, { timeout: 20000 })
  expect(within(popoutRow).getByText('Deployment finished')).toHaveClass('text-xs')
  expect(within(popoutRow).getByText('The production build is live.')).toHaveClass('text-[11px]')
  const popoutTime = within(popoutRow).getByText('14-09-26 10:44')
  expect(popoutTime.tagName).toBe('TIME')
  expect(popoutTime).toHaveAttribute('dateTime', activityCreatedAt)
  expect(screen.queryByText('New direct message')).not.toBeInTheDocument()
  expect(screen.queryByText('New channel message')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'View all workspace activity' }))

  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/notifications/?page=1&exclude_chat=1&sort=newest'))).toBe(true)
  await screen.findByText('Everything that needs your attention, newest first.')
  await screen.findByText('1 unread · 4 total this week')
  expect(screen.getByRole('button', { name: /^All 2$/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /^Unread 1$/ })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: /^Mentions 0$/ })).toBeInTheDocument()
  const historyRow = screen.getByText('Deployment finished').closest('button')
  expect(historyRow).toHaveClass('notification-history-row')
  expect(historyRow).toHaveClass('is-unread')
  expect(historyRow.closest('[data-slot="card"]')).toHaveClass('notification-history')
  expect(historyRow.querySelector('.notification-unread-dot')).toBeInTheDocument()
  expect(within(historyRow).getByText(/deployment/)).toBeInTheDocument()
  expect(historyRow.querySelector('time')).toHaveAttribute('dateTime', activityCreatedAt)
  const readHistoryRow = screen.getByText('Weekly summary ready').closest('button')
  expect(readHistoryRow).toHaveClass('is-read')
  expect(readHistoryRow.querySelector('.notification-unread-dot')).toHaveClass('is-hidden')
  expect(within(readHistoryRow).getByText(/weekly summary/)).toBeInTheDocument()
  expect(screen.getByText('need attention')).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Notification sound' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.queryByText('New direct message')).not.toBeInTheDocument()
  expect(screen.queryByText('New channel message')).not.toBeInTheDocument()

  fireEvent.click(within(mobileNav).getByRole('button', { name: /Today/ }))
  await screen.findByRole('heading', { name: 'Today' })
  fireEvent.click(screen.getByRole('button', { name: 'Open workspace activity' }))
  const mobileViewAll = await screen.findByRole('button', { name: 'View all workspace activity' })
  // The activity sheet is mounted outside the header on phones. Its own
  // mousedown must not dismiss it before the View all click can run.
  fireEvent.mouseDown(mobileViewAll)
  expect(mobileViewAll).toBeInTheDocument()
  fireEvent.click(mobileViewAll)
  await screen.findByText('Everything that needs your attention, newest first.')
}, 60000)
