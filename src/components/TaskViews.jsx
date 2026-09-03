// The two ways a task is rendered: the compact card used across every board, and
// the detail drawer with comments, subtasks, attachments and dependencies.

import { useEffect, useState } from 'react'
import { Archive, Check, X } from 'lucide-react'
import { DateField } from './workspace-ui.jsx'
import { getCsrfToken, readJsonResponse, taskDueLabel } from '../lib/workspace-format.js'

function TaskCard({ task, onComplete, onStatusChange, onDelete, onOpenTask, onBucketChange, bucketOptions = [], canDelete = true, canEdit = task.can_edit ?? true, draggable = false }) { return <div className={`task-card ${task.status}`} draggable={draggable} onDragStart={event => event.dataTransfer.setData('text/plain', String(task.id))}><button type="button" className={`task-check ${task.status === 'done' ? 'checked' : ''}`} disabled={!canEdit} onClick={() => onComplete(task.id)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}>{task.status === 'done' && <Check size={12} />}</button><div className="task-copy"><button type="button" className="task-title-button" onClick={() => onOpenTask(task)}>{task.title}</button><div><select disabled={!canEdit} className={`task-status task-status-select ${task.status}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select>{bucketOptions.length > 1 && <select disabled={!canEdit} className="task-bucket-select" value={task.bucket || ''} onChange={event => onBucketChange?.(task.id, event.target.value)} aria-label={`Move ${task.title} to bucket`}>{bucketOptions.map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select>}<span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span>{canDelete && <button type="button" className="task-more-button" onClick={() => onDelete(task.id)} aria-label={`Archive ${task.title}`} title="Archive task"><Archive size={16} /></button>}</div> }

function TaskDetailDrawer({ task, workspaceId, members = [], projects = [], buckets = [], tasks = [], canManageTasks = false, onClose, onDelete, onTaskUpdated }) {
  const canEdit = task.can_edit ?? true
  const [comments, setComments] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [attachments, setAttachments] = useState([])
  const [comment, setComment] = useState('')
  const [subtask, setSubtask] = useState('')
  const [labelInput, setLabelInput] = useState((task.labels || []).join(', '))
  const [taskFields, setTaskFields] = useState({ title: task.title, description: task.description || '', status: task.status === 'in progress' ? 'in_progress' : task.status, priority: task.priority || 'normal', due_date: task.due_date || '', recurrence: task.recurrence || 'none', assignee_id: task.assignee_id || '', project_id: task.project_id || '', bucket: task.bucket || 'Backlog' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const selectedAssignee = members.find(member => String(member.id) === String(taskFields.assignee_id))
  const assigneeLabel = selectedAssignee ? ([selectedAssignee.first_name, selectedAssignee.last_name].filter(Boolean).join(' ') || selectedAssignee.email) : 'Unassigned'
  const projectLabel = projects.find(project => String(project.id) === String(taskFields.project_id))?.name || 'General'
  const dueLabel = taskFields.due_date ? taskDueLabel(taskFields.due_date, new Date().toISOString().slice(0, 10)) : 'No due date'
  const request = async (path, options = {}) => {
    try {
      return await fetch(path, { ...options, credentials: 'include', headers: { ...(options.headers || {}), 'X-Workspace-Id': String(workspaceId) } })
    } catch {
      return new Response(JSON.stringify({ error: 'The task service is unavailable. Try again.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
  }
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
      const leaderFields = ['assignee_id', 'project_id']
      const payload = canManageTasks ? taskFields : Object.fromEntries(Object.entries(taskFields).filter(([field]) => !leaderFields.includes(field)))
      const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await readJsonResponse(response, 'Task details could not be saved.')
      if (!response.ok) return setError(data.error || 'Task details could not be saved.')
      onTaskUpdated(data.task)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Task saved.' }))
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
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Task details</p><h2 id="task-detail-title">{taskFields.title || task.title}</h2><span>{assigneeLabel} | {projectLabel} | {dueLabel}</span></div><button type="button" className="close-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button></div>{error && <p className="auth-error">{error}</p>}{loading ? <p className="drawer-muted">Loading task details...</p> : <><section className="drawer-section"><div className="drawer-section-heading"><h3>Task controls</h3><span>Saved to workspace</span></div><form className="drawer-task-form" onSubmit={saveTaskFields}><label>Title<input name="title" value={taskFields.title} onChange={updateTaskField} disabled={!canEdit} maxLength="200" /></label><label>Description<textarea name="description" value={taskFields.description} onChange={updateTaskField} disabled={!canEdit} maxLength="4000" /></label><div className="modal-grid"><label>Assign to<select name="assignee_id" value={taskFields.assignee_id} onChange={updateTaskField} disabled={!canManageTasks}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Project<select name="project_id" value={taskFields.project_id} onChange={updateTaskField} disabled={!canManageTasks}><option value="">General</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><label>Planner bucket<select name="bucket" value={taskFields.bucket} onChange={updateTaskField} disabled={!canEdit}>{(buckets.length ? buckets : [{ id: 'backlog', name: 'Backlog' }]).map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select></label><label>Status<select name="status" value={taskFields.status} onChange={updateTaskField} disabled={!canEdit}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select></label><label>Priority<select name="priority" value={taskFields.priority} onChange={updateTaskField} disabled={!canEdit}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><DateField label="Due date" name="due_date" value={taskFields.due_date} onChange={updateTaskField} disabled={!canEdit} /><label>Repeat<select name="recurrence" value={taskFields.recurrence} onChange={updateTaskField} disabled={!canEdit}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button type="submit" className="secondary-button" disabled={!canEdit}>Save task</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Labels</h3><span>Comma separated</span></div><form className="inline-form" onSubmit={saveLabels}><input value={labelInput} onChange={event => setLabelInput(event.target.value)} placeholder="priority, client, risk" aria-label="Task labels" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Save</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Attachments</h3><span>{attachments.length}</span></div>{attachments.map(attachment => <div className="attachment-row" key={attachment.id}><a href={attachment.file_url} target="_blank" rel="noreferrer">{attachment.original_name}</a>{canEdit && <button className="inline-delete" onClick={() => deleteAttachment(attachment)} aria-label={`Delete ${attachment.original_name}`}><X size={14} /></button>}</div>)}<label className="attachment-upload"><span>Upload file</span><input type="file" onChange={uploadAttachment} disabled={!canEdit} /></label></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Subtasks</h3><span>{subtasks.filter(item => item.completed).length} of {subtasks.length}</span></div>{subtasks.map(item => <div className="subtask-row" key={item.id}><label><input type="checkbox" checked={item.completed} onChange={() => toggleSubtask(item)} disabled={!canEdit} /><span className={item.completed ? 'completed' : ''}>{item.title}</span></label>{canEdit && <button type="button" className="inline-delete" onClick={() => deleteSubtask(item)} aria-label={`Delete subtask ${item.title}`}><X size={14} /></button>}</div>)}<form className="inline-form" onSubmit={addSubtask}><input value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Add</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Dependencies</h3><span>{(task.blocked_by_ids || []).length} blocking</span></div>{task.is_blocked_by_dependency && <p className="drawer-muted dependency-warning">Waiting on {(task.blocked_by_ids || []).length} unfinished task{(task.blocked_by_ids || []).length === 1 ? '' : 's'} below.</p>}<div className="dependency-list">{tasks.filter(item => item.id !== task.id && item.state !== 'archived').map(item => <label className="dependency-row" key={item.id}><input type="checkbox" checked={(task.blocked_by_ids || []).includes(item.id)} onChange={() => toggleDependency(item.id)} disabled={!canEdit} /><span className={item.status === 'done' ? 'completed' : ''}>{item.title}</span></label>)}{!tasks.length && <p className="drawer-muted">No other tasks in this workspace yet.</p>}</div>{(task.blocking_ids || []).length > 0 && <p className="drawer-muted">Blocks: {tasks.filter(item => (task.blocking_ids || []).includes(item.id)).map(item => item.title).join(', ')}</p>}</section><section className="drawer-section"><div className="drawer-section-heading"><h3>Comments</h3><span>{comments.length}</span></div>{comments.length ? comments.map(item => <article className="drawer-comment" key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p></article>) : <p className="drawer-muted">No comments yet.</p>}<form className="drawer-comment-form" onSubmit={addComment}><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Write an update for the team" aria-label="Write a task comment" /><button type="submit" className="primary-button">Post comment</button></form></section></>}</aside></div>
}

export { TaskCard, TaskDetailDrawer }
