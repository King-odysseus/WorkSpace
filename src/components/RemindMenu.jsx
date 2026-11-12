import React, { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Bell } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { getCsrfToken } from '../lib/workspace-format.js'

// "Remind me about this" for a task or a chat message. The reminder is personal
// and arrives as an ordinary in-app notification once its time has passed (see
// deliver_due_reminders on the server), so there is nothing to schedule or pay for.

const toLocalInputValue = date => {
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// Presets are built from `now` so they stay correct however long the page has
// been open. "Tomorrow" and "next week" land at 9:00 local time.
export function reminderPresets(now = new Date()) {
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
  const daysToMonday = ((8 - now.getDay()) % 7) || 7
  const nextWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday, 9, 0)
  return [['In 1 hour', inAnHour], ['Tomorrow, 9:00', tomorrow], ['Next week, Monday 9:00', nextWeek]]
}

export default function RemindMenu({ workspaceId, targetType, targetId, children, className = '', label = 'Remind me' }) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const schedule = async when => {
    if (saving) return
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) { setError('Pick a date and time.'); return }
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/reminders/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, remind_at: when.toISOString(), note: note.trim() }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'The reminder could not be saved.')
      setDone(`Reminder set for ${when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`)
      setNote('')
      setCustom('')
    } catch (scheduleError) {
      setError(scheduleError.message)
    } finally {
      setSaving(false)
    }
  }

  const onOpenChange = next => {
    setOpen(next)
    if (next) { setDone(''); setError('') }
  }

  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>
      {children || <button type="button" className={`remind-trigger ${className}`.trim()} aria-label={label} title={label}><Bell size={13} /></button>}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="remind-panel" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label="Set a reminder">
        <h3>Remind me</h3>
        {done ? <p className="remind-done" role="status">{done}</p> : <>
          <div className="remind-presets">
            {reminderPresets().map(([text, when]) => <Button key={text} type="button" variant="outline" size="sm" disabled={saving} onClick={() => schedule(when)}>{text}</Button>)}
          </div>
          <label className="remind-field"><span>Or pick a time</span>
            <input type="datetime-local" value={custom} min={toLocalInputValue(new Date())} onChange={event => setCustom(event.target.value)} aria-label="Reminder time" />
          </label>
          <label className="remind-field"><span>Note (optional)</span>
            <input type="text" value={note} maxLength={200} onChange={event => setNote(event.target.value)} aria-label="Reminder note" placeholder="What to do about it" />
          </label>
          <Button type="button" size="sm" disabled={!custom || saving} loading={saving} onClick={() => schedule(new Date(custom))}>Set reminder</Button>
        </>}
        {error && <p className="remind-error" role="alert">{error}</p>}
        <Popover.Arrow className="chat-reaction-picker-arrow" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
}
