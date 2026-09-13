// Regression: the account menu opened as a viewport-fixed sheet on phones
// (`fixed left-4 right-4 top-16`), so although the avatar sits at the right edge
// of the header the menu started at the left edge of the screen and read as if it
// had drifted away from the avatar that opened it. It is now anchored to the
// avatar, which means it must stay absolutely positioned relative to the trigger
// rather than pinned to the viewport.
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
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
