import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsView from './SettingsView.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
afterEach(() => {
  if (originalWorker) Object.defineProperty(navigator, 'serviceWorker', originalWorker)
  else delete navigator.serviceWorker
})

it('uses a mobile settings index before opening one section', () => {
  render(
    <SettingsView
      currentWorkspace={{ role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
    />,
  )

  const shell = document.querySelector('.settings-shell')
  const navigation = screen.getByRole('navigation', { name: 'Settings sections' })
  expect(shell).toHaveClass('is-mobile-index')
  expect(within(navigation).getByText('Appearance')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(shell).toHaveClass('is-mobile-detail')

  fireEvent.click(screen.getByRole('button', { name: 'Back to settings sections' }))
  expect(shell).toHaveClass('is-mobile-index')
})

it('orders settings by everyday priority with Profile first', () => {
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  const navigation = screen.getByRole('navigation', { name: 'Settings sections' })
  const labels = within(navigation)
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter(Boolean)

  expect(labels).toEqual([
    'Profile',
    'Appearance',
    'Notifications',
    'Workspaces',
    'Workspace access',
    'AI settings',
    'Integrations',
    'Templates',
    'Help',
    'Legal',
  ])
})

it('renders the designed appearance, workspace, and template structures', () => {
  const onToggleSidebar = vi.fn()
  render(
    <SettingsView
      theme="light"
      onToggleSidebar={onToggleSidebar}
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      currentUserPresence="available"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[{ id: 1, name: 'Northstar', role: 'owner', status: 'active' }]}
      taskTemplates={[]}
      projectTemplates={[]}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('radiogroup', { name: 'Sidebar' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Collapsed' }))
  expect(onToggleSidebar).toHaveBeenCalledTimes(1)

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  expect(document.querySelector('.settings-workspace-grid')).toBeInTheDocument()
  expect(document.querySelector('.settings-workspace-card')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
  expect(document.querySelector('.settings-template-grid')).toBeInTheDocument()
  expect(document.querySelector('.settings-template-preview')).toBeInTheDocument()
})

it('groups notification categories and exposes switches with pressed state', async () => {
  mockApi({
    '/notification-preferences/': {
      preferences: {
        mentions: true,
        direct_messages: true,
        channel_messages: true,
        task_updates: true,
        calendar_reminders: true,
        manager_activity: false,
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  expect(await screen.findByRole('switch', { name: 'Mentions' })).toHaveAttribute('aria-checked', 'true')
  expect(document.querySelectorAll('.settings-group-card')).toHaveLength(3)
  const soundRow = screen.getByText('Notification sound').closest('.settings-row')
  expect(within(soundRow).getByRole('switch', { name: 'Notification sound' })).toHaveAttribute('aria-checked', 'true')
})

it('renders integrations as a calendar card and a webhook connection form', async () => {
  mockApi({
    '/api/workspaces/1/webhooks/?page_size=500': { webhooks: [] },
    '/api/workspaces/1/calendar-feed-token/': { token: 'calendar-token' },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Integrations' }))
  expect(await screen.findByText('Calendar subscribe link')).toBeInTheDocument()
  expect(document.querySelector('.settings-integration-card')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Copy subscribe link' })).toBeInTheDocument()
  expect(document.querySelector('.settings-webhook-form')).toBeInTheDocument()
})

it('lets an owner save daily and weekly working hours for a member', async () => {
  const api = mockApi({
    '/api/workspaces/1/notification-preferences/': {
      preferences: {
        mentions: true,
        direct_messages: true,
        channel_messages: true,
        task_updates: true,
        calendar_reminders: true,
        manager_activity: true,
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
    '/api/workspaces/1/check-in-settings/': {
      settings: { check_in_reminder_hour: 9 },
    },
    '/api/workspaces/1/ai/settings/': {
      can_manage: true,
      settings: {
        ai_enabled: false,
        ai_user_ids: [],
        ai_enabled_providers: [],
        ai_default_provider: 'openai',
      },
      providers: {},
      provider_config: {},
    },
    '/api/workspaces/1/members/2/': {
      member: {
        id: 2,
        email: 'amara@example.test',
        daily_capacity_minutes: 450,
        weekly_capacity_minutes: 2250,
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      currentUserId={1}
      members={[{ id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test', role: 'member', daily_capacity_minutes: 480, weekly_capacity_minutes: 2400 }]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily hours for Amara Okafor' }), { target: { value: '7.5' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Weekly hours for Amara Okafor' }), { target: { value: '37.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save hours for Amara Okafor' }))

  await waitFor(() => expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH'))
  const [, request] = expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({ daily_capacity_minutes: 450, weekly_capacity_minutes: 2250 })
})

it('lets a manager save working hours for a regular member only', async () => {
  const api = mockApi({
    '/api/workspaces/1/members/2/': {
      member: {
        id: 2,
        email: 'amara@example.test',
        daily_capacity_minutes: 420,
        weekly_capacity_minutes: 2100,
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'manager' }}
      currentUserName="Morgan"
      currentUserEmail="morgan@example.test"
      currentUserId={1}
      members={[
        { id: 1, first_name: 'Morgan', last_name: 'Lee', email: 'morgan@example.test', role: 'manager', daily_capacity_minutes: 480, weekly_capacity_minutes: 2400 },
        { id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test', role: 'member', daily_capacity_minutes: 480, weekly_capacity_minutes: 2400 },
      ]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  expect(screen.queryByRole('spinbutton', { name: 'Daily hours for Morgan Lee' })).not.toBeInTheDocument()

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily hours for Amara Okafor' }), { target: { value: '7' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Weekly hours for Amara Okafor' }), { target: { value: '35' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save hours for Amara Okafor' }))

  await waitFor(() => expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH'))
  const [, request] = expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({ daily_capacity_minutes: 420, weekly_capacity_minutes: 2100 })
})

it('renders the P4 AI panel and saves provider and member access changes together', async () => {
  const api = mockApi({
    '/api/workspaces/1/ai/settings/': {
      can_manage: true,
      settings: {
        ai_enabled: true,
        ai_user_ids: [],
        ai_enabled_providers: ['openai'],
        ai_default_provider: 'openai',
      },
      providers: { openai: true, claude: false, kimi: false, deepseek: false },
      provider_config: {
        openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', has_api_key: true, key_hint: '••••1234' },
        claude: { base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest', has_api_key: false, key_hint: '' },
        kimi: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', has_api_key: false, key_hint: '' },
        deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', has_api_key: false, key_hint: '' },
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[{ id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test' }]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }))
  expect(await screen.findByRole('heading', { name: 'AI assistance' })).toBeInTheDocument()
  expect(screen.getByText('OpenAI · gpt-4o-mini')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: /Configure Anthropic · Claude/ }))
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-4-sonnet' } })
  fireEvent.click(screen.getByRole('switch', { name: 'Allow Amara Okafor to use AI' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expectRequest(api, '/api/workspaces/1/ai/settings/', 'PATCH'))
  const [, request] = expectRequest(api, '/api/workspaces/1/ai/settings/', 'PATCH')
  const body = JSON.parse(request.body)
  expect(body.ai_user_ids).toEqual([2])
  expect(body.provider_config.claude.model).toBe('claude-4-sonnet')
  expect(body.provider_config.openai.api_key).toBe('')
})

it('cancels unsaved AI provider and member access changes', async () => {
  mockApi({
    '/api/workspaces/1/ai/settings/': {
      can_manage: true,
      settings: {
        ai_enabled: true,
        ai_user_ids: [],
        ai_enabled_providers: ['openai'],
        ai_default_provider: 'openai',
      },
      providers: { openai: true, claude: false, kimi: false, deepseek: false },
      provider_config: {
        openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', has_api_key: true, key_hint: '••••1234' },
        claude: { base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest', has_api_key: false, key_hint: '' },
        kimi: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', has_api_key: false, key_hint: '' },
        deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', has_api_key: false, key_hint: '' },
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[{ id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test' }]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  const memberSwitch = await screen.findByRole('switch', { name: 'Allow Amara Okafor to use AI' })
  fireEvent.click(screen.getByRole('button', { name: /Configure Anthropic · Claude/ }))
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-4-sonnet' } })
  fireEvent.click(memberSwitch)
  expect(memberSwitch).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByLabelText('Model')).toHaveValue('claude-4-sonnet')

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(memberSwitch).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByLabelText('Model')).not.toBeInTheDocument()
})

it('shows AI settings read-only when the API denies management', async () => {
  mockApi({
    '/api/workspaces/1/ai/settings/': {
      can_manage: false,
      settings: {
        ai_enabled: true,
        ai_user_ids: [],
        ai_enabled_providers: ['openai'],
        ai_default_provider: 'openai',
      },
      providers: { openai: true, claude: false, kimi: false, deepseek: false },
      provider_config: {
        openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', has_api_key: true, key_hint: '••••1234' },
        claude: { base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-haiku-latest', has_api_key: false, key_hint: '' },
        kimi: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', has_api_key: false, key_hint: '' },
        deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', has_api_key: false, key_hint: '' },
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[{ id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test' }]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  expect(await screen.findByRole('heading', { name: 'AI assistance' })).toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Enable AI assistance' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'Allow Amara Okafor to use AI' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
})

it('opens the Help and Legal views from Settings, including for members', () => {
  const onNavigate = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      onNavigate={onNavigate}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(onNavigate).toHaveBeenCalledWith('Help')

  fireEvent.click(screen.getByRole('button', { name: 'Legal' }))
  expect(onNavigate).toHaveBeenCalledWith('Legal')

  // Documentation is not a workspace administration panel, so a member keeps it
  // while the owner/manager-only sections stay hidden.
  expect(screen.queryByRole('button', { name: 'Workspace access' })).not.toBeInTheDocument()
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
  fireEvent.click(within(row).getByRole('switch', { name: 'Notification sound' }))
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
