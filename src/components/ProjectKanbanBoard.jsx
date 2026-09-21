import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react'
import { AppSelect } from './ui/select.jsx'

const COLUMN_DEFINITIONS = [
  { id: 'backlog', label: 'Backlog', status: null, aliases: ['', 'backlog'] },
  { id: 'todo', label: 'To do', status: 'todo', aliases: ['todo', 'to-do', 'planned'] },
  { id: 'in-progress', label: 'In progress', status: 'in progress', aliases: ['in progress', 'in-progress', 'doing'] },
  { id: 'review', label: 'Review', status: 'review', aliases: ['review', 'in-review'] },
  { id: 'blocked', label: 'Blocked', status: 'blocked', aliases: ['blocked'] },
  { id: 'on-hold', label: 'On hold', status: 'on_hold', aliases: ['on_hold', 'on-hold', 'paused'] },
  { id: 'done', label: 'Done', status: 'done', aliases: ['done', 'completed'] },
]

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

export default function ProjectKanbanBoard({ tasks = [], onOpenTask, onStatusChange, canManageTasks = false, columnOrder, onColumnReorder, canReorderColumns = false }) {
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  const [dropTaskId, setDropTaskId] = useState(null)
  const [draggedColumnId, setDraggedColumnId] = useState(null)
  const [dropColumnId, setDropColumnId] = useState(null)
  const [dropColumnIndex, setDropColumnIndex] = useState(null)
  const [dropTaskColumnId, setDropTaskColumnId] = useState(null)
  const [revealColumnId, setRevealColumnId] = useState(null)
  const boardRef = useRef(null)
  const columnPointerDragRef = useRef(null)
  const taskById = id => tasks.find(task => String(task.id) === String(id))
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

  return <div
    ref={boardRef}
    className="project-kanban-columns"
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
      const columnTasks = tasks.filter(task => projectKanbanColumnForTask(task).id === column.id)
      const canDrop = Boolean(draggedTask && column.status && canMoveTask(draggedTask) && projectKanbanColumnForTask(draggedTask).id !== column.id)
      const isColumnDropTarget = Boolean(draggedColumnId && draggedColumnId !== column.id && dropColumnId === column.id && allowColumnReorder)
      return <section
        className={`project-kanban-column${canDrop && dropTaskColumnId === column.id ? ' is-drop-target' : ''}${isColumnDropTarget ? ' is-column-drop-target' : ''}${draggedColumnId === column.id ? ' is-column-source' : ''}`}
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
          className="project-kanban-column-heading"
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
          <span className="project-kanban-column-heading-label">
            {allowColumnReorder && <GripVertical className="project-kanban-column-grip" size={15} strokeWidth={1.7} title={`Drag ${column.label} to reorder`} aria-hidden="true" />}
            <span>{column.label}</span>
          </span>
          <span className="project-kanban-column-heading-actions">
            {allowColumnReorder && <button type="button" className="project-kanban-column-order-button" disabled={columnIndex === 0} onClick={() => nudgeColumn(column.id, -1)} aria-label={`Move ${column.label} left`} title={`Move ${column.label} left`}><ChevronLeft size={13} /></button>}
            <strong>{columnTasks.length}</strong>
            {allowColumnReorder && <button type="button" className="project-kanban-column-order-button" disabled={columnIndex === orderedColumns.length - 1} onClick={() => nudgeColumn(column.id, 1)} aria-label={`Move ${column.label} right`} title={`Move ${column.label} right`}><ChevronRight size={13} /></button>}
          </span>
        </div>
        <div className="project-kanban-column-body">
          {columnTasks.map(task => {
            const editable = canMoveTask(task)
            const currentColumn = projectKanbanColumnForTask(task)
            const canDropOnTask = Boolean(draggedTask && String(draggedTask.id) !== String(task.id) && canDrop && projectKanbanColumnForTask(draggedTask).id !== currentColumn.id)
            return <article
              className={`project-kanban-task${draggedTaskId === task.id ? ' is-dragging' : ''}${canDropOnTask && dropTaskId === task.id ? ' is-drop-target' : ''}`}
              key={task.id}
              draggable={editable}
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
              <div className="project-kanban-task-footer">
                <span>{task.priority || 'Normal'}</span>
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
              </div>
            </article>
          })}
        </div>
      </section>
    })}
  </div>
}
