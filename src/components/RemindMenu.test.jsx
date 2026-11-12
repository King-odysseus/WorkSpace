import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { expectRequest, mockApi } from '../test/setup-tests.js'
import RemindMenu, { reminderPresets } from './RemindMenu.jsx'

it('builds presets that are always in the future', () => {
  const now = new Date(2026, 10, 12, 16, 30) // Thursday 12 Nov 2026, 16:30
  const [hour, tomorrow, nextWeek] = reminderPresets(now).map(([, when]) => when)
  expect(hour.getTime()).toBe(now.getTime() + 3600000)
  expect(tomorrow).toEqual(new Date(2026, 10, 13, 9, 0))
  expect(nextWeek).toEqual(new Date(2026, 10, 16, 9, 0)) // the following Monday
  for (const when of [hour, tomorrow, nextWeek]) expect(when.getTime()).toBeGreaterThan(now.getTime())
})

it('keeps a Monday preset a full week out when it is already Monday', () => {
  const monday = new Date(2026, 10, 16, 10, 0)
  const nextWeek = reminderPresets(monday)[2][1]
  expect(nextWeek).toEqual(new Date(2026, 10, 23, 9, 0))
})

it('sets a reminder from a preset with the note', async () => {
  const fetchMock = mockApi({ '/api/workspaces/1/reminders/': { status: 201, body: { reminder: { id: 5 } } } })
  render(<RemindMenu workspaceId={1} targetType="chat_message" targetId={42} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remind me' }))
  fireEvent.change(await screen.findByLabelText('Reminder note'), { target: { value: 'Reply to Dana' } })
  fireEvent.click(screen.getByRole('button', { name: 'In 1 hour' }))

  expect(await screen.findByRole('status')).toHaveTextContent('Reminder set for')
  const [, init] = expectRequest(fetchMock, '/api/workspaces/1/reminders/', 'POST')
  const body = JSON.parse(init.body)
  expect(body).toMatchObject({ target_type: 'chat_message', target_id: 42, note: 'Reply to Dana' })
  expect(new Date(body.remind_at).getTime()).toBeGreaterThan(Date.now())
})

it('shows the server message when the reminder is refused', async () => {
  mockApi({ '/api/workspaces/1/reminders/': { status: 400, body: { error: 'Pick a time in the future.' } } })
  render(<RemindMenu workspaceId={1} targetType="task" targetId={9}><button type="button">Remind me</button></RemindMenu>)
  fireEvent.click(screen.getByRole('button', { name: 'Remind me' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Tomorrow, 9:00' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Pick a time in the future.'))
})
