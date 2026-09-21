// The shell moves between pages by setting state, not by URL, so "back" needs a
// history of its own. These tests drive the real shell because the history and
// the button that uses it live there, not in any single page component.
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

// main.jsx mounts itself at module scope, so each test needs a fresh module
// registry or the second import is a no-op against a torn-down DOM.
beforeEach(() => {
  vi.resetModules()
})

const mountApp = async () => {
  window.localStorage.removeItem('workspace-last-page')
  window.localStorage.removeItem('workspace-sidebar-upgrade-card-dismissed-7')
  // The shell reads ?view= on boot and other shell tests leave one behind via
  // replaceState, which would land this one on a page it did not navigate to.
  window.history.replaceState(null, '', window.location.pathname)
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
  // The shell is up once it has rendered its own navigation.
  await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
}

const sidebarLink = async (name) => {
  const links = await screen.findAllByRole('button', { name })
  return links[0]
}

// The desktop header and the mobile app bar each draw a back control, and the
// test DOM applies no CSS, so both are present. Either one is the button.
const backButtons = (name) => screen.queryAllByRole('button', { name })
const clickBack = (name) => fireEvent.click(backButtons(name)[0])

it('offers no way back until the user has been somewhere', async () => {
  await mountApp()
  // Nothing has been visited yet, so a back control would lead nowhere.
  expect(backButtons(/^Back/)).toHaveLength(0)
}, 60000)

it('goes back to the page the user came from', async () => {
  await mountApp()

  fireEvent.click(await sidebarLink('Planner'))
  await waitFor(() => expect(backButtons('Back to Today').length).toBeGreaterThan(0))

  clickBack('Back to Today')
  await waitFor(() => expect(backButtons(/^Back/)).toHaveLength(0))
}, 60000)

it('does not trap the user bouncing between two pages', async () => {
  await mountApp()

  fireEvent.click(await sidebarLink('Planner'))
  fireEvent.click(await sidebarLink('Calendar'))
  await waitFor(() => expect(backButtons('Back to Planner').length).toBeGreaterThan(0))

  // Going back must not itself count as a step forward, or back would return
  // to Calendar and the two pages would bounce for ever.
  clickBack('Back to Planner')
  await waitFor(() => expect(backButtons('Back to Today').length).toBeGreaterThan(0))
}, 60000)
