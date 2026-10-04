// The create-record forms used to live only in React state: a stray backdrop
// click, a reopen, or a reload threw the typing away. A long check-in is real
// work, so these tests pin the promise the plan makes - a changed form survives
// a dismissal and a reload, offers resume or discard, and a successful save
// clears only its own draft.
//
// The app mounts itself into #root at module scope, so this file mounts once
// (see App.test.jsx) and gives each scenario its own stubbed responses.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, expect, it } from 'vitest'
import { mockApi } from './test/setup-tests.js'
import { readRecordDraft, recordDraftKey, writeRecordDraft } from './lib/record-drafts.js'

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

const savedCheckIn = {
  id: 5,
  user_id: 7,
  user_name: 'Nate Foster',
  date: '2026-10-04',
  completed: 'Shipped phase one',
  next_steps: '',
  blockers: '',
}

// One route answers both reads of this endpoint: the page loads `check_ins`,
// the submit reads `check_in`.
const checkInsRoute = { check_ins: [savedCheckIn], check_in: savedCheckIn }

const routes = {
  '/api/auth/me/': session,
  '/api/tasks/': { tasks: [], pagination: { has_next: false } },
  '/api/workspaces/1/check-ins/': checkInsRoute,
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

const completedField = () => screen.getByLabelText('What did you complete?')

it('keeps a changed form on disk, offers it back, and discards it on request', async () => {
  const dialog = await openCheckInComposer()

  fireEvent.change(completedField(), { target: { value: 'Walked the whole Phase 1 flow' } })

  // On disk the moment it is typed, because a reload offers no later chance.
  await waitFor(() =>
    expect(readRecordDraft(7, 1, 'checkin')?.fields.completed).toBe('Walked the whole Phase 1 flow'),
  )

  fireEvent.click(screen.getByRole('button', { name: 'Close workspace update dialog' }))

  // Reopening hands the typing back rather than an empty form, and says why.
  await openCheckInComposer()
  expect(completedField().value).toBe('Walked the whole Phase 1 flow')
  expect(screen.getByText('Restored your unsaved draft')).toBeInTheDocument()

  // Discarding starts the form over: the text goes, the form stays.
  fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
  expect(completedField().value).toBe('')
  expect(screen.queryByText('Restored your unsaved draft')).toBeNull()
  expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Daily check-in' })).toBeInTheDocument()
}, 90000)

it('clears the draft it saved and leaves every other draft alone', async () => {
  await openCheckInComposer()
  fireEvent.change(completedField(), { target: { value: 'Shipped phase one' } })
  await waitFor(() => expect(readRecordDraft(7, 1, 'checkin')).not.toBeNull())

  // Losing an unrelated half-written project along with a saved check-in would
  // be the same bug in the other direction.
  writeRecordDraft(7, 1, 'project', { name: 'Website refresh' })

  fireEvent.submit(screen.getByRole('dialog', { name: 'Daily check-in' }))

  await waitFor(() => expect(readRecordDraft(7, 1, 'checkin')).toBeNull())
  expect(readRecordDraft(7, 1, 'project').fields.name).toBe('Website refresh')
  expect(window.localStorage.getItem(recordDraftKey(7, 1, 'checkin'))).toBeNull()
}, 90000)

it('gives a half-written task back rather than an empty form', async () => {
  // Today is a sidebar destination and a mobile tab, so it answers twice.
  const todayButtons = await screen.findAllByRole('button', { name: 'Today' }, { timeout: 30000 })
  fireEvent.click(todayButtons[0])
  fireEvent.click(await screen.findByRole('button', { name: 'Plan a task' }, { timeout: 30000 }))

  const nameField = () => screen.getByLabelText('Task name')
  fireEvent.change(nameField(), { target: { value: 'Renew the domain' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'It lapsed.' } })

  await waitFor(() =>
    expect(readRecordDraft(7, 1, 'task')?.fields.newTask).toBe('Renew the domain'),
  )
  // The rest of the form rides along, not only the required field.
  expect(readRecordDraft(7, 1, 'task').fields.newDescription).toBe('It lapsed.')

  fireEvent.click(screen.getByRole('button', { name: 'Close add task dialog' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Plan a task' }))

  expect(await screen.findByRole('dialog', { name: 'Add a task' })).toBeInTheDocument()
  expect(nameField().value).toBe('Renew the domain')
  expect(screen.getByText('Restored your unsaved task')).toBeInTheDocument()
}, 90000)

it('does not offer one reader the draft another reader left behind', async () => {
  // The same browser, one workspace, two accounts.
  const otherUserDraft = JSON.stringify({
    savedAt: Date.now(),
    fields: { completed: 'Someone else was here' },
  })
  window.localStorage.setItem(recordDraftKey(9, 1, 'checkin'), otherUserDraft)

  await openCheckInComposer()

  expect(completedField().value).toBe('')
  expect(screen.queryByText('Restored your unsaved draft')).toBeNull()
  // Untouched, because it is not this reader's to read or to clear.
  expect(window.localStorage.getItem(recordDraftKey(9, 1, 'checkin'))).toBe(otherUserDraft)
}, 90000)
