import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import NotificationPermissionPrompt from './NotificationPermissionPrompt.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

function setup(permission = 'default', saveStatus = 201) {
  const requestPermission = vi.fn(async () => { Notification.permission = 'granted'; return 'granted' })
  vi.stubGlobal('Notification', { permission, requestPermission })
  vi.stubGlobal('PushManager', function () {})
  const subscription = { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer }, toJSON: () => ({ endpoint: 'https://push.example.test/x', keys: { auth: 'auth', p256dh: 'key' } }), unsubscribe: vi.fn().mockResolvedValue(true) }
  const getSubscription = vi.fn().mockResolvedValue(null)
  const subscribe = vi.fn(async () => { getSubscription.mockResolvedValue(subscription); return subscription })
  const registration = { pushManager: { getSubscription, subscribe } }
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn().mockResolvedValue(registration), getRegistration: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration) } })
  const api = mockApi({ '/api/push/public-key/': { public_key: 'AQID', configured: true }, '/api/push/subscriptions/': { status: saveStatus, body: { error: 'Save failed.' } } })
  render(<NotificationPermissionPrompt unreadCount={27} />)
  return { requestPermission, subscribe, api, subscription }
}

it('prompts on screen but only requests native permission after the Allow click', async () => {
  const { requestPermission, subscribe, api } = setup()
  const button = await screen.findByRole('button', { name: 'Allow notifications' })
  expect(requestPermission).not.toHaveBeenCalled()
  expect(screen.getByText('27 unread across your workspaces.')).toBeInTheDocument()
  fireEvent.click(button)
  await waitFor(() => expect(subscribe).toHaveBeenCalled())
  expectRequest(api, '/api/push/subscriptions/', 'POST')
  expect(requestPermission).toHaveBeenCalledTimes(1)
  expect(await screen.findByText(/Notifications enabled on this device/)).toBeInTheDocument()
})

it('shows blocked guidance without trying to re-prompt', async () => {
  const { requestPermission } = setup('denied')
  expect(await screen.findByText(/Notifications blocked/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Allow notifications' })).not.toBeInTheDocument()
  expect(requestPermission).not.toHaveBeenCalled()
})

it('shows a save failure and rolls back the newly created subscription', async () => {
  const { subscription } = setup('default', 503)
  fireEvent.click(await screen.findByRole('button', { name: 'Allow notifications' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed.')
  expect(subscription.unsubscribe).toHaveBeenCalled()
})

it('explains Home Screen setup when push is unsupported', () => {
  vi.stubGlobal('Notification', undefined)
  vi.stubGlobal('navigator', {})
  render(<NotificationPermissionPrompt unreadCount={0} />)
  expect(screen.getByText(/On iPhone or iPad, add WorkSpace to your Home Screen/)).toBeInTheDocument()
})
