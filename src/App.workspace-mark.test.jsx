// The workspace's mark is drawn in more than one place in the shell, and the
// first version of the logo feature updated the sidebar but not the header
// breadcrumb. This boots the real shell and checks every mark at once, so a
// site that is added later and missed shows up here.
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { mockApi } from './test/setup-tests.js'

const sessionWith = (workspace) => ({
  user: {
    id: 7,
    email: 'nate@example.com',
    first_name: 'Nate',
    last_name: 'Foster',
    default_workspace_id: 1,
    workspaces: [{ id: 1, name: 'Tijha Consult', role: 'owner', permissions: [], ...workspace }],
  },
})

beforeEach(() => {
  vi.resetModules()
})

const mountApp = async (workspace) => {
  window.localStorage.removeItem('workspace-last-page')
  window.history.replaceState(null, '', window.location.pathname)
  mockApi({
    '/api/auth/me/': sessionWith(workspace),
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
  await screen.findByRole('navigation', { name: 'Primary' }, { timeout: 20000 })
}

const logoImages = () =>
  [...document.querySelectorAll('img')].filter((image) =>
    (image.getAttribute('src') || '').includes('/logo/'),
  )

it('wears the workspace logo everywhere the mark is drawn', async () => {
  await mountApp({ logo_url: '/api/workspaces/1/logo/' })

  // The header breadcrumb and the sidebar switcher both draw it. Fewer than two
  // means a site is still rendering the initial instead.
  await waitFor(() => expect(logoImages().length).toBeGreaterThanOrEqual(2))
  // The initial is the fallback, so it should not be showing alongside.
  expect(screen.queryAllByText('T', { selector: 'span[aria-hidden="true"]' })).toHaveLength(0)
}, 60000)

it('falls back to the initial when the workspace has no logo', async () => {
  await mountApp({ logo_url: '' })

  await waitFor(() =>
    expect(screen.queryAllByText('T', { selector: 'span[aria-hidden="true"]' }).length).toBeGreaterThan(0),
  )
  expect(logoImages()).toHaveLength(0)
}, 60000)
