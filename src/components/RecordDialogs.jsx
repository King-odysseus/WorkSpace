// Edit dialogs for the records that are created elsewhere in the app and then
// adjusted in place: calendar events, follow-ups, daily check-ins and projects.

import { useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowUpRight, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { DateField, DateTimeField, SelectField } from './workspace-ui.jsx'
import { formatCalendarDate, getCsrfToken, readJsonResponse, toDateTimeLocal } from '../lib/workspace-format.js'

function CalendarEventEditDialog({ event, workspaceId, canEdit = true, onClose, onUpdated }) {
  const [form, setForm] = useState({ title: event.title, description: event.description || '', start_at: toDateTimeLocal(event.start_at), end_at: toDateTimeLocal(event.end_at), event_type: event.event_type, reminder_minutes: event.reminder_minutes })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = change => setForm(current => ({ ...current, [change.target.name]: change.target.value }))
  const save = async submitEvent => {
    submitEvent.preventDefault()
    if (!canEdit) return
    setError('')
    setSaving(true)
    try {
      const payload = { title: form.title, description: form.description, start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString(), event_type: form.event_type, reminder_minutes: Number(form.reminder_minutes) }
      const response = await fetch(`/api/workspaces/${workspaceId}/calendar-events/${event.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Calendar event could not be saved.')
      onUpdated(data.event)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  if (!canEdit) return <Dialog open onOpenChange={openState => !openState && onClose()}><DialogContent className="modal composer-modal" showCloseButton={false}><DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0"><div><p className="eyebrow">Calendar event</p><DialogTitle>{event.title}</DialogTitle></div><Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close event details"><X size={18} /></Button></DialogHeader><div className="calendar-readonly-details"><p>{event.description || 'No description provided.'}</p><span>{formatCalendarDate(new Date(event.start_at), { dateStyle: 'full', timeStyle: 'short' })}</span><span>Ends {formatCalendarDate(new Date(event.end_at || event.start_at), { dateStyle: 'medium', timeStyle: 'short' })}</span><span className={`event-detail-type event-type-${event.event_type || 'meeting'}`}>{event.event_type || 'Event'}</span><span>Reminder: {event.reminder_minutes ? `${event.reminder_minutes} minutes before` : 'At event time'}</span></div><Button type="button" variant="secondary" onClick={onClose}>Close</Button></DialogContent></Dialog>
  return <Dialog open onOpenChange={openState => !openState && onClose()}>
    <DialogContent className="modal composer-modal" showCloseButton={false}>
      <form onSubmit={save}>
        <DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0">
          <div><p className="eyebrow">Calendar management</p><DialogTitle>Edit event</DialogTitle></div>
          <Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close calendar event editor"><X size={18} /></Button>
        </DialogHeader>
        <label>Event title<input name="title" value={form.title} onChange={update} maxLength="200" required /></label>
        <label>Description<textarea name="description" value={form.description} onChange={update} maxLength="4000" /></label>
        <div className="modal-grid">
          <DateTimeField label="Starts" name="start_at" value={form.start_at} onChange={update} required />
          <DateTimeField label="Ends" name="end_at" value={form.end_at} onChange={update} required />
        </div>
        <SelectField label="Event type" name="event_type" value={form.event_type} onChange={update} options={[['meeting', 'Meeting'], ['focus', 'Focus time'], ['deadline', 'Deadline'], ['reminder', 'Reminder']]} />
        <SelectField label="Reminder" name="reminder_minutes" value={form.reminder_minutes} onChange={update} options={[['0', 'At event time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Button className="primary-button modal-submit w-full justify-center" disabled={saving}>{saving ? 'Saving...' : 'Save event'} <ArrowUpRight size={16} /></Button>
      </form>
    </DialogContent>
  </Dialog>
}

function FollowUpEditDialog({ followUp, members, tasks, workspaceId, canManageMembers, currentUserId, onClose, onUpdated }) {
  const isCreator = followUp.created_by === currentUserId
  const canEditAssignment = canManageMembers || isCreator
  const [form, setForm] = useState({ note: followUp.note, due_date: followUp.due_date || '', assigned_to: followUp.assigned_to || '', task_id: followUp.task_id || '', status: followUp.status })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = canEditAssignment ? { note: form.note, due_date: form.due_date || null, assigned_to: form.assigned_to || null, task_id: form.task_id || null, status: form.status } : { status: form.status }
      const response = await fetch(`/api/follow-ups/${followUp.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Follow-up could not be saved.')
      onUpdated(data.follow_up)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Follow-up management</p><h2 id="follow-up-edit-title">Edit follow-up</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close follow-up editor"><X size={18} /></button></div><label>Follow-up note<textarea name="note" value={form.note} onChange={update} maxLength="500" required disabled={!canEditAssignment} /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} disabled={!canEditAssignment} /><label>Status<select name="status" value={form.status} onChange={update}><option value="open">Open</option><option value="completed">Completed</option></select></label>{canEditAssignment && <><label>Assign to<select name="assigned_to" value={form.assigned_to} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save follow-up'} <ArrowUpRight size={16} /></button></form></div>
}

function CheckInEditDialog({ checkIn, workspaceId, onClose, onUpdated }) {
  const [form, setForm] = useState({ date: checkIn.date, completed: checkIn.completed || '', next_steps: checkIn.next_steps || '', blockers: checkIn.blockers || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-ins/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ date: form.date, completed: form.completed, next_steps: form.next_steps, blockers: form.blockers }) })
      const data = await readJsonResponse(response, 'Check-in could not be saved.')
      if (!response.ok) throw new Error(data.error || 'Check-in could not be saved.')
      onUpdated(data.check_in)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Daily check-in</p><h2 id="checkin-edit-title">Edit check-in</h2><p className="modal-subtitle">Update what you completed, what is next, and any blockers.</p></div><button type="button" className="close-button" onClick={onClose} aria-label="Close check-in editor"><X size={18} /></button></div><DateField label="Date" name="date" value={form.date} onChange={update} /><label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} maxLength="4000" required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} maxLength="4000" /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} maxLength="4000" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save check-in'}</button></form></div>
}

function ProjectEditDrawer({ project, workspaceId, onClose, onUpdated }) {
  const [form, setForm] = useState({ name: project.name, description: project.description || '', due_date: project.due_date || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ ...form, due_date: form.due_date || null }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Project could not be saved.')
      onUpdated(data.project)
      toast.success('Project saved.')
      onClose()
    } catch (saveError) {
      setError(saveError.message)
      toast.error(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="project-edit-title" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Project details</p><h2 id="project-edit-title">Edit project</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close project editor"><X size={18} /></button></div><form className="drawer-task-form" onSubmit={save}><label>Name<input name="name" value={form.name} onChange={update} maxLength="160" required /></label><label>Description<textarea name="description" value={form.description} onChange={update} /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} />{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save project'}</button></form></aside></div>
}

export { CalendarEventEditDialog, FollowUpEditDialog, CheckInEditDialog, ProjectEditDrawer }
