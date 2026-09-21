import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    // Moved out of the sidebar: whole pages, reached from here like Help and Legal.
    "What's new",
    'Install app',
    'Screen sharing',
    'Help',
    'Legal',
  ])
})

it('uses the active settings section in the page heading', () => {
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

  expect(screen.getByRole('heading', { level: 1, name: 'Profile' })).toBeInTheDocument()
  expect(document.querySelector('[data-slot="page-header-eyebrow"]')).toHaveTextContent('Settings')

  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  expect(screen.getByRole('heading', { level: 1, name: 'Appearance' })).toBeInTheDocument()
  expect(screen.queryByText('Your account')).not.toBeInTheDocument()
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

it('keeps the previous appearance when local persistence fails, then retries', () => {
  const onSetTheme = vi.fn()
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage blocked')
  })
  render(
    <SettingsView
      theme="light"
      onSetTheme={onSetTheme}
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }))
  fireEvent.click(screen.getByRole('radio', { name: /Dark/ }))

  expect(onSetTheme).not.toHaveBeenCalled()
  expect(screen.getByText('Could not save appearance')).toBeInTheDocument()

  setItem.mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  expect(onSetTheme).toHaveBeenCalledWith('dark')
})

it('keeps the previous profile photo, then retries the failed upload with the same file', async () => {
  const api = mockApi({})
  const onProfileUpdated = vi.fn()
  const originalFetch = api.getMockImplementation()
  let failUpload = true
  api.mockImplementation(async (input, init = {}) => {
    if (String(input).includes('/api/auth/me/avatar/') && init.method === 'POST') {
      if (failUpload) {
        failUpload = false
        return {
          ok: false,
          status: 503,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Photo could not be uploaded.' }),
          text: async () => '{"error":"Photo could not be uploaded."}',
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ avatar_url: '/media/avatar.png' }),
        text: async () => '{"avatar_url":"/media/avatar.png"}',
      }
    }
    return originalFetch(input, init)
  })
  const { container } = render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      onProfileUpdated={onProfileUpdated}
    />,
  )

  const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [file] },
  })

  expect(await screen.findByText('Photo could not be updated')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith({
    avatar_url: expect.stringMatching(/^\/media\/avatar\.png\?t=\d+$/),
  }))
  const uploads = api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/api/auth/me/avatar/') && init.method === 'POST')
  expect(uploads).toHaveLength(2)
  expect(uploads[1][1].body.get('avatar')).toBe(file)
})

it('retries a failed profile photo removal instead of asking for another file', async () => {
  const api = mockApi({})
  const onProfileUpdated = vi.fn()
  const originalFetch = api.getMockImplementation()
  let failRemoval = true
  api.mockImplementation(async (input, init = {}) => {
    if (String(input).includes('/api/auth/me/avatar/') && init.method === 'DELETE') {
      if (failRemoval) {
        failRemoval = false
        return {
          ok: false,
          status: 503,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Photo could not be removed.' }),
          text: async () => '{"error":"Photo could not be removed."}',
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ avatar_url: '' }),
        text: async () => '{"avatar_url":""}',
      }
    }
    return originalFetch(input, init)
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      currentUserAvatarUrl="/media/avatar.png"
      members={[]}
      notifications={[]}
      workspaceId={1}
      onProfileUpdated={onProfileUpdated}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))

  expect(await screen.findByText('Photo could not be removed.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Choose file' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith({ avatar_url: '' }))
  const removals = api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/api/auth/me/avatar/') && init.method === 'DELETE')
  expect(removals).toHaveLength(2)
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

it('shows explicit guidance when notification sound is disabled', async () => {
  mockApi({
    '/notification-preferences/': {
      preferences: {
        mentions: true,
        notification_sound: false,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
    '/api/push/public-key/': { configured: false, public_key: '' },
    '/api/workspaces/1/check-in-settings/': { settings: { check_in_reminder_hour: 9 } },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

  expect(await screen.findByText('Notification sound is disabled')).toBeInTheDocument()
  expect(screen.getByText(/desktop notification sounds may follow/i)).toBeInTheDocument()
})

it('rolls back a failed notification switch and retries that preference', async () => {
  const api = mockApi({
    '/notification-preferences/': {
      preferences: {
        mentions: true,
        direct_messages: true,
        channel_messages: true,
        task_updates: true,
        calendar_reminders: true,
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
    '/api/push/public-key/': { configured: false, public_key: '' },
    '/api/workspaces/1/check-in-settings/': { settings: { check_in_reminder_hour: 9 } },
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
  const mentions = await screen.findByRole('switch', { name: 'Mentions' })
  const originalFetch = api.getMockImplementation()
  let failNextSave = true
  api.mockImplementation(async (input, init = {}) => {
    if (failNextSave && String(input).includes('/notification-preferences/') && init.method === 'PATCH') {
      failNextSave = false
      return {
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Preference could not be saved.' }),
        text: async () => '{"error":"Preference could not be saved."}',
      }
    }
    return originalFetch(input, init)
  })

  fireEvent.click(mentions)

  expect(await screen.findByText('Preferences were not saved')).toBeInTheDocument()
  await waitFor(() => expect(mentions).toHaveAttribute('aria-checked', 'true'))

  const saveAlert = screen.getByText('Preferences were not saved').closest('[data-slot="alert"]')
  fireEvent.click(within(saveAlert).getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(mentions).toHaveAttribute('aria-checked', 'true'))
  const preferenceWrites = api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/notification-preferences/') && init.method === 'PATCH')
  expect(preferenceWrites).toHaveLength(2)
})

it('rolls back a failed check-in reminder save and retries the selected hour', async () => {
  const api = mockApi({
    '/api/workspaces/1/notification-preferences/': {
      preferences: {
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
    '/api/workspaces/1/check-in-settings/': {
      settings: { check_in_reminder_hour: 9 },
    },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  const originalFetch = api.getMockImplementation()
  let failNextSave = true
  api.mockImplementation(async (input, init = {}) => {
    if (String(input).includes('/api/workspaces/1/check-in-settings/') && init.method === 'PATCH') {
      if (failNextSave) {
        failNextSave = false
        return {
          ok: false,
          status: 503,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Check-in reminder could not be saved.' }),
          text: async () => '{"error":"Check-in reminder could not be saved."}',
        }
      }
      const body = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ settings: { check_in_reminder_hour: body.check_in_reminder_hour } }),
        text: async () => JSON.stringify({ settings: body }),
      }
    }
    return originalFetch(input, init)
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
  const user = userEvent.setup()
  const reminder = await screen.findByRole('combobox', { name: 'Daily check-in reminder hour' })
  await user.click(reminder)
  await user.click(await screen.findByRole('option', { name: '10:00' }))

  expect(await screen.findByText('Check-in reminder was not saved')).toBeInTheDocument()
  await waitFor(() => expect(reminder).toHaveTextContent('09:00'))

  const alert = screen.getByText('Check-in reminder was not saved').closest('[data-slot="alert"]')
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(reminder).toHaveTextContent('10:00'))
  const saves = api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/api/workspaces/1/check-in-settings/') && init.method === 'PATCH')
  expect(saves).toHaveLength(2)
  expect(JSON.parse(saves[1][1].body)).toEqual({ check_in_reminder_hour: 10 })
  expect(api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/api/workspaces/1/check-in-settings/') && !init.method)).toHaveLength(1)
})

it('rolls back a failed presence update and retries the selected value', async () => {
  const api = mockApi({
    '/api/auth/me/presence/': {
      status: 503,
      body: { error: 'Presence could not be updated.' },
    },
  })
  const onProfileUpdated = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      currentUserPresence="available"
      members={[]}
      notifications={[]}
      workspaceId={1}
      onProfileUpdated={onProfileUpdated}
    />,
  )

  const user = userEvent.setup()
  const presence = screen.getByRole('combobox', { name: 'Set your presence' })
  await user.click(presence)
  await user.click(await screen.findByRole('option', { name: 'Busy' }))

  expect(await screen.findByText('Availability could not be updated')).toBeInTheDocument()
  await waitFor(() => expect(presence).toHaveTextContent('Available'))

  const originalFetch = api.getMockImplementation()
  api.mockImplementation(async (input, init = {}) => {
    if (String(input).includes('/api/auth/me/presence/') && init.method === 'PATCH') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ presence: 'busy' }),
        text: async () => '{"presence":"busy"}',
      }
    }
    return originalFetch(input, init)
  })

  const alert = screen.getByText('Availability could not be updated').closest('[data-slot="alert"]')
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

  await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith({ presence: 'busy' }))
  const presenceWrites = api.mock.calls.filter(([url, init = {}]) =>
    String(url).includes('/api/auth/me/presence/') && init.method === 'PATCH')
  expect(presenceWrites).toHaveLength(2)
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

it('lets an owner save daily hours and working days for a member', async () => {
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
        working_days: [0, 1, 2, 3],
        weekly_capacity_minutes: 1800,
      },
    },
  })
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      currentUserId={1}
      members={[{ id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test', role: 'member', daily_capacity_minutes: 480, working_days: [0, 1, 2, 3, 4], weekly_capacity_minutes: 2400 }]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily hours for Amara Okafor' }), { target: { value: '7.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Friday for Amara Okafor' }))
  expect(screen.getByLabelText('Weekly summary for Amara Okafor')).toHaveTextContent('30h')
  expect(screen.getByLabelText('Weekly summary for Amara Okafor')).toHaveTextContent('4 days')
  fireEvent.click(screen.getByRole('button', { name: 'Save hours for Amara Okafor' }))

  await waitFor(() => expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH'))
  const [, request] = expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({ daily_capacity_minutes: 450, working_days: [0, 1, 2, 3] })
})

it('lets a manager save working hours for a regular member only', async () => {
  const api = mockApi({
    '/api/workspaces/1/members/2/': {
      member: {
        id: 2,
        email: 'amara@example.test',
        daily_capacity_minutes: 420,
        working_days: [0, 1, 2, 3, 4],
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
        { id: 1, first_name: 'Morgan', last_name: 'Lee', email: 'morgan@example.test', role: 'manager', daily_capacity_minutes: 480, working_days: [0, 1, 2, 3, 4], weekly_capacity_minutes: 2400 },
        { id: 2, first_name: 'Amara', last_name: 'Okafor', email: 'amara@example.test', role: 'member', daily_capacity_minutes: 480, working_days: [0, 1, 2, 3, 4], weekly_capacity_minutes: 2400 },
      ]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  expect(screen.queryByRole('spinbutton', { name: 'Daily hours for Morgan Lee' })).not.toBeInTheDocument()
  expect(screen.queryByRole('spinbutton', { name: 'Weekly hours for Amara Okafor' })).not.toBeInTheDocument()

  fireEvent.change(screen.getByRole('spinbutton', { name: 'Daily hours for Amara Okafor' }), { target: { value: '7' } })
  expect(screen.getByLabelText('Weekly summary for Amara Okafor')).toHaveTextContent('35h')
  fireEvent.click(screen.getByRole('button', { name: 'Save hours for Amara Okafor' }))

  await waitFor(() => expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH'))
  const [, request] = expectRequest(api, '/api/workspaces/1/members/2/', 'PATCH')
  expect(JSON.parse(request.body)).toEqual({ daily_capacity_minutes: 420, working_days: [0, 1, 2, 3, 4] })
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

  // Settings now opens on Profile, so this AI panel is reached by name.
  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }))
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

  // Settings now opens on Profile, so this AI panel is reached by name.
  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }))
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
  expect(screen.getByText('Browser permission blocked')).toBeInTheDocument()
  expect(subscribe).not.toHaveBeenCalled()
})

it('retries device notification configuration after it could not load', async () => {
  const api = mockApi({
    '/api/push/public-key/': { configured: false, public_key: '' },
    '/notification-preferences/': {
      preferences: {
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
  })
  const originalFetch = api.getMockImplementation()
  let failNextConfig = true
  api.mockImplementation(async (input, init = {}) => {
    if (failNextConfig && String(input).includes('/api/push/public-key/')) {
      failNextConfig = false
      return {
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Push configuration could not be loaded.' }),
        text: async () => '{"error":"Push configuration could not be loaded."}',
      }
    }
    return originalFetch(input, init)
  })

  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

  expect(await screen.findByText('Device alerts could not be updated')).toBeInTheDocument()
  const alert = screen.getByText('Device alerts could not be updated').closest('[data-slot="alert"]')
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))

  await waitFor(() => {
    const configReads = api.mock.calls.filter(([url]) => String(url).includes('/api/push/public-key/'))
    expect(configReads).toHaveLength(2)
  })
  expect(screen.queryByText('Device alerts could not be updated')).not.toBeInTheDocument()
})

it('explains when this browser cannot receive device notifications', async () => {
  vi.stubGlobal('Notification', undefined)
  vi.stubGlobal('PushManager', undefined)
  mockApi({
    '/api/push/public-key/': { configured: false, public_key: '' },
    '/notification-preferences/': {
      preferences: {
        notification_sound: true,
        notification_sound_name: 'chime',
        notification_volume: 70,
      },
    },
  })

  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

  expect(await screen.findByText('Desktop notifications are unavailable')).toBeInTheDocument()
  expect(screen.getByText(/does not support device notifications/i)).toBeInTheDocument()
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
  expect(screen.queryByRole('button', { name: 'Opens on sign in' })).not.toBeInTheDocument()

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

it('shows archived workspace recovery and keeps owner-only actions distinct', () => {
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner', status: 'archived' }}
      defaultWorkspaceId={2}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[
        { id: 1, name: 'Northstar', role: 'owner', status: 'archived' },
        { id: 2, name: 'Research Archive', role: 'member', status: 'archived' },
      ]}
      canManageMembers
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  const ownerCard = screen.getByText('Northstar').closest('.settings-workspace-card')
  const memberCard = screen.getByText('Research Archive').closest('.settings-workspace-card')

  expect(within(ownerCard).getByText('Archived')).toBeInTheDocument()
  expect(within(ownerCard).getByText('Read-only until restored.')).toBeInTheDocument()
  expect(within(ownerCard).getByRole('button', { name: 'Restore' })).toBeInTheDocument()
  expect(within(ownerCard).queryByRole('button', { name: 'Switch' })).not.toBeInTheDocument()
  expect(within(memberCard).getByText('Only the owner can restore or delete this workspace.')).toBeInTheDocument()
  expect(within(memberCard).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
})

it('keeps a pending workspace restore busy, then retries the safe operation', async () => {
  const api = mockApi({})
  const originalFetch = api.getMockImplementation()
  let resolveFirstRestore
  let restoreRequests = 0
  const failureResponse = () => ({
    ok: false,
    status: 503,
    headers: { get: () => 'application/json' },
    json: async () => ({ error: 'Restore service is unavailable.' }),
    text: async () => '{"error":"Restore service is unavailable."}',
  })
  api.mockImplementation((input, init = {}) => {
    if (String(input).includes('/api/workspaces/9/restore/') && init.method === 'POST') {
      restoreRequests += 1
      if (restoreRequests === 1) {
        return new Promise((resolve) => {
          resolveFirstRestore = resolve
        })
      }
      return Promise.resolve(failureResponse())
    }
    return originalFetch(input, init)
  })

  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'member', status: 'active' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[
        { id: 1, name: 'Northstar', role: 'member', status: 'active' },
        { id: 9, name: 'Research Archive', role: 'owner', status: 'archived' },
      ]}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspaces' }))
  const card = screen.getByText('Research Archive').closest('.settings-workspace-card')
  fireEvent.click(within(card).getByRole('button', { name: 'Restore' }))

  await waitFor(() => expect(resolveFirstRestore).toBeTypeOf('function'))
  const pendingRestore = within(card).getByRole('button', { name: 'Restoring' })
  expect(pendingRestore).toBeDisabled()
  expect(card).toHaveAttribute('aria-busy', 'true')

  resolveFirstRestore(failureResponse())
  expect(await screen.findByText('Workspace could not be restored')).toBeInTheDocument()
  expect(screen.getByText('Restore service is unavailable.')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(restoreRequests).toBe(2))
  expect(screen.getByText('Workspace could not be restored')).toBeInTheDocument()
})

it('reconfirms a destructive archive before retrying and does not retry permission denial', async () => {
  const api = mockApi({})
  const originalFetch = api.getMockImplementation()
  let archiveRequests = 0
  api.mockImplementation((input, init = {}) => {
    if (String(input).includes('/api/workspaces/1/archive/') && init.method === 'POST') {
      archiveRequests += 1
      if (archiveRequests === 3) {
        return Promise.resolve({
          ok: false,
          status: 403,
          headers: { get: () => 'application/json' },
          json: async () => ({ error: 'Only the workspace owner can archive it.' }),
          text: async () => '{"error":"Only the workspace owner can archive it."}',
        })
      }
      return Promise.resolve({
        ok: false,
        status: 503,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'Archive service is unavailable.' }),
        text: async () => '{"error":"Archive service is unavailable."}',
      })
    }
    return originalFetch(input, init)
  })
  const onConfirm = vi.fn().mockResolvedValue(true)
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner', status: 'active' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      workspaces={[{ id: 1, name: 'Northstar', role: 'owner', status: 'active' }]}
      canManageMembers
      onConfirm={onConfirm}
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  expect(await screen.findByText('Workspace could not be archived')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
  expect(archiveRequests).toBe(2)

  fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }))
  await waitFor(() => expect(archiveRequests).toBe(3))
  const permissionAlert = (await screen.findByText('Workspace action not permitted')).closest('[data-slot="alert"]')
  expect(within(permissionAlert).getByText('Only the workspace owner can archive it.')).toBeInTheDocument()
  expect(within(permissionAlert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
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

it('opens the moved Resources pages instead of swapping the settings panel', () => {
  // These three left the sidebar for Settings. They are whole pages, so the
  // entry has to navigate; swapping the panel would strand them here.
  const onNavigate = vi.fn()
  render(
    <SettingsView
      currentWorkspace={{ id: 1, name: 'Northstar', role: 'owner' }}
      currentUserName="Test"
      currentUserEmail="test@example.test"
      members={[]}
      notifications={[]}
      workspaceId={1}
      canManageMembers
      onNavigate={onNavigate}
      whatsNewUnread
    />,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Screen sharing' }))
  expect(onNavigate).toHaveBeenCalledWith('Screen sharing')

  fireEvent.click(screen.getByRole('button', { name: "What's new" }))
  expect(onNavigate).toHaveBeenCalledWith("What's new")
  // The unread cue the sidebar used to carry survives the move.
  expect(screen.getByRole('button', { name: "What's new" })).toHaveTextContent('1 new')
})

const workspaceProps = (logoUrl = '') => ({
  currentWorkspace: { id: 1, name: 'Northstar', role: 'owner', logo_url: logoUrl },
  currentUserName: 'Test',
  currentUserEmail: 'test@example.test',
  members: [],
  notifications: [],
  workspaceId: 1,
  canManageMembers: true,
})

it('uploads a workspace logo and cache-busts the unchanged url', async () => {
  const onWorkspaceLogoUpdated = vi.fn()
  mockApi({ '/logo/': { logo_url: '/api/workspaces/1/logo/' } })
  render(<SettingsView {...workspaceProps()} onWorkspaceLogoUpdated={onWorkspaceLogoUpdated} />)

  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  // The aria-label sits on the label that wraps the input, so the change has to
  // be fired on the input itself.
  const trigger = screen.getByLabelText('Change workspace logo')
  fireEvent.change(trigger.querySelector('input[type="file"]') || trigger, {
    target: { files: [new File(['x'], 'logo.png', { type: 'image/png' })] },
  })

  await waitFor(() => expect(onWorkspaceLogoUpdated).toHaveBeenCalled())
  // The logo URL never changes when the image behind it does, so without a
  // cache buster the browser keeps showing the previous logo.
  expect(onWorkspaceLogoUpdated.mock.calls[0][0]).toMatch(/^\/api\/workspaces\/1\/logo\/\?t=\d+$/)
})

it('offers Remove logo only once a workspace has one', () => {
  mockApi({})
  const { unmount } = render(<SettingsView {...workspaceProps()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  expect(screen.queryByRole('button', { name: 'Remove logo' })).not.toBeInTheDocument()
  unmount()

  mockApi({})
  render(<SettingsView {...workspaceProps('/api/workspaces/1/logo/')} />)
  fireEvent.click(screen.getByRole('button', { name: 'Workspace access' }))
  expect(screen.getByRole('button', { name: 'Remove logo' })).toBeInTheDocument()
})
