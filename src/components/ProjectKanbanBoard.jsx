import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Plus, Search } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { AppSelect } from './ui/select.jsx'
import BulkActionBar from './BulkActionBar.jsx'
import { formatDayMonthName, formatEstimateMinutes, toDateKey } from '../lib/workspace-format.js'

const COLUMN_DEFINITIONS = [
  { id: 'backlog', label: 'Backlog', status: null, apiStatus: null, aliases: ['', 'backlog'] },
  { id: 'todo', label: 'To do', status: 'todo', apiStatus: 'todo', aliases: ['todo', 'to-do', 'planned'] },
  { id: 'in-progress', label: 'In progress', status: 'in progress', apiStatus: 'in_progress', aliases: ['in progress', 'in-progress', 'doing'] },
  { id: 'review', label: 'Review', status: 'review', apiStatus: 'review', aliases: ['review', 'in-review'] },
  { id: 'blocked', label: 'Blocked', status: 'blocked', apiStatus: 'blocked', aliases: ['blocked'] },
  { id: 'on-hold', label: 'On hold', status: 'on_hold', apiStatus: 'on_hold', aliases: ['on_hold', 'on-hold', 'paused'] },
  { id: 'done', label: 'Done', status: 'done', apiStatus: 'done', aliases: ['done', 'completed'] },
]

const PRIORITY_DEFINITIONS = [
  { value: 'urgent', label: 'Urgent', badge: 'P1' },
  { value: 'high', label: 'High', badge: 'P2' },
  { value: 'normal', label: 'Normal', badge: 'P3' },
  { value: 'low', label: 'Low', badge: 'P4' },
]

const DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
]

const UNASSIGNED_FILTER = '__unassigned__'

// Done is where finished work collects, so it is the one lane that starts
// folded: a slim strip carrying the lane name and its count, expandable into a
// full lane you can read, reorder and drop cards into. The other lanes hold work
// still being done and are worth the width they take.
const COLLAPSIBLE_COLUMN_IDS = new Set(['done'])

export const PROJECT_KANBAN_COLUMNS = COLUMN_DEFINITIONS
const PROJECT_KANBAN_COLUMN_BY_ID = new Map(COLUMN_DEFINITIONS.map(column => [column.id, column]))
export const DEFAULT_PROJECT_KANBAN_COLUMN_ORDER = COLUMN_DEFINITIONS.map(column => column.id)

export function normalizeProjectKanbanColumnOrder(order) {
  const requested = Array.isArray(order) ? order.map(String) : []
  return [...new Set([...requested, ...DEFAULT_PROJECT_KANBAN_COLUMN_ORDER])].filter(id => PROJECT_KANBAN_COLUMN_BY_ID.has(id))
}

export function normalizeProjectTaskStatus(status) {
  return String(status || '').trim().toLowerCase().replaceAll('_', '-')
}

export function projectKanbanColumnForTask(task) {
  const status = normalizeProjectTaskStatus(task?.status)
  return PROJECT_KANBAN_COLUMNS.find(column => column.aliases.includes(status)) || PROJECT_KANBAN_COLUMNS[0]
}

function memberLabel(member) {
  return [member?.first_name, member?.last_name].filter(Boolean).join(' ') || member?.email || ''
}

function taskAssigneeIds(task) {
  return Array.isArray(task?.assignee_ids) ? task.assignee_ids : []
}

function taskHasAssignee(task) {
  return Boolean(taskAssigneeIds(task).length || task?.assignee_id || (task?.member && task.member !== 'Unassigned'))
}

function priorityDefinition(value) {
  return PRIORITY_DEFINITIONS.find(option => option.value === normalizeProjectTaskStatus(value)) || PRIORITY_DEFINITIONS[2]
}

function addDaysToDateKey(value, days) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function ProjectKanbanBoard({
  tasks = [],
  members = [],
  today = toDateKey(new Date()),
  onOpenTask,
  onStatusChange,
  onAddTask,
  canManageTasks = false,
  columnOrder,
  onColumnReorder,
  canReorderColumns = false,
  canDeletePermanently = false,
  onBulkArchive,
  onBulkDelete,
  onBulkMove,
}) {
  const [query, setQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [workstreamFilter, setWorkstreamFilter] = useState('all')
  // Same selection model as the planner: a mode rather than a per-card
  // checkbox, cleared whenever the mode is turned off so no hidden selection
  // survives out of sight.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState([])
  const clearSelection = () => setSelectedTaskIds([])
  const toggleSelectMode = () => {
    setSelectMode(current => !current)
    clearSelection()
  }
  const toggleTaskSelected = taskId => setSelectedTaskIds(current => (
    current.some(id => String(id) === String(taskId))
      ? current.filter(id => String(id) !== String(taskId))
      : [...current, taskId]
  ))
  const runBulk = async action => {
    const done = await action(selectedTaskIds)
    if (done) clearSelection()
  }
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  // Folded by default, not remembered across visits: the lane exists to keep
  // finished work out of the way, and a board that opened with Done unfolded
  // because of one earlier look would be the opposite of that.
  const [collapsedColumnIds, setCollapsedColumnIds] = useState(() => new Set(COLLAPSIBLE_COLUMN_IDS))
  const [dropTaskId, setDropTaskId] = useState(null)
  const [draggedColumnId, setDraggedColumnId] = useState(null)
  const [dropColumnId, setDropColumnId] = useState(null)
  const [dropColumnIndex, setDropColumnIndex] = useState(null)
  const [dropTaskColumnId, setDropTaskColumnId] = useState(null)
  const [revealColumnId, setRevealColumnId] = useState(null)
  const boardRef = useRef(null)
  const columnPointerDragRef = useRef(null)
  const taskById = id => tasks.find(task => String(task.id) === String(id))
  const memberById = useMemo(() => new Map(members.map(member => [String(member.id), member])), [members])
  const workstreamOptions = useMemo(
    () => [...new Set(tasks.map(task => task.workstream || task.bucket || 'Backlog'))].sort((left, right) => left.localeCompare(right)),
    [tasks],
  )
  const weekEnd = addDaysToDateKey(today, 7)
  const memberForTask = task => {
    const ids = taskAssigneeIds(task)
    return ids.map(id => memberById.get(String(id))).find(Boolean)
      || memberById.get(String(task.assignee_id || ''))
      || members.find(member => memberLabel(member) === task.member)
      || null
  }
  const memberMatchesTask = (member, task) => {
    if (taskAssigneeIds(task).some(id => String(id) === String(member.id))) return true
    if (String(task.assignee_id || '') === String(member.id)) return true
    const name = memberLabel(member)
    return Boolean(name && task.member === name)
  }
  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return tasks.filter(task => {
      const normalizedStatus = normalizeProjectTaskStatus(task.status)
      const normalizedPriority = normalizeProjectTaskStatus(task.priority || 'normal')
      const workstream = task.workstream || task.bucket || 'Backlog'
      const isDone = normalizedStatus === 'done'
      const isOverdue = Boolean(task.due_date && task.due_date < today && !isDone)
      const isDueThisWeek = Boolean(task.due_date && task.due_date >= today && task.due_date <= weekEnd && !isDone)

      if (needle && !`${task.title || ''} ${task.description || ''}`.toLowerCase().includes(needle)) return false
      if (statusFilter !== 'all' && projectKanbanColumnForTask(task).id !== statusFilter) return false
      if (priorityFilter !== 'all' && normalizedPriority !== normalizeProjectTaskStatus(priorityFilter)) return false
      if (workstreamFilter !== 'all' && workstream !== workstreamFilter) return false
      if (dateFilter === 'overdue' && !isOverdue) return false
      if (dateFilter === 'week' && !isDueThisWeek) return false
      if (dateFilter === 'none' && task.due_date) return false
      if (assigneeFilter === UNASSIGNED_FILTER && taskHasAssignee(task)) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== UNASSIGNED_FILTER) {
        const member = memberById.get(String(assigneeFilter))
        if (!member || !memberMatchesTask(member, task)) return false
      }
      return true
    })
  }, [assigneeFilter, dateFilter, memberById, members, priorityFilter, query, statusFilter, tasks, today, weekEnd, workstreamFilter])
  const canMoveTask = task => Boolean(onStatusChange && (canManageTasks || task?.can_edit))
  const draggedTask = draggedTaskId ? taskById(draggedTaskId) : null
  const orderedColumns = normalizeProjectKanbanColumnOrder(columnOrder).map(id => PROJECT_KANBAN_COLUMN_BY_ID.get(id))
  const allowColumnReorder = Boolean(canReorderColumns && onColumnReorder)

  useEffect(() => {
    if (revealColumnId === null || !boardRef.current) return undefined
    const frame = window.requestAnimationFrame(() => {
      const target = [...boardRef.current.querySelectorAll('[data-column-id]')].find(node => node.dataset.columnId === String(revealColumnId))
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      setRevealColumnId(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [columnOrder, revealColumnId])

  const moveTask = (task, status) => {
    if (!task || !status || !canMoveTask(task)) return
    const currentColumn = projectKanbanColumnForTask(task)
    if (currentColumn.status === status) return
    onStatusChange?.(task.id, status)
  }

  // Only the Done lane folds. Keeping the rule in one place means the heading,
  // the body and the add-task footer cannot disagree about which lane it is.
  const canCollapseColumn = column => COLLAPSIBLE_COLUMN_IDS.has(column.id)
  const isColumnCollapsed = column => canCollapseColumn(column) && collapsedColumnIds.has(column.id)
  const setColumnCollapsed = (columnId, collapsed) => setCollapsedColumnIds(current => {
    const next = new Set(current)
    if (collapsed) next.add(columnId)
    else next.delete(columnId)
    return next
  })

  const finishDrag = () => {
    setDraggedTaskId(null)
    setDropTaskId(null)
    setDraggedColumnId(null)
    setDropColumnId(null)
    setDropColumnIndex(null)
    setDropTaskColumnId(null)
  }

  const scrollColumnBoard = event => {
    const board = boardRef.current
    if (!board || (!draggedColumnId && !columnPointerDragRef.current?.dragging)) return
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

  const columnOrderForDrop = (sourceId, targetId, pointerX, targetElement) => {
    if (!allowColumnReorder || !sourceId || !targetId || sourceId === targetId) return
    const currentOrder = orderedColumns.map(column => column.id)
    const sourceIndex = currentOrder.indexOf(sourceId)
    const targetIndex = currentOrder.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const nextOrder = currentOrder.filter(id => id !== sourceId)
    const targetIndexAfterRemoval = nextOrder.indexOf(targetId)
    if (targetIndexAfterRemoval < 0) return
    const targetBounds = targetElement?.getBoundingClientRect?.()
    const targetMidpoint = targetBounds && Number.isFinite(targetBounds.left) && Number.isFinite(targetBounds.width)
      ? targetBounds.left + targetBounds.width / 2
      : null
    const insertAfterTarget = Number.isFinite(pointerX) && targetMidpoint !== null
      ? pointerX >= targetMidpoint
      : sourceIndex < targetIndex
    const insertionIndex = targetIndexAfterRemoval + (insertAfterTarget ? 1 : 0)
    nextOrder.splice(insertionIndex, 0, sourceId)
    return { order: nextOrder, position: insertionIndex + 1 }
  }

  const moveColumn = (sourceId, targetId, pointerX, targetElement) => {
    const placement = columnOrderForDrop(sourceId, targetId, pointerX, targetElement)
    if (!placement) return
    onColumnReorder(placement.order)
    setRevealColumnId(sourceId)
  }
  const columnNodeAtPoint = (clientX, clientY) => {
    if (!boardRef.current || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
    const nodes = [...boardRef.current.querySelectorAll('[data-column-id]')]
    const direct = nodes.find(node => {
      const bounds = node.getBoundingClientRect()
      return clientX >= bounds.left && clientX <= bounds.right && clientY >= bounds.top && clientY <= bounds.bottom
    })
    if (direct) return direct
    return nodes.reduce((nearest, node) => {
      const bounds = node.getBoundingClientRect()
      const distance = Math.abs(clientX - (bounds.left + bounds.width / 2))
      return distance < nearest.distance ? { distance, node } : nearest
    }, { distance: Number.POSITIVE_INFINITY, node: null }).node
  }
  const updateColumnPointerTarget = event => {
    const drag = columnPointerDragRef.current
    if (!drag?.dragging) return
    scrollColumnBoard(event)
    const targetNode = columnNodeAtPoint(event.clientX, event.clientY)
    const targetId = targetNode?.dataset.columnId
    if (!targetNode || !allowColumnReorder || String(drag.sourceId) === String(targetId)) {
      setDropColumnId(null)
      setDropColumnIndex(null)
      return
    }
    const placement = columnOrderForDrop(drag.sourceId, targetId, event.clientX, targetNode)
    setDropColumnId(targetId ?? null)
    setDropColumnIndex(placement?.position ?? null)
    setDropTaskColumnId(null)
  }
  const finishColumnPointerDrag = (event, commit) => {
    const drag = columnPointerDragRef.current
    if (!drag) return
    if (commit && drag.dragging) {
      const targetNode = columnNodeAtPoint(event.clientX, event.clientY)
      const targetId = targetNode?.dataset.columnId
      if (targetNode && allowColumnReorder && String(drag.sourceId) !== String(targetId)) moveColumn(drag.sourceId, targetId, event.clientX, targetNode)
    }
    const { captureTarget, pointerId } = drag
    columnPointerDragRef.current = null
    if (captureTarget?.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId)
    setDraggedColumnId(null)
    setDropColumnId(null)
    setDropColumnIndex(null)
  }
  const startColumnPointerDrag = (event, column) => {
    if (!allowColumnReorder || (event.button !== 0 && event.pointerType === 'mouse')) return
    if (event.target.closest?.('button, a, input, textarea, select, [role="menuitem"]')) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    columnPointerDragRef.current = {
      sourceId: column.id,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    }
  }
  const moveColumnPointerDrag = event => {
    const drag = columnPointerDragRef.current
    if (!drag) return
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.dragging = true
      setDraggedColumnId(drag.sourceId)
      setDropColumnIndex(null)
    }
    event.preventDefault()
    updateColumnPointerTarget(event)
  }

  const nudgeColumn = (columnId, direction) => {
    const currentOrder = orderedColumns.map(column => column.id)
    const sourceIndex = currentOrder.indexOf(columnId)
    const targetIndex = sourceIndex + direction
    if (!allowColumnReorder || sourceIndex < 0 || targetIndex < 0 || targetIndex >= currentOrder.length) return
    const nextOrder = [...currentOrder]
    const [moved] = nextOrder.splice(sourceIndex, 1)
    nextOrder.splice(targetIndex, 0, moved)
    onColumnReorder(nextOrder)
    setRevealColumnId(columnId)
  }

  return <div className="project-kanban-board">
    <div className="project-kanban-toolbar">
      <div className="project-kanban-filter-row">
        {canManageTasks && <button type="button" className={`project-kanban-filter project-kanban-select-toggle${selectMode ? ' is-active' : ''}`} onClick={toggleSelectMode} aria-pressed={selectMode}>{selectMode ? 'Done selecting' : 'Select'}</button>}
        <label className="project-kanban-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search project kanban tasks" />
        </label>
        <AppSelect className="project-kanban-filter" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} aria-label="Filter project kanban by assignee">
          <option value="all">All assignees</option>
          {members.map(member => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
          <option value={UNASSIGNED_FILTER}>Unassigned</option>
        </AppSelect>
        <AppSelect className="project-kanban-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter project kanban by status">
          <option value="all">All statuses</option>
          {PROJECT_KANBAN_COLUMNS.map(column => <option key={column.id} value={column.id}>{column.label}</option>)}
        </AppSelect>
        <AppSelect className="project-kanban-filter" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} aria-label="Filter project kanban by priority">
          <option value="all">All priorities</option>
          {PRIORITY_DEFINITIONS.map(option => <option key={option.value} value={option.value}>{option.label} ({option.badge})</option>)}
        </AppSelect>
        <AppSelect className="project-kanban-filter" value={dateFilter} onChange={event => setDateFilter(event.target.value)} aria-label="Filter project kanban by date">
          {DATE_FILTER_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </AppSelect>
        <AppSelect className="project-kanban-filter" value={workstreamFilter} onChange={event => setWorkstreamFilter(event.target.value)} aria-label="Filter project kanban by workstream">
          <option value="all">All workstreams</option>
          {workstreamOptions.map(workstream => <option key={workstream} value={workstream}>{workstream}</option>)}
        </AppSelect>
      </div>
      <div className="project-kanban-action-row">
        {canManageTasks && onAddTask && <button type="button" className="project-kanban-add-task" onClick={() => onAddTask(null)}><Plus size={15} />New task</button>}
        <span className="project-kanban-summary" aria-live="polite">{filteredTasks.length} {filteredTasks.length === 1 ? 'task' : 'tasks'} in {orderedColumns.length} lanes</span>
      </div>
    </div>
    <div
      ref={boardRef}
      className="project-kanban-columns"
      role="region"
      aria-label="Project Kanban board"
      onDragOver={scrollColumnBoard}
      onPointerMove={moveColumnPointerDrag}
      onPointerUp={event => finishColumnPointerDrag(event, true)}
      onPointerCancel={event => finishColumnPointerDrag(event, false)}
      onLostPointerCapture={event => {
        if (columnPointerDragRef.current?.pointerId === event.pointerId) finishColumnPointerDrag(event, false)
      }}
    >
    {orderedColumns.map((column, columnIndex) => {
      const columnTasks = filteredTasks.filter(task => projectKanbanColumnForTask(task).id === column.id)
      const estimatedMinutes = columnTasks.reduce((total, task) => total + (Number(task.estimate_minutes) || 0), 0)
      const canDrop = Boolean(draggedTask && column.status && canMoveTask(draggedTask) && projectKanbanColumnForTask(draggedTask).id !== column.id)
      const isColumnDropTarget = Boolean(draggedColumnId && draggedColumnId !== column.id && dropColumnId === column.id && allowColumnReorder)
      const collapsed = isColumnCollapsed(column)
      return <section
        className={`project-kanban-column${collapsed ? ' is-collapsed' : ''}${canDrop && dropTaskColumnId === column.id ? ' is-drop-target' : ''}${isColumnDropTarget ? ' is-column-drop-target' : ''}${draggedColumnId === column.id ? ' is-column-source' : ''}`}
        key={column.id}
        data-column-id={column.id}
        data-drop-position={isColumnDropTarget && dropColumnIndex ? String(dropColumnIndex) : undefined}
        aria-label={`${column.label} column`}
        onDragEnter={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            const placement = columnOrderForDrop(draggedColumnId, column.id, event.clientX, event.currentTarget)
            setDropColumnId(column.id)
            setDropColumnIndex(placement?.position ?? null)
            setDropTaskColumnId(null)
            return
          }
          setDropColumnId(null)
          setDropColumnIndex(null)
          if (!canDrop) return
          event.preventDefault()
          setDropTaskColumnId(column.id)
        }}
        onDragOver={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const placement = columnOrderForDrop(draggedColumnId, column.id, event.clientX, event.currentTarget)
            setDropColumnId(column.id)
            setDropColumnIndex(placement?.position ?? null)
            return
          }
          if (!canDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDragLeave={event => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setDropColumnId(null)
          setDropColumnIndex(null)
          setDropTaskColumnId(null)
        }}
        onDrop={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            event.stopPropagation()
            moveColumn(draggedColumnId, column.id, event.clientX, event.currentTarget)
            finishDrag()
            return
          }
          if (!canDrop) return
          event.preventDefault()
          const plainId = event.dataTransfer.getData('text/plain').replace(/^task:/, '')
          const taskId = draggedTaskId || Number(event.dataTransfer.getData('application/x-workspace-task') || plainId)
          moveTask(taskById(taskId), column.status)
          finishDrag()
        }}
      >
        <div
          className={`project-kanban-column-heading${collapsed ? ' is-collapsed' : ''}`}
          data-reorderable={allowColumnReorder ? 'true' : undefined}
          draggable={allowColumnReorder}
          onDragStart={event => {
            if (columnPointerDragRef.current) {
              event.preventDefault()
              return
            }
            if (!allowColumnReorder || event.target.closest('button')) {
              event.preventDefault()
              return
            }
            event.stopPropagation()
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('application/x-workspace-kanban-column', column.id)
            event.dataTransfer.setData('text/plain', `column:${column.id}`)
            setDraggedColumnId(column.id)
          }}
          onDragEnd={finishDrag}
          onPointerDown={event => startColumnPointerDrag(event, column)}
        >
          {collapsed ? <>
            <button
              type="button"
              className="project-kanban-column-collapse"
              onClick={() => setColumnCollapsed(column.id, false)}
              aria-expanded="false"
              aria-label={`Show ${column.label} (${columnTasks.length} ${columnTasks.length === 1 ? 'item' : 'items'})`}
              title={`Show ${column.label}`}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <span className="project-kanban-column-collapsed-label">{column.label}</span>
            <span className="project-kanban-column-collapsed-count" aria-hidden="true">{columnTasks.length}</span>
          </> : <>
            <span className="project-kanban-column-heading-label">
              {allowColumnReorder && <GripVertical className="project-kanban-column-grip" size={15} strokeWidth={1.7} title={`Drag ${column.label} to reorder`} aria-hidden="true" />}
              <span>{column.label}</span>
            </span>
            <span className="project-kanban-column-heading-actions">
              {canCollapseColumn(column) && <button type="button" className="project-kanban-column-collapse" onClick={() => setColumnCollapsed(column.id, true)} aria-expanded="true" aria-label={`Hide ${column.label} (${columnTasks.length} ${columnTasks.length === 1 ? 'item' : 'items'})`} title={`Hide ${column.label}`}><ChevronDown size={13} aria-hidden="true" /></button>}
              {allowColumnReorder && <button type="button" className="project-kanban-column-order-button" disabled={columnIndex === 0} onClick={() => nudgeColumn(column.id, -1)} aria-label={`Move ${column.label} left`} title={`Move ${column.label} left`}><ChevronLeft size={13} /></button>}
              <span className="project-kanban-column-count"><strong>{columnTasks.length}</strong><small>tasks</small><i>{formatEstimateMinutes(estimatedMinutes) || '0h'}</i></span>
              {allowColumnReorder && <button type="button" className="project-kanban-column-order-button" disabled={columnIndex === orderedColumns.length - 1} onClick={() => nudgeColumn(column.id, 1)} aria-label={`Move ${column.label} right`} title={`Move ${column.label} right`}><ChevronRight size={13} /></button>}
            </span>
          </>}
        </div>
        {!collapsed && <div className="project-kanban-column-body">
          {columnTasks.map(task => {
            const editable = canMoveTask(task)
            const currentColumn = projectKanbanColumnForTask(task)
            const canDropOnTask = Boolean(draggedTask && String(draggedTask.id) !== String(task.id) && canDrop && projectKanbanColumnForTask(draggedTask).id !== currentColumn.id)
            const assignee = memberForTask(task)
            const assigneeName = assignee ? memberLabel(assignee) : task.member && task.member !== 'Unassigned' ? task.member : 'Unassigned'
            const priority = priorityDefinition(task.priority)
            const dueLabel = formatDayMonthName(task.due_date)
            const overdue = Boolean(task.due_date && task.due_date < today && currentColumn.id !== 'done')
            const selected = selectedTaskIds.some(id => String(id) === String(task.id))
            return <article
              className={`project-kanban-task${draggedTaskId === task.id ? ' is-dragging' : ''}${canDropOnTask && dropTaskId === task.id ? ' is-drop-target' : ''}${selectMode ? ' is-selectable' : ''}${selected ? ' is-selected' : ''}`}
              key={task.id}
              draggable={editable && !selectMode}
              onClick={selectMode ? () => toggleTaskSelected(task.id) : undefined}
              aria-pressed={selectMode ? selected : undefined}
              onDragStart={event => {
                if (!editable) return
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('application/x-workspace-task', String(task.id))
                event.dataTransfer.setData('text/plain', `task:${task.id}`)
                setDraggedTaskId(task.id)
              }}
              onDragEnd={finishDrag}
              onDragEnter={event => {
                if (!canDropOnTask) return
                event.preventDefault()
                setDropTaskId(task.id)
              }}
              onDragOver={event => {
                if (!canDropOnTask) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTaskId(task.id)
              }}
              onDragLeave={event => {
                if (event.currentTarget.contains(event.relatedTarget)) return
                setDropTaskId(current => current === task.id ? null : current)
              }}
            >
              <div className="project-kanban-task-heading">
                {editable && <GripVertical size={13} strokeWidth={1.7} aria-hidden="true" />}
                <button type="button" className="project-kanban-task-open" onClick={() => onOpenTask?.(task)}>{task.title}</button>
              </div>
              <div className={`project-kanban-task-due${overdue ? ' is-overdue' : ''}`}>
                <CalendarDays size={13} aria-hidden="true" />
                <span>{overdue ? 'Overdue' : dueLabel || 'No due date'}</span>
              </div>
              <div className="project-kanban-task-footer">
                <span className="project-kanban-task-assignee" title={assigneeName}>
                  <Avatar name={assigneeName} avatarUrl={assignee?.avatar_url} small />
                  <span className="sr-only">Assigned to {assigneeName}</span>
                </span>
                <span className="project-kanban-task-tags">
                  <span className={`project-kanban-priority is-${priority.value}`} title={priority.label}>{priority.badge}</span>
                {editable ? <AppSelect
                  className={`project-kanban-status ${currentColumn.id}`}
                  value={currentColumn.id}
                  onChange={event => {
                    const nextColumn = PROJECT_KANBAN_COLUMNS.find(item => item.id === event.target.value)
                    if (nextColumn?.status) moveTask(task, nextColumn.status)
                  }}
                  aria-label={`Change status for ${task.title}`}
                >
                  <option value="backlog" disabled>Backlog</option>
                  {PROJECT_KANBAN_COLUMNS.filter(item => item.status).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </AppSelect> : <small>{currentColumn.label}</small>}
                </span>
              </div>
            </article>
          })}
        </div>}
        {!collapsed && canManageTasks && onAddTask && <button type="button" className="project-kanban-add-column-task" onClick={() => onAddTask(column)} aria-label={`Add task to ${column.label}`}><Plus size={14} />Add task</button>}
      </section>
    })}
    </div>
    <BulkActionBar
      selectedCount={selectedTaskIds.length}
      destinations={PROJECT_KANBAN_COLUMNS.filter(column => column.status).map(column => ({ value: column.status, label: column.label }))}
      destinationLabel="Move to status"
      onMove={status => runBulk(ids => onBulkMove?.(ids, status))}
      onArchive={() => runBulk(ids => onBulkArchive?.(ids))}
      onDelete={canDeletePermanently ? () => runBulk(ids => onBulkDelete?.(ids)) : undefined}
      onClear={clearSelection}
    />
  </div>
}
