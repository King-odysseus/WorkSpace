import { screen, within } from '@testing-library/react'
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

it('uses the unread dot state when unread rows exist before totals are known', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/?exclude_chat=1': {
      notifications: [{
        id: 18,
        kind: 'check_in_submitted',
        title: 'Nate Foster submitted a daily check-in',
        body: 'Completed the launch checklist.',
        target_type: 'check_in',
        target_id: '44',
        read: false,
        created_at: new Date(2026, 8, 20, 9, 2).toISOString(),
      }],
    },
    '/api/workspaces/1/notifications/?only_conversation=1': {
      notifications: [{
        id: 19,
        kind: 'direct_message',
        title: 'New direct message',
        body: 'Can you review this?',
        target_type: 'direct_conversation',
        target_id: '9',
        group_key: 'message:41',
        read: false,
        created_at: new Date(2026, 8, 20, 9, 3).toISOString(),
      }],
    },
    '/api/notifications/summary/': { unread_count: 2, latest_unread_id: 19 },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const messageButton = await screen.findByRole(
    'button',
    { name: 'Open messages' },
    { timeout: 20000 },
  )
  const messageDot = await within(messageButton).findByLabelText('Unread messages')
  expect(messageDot).toHaveClass('size-2.5')
  expect(messageDot).not.toHaveTextContent('1')

  const bellButton = screen.getByRole('button', {
    name: 'Open workspace activity notifications',
  })
  const activityDot = await within(bellButton).findByLabelText(
    'Unread workspace notifications',
  )
  expect(activityDot).toHaveClass('size-2.5')
  expect(activityDot).not.toHaveTextContent('1')
}, 30000)
