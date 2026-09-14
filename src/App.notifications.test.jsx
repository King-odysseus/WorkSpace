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

const createdAt = new Date(2026, 8, 14, 10, 44).toISOString()
const notification = {
  id: 18,
  kind: 'deployment',
  title: 'Deployment finished',
  body: 'The production build is live.',
  target_type: 'workspace',
  target_id: '1',
  group_key: 'workspace:1',
  read: false,
  created_at: createdAt,
}

const mountApp = async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/': { notifications: [notification] },
    '/api/notifications/summary/': { unread_count: 1, latest_unread_id: notification.id },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}

it('shows compact notifications with explicit day and time in the bell and history', async () => {
  await mountApp()

  fireEvent.click(await screen.findByRole('button', { name: 'Open notifications' }, { timeout: 20000 }))

  const popoutRow = await screen.findByRole('button', { name: 'Open Deployment finished' }, { timeout: 20000 })
  expect(within(popoutRow).getByText('Deployment finished')).toHaveClass('text-xs')
  expect(within(popoutRow).getByText('The production build is live.')).toHaveClass('text-[11px]')
  const popoutTime = within(popoutRow).getByText('14-09-2026 10:44')
  expect(popoutTime.tagName).toBe('TIME')
  expect(popoutTime).toHaveAttribute('dateTime', createdAt)

  fireEvent.click(screen.getByRole('button', { name: 'View all notifications' }))

  await screen.findByText('Your workspace notification history.')
  await waitFor(() => expect(screen.getAllByText('14-09-2026 10:44')).toHaveLength(1))
  const historyRow = screen.getByText('Deployment finished').closest('button')
  expect(within(historyRow).getByText('Unread')).toBeInTheDocument()
  expect(within(historyRow).getByText('14-09-2026 10:44')).toHaveAttribute('dateTime', createdAt)
}, 30000)
