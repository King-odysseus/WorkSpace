// Regression: the account menu opened as a viewport-fixed sheet on phones
// (`fixed left-4 right-4 top-16`), so although the avatar sits at the right edge
// of the header the menu started at the left edge of the screen and read as if it
// had drifted away from the avatar that opened it. It is now anchored to the
// avatar, which means it must stay absolutely positioned relative to the trigger
// rather than pinned to the viewport.
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { mockApi } from './test/setup-tests.js'

// main.jsx mounts itself at module scope, so each test needs a fresh module
// registry or the second import does nothing against a torn-down DOM.
beforeEach(() => {
  vi.resetModules()
  window.localStorage.removeItem('workspace-sidebar-collapsed')
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

it('anchors the account menu to the avatar instead of the viewport', async () => {
  mockApi({ '/api/auth/me/': session, '/api/tasks/': { tasks: [], pagination: { has_next: false } } })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const trigger = await screen.findByRole(
    'button',
    { name: /Account menu for Nate Foster/ },
    { timeout: 20000 },
  )
  expect(trigger).toHaveAttribute('aria-expanded', 'false')

  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')

  // The menu is the trigger's next sibling, so these classes are what decide
  // whether it lands under the avatar or somewhere else on screen.
  const menu = trigger.nextElementSibling
  expect(menu).not.toBeNull()
  expect(menu.className).toContain('absolute')
  expect(menu.className).toContain('right-0')
  expect(menu.className).toContain('top-full')
  // `fixed` is the bug: it detaches the menu from the avatar.
  expect(menu.className).not.toContain('fixed')
  // The shell root clips overflow, so the menu must never outgrow the viewport.
  expect(menu.className).toContain('max-h-')
}, 60000)

// Regression: the sidebar's own account menu is 224px wide and was anchored to
// the right edge of the row it sits in. Collapsed, that row is a 40px column
// against the left edge of the screen, so 172px of the menu was off the
// viewport - it opened where it could not be read or clicked.
it('opens the sidebar account menu beside the rail when the sidebar is collapsed', async () => {
  window.localStorage.setItem('workspace-sidebar-collapsed', 'true')
  mockApi({ '/api/auth/me/': session, '/api/tasks/': { tasks: [], pagination: { has_next: false } } })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const trigger = await screen.findByRole(
    'button',
    { name: /More account options for Nate Foster/ },
    { timeout: 20000 },
  )
  fireEvent.click(trigger)

  const menu = trigger.nextElementSibling
  expect(menu).not.toBeNull()
  // Alongside the rail, not rising from a row that has no width to spare.
  expect(menu.className).toContain('left-full')
  expect(menu.className).not.toContain('right-0')
  expect(menu.className).toContain('max-w-')
}, 60000)

it('navigates to Settings from the header account menu', async () => {
  mockApi({ '/api/auth/me/': session, '/api/tasks/': { tasks: [], pagination: { has_next: false } } })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  const trigger = await screen.findByRole(
    'button',
    { name: /Open account menu for Nate Foster/ },
    { timeout: 20000 },
  )
  fireEvent.click(trigger)
  const settings = await screen.findByRole('button', { name: 'Settings' })
  // The mobile menu is mounted outside the desktop profile ref. Its mousedown
  // must count as inside the account surface or the click target disappears
  // before the click event can navigate.
  fireEvent.mouseDown(settings)
  fireEvent.click(settings)

  expect(await screen.findByRole('heading', { name: 'Profile', level: 1 }, { timeout: 20000 })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument()
}, 60000)
