import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DayPlanNote, { buildPlanPrompt } from './DayPlanNote.jsx'
import { requestDayPlan } from '../lib/day-plan-navigation.js'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

describe('DayPlanNote', () => {
  it('shows a saved plan as a note and deletes it on request', async () => {
    const fetchMock = mockApi({ '/personal/day-plan/': { note: { date: '2026-11-13', body: '09:00-11:00 Report (2h)\n11:00 Break' } } })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    expect(await screen.findByText(/Report \(2h\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete day plan' }))
    await waitFor(() => expectRequest(fetchMock, '/personal/day-plan/', 'DELETE'))
    await waitFor(() => expect(screen.queryByText(/Report \(2h\)/)).toBeNull())
  })

  it('asks Zuri for a plan from the Today button and saves what comes back', async () => {
    requestDayPlan()
    const fetchMock = mockApi({
      '/personal/day-plan/': { note: null },
      '/ai/chat/': { answer: '09:00-11:00 Write report (2h)\n11:00-11:15 Break', pending_actions: [] },
    })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={['Call the bank']} />)
    await waitFor(() => expectRequest(fetchMock, '/ai/chat/', 'POST'))
    const [, init] = expectRequest(fetchMock, '/ai/chat/', 'POST')
    expect(JSON.parse(init.body).message).toContain('Call the bank')
    const [, saved] = await waitFor(() => expectRequest(fetchMock, '/personal/day-plan/', 'PUT'))
    expect(JSON.parse(saved.body).body).toContain('Break')
  })

  it('says why when Zuri is not available and keeps nothing', async () => {
    mockApi({
      '/personal/day-plan/': { note: null },
      '/ai/chat/': { status: 403, body: { error: 'Zuri has not been enabled for your account.' } },
    })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Plan my day with Zuri' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Zuri has not been enabled')
  })

  it('asks for breaks and time per task', () => {
    const prompt = buildPlanPrompt([], '2026-11-13')
    expect(prompt).toMatch(/breaks/)
    expect(prompt).toMatch(/how long each task/)
  })
})
