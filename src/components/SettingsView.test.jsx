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
  const requestPermission = vi.fn(async () => { Notification.permission = 'granted'; return 'granted' })
  vi.stubGlobal('Notification', { permission, requestPermission })
  vi.stubGlobal('PushManager', function () {})
  const subscription = {
    endpoint: 'https://push.example.test/device',
    options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
    toJSON: () => ({ endpoint: 'https://push.example.test/device', keys: { p256dh: 'key', auth: 'auth' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  const getSubscription = vi.fn().mockResolvedValue(null)
  const subscribe = vi.fn(async () => { getSubscription.mockResolvedValue(subscription); return subscription })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
  })
  const api = mockApi({
    '/api/push/public-key/': { public_key: 'AQID', configured: true },
    '/api/push/subscriptions/': { status: saveStatus, body: saveStatus === 201 ? {} : { error: 'Subscription could not be saved.' } },
    '/notification-preferences/': { preferences: {
      notification_sound: true,
      notification_sound_name: 'chime',
      notification_volume: 70,
    } },
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

it('saves the Notification sound choice from notification settings', async () => {
  const { api } = await setup()
  const row = screen.getByText('Notification sound').closest('.settings-row')
  fireEvent.click(within(row).getByRole('button', { name: 'On' }))
  await waitFor(() => expectRequest(api, '/notification-preferences/', 'PATCH'))
  const [, request] = expectRequest(api, '/notification-preferences/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({ notification_sound: false })
})

it('offers New workspace to any account, even one that owns nothing', () => {
  // Every account may own a workspace, so a plain member of someone else's
  // workspace still gets the entry point.
  const onCreateWorkspace = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[{ id: 1, name: 'Northstar', role: 'member' }]}
      onCreateWorkspace={onCreateWorkspace}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  fireEvent.click(screen.getByRole('button', { name: /New workspace/ }))

  expect(onCreateWorkspace).toHaveBeenCalled()
})

it('switches the open workspace without touching the sign-in default', () => {
  const onSwitchWorkspace = vi.fn()
  const onSetDefaultWorkspace = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[
        { id: 1, name: 'Northstar', role: 'owner', status: 'active' },
        { id: 2, name: 'Side Project', role: 'owner', status: 'active' },
      ]}
      onCreateWorkspace={vi.fn()}
      onSwitchWorkspace={onSwitchWorkspace}
      onSetDefaultWorkspace={onSetDefaultWorkspace}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  expect(screen.getByRole('button', { name: 'Open now' })).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Switch' }))

  expect(onSwitchWorkspace).toHaveBeenCalledWith(2)
  expect(onSetDefaultWorkspace).not.toHaveBeenCalled()
})

it('opens the team roster of a workspace you manage', () => {
  const onSwitchWorkspace = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[
        { id: 1, name: 'Northstar', role: 'member', status: 'active' },
        { id: 2, name: 'Side Project', role: 'owner', status: 'active' },
      ]}
      onCreateWorkspace={vi.fn()}
      onSwitchWorkspace={onSwitchWorkspace}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  // Only the workspace you own offers this; the one you merely belong to does not.
  fireEvent.click(screen.getByRole('button', { name: 'Manage team' }))

  expect(onSwitchWorkspace).toHaveBeenCalledWith(2)
})

it('saves the sound style and volume from notification settings', async () => {
  const { api } = await setup()
  fireEvent.click(screen.getByRole('combobox', { name: 'Notification sound style' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Bell' }))
  await waitFor(() => {
    const updates = api.mock.calls.filter(([url, init = {}]) =>
      String(url).includes('/notification-preferences/') && init.method === 'PATCH')
    expect(updates).toHaveLength(1)
    expect(JSON.parse(updates[0][1].body)).toEqual({ notification_sound_name: 'bell' })
  })

  const volume = screen.getByRole('slider', { name: 'Notification sound volume' })
  fireEvent.change(volume, { target: { value: '35' } })
  fireEvent.pointerUp(volume)
  await waitFor(() => {
    const updates = api.mock.calls.filter(([url, init = {}]) =>
      String(url).includes('/notification-preferences/') && init.method === 'PATCH')
    expect(updates).toHaveLength(2)
    expect(JSON.parse(updates[1][1].body)).toEqual({ notification_volume: 35 })
  })
})
