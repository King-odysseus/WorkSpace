// Edit dialogs for the records that are created elsewhere in the app and then
// adjusted in place: calendar events, follow-ups, daily check-ins and projects.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowUpRight, CircleCheck, MessageCircle, TriangleAlert, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Alert } from './ui/alert.jsx'
import { Skeleton, SkeletonGroup } from './ui/skeleton.jsx'
import { AppSelect } from './ui/select.jsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.jsx'
import { DateField, DateTimeField, SelectField } from './workspace-ui.jsx'
import Avatar from './Avatar.jsx'
import LinkedText from './LinkedText.jsx'
import MentionPicker from './MentionPicker.jsx'
import { formatDay, formatDateTime, getCsrfToken, readJsonResponse, toDateTimeLocal } from '../lib/workspace-format.js'

const CHECK_IN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CHECK_IN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function formatCheckInDetailDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!match) return formatDay(value)
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return `${CHECK_IN_WEEKDAYS[date.getDay()]}, ${date.getDate()} ${CHECK_IN_MONTHS[date.getMonth()]}`
}

function formatCommentTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

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
  if (!canEdit) return <Dialog open onOpenChange={openState => !openState && onClose()}><DialogContent className="modal composer-modal" showCloseButton={false}><DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0"><div><p className="eyebrow">Calendar event</p><DialogTitle>{event.title}</DialogTitle></div><Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close event details"><X size={18} /></Button></DialogHeader><div className="calendar-readonly-details"><p>{event.description || 'No description provided.'}</p><span>{formatDateTime(event.start_at)}</span><span>Ends {formatDateTime(event.end_at || event.start_at)}</span><span className={`event-detail-type event-type-${event.event_type || 'meeting'}`}>{event.event_type || 'Event'}</span><span>Reminder: {event.reminder_minutes ? `${event.reminder_minutes} minutes before` : 'At event time'}</span></div><Button type="button" variant="secondary" onClick={onClose}>Close</Button></DialogContent></Dialog>
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
        {error && <Alert tone="danger" compact>{error}</Alert>}
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
  const [comments, setComments] = useState([])
  const [commentBody, setCommentBody] = useState('')
  const [commenting, setCommenting] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  useEffect(() => {
    let current = true
    fetch(`/api/follow-ups/${followUp.id}/comments/`, { credentials: 'include' })
      .then(response => readJsonResponse(response, 'Follow-up comments could not be loaded.'))
      .then(data => { if (current) setComments(data.comments || []) })
      .catch(loadError => { if (current) setError(loadError.message || 'Follow-up comments could not be loaded.') })
    return () => { current = false }
  }, [followUp.id])
  const postComment = async () => {
    const body = commentBody.trim()
    if (!body || commenting) return
    setCommenting(true)
    setError('')
    try {
      const response = await fetch(`/api/follow-ups/${followUp.id}/comments/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ body }) })
      const data = await readJsonResponse(response, 'Comment could not be added.')
      if (!response.ok) throw new Error(data.error || 'Comment could not be added.')
      setComments(current => [...current, data.comment])
      setCommentBody('')
    } catch (commentError) {
      setError(commentError.message || 'Comment could not be added.')
    } finally {
      setCommenting(false)
    }
  }
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
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Follow-up management</p><h2 id="follow-up-edit-title">Edit follow-up</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close follow-up editor"><X size={18} /></button></div><label>Follow-up note<textarea name="note" value={form.note} onChange={update} maxLength="500" required disabled={!canEditAssignment} /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} disabled={!canEditAssignment} /><SelectField label="Status" name="status" value={form.status} onChange={update} options={[['open', 'Open'], ['completed', 'Completed']]} />{canEditAssignment && <><label>Assign to<AppSelect name="assigned_to" value={form.assigned_to} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</AppSelect></label><label>Link to task<AppSelect name="task_id" value={form.task_id} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</AppSelect></label></>}<section className="checkin-comments" aria-label="Follow-up comments"><div className="drawer-section-heading"><h3>Discussion</h3><span>{comments.length}</span></div>{comments.length ? <div className="checkin-comment-list">{comments.map(comment => <article className="drawer-comment" key={comment.id}><strong>{comment.author_name}</strong><time>{formatDateTime(comment.created_at)}</time><p><LinkedText text={comment.body} /></p></article>)}</div> : <p className="drawer-muted">No comments yet.</p>}<label>Add a comment<MentionPicker members={members} value={commentBody} onChange={setCommentBody} currentUserId={currentUserId}>{inputRef => <textarea ref={inputRef} value={commentBody} onChange={event => setCommentBody(event.target.value)} maxLength="2000" placeholder="Share an update or response." />}</MentionPicker></label><Button type="button" variant="secondary" onClick={postComment} disabled={commenting || !commentBody.trim()}>{commenting ? 'Posting...' : 'Post comment'}</Button></section>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save follow-up'} <ArrowUpRight size={16} /></button></form></div>
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
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Daily check-in</p><h2 id="checkin-edit-title">Edit check-in</h2><p className="modal-subtitle">Update what you completed, what is next, and any blockers.</p></div><button type="button" className="close-button" onClick={onClose} aria-label="Close check-in editor"><X size={18} /></button></div><DateField label="Date" name="date" value={form.date} onChange={update} /><label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} maxLength="4000" required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} maxLength="4000" /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} maxLength="4000" /></label>{error && <Alert tone="danger" compact>{error}</Alert>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save check-in'}</button></form></div>
}

function CheckInDetailDialog({ checkIn, workspaceId, members = [], currentUserId, canComment, canEdit, onClose, onEdit }) {
  const [comments, setComments] = useState([])
  const [commentBody, setCommentBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const author = members.find(member => String(member.id) === String(checkIn.user_id))

  const loadComments = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-ins/${checkIn.id}/comments/`, { credentials: 'include' })
      const data = await readJsonResponse(response, 'Check-in comments could not be loaded.')
      if (!response.ok) throw new Error(data.error || 'Check-in comments could not be loaded.')
      setComments(data.comments || [])
    } catch (loadError) {
      setError(loadError.message || 'Check-in comments could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadComments()
  }, [workspaceId, checkIn.id])

  const submitComment = async event => {
    event.preventDefault()
    const body = commentBody.trim()
    if (!body || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-ins/${checkIn.id}/comments/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ body }),
      })
      const data = await readJsonResponse(response, 'Comment could not be added.')
      if (!response.ok) throw new Error(data.error || 'Comment could not be added.')
      setComments(current => [...current, data.comment])
      setCommentBody('')
    } catch (submitError) {
      setError(submitError.message || 'Comment could not be added.')
    } finally {
      setSubmitting(false)
    }
  }

  return <Dialog open onOpenChange={openState => !openState && onClose()}>
    <DialogContent className="modal checkin-detail-dialog" showCloseButton={false}>
      <DialogHeader className="checkin-detail-header">
        <div className="checkin-detail-author">
          <Avatar name={checkIn.user_name} avatarUrl={author?.avatar_url} className="checkin-detail-avatar" />
          <div className="checkin-detail-heading-copy">
            <DialogTitle>{checkIn.user_name || 'Team member'}</DialogTitle>
            <p>{formatCheckInDetailDate(checkIn.date)}</p>
            <span className="checkin-detail-submitted"><i aria-hidden="true" /> Submitted</span>
          </div>
        </div>
        <div className="checkin-detail-header-actions">
          <Button type="button" variant="ghost" size="sm" className="checkin-detail-edit" onClick={onEdit} disabled={!canEdit}>Edit</Button>
          <Button type="button" variant="ghost" size="icon" className="checkin-detail-close" onClick={onClose} aria-label="Close check-in details"><X size={18} /></Button>
        </div>
      </DialogHeader>
      <div className="checkin-detail-body">
        <dl className="checkin-detail-summary">
          <div className="checkin-detail-summary-row">
            <span className="checkin-detail-summary-icon is-completed" aria-hidden="true"><CircleCheck size={18} /></span>
            <div><dt>Completed</dt><dd><LinkedText text={checkIn.completed || 'No update yet.'} /></dd></div>
          </div>
          <div className="checkin-detail-summary-row">
            <span className="checkin-detail-summary-icon" aria-hidden="true"><ArrowRight size={18} /></span>
            <div><dt>Next steps</dt><dd><LinkedText text={checkIn.next_steps || 'No next step recorded.'} /></dd></div>
          </div>
          <div className={`checkin-detail-summary-row${checkIn.blockers ? ' is-blocker' : ''}`}>
            <span className="checkin-detail-summary-icon" aria-hidden="true"><TriangleAlert size={18} /></span>
            <div><dt>Blockers</dt><dd><LinkedText text={checkIn.blockers || 'None reported.'} /></dd></div>
          </div>
        </dl>
        <section className="checkin-detail-discussion" aria-labelledby="checkin-discussion-heading" aria-busy={loading}>
          <div className="checkin-detail-discussion-heading">
            <h3 id="checkin-discussion-heading">Discussion</h3>
            <span>{comments.length}</span>
          </div>
          {loading ? <SkeletonGroup className="checkin-detail-comment-skeleton" label="Loading comments"><Skeleton variant="line" /><Skeleton variant="text" style={{ width: '72%' }} /><Skeleton variant="line" /></SkeletonGroup> : comments.length ? <div className="checkin-detail-comment-list">{comments.map(comment => {
            const commentAuthor = members.find(member => String(member.id) === String(comment.author_id))
            return <article className="checkin-detail-comment" key={comment.id}><Avatar name={comment.author_name} avatarUrl={commentAuthor?.avatar_url} small className="checkin-detail-comment-avatar" /><div className="checkin-detail-comment-main"><header><strong>{comment.author_name || 'Team member'}</strong><time dateTime={comment.created_at}>{formatCommentTime(comment.created_at)}</time></header><p><LinkedText text={comment.body} /></p></div></article>
          })}</div> : <div className="checkin-detail-empty"><MessageCircle size={24} aria-hidden="true" /><strong>No comments yet</strong><p>Add an update or offer help with the blocker.</p></div>}
          {error && <Alert tone="danger" compact className="checkin-detail-error">{error}</Alert>}
        </section>
      </div>
      <footer className={`checkin-detail-composer${canComment ? '' : ' is-readonly'}`}>
        {canComment ? <form onSubmit={submitComment}><label htmlFor="checkin-comment">Add a comment</label><MentionPicker members={members} value={commentBody} onChange={setCommentBody} currentUserId={currentUserId}>{inputRef => <textarea ref={inputRef} id="checkin-comment" value={commentBody} onChange={event => setCommentBody(event.target.value)} maxLength="2000" placeholder="Share feedback, an update, or help with a blocker." required />}</MentionPicker><div className="checkin-detail-composer-action"><Button type="submit" className="primary-button" disabled={submitting || !commentBody.trim()}>{submitting ? 'Posting...' : 'Post comment'}</Button></div></form> : <div className="checkin-detail-permission"><MessageCircle size={16} aria-hidden="true" /><span>You do not have permission to comment on check-ins.</span></div>}
      </footer>
    </DialogContent>
  </Dialog>
}

function ProjectEditDialog({ project, workspaceId, onClose, onUpdated }) {
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
  return <Dialog open onOpenChange={openState => !openState && onClose()}>
    <DialogContent className="modal composer-modal" showCloseButton={false}>
      <form onSubmit={save}>
        <DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0">
          <div><p className="eyebrow">Project details</p><DialogTitle>Edit project</DialogTitle></div>
          <Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close project editor"><X size={18} /></Button>
        </DialogHeader>
        <label>Name<input name="name" value={form.name} onChange={update} maxLength="160" required /></label>
        <label>Description<textarea name="description" value={form.description} onChange={update} /></label>
        <DateField label="Due date" name="due_date" value={form.due_date} onChange={update} />
        {error && <Alert tone="danger" compact>{error}</Alert>}
        <Button className="primary-button modal-submit w-full justify-center" disabled={saving}>{saving ? 'Saving...' : 'Save project'}</Button>
      </form>
    </DialogContent>
  </Dialog>
}

export { CalendarEventEditDialog, FollowUpEditDialog, CheckInDetailDialog, CheckInEditDialog, ProjectEditDialog }
