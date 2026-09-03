import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, GanttChartSquare, GripVertical, LayoutGrid, List, Archive, MoreHorizontal, Plus, Search } from 'lucide-react'
import { taskMatchesScope } from './WorkScopeSelector.jsx'

const statusLabel = { todo: 'To do', 'in progress': 'In progress', review: 'Review', blocked: 'Blocked', on_hold: 'On hold', cancelled: 'Cancelled', done: 'Done' }

function PlannerTaskCard({ task, buckets, canReorder, onOpen, onDelete, onMove, onStatusChange, onDropBefore, draggedTaskId, setDraggedTaskId, dropTaskId, setDropTaskId }) {
  const bucketIndex = buckets.findIndex(bucket => bucket.name === task.bucket)
  const moveTo = direction => {
    const target = buckets[bucketIndex + direction]
    if (target) onMove(task, target.name, 'end')
  }
  return <article
    className={`planner-task-card ${task.status} ${draggedTaskId === task.id ? 'is-dragging' : ''} ${dropTaskId === task.id && draggedTaskId !== task.id ? 'is-drop-target' : ''}`}
    draggable={canReorder}
    onDragStart={event => {
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('application/x-workspace-task', String(task.id))
      event.dataTransfer.setData('text/plain', `task:${task.id}`)
      setDraggedTaskId(task.id)
    }}
    onDragEnd={() => { setDraggedTaskId(null); setDropTaskId(null) }}
    onDragOver={event => { if (draggedTaskId) { event.preventDefault(); setDropTaskId(task.id) } }}
    onDrop={event => {
      const plainId = event.dataTransfer.getData('text/plain').replace(/^task:/, '')
      const taskId = draggedTaskId || Number(event.dataTransfer.getData('application/x-workspace-task') || plainId)
      if (taskId && taskId !== task.id) { event.preventDefault(); event.stopPropagation(); onDropBefore(taskId, task) }
      setDraggedTaskId(null)
      setDropTaskId(null)
    }}
  >
    <div className="planner-card-heading">
      <button type="button" className="planner-drag-handle" disabled={!canReorder} aria-label={`Drag ${task.title}`}><GripVertical size={15} /></button>
      <button type="button" className="planner-card-title" onClick={() => onOpen(task)}>{task.title}</button>
      {canReorder ? <button type="button" className="planner-card-menu" onClick={() => onDelete(task.id)} aria-label={`Archive ${task.title}`} title="Archive task"><Archive size={14} /></button> : <button type="button" className="planner-card-menu" onClick={() => onOpen(task)} aria-label={`Open ${task.title}`}><MoreHorizontal size={16} /></button>}
    </div>
    <div className="planner-card-meta">
      <span className={`planner-priority ${task.priority}`}>{task.priority}</span>
      <span>{task.tag || 'General'}</span>
      {onStatusChange && <select className={`status-select status-${task.status.replace(' ', '-')}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select>}
    </div>
    <div className="planner-card-footer">
      <span>{task.member || 'Unassigned'}</span>
      <span className={task.due === 'Overdue' ? 'overdue' : ''}>{task.due}</span>
    </div>
    {canReorder && <div className="planner-card-move" aria-label={`Move ${task.title}`}>
      <button type="button" onClick={() => onMove(task, task.bucket, 'up')} aria-label="Move up"><ArrowUp size={13} /></button>
      <button type="button" onClick={() => onMove(task, task.bucket, 'down')} aria-label="Move down"><ArrowDown size={13} /></button>
      <button type="button" onClick={() => moveTo(-1)} disabled={bucketIndex <= 0} aria-label="Move to previous bucket"><ArrowLeft size={13} /></button>
      <button type="button" onClick={() => moveTo(1)} disabled={bucketIndex < 0 || bucketIndex >= buckets.length - 1} aria-label="Move to next bucket"><ArrowRight size={13} /></button>
    </div>}
  </article>
}

export default function PlannerBoard({ buckets, tasks, members, projects = [], lookupValues = [], scopeMode = 'switch', searchQuery, onSearchChange, canManageTasks, canManageBuckets, currentUserId, onStatusChange, onOpenTask, onDeleteTask, onAddTask, onTaskMove, onBucketReorder, newBucketName, setNewBucketName, bucketSubmitting, bucketError, onCreateBucket, externalFilter = 'all', projectFilter = 'operations', onProjectFilterChange, newWorkstreamName, setNewWorkstreamName, workstreamSubmitting, workstreamError, onCreateWorkstream, onArchiveWorkstream, onArchiveBucket }) {
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [assignee, setAssignee] = useState('all')
  const [supporter, setSupporter] = useState('all')
  const [workstream, setWorkstream] = useState('all')
  const [phase, setPhase] = useState('all')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  const [draggedBucketId, setDraggedBucketId] = useState(null)
  const [dropBucketId, setDropBucketId] = useState(null)
  const [dropTaskId, setDropTaskId] = useState(null)
  const [view, setView] = useState('board')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState([])
  const [bulkStatus, setBulkStatus] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // externalFilter carries one filter token in from Reports drill-throughs and
  // saved views (main.jsx's plannerFilter) - it can name a status, a bucket, an
  // assignee ("mine" / "member:<id>" / "unassigned"), or "overdue"/"all".
  useEffect(() => {
    if (!externalFilter || externalFilter === 'all') {
      setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee('all')
      return
    }
    if (externalFilter === 'overdue') { setStatus('all'); setDueFilter('overdue'); setBucketFilter('all'); setAssignee('all'); return }
    if (externalFilter === 'unassigned') { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(''); return }
    if (externalFilter === 'mine') { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(String(currentUserId)); return }
    if (externalFilter.startsWith('member:')) { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(externalFilter.slice(7)); return }
    if (statusLabel[externalFilter]) { setStatus(externalFilter); setDueFilter('all'); setBucketFilter('all'); setAssignee('all'); return }
    if (buckets.some(bucket => bucket.name === externalFilter)) { setStatus('all'); setDueFilter('all'); setBucketFilter(externalFilter); setAssignee('all') }
    // buckets/currentUserId are read but deliberately excluded below: buckets is a
    // fresh array literal on every parent render (WorkspaceView rebuilds it inline),
    // and currentUserId is effectively static - including either would re-apply
    // externalFilter (wiping the user's own filter picks) on every 15s data poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFilter])
  const today = new Date().toISOString().slice(0, 10)
  const isOperations = scopeMode === 'operations' || (scopeMode === 'switch' && projectFilter === 'operations')
  const normalizedWorkstreams = useMemo(() => lookupValues.filter(value => value.kind === 'workstream' && value.is_active && (isOperations ? !value.project_id : projectFilter === 'all' ? Boolean(value.project_id) : (!value.project_id || String(value.project_id) === String(projectFilter)))).map(value => value.name), [lookupValues, isOperations, projectFilter])
  const workstreams = useMemo(() => [...new Set([...normalizedWorkstreams, ...tasks.filter(task => taskMatchesScope(task, projectFilter)).map(task => task.workstream).filter(Boolean)])].sort(), [normalizedWorkstreams, tasks, projectFilter])
  const phases = useMemo(() => [...new Set(tasks.map(task => task.phase || task.quarter).filter(Boolean))].sort(), [tasks])
  const visibleTasks = useMemo(() => tasks.filter(task => {
    const search = searchQuery.trim().toLowerCase()
    const supporterIds = (task.supporters || []).map(item => String(item.id ?? item.user_id ?? item))
    return (!search || [task.task_code, task.title, task.description, task.tag, task.member, task.workstream, task.phase, task.quarter, ...(task.labels || [])].filter(Boolean).join(' ').toLowerCase().includes(search))
      && (status === 'all' || task.status === status)
      && (priority === 'all' || task.priority === priority)
      && (assignee === 'all' || String(task.assignee_id || '') === assignee)
      && (supporter === 'all' || supporterIds.includes(supporter))
      && (workstream === 'all' || task.workstream === workstream)
      && (phase === 'all' || (task.phase || task.quarter) === phase)
      && taskMatchesScope(task, projectFilter)
      && (bucketFilter === 'all' || task.bucket === bucketFilter)
      && (!dateFrom || (task.due_date && task.due_date >= dateFrom))
      && (!dateTo || (task.due_date && task.due_date <= dateTo))
      && (dueFilter === 'all' || (dueFilter === 'overdue' && task.due_date && task.due_date < today && task.status !== 'done') || (dueFilter === 'today' && task.due_date === today) || (dueFilter === 'none' && !task.due_date))
  }), [tasks, searchQuery, status, priority, assignee, supporter, workstream, phase, bucketFilter, dueFilter, dateFrom, dateTo, projectFilter, today])

  const pageSize = 12
  const totalPages = Math.max(1, Math.ceil(visibleTasks.length / pageSize))
  const tableTasks = visibleTasks.slice((page - 1) * pageSize, page * pageSize)
  useEffect(() => { setPage(1); setSelectedIds([]) }, [searchQuery, status, priority, assignee, supporter, workstream, phase, bucketFilter, dueFilter, dateFrom, dateTo, projectFilter, view])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  const toggleSelected = id => setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  const pageIsSelected = tableTasks.length > 0 && tableTasks.every(task => selectedIds.includes(task.id))
  const togglePage = () => setSelectedIds(current => pageIsSelected ? current.filter(id => !tableTasks.some(task => task.id === id)) : [...new Set([...current, ...tableTasks.map(task => task.id)])])
  const applyBulkStatus = async () => {
    if (!bulkStatus || !selectedIds.length) return
    await Promise.all(selectedIds.map(id => onStatusChange(id, bulkStatus)))
    setSelectedIds([])
    setBulkStatus('')
  }

  const orderedFor = bucket => visibleTasks.filter(task => task.bucket === bucket).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id)
  const allOrderedFor = bucket => tasks.filter(task => task.bucket === bucket).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id)
  const persistMove = (taskId, targetBucket, targetIndex) => {
    const next = Object.fromEntries(buckets.map(bucket => [bucket.name, allOrderedFor(bucket.name).filter(task => task.id !== taskId)]))
    const movedTask = tasks.find(task => task.id === taskId)
    if (!movedTask || !next[targetBucket]) return
    next[targetBucket].splice(Math.max(0, Math.min(targetIndex, next[targetBucket].length)), 0, movedTask)
    const columns = buckets.map(bucket => ({ bucket: bucket.name, task_ids: next[bucket.name].map(task => task.id) }))
    onTaskMove(canManageTasks ? columns : columns.map(column => ({ ...column, task_ids: column.task_ids.filter(id => { const item = tasks.find(task => task.id === id); return item && String(item.assignee_id || '') === String(currentUserId) }) })).filter(column => column.task_ids.length))
  }
  const moveTask = (task, targetBucket, placement) => {
    const target = allOrderedFor(targetBucket).filter(item => item.id !== task.id)
    const currentIndex = allOrderedFor(task.bucket).findIndex(item => item.id === task.id)
    const targetIndex = placement === 'up' ? Math.max(0, currentIndex - 1) : placement === 'down' ? currentIndex + 1 : target.length
    persistMove(task.id, targetBucket, targetIndex)
  }
  const dropBefore = (taskId, targetTask) => {
    const target = allOrderedFor(targetTask.bucket).filter(task => task.id !== taskId)
    persistMove(taskId, targetTask.bucket, target.findIndex(task => task.id === targetTask.id))
  }
  const addToBucket = bucket => {
    sessionStorage.setItem('workspace-new-task-bucket', bucket)
    onAddTask()
  }
  const persistedBuckets = buckets.filter(bucket => typeof bucket.id === 'number')
  const activeWorkstreams = lookupValues.filter(value => value.kind === 'workstream' && value.is_active && (isOperations ? !value.project_id : Boolean(value.project_id)))
  const moveBucket = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    const next = persistedBuckets.map(bucket => bucket.id)
    const sourceIndex = next.indexOf(Number(sourceId))
    const targetIndex = next.indexOf(Number(targetId))
    if (sourceIndex < 0 || targetIndex < 0 || persistedBuckets[targetIndex]?.name === 'Backlog') return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next)
  }
  const nudgeBucket = (bucketId, direction) => {
    const next = persistedBuckets.map(bucket => bucket.id)
    const sourceIndex = next.indexOf(bucketId)
    const targetIndex = sourceIndex + direction
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= next.length || persistedBuckets[targetIndex]?.name === 'Backlog') return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next)
  }
  const ganttSource = visibleTasks.filter(task => task.status !== 'done' || task.due_date)
  const toDay = value => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date }
  const ganttStart = ganttSource.length ? new Date(Math.min(...ganttSource.map(task => toDay(task.created_at || task.due_date || today).getTime()))) : toDay(today)
  const ganttEnd = ganttSource.length ? new Date(Math.max(...ganttSource.map(task => toDay(task.due_date || task.created_at || today).getTime()))) : new Date(ganttStart)
  if (ganttEnd <= ganttStart) ganttEnd.setDate(ganttStart.getDate() + 7)
  else ganttEnd.setDate(ganttEnd.getDate() + 1)
  const ganttSpan = Math.max(1, Math.round((ganttEnd - ganttStart) / 86400000))
  const ganttDays = Array.from({ length: Math.min(ganttSpan, 90) }, (_, index) => { const day = new Date(ganttStart); day.setDate(day.getDate() + index); return day })
  const ganttContent = <div className="planner-gantt" style={{ '--gantt-days': ganttDays.length }}><div className="planner-gantt-header"><div className="planner-gantt-task-label">Task</div><div className="planner-gantt-timeline">{ganttDays.map(day => <span key={day.toISOString()} className={toDay(today).getTime() === day.getTime() ? 'is-today' : ''}>{day.getDate() === 1 || day.getTime() === ganttStart.getTime() ? day.toLocaleDateString([], { month: 'short', day: 'numeric' }) : day.getDate()}</span>)}</div></div>{buckets.flatMap(bucket => ganttSource.filter(task => task.bucket === bucket.name).map(task => { const taskStart = toDay(task.created_at || task.due_date || today); const taskEnd = toDay(task.due_date || task.created_at || today); const left = Math.max(0, Math.min(100, ((taskStart - ganttStart) / 86400000 / ganttDays.length) * 100)); const width = Math.max(1.5, Math.min(100 - left, (((taskEnd - taskStart) / 86400000) + 1) / ganttDays.length * 100)); return <div className="planner-gantt-row" key={task.id}><div className="planner-gantt-task-label"><span>{bucket.name}</span><button type="button" onClick={() => onOpenTask(task)}>{task.title}</button></div><div className="planner-gantt-track">{ganttDays.map(day => <i key={day.toISOString()} className={toDay(today).getTime() === day.getTime() ? 'is-today' : ''} />)}<button type="button" className={`planner-gantt-bar ${task.status} ${task.priority}`} style={{ left: `${left}%`, width: `${width}%` }} onClick={() => onOpenTask(task)} title={`${task.title}${task.due_date ? ` · Due ${task.due_date}` : ''}`}>{task.title}</button></div></div> }))}{!ganttSource.length && <div className="planner-empty">No scheduled tasks to display.</div>}</div>

  const tableContent = <div className="planner-table-shell">
    {selectedIds.length > 0 && <div className="planner-bulk-bar" role="region" aria-label="Bulk task actions"><strong>{selectedIds.length} selected</strong><select value={bulkStatus} onChange={event => setBulkStatus(event.target.value)} aria-label="Bulk status"><option value="">Choose status…</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" className="secondary-button" disabled={!bulkStatus} onClick={applyBulkStatus}>Apply</button><button type="button" className="text-button" onClick={() => setSelectedIds([])}>Clear</button></div>}
    <div className="planner-table-scroll"><table className="planner-task-table"><thead><tr><th><input type="checkbox" checked={pageIsSelected} onChange={togglePage} aria-label="Select all tasks on this page" /></th><th>Task</th><th>Scope</th><th>Owner</th><th>Priority</th><th>Progress</th><th>Target date</th><th>Status</th></tr></thead><tbody>{tableTasks.length ? tableTasks.map(task => { const progress = Number.isFinite(Number(task.progress_percent)) ? Number(task.progress_percent) : task.status === 'done' ? 100 : null; return <tr key={task.id}><td><input type="checkbox" checked={selectedIds.includes(task.id)} onChange={() => toggleSelected(task.id)} aria-label={`Select ${task.title}`} /></td><td><button type="button" className="planner-table-task" onClick={() => onOpenTask(task)}><small>{task.task_code || `#${task.id}`}</small><strong>{task.title}</strong><span>{[task.workstream, task.phase || task.quarter].filter(Boolean).join(' · ') || task.bucket || 'Backlog'}</span></button></td><td><span className={`scope-badge ${task.project_id ? 'project' : 'operations'}`}>{task.project_id ? task.tag || 'Project' : 'Operations'}</span></td><td>{task.member || 'Unassigned'}</td><td><span className={`planner-priority ${task.priority}`}>{task.priority}</span></td><td>{progress === null ? <span className="table-muted">Not tracked</span> : <span className="table-progress"><i><b style={{ width: `${progress}%` }} /></i>{progress}%</span>}</td><td><span className={task.due === 'Overdue' ? 'overdue' : ''}>{task.due_date || 'No date'}</span></td><td><select className={`status-select status-${task.status.replace(' ', '-')}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr> }) : <tr><td colSpan="8" className="planner-table-empty">No tasks match the current scope and filters.</td></tr>}</tbody></table></div>
    <div className="planner-pagination"><span>{visibleTasks.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, visibleTasks.length)} of ${visibleTasks.length}` : '0 tasks'}</span><div><button type="button" disabled={page === 1} onClick={() => setPage(current => current - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button><span>Page {page} of {totalPages}</span><button type="button" disabled={page === totalPages} onClick={() => setPage(current => current + 1)} aria-label="Next page"><ChevronRight size={15} /></button></div></div>
  </div>

  return <section className="workspace-view planner-view">
    <div className="workspace-view-heading"><div><p className="eyebrow">{isOperations ? 'Daily operations workspace' : 'Project delivery workspace'}</p><h1>{isOperations ? 'Operations planner' : 'Project planner'}</h1><p className="subtitle">{isOperations ? 'Manage recurring and day-to-day work outside projects.' : 'Plan and track delivery work within projects.'}</p></div><button className="primary-button" onClick={onAddTask}><Plus size={17} /> Add {isOperations ? 'operation' : 'project task'}</button></div>
    {scopeMode === 'switch' && <div className="planner-scope-switch" role="group" aria-label="Planner workspace">
      <button type="button" className={isOperations ? 'active' : ''} onClick={() => onProjectFilterChange?.('operations')}>Daily Operations <span>{tasks.filter(task => !task.project_id).length}</span></button>
      <button type="button" className={!isOperations ? 'active' : ''} onClick={() => onProjectFilterChange?.('all')}>Projects <span>{tasks.filter(task => task.project_id).length}</span></button>
      {!isOperations && <label>Project<select value={projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>}
    </div>}
    {scopeMode === 'projects' && <div className="planner-scope-switch" role="group" aria-label="Project planner scope">
      <button type="button" className="active">Projects <span>{tasks.filter(task => task.project_id).length}</span></button>
      <label>Project<select value={projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</select></label>
    </div>}
    <div className="planner-commandbar">
      <div className="planner-view-toggle" role="group" aria-label="Planner view"><button type="button" className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}><LayoutGrid size={13} /> Board</button><button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><List size={13} /> Table</button><button type="button" className={view === 'gantt' ? 'active' : ''} onClick={() => setView('gantt')}><GanttChartSquare size={13} /> Gantt</button></div>
      <label className="planner-search"><Search size={15} /><input value={searchQuery} onChange={event => onSearchChange(event.target.value)} placeholder="Search tasks" /></label>
      <label>Status<select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Workstream<select value={workstream} onChange={event => setWorkstream(event.target.value)}><option value="all">All workstreams</option>{workstreams.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button type="button" className={`planner-more-filters ${filtersOpen ? 'active' : ''}`} onClick={() => setFiltersOpen(current => !current)}>More filters <ChevronDown size={14} /></button>
      {filtersOpen && <div className="planner-secondary-filters">
      <label>Priority<select className={`priority-select priority-${priority}`} value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option>{['urgent', 'high', 'normal', 'low'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Assignee<select value={assignee} onChange={event => setAssignee(event.target.value)}><option value="all">All assignees</option><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={String(member.id)}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label>
      <label>Supporter<select value={supporter} onChange={event => setSupporter(event.target.value)}><option value="all">All supporters</option>{members.map(member => <option key={member.id} value={String(member.id)}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label>
      <label>Phase<select value={phase} onChange={event => setPhase(event.target.value)}><option value="all">All phases</option>{phases.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Bucket<select value={bucketFilter} onChange={event => setBucketFilter(event.target.value)}><option value="all">All buckets</option>{buckets.map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select></label>
      <label>Due<select value={dueFilter} onChange={event => setDueFilter(event.target.value)}><option value="all">Any due date</option><option value="today">Due today</option><option value="overdue">Overdue</option><option value="none">No due date</option></select></label>
      <label>From<input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
      <label>To<input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></label>
      </div>}
      {(status !== 'all' || priority !== 'all' || assignee !== 'all' || supporter !== 'all' || workstream !== 'all' || phase !== 'all' || bucketFilter !== 'all' || dueFilter !== 'all' || dateFrom || dateTo || searchQuery) && <button type="button" className="planner-clear-filters" onClick={() => { setStatus('all'); setPriority('all'); setAssignee('all'); setSupporter('all'); setWorkstream('all'); setPhase('all'); setBucketFilter('all'); setDueFilter('all'); setDateFrom(''); setDateTo(''); onSearchChange('') }}>Clear filters</button>}
      <span className="planner-result-count">{visibleTasks.length} of {tasks.length} tasks</span>
    </div>
    {isOperations && canManageBuckets && <form className="operations-workstream-create" onSubmit={onCreateWorkstream}><div><strong>Operations workstreams</strong><span>Create reusable lanes such as Finance, Customer Support, or People.</span></div><input value={newWorkstreamName} onChange={event => setNewWorkstreamName(event.target.value)} placeholder="New operations workstream" maxLength="120" required /><button type="submit" className="secondary-button" disabled={workstreamSubmitting}>{workstreamSubmitting ? 'Creating…' : 'Create workstream'}</button></form>}
    {canManageBuckets && activeWorkstreams.length > 0 && <div className="planner-manage-row">{activeWorkstreams.map(value => <span className="planner-manage-chip" key={value.id}>{value.name}<button type="button" onClick={() => onArchiveWorkstream?.(value)} aria-label={`Archive ${value.name}`}><Archive size={12} /></button></span>)}</div>}
    {workstreamError && <p className="auth-error" role="alert">{workstreamError}</p>}
    {canManageBuckets && <form className="planner-add-bucket" onSubmit={onCreateBucket}><input value={newBucketName} onChange={event => setNewBucketName(event.target.value)} placeholder="New bucket name" maxLength="80" required /><button type="submit" className="secondary-button" disabled={bucketSubmitting}>{bucketSubmitting ? 'Adding…' : 'Add bucket'}</button></form>}
    {canManageBuckets && persistedBuckets.filter(bucket => bucket.name !== 'Backlog').length > 0 && <div className="planner-manage-row">{persistedBuckets.filter(bucket => bucket.name !== 'Backlog').map(bucket => <span className="planner-manage-chip" key={bucket.id}>{bucket.name}<button type="button" onClick={() => onArchiveBucket?.(bucket)} aria-label={`Archive ${bucket.name}`}><Archive size={12} /></button></span>)}</div>}
    {bucketError && <p className="auth-error" role="alert">{bucketError}</p>}
    {view === 'gantt' ? ganttContent : view === 'table' ? tableContent : <div className="planner-board" aria-label="Planner board">
      {buckets.map(bucket => {
        const persistedIndex = persistedBuckets.findIndex(item => item.id === bucket.id)
        const bucketDraggable = canManageBuckets && typeof bucket.id === 'number' && bucket.name !== 'Backlog'
        return <section className={`planner-column ${dropBucketId === bucket.id ? 'is-drop-target' : ''} ${draggedBucketId === bucket.id ? 'is-dragging' : ''}`} key={bucket.id}
          onDragEnter={event => { if (draggedTaskId || (draggedBucketId && bucket.name !== 'Backlog')) { event.preventDefault(); setDropBucketId(bucket.id) } }}
          onDragOver={event => { if (draggedTaskId || (draggedBucketId && bucket.name !== 'Backlog')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropBucketId(null) }}
          onDrop={event => {
            event.preventDefault()
            event.stopPropagation()
            const plain = event.dataTransfer.getData('text/plain')
            if (draggedBucketId || plain.startsWith('bucket:')) moveBucket(draggedBucketId || Number(plain.slice(7)), bucket.id)
            else {
              const taskId = draggedTaskId || Number(event.dataTransfer.getData('application/x-workspace-task') || plain.replace(/^task:/, ''))
              if (taskId) persistMove(taskId, bucket.name, allOrderedFor(bucket.name).length)
            }
            setDraggedTaskId(null); setDraggedBucketId(null); setDropBucketId(null)
          }}>
        <header className="planner-column-heading" draggable={bucketDraggable}
          onDragStart={event => { if (!bucketDraggable) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `bucket:${bucket.id}`); setDraggedBucketId(bucket.id) }}
          onDragEnd={() => { setDraggedBucketId(null); setDropBucketId(null) }}>
          <GripVertical size={15} aria-hidden="true" /><strong>{bucket.name}</strong><span>{orderedFor(bucket.name).length}</span>{bucketDraggable && <div className="planner-bucket-move"><button type="button" disabled={persistedIndex <= 1} onClick={() => nudgeBucket(bucket.id, -1)} aria-label={`Move ${bucket.name} left`}><ArrowLeft size={12} /></button><button type="button" disabled={persistedIndex < 0 || persistedIndex >= persistedBuckets.length - 1} onClick={() => nudgeBucket(bucket.id, 1)} aria-label={`Move ${bucket.name} right`}><ArrowRight size={12} /></button></div>}
        </header>
        <div className="planner-column-tasks">{orderedFor(bucket.name).map(task => <PlannerTaskCard key={task.id} task={task} buckets={buckets} canReorder={canManageTasks || String(task.assignee_id || '') === String(currentUserId)} onOpen={onOpenTask} onDelete={onDeleteTask} onMove={moveTask} onStatusChange={onStatusChange} onDropBefore={dropBefore} draggedTaskId={draggedTaskId} setDraggedTaskId={setDraggedTaskId} dropTaskId={dropTaskId} setDropTaskId={setDropTaskId} />)}{!orderedFor(bucket.name).length && <div className="planner-empty">Drop tasks here</div>}</div>
        <button type="button" className="planner-column-add" onClick={() => addToBucket(bucket.name)}><Plus size={14} /> Add task</button>
      </section>})}
    </div>}
  </section>
}
