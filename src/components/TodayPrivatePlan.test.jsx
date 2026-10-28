import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { mockApi } from '../test/setup-tests.js'
import TodayPrivatePlan from './TodayPrivatePlan.jsx'
import FirstSessionChecklist from './FirstSessionChecklist.jsx'

beforeEach(() => window.localStorage.clear())

it('loads only the signed-in private endpoint after opt in and remembers the choice', async () => {
  const fetchMock = mockApi({ '/api/workspaces/3/personal/planners/': { tasks: [{ id: 9, title: 'Write notes', is_done: false, due_date: null }] } })
  const open = vi.fn()
  render(<TodayPrivatePlan workspaceId={3} userId={7} today="2026-10-28" onOpenPlanner={open} />)
  expect(fetchMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Show private plan' }))
  expect(await screen.findByText('Write notes')).toBeInTheDocument()
  expect(window.localStorage.getItem('workspace-private-today:7:3')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Open my planner' }))
  expect(open).toHaveBeenCalledTimes(1)
})

it('keeps first-use dismissal within the user and workspace', () => {
  const props = { workspaceId: 3, userId: 7, isManager: false, onNavigate: vi.fn(), onCreateTask: vi.fn(), onInvite: vi.fn() }
  const view = render(<FirstSessionChecklist {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('region', { name: 'Getting started' })).not.toBeInTheDocument()
  view.unmount()
  render(<FirstSessionChecklist {...props} userId={8} />)
  expect(screen.getByRole('region', { name: 'Getting started' })).toBeInTheDocument()
})
