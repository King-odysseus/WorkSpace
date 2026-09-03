// Board and dashboard views: the team board, the personal task queue, the Today
// dashboard, and the panels they embed (project progress, risks/issues,
// stakeholders and resources, and the time clock).

import React, { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Archive, ArrowUpRight, Brush, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight,
  Clock3, Filter, Hash, MessageSquare, Pause, Play, Plus, Square, Target, X,
} from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import Avatar from './Avatar.jsx'
import WorkScopeSelector, { taskMatchesScope } from './WorkScopeSelector.jsx'
import { DateField, EmptyState, WorkspaceViewHeading } from './workspace-ui.jsx'
import {
  BREAK_PRESETS, BREAK_PRESET_LABEL, PRESENCE_LABEL, PRESENCE_OPTIONS,
  formatShiftClock, formatShiftDuration, getCsrfToken, readJsonResponse, toDateKey,
} from '../lib/workspace-format.js'

function TeamBoardView({ tasks, members, projects = [], scope = 'all', onScopeChange, invitations, canManageMembers, onInvite, onComplete, onStatusChange, onOpenTask, onUpdateMemberRole, onRemoveMember, onCancelInvitation }) {
  const today = toDateKey(new Date())
  const [mode, setMode] = useState('people')
  const [query, setQuery] = useState('')
  const statuses = [['todo', 'To do'], ['in progress', 'In progress'], ['review', 'Review'], ['blocked', 'Blocked'], ['on_hold', 'On hold'], ['cancelled', 'Cancelled'], ['done', 'Done']]
  const priorities = ['urgent', 'high', 'normal', 'low']
  const scopedTasks = tasks.filter(task => taskMatchesScope(task, scope))
  const openTasks = scopedTasks.filter(task => task.status !== 'done')
  const blocked = scopedTasks.filter(task => task.status === 'blocked')
  const overdue = scopedTasks.filter(task => task.due_date && task.due_date < today && task.status !== 'done')
  const unassigned = openTasks.filter(task => !task.assignee_id)
  const filtered = scopedTasks.filter(task => !query.trim() || [task.title, task.member, task.tag, task.bucket].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const memberName = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const renderMessageText = text => String(text || '').split(/(@[A-Za-z0-9_.-]+)/g).map((part, index) => part.startsWith('@') ? <mark className="chat-mention" key={index}>{part}</mark> : <React.Fragment key={index}>{part}</React.Fragment>)
  const tasksForMember = member => filtered.filter(task => String(task.assignee_id || '') === String(member.id) || (!task.assignee_id && task.member === memberName(member)))
  const taskLabel = task => task.due_date && task.due_date < today && task.status !== 'done' ? 'Overdue' : task.due_date === today ? 'Due today' : task.status === 'in progress' ? 'In progress' : task.status
  const taskList = list => list.length ? list.map(task => <article className={`team-task-row ${task.status}`} key={task.id}><button type="button" className={`check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => onComplete(task.id)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}>{task.status === 'done' && <Check size={12} />}</button><div><button type="button" onClick={() => onOpenTask(task)}>{task.title}</button><span>{task.member || 'Unassigned'} · {taskLabel(task)}</span></div><span className={`my-task-priority ${task.priority}`}>{task.priority}</span><select value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select></article>) : <p className="today-muted">No tasks in this view.</p>
  return <section className="workspace-view team-board-view"><WorkspaceViewHeading title="Team board" subtitle="See ownership, workload, and exceptions across the workspace." action={canManageMembers ? 'Invite member' : undefined} onAction={onInvite} /><div className="team-board-metrics"><button onClick={() => setMode('people')}><strong>{openTasks.length}</strong><span>Open tasks</span></button><button className={blocked.length ? 'attention' : ''} onClick={() => setMode('status')}><strong>{blocked.length}</strong><span>Blocked</span></button><button className={overdue.length ? 'attention' : ''} onClick={() => setMode('people')}><strong>{overdue.length}</strong><span>Overdue</span></button><button className={unassigned.length ? 'attention' : ''} onClick={() => setMode('people')}><strong>{unassigned.length}</strong><span>Unassigned</span></button></div><div className="team-board-toolbar"><WorkScopeSelector compact value={scope} onChange={onScopeChange} projects={projects} label="Scope" /><div className="team-board-tabs">{[['people', 'People'], ['status', 'Status'], ['priority', 'Priority']].map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search team tasks" aria-label="Search team tasks" /></div>{mode === 'people' && <div className="team-member-grid">{members.map(member => { const memberTasks = tasksForMember(member); const memberOpen = memberTasks.filter(task => task.status !== 'done'); const memberDone = memberTasks.filter(task => task.status === 'done').length; return <section className="team-member-card" key={member.id}><div className="team-member-heading"><Avatar name={memberName(member)} avatarUrl={member.avatar_url} presence={member.presence} small /><div><h2>{memberName(member)}</h2><span>{member.role} · {memberOpen.length} open</span></div><strong>{memberTasks.length ? Math.round((memberDone / memberTasks.length) * 100) : 0}%</strong></div><div className="team-member-progress"><i style={{ width: `${memberTasks.length ? Math.round((memberDone / memberTasks.length) * 100) : 0}%` }} /></div><div className="team-task-list">{taskList(memberTasks.slice(0, 5))}</div>{memberTasks.length > 5 && <button className="text-button" onClick={() => { setMode('people'); setQuery(memberName(member)) }}>View all tasks <ArrowUpRight size={14} /></button>}</section> })}{!members.length && <EmptyState text="No team members yet." />}</div>}{mode === 'status' && <div className="team-board-columns">{statuses.map(([value, label]) => <section className="team-board-column" key={value}><div className="team-column-heading"><h2>{label}</h2><span>{filtered.filter(task => task.status === value).length}</span></div><div className="team-task-list">{taskList(filtered.filter(task => task.status === value))}</div></section>)}</div>}{mode === 'priority' && <div className="team-board-columns">{priorities.map(value => <section className="team-board-column" key={value}><div className="team-column-heading"><h2>{value}</h2><span>{filtered.filter(task => task.priority === value).length}</span></div><div className="team-task-list">{taskList(filtered.filter(task => task.priority === value))}</div></section>)}</div>}<section className="team-access-panel"><div className="today-panel-heading"><div><h2>People & access</h2><p>Manage workspace membership and pending invitations.</p></div></div>{members.map(member => <div className="team-access-row" key={member.id}><Avatar name={memberName(member)} avatarUrl={member.avatar_url} presence={member.presence} small /><div><strong>{memberName(member)}</strong><span>{member.email}</span></div>{canManageMembers && member.role !== 'owner' ? <><select value={member.role} onChange={event => onUpdateMemberRole(member, event.target.value)} aria-label={`Change role for ${member.email}`}><option value="member">Member</option><option value="manager">Manager</option></select><Button variant="ghost" size="icon-sm" onClick={() => onRemoveMember(member)} aria-label={`Remove ${member.email}`}><X size={14} /></Button></> : <em>{member.role}</em>}</div>)}{invitations.filter(item => item.status === 'pending').map(invitation => <div className="team-access-row" key={`invite-${invitation.id}`}><span className="invite-dot" /><div><strong>{invitation.email}</strong><span>Invited as {invitation.role}</span></div><em>Pending</em>{canManageMembers && <Button variant="ghost" size="icon-sm" onClick={() => onCancelInvitation(invitation)} aria-label={`Cancel invitation for ${invitation.email}`}><X size={14} /></Button>}</div>)}</section></section>
}

function MyTasksView({ tasks, currentUserId, currentUserName, projects, buckets, onAddTask, onOpenTask, onComplete, onStatusChange, onDelete, canManageTasks }) {
  const today = toDateKey(new Date())
  const [view, setView] = useState('all')
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [project, setProject] = useState('all')
  const [bucket, setBucket] = useState('all')
  const [sort, setSort] = useState('priority')
  const [query, setQuery] = useState('')
  const mine = tasks.filter(task => String(task.assignee_id || '') === String(currentUserId) || (!task.assignee_id && task.member === currentUserName))
  const isOpen = task => task.status !== 'done'
  const overdue = task => Boolean(task.due_date && task.due_date < today && isOpen(task))
  const dueToday = task => task.due_date === today && isOpen(task)
  const counts = { all: mine.filter(isOpen).length, today: mine.filter(dueToday).length, upcoming: mine.filter(task => task.due_date > today && isOpen(task)).length, overdue: mine.filter(overdue).length, blocked: mine.filter(task => task.status === 'blocked').length, completed: mine.filter(task => task.status === 'done').length }
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }
  const visible = mine.filter(task => {
    const text = [task.title, task.description, task.tag, task.bucket, ...(task.labels || [])].filter(Boolean).join(' ').toLowerCase()
    const matchesView = view === 'all' ? isOpen(task) : view === 'today' ? dueToday(task) : view === 'upcoming' ? Boolean(task.due_date && task.due_date > today && isOpen(task)) : view === 'overdue' ? overdue(task) : view === 'blocked' ? task.status === 'blocked' : task.status === 'done'
    return matchesView && (status === 'all' || task.status === status) && (priority === 'all' || task.priority === priority) && (project === 'all' || String(task.project_id || '') === project) && (bucket === 'all' || task.bucket === bucket) && (!query.trim() || text.includes(query.trim().toLowerCase()))
  }).sort((a, b) => {
    if (sort === 'due') return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
    if (sort === 'recent') return String(b.completed_at || '').localeCompare(String(a.completed_at || '')) || b.id - a.id
    return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || a.id - b.id
  })
  const groups = view === 'all' ? [{ label: 'Active work', items: visible }] : [{ label: view === 'completed' ? 'Completed' : view[0].toUpperCase() + view.slice(1), items: visible }]
  const viewTabs = [['all', 'Inbox'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['blocked', 'Blocked'], ['completed', 'Completed']]
  return <section className="workspace-view my-tasks-view"><WorkspaceViewHeading title="My tasks" subtitle="A focused queue of work assigned to you." action="Add task" onAction={onAddTask} /><div className="my-task-summary">{viewTabs.slice(0, 4).map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}><strong>{counts[key]}</strong><span>{label}</span></button>)}</div><div className="my-task-toolbar"><div className="my-task-tabs">{viewTabs.map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}<span>{counts[key]}</span></button>)}</div><div className="my-task-filters"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search my tasks" aria-label="Search my tasks" /><select value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select><select value={priority} onChange={event => setPriority(event.target.value)} aria-label="Filter by priority"><option value="all">All priorities</option>{['urgent', 'high', 'normal', 'low'].map(value => <option key={value} value={value}>{value}</option>)}</select><select value={project} onChange={event => setProject(event.target.value)} aria-label="Filter by project"><option value="all">All projects</option>{projects.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}</select><select value={bucket} onChange={event => setBucket(event.target.value)} aria-label="Filter by bucket"><option value="all">All buckets</option>{buckets.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select><select value={sort} onChange={event => setSort(event.target.value)} aria-label="Sort tasks"><option value="priority">Sort: Priority</option><option value="due">Sort: Due date</option><option value="recent">Sort: Recently completed</option></select></div></div><div className="my-task-results">{groups.map(group => <section key={group.label} className="my-task-group"><div className="my-task-group-heading"><h2>{group.label}</h2><span>{group.items.length}</span></div>{group.items.length ? group.items.map(task => <article className={`my-task-row ${task.status} ${overdue(task) ? 'overdue' : ''}`} key={task.id}><button type="button" className={`check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => onComplete(task.id)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}>{task.status === 'done' && <Check size={12} />}</button><div className="my-task-row-copy"><button type="button" onClick={() => onOpenTask(task)}>{task.title}</button><span>{task.tag || 'General'} · {task.bucket || 'Backlog'}{task.due_date ? ` · Due ${task.due_date}` : ' · No due date'}</span></div><span className={`my-task-priority ${task.priority}`}>{task.priority}</span><select value={task.status === 'in progress' ? 'in progress' : task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select>{canManageTasks && <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(task.id)} aria-label={`Archive ${task.title}`} title="Archive task"><Archive size={14} /></Button>}</article>) : <div className="my-task-empty"><CheckCircle2 size={18} /><p>{view === 'overdue' ? 'No overdue work.' : view === 'completed' ? 'No completed tasks yet.' : 'Nothing in this view.'}</p>{view === 'all' && <button className="text-button" onClick={onAddTask}>Add your first task <ArrowUpRight size={14} /></button>}</div>}</section>)}</div></section>
}

function ProjectProgress({ project, tasks }) {
  const projectTasks = tasks.filter(task => String(task.project_id || '') === String(project.id))
  const completedTasks = projectTasks.filter(task => task.status === 'done').length
  const completionPercent = projectTasks.length ? Math.round((completedTasks / projectTasks.length) * 100) : 0

  return <div className="project-progress" aria-label={`${completedTasks} of ${projectTasks.length} project tasks completed`}><div className="project-progress-label"><span>{projectTasks.length ? `${completedTasks} of ${projectTasks.length} tasks complete` : 'No tasks linked yet'}</span><strong>{completionPercent}%</strong></div><div className="project-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={completionPercent}><span style={{ width: `${completionPercent}%` }} /></div></div>
}

function ProjectRiskIssuePanel({ projects, workspaceId, hidden = false }) {
  const [projectId, setProjectId] = useState(() => projects[0]?.id || '')
  const [records, setRecords] = useState([])
  const [activeTab, setActiveTab] = useState('risk')
  const [modalOpen, setModalOpen] = useState(false)
  const [kind, setKind] = useState('risk')
  const [form, setForm] = useState({ title: '', detail: '', severity: 'medium', owner: '', due: '' })
  useEffect(() => { if (!projectId && projects[0]) setProjectId(projects[0].id) }, [projects, projectId])
  useEffect(() => {
    if (!workspaceId || !projectId) return setRecords([])
    fetch(`/api/workspaces/${workspaceId}/risks-issues/?project_id=${projectId}`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => readJsonResponse(response, 'Risk and issue records could not be loaded.').then(data => ({ response, data })))
      .then(({ response, data }) => { if (!response.ok) throw new Error(data.error); setRecords(data.records || []) })
      .catch(error => toast.error(error.message || 'Risk and issue records could not be loaded.'))
  }, [workspaceId, projectId])
  useEffect(() => {
    const selectRegisterTab = event => {
      if (event.detail === 'risk' || event.detail === 'issue') setActiveTab(event.detail)
    }
    window.addEventListener('project-register:tab', selectRegisterTab)
    return () => window.removeEventListener('project-register:tab', selectRegisterTab)
  }, [])
  const items = records
  const openAddModal = () => { setKind(activeTab); setModalOpen(true) }
  const addRecord = async event => {
    event.preventDefault()
    if (!projectId || !form.title.trim()) return
    const response = await fetch(`/api/workspaces/${workspaceId}/risks-issues/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ project_id: projectId, kind, title: form.title.trim(), detail: form.detail.trim(), severity: form.severity, owner: form.owner.trim(), due: form.due }) })
    const data = await readJsonResponse(response, 'Risk or issue could not be added.')
    if (!response.ok) return toast.error(data.error || 'Risk or issue could not be added.')
    setRecords(current => [...current, data.record])
    setForm({ title: '', detail: '', severity: 'medium', owner: '', due: '' })
    setActiveTab(kind)
    setModalOpen(false)
    toast.success(`${kind === 'risk' ? 'Risk' : 'Issue'} added.`)
  }
  const updateStatus = async (id, status) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/risks-issues/${id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ status }) })
    const data = await readJsonResponse(response, 'Status could not be updated.')
    if (!response.ok) return toast.error(data.error || 'Status could not be updated.')
    setRecords(current => current.map(item => item.id === id ? data.record : item))
    toast.success('Status updated.')
  }
  const remove = async id => {
    const record = items.find(item => item.id === id)
    const response = await fetch(`/api/workspaces/${workspaceId}/risks-issues/${id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) } })
    if (!response.ok) return toast.error('Risk or issue could not be archived.')
    setRecords(current => current.filter(item => item.id !== id))
    toast.success(`${record?.kind === 'issue' ? 'Issue' : 'Risk'} deleted.`)
  }
  const risks = items.filter(item => item.kind === 'risk')
  const issues = items.filter(item => item.kind === 'issue')
  const visibleItems = activeTab === 'risk' ? risks : issues
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [activeTab, projectId])
  const pageSize = 20
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize))
  const pageItems = visibleItems.slice((page - 1) * pageSize, page * pageSize)
  const statuses = activeTab === 'risk' ? [['open', 'Open'], ['mitigated', 'Mitigated'], ['closed', 'Closed']] : [['open', 'Open'], ['in progress', 'In progress'], ['resolved', 'Resolved']]

  if (hidden) return null

  return <section className="project-risk-issues">
    <div className="project-risk-issues-heading">
      <div><p className="eyebrow">Project controls</p><h2>Risk register & issue log</h2><p>Track threats, decisions, and problems before they become delivery surprises.</p></div>
      <select value={projectId} onChange={event => setProjectId(event.target.value)} aria-label="Select project for risk and issue tracking">{projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">No projects yet</option>}</select>
    </div>
    <Card className="project-register-card">
      <div className="project-register-toolbar">
        <div className="project-register-tabs" role="tablist" aria-label="Project controls">
          <button type="button" role="tab" aria-selected={activeTab === 'risk'} className={activeTab === 'risk' ? 'active' : ''} onClick={() => setActiveTab('risk')}>Risk register <span>{risks.length}</span></button>
          <button type="button" role="tab" aria-selected={activeTab === 'issue'} className={activeTab === 'issue' ? 'active' : ''} onClick={() => setActiveTab('issue')}>Issue log <span>{issues.length}</span></button>
        </div>
        <button type="button" className="primary-button project-register-add" onClick={openAddModal} disabled={!projectId}><Plus size={15} /> Add new</button>
      </div>
      <div className="project-register-table-wrap">
        <table className="project-register-table">
          <thead><tr><th>{activeTab === 'risk' ? 'Risk' : 'Issue'}</th><th>Severity</th><th>Owner</th><th>Target date</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{visibleItems.length ? pageItems.map(item => <tr key={item.id}>
            <td><strong>{item.title}</strong><span>{item.detail || 'No description added.'}</span></td>
            <td><span className={`record-severity ${item.severity}`}>{item.severity}</span></td>
            <td>{item.owner || <span className="table-muted">Unassigned</span>}</td>
            <td>{item.due || <span className="table-muted">No date</span>}</td>
            <td><select value={item.status} onChange={event => updateStatus(item.id, event.target.value)} aria-label={`Set status for ${item.title}`}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
            <td><button type="button" className="inline-delete" onClick={() => remove(item.id)} aria-label={`Delete ${item.title}`}><X size={14} /></button></td>
          </tr>) : <tr><td className="project-register-empty" colSpan="6"><Brush size={22} /><strong>No {activeTab === 'risk' ? 'risks' : 'issues'} yet</strong><span>{activeTab === 'risk' ? 'Add a risk to begin tracking possible threats.' : 'Add an issue to track an active project problem.'}</span></td></tr>}</tbody>
        </table>
      <div className="planner-pagination"><span>{visibleItems.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visibleItems.length)} of ${visibleItems.length}` : '0 records'}</span><div><button type="button" disabled={page === 1} onClick={() => setPage(current => current - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button><span>Page {page} of {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => setPage(current => current + 1)} aria-label="Next page"><ChevronRight size={15} /></button></div></div>
      </div>
    </Card>
    {modalOpen && <div className="modal-backdrop" onMouseDown={() => setModalOpen(false)}><form className="modal project-record-modal" role="dialog" aria-modal="true" aria-labelledby="project-record-modal-title" onSubmit={addRecord} onMouseDown={event => event.stopPropagation()}>
      <div className="modal-heading"><div><p className="eyebrow">Project controls</p><h2 id="project-record-modal-title">Add a new record</h2><p className="modal-subtitle">Capture a risk or an active issue for this project.</p></div><button type="button" className="close-button" onClick={() => setModalOpen(false)} aria-label="Close"><X size={18} /></button></div>
      <div className="record-form-toggle" role="group" aria-label="Record type"><button type="button" className={kind === 'risk' ? 'active' : ''} onClick={() => setKind('risk')}>Risk</button><button type="button" className={kind === 'issue' ? 'active' : ''} onClick={() => setKind('issue')}>Issue</button></div>
      <label>{kind === 'risk' ? 'Risk title' : 'Issue title'}<input autoFocus value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder={kind === 'risk' ? 'What could affect delivery?' : 'What problem needs resolving?'} required /></label>
      <label>Description<textarea value={form.detail} onChange={event => setForm({ ...form, detail: event.target.value })} placeholder={kind === 'risk' ? 'Describe the risk and planned mitigation' : 'Describe the issue and next action'} /></label>
      <div className="record-form-grid"><label>Severity<select value={form.severity} onChange={event => setForm({ ...form, severity: event.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></select></label><label>Owner<input value={form.owner} onChange={event => setForm({ ...form, owner: event.target.value })} placeholder="Name or team" /></label><DateField label="Target date" value={form.due} onChange={event => setForm({ ...form, due: event.target.value })} /></div>
      <button type="submit" className="primary-button modal-submit">Add {kind}</button>
    </form></div>}
  </section>
}

function ClockInCard({ shifts, currentUserId, presence, onSubmitShift, onChangePresence }) {
  const [pending, setPending] = useState('')
  const [tick, setTick] = useState(() => Date.now())
  const mine = shifts.filter(shift => String(shift.user_id) === String(currentUserId))
  const openShift = mine.find(shift => shift.is_open) || null
  const closedToday = mine.filter(shift => !shift.is_open)
  const onBreak = Boolean(openShift?.is_on_break)

  useEffect(() => {
    if (!openShift) return undefined
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [openShift?.id])

  // break_seconds from the API is banked time only, so a break still running is added from break_started_at here.
  const runningBreakSeconds = openShift?.break_started_at ? Math.max(0, Math.floor((tick - new Date(openShift.break_started_at).getTime()) / 1000)) : 0
  // The headline timer tracks the shift in progress only, so clocking out returns it to zero.
  const shiftSeconds = openShift
    ? Math.max(0, Math.floor((tick - new Date(openShift.started_at).getTime()) / 1000) - openShift.break_seconds - runningBreakSeconds)
    : 0
  const shiftBreakSeconds = (openShift?.break_seconds || 0) + runningBreakSeconds
  const earlierSeconds = closedToday.reduce((total, shift) => total + shift.worked_seconds, 0)
  const dayTotalSeconds = earlierSeconds + shiftSeconds
  const breakPlanSeconds = (openShift?.break_plan_minutes || 0) * 60
  const breakRemaining = breakPlanSeconds ? breakPlanSeconds - runningBreakSeconds : 0
  const breakOverrun = Boolean(breakPlanSeconds) && breakRemaining <= 0

  const run = async (action, minutes = 0) => {
    setPending(action)
    try {
      await onSubmitShift(action, minutes)
    } finally {
      setPending('')
    }
  }

  const stateLabel = !openShift ? 'Clocked out' : onBreak ? 'On break' : 'Clocked in'
  const headline = openShift
    ? `Started ${formatShiftClock(openShift.started_at)}`
    : closedToday.length
      ? `Last shift ended ${formatShiftClock(closedToday[0].ended_at)}`
      : 'Not started yet'
  return <div className="today-panel today-clock-panel">
    <div className="today-panel-heading">
      <div><h2>Time clock</h2><p>{headline}</p></div>
      <span className={`clock-state clock-state-${openShift ? (onBreak ? 'break' : 'active') : 'idle'}`}><Clock3 size={14} /> {stateLabel}</span>
    </div>
    <strong className="today-clock-timer" role="timer" aria-live="off" aria-label={`Current shift ${formatShiftDuration(shiftSeconds)}`}>{formatShiftDuration(shiftSeconds)}</strong>
    <span className="today-muted">
      {dayTotalSeconds ? `Today ${formatShiftDuration(dayTotalSeconds)}` : 'Nothing logged today'}
      {shiftBreakSeconds ? ` · Breaks ${formatShiftDuration(shiftBreakSeconds)}` : ''}
    </span>
    {onBreak && <p className={`clock-break-timer${breakOverrun ? ' is-over' : ''}`}>
      {breakPlanSeconds
        ? breakOverrun
          ? `${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break is over by ${formatShiftDuration(-breakRemaining)}`
          : `${formatShiftDuration(breakRemaining)} left of your ${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break`
        : `Break running ${formatShiftDuration(runningBreakSeconds)}`}
    </p>}
    <div className="today-clock-actions">
      {!openShift && <Button size="sm" disabled={Boolean(pending)} onClick={() => run('clock_in')}><Play size={15} /> Clock in</Button>}
      {openShift && onBreak && <Button size="sm" disabled={Boolean(pending)} onClick={() => run('end_break')}><Play size={15} /> Resume</Button>}
      {openShift && !onBreak && BREAK_PRESETS.map(minutes => <Button key={minutes} variant="outline" size="sm" disabled={Boolean(pending)} onClick={() => run('start_break', minutes)}><Pause size={15} /> {BREAK_PRESET_LABEL[minutes]} break</Button>)}
      {openShift && <Button variant="outline" size="sm" disabled={Boolean(pending)} onClick={() => run('clock_out')}><Square size={15} /> Clock out</Button>}
    </div>
    <label className="today-status-select">
      <span>Status</span>
      <span className="presence-select">
        <span className={`presence-dot presence-${presence}`} />
        <select value={presence} onChange={event => onChangePresence(event.target.value)} aria-label="Set your status">
          {PRESENCE_OPTIONS.map(option => <option key={option} value={option}>{PRESENCE_LABEL[option]}</option>)}
        </select>
      </span>
    </label>
  </div>
}


function ProjectStakeholderResourcePanel({ project, workspaceId, canManage }) {
  const [resources, setResources] = useState([])
  const [stakeholders, setStakeholders] = useState([])
  const [resourceForm, setResourceForm] = useState({ name: '', resource_type: 'person', availability: '', notes: '' })
  const [stakeholderForm, setStakeholderForm] = useState({ name: '', role: '', email: '', influence: 'medium', interest: 'medium', notes: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    if (!workspaceId || !project?.id) return
    setLoading(true)
    setError('')
    try {
      const [resourceResponse, stakeholderResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/resources/`, { credentials: 'include' }),
        fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/`, { credentials: 'include' }),
      ])
      const [resourceData, stakeholderData] = await Promise.all([resourceResponse.json(), stakeholderResponse.json()])
      if (!resourceResponse.ok || !stakeholderResponse.ok) throw new Error(resourceData.error || stakeholderData.error || 'Project management data could not be loaded.')
      setResources(resourceData.resources || [])
      setStakeholders(stakeholderData.stakeholders || [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [workspaceId, project?.id])
  const addResource = async event => {
    event.preventDefault()
    if (!resourceForm.name.trim()) return
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/resources/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(resourceForm) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Resource could not be added.')
    setResources(current => [...current, data.resource])
    setResourceForm({ name: '', resource_type: 'person', availability: '', notes: '' })
  }
  const addStakeholder = async event => {
    event.preventDefault()
    if (!stakeholderForm.name.trim()) return
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(stakeholderForm) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Stakeholder could not be added.')
    setStakeholders(current => [...current, data.stakeholder])
    setStakeholderForm({ name: '', role: '', email: '', influence: 'medium', interest: 'medium', notes: '' })
  }
  const archiveResource = async resource => {
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/resources/${resource.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (response.ok) setResources(current => current.filter(item => item.id !== resource.id))
  }
  const archiveStakeholder = async stakeholder => {
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/${stakeholder.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (response.ok) setStakeholders(current => current.filter(item => item.id !== stakeholder.id))
  }
  return <section className="project-stakeholder-resource">
    <div className="project-risk-issues-heading"><div><p className="eyebrow">Project delivery</p><h2>Resources & stakeholders</h2><p>Track who is involved and what is available for delivery.</p></div></div>
    {loading && <p className="workspace-inline-status" role="status">Loading project management data...</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="project-stakeholder-resource-grid">
      <Card className="project-stakeholder-card">
        <div className="drawer-section-heading"><h3>Resources</h3><span>{resources.length}</span></div>
        {canManage && <form className="project-resource-form" onSubmit={addResource}><label>Name<input value={resourceForm.name} onChange={event => setResourceForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Senior designer" required /></label><label>Type<select value={resourceForm.resource_type} onChange={event => setResourceForm(current => ({ ...current, resource_type: event.target.value }))}><option value="person">Person</option><option value="equipment">Equipment</option><option value="budget">Budget</option><option value="other">Other</option></select></label><label>Availability<input value={resourceForm.availability} onChange={event => setResourceForm(current => ({ ...current, availability: event.target.value }))} placeholder="e.g. 50% this sprint" /></label><button className="secondary-button" type="submit"><Plus size={15} /> Add resource</button></form>}
        <div className="project-stakeholder-list">{resources.map(resource => <div className="project-stakeholder-row" key={resource.id}><div><strong>{resource.name}</strong><span>{resource.resource_type} · {resource.availability || 'No availability'}</span></div>{canManage && <button type="button" className="inline-delete" onClick={() => archiveResource(resource)} aria-label={`Archive ${resource.name}`}><X size={14} /></button>}</div>)}</div>
      </Card>
      <Card className="project-stakeholder-card">
        <div className="drawer-section-heading"><h3>Stakeholders</h3><span>{stakeholders.length}</span></div>
        {canManage && <form className="project-resource-form" onSubmit={addStakeholder}><label>Name<input value={stakeholderForm.name} onChange={event => setStakeholderForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. Finance Director" required /></label><label>Role<input value={stakeholderForm.role} onChange={event => setStakeholderForm(current => ({ ...current, role: event.target.value }))} placeholder="Approver" /></label><label>Email<input value={stakeholderForm.email} onChange={event => setStakeholderForm(current => ({ ...current, email: event.target.value }))} placeholder="person@company.com" /></label><div className="modal-grid"><label>Influence<select value={stakeholderForm.influence} onChange={event => setStakeholderForm(current => ({ ...current, influence: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label>Interest<select value={stakeholderForm.interest} onChange={event => setStakeholderForm(current => ({ ...current, interest: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div><button className="secondary-button" type="submit"><Plus size={15} /> Add stakeholder</button></form>}
        <div className="project-stakeholder-list">{stakeholders.map(stakeholder => <div className="project-stakeholder-row" key={stakeholder.id}><div><strong>{stakeholder.name}</strong><span>{stakeholder.role || 'No role'} · {stakeholder.email || 'No email'} · Influence {stakeholder.influence} · Interest {stakeholder.interest}</span></div>{canManage && <button type="button" className="inline-delete" onClick={() => archiveStakeholder(stakeholder)} aria-label={`Archive ${stakeholder.name}`}><X size={14} /></button>}</div>)}</div>
      </Card>
    </div>
  </section>
}
function TodayDashboard({ today, todayLabel, currentUserName, currentUserId, currentUserPresence, workspaceName, tasks, events, followUps, checkIns, workShifts, members, canManageMembers, onAddTask, onOpenTask, onNavigate, onComplete, onStatusChange, onSubmitShift, onChangePresence }) {
  const isOpen = task => task.status !== 'done'
  const dueToday = tasks.filter(task => task.due_date === today && isOpen(task))
  const overdue = tasks.filter(task => task.due_date && task.due_date < today && isOpen(task))
  const blocked = tasks.filter(task => task.status === 'blocked' && isOpen(task))
  const completedToday = tasks.filter(task => task.status === 'done' && task.completed_at && toDateKey(task.completed_at) === today)
  const myTasks = tasks.filter(task => String(task.assignee_id || '') === String(members.find(member => member.email === currentUserName)?.id || '') || task.member === currentUserName)
  const myQueue = myTasks.filter(isOpen).sort((a, b) => {
    const rank = task => task.due === 'Overdue' ? 0 : task.priority === 'urgent' ? 1 : task.due_date === today ? 2 : task.status === 'in progress' ? 3 : 4
    return rank(a) - rank(b) || (a.due_date || '9999').localeCompare(b.due_date || '9999')
  }).slice(0, 8)
  const todaysEvents = events.filter(event => toDateKey(event.start_at) === today).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)).slice(0, 4)
  const dueFollowUps = followUps.filter(item => item.status !== 'completed' && (!item.due_date || item.due_date <= today)).slice(0, 4)
  const openExceptions = [...blocked, ...tasks.filter(task => !task.assignee_id && isOpen(task)).filter(task => !blocked.includes(task)), ...overdue.filter(task => !blocked.includes(task))].filter((task, index, list) => list.findIndex(item => item.id === task.id) === index).slice(0, 6)
  const checkInsToday = checkIns.filter(item => item.date === today || (item.created_at && toDateKey(item.created_at) === today)).length
  const greetingHour = new Date().getHours()
  const greeting = greetingHour < 12 ? 'Good morning' : greetingHour < 18 ? 'Good afternoon' : 'Good evening'
  const taskLabel = task => task.due === 'Overdue' ? 'Overdue' : task.due_date === today ? 'Due today' : task.status === 'in progress' ? 'In progress' : task.priority
  return <section className="today-dashboard">
    <section className="today-hero"><div><p className="eyebrow">{todayLabel}</p><h1>{greeting}, {currentUserName.split(' ')[0]}</h1><p className="subtitle">Here is what needs your attention in {workspaceName}.</p></div><div className="today-actions"><Button onClick={onAddTask}><Plus size={17} /> Add task</Button><Button variant="outline" size="sm" className="today-action-secondary" onClick={() => onNavigate('Calendar')}><CalendarDays size={16} /> Add event</Button><Button variant="outline" size="sm" className="today-action-secondary" onClick={() => onNavigate('Check-ins')}><MessageSquare size={16} /> Check in</Button></div></section>
    <section className="today-metrics"><button onClick={() => onNavigate('My tasks')}><strong>{dueToday.length}</strong><span>Due today</span></button><button className={overdue.length ? 'attention' : ''} onClick={() => onNavigate('My tasks')}><strong>{overdue.length}</strong><span>Overdue</span></button><button className={blocked.length ? 'attention' : ''} onClick={() => onNavigate('Team board')}><strong>{blocked.length}</strong><span>Blocked</span></button><button onClick={() => onNavigate('My tasks')}><strong>{completedToday.length}</strong><span>Completed today</span></button></section>
    <div className="today-grid"><div className="today-panel my-day-panel"><div className="today-panel-heading"><div><h2>My day</h2><p>Prioritized work for you</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate('My tasks')}>View all <ArrowUpRight size={14} /></Button></div>{myQueue.length ? <div className="today-task-list">{myQueue.map(task => <article className={`today-task-row ${task.status}`} key={task.id}><button className={`check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => onComplete(task.id)} aria-label={`Complete ${task.title}`} /><div className="today-task-copy"><button onClick={() => onOpenTask(task)}>{task.title}</button><span>{taskLabel(task)}{task.tag && ` · ${task.tag}`}</span></div><select value={task.status === 'in progress' ? 'in_progress' : task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select></article>)}</div> : <div className="today-empty"><CheckCircle2 size={20} /><p>Your day is clear.</p><Button variant="ghost" size="sm" onClick={onAddTask}>Plan a task <ArrowUpRight size={14} /></Button></div>}</div>
      <aside className="today-side-stack"><ClockInCard shifts={workShifts} currentUserId={currentUserId} presence={currentUserPresence} onSubmitShift={onSubmitShift} onChangePresence={onChangePresence} /><div className="today-panel"><div className="today-panel-heading"><div><h2>Schedule</h2><p>Events and deadlines today</p></div><Button variant="ghost" size="icon-sm" onClick={() => onNavigate('Calendar')} aria-label="Open calendar"><ArrowUpRight size={15} /></Button></div>{todaysEvents.length ? todaysEvents.map(event => <div className="today-event-row" key={event.id}><time>{new Date(event.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><div><strong>{event.title}</strong><span>{event.event_type || 'Event'}</span></div></div>) : <p className="today-muted">No events scheduled today.</p>}</div><div className="today-panel"><div className="today-panel-heading"><div><h2>Follow-ups</h2><p>Items needing a response</p></div><Button variant="ghost" size="icon-sm" onClick={() => onNavigate('Follow-up')} aria-label="Open follow-ups"><ArrowUpRight size={15} /></Button></div>{dueFollowUps.length ? dueFollowUps.map(item => <button className="today-followup-row" key={item.id} onClick={() => onNavigate('Follow-up')}><span className="priority-dot" /><span>{item.note}</span><small>{item.due_date || 'No due date'}</small></button>) : <p className="today-muted">No follow-ups due.</p>}</div></aside>
    </div><div className="today-lower-grid"><div className="today-panel"><div className="today-panel-heading"><div><h2>Team attention</h2><p>{canManageMembers ? 'Exceptions worth acting on' : 'Work that may need help'}</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate('Team board')}>Open board <ArrowUpRight size={14} /></Button></div>{openExceptions.length ? <div className="today-exception-list">{openExceptions.map(task => <button key={task.id} onClick={() => onOpenTask(task)}><span className={`status-dot ${task.status}`} /><span>{task.title}</span><small>{task.status === 'blocked' ? 'Blocked' : !task.assignee_id ? 'Unassigned' : 'Overdue'}</small></button>)}</div> : <p className="today-muted">No team exceptions right now.</p>}</div><div className="today-panel today-checkin-panel"><div className="today-panel-heading"><div><h2>Check-ins</h2><p>Keep the team aligned</p></div><Hash size={17} /></div><strong className="today-checkin-count">{checkInsToday} of {members.length || 1}</strong><span className="today-muted">check-ins received today</span><Button variant="outline" size="sm" onClick={() => onNavigate('Check-ins')}>{checkInsToday ? 'View check-ins' : 'Start check-in'}</Button></div></div>
  </section>
}

export { TeamBoardView, MyTasksView, ProjectProgress, ProjectRiskIssuePanel, ClockInCard, ProjectStakeholderResourcePanel, TodayDashboard }
