import { useMemo, useState } from 'react'
import { Check, Search } from 'lucide-react'
import Avatar from './Avatar.jsx'
import { normalizeProjectTaskStatus } from './ProjectKanbanBoard.jsx'
import { AppSelect } from './ui/select.jsx'
import { formatDayMonthName, formatEstimateMinutes, toDateKey } from '../lib/workspace-format.js'

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To do' },
  { value: 'in progress', label: 'In progress' },
  { value: 'review', label: 'Review' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS = [
  { value: 'urgent', label: 'Urgent', badge: 'P1' },
  { value: 'high', label: 'High', badge: 'P2' },
  { value: 'normal', label: 'Normal', badge: 'P3' },
  { value: 'low', label: 'Low', badge: 'P4' },
]

const SORT_OPTIONS = [
  { value: 'due', label: 'due date' },
  { value: 'priority', label: 'priority' },
  { value: 'status', label: 'status' },
  { value: 'title', label: 'title' },
]

const DATE_OPTIONS = [
  { value: 'all', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' },
]

const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 }
const UNASSIGNED_FILTER = '__unassigned__'

function projectStatusKey(value) {
  return normalizeProjectTaskStatus(value).replaceAll(' ', '-')
}

function addDaysToDateKey(value, days) {
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

function statusDefinition(value) {
  const normalized = projectStatusKey(value)
  return STATUS_OPTIONS.find(option => projectStatusKey(option.value) === normalized) || STATUS_OPTIONS[0]
}

function priorityDefinition(value) {
  return PRIORITY_OPTIONS.find(option => option.value === normalizeProjectTaskStatus(value)) || PRIORITY_OPTIONS[2]
}

function statusSlug(value) {
  return statusDefinition(value).value.replaceAll('_', '-').replaceAll(' ', '-')
}

export default function ProjectTaskTable({
  tasks = [],
  members = [],
  canManageTasks = false,
  today = toDateKey(new Date()),
  onOpenTask,
  onComplete,
  onStatusChange,
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [bucketFilter, setBucketFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [sort, setSort] = useState('due')
  const [pendingTaskId, setPendingTaskId] = useState(null)

  const weekEnd = addDaysToDateKey(today, 7)
  const memberById = useMemo(() => new Map(members.map(member => [String(member.id), member])), [members])
  const bucketOptions = useMemo(() => [...new Set(tasks.map(task => task.bucket || 'Backlog'))].sort((left, right) => left.localeCompare(right)), [tasks])

  const memberForTask = (task) => {
    const ids = taskAssigneeIds(task)
    return ids.map(id => memberById.get(String(id))).find(Boolean)
      || memberById.get(String(task.assignee_id || ''))
      || members.find(member => memberLabel(member) === task.member)
      || null
  }

  const memberNameForTask = (task) => {
    const member = memberForTask(task)
    if (member) return memberLabel(member)
    return task.member && task.member !== 'Unassigned' ? task.member : 'Unassigned'
  }

  const memberMatchesTask = (member, task) => {
    if (taskAssigneeIds(task).some(id => String(id) === String(member.id))) return true
    if (String(task.assignee_id || '') === String(member.id)) return true
    const name = memberLabel(member)
    return Boolean(name && task.member === name)
  }

  const filteredTasks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const visible = tasks.filter(task => {
      const normalizedStatus = projectStatusKey(task.status)
      const normalizedPriority = normalizeProjectTaskStatus(task.priority || 'normal')
      const bucket = task.bucket || 'Backlog'
      const isDone = normalizedStatus === 'done'
      const isOverdue = Boolean(task.due_date && task.due_date < today && !isDone)
      const isDueThisWeek = Boolean(task.due_date && task.due_date >= today && task.due_date <= weekEnd && !isDone)

      if (needle && !`${task.title || ''} ${task.description || ''}`.toLowerCase().includes(needle)) return false
      if (statusFilter !== 'all' && normalizedStatus !== projectStatusKey(statusFilter)) return false
      if (priorityFilter !== 'all' && normalizedPriority !== normalizeProjectTaskStatus(priorityFilter)) return false
      if (bucketFilter !== 'all' && bucket !== bucketFilter) return false
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

    return visible.sort((left, right) => {
      if (sort === 'priority') {
        return (priorityRank[normalizeProjectTaskStatus(left.priority || 'normal')] ?? 9) - (priorityRank[normalizeProjectTaskStatus(right.priority || 'normal')] ?? 9)
          || (left.due_date || '9999-12-31').localeCompare(right.due_date || '9999-12-31')
          || Number(left.id) - Number(right.id)
      }
      if (sort === 'status') {
        return STATUS_OPTIONS.findIndex(option => option.value === statusDefinition(left).value) - STATUS_OPTIONS.findIndex(option => option.value === statusDefinition(right).value)
          || (left.due_date || '9999-12-31').localeCompare(right.due_date || '9999-12-31')
          || Number(left.id) - Number(right.id)
      }
      if (sort === 'title') {
        return String(left.title || '').localeCompare(String(right.title || '')) || Number(left.id) - Number(right.id)
      }
      return (left.due_date || '9999-12-31').localeCompare(right.due_date || '9999-12-31')
        || (priorityRank[normalizeProjectTaskStatus(left.priority || 'normal')] ?? 9) - (priorityRank[normalizeProjectTaskStatus(right.priority || 'normal')] ?? 9)
        || Number(left.id) - Number(right.id)
    })
  }, [assigneeFilter, bucketFilter, dateFilter, memberById, priorityFilter, query, sort, statusFilter, tasks, today, weekEnd])

  const summary = {
    completed: tasks.filter(task => projectStatusKey(task.status) === 'done').length,
    blocked: tasks.filter(task => projectStatusKey(task.status) === 'blocked').length,
    overdue: tasks.filter(task => projectStatusKey(task.status) !== 'done' && task.due_date && task.due_date < today).length,
  }
  const sortLabel = SORT_OPTIONS.find(option => option.value === sort)?.label || 'due date'
  const filtersActive = Boolean(query.trim()) || statusFilter !== 'all' || assigneeFilter !== 'all' || priorityFilter !== 'all' || bucketFilter !== 'all' || dateFilter !== 'all'

  const clearFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setAssigneeFilter('all')
    setPriorityFilter('all')
    setBucketFilter('all')
    setDateFilter('all')
  }

  const runTaskAction = async (task, action) => {
    if (pendingTaskId != null) return
    setPendingTaskId(task.id)
    try {
      await action()
    } finally {
      setPendingTaskId(null)
    }
  }

  const canEditTask = task => canManageTasks || task.can_edit !== false
  const canCompleteTask = task => canEditTask(task) && Boolean(onComplete)
  const canChangeStatus = task => canEditTask(task) && Boolean(onStatusChange)

  return (
    <section className="project-task-table-surface" aria-label="Project tasks">
      <div className="project-task-filterbar">
        <label className="project-task-search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tasks" aria-label="Search project tasks" />
        </label>
        <div className="project-task-filters">
          <AppSelect className="project-task-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </AppSelect>
          <AppSelect className="project-task-filter" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} aria-label="Filter by assignee">
            <option value="all">All assignees</option>
            {members.map(member => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}
            <option value={UNASSIGNED_FILTER}>Unassigned</option>
          </AppSelect>
          <AppSelect className="project-task-filter" value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} aria-label="Filter by priority">
            <option value="all">All priorities</option>
            {PRIORITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label} ({option.badge})</option>)}
          </AppSelect>
          <AppSelect className="project-task-filter" value={bucketFilter} onChange={event => setBucketFilter(event.target.value)} aria-label="Filter by bucket">
            <option value="all">All buckets</option>
            {bucketOptions.map(bucket => <option key={bucket} value={bucket}>{bucket}</option>)}
          </AppSelect>
          <AppSelect className="project-task-filter" value={dateFilter} onChange={event => setDateFilter(event.target.value)} aria-label="Filter by date">
            {DATE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </AppSelect>
        </div>
      </div>

      <div className="project-task-summary" aria-live="polite">
        <AppSelect
          className="project-task-summary-sort"
          value={sort}
          onChange={event => setSort(event.target.value)}
          renderValue={() => `${filteredTasks.length} \u00B7 Sort: ${sortLabel}`}
          aria-label="Sort tasks"
        >
          {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>Sort: {option.label}</option>)}
        </AppSelect>
        <span>{tasks.length} tasks {'\u00B7'} {summary.completed} completed {'\u00B7'} {summary.blocked} blocked {'\u00B7'} {summary.overdue} overdue</span>
      </div>

      <div className="project-task-section-heading"><h2>Tasks</h2></div>

      <div className="project-task-table-scroll">
        <table className="project-task-table">
          <caption className="sr-only">Project tasks</caption>
          <thead>
            <tr>
              <th className="project-task-done-column"><span className="sr-only">Done</span></th>
              <th>Task</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Assignee</th>
              <th>Bucket</th>
              <th>Due</th>
              <th>Estimate</th>
            </tr>
          </thead>
          <tbody>
            {filteredTasks.map(task => {
              const done = projectStatusKey(task.status) === 'done'
              const overdue = Boolean(task.due_date && task.due_date < today && !done)
              const priority = priorityDefinition(task.priority)
              const status = statusDefinition(task.status)
              const editable = canEditTask(task)
              const pending = String(pendingTaskId) === String(task.id)
              return (
                <tr className={done ? 'is-done' : ''} key={task.id}>
                  <td className="project-task-done-column">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      disabled={!canCompleteTask(task) || pending}
                      onClick={() => runTaskAction(task, () => onComplete?.(task.id))}
                      aria-label={`${done ? 'Reopen' : 'Complete'} ${task.title}`}
                      title={done ? 'Reopen task' : 'Mark task complete'}
                      className={`project-task-check${done ? ' is-checked' : ''}`}
                    >
                      <Check size={13} strokeWidth={3} aria-hidden="true" />
                    </button>
                  </td>
                  <td className="project-task-title-cell">
                    <button type="button" onClick={() => onOpenTask?.(task)} title={task.title}>{task.title}</button>
                  </td>
                  <td>
                    {canChangeStatus(task) ? (
                      <AppSelect
                        className={`project-task-status-select is-${statusSlug(status.value)}`}
                        value={status.value}
                        disabled={pending}
                        onChange={event => runTaskAction(task, () => onStatusChange?.(task.id, event.target.value))}
                        aria-label={`Change status for ${task.title}`}
                      >
                        {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </AppSelect>
                    ) : <span className={`project-task-status is-${statusSlug(status.value)}`}>{status.label}</span>}
                  </td>
                  <td><span className={`project-task-priority is-${priority.value}`} title={priority.label}>{priority.badge}</span></td>
                  <td><span className="project-task-assignee"><Avatar name={memberNameForTask(task)} avatarUrl={memberForTask(task)?.avatar_url} small /><span>{memberNameForTask(task)}</span></span></td>
                  <td><span className="project-task-bucket">{task.bucket || 'Backlog'}</span></td>
                  <td><span className={`project-task-due${overdue ? ' is-overdue' : ''}`}>{overdue ? 'Overdue' : formatDayMonthName(task.due_date) || '--'}</span></td>
                  <td><span className="project-task-estimate">{formatEstimateMinutes(task.estimate_minutes) || '--'}</span></td>
                </tr>
              )
            })}
            {!filteredTasks.length && (
              <tr>
                <td colSpan={8}>
                  <div className="project-task-empty" role="status">
                    <strong>{tasks.length ? 'No tasks match these filters' : 'No tasks are linked to this project'}</strong>
                    <span>{tasks.length ? 'Adjust the filters or search to see more project tasks.' : 'Create a task and assign it to this project to begin tracking delivery.'}</span>
                    {filtersActive && <button type="button" className="secondary-button" onClick={clearFilters}>Clear filters</button>}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
