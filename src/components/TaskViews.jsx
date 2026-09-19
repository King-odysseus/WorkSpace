import { AppSelect } from './ui/select.jsx'
import { Alert } from './ui/alert.jsx'
import { Skeleton, SkeletonGroup } from './ui/skeleton.jsx'
// The two ways a task is rendered: the compact card used across every board, and
// the detail drawer with comments, subtasks, attachments and dependencies.

import { useEffect, useState } from 'react'
import { Archive, Check, ChevronDown, X } from 'lucide-react'
import { DateField } from './workspace-ui.jsx'
import LinkedText from './LinkedText.jsx'
import MentionPicker from './MentionPicker.jsx'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.jsx'
import { getCsrfToken, isImageFileName, readJsonResponse, taskDueLabel, toDateKey } from '../lib/workspace-format.js'

function memberLabel(member) {
  return [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
}

function memberInitials(member) {
  const label = memberLabel(member)
  const parts = label.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
}

// Order is meaningful rather than cosmetic: the first ticked member becomes the
// task's primary assignee, which is what the single-owner readers still use.
function AssigneePicker({ members = [], value = [], onChange, disabled = false }) {
  const [open, setOpen] = useState(false)
  const ids = value.map(String)
  const selectedMembers = ids.map(id => members.find(member => String(member.id) === id)).filter(Boolean)
  const names = selectedMembers.map(memberLabel)
  const toggle = memberId => {
    const key = String(memberId)
    onChange(ids.includes(key) ? ids.filter(id => id !== key) : [...ids, key])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`assignee-picker-trigger${open ? ' is-open' : ''}`}
          disabled={disabled}
          aria-label={names.length ? `Choose assignees. Selected: ${names.join(', ')}` : 'Choose assignees'}
          title={names.length ? names.join(', ') : 'Choose assignees'}
        >
          <span className="assignee-picker-value">
            {selectedMembers.length ? selectedMembers.map((member, index) => (
              <span className={`assignee-picker-badge${index === 0 ? ' is-primary' : ''}`} key={member.id}>
                <span className="assignee-picker-avatar" aria-hidden="true">{memberInitials(member)}</span>
                <span className="assignee-picker-badge-name">{memberLabel(member)}</span>
              </span>
            )) : <span className="assignee-picker-placeholder">Unassigned</span>}
          </span>
          <ChevronDown className="assignee-picker-chevron" size={16} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="assignee-picker-popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label="Choose assignees">
        <div className="assignee-picker-heading">
          <div>
            <strong>Assignees</strong>
            <span>The first selected person is primary.</span>
          </div>
          <span className="assignee-picker-count" aria-label={`${ids.length} selected`}>{ids.length}</span>
        </div>
        <div className="assignee-picker-list" role="group" aria-label="Workspace members">
          {members.map(member => {
            const key = String(member.id)
            const selected = ids.includes(key)
            const label = memberLabel(member)
            return (
              <label className={`assignee-picker-row${selected ? ' is-selected' : ''}`} key={member.id}>
                <input type="checkbox" checked={selected} onChange={() => toggle(member.id)} disabled={disabled} />
                <span className="assignee-picker-avatar" aria-hidden="true">{memberInitials(member)}</span>
                <span className="assignee-picker-option-copy">
                  <strong>{label}</strong>
                  {member.email && member.email !== label && <small>{member.email}</small>}
                </span>
                {selected && ids[0] === key && <em>Primary</em>}
              </label>
            )
          })}
          {!members.length && <p className="drawer-muted">No members to assign.</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TaskCard({ task, onComplete, onStatusChange, onDelete, onOpenTask, onBucketChange, bucketOptions = [], canDelete = true, canEdit = task.can_edit ?? true, draggable = false }) { const completed = task.status === 'done'; return <div className={`task-card ${task.status}`} draggable={draggable} onDragStart={event => event.dataTransfer.setData('text/plain', String(task.id))}><button type="button" role="checkbox" aria-checked={completed} className={`task-check ${completed ? 'checked' : ''}`} disabled={!canEdit} onClick={() => onComplete(task.id)} aria-label={`${completed ? 'Reopen' : 'Complete'} ${task.title}`} title={completed ? 'Reopen task' : 'Mark task complete'}><Check className="task-check-mark" size={13} strokeWidth={3} aria-hidden="true" /></button><div className="task-copy"><button type="button" className="task-title-button" onClick={() => onOpenTask(task)}>{task.title}</button><div><AppSelect disabled={!canEdit} className={`task-status task-status-select ${task.status}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></AppSelect>{bucketOptions.length > 1 && <AppSelect disabled={!canEdit} className="task-bucket-select" value={task.bucket || ''} onChange={event => onBucketChange?.(task.id, event.target.value)} aria-label={`Move ${task.title} to bucket`}>{bucketOptions.map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</AppSelect>}<span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span>{canDelete && <button type="button" className="task-more-button" onClick={() => onDelete(task.id)} aria-label={`Archive ${task.title}`} title="Archive task"><Archive size={16} /></button>}</div> }

function TaskDetailDrawer({ task, workspaceId, members = [], projects = [], buckets = [], tasks = [], currentUserId, canManageTasks = false, onClose, onDelete, onTaskUpdated }) {
  const canEdit = task.can_edit ?? true
  const [comments, setComments] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [attachments, setAttachments] = useState([])
  const [comment, setComment] = useState('')
  const [subtask, setSubtask] = useState('')
  const [labelInput, setLabelInput] = useState((task.labels || []).join(', '))
  const [taskFields, setTaskFields] = useState({ title: task.title, description: task.description || '', status: task.status === 'in progress' ? 'in_progress' : task.status, priority: task.priority || 'normal', due_date: task.due_date || '', recurrence: task.recurrence || 'none', assignee_ids: task.assignee_ids?.length ? [...task.assignee_ids] : (task.assignee_id ? [task.assignee_id] : []), project_id: task.project_id || '', bucket: task.bucket || 'Backlog' })
  const [dependencyTasks, setDependencyTasks] = useState(tasks)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const memberLabel = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const selectedAssignees = taskFields.assignee_ids.map(String).map(id => members.find(member => String(member.id) === id)).filter(Boolean)
  const assigneeLabel = selectedAssignees.length ? selectedAssignees.map(memberLabel).join(', ') : 'Unassigned'
  const projectLabel = projects.find(project => String(project.id) === String(taskFields.project_id))?.name || 'General'
  const dueLabel = taskFields.due_date ? taskDueLabel(taskFields.due_date, toDateKey(new Date())) : 'No due date'
  const request = async (path, options = {}) => {
    try {
      return await fetch(path, { ...options, credentials: 'include', headers: { ...(options.headers || {}), 'X-Workspace-Id': String(workspaceId) } })
    } catch {
      return new Response(JSON.stringify({ error: 'The task service is unavailable. Try again.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
  }
  useEffect(() => {
    if (tasks.length || !workspaceId) {
      setDependencyTasks(tasks)
      return undefined
    }
    let current = true
    request(`/api/workspaces/${workspaceId}/tasks/?page_size=200&sort=title`)
      .then(async response => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || 'Task dependencies could not be loaded.')
        if (current) setDependencyTasks(payload.tasks || [])
      })
      .catch(() => {
        if (current) setDependencyTasks([])
      })
    return () => { current = false }
  }, [task.id, tasks.length, workspaceId])
  useEffect(() => {
    Promise.all([request(`/api/tasks/${task.id}/comments/`), request(`/api/tasks/${task.id}/subtasks/`), request(`/api/tasks/${task.id}/attachments/`)]).then(async ([commentResponse, subtaskResponse, attachmentResponse]) => {
      if (!commentResponse.ok || !subtaskResponse.ok || !attachmentResponse.ok) throw new Error('Task details could not be loaded.')
      const [commentData, subtaskData, attachmentData] = await Promise.all([commentResponse.json(), subtaskResponse.json(), attachmentResponse.json()])
      setComments(commentData.comments)
      setSubtasks(subtaskData.subtasks)
      setAttachments(attachmentData.attachments)
    }).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
  }, [task.id, workspaceId])
  const updateTaskField = event => setTaskFields(current => ({ ...current, [event.target.name]: event.target.value }))
  const saveTaskFields = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const leaderFields = ['assignee_ids', 'project_id']
      const payload = canManageTasks ? taskFields : Object.fromEntries(Object.entries(taskFields).filter(([field]) => !leaderFields.includes(field)))
      const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await readJsonResponse(response, 'Task details could not be saved.')
      if (!response.ok) return setError(data.error || 'Task details could not be saved.')
      onTaskUpdated(data.task)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Task updated.' }))
      onClose()
    } catch (saveError) {
      setError(saveError.message || 'Task details could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const addComment = async event => {
    event.preventDefault()
    if (!comment.trim()) return
    setError('')
    const response = await request(`/api/tasks/${task.id}/comments/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ body: comment.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Comment could not be added.')
    setComments(current => [...current, data.comment])
    setComment('')
  }
  const addSubtask = async event => {
    event.preventDefault()
    if (!subtask.trim()) return
    setError('')
    const response = await request(`/api/tasks/${task.id}/subtasks/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ title: subtask.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be added.')
    setSubtasks(current => [...current, data.subtask])
    setSubtask('')
  }
  const toggleSubtask = async item => {
    setError('')
    const response = await request(`/api/subtasks/${item.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ completed: !item.completed }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be updated.')
    setSubtasks(current => current.map(existing => existing.id === item.id ? data.subtask : existing))
  }
  const deleteSubtask = async item => {
    setError('')
    const response = await request(`/api/subtasks/${item.id}/`, { method: 'DELETE', headers: { 'X-CSRFToken': await getCsrfToken() } })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be deleted.')
    setSubtasks(current => current.filter(existing => existing.id !== item.id))
  }
  const toggleDependency = async otherTaskId => {
    setError('')
    const currentIds = task.blocked_by_ids || []
    const nextIds = currentIds.includes(otherTaskId) ? currentIds.filter(id => id !== otherTaskId) : [...currentIds, otherTaskId]
    const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ blocked_by_ids: nextIds }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Dependency could not be updated.')
    onTaskUpdated(data.task)
  }
  const saveLabels = async event => {
    event.preventDefault()
    setError('')
    const labels = [...new Set(labelInput.split(',').map(label => label.trim()).filter(Boolean))]
    const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ labels }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Labels could not be saved.')
    setLabelInput((data.task.labels || []).join(', '))
    onTaskUpdated(data.task)
  }
  const uploadAttachment = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    const formData = new FormData()
    formData.append('file', file)
    const response = await request(`/api/tasks/${task.id}/attachments/`, { method: 'POST', headers: { 'X-CSRFToken': await getCsrfToken() }, body: formData })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Attachment could not be uploaded.')
    setAttachments(current => [data.attachment, ...current])
    event.target.value = ''
  }
  const deleteAttachment = async attachment => {
    setError('')
    const response = await request(`/api/attachments/${attachment.id}/`, { method: 'DELETE', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return setError('Attachment could not be deleted.')
    setAttachments(current => current.filter(item => item.id !== attachment.id))
  }
    return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Task details</p><h2 id="task-detail-title">{taskFields.title || task.title}</h2><span>{assigneeLabel} | {projectLabel} | {dueLabel}</span></div><button type="button" className="close-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button></div>{error && <Alert tone="danger" compact>{error}</Alert>}{loading ? <SkeletonGroup className="drawer-skeleton" label="Loading task details"><Skeleton variant="heading" /><Skeleton variant="line" /><Skeleton variant="line" /><Skeleton variant="row" /><Skeleton variant="row" /><Skeleton variant="text" style={{ width: '68%' }} /></SkeletonGroup> : <><section className="drawer-section"><div className="drawer-section-heading"><h3>Task controls</h3><span>Saved to workspace</span></div><form className="drawer-task-form" onSubmit={saveTaskFields}><label>Title<input name="title" value={taskFields.title} onChange={updateTaskField} disabled={!canEdit} maxLength="200" /></label><label>Description<textarea name="description" value={taskFields.description} onChange={updateTaskField} disabled={!canEdit} maxLength="4000" /></label><div className="modal-grid"><label>Assign to<AssigneePicker members={members} value={taskFields.assignee_ids} onChange={assigneeIds => setTaskFields(current => ({ ...current, assignee_ids: assigneeIds }))} disabled={!canManageTasks} /></label><label>Project<AppSelect name="project_id" value={taskFields.project_id} onChange={updateTaskField} disabled={!canManageTasks}><option value="">General</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</AppSelect></label></div><label>Planner bucket<AppSelect name="bucket" value={taskFields.bucket} onChange={updateTaskField} disabled={!canEdit}>{(buckets.length ? buckets : [{ id: 'backlog', name: 'Backlog' }]).map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</AppSelect></label><label>Status<AppSelect name="status" value={taskFields.status} onChange={updateTaskField} disabled={!canEdit}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></AppSelect></label><label>Priority<AppSelect name="priority" value={taskFields.priority} onChange={updateTaskField} disabled={!canEdit}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></AppSelect></label><DateField label="Due date" name="due_date" value={taskFields.due_date} onChange={updateTaskField} disabled={!canEdit} /><label>Repeat<AppSelect name="recurrence" value={taskFields.recurrence} onChange={updateTaskField} disabled={!canEdit}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></AppSelect></label><button type="submit" className="secondary-button" disabled={!canEdit}>Update task</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Labels</h3><span>Comma separated</span></div><form className="inline-form" onSubmit={saveLabels}><input value={labelInput} onChange={event => setLabelInput(event.target.value)} placeholder="priority, client, risk" aria-label="Task labels" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Save</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Attachments</h3><span>{attachments.length}</span></div>{attachments.map(attachment => <div className="attachment-row" key={attachment.id}><a href={attachment.file_url} target="_blank" rel="noreferrer">{isImageFileName(attachment.original_name) && <img className="attachment-thumb" src={attachment.file_url} alt="" loading="lazy" />}<span>{attachment.original_name}</span></a>{canEdit && <button className="inline-delete" onClick={() => deleteAttachment(attachment)} aria-label={`Delete ${attachment.original_name}`}><X size={14} /></button>}</div>)}<label className="attachment-upload"><span>Upload file</span><input type="file" onChange={uploadAttachment} disabled={!canEdit} /></label></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Subtasks</h3><span>{subtasks.filter(item => item.completed).length} of {subtasks.length}</span></div>{subtasks.map(item => <div className="subtask-row" key={item.id}><label><input type="checkbox" checked={item.completed} onChange={() => toggleSubtask(item)} disabled={!canEdit} /><span className={item.completed ? 'completed' : ''}>{item.title}</span></label>{canEdit && <button type="button" className="inline-delete" onClick={() => deleteSubtask(item)} aria-label={`Delete subtask ${item.title}`}><X size={14} /></button>}</div>)}<form className="inline-form" onSubmit={addSubtask}><input value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Add</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Dependencies</h3><span>{(task.blocked_by_ids || []).length} blocking</span></div>{task.is_blocked_by_dependency && <p className="drawer-muted dependency-warning">Waiting on {(task.blocked_by_ids || []).length} unfinished task{(task.blocked_by_ids || []).length === 1 ? '' : 's'} below.</p>}<div className="dependency-list">{dependencyTasks.filter(item => item.id !== task.id && item.state !== 'archived').map(item => <label className="dependency-row" key={item.id}><input type="checkbox" checked={(task.blocked_by_ids || []).includes(item.id)} onChange={() => toggleDependency(item.id)} disabled={!canEdit} /><span className={item.status === 'done' ? 'completed' : ''}>{item.title}</span></label>)}{!dependencyTasks.length && <p className="drawer-muted">No other tasks in this workspace yet.</p>}</div>{(task.blocking_ids || []).length > 0 && <p className="drawer-muted">Blocks: {dependencyTasks.filter(item => (task.blocking_ids || []).includes(item.id)).map(item => item.title).join(', ')}</p>}</section><section className="drawer-section"><div className="drawer-section-heading"><h3>Comments</h3><span>{comments.length}</span></div>{comments.length ? comments.map(item => <article className="drawer-comment" key={item.id}><strong>{item.author_name}</strong><p><LinkedText text={item.body} /></p></article>) : <p className="drawer-muted">No comments yet.</p>}<MentionPicker members={members} value={comment} onChange={setComment} currentUserId={currentUserId}>{inputRef => <form className="drawer-comment-form" onSubmit={addComment}><textarea ref={inputRef} value={comment} onChange={event => setComment(event.target.value)} placeholder="Write an update for the team" aria-label="Write a task comment" /><button type="submit" className="primary-button">Post comment</button></form>}</MentionPicker></section></>}</aside></div>
}

export { AssigneePicker, TaskCard, TaskDetailDrawer }
