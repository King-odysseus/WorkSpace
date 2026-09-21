import { useState } from 'react'
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
  const [dropTaskColumnId, setDropTaskColumnId] = useState(null)
  const taskById = id => tasks.find(task => String(task.id) === String(id))
  const canMoveTask = task => Boolean(onStatusChange && (canManageTasks || task?.can_edit))
  const draggedTask = draggedTaskId ? taskById(draggedTaskId) : null
  const orderedColumns = normalizeProjectKanbanColumnOrder(columnOrder).map(id => PROJECT_KANBAN_COLUMN_BY_ID.get(id))
  const allowColumnReorder = Boolean(canReorderColumns && onColumnReorder)

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
    setDropTaskColumnId(null)
  }

  const moveColumn = (sourceId, targetId) => {
    if (!allowColumnReorder || !sourceId || !targetId || sourceId === targetId) return
    const currentOrder = orderedColumns.map(column => column.id)
    const sourceIndex = currentOrder.indexOf(sourceId)
    const targetIndex = currentOrder.indexOf(targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const nextOrder = [...currentOrder]
    const [moved] = nextOrder.splice(sourceIndex, 1)
    nextOrder.splice(targetIndex, 0, moved)
    onColumnReorder(nextOrder)
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
  }

  return <div className="project-kanban-columns" aria-label="Project Kanban board">
    {orderedColumns.map((column, columnIndex) => {
      const columnTasks = tasks.filter(task => projectKanbanColumnForTask(task).id === column.id)
      const canDrop = Boolean(draggedTask && column.status && canMoveTask(draggedTask) && projectKanbanColumnForTask(draggedTask).id !== column.id)
      const isColumnDropTarget = Boolean(draggedColumnId && draggedColumnId !== column.id && dropColumnId === column.id && allowColumnReorder)
      return <section
        className={`project-kanban-column${canDrop && dropTaskColumnId === column.id ? ' is-drop-target' : ''}${isColumnDropTarget ? ' is-column-drop-target' : ''}${draggedColumnId === column.id ? ' is-column-source' : ''}`}
        key={column.id}
        aria-label={`${column.label} column`}
        onDragEnter={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            setDropColumnId(column.id)
            setDropTaskColumnId(null)
            return
          }
          setDropColumnId(null)
          if (!canDrop) return
          event.preventDefault()
          setDropTaskColumnId(column.id)
        }}
        onDragOver={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            return
          }
          if (!canDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDragLeave={event => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setDropColumnId(null)
          setDropTaskColumnId(null)
        }}
        onDrop={event => {
          if (draggedColumnId && draggedColumnId !== column.id && allowColumnReorder) {
            event.preventDefault()
            event.stopPropagation()
            moveColumn(draggedColumnId, column.id)
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
