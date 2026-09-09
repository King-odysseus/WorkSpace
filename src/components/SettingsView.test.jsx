import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
afterEach(() => {
  if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker)
  else delete navigator.serviceWorker
})

async function setup(permission = 'default', saveStatus = 201) {
  const requestPermission = vi.fn().mockResolvedValue('granted')
  vi.stubGlobal('Notification', { permission, requestPermission })
  vi.stubGlobal('PushManager', function () {})
  const subscription = {
    endpoint: 'https://push.example.test/device',
    toJSON: () => ({ endpoint: 'https://push.example.test/device', keys: { p256dh: 'key', auth: 'auth' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  const subscribe = vi.fn().mockResolvedValue(subscription)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe } }) },
  })
  const api = mockApi({
    '/api/push/public-key/': { public_key: 'AQID', configured: true },
    '/api/push/subscriptions/': { status: saveStatus, body: saveStatus === 201 ? {} : { error: 'Subscription could not be saved.' } },
    '/notification-preferences/': { preferences: {} },
    '/calendar-feed-token/': {},
  })
  render(<SettingsView currentWorkspace={{ role: 'member' }} currentUserName="Test" currentUserEmail="test@example.test" members={[]} notifications={[]} workspaceId={1} />)
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  const row = screen.getByText('Desktop notifications').closest('.settings-row')
  await waitFor(() => expect(within(row).getByRole('button', { name: 'Enable' })).toBeEnabled())
  return { row, api, subscribe, subscription, requestPermission }
}

it.each(['default', 'granted'])('registers and saves off-app delivery from Desktop Enable with %s permission', async permission => {
  const { row, api, subscribe } = await setup(permission)
  expect(within(row).queryByText(/Enabled on this device/)).not.toBeInTheDocument()
  fireEvent.click(within(row).getByRole('button', { name: 'Enable' }))
  await waitFor(() => expect(within(row).getByRole('button', { name: 'Disable' })).toBeInTheDocument())
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) })
  const [, request] = expectRequest(api, '/api/push/subscriptions/', 'POST')
  expect(JSON.parse(request.body).endpoint).toBe('https://push.example.test/device')
})

it('keeps Desktop notifications disabled and rolls back when saving fails', async () => {
  const { row, subscription } = await setup('granted', 503)
  fireEvent.click(within(row).getByRole('button', { name: 'Enable' }))
  expect(await screen.findByText('Subscription could not be saved.')).toBeInTheDocument()
  expect(subscription.unsubscribe).toHaveBeenCalled()
  expect(within(row).getByRole('button', { name: 'Enable' })).toBeEnabled()
})

it('does not subscribe when permission is denied', async () => {
  const { row, subscribe, requestPermission } = await setup()
  requestPermission.mockResolvedValue('denied')
  fireEvent.click(within(row).getByRole('button', { name: 'Enable' }))
  expect(await screen.findByText(/Blocked - allow notifications/)).toBeInTheDocument()
  expect(subscribe).not.toHaveBeenCalled()
})
