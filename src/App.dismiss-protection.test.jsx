// Dismissal used to have three different answers. Escape reached a window
// listener that cleared every panel on the page at once, the backdrop and the
// close button each closed the form on their own, and any of them could land
// while a save was still in flight - leaving the reader with no way to tell
// whether the record had been created. These tests pin one behaviour for all
// three, and the two things that must never happen: an interrupted save and a
// second create from one form.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx) and every scenario shares it.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
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

const checkIn = {
  id: 5,
  user_id: 7,
  user_name: 'Nate Foster',
  date: '2026-10-04',
  completed: 'Shipped phase one',
  next_steps: '',
  blockers: '',
}

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  '/api/workspaces/1/check-ins/': { check_ins: [checkIn], check_in: checkIn },
  '/api/workspaces/1/check-ins/5/comments/': { comments: [] },
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

const openCheckInComposer = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Check-ins' }, { timeout: 30000 }))
  fireEvent.click(await screen.findByRole('button', { name: 'My check-in' }, { timeout: 30000 }))
  return screen.findByRole('dialog', { name: 'Daily check-in' }, { timeout: 30000 })
}

const composer = () => screen.queryByRole('dialog', { name: 'Daily check-in' })
const checkInDetail = () => document.querySelector('.checkin-detail-dialog')
const completedField = () => screen.getByLabelText('What did you complete?')
const escape = () => fireEvent.keyDown(document.body, { key: 'Escape' })

const postCount = (fragment) =>
  fetchMock.mock.calls.filter(
    ([url, init = {}]) => String(url).includes(fragment) && init.method === 'POST',
  ).length

const okResponse = (body) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
})

// Holds the check-in create open, so the test can decide when the server
// answers - which is the only way to observe what a dismissal does mid-save.
const holdCheckInSubmit = () => {
  const held = []
  const base = fetchMock
  vi.stubGlobal(
    'fetch',
    vi.fn((input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.includes('/check-ins/') && init.method === 'POST') {
        return new Promise((resolve) => held.push(resolve))
      }
      return base(input, init)
    }),
  )
  return held
}

it('closes the composer on Escape without emptying the page behind it', async () => {
  // A panel behind the composer. The shell closes every loose panel from one
  // window-level keydown handler, and left to reach it a single Escape closes
  // the composer and whatever the reader had open behind it, which drops them
  // two steps back from where they were. The bell's panel is the layer here
  // because it exists only while it is open, so "still there" means something.
  const panels = () => document.querySelectorAll('.workspace-popup-panel').length
  expect(panels()).toBe(0)

  fireEvent.click(await screen.findByRole('button', { name: 'Open workspace activity notifications' }, { timeout: 30000 }))
  await waitFor(() => expect(panels()).toBe(1))

  await openCheckInComposer()
  escape()

  await waitFor(() => expect(composer()).toBeNull())
  expect(panels()).toBe(1)

  // And the layers come off one at a time: the next press takes the panel.
  escape()
  await waitFor(() => expect(panels()).toBe(0))
}, 90000)

it('keeps a changed form through Escape, the same as any other dismissal', async () => {
  await openCheckInComposer()
  fireEvent.change(completedField(), { target: { value: 'Escape must not lose this' } })

  escape()
  await waitFor(() => expect(composer()).toBeNull())

  await openCheckInComposer()
  expect(completedField().value).toBe('Escape must not lose this')
  fireEvent.click(screen.getByRole('button', { name: 'Close workspace update dialog' }))
  await waitFor(() => expect(composer()).toBeNull())
}, 90000)

it('refuses to close while the save is still in flight, then closes normally', async () => {
  const held = holdCheckInSubmit()
  await openCheckInComposer()
  fireEvent.change(completedField(), { target: { value: 'Shipped phase one' } })
  fireEvent.submit(screen.getByRole('dialog', { name: 'Daily check-in' }))

  // The create only goes out after the CSRF read, so wait until it is really in
  // flight before testing what a dismissal does to it.
  await waitFor(() => expect(held.length).toBe(1))

  // Neither Escape nor the close button may abandon a request that may well have
  // been accepted: the reader would never learn which it was.
  escape()
  fireEvent.click(screen.getByRole('button', { name: 'Close workspace update dialog' }))
  expect(composer()).not.toBeNull()

  held.forEach((resolve) => resolve(okResponse({ check_in: checkIn })))

  await waitFor(() => expect(composer()).toBeNull())
}, 90000)

it('creates one check-in when the form is submitted twice', async () => {
  await openCheckInComposer()
  fireEvent.change(completedField(), { target: { value: 'Shipped phase one' } })

  const form = screen.getByRole('dialog', { name: 'Daily check-in' })
  fireEvent.submit(form)
  fireEvent.submit(form)

  await waitFor(() => expect(composer()).toBeNull())
  expect(postCount('/check-ins/')).toBe(1)
}, 90000)
