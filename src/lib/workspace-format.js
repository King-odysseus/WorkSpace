// Framework-free helpers shared across the workspace UI: formatting, date maths,
// API-shape mapping, and the CSRF/JSON plumbing every fetch in the app goes through.
// Kept out of main.jsx so they can be imported by view modules without dragging in
// the whole application shell.

const PRESENCE_LABEL = { available: 'Available', busy: 'Busy', away: 'Away', offline: 'Offline' }
const PRESENCE_OPTIONS = ['available', 'busy', 'away', 'offline']
const WORK_SHIFT_TOAST = { clock_in: 'Clocked in.', clock_out: 'Clocked out.', start_break: 'Break started.', end_break: 'Back from break.' }
const BREAK_PRESETS = [30, 60]
const BREAK_PRESET_LABEL = { 30: '30 min', 60: '1 hr' }
function formatShiftDuration(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const pad = value => String(value).padStart(2, '0')
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor(safe / 60) % 60)}:${pad(safe % 60)}`
}

function formatHoursLabel(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds))
  return safe < 60 ? `${safe}s` : `${Math.floor(safe / 3600)}h ${String(Math.floor(safe / 60) % 60).padStart(2, '0')}m`
}

function formatShiftClock(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
}

function initialsFor(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function toDateKey(value) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function taskDueLabel(dueDate, today) {
  if (!dueDate) return 'No due date'
  return dueDate < today ? 'Overdue' : dueDate
}

function taskSearchText(task) {
  return [task.title, task.description, task.member, task.tag, task.bucket, ...(task.labels || [])].filter(Boolean).join(' ').toLowerCase()
}

// Single source of truth for turning an API task into the shape the UI uses.
// Every place that receives a task from the API must go through this, otherwise
// new fields silently go missing on whichever code path was not updated.
function mapTaskFromApi(apiTask, { today, workspaceRole, currentUserId } = {}) {
  return {
    id: apiTask.id,
    title: apiTask.title,
    description: apiTask.description || '',
    member: apiTask.assignee_name || 'Unassigned',
    tag: apiTask.project || 'General',
    status: apiTask.status === 'in_progress' ? 'in progress' : apiTask.status,
    priority: apiTask.priority || 'normal',
    due: taskDueLabel(apiTask.due_date, today),
    due_date: apiTask.due_date || '',
    completed_at: apiTask.completed_at || '',
    created_at: apiTask.created_at || '',
    estimate: 'n/a',
    can_edit: ['owner', 'manager'].includes(workspaceRole) || apiTask.assignee_id === currentUserId,
    recurrence: apiTask.recurrence || 'none',
    assignee_id: apiTask.assignee_id || '',
    project_id: apiTask.project_id || '',
    bucket: apiTask.bucket || 'Backlog',
    position: apiTask.position || 0,
    labels: apiTask.labels || [],
    task_code: apiTask.code || '',
    workstream: apiTask.workstream || '',
    workstream_id: apiTask.workstream_id || '',
    phase: apiTask.phase || '',
    phase_id: apiTask.phase_id || '',
    start_date: apiTask.start_date || '',
    actual_completion_date: apiTask.actual_completion_date || '',
    progress_percent: apiTask.progress_percent ?? 0,
    blocker_details: apiTask.blocker_details || '',
    state: apiTask.state || 'active',
    archived_at: apiTask.archived_at || '',
    supporters: apiTask.supporter_ids || [],
    blocked_by_ids: apiTask.blocked_by_ids || [],
    blocking_ids: apiTask.blocking_ids || [],
    is_blocked_by_dependency: apiTask.is_blocked_by_dependency || false,
  }
}

function formatRelativeActivityTime(value) {
  const date = new Date(value)
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatCalendarDate(value, options) {
  return new Intl.DateTimeFormat(undefined, options).format(value)
}

function toDateTimeLocal(value) {
  const date = new Date(value)
  const pad = number => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function googleCalendarUrl(event) {
  const formatGoogleDate = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, details: event.description || '', dates: `${formatGoogleDate(event.start_at)}/${formatGoogleDate(event.end_at)}` })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function getCalendarDays(view, referenceDate) {
  const year = referenceDate.getFullYear()
  const month = referenceDate.getMonth()
  if (view === 'day') return [new Date(year, month, referenceDate.getDate())]
  if (view === 'year') return Array.from({ length: 12 }, (_, index) => new Date(year, index, 1))
  if (view === 'month') {
    const first = new Date(year, month, 1)
    const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7))
    return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  }
  const mondayOffset = (referenceDate.getDay() + 6) % 7
  const monday = new Date(year, month, referenceDate.getDate() - mondayOffset)
  return Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index))
}

function readCsrfCookie() {
  const cookie = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))
  return cookie?.split('=')[1] || ''
}

async function getCsrfToken() {
  const existing = readCsrfCookie()
  if (existing) return existing
  await fetch('/api/auth/csrf/', { credentials: 'include' })
  return readCsrfCookie()
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} (server returned ${response.status})`)
  }
  return response.json()
}

export {
  PRESENCE_LABEL,
  PRESENCE_OPTIONS,
  WORK_SHIFT_TOAST,
  BREAK_PRESETS,
  BREAK_PRESET_LABEL,
  formatShiftDuration,
  formatHoursLabel,
  formatShiftClock,
  initialsFor,
  toDateKey,
  taskDueLabel,
  taskSearchText,
  mapTaskFromApi,
  formatRelativeActivityTime,
  formatCalendarDate,
  toDateTimeLocal,
  googleCalendarUrl,
  getCalendarDays,
  getCsrfToken,
  readJsonResponse,
}
