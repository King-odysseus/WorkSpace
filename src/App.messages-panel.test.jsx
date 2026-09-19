import { fireEvent, screen, within } from '@testing-library/react'
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

// One page of alerts. The workspace has far more unread than this, which is the
// case the badge used to get wrong: it counted the page instead of the workspace.
const pagedAlerts = [
  {
    id: 41,
    kind: 'channel_message',
    title: 'New channel message',
    body: 'Launch updates are ready.',
    target_type: 'chat_channel',
    target_id: 'general',
    group_key: 'message:42',
    read: false,
    created_at: new Date(2026, 8, 14, 10, 46).toISOString(),
  },
  {
    id: 40,
    kind: 'direct_message',
    title: 'New direct message',
    body: 'Can you review this?',
    target_type: 'direct_conversation',
    target_id: '9',
    group_key: 'message:41',
    read: false,
    created_at: new Date(2026, 8, 14, 10, 45).toISOString(),
  },
  {
    id: 39,
    kind: 'deployment',
    title: 'Deployment finished',
    body: 'The production build is live.',
    target_type: 'workspace',
    target_id: '1',
    group_key: 'workspace:1',
    read: false,
    created_at: new Date(2026, 8, 14, 10, 44).toISOString(),
  },
]

const conversationAlerts = pagedAlerts.filter(
  notification => notification.target_type === 'chat_channel' || notification.target_type === 'direct_conversation',
)
const activityAlerts = pagedAlerts.filter(
  notification => notification.target_type !== 'chat_channel' && notification.target_type !== 'direct_conversation',
)

it('reports real unread totals and opens the messages panel from either end of the screen', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/?exclude_chat=1': {
      notifications: activityAlerts,
      unread_counts: { channel: 22, direct: 3, conversation: 25, activity: 5 },
    },
    '/api/workspaces/1/notifications/?only_conversation=1': {
      notifications: conversationAlerts,
      unread_counts: { channel: 22, direct: 3, conversation: 25, activity: 5 },
    },
    '/api/workspaces/1/notifications/?page=': {
      notifications: activityAlerts,
      unread_counts: { channel: 22, direct: 3, conversation: 25, activity: 5 },
    },
    '/api/notifications/summary/': { unread_count: 30, latest_unread_id: 41 },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  // The totals come from the workspace, so the channel alerts the page could not
  // hold are still counted on the chat icon.
  const messageButton = await screen.findByRole('button', { name: 'Open messages' }, { timeout: 20000 })
  await within(messageButton).findByLabelText('25 unread messages', {}, { timeout: 20000 })

  // The design's TabBar draws five bare tabs, so the count lives on the header's
  // chat icon alone rather than on the bar as well.
  const mobileNav = await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
  const chatsTab = within(mobileNav).getByRole('button', { name: /Chats/ })
  expect(chatsTab.querySelector('[aria-label$="unread messages"]')).toBeNull()

  const bellButton = screen.getByRole('button', { name: 'Open workspace activity notifications' })
  await within(bellButton).findByLabelText('5 unread workspace notifications', {}, { timeout: 20000 })

  // Opened from the header it hangs off the header, as it always did. It has to
  // stay inside the header, because the header's backdrop-filter is what its
  // fixed offset is measured against.
  const header = document.querySelector('header')
  fireEvent.click(messageButton)
  const panelUnderHeader = (await screen.findByRole('button', { name: /^Open Chats/ })).parentElement.parentElement
  expect(panelUnderHeader.className).toContain('sm:top-full')
  expect(panelUnderHeader.className).not.toContain('bottom-[72px]')
  expect(header.contains(panelUnderHeader)).toBe(true)
  // The panel's own count has to come from the same totals as the badge. Read
  // off the page it would say 3, because only 3 conversation rows fit in the
  // 20-row list the client is given.
  expect(within(panelUnderHeader).getByText('25 unread')).toBeTruthy()
  // A channel alert is listed in this panel, so the panel has to offer a way
  // into Channels. It used to offer Chats alone, a different screen entirely.
  expect(within(panelUnderHeader).getByRole('button', { name: 'Open Channels (22)' })).toBeTruthy()
  expect(within(panelUnderHeader).getByRole('button', { name: 'Open Chats (3)' })).toBeTruthy()
  fireEvent.click(messageButton)

  // The TabBar sits at the bottom, so the panel has to rise from the nav. That
  // only works if it is rendered outside both the header and the nav, since
  // either one's backdrop-filter would make it the offset's containing block
  // and drag the panel up to the top of the screen.
  fireEvent.click(chatsTab)
  const panelAboveNav = (await screen.findByRole('button', { name: /^Open Chats/ })).parentElement.parentElement
  expect(panelAboveNav.className).toContain('bottom-[72px]')
  expect(panelAboveNav.className).not.toContain('top-16')
  expect(panelAboveNav.className).not.toContain('sm:top-full')
  expect(header.contains(panelAboveNav)).toBe(false)
  expect(mobileNav.contains(panelAboveNav)).toBe(false)
}, 30000)
