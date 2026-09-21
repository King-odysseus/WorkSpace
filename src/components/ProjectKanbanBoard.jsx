import { useState } from 'react'
import { GripVertical } from 'lucide-react'
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

export function normalizeProjectTaskStatus(status) {
  return String(status || '').trim().toLowerCase().replaceAll('_', '-')
}

export function projectKanbanColumnForTask(task) {
  const status = normalizeProjectTaskStatus(task?.status)
  return PROJECT_KANBAN_COLUMNS.find(column => column.aliases.includes(status)) || PROJECT_KANBAN_COLUMNS[0]
}

export default function ProjectKanbanBoard({ tasks = [], onOpenTask, onStatusChange, canManageTasks = false }) {
  const [draggedTaskId, setDraggedTaskId] = useState(null)
  const [dropColumnId, setDropColumnId] = useState(null)
  const taskById = id => tasks.find(task => String(task.id) === String(id))
  const canMoveTask = task => Boolean(onStatusChange && (canManageTasks || task?.can_edit))
  const draggedTask = draggedTaskId ? taskById(draggedTaskId) : null

  const moveTask = (task, status) => {
    if (!task || !status || !canMoveTask(task)) return
    const currentColumn = projectKanbanColumnForTask(task)
    if (currentColumn.status === status) return
    onStatusChange?.(task.id, status)
  }

  const finishDrag = () => {
    setDraggedTaskId(null)
    setDropColumnId(null)
  }

  return <div className="project-kanban-columns">
    {PROJECT_KANBAN_COLUMNS.map(column => {
      const columnTasks = tasks.filter(task => projectKanbanColumnForTask(task).id === column.id)
      const canDrop = Boolean(draggedTask && column.status && canMoveTask(draggedTask) && projectKanbanColumnForTask(draggedTask).id !== column.id)
      return <section
        className={`project-kanban-column${canDrop && dropColumnId === column.id ? ' is-drop-target' : ''}`}
        key={column.id}
        aria-label={`${column.label} column`}
        onDragEnter={event => {
          if (!canDrop) return
          event.preventDefault()
          setDropColumnId(column.id)
        }}
        onDragOver={event => {
          if (!canDrop) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDropColumnId(null)
        }}
        onDrop={event => {
          if (!canDrop) return
          event.preventDefault()
          const plainId = event.dataTransfer.getData('text/plain').replace(/^task:/, '')
          const taskId = draggedTaskId || Number(event.dataTransfer.getData('application/x-workspace-task') || plainId)
          moveTask(taskById(taskId), column.status)
          finishDrag()
        }}
      >
        <div className="project-kanban-column-heading"><span>{column.label}</span><strong>{columnTasks.length}</strong></div>
        <div className="project-kanban-column-body">
          {columnTasks.map(task => {
            const editable = canMoveTask(task)
            const currentColumn = projectKanbanColumnForTask(task)
            return <article
              className={`project-kanban-task${draggedTaskId === task.id ? ' is-dragging' : ''}`}
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
