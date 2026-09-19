import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, Archive, Check, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.jsx'
import { AppSelect } from './ui/select.jsx'
import { Button } from './ui/button.jsx'
import { SearchInput } from './ui/search-input.jsx'
import Avatar from './Avatar.jsx'
import { formatEstimateMinutes, taskIsAssignedTo, toDateKey } from '../lib/workspace-format.js'
import { taskMatchesScope } from './WorkScopeSelector.jsx'

const statusLabel = { todo: 'To do', 'in progress': 'In progress', review: 'Review', blocked: 'Blocked', on_hold: 'On hold', cancelled: 'Cancelled', done: 'Done' }
const STALE_DAYS = 14

// The design's card: a 242x76 tile holding a completion checkbox, the title
// beside it, then an assignee circle, a "workstream - estimate" line and the
// status pill on the same baseline. Status moves between lanes by dragging the
// card; the overflow menu carries the moves a drag cannot express.
function PlannerTaskCard({ task, buckets, canReorder, canDeletePermanently, onOpen, onDelete, onDeletePermanently, onMove, onStatusChange, onDropBefore, draggedTaskId, setDraggedTaskId, dropTaskId, setDropTaskId }) {
  const isDone = task.status === 'done'
  const otherBuckets = buckets.filter(bucket => bucket.name !== task.bucket)
  const meta = [task.workstream, formatEstimateMinutes(task.estimate_minutes)].filter(Boolean).join(' · ')
  const assignee = task.assignee || {}
  return <article
    className={`planner-card group/card relative flex h-[76px] shrink-0 flex-col justify-between rounded-card border border-border bg-card px-[11px] pt-[11px] pb-[17px] text-left transition-colors ${draggedTaskId === task.id ? 'opacity-50' : ''} ${dropTaskId === task.id && draggedTaskId !== task.id ? 'border-navy' : ''}`}
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
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        className="planner-card-check mt-0.5"
        checked={isDone}
        disabled={!onStatusChange}
        onChange={() => onStatusChange?.(task.id, isDone ? 'todo' : 'done')}
        aria-label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />
      <button
        type="button"
        className={`min-w-0 flex-1 truncate text-body-compact font-medium text-left ${isDone ? 'text-text-muted line-through' : 'text-text-primary'}`}
        onClick={() => onOpen(task)}
      >
        {task.title}
      </button>
    </div>
    <div className="flex items-center gap-2">
      <Avatar name={taskAssigneeLabel(task)} avatarUrl={assignee.avatar_url} className="card-avatar" />
      <span className={`min-w-0 flex-1 truncate text-[11px] leading-[13px] ${isDone ? 'text-text-subtle' : 'text-text-muted'}`}>{meta}</span>
      {onStatusChange
        ? <AppSelect
            className={`task-status-pill planner-status-pill ${task.status}`}
            value={task.status}
            onChange={event => onStatusChange(task.id, event.target.value)}
            aria-label={`Change status for ${task.title}`}
          >
            {Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </AppSelect>
        : <span className={`task-status-pill planner-status-pill ${task.status}`}>{statusLabel[task.status] || task.status}</span>}
    </div>
    {/* The design's card shows no overflow control at rest, so it only appears
        once the card is hovered or the button itself takes focus. */}
    <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="planner-card-menu" aria-label={`Actions for ${task.title}`} title={`Actions for ${task.title}`}><MoreHorizontal size={16} /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="planner-bucket-menu">
          <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Open ${task.title}`} onSelect={() => onOpen(task)}><Pencil size={13} /><span>Open task</span></DropdownMenuItem>
          {canReorder && otherBuckets.length > 0 && <>
            <DropdownMenuSeparator className="planner-bucket-menu-separator" />
            {otherBuckets.map(bucket => <DropdownMenuItem key={bucket.id} className="planner-bucket-menu-item" aria-label={`Move ${task.title} to ${bucket.name}`} onSelect={() => onMove(task, bucket.name)}><ArrowRight size={13} /><span>Move to {bucket.name}</span></DropdownMenuItem>)}
          </>}
          {canReorder && <>
            <DropdownMenuSeparator className="planner-bucket-menu-separator" />
            <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Archive ${task.title}`} onSelect={() => onDelete(task.id)}><Archive size={13} /><span>Archive</span></DropdownMenuItem>
            {canDeletePermanently && <><DropdownMenuSeparator className="planner-bucket-menu-separator" /><DropdownMenuItem variant="destructive" className="planner-bucket-menu-item" aria-label={`Delete ${task.title} permanently`} onSelect={() => onDeletePermanently(task)}><Trash2 size={13} /><span>Delete permanently</span></DropdownMenuItem></>}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </article>
}

function taskAssigneeLabel(task) {
  const assignee = task.assignee || {}
  return task.member || [assignee.first_name, assignee.last_name].filter(Boolean).join(' ') || assignee.email || ''
}

export default function PlannerBoard({ buckets, tasks, members, projects = [], lookupValues = [], scopeMode = 'switch', searchQuery, onSearchChange, canManageTasks, canManageBuckets, currentUserId, onStatusChange, onOpenTask, onDeleteTask, onDeletePermanently, canDeletePermanently, onAddTask, onTaskMove, onBucketReorder, newBucketName, setNewBucketName, bucketSubmitting, bucketError, onCreateBucket, externalFilter = 'all', projectFilter = 'operations', onProjectFilterChange, newWorkstreamName, setNewWorkstreamName, workstreamSubmitting, workstreamError, onCreateWorkstream, onArchiveWorkstream, onArchiveBucket, onRenameBucket, onDeleteBucket, onRestoreBucket, onToggleBucketArchive, bucketArchiveOpen = false, archivedBuckets = [], bucketArchiveLoading = false, bucketArchiveError = '', initialWorkstream = 'all' }) {
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [assignee, setAssignee] = useState('all')
  const [supporter, setSupporter] = useState('all')
  const [workstream, setWorkstream] = useState(() => initialWorkstream !== 'all' ? initialWorkstream : scopeMode === 'operations' ? localStorage.getItem('workspace-operations-workstream-filter') || 'all' : 'all')
  useEffect(() => { if (scopeMode === 'operations') localStorage.setItem('workspace-operations-workstream-filter', workstream) }, [scopeMode, workstream])
  const [phase, setPhase] = useState('all')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState('all')
  const [staleOnly, setStaleOnly] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  const [draggedBucketId, setDraggedBucketId] = useState(null)
  const [dropBucketId, setDropBucketId] = useState(null)
  const [dropTaskId, setDropTaskId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editingBucketId, setEditingBucketId] = useState(null)
  const [bucketNameDraft, setBucketNameDraft] = useState('')

  // externalFilter carries one filter token in from Reports drill-throughs and
  // saved views (main.jsx's plannerFilter) - it can name a status, a bucket, an
  // assignee ("mine" / "member:<id>" / "unassigned"), or "overdue"/"all".
  useEffect(() => {
    if (!externalFilter || externalFilter === 'all') {
      setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee('all'); setStaleOnly(false)
      return
    }
    if (externalFilter === 'overdue') { setStatus('all'); setDueFilter('overdue'); setBucketFilter('all'); setAssignee('all'); setStaleOnly(false); return }
    if (externalFilter === 'stale') { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee('all'); setStaleOnly(true); return }
    if (externalFilter === 'unassigned') { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(''); setStaleOnly(false); return }
    if (externalFilter === 'mine') { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(String(currentUserId)); setStaleOnly(false); return }
    if (externalFilter.startsWith('member:')) { setStatus('all'); setDueFilter('all'); setBucketFilter('all'); setAssignee(externalFilter.slice(7)); setStaleOnly(false); return }
    if (statusLabel[externalFilter]) { setStatus(externalFilter); setDueFilter('all'); setBucketFilter('all'); setAssignee('all'); setStaleOnly(false); return }
    if (buckets.some(bucket => bucket.name === externalFilter)) { setStatus('all'); setDueFilter('all'); setBucketFilter(externalFilter); setAssignee('all'); setStaleOnly(false) }
    // buckets/currentUserId are read but deliberately excluded below: buckets is a
    // fresh array literal on every parent render (WorkspaceView rebuilds it inline),
    // and currentUserId is effectively static - including either would re-apply
    // externalFilter (wiping the user's own filter picks) on every 15s data poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFilter])
  const today = toDateKey(new Date())
  const isOperations = scopeMode === 'operations' || (scopeMode === 'switch' && projectFilter === 'operations')
  const selectedWorkstream = lookupValues.find(value => value.kind === 'workstream' && !value.project_id && value.name === workstream)
  const bucketScope = isOperations ? (selectedWorkstream ? { workstream_id: selectedWorkstream.id } : null) : (projectFilter !== 'all' ? { project_id: projectFilter } : null)
  // Every lane the workspace holds, before this view narrows the list below.
  const workspaceBuckets = buckets
  // A bucket scope narrows the board to one project or one workstream. With nothing
  // chosen there is nothing to narrow to, so fall back to the lanes that mode owns:
  // operations work lives outside projects, while "all projects" spans every lane -
  // an empty lane list puts every task in no column at all.
  const scopedBuckets = bucketScope
    ? buckets.filter(bucket => bucketScope.project_id ? String(bucket.project_id) === String(bucketScope.project_id) : String(bucket.workstream_id) === String(bucketScope.workstream_id))
    : buckets.filter(bucket => !isOperations || !bucket.project_id)
  // A project scope draws that project's own lanes, but its tasks need not sit in
  // them: moving a task to a project leaves it in whatever lane it was already in -
  // the shared Backlog, or one left behind by the project it came from. A task whose
  // lane has no column is drawn nowhere, so without these the scope that claims the
  // task is the one scope that hides it. The lane is borrowed for display only, so
  // it carries a name rather than an id and stays out of the reorder controls.
  if (bucketScope && bucketScope.project_id) {
    const drawn = new Set(scopedBuckets.map(bucket => bucket.name))
    for (const task of tasks) {
      const name = String(task.bucket || 'Backlog')
      if (drawn.has(name) || !taskMatchesScope(task, projectFilter)) continue
      drawn.add(name)
      scopedBuckets.push({ id: `scope-lane:${bucketScope.project_id}:${name}`, name, project_id: bucketScope.project_id, workstream_id: null })
    }
  }
  // Bucket names only have to be unique within their scope and a task names its lane
  // by name alone, so a name shared by two scopes would draw the same column twice.
  buckets = [...new Map(scopedBuckets.map(bucket => [bucket.name, bucket])).values()]

  // A task filed into a project's lane counts as that project even when the task
  // itself carries no project - the lane is the only project signal it has, and
  // scoping the planner to the project would otherwise hide it. A name two
  // projects both use says nothing, so it resolves to no project rather than a
  // guess.
  const projectByBucketName = useMemo(() => {
    const map = new Map()
    for (const bucket of workspaceBuckets) {
      if (!bucket.project_id) continue
      const name = String(bucket.name)
      map.set(name, map.has(name) && String(map.get(name)) !== String(bucket.project_id) ? null : bucket.project_id)
    }
    return map
  }, [workspaceBuckets])
  const matchesPlannerScope = task => {
    if (taskMatchesScope(task, projectFilter)) return true
    if (projectFilter === 'all' || projectFilter === 'operations') return false
    const viaBucket = projectByBucketName.get(String(task.bucket || 'Backlog'))
    return Boolean(viaBucket) && String(viaBucket) === String(projectFilter)
  }

  const normalizedWorkstreams = useMemo(() => lookupValues.filter(value => value.kind === 'workstream' && value.is_active && (isOperations ? !value.project_id : projectFilter === 'all' ? Boolean(value.project_id) : (!value.project_id || String(value.project_id) === String(projectFilter)))).map(value => value.name), [lookupValues, isOperations, projectFilter])
  const workstreams = useMemo(() => [...new Set([...normalizedWorkstreams, ...tasks.filter(task => taskMatchesScope(task, projectFilter)).map(task => task.workstream).filter(Boolean)])].sort(), [normalizedWorkstreams, tasks, projectFilter])
  const phases = useMemo(() => [...new Set(tasks.map(task => task.phase || task.quarter).filter(Boolean))].sort(), [tasks])
  const matchesWorkstream = task => workstream === 'all' || String(task.workstream || '').trim().toLocaleLowerCase() === String(workstream).trim().toLocaleLowerCase()
  const visibleTasks = useMemo(() => tasks.filter(task => {
    const search = searchQuery.trim().toLowerCase()
    const supporterIds = (task.supporters || []).map(item => String(item.id ?? item.user_id ?? item))
    return (!search || [task.task_code, task.title, task.description, task.tag, task.member, task.workstream, task.phase, task.quarter, ...(task.labels || [])].filter(Boolean).join(' ').toLowerCase().includes(search))
      && (status === 'all' || task.status === status)
      && (priority === 'all' || task.priority === priority)
      && (assignee === 'all' || taskIsAssignedTo(task, assignee))
      && (supporter === 'all' || supporterIds.includes(supporter))
      && matchesWorkstream(task)
      && (phase === 'all' || (task.phase || task.quarter) === phase)
      && matchesPlannerScope(task)
      && (bucketFilter === 'all' || task.bucket === bucketFilter)
      && (!dateFrom || (task.due_date && task.due_date >= dateFrom))
      && (!dateTo || (task.due_date && task.due_date <= dateTo))
      && (dueFilter === 'all' || (dueFilter === 'overdue' && task.due_date && task.due_date < today && task.status !== 'done') || (dueFilter === 'today' && task.due_date === today) || (dueFilter === 'none' && !task.due_date))
      && (!staleOnly || (task.status !== 'done' && task.status !== 'cancelled' && task.updated_at && Date.now() - new Date(task.updated_at).getTime() > STALE_DAYS * 86400000))
  }), [tasks, searchQuery, status, priority, assignee, supporter, workstream, phase, bucketFilter, dueFilter, dateFrom, dateTo, projectFilter, today, projectByBucketName, staleOnly])

  const orderedFor = bucket => visibleTasks.filter(task => task.bucket === bucket).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id)
  const allOrderedFor = bucket => tasks.filter(task => task.bucket === bucket).sort((a, b) => (a.position || 0) - (b.position || 0) || a.id - b.id)
  const persistMove = (taskId, targetBucket, targetIndex) => {
    const next = Object.fromEntries(buckets.map(bucket => [bucket.name, allOrderedFor(bucket.name).filter(task => task.id !== taskId)]))
    const movedTask = tasks.find(task => task.id === taskId)
    if (!movedTask || !next[targetBucket]) return
    next[targetBucket].splice(Math.max(0, Math.min(targetIndex, next[targetBucket].length)), 0, movedTask)
    const columns = buckets.map(bucket => ({ bucket: bucket.name, task_ids: next[bucket.name].map(task => task.id) }))
    onTaskMove(canManageTasks ? columns : columns.map(column => ({ ...column, task_ids: column.task_ids.filter(id => { const item = tasks.find(task => task.id === id); return item && taskIsAssignedTo(item, currentUserId) }) })).filter(column => column.task_ids.length))
  }
  const moveTask = (task, targetBucket) => persistMove(task.id, targetBucket, allOrderedFor(targetBucket).filter(item => item.id !== task.id).length)
  const dropBefore = (taskId, targetTask) => {
    const target = allOrderedFor(targetTask.bucket).filter(task => task.id !== taskId)
    persistMove(taskId, targetTask.bucket, target.findIndex(task => task.id === targetTask.id))
  }
  const addToBucket = bucket => {
    sessionStorage.setItem('workspace-new-task-bucket', bucket)
    onAddTask()
  }
  const persistedBuckets = buckets.filter(bucket => typeof bucket.id === 'number')
  const activeWorkstreams = lookupValues.filter(value => value.kind === 'workstream' && value.is_active && (isOperations ? !value.project_id : Boolean(value.project_id)) && (workstream === 'all' || String(value.name).trim().toLocaleLowerCase() === String(workstream).trim().toLocaleLowerCase()))
  const moveBucket = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    // The board falls back to every lane when no scope is chosen, but a save has to
    // send one scope's lanes in their new order - a mixed list is rejected outright.
    if (!bucketScope) return
    const next = persistedBuckets.map(bucket => bucket.id)
    const sourceIndex = next.indexOf(Number(sourceId))
    const targetIndex = next.indexOf(Number(targetId))
    if (sourceIndex < 0 || targetIndex < 0 || persistedBuckets[targetIndex]?.name === 'Backlog') return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next)
  }
  const nudgeBucket = (bucketId, direction) => {
    if (!bucketScope) return
    const next = persistedBuckets.map(bucket => bucket.id)
    const sourceIndex = next.indexOf(bucketId)
    const targetIndex = sourceIndex + direction
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= next.length || persistedBuckets[targetIndex]?.name === 'Backlog') return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next)
  }
  const startBucketRename = bucket => {
    setEditingBucketId(bucket.id)
    setBucketNameDraft(bucket.name)
  }
  const submitBucketRename = async (event, bucket) => {
    event.preventDefault()
    const name = bucketNameDraft.trim()
    if (!name || name === bucket.name) {
      setEditingBucketId(null)
      return
    }
    const saved = await onRenameBucket?.(bucket, name)
    if (saved !== false) setEditingBucketId(null)
  }
  const bucketScopeLabel = bucket => {
    if (bucket.project_id) return projects.find(project => String(project.id) === String(bucket.project_id))?.name || 'Project'
    if (bucket.workstream_id) return lookupValues.find(value => value.kind === 'workstream' && String(value.id) === String(bucket.workstream_id))?.name || 'Workstream'
    return 'Workspace'
  }
  // The landing lane: where a task goes when nobody picks a bucket for it. It is
  // an ordinary bucket otherwise, and the design draws the same overflow menu on
  // it as on every other column - so it carries the lifecycle actions too. What
  // it does not carry is a position: the server keeps it first and revives it by
  // name whenever a task lands there, which is why only this lane draws the
  // dropzone the design puts under Backlog's cards.
  const isDefaultBacklog = bucket => !bucket.project_id && !bucket.workstream_id && bucket.name === 'Backlog'
  const laneSummary = name => {
    const items = orderedFor(name)
    const minutes = items.reduce((total, task) => total + (Number(task.estimate_minutes) || 0), 0)
    return `${items.length} ${items.length === 1 ? 'task' : 'tasks'}${minutes ? ` · ${formatEstimateMinutes(minutes)}` : ''}`
  }
  const filtersHiding = status !== 'all' || priority !== 'all' || assignee !== 'all' || supporter !== 'all' || phase !== 'all' || bucketFilter !== 'all' || dueFilter !== 'all' || Boolean(dateFrom) || Boolean(dateTo) || staleOnly
  const clearHiddenFilters = () => { setStatus('all'); setPriority('all'); setAssignee('all'); setSupporter('all'); setPhase('all'); setBucketFilter('all'); setDueFilter('all'); setDateFrom(''); setDateTo(''); setStaleOnly(false) }
  // The design's scope line names the scope, the lane count and what the board
  // does with them. A drill-through from Reports sets filters this toolbar has no
  // control for, so when one is in force the line says so and offers the way out.
  const scopeLine = [
    isOperations ? (workstream === 'all' ? 'Showing operations only' : `Showing ${workstream}`) : (workstream === 'all' ? 'Showing all workstreams' : `Showing ${workstream}`),
    `${buckets.length} ${buckets.length === 1 ? 'bucket' : 'buckets'}`,
    isOperations ? 'non-project work across all squads' : 'drag a card, or use its bucket selector to move it',
  ].filter(Boolean).join(' · ')

  const archiveContent = <section className="planner-bucket-archive" aria-labelledby="bucket-archive-title">
    <header className="planner-archive-heading">
      <div><p className="text-overline uppercase text-navy">Planner storage</p><h2 id="bucket-archive-title">Bucket archive</h2><p>Restore a bucket to reuse it, or delete it permanently.</p></div>
      <button type="button" className="planner-archive-close" onClick={onToggleBucketArchive} aria-label="Close bucket archive" title="Close bucket archive"><X size={16} /></button>
    </header>
    {bucketArchiveError && <p className="auth-error" role="alert">{bucketArchiveError}</p>}
    {bucketArchiveLoading ? <p className="planner-archive-state">Loading archived buckets...</p> : archivedBuckets.length ? <div className="planner-archive-grid">
      {archivedBuckets.map(bucket => <article className="planner-archive-card" key={bucket.id}>
        <div className="planner-archive-card-heading"><span className="planner-archive-card-icon"><Archive size={16} /></span><div><h3>{bucket.name}</h3><p>{bucketScopeLabel(bucket)}</p></div></div>
        <div className="planner-archive-actions"><button type="button" className="secondary-button" onClick={() => onRestoreBucket?.(bucket)}><RotateCcw size={14} /> Restore</button><button type="button" className="planner-archive-delete" onClick={() => onDeleteBucket?.(bucket)}><Trash2 size={14} /> Delete</button></div>
      </article>)}
    </div> : <div className="planner-archive-empty"><Archive size={22} /><strong>No archived buckets</strong><p>Buckets you archive will appear here.</p></div>}
  </section>

  const createPanel = canManageBuckets && creating && <div className="mt-3 flex flex-wrap items-end gap-3 rounded-control border border-border bg-card p-3">
    <label className="grid flex-1 gap-1.5">
      <span className="text-caption font-medium text-text-secondary">{isOperations ? 'Workstream' : 'Project'}</span>
      {isOperations
        ? <AppSelect className="chip-select" value={workstream} onChange={event => setWorkstream(event.target.value)} aria-label="Workstream for the new bucket"><option value="all">Unassigned</option>{workstreams.map(value => <option key={value} value={value}>{value}</option>)}</AppSelect>
        : <AppSelect className="chip-select" value={projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)} aria-label="Project for the new bucket"><option value="all">All projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</AppSelect>}
    </label>
    <form className="grid flex-1 gap-1.5" onSubmit={event => onCreateBucket(event, bucketScope)}>
      <span className="text-caption font-medium text-text-secondary">Bucket name</span>
      <div className="flex gap-2">
        <input className="h-[42px] min-w-0 flex-1 rounded-control border border-border bg-card px-3 text-body-small text-text-primary outline-none placeholder:text-text-muted" value={newBucketName} onChange={event => setNewBucketName(event.target.value)} placeholder="New bucket name" maxLength="80" required />
        <Button type="submit" disabled={bucketSubmitting || !bucketScope}>{bucketSubmitting ? 'Adding…' : 'Add bucket'}</Button>
        <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
      </div>
    </form>
    {!bucketScope && <p className="w-full text-caption text-text-muted">Choose a {isOperations ? 'workstream' : 'project'} before adding buckets.</p>}
    {isOperations && <form className="grid flex-1 gap-1.5" onSubmit={onCreateWorkstream}>
      <span className="text-caption font-medium text-text-secondary">New workstream</span>
      <div className="flex gap-2">
        <input className="h-[42px] min-w-0 flex-1 rounded-control border border-border bg-card px-3 text-body-small text-text-primary outline-none placeholder:text-text-muted" value={newWorkstreamName} onChange={event => setNewWorkstreamName(event.target.value)} placeholder="e.g. Finance" maxLength="120" required />
        <Button type="submit" disabled={workstreamSubmitting}>{workstreamSubmitting ? 'Creating…' : 'Create'}</Button>
      </div>
    </form>}
    {isOperations && activeWorkstreams.length > 0 && <div className="flex w-full flex-wrap items-center gap-2">{activeWorkstreams.map(value => <span className="planner-manage-chip" key={value.id}>{value.name}<button type="button" onClick={() => onArchiveWorkstream?.(value)} aria-label={`Archive ${value.name}`}><Archive size={12} /></button></span>)}</div>}
  </div>

  return <section className="workspace-view planner-view">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-[18px]">
      <div className="min-w-0">
        <p className={`text-overline uppercase ${isOperations ? 'text-text-muted' : 'text-navy'}`}>Work planning</p>
        <h1 className="mt-1 text-page-heading text-text-primary">{isOperations ? 'Daily operations' : 'Planner'}</h1>
        <p className="mt-1.5 text-body-small text-text-muted">{isOperations
          ? 'Recurring and non-project work - the operational running of the team.'
          : `${buckets.length} ${buckets.length === 1 ? 'bucket' : 'buckets'} · ${visibleTasks.length} ${visibleTasks.length === 1 ? 'task' : 'tasks'} · drag between buckets, or use the bucket selector on a card to move it`}</p>
      </div>
      {isOperations
        ? canManageBuckets && <Button size="page" type="button" onClick={() => setCreating(current => !current)} aria-expanded={creating}><Plus size={20} strokeWidth={1.75} /> New bucket</Button>
        : <Button size="page" type="button" onClick={onAddTask}><Plus size={20} strokeWidth={1.75} /> Create task</Button>}
    </header>

    {bucketArchiveOpen ? archiveContent : <>
    <div className="mt-[9px] flex flex-wrap items-center gap-3">
      <SearchInput
        className="w-full min-w-0 sm:max-w-[280px] sm:flex-1"
        label="Search tasks"
        placeholder="Search tasks"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
      />
      <AppSelect className="chip-select w-full sm:w-[170px]" value={isOperations ? 'operations' : 'all'} onChange={event => onProjectFilterChange?.(event.target.value)} aria-label="Work scope" disabled={scopeMode === 'projects'}>
        <option value="all">All work</option>
        <option value="operations">Daily operations</option>
      </AppSelect>
      {!isOperations && <AppSelect className="chip-select w-full sm:w-[170px]" value={projectFilter === 'operations' ? 'all' : projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)} aria-label="Project">
        <option value="all">All projects</option>
        {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
      </AppSelect>}
      <AppSelect className="chip-select w-full sm:w-[170px]" value={workstream} onChange={event => setWorkstream(event.target.value)} aria-label="Workstream">
        <option value="all">{isOperations ? 'All workstreams' : 'All workstreams'}</option>
        {workstreams.map(value => <option key={value} value={value}>{value}</option>)}
      </AppSelect>
      {canManageBuckets && <Button type="button" variant="outline" className={`gap-2.5 ${bucketArchiveOpen ? 'border-navy' : ''}`} onClick={onToggleBucketArchive} aria-pressed={bucketArchiveOpen}>
        <Archive size={20} aria-hidden="true" /> Archived
      </Button>}
      {canManageBuckets && !isOperations && <Button size="page" type="button" onClick={() => setCreating(current => !current)} aria-expanded={creating}><Plus size={20} strokeWidth={1.75} /> New bucket</Button>}
    </div>

    <div className="mt-4 flex flex-wrap items-center gap-3 text-caption text-text-muted">
      <span>{scopeLine}</span>
      {filtersHiding && <button type="button" className="text-caption font-medium text-navy underline underline-offset-2" onClick={clearHiddenFilters}>Clear filters</button>}
    </div>

    {createPanel}
    {(bucketError || workstreamError) && <p className="auth-error" role="alert">{bucketError || workstreamError}</p>}

    <div className="mt-[17px] flex gap-4 overflow-x-auto pb-2" aria-label="Planner board">
      {buckets.map(bucket => {
        const persistedIndex = persistedBuckets.findIndex(item => item.id === bucket.id)
        const bucketDraggable = canManageBuckets && Boolean(bucketScope) && typeof bucket.id === 'number' && bucket.name !== 'Backlog'
        return <section className={`planner-column flex h-[744px] w-[266px] shrink-0 flex-col rounded-card bg-surface-secondary ${dropBucketId === bucket.id ? 'ring-1 ring-navy' : ''} ${draggedBucketId === bucket.id ? 'opacity-60' : ''}`} key={bucket.id}
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
          <header className="planner-column-heading relative px-4 pt-3.5 pb-3" draggable={bucketDraggable}
            onDragStart={event => { if (!bucketDraggable) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', `bucket:${bucket.id}`); setDraggedBucketId(bucket.id) }}
            onDragEnd={() => { setDraggedBucketId(null); setDropBucketId(null) }}>
            {editingBucketId === bucket.id
              ? <form className="flex items-center gap-1" onSubmit={event => submitBucketRename(event, bucket)}>
                  <input autoFocus value={bucketNameDraft} onChange={event => setBucketNameDraft(event.target.value)} aria-label={`Rename ${bucket.name}`} maxLength="80" className="h-7 min-w-0 flex-1 rounded-badge border border-border bg-card px-2 text-body-small text-text-primary outline-none" />
                  <button type="submit" aria-label={`Save ${bucket.name} name`} title="Save name"><Check size={14} /></button>
                  <button type="button" onClick={() => setEditingBucketId(null)} aria-label="Cancel rename" title="Cancel"><X size={14} /></button>
                </form>
              : <><strong className="block truncate pr-[54px] text-body-small font-semibold text-text-primary">{bucket.name}</strong>
                  <span className="mt-0.5 block truncate pr-[54px] text-caption text-text-muted">{laneSummary(bucket.name)}</span></>}
            {canManageBuckets && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="planner-column-menu absolute right-2 top-4" aria-label={`Open actions for ${bucket.name}`} title={`Actions for ${bucket.name}`}><MoreHorizontal size={20} /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="planner-bucket-menu">
                <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Rename ${bucket.name}`} onSelect={() => startBucketRename(bucket)}><Pencil size={13} /><span>Rename</span></DropdownMenuItem>
                {bucketDraggable && <>
                  <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                  <DropdownMenuItem className="planner-bucket-menu-item" disabled={persistedIndex <= 1} aria-label={`Move ${bucket.name} left`} onSelect={() => nudgeBucket(bucket.id, -1)}><ArrowLeft size={13} /><span>Move left</span></DropdownMenuItem>
                  <DropdownMenuItem className="planner-bucket-menu-item" disabled={persistedIndex < 0 || persistedIndex >= persistedBuckets.length - 1} aria-label={`Move ${bucket.name} right`} onSelect={() => nudgeBucket(bucket.id, 1)}><ArrowRight size={13} /><span>Move right</span></DropdownMenuItem>
                </>}
                <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Archive ${bucket.name}`} onSelect={() => onArchiveBucket?.(bucket)}><Archive size={13} /><span>Archive</span></DropdownMenuItem>
                <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                <DropdownMenuItem variant="destructive" className="planner-bucket-menu-item" aria-label={`Delete ${bucket.name}`} onSelect={() => onDeleteBucket?.(bucket)}><Trash2 size={13} /><span>Delete</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {orderedFor(bucket.name).map(task => <PlannerTaskCard key={task.id} task={task} buckets={buckets} canReorder={canManageTasks || taskIsAssignedTo(task, currentUserId)} canDeletePermanently={canDeletePermanently} onOpen={onOpenTask} onDelete={onDeleteTask} onDeletePermanently={onDeletePermanently} onMove={moveTask} onStatusChange={onStatusChange} onDropBefore={dropBefore} draggedTaskId={draggedTaskId} setDraggedTaskId={setDraggedTaskId} dropTaskId={dropTaskId} setDropTaskId={setDropTaskId} />)}
            {isDefaultBacklog(bucket) && <div className="planner-dropzone mt-3 flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-icon bg-border">
              <ArrowDownToLine size={18} className="text-text-muted" aria-hidden="true" />
              <span className="text-caption font-medium text-text-muted">Drop task here</span>
            </div>}
          </div>
          <div className="px-3 pb-3">
            <button type="button" className="flex h-10 w-full items-center justify-center gap-2.5 rounded-icon border border-border bg-card text-body-compact font-medium text-text-primary transition-colors hover:border-text-muted" onClick={() => addToBucket(bucket.name)}><Plus size={20} className="text-text-secondary" aria-hidden="true" /> Add task</button>
          </div>
        </section>})}
      {!buckets.length && <p className="planner-empty planner-board-empty">{bucketScope ? 'This scope has no lanes yet. Add a bucket to start planning.' : 'This workspace has no lanes yet. Add a bucket to start planning.'}</p>}
    </div>
    </>}
  </section>
}
