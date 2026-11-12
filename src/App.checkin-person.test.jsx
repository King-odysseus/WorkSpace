// The Check-ins page can be narrowed to one teammate. The range chips keep
// counting the whole range, and the list shows only that person's check-ins.
import { fireEvent, screen, waitFor } from '@testing-library/react'
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

const entry = (id, userId, name, day) => ({
  id, user_id: userId, user_name: name, date: `2026-01-${String(day).padStart(2, '0')}`,
  completed: `Done by ${name} ${id}`, next_steps: '', blockers: '', comments: [],
})
const checkIns = [entry(1, 7, 'Nate Foster', 5), entry(2, 9, 'Ada West', 4), entry(3, 9, 'Ada West', 3)]

it('narrows the Check-ins list to one person and back to everyone', async () => {
  mockApi({
    '/api/auth/me/': session,
    '/api/tasks/': { tasks: [], pagination: { has_next: false } },
    '/api/workspaces/1/check-ins/': { check_ins: checkIns },
    '/api/push/public-key/': { configured: false, public_key: '' },
  })
  document.body.innerHTML = '<div id="root"></div>'
  await import('./main.jsx')

  fireEvent.click((await screen.findAllByRole('button', { name: 'Check-ins' }, { timeout: 30000 })).find(button => button.closest('aside')))
  fireEvent.click(await screen.findByRole('button', { name: /^All: 3 check-ins/ }, { timeout: 30000 }))

  const cards = () => screen.queryAllByRole('button', { name: /^View .+'s check-in/ })
  await waitFor(() => expect(cards()).toHaveLength(3))

  const person = screen.getByRole('combobox', { name: 'Filter check-ins by person' })
  fireEvent.change(person, { target: { value: '9' } })
  await waitFor(() => expect(cards()).toHaveLength(2))
  expect(cards().every(card => card.getAttribute('aria-label').includes('Ada West'))).toBe(true)
  // The chip still counts the whole range.
  expect(screen.getByRole('button', { name: /^All: 3 check-ins/ })).toBeInTheDocument()

  fireEvent.change(person, { target: { value: 'all' } })
  await waitFor(() => expect(cards()).toHaveLength(3))
}, 90000)
