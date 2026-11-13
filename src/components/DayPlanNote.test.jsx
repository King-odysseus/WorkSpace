import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DayPlanNote, { buildPlanPrompt } from './DayPlanNote.jsx'
import { requestDayPlan } from '../lib/day-plan-navigation.js'
import { parsePlan } from '../lib/day-plan-parse.js'
import { expectRequest, mockApi } from '../test/setup-tests.js'

afterEach(() => { vi.restoreAllMocks(); try { localStorage.clear() } catch { /* nothing to clear */ } })

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

describe('day plan blocks: moving and ticking off', () => {
  const planWithState = { date: '2026-11-13', body: PLAN, notes: {}, done: [], layout: {} }
  // A server that keeps what it is sent: a PUT changes the note a later read returns.
  const echoServer = fetchMock => {
    let current = planWithState
    fetchMock.mockImplementation(async (url, init = {}) => {
      if (String(url).includes('/personal/day-plan/') && init.method === 'PUT') current = { ...current, ...JSON.parse(init.body) }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ note: current }), text: async () => '{}' }
    })
  }
  const putBodies = fetchMock => fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/personal/day-plan/') && init?.method === 'PUT').map(([, init]) => JSON.parse(init.body))

  it('reads a detail joined with an em dash', () => {
    const dash = String.fromCharCode(0x2014)
    const { blocks } = parsePlan(`09:00-09:30 Finalise offers (30m) ${dash} highest priority, no due date`)
    expect(blocks[0]).toMatchObject({ title: 'Finalise offers', duration: '30m', detail: 'highest priority, no due date' })
  })

  it('ticks a block done and back, and the plan remembers it', async () => {
    const fetchMock = mockApi({ '/personal/day-plan/': { note: planWithState } })
    echoServer(fetchMock)
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Finalise offers done' }))
    await waitFor(() => expect(putBodies(fetchMock)).toContainEqual({ date: expect.any(String), done: ['09:00'] }))
    expect(await screen.findByRole('button', { name: 'Mark Finalise offers not done' })).toBeTruthy()
  })

  it('moves a block by dragging its bar and with the arrow keys, saving where it sits', async () => {
    const fetchMock = mockApi({ '/personal/day-plan/': { note: planWithState } })
    echoServer(fetchMock)
    render(<DayPlanNote workspaceId={4} openPersonalTitles={[]} />)
    const card = await screen.findByLabelText(/Plan block: Finalise offers/)
    const bar = card.querySelector('.sticky-bar')
    fireEvent.pointerDown(bar, { pointerId: 1, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 200, clientY: 130 })
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 200, clientY: 130 })
    await waitFor(() => expect(putBodies(fetchMock).some(body => body.layout?.['09:00'])).toBe(true))
    const first = putBodies(fetchMock).find(body => body.layout?.['09:00']).layout['09:00']
    expect(first[0]).toBeGreaterThan(0)
    fireEvent.keyDown(screen.getByLabelText(/Plan block: Finalise offers/), { key: 'ArrowRight' })
    await waitFor(() => expect(putBodies(fetchMock).filter(body => body.layout).length).toBe(2))
    expect(putBodies(fetchMock).filter(body => body.layout)[1].layout['09:00'][0]).toBe(first[0] + 16)
  })
})

