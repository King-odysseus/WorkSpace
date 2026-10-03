import { waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { mockApi } from './test/setup-tests.js'

afterEach(() => {
  window.localStorage.clear()
})

const appShellRequests = workspaceId => ({
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  [`/api/workspaces/${workspaceId}/notifications/?exclude_chat=1`]: {
    notifications: [],
    unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 0 },
  },
  [`/api/workspaces/${workspaceId}/notifications/?only_conversation=1`]: {
    notifications: [],
    unread_counts: { channel: 0, direct: 0, conversation: 0, activity: 0 },
  },
  '/api/notifications/summary/': { unread_count: 0, latest_unread_id: null },
  '/api/push/public-key/': { configured: false, public_key: '' },
})

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

it('waits for the active workspace before loading Check-ins', async () => {
  vi.resetModules()
  window.history.replaceState(null, '', '/?view=Check-ins')
  const fetchMock = mockApi({
    ...appShellRequests(1),
    '/api/workspaces/1/check-ins/': { check_ins: [] },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  await waitFor(() => expect(document.querySelector('.pencil-checkins-view')).not.toBeNull(), { timeout: 20000 })
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/workspaces/1/check-ins/'))).toBe(true))

  const urls = fetchMock.mock.calls.map(([url]) => String(url))
  expect(urls.some(url => url.includes('/api/workspaces/null/'))).toBe(false)
}, 30000)

it('reopens Zuri where the reader left it', async () => {
  vi.resetModules()
  window.history.replaceState(null, '', '/')
  window.localStorage.setItem('workspace-ai-window-7', 'open')
  const fetchMock = mockApi({
    ...appShellRequests(1),
    '/api/workspaces/1/ai/settings/': {
      settings: { ai_default_provider: 'openai', ai_enabled_providers: ['openai'] },
      providers: { openai: true },
    },
    '/api/workspaces/1/ai/chat/': { answer: 'Ready.' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  await waitFor(() => expect(document.querySelector('.ai-chat-window')).not.toBeNull(), { timeout: 20000 })
  // The assistant also has a page of its own, reachable from the sidebar.
  expect(document.querySelector('aside nav button[aria-label="Zuri"]')).not.toBeNull()
  // Restored before the workspace resolves must not fetch settings against a
  // null workspace on the way in.
  const urls = fetchMock.mock.calls.map(([url]) => String(url))
  expect(urls.some(url => url.includes('/api/workspaces/null/'))).toBe(false)
}, 30000)
