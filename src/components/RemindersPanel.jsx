import React, { useCallback, useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { getCsrfToken } from '../lib/workspace-format.js'

// The member's pending reminders, on the home page. A reminder is set from the
// bell on a message or the "Remind me" button on a task; this panel is where it
// can be seen again and cancelled before it fires. Reading the list also delivers
// any reminder that has come due (the server does that on read), so opening Today
// is enough to be nudged.

const whenLabel = iso => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toDateString() === date.toDateString()
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `Today, ${time}`
  if (tomorrow) return `Tomorrow, ${time}`
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

export default function RemindersPanel({ workspaceId }) {
  const [reminders, setReminders] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(signal => {
    return fetch(`/api/workspaces/${workspaceId}/reminders/`, { credentials: 'include', signal, headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Reminders could not be loaded.')))
      .then(payload => { setReminders(Array.isArray(payload.reminders) ? payload.reminders : []); setError('') })
      .catch(loadError => { if (loadError.name !== 'AbortError') setError(loadError.message || 'Reminders could not be loaded.') })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    const controller = new AbortController()
    load(controller.signal)
    // Refresh when the tab comes back, so a reminder set elsewhere shows up.
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { controller.abort(); window.removeEventListener('focus', onFocus) }
  }, [workspaceId, load])

  const cancel = async reminder => {
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/reminders/${reminder.id}/`, {
        method: 'DELETE', credentials: 'include',
        headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
      })
      if (!response.ok) throw new Error('The reminder could not be cancelled.')
      setReminders(current => (current || []).filter(item => item.id !== reminder.id))
    } catch (cancelError) {
      setError(cancelError.message)
    }
  }

  return (
    <section data-panel="reminders" className="rounded-card border border-border bg-card px-[19px] pb-5 pt-[19px]" aria-label="Reminders">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold leading-[19px] text-text-primary"><Bell size={16} aria-hidden="true" /> Reminders</h2>
        {reminders && reminders.length > 0 && <span className="text-[12px] text-text-muted">{reminders.length} pending</span>}
      </div>
      {error && <p className="mt-3 text-[12px] text-danger" role="alert">{error}</p>}
      {reminders === null && !error ? <p className="mt-4 text-body-small text-text-muted" role="status">Loading...</p>
        : reminders && reminders.length ? (
          <ul className="mt-4 grid gap-1">
            {reminders.slice(0, 5).map(reminder => (
              <li key={reminder.id} className="reminder-row flex items-center gap-3 rounded-2xl px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body-small font-medium text-text-primary">{reminder.label || 'Reminder'}</p>
                  <p className="truncate text-[12px] text-text-muted">{whenLabel(reminder.remind_at)}{reminder.note ? ` · ${reminder.note}` : ''}</p>
                </div>
                <button type="button" className="reminder-cancel" onClick={() => cancel(reminder)} aria-label={`Cancel reminder: ${reminder.label || 'Reminder'}`} title="Cancel reminder"><X size={14} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        ) : !error ? <p className="mt-4 text-body-small text-text-muted">No reminders set. Use the bell on a message or Remind me on a task.</p> : null}
    </section>
  )
}
