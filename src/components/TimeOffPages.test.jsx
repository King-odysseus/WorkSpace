import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import LeaveView, { describeSpan } from './LeaveView.jsx'
import RequestsPanel from './RequestsPanel.jsx'
import WhereWeWorkView, { summariseDay } from './WhereWeWorkView.jsx'
import userEvent from '@testing-library/user-event'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

const leave = { id: 1, user_id: 7, user_name: 'Mia', start_date: '2026-12-07', end_date: '2026-12-09', start_half: false, end_half: true, status: 'approved' }

describe('LeaveView', () => {
  it('describes half days in the span', () => {
    expect(describeSpan(leave)).toMatch(/ends at midday/)
    expect(describeSpan({ ...leave, end_date: leave.start_date, end_half: false })).not.toMatch(/to/)
  })

  it('shows who is away without any reason, and lets a person ask for leave', async () => {
    const fetchMock = mockApi({ '/time-off/': { mine: [], team: [leave], to_decide: [], can_approve: false } })
    render(<LeaveView workspaceId={4} role="member" />)
    const away = await screen.findByLabelText('Who is away')
    expect(within(away).getByText('Mia')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expectRequest(fetchMock, '/time-off/', 'POST'))
    const [, init] = expectRequest(fetchMock, '/time-off/', 'POST')
    expect(JSON.parse(init.body)).toMatchObject({ start_date: '2026-12-14', end_date: '2026-12-14', kind: 'annual' })
  })

  it('lets an approver see overlaps and approve', async () => {
    const pending = { ...leave, id: 2, status: 'pending', kind: 'annual', note: 'Trip', overlapping: [{ user_name: 'Sam', start_date: '2026-12-08', end_date: '2026-12-08', status: 'approved' }] }
    const fetchMock = mockApi({ '/time-off/': { mine: [], team: [], to_decide: [pending], can_approve: true }, '/time-off/2/': { leave: { ...pending, status: 'approved' } } })
    render(<LeaveView workspaceId={4} role="manager" />)
    expect(await screen.findByText(/Also away or waiting on these dates: Sam/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }))
    await waitFor(() => expectRequest(fetchMock, '/time-off/2/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/time-off/2/', 'PATCH')[1].body).decision).toBe('approved')
  })

  it('shows the server message when a request is refused', async () => {
    mockApi({ '/time-off/': { status: 400, body: { error: 'You already have leave requested for some of those dates.' } } })
    render(<LeaveView workspaceId={4} role="member" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('already have leave')
  })
})

describe('RequestsPanel', () => {
  const item = { id: 5, requester_id: 9, requester_name: 'Mia', title: 'New monitor', details: 'Flickers', status: 'pending', needed_by: null, created_at: '2026-11-01T10:00:00Z', reviewer_name: '', review_note: '' }

  it('lets a manager answer a teammate request', async () => {
    const fetchMock = mockApi({ '/requests/': { requests: [item], can_manage: true }, '/requests/5/': { request: { ...item, status: 'declined' } } })
    render(<RequestsPanel workspaceId={4} currentUserId={1} />)
    expect(await screen.findByText('New monitor')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reply to Mia'), { target: { value: 'Next quarter' } })
    fireEvent.click(screen.getByRole('button', { name: /Decline/ }))
    await waitFor(() => expectRequest(fetchMock, '/requests/5/', 'PATCH'))
    expect(JSON.parse(expectRequest(fetchMock, '/requests/5/', 'PATCH')[1].body)).toEqual({ decision: 'declined', note: 'Next quarter' })
  })

  it('shows a member only their own list and no answer controls', async () => {
    mockApi({ '/requests/': { requests: [{ ...item, requester_id: 1 }], can_manage: false } })
    render(<RequestsPanel workspaceId={4} currentUserId={1} />)
    expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
    expect(screen.queryByLabelText('Requests from the team')).toBeNull()
  })

  it('sends a new request', async () => {
    const fetchMock = mockApi({ '/requests/': { requests: [], can_manage: false } })
    render(<RequestsPanel workspaceId={4} currentUserId={1} />)
    fireEvent.change(await screen.findByLabelText('What do you need?'), { target: { value: 'A desk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    await waitFor(() => expect(JSON.parse(expectRequest(fetchMock, '/requests/', 'POST')[1].body).title).toBe('A desk'))
  })
})

describe('WhereWeWorkView', () => {
  const day = (location, source = 'set', leaveShare = 0) => ({ location, source, leave: leaveShare })
  const keys = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13']
  const build = fn => Object.fromEntries(keys.map((key, index) => [key, fn(index)]))
  const people = {
    start: '2026-12-07', end: '2026-12-13', office_days: [1], can_set_policy: true, my_pattern: { 0: 'office' },
    members: [
      { id: 1, name: 'Me', working_days: [0, 1, 2, 3, 4], days: build(index => (index > 4 ? day(null, 'off') : index === 0 ? day('home', 'set') : day('office', 'pattern'))) },
      { id: 2, name: 'Mia', working_days: [0, 1, 2, 3, 4], days: build(index => (index > 4 ? day(null, 'off') : index === 1 ? day(null, 'leave', 1) : day('home', 'set'))) },
    ],
  }

  it('summarises a day by place', () => {
    expect(summariseDay(people.members, '2026-12-08')).toEqual({ office: 1, home: 0, other: 0, leave: 1 })
  })

  it('shows everyone, marks leave and assumed days, and lets me change my own day', async () => {
    vi.setSystemTime?.(new Date('2026-12-08T09:00:00'))
    const fetchMock = mockApi({ '/locations/': people })
    render(<WhereWeWorkView workspaceId={4} currentUserId={1} />)
    expect(await screen.findByText('Mia')).toBeTruthy()
    expect(screen.getAllByText(/On leave/).length).toBeGreaterThan(0)
    const select = (await screen.findAllByRole('combobox', { name: /Where you work on/ }))[0]
    const user = userEvent.setup()
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: 'Other' }))
    await waitFor(() => expectRequest(fetchMock, '/locations/', 'PUT'))
    expect(JSON.parse(expectRequest(fetchMock, '/locations/', 'PUT')[1].body).location).toBe('other')
  })

  it('saves my usual week and the optional office days', async () => {
    const fetchMock = mockApi({ '/locations/': people, '/location-pattern/': { my_pattern: {} }, '/office-days/': { office_days: [1] } })
    render(<WhereWeWorkView workspaceId={4} currentUserId={1} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save my usual week' }))
    await waitFor(() => expectRequest(fetchMock, '/location-pattern/', 'PUT'))
    fireEvent.click(screen.getByRole('button', { name: 'Save office days' }))
    await waitFor(() => expectRequest(fetchMock, '/office-days/', 'PATCH'))
  })
})
