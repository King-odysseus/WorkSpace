import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DayPlanNote, { buildPlanPrompt } from './DayPlanNote.jsx'
import { requestDayPlan } from '../lib/day-plan-navigation.js'
import { parsePlan } from '../lib/day-plan-parse.js'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks() })

describe('DayPlanNote', () => {
  it('shows a saved plan as a note and deletes it on request', async () => {
    const fetchMock = mockApi({ '/personal/day-plan/': { note: { date: '2026-11-13', body: '09:00-11:00 Report (2h)\n11:00 Break' } } })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    expect(await screen.findByText('Report')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete day plan' }))
    await waitFor(() => expectRequest(fetchMock, '/personal/day-plan/', 'DELETE'))
    await waitFor(() => expect(screen.queryByText('Report')).toBeNull())
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
    expect(prompt).toMatch(/5 minutes/)
    expect(prompt).toMatch(/Do not schedule a lunch/)
    expect(buildPlanPrompt([], '2026-11-13', 390)).toMatch(/6.5 hours long/)
    expect(prompt).not.toMatch(/hours long/)
    expect(prompt).toMatch(/how long each task/)
  })
})

const PLAN = [
  'Plan for today.',
  '09:00-10:30 Finalise offers (1h 30m) - most important, blocks quoting',
  '10:30-10:35 Break (5m)',
  '10:35-11:35 Follow-up calls (1h)',
  'Move the rest to tomorrow.',
].join(String.fromCharCode(10))

describe('day plan blocks', () => {
  it('reads timed lines into blocks and keeps the other lines as intro and outro', () => {
    const { blocks, intro, outro } = parsePlan(PLAN)
    expect(blocks.map(block => [block.start, block.end, block.title, block.duration, block.kind])).toEqual([
      ['09:00', '10:30', 'Finalise offers', '1h 30m', 'work'],
      ['10:30', '10:35', 'Break', '5m', 'break'],
      ['10:35', '11:35', 'Follow-up calls', '1h', 'work'],
    ])
    expect(blocks[0].detail).toBe('most important, blocks quoting')
    expect(intro).toEqual(['Plan for today.'])
    expect(outro).toEqual(['Move the rest to tomorrow.'])
  })

  it('shows sticky notes, switches to a list, and saves a note on a block', async () => {
    const fetchMock = mockApi({ '/personal/day-plan/': { note: { date: '2026-11-13', body: PLAN, notes: { '09:00': 'Ask Sam' } } } })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    expect(await screen.findByRole('list', { name: 'Day plan as sticky notes' })).toBeTruthy()
    expect(screen.getByLabelText('Note for 09:00 Finalise offers')).toHaveValue('Ask Sam')
    fireEvent.click(screen.getByRole('button', { name: /List/ }))
    expect(await screen.findByRole('list', { name: 'Day plan as a list' })).toBeTruthy()
    const box = screen.getByLabelText('Note for 10:35 Follow-up calls')
    fireEvent.change(box, { target: { value: 'Dial from the shared line' } })
    fireEvent.blur(box)
    await waitFor(() => expectRequest(fetchMock, '/personal/day-plan/', 'PUT'))
    expect(JSON.parse(expectRequest(fetchMock, '/personal/day-plan/', 'PUT')[1].body).notes).toEqual({ '09:00': 'Ask Sam', '10:35': 'Dial from the shared line' })
  })

  it('falls back to the plain text when a plan has no timed lines', async () => {
    mockApi({ '/personal/day-plan/': { note: { date: '2026-11-13', body: 'Just rest today.', notes: {} } } })
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    expect(await screen.findByText('Just rest today.')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Plan view' })).toBeNull()
  })
})
