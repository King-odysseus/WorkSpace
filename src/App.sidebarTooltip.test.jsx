import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
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

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

it('uses styled tooltips instead of native titles in the collapsed sidebar', async () => {
  window.localStorage.setItem('workspace-sidebar-collapsed', 'true')
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const sidebar = await waitFor(() => {
    const element = document.querySelector('aside.mobile-nav-drawer')
    expect(element).not.toBeNull()
    return element
  }, { timeout: 20000 })
  const today = within(sidebar).getByRole('button', { name: 'Today' })
  expect(today).not.toHaveAttribute('title')

  const describedBy = today.getAttribute('aria-describedby')
  expect(describedBy).toBeTruthy()

  const bubble = document.getElementById(describedBy)
  expect(bubble).toHaveAttribute('data-slot', 'tooltip')
  expect(bubble).toHaveAttribute('data-side', 'right')
  expect(bubble.parentElement).toBe(document.body)
  expect(bubble).toHaveTextContent('Today')

  fireEvent.mouseEnter(today)
  expect(bubble).toHaveAttribute('data-state', 'visible')

  expect(within(sidebar).getByRole('button', { name: 'Expand sidebar' })).not.toHaveAttribute('title')
  expect(screen.getByRole('button', { name: 'Workspace: Northstar' })).not.toHaveAttribute('title')
}, 60000)
