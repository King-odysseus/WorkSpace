import { render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ScreenShareControl } from './ScreenSharing.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const session = (id, overrides = {}) => ({
  id,
  employee_id: 7,
  employee_name: 'Employee',
  employee_email: 'employee@example.com',
  requested_by_id: 8,
  requested_by_name: 'Manager',
  status: 'pending',
  message: '',
  policy_text: 'A consent policy that is long enough for the request dialog.',
  capture_interval_seconds: 30,
  capture_retention_days: 7,
  policy_version: 3,
  created_at: '2026-09-21T09:00:00Z',
  started_at: null,
  accepted_at: null,
  ended_at: null,
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

it('renders the active session console from supported session fields', async () => {
  mockApi({
    '/api/workspaces/1/screen-sharing/policy/': { policy: { enabled: true, version: 3, can_manage: true, capture_interval_seconds: 30, capture_retention_days: 7, text: 'Policy' } },
    '/api/workspaces/1/screen-sharing/sessions/': {
      sessions: [session('active-session', {
        status: 'active',
        employee_name: 'Amara Okafor',
        employee_email: 'amara@example.com',
        requested_by_name: 'Nate Manager',
        started_at: '2026-09-21T09:00:00Z',
        accepted_at: '2026-09-21T09:00:00Z',
        capture_count: 3,
      })],
    },
  })

  const { default: ScreenSharingView } = await import('./ScreenSharing.jsx')
  render(<ScreenSharingView
    workspaceId={1}
    currentUserId={8}
    role="manager"
    members={[
      { id: 7, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.com' },
      { id: 8, first_name: 'Nate', last_name: 'Manager', email: 'nate@example.com' },
    ]}
  />)

  expect(await screen.findByText('Consent-based capture is active')).toBeInTheDocument()
  expect(screen.getAllByText('Amara Okafor').length).toBeGreaterThan(1)
  expect(screen.getByText('Every 30s')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Request sharing' })).toBeEnabled()
  expect(screen.queryByText(/viewer count/i)).not.toBeInTheDocument()
})

it('shows the disabled policy state without enabling the request action', async () => {
  mockApi({
    '/api/workspaces/1/screen-sharing/policy/': { policy: { enabled: false, version: 2, can_manage: false, capture_interval_seconds: 60, capture_retention_days: 7, text: 'A disabled consent policy for screen sharing.' } },
    '/api/workspaces/1/screen-sharing/sessions/': { sessions: [] },
  })

  const { default: ScreenSharingView } = await import('./ScreenSharing.jsx')
  render(<ScreenSharingView workspaceId={1} currentUserId={8} role="manager" members={[]} />)

  expect(await screen.findByText('Start with a consent request')).toBeInTheDocument()
  expect(screen.getAllByText('Not permitted').length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Request sharing' })).toBeDisabled()
})
