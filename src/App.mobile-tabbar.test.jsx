// The bottom tab bar's "My tasks" tab used to carry the design's shorter label
// ("Tasks") while opening a page named "My tasks" - a label/page split that a
// past bug turned into a bottom tab pointing at a view name nothing handles.
// The tab now uses the same name as the page it opens, and a stale or unknown
// view name (a leftover workspace-last-page, an old deep link) falls back to
// Today instead of that dead end. These tests drive the real shell because both
// behaviors live in App, not in any single page component.
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
})

const mountApp = async () => {
  window.localStorage.removeItem('workspace-last-page')
  window.localStorage.removeItem('workspace-sidebar-upgrade-card-dismissed-7')
  window.history.replaceState(null, '', window.location.pathname)
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
  await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
}

// The tab bar is the one nav labelled "Primary" that carries the bottom-bar
// class; the sidebar draws its own buttons with the same page names.
const tabBar = () => document.querySelector('.mobile-tabbar')

it('opens My tasks from the bottom tab of the same name', async () => {
  await mountApp()

  const tab = within(tabBar()).getByRole('button', { name: 'My tasks' })
  expect(tab).not.toHaveAttribute('aria-current')
  fireEvent.click(tab)

  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeInTheDocument(),
  )
  expect(within(tabBar()).getByRole('button', { name: 'My tasks' })).toHaveAttribute('aria-current', 'page')
}, 60000)

it('still opens the pages whose tab label already matches', async () => {
  await mountApp()

  fireEvent.click(within(tabBar()).getByRole('button', { name: 'Planner' }))
  await waitFor(() =>
    expect(screen.getByRole('heading', { level: 1, name: 'Planner' })).toBeInTheDocument(),
  )
  expect(within(tabBar()).getByRole('button', { name: 'Planner' })).toHaveAttribute('aria-current', 'page')
}, 60000)

it('falls back to Today for a view name no page recognizes', async () => {
  // A stale value can arrive from a leftover workspace-last-page (an app
  // version that once wrote a bad one) or a ?view= link naming the wrong page.
  window.localStorage.setItem('workspace-last-page', 'Tasks')
  await mountApp()

  expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
}, 60000)
