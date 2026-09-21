import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, ArrowLeft, ArrowRight, Archive, Check, ChevronRight, FolderInput, GripVertical, MoreHorizontal, MoveHorizontal, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './ui/dropdown-menu.jsx'
import { AppSelect } from './ui/select.jsx'
import { Button } from './ui/button.jsx'
import { SearchInput } from './ui/search-input.jsx'
import Avatar from './Avatar.jsx'
import { formatEstimateMinutes, taskIsAssignedTo, toDateKey } from '../lib/workspace-format.js'
import { taskMatchesScope } from './WorkScopeSelector.jsx'

const statusLabel = { todo: 'To do', 'in progress': 'In progress', review: 'Review', blocked: 'Blocked', on_hold: 'On hold', cancelled: 'Cancelled', done: 'Done' }
const STALE_DAYS = 14

// The design's compact lane card: a completion checkbox and title lead, then
// owner, workstream/estimate, and status. Status moves between lanes by dragging
// the card; the overflow menu carries the moves a drag cannot express.
function PlannerTaskCard({ task, buckets, today, canReorder, canDeletePermanently, onOpen, onDelete, onDeletePermanently, onMove, onStatusChange, onDropBefore, draggedTaskId, setDraggedTaskId, dropTaskId, setDropTaskId }) {
  const isDone = task.status === 'done'
  const otherBuckets = buckets.filter(bucket => bucket.name !== task.bucket)
  const assignee = task.assignee || {}
  const isOverdue = Boolean(task.due_date && task.due_date < (today || toDateKey(new Date())) && !isDone)
  const taskTag = task.tag && task.tag !== 'General' ? task.tag : task.labels?.[0]
  const meta = [taskTag, task.workstream, formatEstimateMinutes(task.estimate_minutes), !isOverdue && task.due_date].filter(Boolean)
  return <article
    className={`planner-card planner-task-card group/card relative flex shrink-0 flex-col justify-between border border-border bg-card text-left transition-colors${draggedTaskId === task.id ? ' is-dragging opacity-50' : ''}${dropTaskId === task.id && draggedTaskId !== task.id ? ' is-drop-target border-navy' : ''}`}
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
    <div className="planner-task-card-top">
      <GripVertical className="planner-task-card-grip" size={14} strokeWidth={1.8} aria-hidden="true" />
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
        className={`planner-task-card-title ${isDone ? 'text-text-muted line-through' : 'text-text-primary'}`}
        onClick={() => onOpen(task)}
      >
        {task.title}
      </button>
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
    <div className="planner-task-card-details">
      {taskAssigneeLabel(task) && <Avatar name={taskAssigneeLabel(task)} avatarUrl={assignee.avatar_url} className="planner-task-card-avatar" />}
      <span className={`planner-task-card-meta-copy${isOverdue ? ' is-overdue' : ''}`} title={task.due_date ? `Due ${task.due_date}` : undefined}>
        {isOverdue && <span>Overdue</span>}
        {meta.map(item => <span key={item}>{item}</span>)}
        {!isOverdue && !meta.length && <span>No workstream</span>}
      </span>
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
  </article>
}

function taskAssigneeLabel(task) {
  const assignee = task.assignee || {}
  return task.member || [assignee.first_name, assignee.last_name].filter(Boolean).join(' ') || assignee.email || ''
}

function taskHasAssignee(task) {
  return Boolean((task.assignee_ids || []).length || task.assignee_id || task.assignee?.id || task.member)
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [mobileBucketId, setMobileBucketId] = useState(null)
  const [mobileBucketPinned, setMobileBucketPinned] = useState(false)
  const [isMobilePlanner, setIsMobilePlanner] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches)
  const [revealBucketId, setRevealBucketId] = useState(null)
  const boardRef = useRef(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 760px)')
    const update = event => setIsMobilePlanner(event.matches)
    update(media)
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (mobileBucketPinned && buckets.some(bucket => bucket.id === mobileBucketId)) return
    const firstPopulated = buckets.find(bucket => tasks.some(task => task.bucket === bucket.name))
    const nextBucketId = firstPopulated?.id ?? buckets[0]?.id ?? null
    if (nextBucketId !== mobileBucketId) setMobileBucketId(nextBucketId)
  }, [buckets, mobileBucketId, mobileBucketPinned, tasks])

  useEffect(() => {
    if (revealBucketId === null || !boardRef.current) return undefined
    const frame = window.requestAnimationFrame(() => {
      const target = [...boardRef.current.querySelectorAll('[data-bucket-id]')].find(node => node.dataset.bucketId === String(revealBucketId))
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      setRevealBucketId(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [buckets, revealBucketId])

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
      && (assignee === 'all' || (assignee === '' ? !taskHasAssignee(task) : taskIsAssignedTo(task, assignee)))
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
  const reorderableBuckets = buckets.filter(bucket => typeof bucket.id === 'number' || bucket.id === 'backlog')
  const reorderScopeFor = bucket => {
    if (bucket.id === 'backlog' && !bucket.project_id && !bucket.workstream_id) return { project_id: null, workstream_id: null }
    if (bucketScope?.project_id && String(bucket.project_id) === String(bucketScope.project_id)) return bucketScope
    if (bucketScope?.workstream_id && String(bucket.workstream_id) === String(bucketScope.workstream_id)) return bucketScope
    if (bucket.project_id) return { project_id: bucket.project_id, workstream_id: null }
    if (bucket.workstream_id) return { project_id: null, workstream_id: bucket.workstream_id }
    if (!bucket.project_id && !bucket.workstream_id) return { project_id: null, workstream_id: null }
    return null
  }
  const reorderBucketsFor = scope => reorderableBuckets.filter(bucket => {
    if (scope.project_id) return String(bucket.project_id) === String(scope.project_id)
    if (scope.workstream_id) return String(bucket.workstream_id) === String(scope.workstream_id)
    return !bucket.project_id && !bucket.workstream_id
  })
  const sameReorderScope = (left, right) => Boolean(left && right && String(left.project_id ?? '') === String(right.project_id ?? '') && String(left.workstream_id ?? '') === String(right.workstream_id ?? ''))
  const activeWorkstreams = lookupValues.filter(value => value.kind === 'workstream' && value.is_active && (isOperations ? !value.project_id : Boolean(value.project_id)) && (workstream === 'all' || String(value.name).trim().toLocaleLowerCase() === String(workstream).trim().toLocaleLowerCase()))
  const scrollBucketBoard = event => {
    const board = boardRef.current
    if (!board || !draggedBucketId) return
    const pointerX = Number.isFinite(event.clientX) ? event.clientX : event.pageX
    if (!Number.isFinite(pointerX)) return
    const bounds = board.getBoundingClientRect()
    const edge = Math.min(96, bounds.width / 4)
    const distanceFromLeft = pointerX - bounds.left
    const distanceFromRight = bounds.right - pointerX
    const direction = distanceFromLeft < edge ? -1 : distanceFromRight < edge ? 1 : 0
    if (!direction) return
    const distance = direction < 0 ? edge - distanceFromLeft : edge - distanceFromRight
    const amount = direction * Math.max(8, Math.ceil(distance / 3))
    const maximum = Math.max(0, board.scrollWidth - board.clientWidth)
    board.scrollLeft = Math.max(0, Math.min(maximum, board.scrollLeft + amount))
  }
  const moveBucket = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return
    const sourceBucket = reorderableBuckets.find(bucket => String(bucket.id) === String(sourceId))
    const scope = sourceBucket ? reorderScopeFor(sourceBucket) : null
    if (!scope) return
    const scopeBuckets = reorderBucketsFor(scope)
    const next = scopeBuckets.map(bucket => bucket.id)
    const sourceIndex = next.findIndex(id => String(id) === String(sourceId))
    const targetIndex = next.findIndex(id => String(id) === String(targetId))
    if (sourceIndex < 0 || targetIndex < 0) return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next, scope)
    setRevealBucketId(sourceId)
  }
  const startBucketDrag = (event, bucket) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-workspace-bucket', String(bucket.id))
    event.dataTransfer.setData('text/plain', `bucket:${bucket.id}`)
    setDraggedBucketId(bucket.id)
  }
  const nudgeBucket = (bucketId, direction) => {
    const bucket = reorderableBuckets.find(item => String(item.id) === String(bucketId))
    const scope = bucket ? reorderScopeFor(bucket) : null
    if (!scope) return
    const scopeBuckets = reorderBucketsFor(scope)
    const next = scopeBuckets.map(item => item.id)
    const sourceIndex = next.findIndex(id => String(id) === String(bucketId))
    const targetIndex = sourceIndex + direction
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= next.length) return
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onBucketReorder(next, scope)
    setRevealBucketId(bucketId)
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
  const activeMobileBucketId = buckets.some(bucket => bucket.id === mobileBucketId) ? mobileBucketId : buckets[0]?.id
  const activeMobileBucket = buckets.find(bucket => bucket.id === activeMobileBucketId)
  const mobileMoveTasks = activeMobileBucket ? orderedFor(activeMobileBucket.name) : []
  const mobileSheetCounts = {
    blocked: tasks.filter(task => task.status === 'blocked').length,
    overdue: tasks.filter(task => task.due_date && task.due_date < today && task.status !== 'done').length,
    unassigned: tasks.filter(task => !taskHasAssignee(task)).length,
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
  const draggedBucketName = buckets.find(bucket => bucket.id === draggedBucketId)?.name
  const dropBucketPosition = buckets.findIndex(bucket => bucket.id === dropBucketId) + 1

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
    <header className="planner-header flex flex-wrap items-start justify-between gap-4 border-b border-border pb-[18px]">
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
    <div className="planner-commandbar mt-[9px] flex flex-wrap items-center gap-3">
      <SearchInput
        className="planner-search w-full min-w-0 sm:max-w-[280px] sm:flex-1"
        label="Search tasks"
        placeholder="Search tasks"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
      />
      <button type="button" className={`planner-mobile-filter-button${mobileFiltersOpen ? ' is-active' : ''}`} onClick={() => setMobileFiltersOpen(current => !current)} aria-expanded={mobileFiltersOpen} aria-controls="planner-mobile-filters">
        <SlidersHorizontal size={18} aria-hidden="true" /> Filter
      </button>
      <AppSelect className="planner-desktop-control planner-work-scope chip-select w-full sm:w-[170px]" value={isOperations ? 'operations' : 'all'} onChange={event => onProjectFilterChange?.(event.target.value)} aria-label="Work scope" disabled={scopeMode === 'projects'}>
        <option value="all">All work</option>
        <option value="operations">Daily operations</option>
      </AppSelect>
      {!isOperations && <AppSelect className="planner-desktop-control planner-project-filter chip-select w-full sm:w-[170px]" value={projectFilter === 'operations' ? 'all' : projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)} aria-label="Project">
        <option value="all">All projects</option>
        {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
      </AppSelect>}
      <AppSelect className="planner-desktop-control planner-workstream-filter chip-select w-full sm:w-[170px]" value={workstream} onChange={event => setWorkstream(event.target.value)} aria-label="Workstream">
        <option value="all">{isOperations ? 'All workstreams' : 'All workstreams'}</option>
        {workstreams.map(value => <option key={value} value={value}>{value}</option>)}
      </AppSelect>
      {canManageBuckets && <Button type="button" variant="outline" className={`planner-desktop-control planner-archive-button gap-2.5 ${bucketArchiveOpen ? 'border-navy' : ''}`} onClick={onToggleBucketArchive} aria-pressed={bucketArchiveOpen}>
        <Archive size={20} aria-hidden="true" /> Archived
      </Button>}
      {canManageBuckets && !isOperations && <Button size="page" type="button" className="planner-desktop-control planner-new-bucket-button" onClick={() => setCreating(current => !current)} aria-expanded={creating}><Plus size={20} strokeWidth={1.75} /> New bucket</Button>}
    </div>

    {mobileFiltersOpen && <div id="planner-mobile-filters" className="planner-mobile-filter-panel">
      <label className="planner-mobile-filter-field"><span>Work scope</span><AppSelect value={isOperations ? 'operations' : 'all'} onChange={event => onProjectFilterChange?.(event.target.value)} disabled={scopeMode === 'projects'}><option value="all">All work</option><option value="operations">Daily operations</option></AppSelect></label>
      {!isOperations && <label className="planner-mobile-filter-field"><span>Project</span><AppSelect value={projectFilter === 'operations' ? 'all' : projectFilter} onChange={event => onProjectFilterChange?.(event.target.value)}><option value="all">All projects</option>{projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}</AppSelect></label>}
      <label className="planner-mobile-filter-field"><span>Workstream</span><AppSelect value={workstream} onChange={event => setWorkstream(event.target.value)}><option value="all">All workstreams</option>{workstreams.map(value => <option key={value} value={value}>{value}</option>)}</AppSelect></label>
      {canManageBuckets && <div className="planner-mobile-filter-actions">
        <Button type="button" variant="outline" onClick={onToggleBucketArchive} aria-pressed={bucketArchiveOpen}><Archive size={18} aria-hidden="true" /> Archived</Button>
        {!isOperations && <Button type="button" onClick={() => setCreating(current => !current)} aria-expanded={creating}><Plus size={18} aria-hidden="true" /> New bucket</Button>}
      </div>}
    </div>}

    <div className="planner-mobile-workstream-chips" role="group" aria-label="Workstream filter">
      <button type="button" className={workstream === 'all' ? 'is-active' : ''} onClick={() => setWorkstream('all')}>All</button>
      {workstreams.map(value => <button type="button" key={value} className={workstream === value ? 'is-active' : ''} onClick={() => setWorkstream(value)}>{value}</button>)}
    </div>
    <p className="planner-mobile-scope-note">Showing {workstream === 'all' ? 'all workstreams' : workstream}</p>
    <div className="planner-mobile-bucket-tabs" role="tablist" aria-label="Planner buckets">
      {buckets.map(bucket => <button type="button" role="tab" aria-selected={activeMobileBucketId === bucket.id} className={activeMobileBucketId === bucket.id ? 'is-active' : ''} key={bucket.id} onClick={() => { setMobileBucketPinned(true); setMobileBucketId(bucket.id) }}>{bucket.name}</button>)}
    </div>

    <div className="planner-scope-summary mt-4 flex flex-wrap items-center gap-3 text-caption text-text-muted">
      <span>{scopeLine}</span>
      {filtersHiding && <button type="button" className="text-caption font-medium text-navy underline underline-offset-2" onClick={clearHiddenFilters}>Clear filters</button>}
    </div>

    {createPanel}
    {(bucketError || workstreamError) && <p className="auth-error" role="alert">{bucketError || workstreamError}</p>}

    <div ref={boardRef} className={`planner-board mt-[17px] flex gap-4 overflow-x-auto pb-2${draggedBucketId ? ' is-bucket-dragging' : ''}`} aria-label="Planner board" onDragOver={scrollBucketBoard}>
      {buckets.map(bucket => {
        const reorderScope = reorderScopeFor(bucket)
        const reorderLaneBuckets = reorderScope ? reorderBucketsFor(reorderScope) : []
        const persistedIndex = reorderLaneBuckets.findIndex(item => item.id === bucket.id)
        const bucketDraggable = canManageBuckets && Boolean(reorderScope) && (typeof bucket.id === 'number' || bucket.id === 'backlog')
        const draggedBucket = reorderableBuckets.find(item => String(item.id) === String(draggedBucketId))
        const draggedBucketScope = draggedBucket ? reorderScopeFor(draggedBucket) : null
        const bucketDropAllowed = bucketDraggable && Boolean(draggedBucketId) && draggedBucketId !== bucket.id && sameReorderScope(draggedBucketScope, reorderScope)
        const isBucketDropTarget = Boolean(draggedBucketId) && dropBucketId === bucket.id && draggedBucketId !== bucket.id
        return <section className={`planner-column relative flex h-[744px] w-[304px] shrink-0 flex-col rounded-card bg-surface-secondary${isBucketDropTarget ? ' is-bucket-drop-target' : ''}${draggedBucketId === bucket.id ? ' is-bucket-source' : ''}${activeMobileBucketId === bucket.id ? ' is-mobile-active' : ''}`} key={bucket.id} data-bucket-id={String(bucket.id)}
          onDragEnter={event => { if (draggedTaskId || bucketDropAllowed) { event.preventDefault(); setDropBucketId(bucket.id) } else if (draggedBucketId) setDropBucketId(null) }}
          onDragOver={event => { if (draggedTaskId || bucketDropAllowed) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropBucketId(null) }}
          onDrop={event => {
            event.preventDefault()
            event.stopPropagation()
            const plain = event.dataTransfer.getData('text/plain')
            if ((draggedBucketId || plain.startsWith('bucket:')) && bucketDropAllowed) moveBucket(draggedBucketId || plain.slice(7), bucket.id)
            else {
              const taskId = draggedTaskId || Number(event.dataTransfer.getData('application/x-workspace-task') || plain.replace(/^task:/, ''))
              if (taskId) persistMove(taskId, bucket.name, allOrderedFor(bucket.name).length)
            }
            setDraggedTaskId(null); setDraggedBucketId(null); setDropBucketId(null)
          }}>
          <header className="planner-column-heading relative px-4 pt-3.5 pb-3" data-reorderable={bucketDraggable && editingBucketId !== bucket.id ? 'true' : undefined}>
            {bucketDraggable && editingBucketId !== bucket.id
              ? <span
                  className="planner-column-drag-surface"
                  draggable
                  title={`Drag ${bucket.name} to reorder`}
                  aria-hidden="true"
                  onDragStart={event => startBucketDrag(event, bucket)}
                  onDragEnd={() => { setDraggedBucketId(null); setDropBucketId(null) }}
                ><span className="planner-column-grip is-draggable" aria-hidden="true"><GripVertical size={16} strokeWidth={1.5} /></span></span>
              : <span className="planner-column-grip" aria-hidden="true"><GripVertical size={16} strokeWidth={1.5} /></span>}
            {editingBucketId === bucket.id
              ? <form className="flex items-center gap-1" onSubmit={event => submitBucketRename(event, bucket)}>
                  <input autoFocus value={bucketNameDraft} onChange={event => setBucketNameDraft(event.target.value)} aria-label={`Rename ${bucket.name}`} maxLength="80" className="h-7 min-w-0 flex-1 rounded-badge border border-border bg-card px-2 text-body-small text-text-primary outline-none" />
                  <button type="submit" aria-label={`Save ${bucket.name} name`} title="Save name"><Check size={14} /></button>
                  <button type="button" onClick={() => setEditingBucketId(null)} aria-label="Cancel rename" title="Cancel"><X size={14} /></button>
                </form>
              : <><strong className="planner-column-name block truncate pr-[54px] text-body-small font-semibold text-text-primary">{bucket.name}</strong>
                  <span className="planner-column-summary mt-0.5 block truncate pr-[54px] text-caption text-text-muted">{laneSummary(bucket.name)}</span></>}
            {canManageBuckets && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="planner-column-menu absolute right-2 top-4" aria-label={`Open actions for ${bucket.name}`} title={`Actions for ${bucket.name}`}><MoreHorizontal size={20} /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="planner-bucket-menu">
                <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Rename ${bucket.name}`} onSelect={() => startBucketRename(bucket)}><Pencil size={13} /><span>Rename</span></DropdownMenuItem>
                {bucketDraggable && <>
                  <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                  <DropdownMenuItem className="planner-bucket-menu-item" disabled={persistedIndex <= 0} aria-label={`Move ${bucket.name} left`} onSelect={() => nudgeBucket(bucket.id, -1)}><ArrowLeft size={13} /><span>Move left</span></DropdownMenuItem>
                  <DropdownMenuItem className="planner-bucket-menu-item" disabled={persistedIndex < 0 || persistedIndex >= reorderLaneBuckets.length - 1} aria-label={`Move ${bucket.name} right`} onSelect={() => nudgeBucket(bucket.id, 1)}><ArrowRight size={13} /><span>Move right</span></DropdownMenuItem>
                </>}
                <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                <DropdownMenuItem className="planner-bucket-menu-item" aria-label={`Archive ${bucket.name}`} onSelect={() => onArchiveBucket?.(bucket)}><Archive size={13} /><span>Archive</span></DropdownMenuItem>
                <DropdownMenuSeparator className="planner-bucket-menu-separator" />
                <DropdownMenuItem variant="destructive" className="planner-bucket-menu-item" aria-label={`Delete ${bucket.name}`} onSelect={() => onDeleteBucket?.(bucket)}><Trash2 size={13} /><span>Delete</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </header>
          {isBucketDropTarget && <div className="planner-bucket-drop-state" aria-hidden="true">
            <MoveHorizontal size={24} strokeWidth={2} />
            <strong>Drop here</strong>
            <span>{draggedBucketName} lands at position {dropBucketPosition}</span>
          </div>}
          <div className="planner-column-body flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
            {orderedFor(bucket.name).map(task => <PlannerTaskCard key={task.id} task={task} buckets={buckets} today={today} canReorder={canManageTasks || taskIsAssignedTo(task, currentUserId)} canDeletePermanently={canDeletePermanently} onOpen={onOpenTask} onDelete={onDeleteTask} onDeletePermanently={onDeletePermanently} onMove={moveTask} onStatusChange={onStatusChange} onDropBefore={dropBefore} draggedTaskId={draggedTaskId} setDraggedTaskId={setDraggedTaskId} dropTaskId={dropTaskId} setDropTaskId={setDropTaskId} />)}
            {(isDefaultBacklog(bucket) || (isMobilePlanner && activeMobileBucketId === bucket.id)) && <div className="planner-dropzone mt-3 flex h-12 shrink-0 items-center justify-center gap-1.5 rounded-icon bg-border">
              <ArrowDownToLine size={18} className="text-text-muted" aria-hidden="true" />
              <span className="text-caption font-medium text-text-muted">Drop task here</span>
            </div>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="planner-mobile-move-row" disabled={!mobileMoveTasks.length}>
                <FolderInput size={20} aria-hidden="true" />
                <span><strong>Move to bucket</strong><small>{mobileMoveTasks.length ? 'Choose a task, then set its bucket in details' : 'No tasks in this bucket'}</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="planner-mobile-move-menu">
              {mobileMoveTasks.map(task => <DropdownMenuItem className="planner-bucket-menu-item" key={task.id} onSelect={() => onOpenTask(task)}><FolderInput size={14} /><span>{task.title}</span></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="planner-mobile-sheet-peek">
            <span className="planner-mobile-sheet-handle" aria-hidden="true" />
            <div>
              <button type="button" className={status === 'blocked' ? 'is-active' : ''} onClick={() => setStatus(current => current === 'blocked' ? 'all' : 'blocked')}>Blocked {mobileSheetCounts.blocked}</button>
              <button type="button" className={dueFilter === 'overdue' ? 'is-active' : ''} onClick={() => setDueFilter(current => current === 'overdue' ? 'all' : 'overdue')}>Overdue {mobileSheetCounts.overdue}</button>
              <button type="button" className={assignee === '' ? 'is-active' : ''} onClick={() => setAssignee(current => current === '' ? 'all' : '')}>Unassigned {mobileSheetCounts.unassigned}</button>
            </div>
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
