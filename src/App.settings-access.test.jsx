// The Workspace access panel, which is where an owner runs the workspace.
//
// Two of these are regressions from a report on the live app. The Invite member
// button did nothing, because the panel's handler reached a composer that is
// only rendered inside other views - a wiring fault no component test could see,
// since the component was doing exactly what it was told. The other is that
// every permission tick wrote immediately, so a mis-click was a change nobody
// had confirmed and nobody could undo.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { expectRequest, mockApi } from './test/setup-tests.js'

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

const manager = {
  id: 12,
  first_name: 'Gregory',
  last_name: 'Ikhine',
  email: 'gregory@example.test',
  role: 'manager',
  permissions: ['create_tasks', 'use_ai'],
}

const invitation = (index, status = 'accepted') => ({
  id: 100 + index,
  email: `invite${index}@example.test`,
  role: 'member',
  status,
  created_at: `2026-09-0${(index % 9) + 1}T09:00:00Z`,
  expires_at: null,
})

const INVITATIONS = [
  // One live invitation to revoke, one already revoked so the history toggle
  // has something behind it, and six accepted to fill the pages.
  invitation(0, 'pending'),
  invitation(1, 'cancelled'),
  ...Array.from({ length: 6 }, (_, index) => invitation(index + 2)),
]

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  '/api/workspaces/1/members/': { members: [{ ...manager, id: 7, role: 'owner' }, manager] },
  '/api/workspaces/1/invitations/': { invitations: INVITATIONS },
  // One route answers both the create and the permission edit.
  '/api/workspaces/1/members/12/': { member: { ...manager, permissions: ['create_tasks', 'use_ai', 'view_reports'] } },
  // Revoking, which the app sends as a DELETE on the invitation itself.
  '/api/workspaces/1/invitations/100/': {
    invitation: { ...invitation(0, 'pending'), status: 'cancelled' },
  },
}

let fetchMock

beforeAll(async () => {
  fetchMock = mockApi(routes)
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')
}, 60000)

beforeEach(() => {
  fetchMock = mockApi(routes)
  window.localStorage.clear()
})

const openWorkspaceAccess = async () => {
  const menus = await screen.findAllByRole('button', { name: /^Account menu for/ }, { timeout: 30000 })
  fireEvent.click(menus[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))

  // Settings opens on the profile, so the panel this file is about is one
  // click further in.
  await waitFor(() => expect(document.querySelector('.settings-view')).not.toBeNull(), {
    timeout: 30000,
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Workspace access' }))
  // The page header carries the section name too, so wait on a control that
  // only the panel itself renders.
  await screen.findByRole('button', { name: /Invite member/ }, { timeout: 30000 })
}

it('opens the invite composer the shell owns, from Settings', async () => {
  await openWorkspaceAccess()

  fireEvent.click(screen.getByRole('button', { name: /Invite member/ }))

  // The composer the shell renders above everything. Clicking this used to open
  // the record composer, which Settings never renders, so nothing appeared.
  expect(
    await screen.findByRole('dialog', { name: 'Invite team member' }, { timeout: 10000 }),
  ).toBeInTheDocument()
}, 90000)

it('holds permission changes until they are saved', async () => {
  await openWorkspaceAccess()

  // Collapsed, with the granted count in the heading: thirteen checkboxes per
  // manager is a wall nobody reads.
  const heading = screen.getByRole('button', { name: /Show Gregory Ikhine/ })
  expect(heading).toHaveTextContent('2 of 13 granted')

  fireEvent.click(heading)
  const card = heading.closest('section')
  const save = within(card).getByRole('button', { name: 'Save permissions' })
  expect(save).toBeDisabled()

  fireEvent.click(within(card).getByRole('checkbox', { name: 'View reports' }))

  // Ticking alone must not write: nothing has been sent, and the panel says so.
  expect(save).toBeEnabled()
  expect(within(card).getByText('Unsaved changes.')).toBeInTheDocument()
  expect(fetchMock.mock.calls.filter(([, init = {}]) => init.method === 'PATCH')).toHaveLength(0)

  fireEvent.click(save)

  const call = await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/members/12/', 'PATCH'))
  expect(JSON.parse(call[1].body).permissions.sort()).toEqual(
    ['create_tasks', 'use_ai', 'view_reports'],
  )
  await waitFor(() =>
    expect(within(card).getByText('Permissions saved.')).toBeInTheDocument(),
  )
}, 90000)

it('shows five invitations and pages the rest', async () => {
  await openWorkspaceAccess()

  const list = document.querySelector('.settings-invitation-list')
  const rows = () => list.querySelectorAll('.settings-invitation-row').length

  // Eight invitations were sent and one was revoked, so the list counts seven:
  // a revoked invitation is history, not something to page through.
  expect(rows()).toBe(5)
  expect(screen.getByText('Show revoked (1)')).toBeInTheDocument()
  // The heading counts what is listed and the list says which slice it is, so
  // the two numbers cannot read as a disagreement.
  expect(screen.getByText('1-5 of 7')).toBeInTheDocument()

  const pages = screen.getByRole('navigation', { name: 'Invitation pages' })
  expect(within(pages).getByText('Page 1 of 2')).toBeInTheDocument()

  fireEvent.click(within(pages).getByRole('button', { name: 'Next invitation page' }))

  await waitFor(() => expect(rows()).toBe(2))
  expect(screen.getByText('6-7 of 7')).toBeInTheDocument()
}, 90000)

// Last, because the app mounts once for the whole file (see the note at the top)
// and this test revokes an invitation the others count.
it('takes a revoked invitation out of the list and keeps it behind the toggle', async () => {
  await openWorkspaceAccess()

  const list = document.querySelector('.settings-invitation-list')
  const rows = () => [...list.querySelectorAll('.settings-invitation-row')]
  const hasRow = (email) => rows().some((row) => row.textContent.includes(email))

  // The paging test above leaves the reader on page 2 of a list the whole file
  // shares, so step back to the first page before asserting on it.
  const back = screen.queryByRole('button', { name: 'Previous invitation page' })
  if (back && !back.disabled) fireEvent.click(back)

  expect(hasRow('invite0@example.test')).toBe(true)
  expect(hasRow('invite1@example.test')).toBe(false)

  fireEvent.click(
    screen.getByRole('button', { name: 'Revoke invitation for invite0@example.test' }),
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke invitation' }))

  await waitFor(() => expect(hasRow('invite0@example.test')).toBe(false))
  expectRequest(fetchMock, '/api/workspaces/1/invitations/100/', 'DELETE')
  // The count drops with the row, which is the part that used to stay put and
  // make the revoke look like it had not happened.
  expect(screen.getByText('1-5 of 6')).toBeInTheDocument()

  // And the record is not lost, only moved out of the way: the toggle counts
  // both revoked invitations and puts them back in the list, which grows to
  // eight again. They sort last, so the newest is on the final page.
  fireEvent.click(screen.getByRole('button', { name: 'Show revoked (2)' }))
  await waitFor(() => expect(screen.getByText('1-5 of 8')).toBeInTheDocument())
  fireEvent.click(
    screen.getByRole('button', { name: 'Next invitation page' }),
  )
  await waitFor(() => expect(hasRow('invite0@example.test')).toBe(true))
  expect(hasRow('invite1@example.test')).toBe(true)
}, 90000)
