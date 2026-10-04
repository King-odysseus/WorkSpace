// UX-12 moved the route-only views out of the entry bundle, so each is fetched
// when its destination is opened. The failure mode of that change is quiet: a
// wrong import path, or a view with no Suspense above it, leaves a destination
// that renders nothing at all and throws nowhere the suite would notice. These
// tests walk to each destination and assert the view is really there.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx) and every route shares it.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it } from 'vitest'
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

const project = {
  id: 42,
  name: 'Safron Website',
  description: 'Refresh the marketing site.',
  status: 'active',
  health: 'on-track',
  due_date: '2026-10-20',
  updated_at: '2026-09-21T09:00:00Z',
  owner_name: 'Nate Foster',
  member_count: 1,
  metrics: { total_tasks: 0, applicable_tasks: 0, completed_tasks: 0, blocked_tasks: 0, overdue_tasks: 0, completion_rate: 0 },
}

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  '/api/workspaces/1/projects/': { projects: [project] },
  '/api/workspaces/1/members/': { members: [{ id: 7, first_name: 'Nate', last_name: 'Foster', email: 'nate@example.com', role: 'owner' }] },
  '/api/workspaces/1/plan-buckets/': { buckets: [] },
  '/api/workspaces/1/risks-issues/': { records: [] },
  '/api/workspaces/1/activity/': { activity: [] },
}

let fetchMock

beforeAll(async () => {
  fetchMock = mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  // The shared setup unstubs globals after every test, so the app mounted once
  // in beforeAll needs its routing table put back.
  fetchMock = mockApi(routes)
  window.localStorage.clear()
})

// Each destination names the elements that only exist once its own chunk has
// loaded and rendered. Several are listed per route because a view can have more
// than one presentation.
const DESTINATIONS = [
  { label: 'Planner', markers: ['.planner-view'] },
  {
    label: 'Settings',
    markers: ['.settings-view'],
    // Settings has no sidebar entry; it is reached from the account menu.
    open: async () => {
      const menus = await screen.findAllByRole('button', { name: /^Account menu for/ }, { timeout: 30000 })
      fireEvent.click(menus[0])
      fireEvent.click(await screen.findByRole('button', { name: 'Settings' }, { timeout: 30000 }))
    },
  },
  { label: 'Import data', markers: ['.import-stepper', '.import-layout'] },
  { label: 'My planner', markers: ['.personal-planner-view', '.personal-planner-new-form', '.personal-task-row'] },
]

const firstPresent = (selectors) =>
  selectors.map((selector) => document.querySelector(selector)).find(Boolean) ?? null

it('renders every destination whose view moved out of the entry bundle', async () => {
  for (const { label, markers, open } of DESTINATIONS) {
    if (open) {
      await open()
    } else {
      const buttons = await screen.findAllByRole('button', { name: label }, { timeout: 30000 })
      fireEvent.click(buttons[0])
    }

    await waitFor(
      () => expect(firstPresent(markers), `${label} rendered nothing of its own`).not.toBeNull(),
      { timeout: 30000 },
    )
  }
}, 150000)
