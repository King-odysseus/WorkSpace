// The Check-ins page lists a card per check-in. It shows ten at a time under
// whichever range is chosen, with the counts on the range chips still reading the
// whole range rather than the page.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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

// Newest first, as the API sends them. Dates are spread over many days so the
// "All" range holds all 23 and no other range does.
const checkIns = Array.from({ length: 23 }, (_, index) => {
  const day = new Date(2026, 0, 1 + index)
  return {
    id: 100 + index,
    user_id: 7,
    user_name: `Person ${String(index + 1).padStart(2, '0')}`,
    date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    completed: `Completed item ${index + 1}`,
    next_steps: '',
    blockers: '',
    comments: [],
  }
})

it('shows ten check-in cards per page and returns to page one when the range changes', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/check-ins/': { check_ins: checkIns },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  fireEvent.click(await screen.findByRole('button', { name: 'Check-ins' }, { timeout: 30000 }))
  fireEvent.click(await screen.findByRole('button', { name: /^All: 23 check-ins/ }, { timeout: 30000 }))

  const cards = () => screen.getAllByRole('button', { name: /^View Person \d+'s check-in/ })
  await waitFor(() => expect(cards()).toHaveLength(10))
  expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
  expect(screen.getByText('1-10 of 23')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous check-in page' })).toBeDisabled()
  // The chip keeps counting the whole range, not the page.
  expect(screen.getByRole('button', { name: /^All: 23 check-ins/ })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Next check-in page' }))
  await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument())
  expect(cards()).toHaveLength(10)
  expect(screen.getByText('11-20 of 23')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Next check-in page' }))
  await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeInTheDocument())
  expect(cards()).toHaveLength(3)
  expect(screen.getByRole('button', { name: 'Next check-in page' })).toBeDisabled()

  // A different range starts again at the first page, and with nothing to page
  // through the controls are not drawn at all.
  const group = screen.getByRole('group', { name: 'Filter check-ins by date range' })
  fireEvent.click(within(group).getByRole('button', { name: /^Today:/ }))
  await waitFor(() => expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument())
  fireEvent.click(within(group).getByRole('button', { name: /^All: 23 check-ins/ }))
  await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument())
}, 90000)
