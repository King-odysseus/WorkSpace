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

const checkInNotification = {
  id: 18,
  kind: 'check_in_submitted',
  title: 'Nate Foster submitted a daily check-in',
  body: 'Completed the launch checklist.',
  target_type: 'check_in',
  target_id: '44',
  read: false,
  created_at: new Date(2026, 8, 15, 9, 2).toISOString(),
}

const checkIn = {
  id: 44,
  user_id: 7,
  user_name: 'Nate Foster',
  date: '2026-09-15',
  completed: 'Completed the launch checklist.',
  next_steps: 'Review production metrics.',
  blockers: '',
  comments: [],
}

it('opens the check-in named by a bell activity row', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/notifications/?exclude_chat=1': {
      notifications: [checkInNotification],
      unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 1 },
    },
    '/api/workspaces/1/notifications/?only_conversation=1': {
      notifications: [],
      unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 1 },
    },
    '/api/workspaces/1/notifications/': { status: 200, body: { notification: { ...checkInNotification, read: true } } },
    '/api/workspaces/1/notifications/18/': { status: 200, body: { notification: { ...checkInNotification, read: true } } },
    '/api/workspaces/1/check-ins/44/comments/': { comments: [] },
    '/api/workspaces/1/check-ins/': { check_ins: [checkIn] },
    '/api/notifications/summary/': { unread_count: 1, latest_unread_id: checkInNotification.id },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const bell = await screen.findByRole('button', { name: 'Open workspace activity notifications' }, { timeout: 20000 })
  fireEvent.click(bell)
  const row = await screen.findByRole('button', { name: 'Open Nate Foster submitted a daily check-in' })
  fireEvent.click(row)

  const dialog = await screen.findByRole('dialog', { name: 'Nate Foster' })
  expect(within(dialog).getByText('Completed the launch checklist.')).toBeInTheDocument()
  expect(within(dialog).getByText('Review production metrics.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open Nate Foster submitted a daily check-in' })).not.toBeInTheDocument()
  await waitFor(() => expect(within(dialog).getByText('Nate Foster')).toBeInTheDocument())
}, 30000)
