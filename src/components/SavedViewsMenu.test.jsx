import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { expectRequest, mockApi } from '../test/setup-tests.js'
import SavedViewsMenu, { DEFAULT_PLANNER_VIEW, decodeViewFilters, encodeViewFilters } from './SavedViewsMenu.jsx'

const filters = { ...DEFAULT_PLANNER_VIEW, status: 'in_progress', dueFilter: 'overdue' }
const mine = { id: 1, name: 'Overdue work', filter: encodeViewFilters(filters), search: 'launch', project_scope: 'all', shared: false, owner_id: 7 }
const theirs = { id: 2, name: 'Team standup', filter: encodeViewFilters({ ...DEFAULT_PLANNER_VIEW, staleOnly: true }), search: '', project_scope: 'all', shared: true, owner_id: 9 }

const renderMenu = (props = {}) => render(<SavedViewsMenu workspaceId={1} currentUserId={7} filters={filters} search="launch" projectScope="all" onApply={vi.fn()} {...props} />)

it('round-trips filters and ignores a token it cannot read', () => {
  expect(decodeViewFilters(encodeViewFilters(filters))).toEqual(filters)
  expect(decodeViewFilters('overdue')).toEqual(DEFAULT_PLANNER_VIEW)
  expect(decodeViewFilters(JSON.stringify({ status: 5, staleOnly: 'yes', dueFilter: 'overdue' }))).toEqual({ ...DEFAULT_PLANNER_VIEW, dueFilter: 'overdue' })
})

it('lists own and shared views, applies one, and only offers delete on your own', async () => {
  mockApi({ '/api/workspaces/1/saved-views/': { saved_views: [mine, theirs] } })
  const onApply = vi.fn()
  renderMenu({ onApply })
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))

  expect(await screen.findByText('Team standup')).toBeInTheDocument()
  expect(screen.getByText(/Shared by a teammate/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Delete view Overdue work' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Delete view Team standup' })).toBeNull()

  fireEvent.click(screen.getByText('Overdue work'))
  expect(onApply).toHaveBeenCalledWith({ ...filters, search: 'launch', projectScope: 'all' })
})

it('saves the current filters, optionally shared with the team', async () => {
  const fetchMock = mockApi({ '/api/workspaces/1/saved-views/': { saved_views: [] } })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))
  fireEvent.change(await screen.findByLabelText('View name'), { target: { value: 'Late items' } })
  fireEvent.click(screen.getByLabelText('Share with the team'))
  fireEvent.submit(screen.getByLabelText('View name').closest('form'))

  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/saved-views/', 'POST'))
  const [, init] = expectRequest(fetchMock, '/api/workspaces/1/saved-views/', 'POST')
  expect(JSON.parse(init.body)).toEqual({ name: 'Late items', filter: encodeViewFilters(filters), search: 'launch', project_scope: 'all', shared: true })
})

it('deletes one of your own views', async () => {
  const fetchMock = mockApi({ '/api/workspaces/1/saved-views/': { saved_views: [mine] } })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: 'Saved views' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete view Overdue work' }))
  await waitFor(() => expectRequest(fetchMock, '/api/workspaces/1/saved-views/1/', 'DELETE'))
  await waitFor(() => expect(screen.queryByText('Overdue work')).toBeNull())
})
