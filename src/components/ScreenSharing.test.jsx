import { render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ScreenShareControl } from './ScreenSharing.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const session = (id, overrides = {}) => ({
  id,
  employee_id: 7,
  employee_name: 'Employee',
  requested_by_name: 'Manager',
  status: 'pending',
  message: '',
  policy_text: 'A consent policy that is long enough for the request dialog.',
  capture_interval_seconds: 30,
  ...overrides,
})

it('opens the notification-targeted pending request when several requests are loaded', async () => {
  mockApi({
    '/api/workspaces/1/screen-sharing/sessions/?scope=mine': {
      sessions: [session('other-session', { requested_by_name: 'Other manager' }), session('target-session')],
    },
  })

  render(<ScreenShareControl workspaceId={1} currentUserId={7} targetSessionId="target-session" />)

  expect(await screen.findByText('Manager wants you to share your screen')).toBeInTheDocument()
  expect(screen.queryByText('Other manager wants you to share your screen')).not.toBeInTheDocument()
})

it('loads the exact notification-targeted session from the screen-sharing history', async () => {
  const fetchMock = mockApi({
    '/api/workspaces/1/screen-sharing/policy/': { policy: { enabled: true, version: 1, can_manage: true, capture_interval_seconds: 30, capture_retention_days: 7, text: 'Policy' } },
    '/api/workspaces/1/screen-sharing/sessions/': { sessions: [session('other-session', { employee_name: 'Other employee', status: 'stopped', capture_count: 0 }), session('target-session', { employee_name: 'Target employee', status: 'stopped', capture_count: 0 })] },
    '/api/workspaces/1/screen-sharing/sessions/target-session/captures/': { captures: [] },
  })

  const { default: ScreenSharingView } = await import('./ScreenSharing.jsx')
  render(<ScreenSharingView workspaceId={1} members={[]} currentUserId={2} role="manager" targetSessionId="target-session" />)

  await waitFor(() => expect(screen.getByText('Captures · Target employee')).toBeInTheDocument())
  expectRequest(fetchMock, '/screen-sharing/sessions/target-session/captures/')
  expect(screen.queryByText('Captures · Other employee')).not.toBeInTheDocument()
})
