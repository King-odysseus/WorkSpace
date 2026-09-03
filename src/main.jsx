import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle, Archive, ArrowUpRight, BarChart3, Bell, Brush, Building2, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, ClipboardList,
  CircleHelp, Clock3, Filter, FileText, Hash, LayoutDashboard, LayoutGrid, LogOut, MessageSquare, MoreHorizontal,
  ChevronLeft, ChevronRight,
  Plus, Search, Settings, Sparkles, Target, Users, X, Sun, Moon
} from 'lucide-react'
import 'flowbite/dist/flowbite.css'
import './tijhabooks-theme.css'
import './index.css'
import { Button } from './components/ui/button.jsx'
import { Badge } from './components/ui/badge.jsx'
import { Card, CardContent, CardHeader } from './components/ui/card.jsx'
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs.jsx'
import { Popover, PopoverTrigger, PopoverContent } from './components/ui/popover.jsx'
import PlannerBoard from './components/PlannerBoard.jsx'
import WorkScopeSelector, { taskMatchesScope } from './components/WorkScopeSelector.jsx'
import { Calendar as DatePicker } from './components/ui/calendar.jsx'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './components/ui/dialog.jsx'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './components/ui/select.jsx'
import { cn } from './lib/utils.js'
import toast, { Toaster } from 'react-hot-toast'

const PRESENCE_LABEL = { available: 'Available', busy: 'Busy', away: 'Away', offline: 'Offline' }

function initialsFor(name) {
  return (name || '').trim().split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function Avatar({ name, avatarUrl, presence, color = 'blue', small = false, className = '' }) {
  return <span className={`avatar ${color} ${small ? 'small' : ''} ${className}`}>
    {avatarUrl ? <img src={avatarUrl} alt="" /> : initialsFor(name)}
    {presence && <span className={`presence-dot presence-${presence}`} title={PRESENCE_LABEL[presence] || presence} />}
  </span>
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

async function getCsrfToken() {
  await fetch('/api/auth/csrf/', { credentials: 'include' })
  const cookie = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))
  return cookie?.split('=')[1] || ''
}

async function readJsonResponse(response, fallbackMessage) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    throw new Error(response.ok ? fallbackMessage : `${fallbackMessage} (server returned ${response.status})`)
  }
  return response.json()
}

function App() {
  const today = toDateKey(new Date())
  const todayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${today}T12:00:00`))
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [confirmState, setConfirmState] = useState(null)
  const confirmAction = (message, options = {}) => new Promise(resolve => setConfirmState({ message, resolve, ...options }))
  const [taskError, setTaskError] = useState('')
  const [selectedTask, setSelectedTask] = useState(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false)
  const notifRef = useRef(null)
  const profileMenuRef = useRef(null)
  const workspaceMenuRef = useRef(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('workspace-sidebar-collapsed') === 'true')
  const [mobileOpen, setMobileOpen] = useState(false)
  const railCollapsed = sidebarCollapsed && !mobileOpen
  const [newTask, setNewTask] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newAssigneeId, setNewAssigneeId] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [newBucket, setNewBucket] = useState('Backlog')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRecurrence, setNewRecurrence] = useState('none')
  const [newPriority, setNewPriority] = useState('normal')
  const [taskSubmitting, setTaskSubmitting] = useState(false)
  const [selectedFilter, setSelectedFilter] = useState('All work')
  const [teamBoardMode, setTeamBoardMode] = useState('people')
  const [searchQuery, setSearchQuery] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('workspace-theme') || 'dark')
  const [session, setSession] = useState({ loading: true, user: null, error: '' })
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [workspaceReload, setWorkspaceReload] = useState(0)
  const [reportRange, setReportRange] = useState('all')
  const [reportLastUpdated, setReportLastUpdated] = useState(null)
  const [workspaceData, setWorkspaceData] = useState({ members: [], projects: [], events: [], checkIns: [], messages: [], channels: [], directConversations: [], followUps: [], invitations: [], notifications: [], activity: [], auditLogs: [], buckets: [], savedViews: [], lookupValues: [], reports: null })
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' })
  const [inviteError, setInviteError] = useState('')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)

  useEffect(() => {
    const resolvedTheme = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
    document.documentElement.dataset.theme = resolvedTheme
    localStorage.setItem('workspace-theme', theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = event => { document.documentElement.dataset.theme = event.matches ? 'dark' : 'light' }
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('workspace-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    const handler = event => {
      if (notifRef.current && !notifRef.current.contains(event.target)) setNotificationOpen(false)
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) setProfileMenuOpen(false)
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target)) setWorkspaceMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const closeOverlays = event => {
      if (event.key !== 'Escape') return
      setNotificationOpen(false)
      setProfileMenuOpen(false)
      setWorkspaceMenuOpen(false)
      setShowModal(false)
      setSelectedTask(null)
    }
    window.addEventListener('keydown', closeOverlays)
    return () => window.removeEventListener('keydown', closeOverlays)
  }, [])

  useEffect(() => {
    if (!workspaceNotice) return undefined
    const timeout = window.setTimeout(() => setWorkspaceNotice(''), 5000)
    return () => window.clearTimeout(timeout)
  }, [workspaceNotice])

  // Every save/notice path already funnels through workspaceNotice/workspaceError
  // (state or the workspace:notice event below) - mirroring that into
  // react-hot-toast, the same feedback mechanism TijhaBooks uses, means every
  // existing call site gets a toast for free instead of a one-by-one rewrite.
  useEffect(() => {
    if (workspaceNotice) toast.success(workspaceNotice)
  }, [workspaceNotice])
  useEffect(() => {
    if (workspaceError) toast.error(workspaceError)
  }, [workspaceError])

  useEffect(() => {
    const showNotice = event => setWorkspaceNotice(String(event.detail || 'Saved successfully.'))
    window.addEventListener('workspace:notice', showNotice)
    return () => window.removeEventListener('workspace:notice', showNotice)
  }, [])

  useEffect(() => {
    if (!session.user || !workspaceData.events.length) return
    const remindedEvent = workspaceData.events.find(event => event.reminder_sent_at && !sessionStorage.getItem(`workspace-reminder-${event.id}-${event.reminder_sent_at}`))
    if (!remindedEvent) return
    sessionStorage.setItem(`workspace-reminder-${remindedEvent.id}-${remindedEvent.reminder_sent_at}`, '1')
    setWorkspaceNotice(`Upcoming event: ${remindedEvent.title}`)
    if ('Notification' in window && Notification.permission === 'granted') new Notification(`Upcoming event: ${remindedEvent.title}`, { body: `Starts ${formatCalendarDate(new Date(remindedEvent.start_at), { dateStyle: 'medium', timeStyle: 'short' })}` })
  }, [session.user, workspaceData.events])

  useEffect(() => {
    if (session.user && !session.user.workspaces.some(workspace => workspace.id === activeWorkspaceId)) {
      setActiveWorkspaceId(session.user.workspaces[0]?.id || null)
    }
  }, [session.user, activeWorkspaceId])

  useEffect(() => {
    setTasks([])
    setSelectedTask(null)
    setNotificationOpen(false)
    setWorkspaceData({ members: [], projects: [], events: [], checkIns: [], messages: [], channels: [], directConversations: [], followUps: [], invitations: [], notifications: [], activity: [], auditLogs: [], buckets: [], savedViews: [], lookupValues: [], reports: null })
  }, [activeWorkspaceId])

  useEffect(() => {
    fetch('/api/auth/me/', { credentials: 'include' })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'The authentication service is unavailable.')
        setSession({ loading: false, user: data.user || null, error: '' })
      })
      .catch(error => setSession({ loading: false, user: null, error: error.message }))
  }, [])

  useEffect(() => {
    if (!session.user) return undefined
    let isCurrent = true
    const workspaceId = activeWorkspaceId
    if (!workspaceId) return undefined
    setWorkspaceLoading(true)
    setWorkspaceError('')

    const read = (path, fallback = {}) => fetch(path, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => {
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json()
    }).catch(error => {
      console.warn('Optional workspace data could not be loaded.', error.message)
      return fallback
    })
    const workspaceRole = session.user.workspaces.find(workspace => workspace.id === workspaceId)?.role
    const refreshCollaboration = () => {
      const auditRequest = ['owner', 'manager'].includes(workspaceRole) ? read(`/api/workspaces/${workspaceId}/audit-logs/`, { audit_logs: [] }) : Promise.resolve({ audit_logs: [] })
      return Promise.all([
      read('/api/tasks/', { tasks: [] }),
      read(`/api/workspaces/${workspaceId}/members/`, { members: [] }),
      read(`/api/workspaces/${workspaceId}/projects/`, { projects: [] }),
      read(`/api/workspaces/${workspaceId}/lookup-values/`, { lookup_values: [] }),
      read(`/api/workspaces/${workspaceId}/chat-messages/`, { messages: [] }),
      read(`/api/workspaces/${workspaceId}/chat-channels/`, { channels: [] }),
      read(`/api/workspaces/${workspaceId}/direct-conversations/`, { conversations: [] }),
      read(`/api/workspaces/${workspaceId}/follow-ups/`, { follow_ups: [] }),
      read(`/api/workspaces/${workspaceId}/calendar-events/`, { events: [] }),
      read(`/api/workspaces/${workspaceId}/check-ins/?date=${today}`, { check_ins: [] }),
      read(`/api/workspaces/${workspaceId}/notifications/`, { notifications: [] }),
      read(`/api/workspaces/${workspaceId}/activity/`, { activity: [] }),
      read(`/api/workspaces/${workspaceId}/plan-buckets/`, { buckets: [] }),
      read(`/api/workspaces/${workspaceId}/invitations/`, { invitations: [] }),
      read(`/api/workspaces/${workspaceId}/saved-views/`, { saved_views: [] }),
      read(`/api/workspaces/${workspaceId}/reports/summary/?range=${reportRange}`, { summary: null }),
      auditRequest,
      ]).then(([taskData, memberData, projectData, lookupData, messageData, channelData, directData, followUpData, eventData, checkInData, notificationData, activityData, bucketData, invitationData, savedViewData, reportData, auditData]) => {
      if (!isCurrent) return
      setTasks(taskData.tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description || '',
        member: task.assignee_name || 'Unassigned',
        tag: task.project || 'General',
        status: task.status === 'in_progress' ? 'in progress' : task.status,
        priority: task.priority || 'normal',
        due: taskDueLabel(task.due_date, today),
        due_date: task.due_date || '',
        completed_at: task.completed_at || '',
        created_at: task.created_at || '',
        estimate: 'n/a',
        can_edit: ['owner', 'manager'].includes(workspaceRole) || task.assignee_id === session.user.id,
        recurrence: task.recurrence || 'none',
        assignee_id: task.assignee_id || '',
        project_id: task.project_id || '',
        bucket: task.bucket || 'Backlog',
        position: task.position || 0,
        labels: task.labels || [],
        task_code: task.code || '',
        workstream: task.workstream || '',
        workstream_id: task.workstream_id || '',
        phase: task.phase || '',
        phase_id: task.phase_id || '',
        start_date: task.start_date || '',
        actual_completion_date: task.actual_completion_date || '',
        progress_percent: task.progress_percent ?? 0,
        blocker_details: task.blocker_details || '',
        state: task.state || 'active',
        archived_at: task.archived_at || '',
        supporters: task.supporter_ids || [],
      })))
      setWorkspaceData(current => ({ ...current, members: memberData.members, projects: projectData.projects, messages: messageData.messages, channels: channelData.channels, directConversations: directData.conversations, followUps: followUpData.follow_ups, events: eventData.events, checkIns: checkInData.check_ins, notifications: notificationData.notifications, activity: activityData.activity, auditLogs: auditData.audit_logs, buckets: bucketData.buckets, invitations: invitationData.invitations, savedViews: savedViewData.saved_views, lookupValues: lookupData.lookup_values, reports: reportData.summary }))
      setReportLastUpdated(new Date())
      setWorkspaceLoading(false)
      }).catch(error => {
      if (!isCurrent) return
      setWorkspaceLoading(false)
      setWorkspaceError(error.message || 'Collaboration data could not be refreshed.')
      console.warn('Collaboration data could not be refreshed.', error.message)
      })
    }

    refreshCollaboration()
    const refreshTimer = window.setInterval(refreshCollaboration, 15000)

    return () => {
      isCurrent = false
      window.clearInterval(refreshTimer)
    }
  }, [session.user, activeWorkspaceId, today, workspaceReload, reportRange])

  useEffect(() => {
    if (selectedTask && !tasks.some(task => task.id === selectedTask.id)) setSelectedTask(null)
  }, [tasks, selectedTask])

  useEffect(() => {
    const mine = session.user ? tasks.filter(task => String(task.assignee_id || '') === String(session.user.id) && (!task.due_date || task.due_date <= today)) : []
    const completed = mine.filter(task => task.status === 'done').length
    document.documentElement.style.setProperty('--focus-progress', `${mine.length ? Math.round((completed / mine.length) * 100) : 0}%`)
  }, [tasks, session.user, today])

  const visibleTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks.filter(task => {
      const isDailyBoardTask = !task.due_date || task.due_date <= today
      const matchesStatus = selectedFilter === 'All work' || task.status === selectedFilter
      const matchesSearch = !normalizedQuery || taskSearchText(task).includes(normalizedQuery)
      return isDailyBoardTask && matchesStatus && matchesSearch
    })
  }, [tasks, selectedFilter, searchQuery, today])
  if (session.loading) return <div className="auth-loading">Loading WorkSpace...</div>
  if (!session.user) return <AuthScreen theme={theme} onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} onAuthenticated={user => setSession({ loading: false, user, error: '' })} connectionError={session.error} />
  const mapApiTask = apiTask => {
    const workspaceRole = session.user.workspaces.find(workspace => workspace.id === activeWorkspaceId)?.role
    return { id: apiTask.id, title: apiTask.title, description: apiTask.description || '', member: apiTask.assignee_name || 'Unassigned', tag: apiTask.project || 'General', status: apiTask.status === 'in_progress' ? 'in progress' : apiTask.status, priority: apiTask.priority || 'normal', due: taskDueLabel(apiTask.due_date, today), due_date: apiTask.due_date || '', completed_at: apiTask.completed_at || '', created_at: apiTask.created_at || '', estimate: 'n/a', assignee_id: apiTask.assignee_id || '', project_id: apiTask.project_id || '', can_edit: ['owner', 'manager'].includes(workspaceRole) || apiTask.assignee_id === session.user.id, recurrence: apiTask.recurrence || 'none', bucket: apiTask.bucket || 'Backlog', position: apiTask.position || 0, labels: apiTask.labels || [], task_code: apiTask.code || '', workstream: apiTask.workstream || '', workstream_id: apiTask.workstream_id || '', phase: apiTask.phase || '', phase_id: apiTask.phase_id || '', start_date: apiTask.start_date || '', actual_completion_date: apiTask.actual_completion_date || '', progress_percent: apiTask.progress_percent ?? 0, blocker_details: apiTask.blocker_details || '', state: apiTask.state || 'active', archived_at: apiTask.archived_at || '', supporters: apiTask.supporter_ids || [] }
  }
  const completeTask = async id => {
    const previousTask = tasks.find(task => task.id === id)
    const nextStatus = previousTask?.status === 'done' ? 'todo' : 'done'
    setTasks(current => current.map(task => task.id === id ? { ...task, status: nextStatus, completed_at: nextStatus === 'done' ? new Date().toISOString() : '' } : task))
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') },
        body: JSON.stringify({ status: nextStatus }),
      })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || `Task update returned ${response.status}`)
      if (responseData.next_task) setTasks(current => current.some(task => task.id === responseData.next_task.id) ? current : [...current, mapApiTask(responseData.next_task)])
      toast.success(`${previousTask?.title || 'Task'} ${nextStatus === 'done' ? 'completed' : 'reopened'}.`)
      setWorkspaceReload(current => current + 1)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      toast.error(error.message || 'Task status could not be saved.')
      console.warn('Task status could not be saved.', error.message)
    }
  }
  const changeTaskStatus = async (id, status) => {
    const previousTask = tasks.find(task => task.id === id)
    setTasks(current => current.map(task => task.id === id ? { ...task, status, completed_at: status === 'done' ? new Date().toISOString() : '' } : task))
    try {
      const apiStatus = status === 'in progress' ? 'in_progress' : status
      const response = await fetch(`/api/tasks/${id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') }, body: JSON.stringify({ status: apiStatus }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || `Task update returned ${response.status}`)
      if (responseData.next_task) setTasks(current => current.some(task => task.id === responseData.next_task.id) ? current : [...current, mapApiTask(responseData.next_task)])
      toast.success(`${previousTask?.title || 'Task'} moved to ${status === 'in progress' ? 'In progress' : status === 'todo' ? 'To do' : status.charAt(0).toUpperCase() + status.slice(1)}.`)
      setWorkspaceReload(current => current + 1)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      toast.error(error.message || 'Task status could not be saved.')
      console.warn('Task status could not be saved.', error.message)
    }
  }
  const changeTaskBucket = async (id, bucket) => {
    if (Array.isArray(id)) return reorderPlannerTasks(id)
    const previousTask = tasks.find(task => task.id === id)
    setTasks(current => current.map(task => task.id === id ? { ...task, bucket } : task))
    try {
      const response = await fetch(`/api/tasks/${id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') }, body: JSON.stringify({ bucket }) })
      if (!response.ok) throw new Error(`Task bucket update returned ${response.status}`)
      setWorkspaceReload(current => current + 1)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      toast.error(error.message || 'Task bucket could not be saved.')
      console.warn('Task bucket could not be saved.', error.message)
    }
  }
  const reorderPlannerTasks = async columns => {
    const previousTasks = tasks
    const placements = new Map()
    columns.forEach(column => column.task_ids.forEach((id, position) => placements.set(Number(id), { bucket: column.bucket, position })))
    setTasks(current => current.map(task => placements.has(task.id) ? { ...task, ...placements.get(task.id) } : task))
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/tasks/reorder/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') }, body: JSON.stringify({ columns }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Task order could not be saved.')
      setWorkspaceNotice('Planner order saved.')
      return responseData.tasks
    } catch (error) {
      setTasks(previousTasks)
      toast.error(error.message || 'Task order could not be saved.')
      throw error
    }
  }
  const deleteTask = async id => {
    if (!(await confirmAction('Archive this task? It will be hidden from active views, but its history and code are kept.', { title: 'Archive task', confirmLabel: 'Archive task' }))) return false
    try {
      const response = await fetch(`/api/tasks/${id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') } })
      if (!response.ok) {
        toast.error('Task could not be archived.')
        return false
      }
      setTasks(current => current.filter(task => task.id !== id))
      setSelectedTask(null)
      setWorkspaceNotice('Task archived.')
      setWorkspaceReload(current => current + 1)
      return true
    } catch (error) {
      toast.error(error.message || 'Task could not be archived.')
      return false
    }
  }
  const openTaskModal = assigneeId => {
    const requestedBucket = sessionStorage.getItem('workspace-new-task-bucket')
    sessionStorage.removeItem('workspace-new-task-bucket')
    setNewTask('')
    setNewDescription('')
    setNewAssigneeId(assigneeId ? String(assigneeId) : '')
    setNewProjectId('')
    setNewDueDate('')
    setNewBucket(requestedBucket || 'Backlog')
    setNewRecurrence('none')
    setNewPriority('normal')
    setTaskError('')
    setShowModal(true)
  }
  const openComposer = type => {
    if (type === 'invite') {
      setInviteForm({ email: '', role: 'member' })
      setInviteError('')
      setInviteComposerOpen(true)
    }
  }
  const submitInvite = async event => {
    event.preventDefault()
    setInviteError('')
    setInviteSubmitting(true)
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/invitations/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId) }, body: JSON.stringify({ email: inviteForm.email, role: inviteForm.role }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Invitation could not be sent.')
      setWorkspaceData(current => ({ ...current, invitations: [...current.invitations, responseData.invitation] }))
      setWorkspaceReload(current => current + 1)
      setInviteComposerOpen(false)
    } catch (submitError) {
      setInviteError(submitError.message)
    } finally {
      setInviteSubmitting(false)
    }
  }
  const logout = async () => {
    try {
      await fetch('/api/auth/logout/', { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    } finally {
      setSession({ loading: false, user: null, error: '' })
    }
  }
  const acceptInvitation = async invitation => {
    setWorkspaceError('')
    try {
      const response = await fetch(`/api/invitations/${invitation.id}/accept/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Invitation could not be accepted.')
      const sessionResponse = await fetch('/api/auth/me/', { credentials: 'include' })
      const sessionData = await sessionResponse.json()
      if (!sessionResponse.ok || !sessionData.user) throw new Error('Workspace access could not be refreshed.')
      setSession(current => ({ ...current, user: sessionData.user }))
      setActiveWorkspaceId(responseData.workspace.id)
    } catch (acceptError) {
      toast.error(acceptError.message)
    }
  }
  const markNotificationsRead = async () => {
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/notifications/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ read_all: true }) })
      if (!response.ok) return toast.error('Notifications could not be marked as read.')
      setWorkspaceData(current => ({ ...current, notifications: current.notifications.map(notification => ({ ...notification, read: true })) }))
    } catch (error) {
      toast.error(error.message || 'Notifications could not be marked as read.')
    }
  }
  const markNotificationRead = async notificationId => {
    try {
      const response = await fetch(`/api/workspaces/${activeWorkspaceId}/notifications/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ notification_id: notificationId }) })
      if (!response.ok) return toast.error('Notification could not be marked as read.')
      setWorkspaceData(current => ({ ...current, notifications: current.notifications.map(notification => notification.id === notificationId ? { ...notification, read: true } : notification) }))
    } catch (error) {
      toast.error(error.message || 'Notification could not be marked as read.')
    }
  }
  const notificationDestinations = { follow_up: 'Follow-up', chat_channel: 'Channels', direct_conversation: 'Chats', calendar_event: 'Calendar', check_in: 'Check-ins' }
  const openNotification = notification => {
    setNotificationOpen(false)
    markNotificationRead(notification.id)
    if (notification.target_type === 'task') {
      const targetTask = tasks.find(task => String(task.id) === String(notification.target_id))
      if (targetTask) setSelectedTask(targetTask)
      return
    }
    const destination = notificationDestinations[notification.target_type]
    if (destination) setActive(destination)
  }
  const addTask = async event => {
    event.preventDefault()
    if (taskSubmitting) return
    setTaskError('')
    if (!newTask.trim()) {
      setTaskError('Task name is required.')
      return
    }
    setTaskSubmitting(true)
    try {
      const response = await fetch('/api/tasks/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') },
        body: JSON.stringify({ title: newTask.trim(), description: newDescription.trim(), assignee_id: newAssigneeId || null, project_id: newProjectId || null, bucket: newBucket, due_date: newDueDate || null, recurrence: newRecurrence, priority: newPriority }),
      })
      const data = await readJsonResponse(response, 'Task could not be created.')
      if (!response.ok) throw new Error(data.error || `Task creation returned ${response.status}`)
      setTasks(current => [...current, { id: data.task.id, title: data.task.title, description: data.task.description || '', member: data.task.assignee_name || 'Unassigned', tag: data.task.project || 'General', status: data.task.status || 'todo', priority: data.task.priority || 'normal', due: taskDueLabel(data.task.due_date, today), due_date: data.task.due_date || '', estimate: 'n/a', assignee_id: data.task.assignee_id || '', project_id: data.task.project_id || '', can_edit: ['owner', 'manager'].includes(currentWorkspace?.role) || data.task.assignee_id === session.user.id, recurrence: data.task.recurrence || 'none', bucket: data.task.bucket || 'Backlog', labels: data.task.labels || [] }])
      setNewTask('')
      setNewDescription('')
      setNewAssigneeId('')
      setNewProjectId('')
      setNewBucket('Backlog')
      setNewDueDate('')
      setNewRecurrence('none')
      setNewPriority('normal')
      setShowModal(false)
      setWorkspaceNotice(newDueDate && newDueDate > today ? `Task created for ${newDueDate}. Open Planner to see it.` : 'Task created successfully.')
      setWorkspaceReload(current => current + 1)
    } catch (error) {
      setTaskError(error.message || 'Task could not be created.')
      console.error('Task could not be created.', error.message)
    } finally {
      setTaskSubmitting(false)
    }
  }

  const workspaceId = activeWorkspaceId
  const currentWorkspace = session.user.workspaces.find(workspace => workspace.id === activeWorkspaceId) || session.user.workspaces[0]
  const canManageMembers = ['owner', 'manager'].includes(currentWorkspace?.role)
  const canManageTasks = ['owner', 'manager'].includes(currentWorkspace?.role)
  const teamMembers = workspaceData.members.map(member => ({
    id: member.id,
    name: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email,
    initials: [member.first_name, member.last_name].filter(Boolean).map(name => name[0]).join('').slice(0, 2).toUpperCase() || member.email.slice(0, 2).toUpperCase(),
    color: 'blue',
    role: member.role,
  }))
  const teamBoardMembers = [...teamMembers, { id: 'unassigned', name: 'General queue', initials: '+', color: 'navy', role: 'Shared work' }]
  const currentUserName = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ') || session.user.email
  const currentUserInitials = [session.user.first_name, session.user.last_name].filter(Boolean).map(name => name[0]).join('').slice(0, 2).toUpperCase() || session.user.email.slice(0, 2).toUpperCase()
  const currentUserAvatarUrl = session.user.avatar_url || ''
  const currentUserPresence = session.user.presence || 'available'
  const updateSessionUser = patch => setSession(current => ({ ...current, user: { ...current.user, ...patch } }))
  const todayTasks = tasks.filter(task => !task.due_date || task.due_date <= today)
  const completedTaskCount = todayTasks.filter(task => task.status === 'done').length
  const attentionTaskCount = todayTasks.filter(task => ['blocked', 'review'].includes(task.status) || task.due === 'Overdue').length
  const completionPercent = todayTasks.length ? Math.round((completedTaskCount / todayTasks.length) * 100) : 0
  const myTasks = tasks.filter(task => String(task.assignee_id || '') === String(session.user.id) && (!task.due_date || task.due_date <= today))
  const myTodayTasks = myTasks
  const myCompletedTaskCount = myTodayTasks.filter(task => task.status === 'done').length

  // Grouped by what they're for rather than dumped in one flat list: the two
  // screens someone opens every day, the screens where work actually gets
  // planned/tracked, the screens for talking to teammates, and the screens
  // you check but rarely act from.
  const navGroups = [
    {
      heading: 'Overview',
      items: [
        { label: 'Today', icon: LayoutDashboard },
        { label: 'My tasks', icon: CheckCircle2 },
      ],
    },
    {
      heading: 'Work',
      items: [
        { label: 'Planner', icon: LayoutGrid },
        { label: 'Daily operations', icon: ClipboardList },
        { label: 'Team board', icon: Users },
        { label: 'Projects', icon: Target },
        { label: 'Calendar', icon: CalendarDays },
      ],
    },
    {
      heading: 'Collaborate',
      items: [
        { label: 'Channels', icon: Hash, badge: workspaceData.notifications.filter(item => item.target_type === 'chat_channel' && !item.read).length, badgeTone: 'accent' },
        { label: 'Chats', icon: MessageSquare, badge: workspaceData.notifications.filter(item => item.target_type === 'direct_conversation' && !item.read).length, badgeTone: 'accent' },
        { label: 'Follow-up', icon: Bell, badge: workspaceData.followUps.filter(item => item.status !== 'completed').length },
        { label: 'Check-ins', icon: Hash },
      ],
    },
    {
      heading: 'Insights',
      items: [
        { label: 'Reports', icon: BarChart3 },
        { label: 'Activity', icon: Clock3 },
      ],
    },
    {
      heading: 'Resources',
      items: [
        { label: 'Help', icon: CircleHelp },
        { label: 'Legal', icon: FileText },
      ],
    },
  ]

  // ── Mobile bottom pill nav - the four destinations that carry the daily
  //    loop, with everything else behind "More" (the same drawer the header's
  //    hamburger opens). Items are looked up in navGroups rather than
  //    redeclared so labels, icons and unread badges stay in one place.
  const mobilePillLabels = ['Today', 'My tasks', 'Planner', 'Chats']
  const navItemsByLabel = new Map(navGroups.flatMap(group => group.items).map(item => [item.label, item]))
  const mobilePillItems = mobilePillLabels.map(label => navItemsByLabel.get(label)).filter(Boolean)

  return <div className="flex h-dvh overflow-hidden bg-surface-secondary">
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: { background: 'rgba(11, 11, 69, 0.94)', color: '#FFFFFF', fontSize: '0.875rem' },
        success: { style: { background: 'rgba(8, 127, 115, 0.94)', color: '#FFFFFF' }, iconTheme: { primary: '#86efac', secondary: '#087f73' } },
        error: { style: { background: 'rgba(180, 35, 24, 0.94)', color: '#FFFFFF' }, iconTheme: { primary: '#fecaca', secondary: '#b42318' } },
        loading: { style: { background: 'rgba(29, 78, 216, 0.94)', color: '#FFFFFF' }, iconTheme: { primary: '#bfdbfe', secondary: '#1d4ed8' } },
      }}
    />
    <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    <a className="skip-link" href="#main-content">Skip to main content</a>

    {/* ── Mobile overlay - stays mounted and fades in step with the drawer's
        slide (both on the same 200ms timing) instead of popping in/out, so
        the dim and the panel read as one motion rather than two. ── */}
    <div
      className={cn(
        'fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm transition-opacity duration-200 ease-in-out lg:hidden',
        mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      onClick={() => setMobileOpen(false)}
      aria-hidden="true"
    />

    {/* ── Sidebar ── */}
    <aside className={cn(
      'fixed inset-y-0 left-0 z-50 flex flex-col bg-navy text-text-on-navy transition-all duration-200 lg:relative',
      'w-64', railCollapsed && 'lg:w-[4.5rem]',
      mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
    )}>
      {/* Logo / brand - desktop only. Mobile header already shows the brand. */}
      <div className={cn(
        'hidden lg:flex items-center border-b border-white/10 pb-4',
        railCollapsed ? 'flex-col justify-center gap-4 px-0 py-5' : 'gap-3 px-4 pt-8 pb-4',
      )}>
        <img src="/tijha-logo.png" alt="TijhaBooks" className="h-7 w-7 shrink-0 rounded-lg object-contain" />
        {!railCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold tracking-tight">WorkSpace</p>
            <p className="truncate text-[11px] uppercase tracking-wider text-white/40">Team Manager</p>
          </div>
        )}
      </div>

      {/* Mobile close button - outside the logo block so it survives on phones */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 lg:hidden">
        <span className="text-sm font-bold text-white/60">Navigation</span>
        <button type="button" onClick={() => setMobileOpen(false)} className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white" aria-label="Close sidebar">
          <X size={20} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-4">
        {navGroups.map(group => (
          <div className="mb-7 last:mb-0" key={group.heading}>
            {!railCollapsed && <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-white/30">{group.heading}</p>}
            <ul className="space-y-1">
              {group.items.map(({ label, icon: Icon, badge, badgeTone }) => (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => { setActive(label); setMobileOpen(false) }}
                    title={railCollapsed ? label : undefined}
                    aria-current={active === label ? 'page' : undefined}
                    className={cn(
                      'group flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-[15px] font-medium transition-all',
                      active === label ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
                      railCollapsed && 'justify-center py-3',
                    )}
                  >
                    <Icon size={22} className="shrink-0" />
                    {!railCollapsed && <span className="truncate">{label}</span>}
                    {!railCollapsed && badge > 0 && (
                      <span className={cn(
                        'ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold',
                        badgeTone === 'accent' ? 'bg-accent text-navy' : 'bg-danger text-white',
                      )}>
                        {badge > 9 ? '9+' : badge}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Upgrade nudge - mirrors TijhaBooks' plan-upsell card */}
      {!railCollapsed && (
        <div className="sidebar-upgrade-card mx-3 mb-3 rounded-xl bg-gradient-to-br from-primary/30 to-accent/10 p-3.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-white"><Sparkles size={14} /> Make your week flow</p>
          <p className="mt-0.5 text-[11px] leading-snug text-white/55">Set your priorities and stay ahead of what's due.</p>
        </div>
      )}

      <div className="border-t border-white/10 px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => { setActive('Settings'); setMobileOpen(false) }}
          title={railCollapsed ? 'Settings' : undefined}
          aria-current={active === 'Settings' ? 'page' : undefined}
          className={cn(
            'flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-[15px] font-medium transition-all',
            active === 'Settings' ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5 hover:text-white',
            railCollapsed && 'justify-center py-3',
          )}
        >
          <Settings size={22} className="shrink-0" />
          {!railCollapsed && <span className="truncate">Settings</span>}
        </button>
      </div>
    </aside>

    {/* ── Desktop collapse edge pill - sits on the right edge of the sidebar ── */}
    <button
      type="button"
      onClick={() => setSidebarCollapsed(current => !current)}
      className="hidden lg:flex fixed z-50 top-1/2 -translate-y-1/2 h-12 w-6 items-center justify-center rounded-r-lg bg-navy text-white/50 hover:text-white hover:bg-navy-soft transition-colors shadow-md"
      style={{
        left: sidebarCollapsed ? '4.5rem' : '16rem',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        borderRight: '1px solid rgba(255,255,255,0.1)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        borderLeft: 'none',
        transition: 'left 0.2s',
      }}
      aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
    </button>

    {/* ── Main ── */}
    <div className="flex flex-1 flex-col min-w-0">
      <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-6">

        <div className="flex min-w-0 items-center gap-2 lg:hidden">
          <img src="/tijha-logo.png" alt="TijhaBooks" className="h-6 w-6 shrink-0 rounded-md object-contain" />
          <span className="hidden truncate text-sm font-bold tracking-tight text-navy sm:inline">WorkSpace</span>
        </div>

        <h1 className="hidden text-base font-bold tracking-tight text-navy lg:block">{active}</h1>

        {/* Workspace switcher - lives in the header (mirrors TijhaBooks'
            BusinessSwitcher), not the sidebar. Collapses to a static label
            when there's only one workspace to switch to. */}
        {session.user.workspaces.length > 0 && (
          <div className="relative hidden sm:block" ref={workspaceMenuRef}>
            <button
              type="button"
              onClick={() => session.user.workspaces.length > 1 && setWorkspaceMenuOpen(current => !current)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-3 py-1.5 text-xs font-semibold text-text-primary',
                session.user.workspaces.length > 1 && 'hover:bg-border-light transition-colors',
              )}
              aria-haspopup={session.user.workspaces.length > 1 ? 'true' : undefined}
              aria-expanded={workspaceMenuOpen}
            >
              <Building2 size={14} className="shrink-0 text-text-muted" />
              <span className="max-w-[140px] truncate">{currentWorkspace?.name || 'Workspace'}</span>
              {session.user.workspaces.length > 1 && <ChevronDown size={14} className="shrink-0 text-text-muted" />}
            </button>
            {workspaceMenuOpen && (
              <div className="absolute left-0 top-full z-[60] mt-2 w-56 animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated">
                {session.user.workspaces.map(workspace => (
                  <button
                    type="button"
                    key={workspace.id}
                    onClick={() => { setActiveWorkspaceId(workspace.id); setWorkspaceMenuOpen(false) }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-secondary',
                      workspace.id === activeWorkspaceId ? 'text-primary font-semibold' : 'text-text-secondary',
                    )}
                  >
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === activeWorkspaceId && <Check size={14} className="shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="hidden flex-1 justify-center md:flex">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search work"
              aria-label="Search work"
              className="h-9 w-full rounded-full border border-border bg-surface-secondary pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
            />
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotificationOpen(current => !current)}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
              aria-label="Open notifications"
            >
              <Bell size={20} />
              {workspaceData.notifications.some(notification => !notification.read) && (
                <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
              )}
            </button>
            {notificationOpen && (
              <div className="fixed left-4 right-4 top-16 z-[60] mt-2 w-auto max-w-md animate-fade-in rounded-xl border border-border bg-surface shadow-elevated sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-80">
                <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
                  <p className="text-sm font-bold text-navy">Notifications</p>
                  <button type="button" onClick={markNotificationsRead} className="text-xs font-medium text-primary hover:underline">Mark all read</button>
                </div>
                <div className="max-h-[320px] divide-y divide-border-light overflow-y-auto">
                  {workspaceData.notifications.length ? workspaceData.notifications.slice(0, 8).map(notification => (
                    <button
                      type="button"
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                      aria-label={`Open ${notification.title}`}
                      className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                        {notification.title}
                        {!notification.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                      </span>
                      <span className="truncate text-xs text-text-muted">{notification.body || 'Workspace update'}</span>
                    </button>
                  )) : <EmptyState text="No notifications yet." />}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
          >
            {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          </button>

          <button
            type="button"
            onClick={() => setActive('Help')}
            className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors sm:flex"
          >
            <CircleHelp size={16} /> Help
          </button>

          <div className="relative ml-1" ref={profileMenuRef}>
            <button
              type="button"
              onClick={() => setProfileMenuOpen(current => !current)}
              aria-haspopup="true"
              aria-expanded={profileMenuOpen}
              aria-label={`Account menu for ${currentUserName}`}
              className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-surface-secondary sm:pr-2.5"
            >
              <span className="relative inline-flex h-9 w-9 shrink-0">
                <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-navy-soft text-xs font-bold text-white">
                  {currentUserAvatarUrl ? <img src={currentUserAvatarUrl} alt="" className="h-full w-full object-cover" /> : currentUserInitials}
                </span>
                <span className={`presence-dot presence-${currentUserPresence}`} title={PRESENCE_LABEL[currentUserPresence] || currentUserPresence} />
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-[140px] truncate text-sm font-semibold text-text-primary">{currentUserName}</span>
                <span className="block max-w-[140px] truncate text-xs text-text-muted">{currentWorkspace?.role || 'Member'}</span>
              </span>
            </button>

            {profileMenuOpen && (
              <div className="fixed left-4 right-4 top-16 z-[60] mt-2 w-auto max-w-xs animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-56">
                <div className="border-b border-border-light px-3 py-2.5">
                  <p className="truncate text-sm font-semibold text-text-primary">{currentUserName}</p>
                  <p className="truncate text-xs text-text-muted">{session.user.email}</p>
                </div>
                {currentWorkspace && (
                  <div className="border-b border-border-light px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Workspace</p>
                    <p className="truncate text-sm font-semibold text-text-primary">{currentWorkspace.name}</p>
                    <p className="truncate text-xs text-text-muted">{currentWorkspace.role || 'Member'}</p>
                  </div>
                )}
                {session.user.workspaces.length > 1 && (
                  <button
                    type="button"
                    onClick={() => { setWorkspaceMenuOpen(true); setProfileMenuOpen(false) }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary sm:hidden"
                  >
                    <Building2 size={16} /> Switch workspace
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setActive('Settings'); setProfileMenuOpen(false) }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary"
                >
                  <Settings size={16} /> Settings
                </button>
                <button
                  type="button"
                  onClick={logout}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-bg"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main id="main-content" className="main-content flex-1 overflow-y-auto min-w-0" tabIndex="-1">
      {/* Bottom padding clears the fixed mobile pill nav; desktop has none. */}
      <div className="page-content pb-28 lg:pb-0">
        {session.user.pending_invitations?.map(invitation => <div className="workspace-status" key={invitation.id}><span>You are invited to join {invitation.workspace_name} as a {invitation.role}.</span><button className="secondary-button" onClick={() => acceptInvitation(invitation)}>Accept invitation</button></div>)}
        {workspaceLoading && <div className="workspace-status" role="status">Loading workspace data...</div>}
        {workspaceError && <div className="workspace-status error" role="alert"><span>Workspace data could not be loaded: {workspaceError}</span><button className="secondary-button" onClick={() => setWorkspaceReload(current => current + 1)}>Retry</button></div>}
        {active !== 'Today' && <WorkspaceView key={workspaceId} active={active} data={workspaceData} tasks={tasks} searchQuery={searchQuery} onSearchChange={setSearchQuery} onNavigate={setActive} theme={theme} onSetTheme={setTheme} sidebarCollapsed={sidebarCollapsed} workspaceId={workspaceId} currentWorkspace={currentWorkspace} currentUserName={[session.user.first_name, session.user.last_name].filter(Boolean).join(' ') || session.user.email} currentUserEmail={session.user.email} currentUserId={session.user.id} currentUserAvatarUrl={currentUserAvatarUrl} currentUserPresence={currentUserPresence} onProfileUpdated={updateSessionUser} canManageMembers={['owner', 'manager'].includes(currentWorkspace?.role)} canManageTasks={['owner', 'manager'].includes(currentWorkspace?.role)} reportRange={reportRange} setReportRange={setReportRange} reportLastUpdated={reportLastUpdated} onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} onToggleSidebar={() => setSidebarCollapsed(current => !current)} onComplete={completeTask} onStatusChange={changeTaskStatus} onBucketChange={changeTaskBucket} onDelete={deleteTask} onAddTask={() => openTaskModal()} onOpenTask={setSelectedTask} onActionError={message => toast.error(message)} onRefresh={() => setWorkspaceReload(current => current + 1)} onConfirm={confirmAction} />}
        {active === 'Today' && <TodayDashboard today={today} todayLabel={todayLabel} currentUserName={currentUserName} workspaceName={currentWorkspace?.name || 'your workspace'} tasks={tasks} events={workspaceData.events} followUps={workspaceData.followUps} checkIns={workspaceData.checkIns} members={workspaceData.members} canManageMembers={canManageMembers} onAddTask={() => openTaskModal()} onOpenTask={setSelectedTask} onNavigate={setActive} onComplete={completeTask} onStatusChange={changeTaskStatus} />}
      </div>
      </main>
    </div>

    {/* ── Mobile bottom pill nav - four primary destinations plus "More",
        which opens the same drawer as the header hamburger so the full
        navigation stays reachable. Hidden while that drawer is open so the
        pill doesn't sit dimmed under the overlay. ── */}
    <nav
      className={cn(
        'fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-navy/95 p-1.5 shadow-lg backdrop-blur transition-opacity duration-200 lg:hidden',
        mobileOpen && 'pointer-events-none opacity-0',
      )}
      aria-label="Primary"
    >
      {mobilePillItems.map(({ label, icon: Icon, badge, badgeTone }) => (
        <button
          type="button"
          key={label}
          onClick={() => setActive(label)}
          aria-current={active === label ? 'page' : undefined}
          className={cn(
            'relative flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors',
            active === label ? 'bg-accent text-navy' : 'text-white/60 hover:bg-white/5 hover:text-white',
          )}
        >
          <Icon size={19} className="shrink-0" />
          <span className="max-w-full truncate px-1 text-[10px] font-semibold leading-none">{label}</span>
          {badge > 0 && (
            <span className={cn(
              'absolute right-2.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold',
              badgeTone === 'accent' ? 'bg-accent text-navy' : 'bg-danger text-white',
              active === label && 'bg-navy text-white',
            )}>
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-expanded={mobileOpen}
        aria-haspopup="menu"
        className="flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-xl text-white/60 transition-colors hover:bg-white/5 hover:text-white"
      >
        <MoreHorizontal size={19} className="shrink-0" />
        <span className="text-[10px] font-semibold leading-none">More</span>
      </button>
    </nav>

    {showModal &&<div className="modal-backdrop" onMouseDown={() => setShowModal(false)}><form className="modal" role="dialog" aria-modal="true" aria-labelledby="add-task-title" onSubmit={addTask} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Quick capture</p><h2 id="add-task-title">Add a task</h2></div><button type="button" className="close-button" onClick={() => setShowModal(false)} aria-label="Close add task dialog"><X size={18} /></button></div><label>Task name<input autoFocus value={newTask} onChange={event => { setNewTask(event.target.value); setTaskError('') }} placeholder="What needs to happen?" /></label><label>Description<textarea value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="Add more detail about this task" maxLength="4000" /></label>{taskError && <p className="auth-error" role="alert">{taskError}</p>}<div className="modal-grid"><label>Assign to<select value={newAssigneeId} onChange={event => setNewAssigneeId(event.target.value)}><option value="">Unassigned</option>{workspaceData.members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><DateField label="Due date" value={newDueDate} onChange={event => setNewDueDate(event.target.value)} /></div><div className="modal-grid"><label>Project<select value={newProjectId} onChange={event => setNewProjectId(event.target.value)}><option value="">General</option>{workspaceData.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Priority<select value={newPriority} onChange={event => setNewPriority(event.target.value)}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label></div><label>Planner bucket<select value={newBucket} onChange={event => setNewBucket(event.target.value)}>{(workspaceData.buckets.length ? workspaceData.buckets : [{ id: 'backlog', name: 'Backlog' }]).map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select></label><label>Repeat<select value={newRecurrence} onChange={event => setNewRecurrence(event.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button className="primary-button modal-submit">Create task <ArrowUpRight size={16} /></button></form></div>}
        {inviteComposerOpen && <WorkspaceComposer type="invite" form={inviteForm} setForm={setInviteForm} error={inviteError} submitting={inviteSubmitting} onClose={() => setInviteComposerOpen(false)} onSubmit={submitInvite} />}
        {selectedTask && <TaskDetailDrawer task={selectedTask} workspaceId={activeWorkspaceId} members={workspaceData.members} projects={workspaceData.projects} buckets={workspaceData.buckets} canManageTasks={['owner', 'manager'].includes(currentWorkspace?.role)} onClose={() => setSelectedTask(null)} onDelete={deleteTask} onTaskUpdated={updatedTask => setTasks(current => current.map(item => item.id === updatedTask.id ? { ...item, title: updatedTask.title, description: updatedTask.description || '', member: updatedTask.assignee_name || 'Unassigned', tag: updatedTask.project || 'General', status: updatedTask.status === 'in_progress' ? 'in progress' : updatedTask.status, priority: updatedTask.priority || 'normal', due: taskDueLabel(updatedTask.due_date, today), due_date: updatedTask.due_date || '', recurrence: updatedTask.recurrence || 'none', bucket: updatedTask.bucket || 'Backlog', labels: updatedTask.labels || [], assignee_id: updatedTask.assignee_id || '', project_id: updatedTask.project_id || '', task_code: updatedTask.code || '', workstream: updatedTask.workstream || '', workstream_id: updatedTask.workstream_id || '', phase: updatedTask.phase || '', phase_id: updatedTask.phase_id || '', start_date: updatedTask.start_date || '', actual_completion_date: updatedTask.actual_completion_date || '', progress_percent: updatedTask.progress_percent ?? 0, blocker_details: updatedTask.blocker_details || '', state: updatedTask.state || 'active', archived_at: updatedTask.archived_at || '', supporters: updatedTask.supporter_ids || [] } : item))} />}
        <CookieConsent onOpenLegal={() => setActive('Legal')} />
  </div>
}

function SettingsView({ theme, onSetTheme, sidebarCollapsed, onToggleSidebar, currentWorkspace, currentUserName, currentUserEmail, currentUserId, currentUserAvatarUrl, currentUserPresence, onProfileUpdated, canManageMembers, members, notifications, workspaceId }) {
  const [section, setSection] = useState('appearance')
  const [notificationPrefs, setNotificationPrefs] = useState(null)
  const [prefsError, setPrefsError] = useState('')
  const [browserPermission, setBrowserPermission] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'))
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [presenceSaving, setPresenceSaving] = useState(false)
  const [presenceError, setPresenceError] = useState('')
  const sections = [
    ['appearance', 'Appearance', Sun],
    ['notifications', 'Notifications', Bell],
    ['profile', 'Profile', Users],
    ['workspace', 'Workspace access', Building2],
  ]
  const preferenceRows = [
    ['mentions', 'Mentions', 'When someone mentions you in a channel.'],
    ['direct_messages', 'Direct messages', 'When someone sends you a private chat.'],
    ['task_updates', 'Task updates', 'Assignments, comments, and status changes.'],
    ['calendar_reminders', 'Calendar reminders', 'Upcoming event reminders.'],
  ]
  useEffect(() => {
    if (!workspaceId) return undefined
    let isCurrent = true
    fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } })
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => { if (isCurrent && ok) setNotificationPrefs(data.preferences) })
      .catch(() => { if (isCurrent) setPrefsError('Notification preferences could not be loaded.') })
    return () => { isCurrent = false }
  }, [workspaceId])
  const updatePreference = async (key, value) => {
    const previous = notificationPrefs
    setNotificationPrefs(current => ({ ...current, [key]: value }))
    setPrefsError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ [key]: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Preference could not be saved.')
      setNotificationPrefs(data.preferences)
    } catch (error) {
      setNotificationPrefs(previous)
      setPrefsError(error.message || 'Preference could not be saved.')
    }
  }
  const requestBrowserPermission = async () => {
    if (!('Notification' in window)) return
    const permission = await Notification.requestPermission()
    setBrowserPermission(permission)
  }
  const handleAvatarChange = async event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setAvatarUploading(true)
    setAvatarError('')
    try {
      const body = new FormData()
      body.append('avatar', file)
      const response = await fetch('/api/auth/me/avatar/', { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() }, body })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Photo could not be uploaded.')
      onProfileUpdated({ avatar_url: `${data.avatar_url}?t=${Date.now()}` })
    } catch (error) {
      setAvatarError(error.message || 'Photo could not be uploaded.')
    } finally {
      setAvatarUploading(false)
    }
  }
  const handleAvatarRemove = async () => {
    setAvatarUploading(true)
    setAvatarError('')
    try {
      const response = await fetch('/api/auth/me/avatar/', { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Photo could not be removed.')
      onProfileUpdated({ avatar_url: '' })
    } catch (error) {
      setAvatarError(error.message || 'Photo could not be removed.')
    } finally {
      setAvatarUploading(false)
    }
  }
  const handlePresenceChange = async event => {
    const presence = event.target.value
    setPresenceSaving(true)
    setPresenceError('')
    try {
      const response = await fetch('/api/auth/me/presence/', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ presence }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Presence could not be updated.')
      onProfileUpdated({ presence: data.presence })
    } catch (error) {
      setPresenceError(error.message || 'Presence could not be updated.')
    } finally {
      setPresenceSaving(false)
    }
  }
  const roleLabel = currentWorkspace?.role === 'owner' ? 'Owner' : currentWorkspace?.role === 'manager' ? 'Manager' : 'Member'
  const unreadCount = notifications.filter(notification => !notification.read).length
  return <section className="workspace-view settings-view">
    <WorkspaceViewHeading title="Settings" subtitle="Control your workspace, account, and notification preferences." />
    <div className="settings-shell">
      <nav className="settings-nav" aria-label="Settings sections">{sections.map(([value, label, Icon]) => <button type="button" key={value} className={section === value ? 'active' : ''} onClick={() => setSection(value)}><Icon size={16} />{label}</button>)}</nav>
      <div className="settings-content">
        {section === 'appearance' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Personal preferences</p><h2>Appearance</h2><p>Choose how WorkSpace looks on this device.</p></div></div><div className="settings-row settings-control-row"><div><strong>Theme</strong><span>Light, dark, or follow your operating system.</span></div><div className="settings-segmented" role="radiogroup" aria-label="Theme"><button type="button" className={theme === 'light' ? 'active' : ''} onClick={() => onSetTheme('light')}>Light</button><button type="button" className={theme === 'dark' ? 'active' : ''} onClick={() => onSetTheme('dark')}>Dark</button><button type="button" className={theme === 'system' ? 'active' : ''} onClick={() => onSetTheme('system')}>System</button></div></div><div className="settings-row settings-control-row"><div><strong>Sidebar</strong><span>Use a full navigation menu or compact icon rail.</span></div><button type="button" className="settings-switch" aria-pressed={!sidebarCollapsed} onClick={onToggleSidebar}><span />{sidebarCollapsed ? 'Collapsed' : 'Expanded'}</button></div></Card>}
        {section === 'notifications' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Stay informed</p><h2>Notifications</h2><p>{unreadCount ? `${unreadCount} unread workspace updates.` : 'You are all caught up.'}</p></div></div>{notificationPrefs ? preferenceRows.map(([key, label, description]) => <div className="settings-row settings-control-row" key={key}><div><strong>{label}</strong><span>{description}</span></div><button type="button" className={`settings-switch ${notificationPrefs[key] ? 'is-on' : ''}`} aria-pressed={notificationPrefs[key]} onClick={() => updatePreference(key, !notificationPrefs[key])}><span />{notificationPrefs[key] ? 'On' : 'Off'}</button></div>) : <p className="settings-note">Loading your preferences…</p>}{prefsError && <p className="auth-error" role="alert">{prefsError}</p>}<div className="settings-row settings-control-row"><div><strong>Desktop notifications</strong><span>{browserPermission === 'granted' ? 'Enabled in this browser.' : browserPermission === 'denied' ? 'Blocked - allow notifications for this site in your browser settings.' : browserPermission === 'unsupported' ? 'Not supported in this browser.' : 'Get a native alert for calendar reminders.'}</span></div>{browserPermission === 'default' && <button type="button" className="secondary-button" onClick={requestBrowserPermission}>Enable</button>}</div><p className="settings-note">Turning a category off stops those notifications from being created for you, on every device.</p></Card>}
        {section === 'profile' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Your account</p><h2>Profile</h2><p>Your identity as it appears across the workspace.</p></div></div><div className="settings-profile-card"><span className="avatar-upload"><Avatar name={currentUserName} avatarUrl={currentUserAvatarUrl} presence={currentUserPresence} className="settings-profile-avatar" /><label className="avatar-upload-trigger" aria-label="Change profile photo"><Camera size={14} /><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={handleAvatarChange} disabled={avatarUploading} /></label></span><div><strong>{currentUserName}</strong><span>{currentWorkspace?.name || 'Workspace member'}</span>{currentUserAvatarUrl && <button type="button" className="text-button" onClick={handleAvatarRemove} disabled={avatarUploading}>Remove photo</button>}</div></div>{avatarError && <p className="auth-error" role="alert">{avatarError}</p>}<div className="settings-row settings-control-row"><div><strong>Presence</strong><span>Shown to teammates next to your name, like a status in Teams.</span></div><span className="presence-select"><span className={`presence-dot presence-${currentUserPresence}`} /><select value={currentUserPresence} onChange={handlePresenceChange} disabled={presenceSaving} aria-label="Set your presence"><option value="available">Available</option><option value="busy">Busy</option><option value="away">Away</option><option value="offline">Offline</option></select></span></div>{presenceError && <p className="auth-error" role="alert">{presenceError}</p>}<div className="settings-row"><div><strong>Email address</strong><span>Your sign-in and notification address.</span></div><em>{currentUserEmail}</em></div><div className="settings-row"><div><strong>Workspace role</strong><span>Access level for this workspace.</span></div><em>{roleLabel}</em></div><p className="settings-note">Profile editing and password changes can be added here once account-management endpoints are enabled.</p></Card>}
        {section === 'workspace' && <Card className="settings-panel"><div className="settings-panel-heading"><div><p className="eyebrow">Workspace administration</p><h2>Workspace access</h2><p>Review who can access {currentWorkspace?.name || 'this workspace'}.</p></div></div><div className="settings-stat-grid"><div><strong>{members.length}</strong><span>Members</span></div><div><strong>{members.filter(member => member.role === 'owner' || member.role === 'manager').length}</strong><span>Managers</span></div><div><strong>{currentWorkspace?.role === 'owner' ? 'Owner' : canManageMembers ? 'Manager' : 'Member'}</strong><span>Your role</span></div></div><div className="settings-member-list">{members.slice(0, 8).map(member => <div className="settings-member-row" key={member.id}><Avatar name={[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email} avatarUrl={member.avatar_url} presence={member.presence} small /><div><strong>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</strong><span>{member.email}</span></div><em>{member.role}</em></div>)}</div>{canManageMembers && <p className="settings-note">Member invitations and role changes are available from Team board.</p>}</Card>}
      </div>
    </div>
  </section>
}

function HelpView({ onNavigate }) {
  const [openTopic, setOpenTopic] = useState(0)
  const topics = [
    {
      title: 'Create and assign a task',
      icon: CheckCircle2,
      intro: 'Capture work so someone owns it and knows when it is due.',
      steps: [
        'Open Today, My tasks, Planner, or Daily operations and select Add task.',
        'Enter a clear task name and add any useful description.',
        'Assign the task to the right person or leave it unassigned.',
        'Choose a due date.',
        'Choose a project for project work, or leave it in General for operations work.',
        'Set a priority and planner bucket.',
        'Select Create task.',
      ],
    },
    {
      title: 'Run daily operations',
      icon: ClipboardList,
      intro: 'Keep recurring non-project work moving through the same predictable lanes.',
      steps: [
        'Open Daily operations from the sidebar.',
        'Create a workstream such as Finance, Customer Support, or People.',
        'Add an operation task and leave its project as General or operations scope.',
        'Move the task through the board buckets as work progresses.',
        'Update its status when it starts, needs review, or finishes.',
        'Add a blocker and explanation when something is stuck.',
      ],
    },
    {
      title: 'Plan project work',
      icon: LayoutGrid,
      intro: 'Use Planner to organise delivery work by bucket, owner, priority, and date.',
      steps: [
        'Open Planner and choose All projects or a specific project.',
        'Switch between Board, Table, and Gantt to match how you want to work.',
        'Add a project task and assign it to the delivery owner.',
        'Drag tasks between buckets to move work through delivery.',
        'Filter by status, workstream, owner, priority, phase, bucket, or date.',
        'Save a useful filtered view so the team can return to it later.',
      ],
    },
    {
      title: 'Review team workload',
      icon: Users,
      intro: 'Use Team board to spot overload, blocked work, and unassigned work.',
      steps: [
        'Open Team board.',
        'Choose a scope: all work, operations, or a specific project.',
        'Switch between People, Status, and Priority views.',
        'Look for Blocked, Overdue, and Unassigned metrics at the top.',
        'Open a task to reassign it, update its status, or add context.',
      ],
    },
    {
      title: 'Track a project',
      icon: Target,
      intro: 'Keep a project healthy by tracking delivery progress and risks in one place.',
      steps: [
        'Open Projects.',
        'Create a new project or open an existing project.',
        'Add project tasks from Planner.',
        'Review the project completion percentage and blocked or overdue counts.',
        'Open the project detail view.',
        'Add risks and issues from Risk register & issue log.',
        'Update risk or issue status as mitigation progresses.',
      ],
    },
    {
      title: 'Schedule calendar work',
      icon: CalendarDays,
      intro: 'Capture meetings, focus time, deadlines, and reminders so time is visible.',
      steps: [
        'Open Calendar.',
        'Select Add event.',
        'Enter a title and optional description.',
        'Choose start time, end time, event type, and reminder.',
        'Save the event.',
        'Switch between Day, Week, Month, Year, and Agenda views.',
        'Use the Upcoming panel to export ICS or add an event to Google Calendar.',
      ],
    },
    {
      title: 'Talk with the team',
      icon: MessageSquare,
      intro: 'Use Channels for shared topics and Chats for private conversations.',
      steps: [
        'Open Channels for team-wide discussions.',
        'Open an existing channel or create a new one.',
        'Type a message and press Enter to send.',
        'Use reply to keep a thread clear.',
        'Open Chats for private one-to-one or group conversations.',
        'Select New chat and choose one or more people.',
      ],
    },
    {
      title: 'Track follow-ups',
      icon: Bell,
      intro: 'Capture promises and items that need a response so nothing falls through.',
      steps: [
        'Open Follow-up.',
        'Select Add follow-up.',
        'Write a clear note such as Ask for launch approval.',
        'Set a due date.',
        'Assign it to the person who must respond.',
        'Link it to a task when it relates to existing work.',
        'Edit, mark done, reopen, or delete it as needed.',
      ],
    },
    {
      title: 'Complete a daily check-in',
      icon: Hash,
      intro: 'Tell the team what moved forward, what is next, and what is blocking you.',
      steps: [
        'Open Check-ins.',
        'Select Start check-in.',
        'Confirm the date.',
        'Write what you completed.',
        'Write what is next.',
        'Write any blockers.',
        'Save. You can edit your own check-in later from its card.',
      ],
    },
    {
      title: 'Use Reports',
      icon: BarChart3,
      intro: 'Turn workspace work into a focused delivery-health view.',
      steps: [
        'Open Reports.',
        'Choose scope: all work, operations, or a project.',
        'Choose a reporting period.',
        'Review total, overdue, blocked, and completion metrics.',
        'Select a status, overdue, blocked, or unassigned metric to drill into those tasks.',
      ],
    },
    {
      title: 'Manage notifications',
      icon: Bell,
      intro: 'Control what interrupts you and how calendar reminders reach you.',
      steps: [
        'Open Settings.',
        'Select Notifications.',
        'Turn mentions, direct messages, task updates, and calendar reminders on or off.',
        'Enable desktop notifications if you want browser alerts.',
      ],
    },
    {
      title: 'Update your profile',
      icon: Camera,
      intro: 'Keep your identity, photo, and availability clear for teammates.',
      steps: [
        'Open Settings.',
        'Select Profile.',
        'Upload or remove a profile photo.',
        'Set your presence to Available, Busy, Away, or Offline.',
        'Review your email address and workspace role.',
      ],
    },
    {
      title: 'Invite a teammate',
      icon: Plus,
      intro: 'Bring someone into the workspace with the correct access level.',
      steps: [
        'Open Team board.',
        'Scroll to People & access.',
        'Select Invite member.',
        'Enter their email address.',
        'Choose Member or Manager.',
        'Send the invitation.',
      ],
    },
  ]
  return <section className="workspace-view help-view"><WorkspaceViewHeading title="Help center" subtitle="Step-by-step instructions for getting work done in WorkSpace." /><div className="help-grid"><Card className="help-welcome"><p className="eyebrow">Welcome to WorkSpace</p><h2>Learn by doing</h2><p>Expand any workflow below to see the exact actions to take. Start with Create and assign a task, then move to Daily operations or Planner when your work has a clear home.</p><div className="help-actions"><button type="button" className="primary-button" onClick={() => onNavigate('Today')}>Open Today</button><button type="button" className="secondary-button" onClick={() => onNavigate('Planner')}>Open Planner</button></div></Card>{topics.map((topic, index) => <Card className={`help-topic ${openTopic === index ? 'is-open' : ''}`} key={topic.title}><button type="button" className="help-topic-header" onClick={() => setOpenTopic(current => current === index ? null : index)} aria-expanded={openTopic === index}><topic.icon size={16} /><h3>{topic.title}</h3><ChevronDown size={16} className="help-chevron" /></button>{openTopic === index && <div className="help-topic-content"><p>{topic.intro}</p><ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol></div>}</Card>)}</div><Card className="help-contact"><div><p className="eyebrow">Need more help?</p><h2>Contact your workspace administrator</h2><p>For access, billing, deletion, or security requests, contact the person who manages your workspace.</p></div><button type="button" className="secondary-button" onClick={() => onNavigate('Settings')}>Open Settings</button></Card></section>
}
function LegalView() {
  const [document, setDocument] = useState('privacy')
  const [accepted, setAccepted] = useState(() => localStorage.getItem('workspace-legal-accepted-v1') === 'true')
  const documents = {
    privacy: { label: 'Privacy & GDPR', title: 'Privacy notice', intro: 'This notice explains what personal data WorkSpace uses, why it is used, and the choices available to you.', sections: [['What we collect', 'Account details, workspace membership, tasks, messages, calendar entries, check-ins, and technical information needed to keep the service secure.'], ['Why we use it', 'We use this data to provide the workspace, authenticate users, deliver notifications, support collaboration, prevent abuse, and improve reliability.'], ['Your rights', 'Depending on your location, you may have rights to access, correct, export, restrict, object to, or delete your personal data. Contact your workspace administrator to make a request.'], ['Retention and security', 'We retain workspace data for as long as the workspace is active or as required for legitimate business and legal purposes. Access controls, authentication, and audit records help protect it.']] },
    cookies: { label: 'Cookies', title: 'Cookie notice', intro: 'WorkSpace uses a small number of cookies and browser storage entries to keep you signed in and remember your preferences.', sections: [['Essential cookies', 'Session and CSRF cookies are required for authentication and secure form submissions. They cannot be switched off in the app.'], ['Preference storage', 'Theme, sidebar layout, and legal acceptance are stored locally in your browser so the app can remember your choices.'], ['Analytics and marketing', 'This application does not intentionally use advertising cookies. If analytics are added later, this notice should be updated and consent requested where required.']] },
    terms: { label: 'Terms of service', title: 'Terms of service', intro: 'By using WorkSpace, you agree to use it lawfully, protect your login, and respect the people and data in your workspace.', sections: [['Your account', 'Provide accurate account information, keep credentials private, and tell your administrator if you suspect unauthorized access.'], ['Workspace content', 'You remain responsible for the content you add and for ensuring you have permission to share it with workspace members.'], ['Availability', 'We aim to keep WorkSpace reliable, but maintenance, outages, and changes may occur. Do not use the service for emergency or safety-critical decisions.']] },
    acceptable: { label: 'Acceptable use', title: 'Acceptable use policy', intro: 'Use WorkSpace responsibly and do not put other people, the service, or sensitive data at unreasonable risk.', sections: [['Do not misuse the service', 'Do not access accounts without permission, probe or disrupt systems, distribute malware, or attempt to bypass security controls.'], ['Respect people', 'Do not use WorkSpace for harassment, threats, unlawful discrimination, or sharing content that you do not have the right to distribute.'], ['Report concerns', 'Tell your workspace administrator promptly about suspected abuse, data exposure, or security issues.']] },
  }
  const current = documents[document]
  const accept = event => { const next = event.target.checked; setAccepted(next); if (next) localStorage.setItem('workspace-legal-accepted-v1', 'true'); else localStorage.removeItem('workspace-legal-accepted-v1') }
  return <section className="workspace-view legal-view"><WorkspaceViewHeading title="Legal & privacy" subtitle="Review the policies that govern your use of WorkSpace." /><div className="legal-layout"><nav className="legal-nav" aria-label="Legal documents">{Object.entries(documents).map(([key, item]) => <button type="button" className={document === key ? 'active' : ''} key={key} onClick={() => setDocument(key)}>{item.label}</button>)}</nav><Card className="legal-document"><p className="eyebrow">WorkSpace policies</p><h2>{current.title}</h2><p className="legal-intro">{current.intro}</p>{current.sections.map(([heading, body]) => <section key={heading}><h3>{heading}</h3><p>{body}</p></section>)}<p className="legal-meta">Last updated: 3 September 2026 · Review this policy with your legal adviser for your organisation's specific obligations.</p></Card></div><Card className="legal-acceptance"><div><h3>Policy acknowledgement</h3><p>To continue using this workspace, confirm that you have read and agree to the Terms of service and Acceptable use policy, and acknowledge the Privacy and Cookie notices.</p></div><label><input type="checkbox" checked={accepted} onChange={accept} /> I have read and accept these policies</label></Card></section>
}

function CookieConsent({ onOpenLegal }) {
  const [choice, setChoice] = useState(() => localStorage.getItem('workspace-cookie-consent-v1'))
  if (choice) return null
  const save = value => { localStorage.setItem('workspace-cookie-consent-v1', value); setChoice(value) }
  return <aside className="cookie-consent" role="dialog" aria-label="Cookie preferences"><div><strong>Cookie preferences</strong><p>We use essential cookies to keep you signed in and secure. Optional analytics cookies are currently not enabled.</p><button type="button" className="cookie-link" onClick={onOpenLegal}>Read the Cookie notice</button></div><div className="cookie-actions"><button type="button" className="secondary-button" onClick={() => save('essential')}>Essential only</button><button type="button" className="primary-button" onClick={() => save('all')}>Accept all</button></div></aside>
}

function WorkspaceView({ active, data, tasks, searchQuery, onSearchChange, onNavigate, theme, onSetTheme, sidebarCollapsed, workspaceId, currentWorkspace, currentUserName, currentUserEmail, currentUserId, currentUserAvatarUrl, currentUserPresence, onProfileUpdated, canManageMembers, canManageTasks, reportRange, setReportRange, reportLastUpdated, onToggleTheme, onToggleSidebar, onComplete, onStatusChange, onBucketChange, onDelete, onAddTask, onOpenTask, onActionError, onRefresh, onConfirm }) {
  const today = toDateKey(new Date())
  const [localData, setLocalData] = useState(data)
  const [calendarView, setCalendarView] = useState('week')
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [calendarFilter, setCalendarFilter] = useState('all')
  const [checkInDate, setCheckInDate] = useState(today)
  const [checkInLoading, setCheckInLoading] = useState(false)
  const [checkInError, setCheckInError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerType, setComposerType] = useState('chat')
  const [composerError, setComposerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [newBucketName, setNewBucketName] = useState('')
  const [bucketError, setBucketError] = useState('')
  const [bucketSubmitting, setBucketSubmitting] = useState(false)
  const [newWorkstreamName, setNewWorkstreamName] = useState('')
  const [workstreamSubmitting, setWorkstreamSubmitting] = useState(false)
  const [workstreamError, setWorkstreamError] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [chatChannel, setChatChannel] = useState('general')
  const [chatSearch, setChatSearch] = useState('')
  const [plannerFilter, setPlannerFilter] = useState('all')
  const [plannerProjectFilter, setPlannerProjectFilter] = useState('all')
  const [reportsScope, setReportsScope] = useState('all')
  const [teamBoardScope, setTeamBoardScope] = useState('all')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityActor, setActivityActor] = useState('all')
  const [activityKind, setActivityKind] = useState('all')
  const [projectQuery, setProjectQuery] = useState('')
  const [projectStatusFilter, setProjectStatusFilter] = useState('all')
  const [projectHealthFilter, setProjectHealthFilter] = useState('all')
  const [projectSort, setProjectSort] = useState('due')
  const [savedViewName, setSavedViewName] = useState('')
  const [selectedSavedView, setSelectedSavedView] = useState('')
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedProjectWorkspace, setSelectedProjectWorkspace] = useState(null)
  const [selectedFollowUp, setSelectedFollowUp] = useState(null)
  const [selectedCheckIn, setSelectedCheckIn] = useState(null)
  const [followUpFilter, setFollowUpFilter] = useState('all')
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [savedViews, setSavedViews] = useState(data.savedViews || [])
  const [form, setForm] = useState({ title: '', name: '', description: '', start_at: '', end_at: '', event_type: 'meeting', reminder_minutes: 15, completed: '', next_steps: '', blockers: '', message: '', channel: 'general', note: '', due_date: '', assigned_to: '', task_id: '', date: today, email: '', role: 'member' })
  useEffect(() => {
    const handleReportFilter = event => { if (event.detail) setPlannerFilter(event.detail) }
    window.addEventListener('planner:filter', handleReportFilter)
    const handleProjectFilter = event => setPlannerProjectFilter(event.detail || 'all')
    window.addEventListener('planner:project', handleProjectFilter)
    return () => { window.removeEventListener('planner:filter', handleReportFilter); window.removeEventListener('planner:project', handleProjectFilter) }
  }, [])
  useEffect(() => {
    if (active !== 'Projects' || selectedProjectWorkspace) return undefined
    const openProjectCard = event => {
      const card = event.target.closest?.('.project-card')
      if (!card || event.target.closest?.('button, select, a, input')) return
      const projectName = card.querySelector('h3')?.textContent?.trim()
      const project = localData.projects.find(item => item.name === projectName)
      if (project) setSelectedProjectWorkspace(project)
    }
    const openProjectCardWithKeyboard = event => {
      if (!['Enter', ' '].includes(event.key)) return
      const card = event.target.closest?.('.project-card')
      if (!card) return
      event.preventDefault()
      const projectName = card.querySelector('h3')?.textContent?.trim()
      const project = localData.projects.find(item => item.name === projectName)
      if (project) setSelectedProjectWorkspace(project)
    }
    const cards = [...document.querySelectorAll('.projects-view .project-card')]
    cards.forEach(card => { card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `Open project ${card.querySelector('h3')?.textContent || ''}`) })
    document.addEventListener('click', openProjectCard)
    document.addEventListener('keydown', openProjectCardWithKeyboard)
    return () => { document.removeEventListener('click', openProjectCard); document.removeEventListener('keydown', openProjectCardWithKeyboard) }
  }, [active, selectedProjectWorkspace, localData.projects])
  useEffect(() => {
    const closeOverlays = event => {
      if (event.key !== 'Escape') return
      setComposerOpen(false)
      setReplyTo(null)
      setSelectedProject(null)
      setSelectedFollowUp(null)
      setSelectedCheckIn(null)
      setSelectedEvent(null)
    }
    window.addEventListener('keydown', closeOverlays)
    return () => window.removeEventListener('keydown', closeOverlays)
  }, [])
  useEffect(() => setLocalData(current => ({ ...data, buckets: [...(data.buckets || []), ...(current.buckets || []).filter(existing => !(data.buckets || []).some(bucket => bucket.id === existing.id))], checkIns: current.checkIns })), [data])
  useEffect(() => setSavedViews(data.savedViews || []), [data.savedViews])

  useEffect(() => {
    if (active !== 'Check-ins') return undefined
    let isCurrent = true
    setCheckInLoading(true)
    setCheckInError('')
    fetch(`/api/workspaces/${workspaceId}/check-ins/?date=${checkInDate}`, { credentials: 'include' })
      .then(response => response.json().then(responseData => ({ ok: response.ok, responseData })))
      .then(({ ok, responseData }) => {
        if (!isCurrent) return
        if (!ok) throw new Error(responseData.error || 'Check-ins could not be loaded.')
        setLocalData(current => ({ ...current, checkIns: responseData.check_ins }))
      })
      .catch(error => {
        if (isCurrent) setCheckInError(error.message)
      })
      .finally(() => {
        if (isCurrent) setCheckInLoading(false)
      })
    return () => {
      isCurrent = false
    }
  }, [active, checkInDate, workspaceId])

  const openComposer = type => {
    setComposerType(type)
    setComposerError('')
    setForm(current => ({ ...current, title: '', name: '', description: '', start_at: '', end_at: '', reminder_minutes: 15, completed: '', next_steps: '', blockers: '', message: '', channel: chatChannel, note: '', due_date: '', assigned_to: '', task_id: '', date: type === 'checkin' ? checkInDate : today, email: '', role: 'member' }))
    if (type !== 'chat') setReplyTo(null)
    setComposerOpen(true)
  }

  const submitComposer = async event => {
    event.preventDefault()
    setComposerError('')
    setSubmitting(true)
    const endpoints = { calendar: `/api/workspaces/${workspaceId}/calendar-events/`, project: `/api/workspaces/${workspaceId}/projects/`, checkin: `/api/workspaces/${workspaceId}/check-ins/`, chat: `/api/workspaces/${workspaceId}/chat-messages/`, followup: `/api/workspaces/${workspaceId}/follow-ups/`, invite: `/api/workspaces/${workspaceId}/invitations/` }
    const payloads = { calendar: { title: form.title, description: form.description, start_at: form.start_at, end_at: form.end_at, event_type: form.event_type, reminder_minutes: Number(form.reminder_minutes) }, project: { name: form.name, description: form.description, due_date: form.due_date || null }, checkin: { date: form.date, completed: form.completed, next_steps: form.next_steps, blockers: form.blockers }, chat: { channel: form.channel, message: form.message, parent_id: replyTo?.id || null }, followup: { note: form.note, due_date: form.due_date || null, assigned_to: form.assigned_to || null, task_id: form.task_id || null }, invite: { email: form.email, role: form.role } }
    try {
      const response = await fetch(endpoints[composerType], { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify(payloads[composerType]) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Unable to save this update.')
      const collections = { calendar: ['events', 'event'], project: ['projects', 'project'], checkin: ['checkIns', 'check_in'], chat: ['messages', 'message'], followup: ['followUps', 'follow_up'], invite: ['invitations', 'invitation'] }
      const [collection, itemKey] = collections[composerType]
      const item = responseData[itemKey]
      setLocalData(current => ({ ...current, [collection]: composerType === 'checkin' ? [...current[collection].filter(existing => existing.id !== item.id), item] : [...current[collection], item] }))
      onRefresh()
      setComposerOpen(false)
      setReplyTo(null)
    } catch (submitError) {
      setComposerError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const runAction = async (operation, fallbackMessage) => {
    try {
      const response = await operation()
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || fallbackMessage)
      return responseData
    } catch (error) {
      onActionError(error.message || fallbackMessage)
      return null
    }
  }

  const completeFollowUp = async followUp => {
    const canEdit = canManageMembers || followUp.created_by === currentUserId || followUp.assigned_to === currentUserId
    if (!canEdit) {
      onActionError('Only the follow-up creator, assignee, or a workspace leader can update it.')
      return
    }
    const nextStatus = followUp.status === 'completed' ? 'open' : 'completed'
    const responseData = await runAction(async () => fetch(`/api/follow-ups/${followUp.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ status: nextStatus }) }), 'Follow-up could not be updated.')
    if (!responseData) return
    setLocalData(current => ({ ...current, followUps: current.followUps.map(item => item.id === followUp.id ? responseData.follow_up : item) }))
    onRefresh()
  }
  const deleteFollowUp = async followUp => {
    if (!(await onConfirm('Delete this follow-up?', { confirmLabel: 'Delete follow-up' }))) return
    const responseData = await runAction(async () => fetch(`/api/follow-ups/${followUp.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } }), 'Follow-up could not be deleted.')
    if (!responseData) return
    setLocalData(current => ({ ...current, followUps: current.followUps.filter(item => item.id !== followUp.id) }))
    onRefresh()
  }
  const deleteCalendarEvent = async eventId => {
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/calendar-events/${eventId}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } }), 'Calendar event could not be deleted.')
    if (!responseData) return
    setLocalData(current => ({ ...current, events: current.events.filter(event => event.id !== eventId) }))
    onRefresh()
  }
  const createBucket = async event => {
    event.preventDefault()
    if (bucketSubmitting) return
    if (!canManageMembers) {
      setBucketError('Only workspace leaders can create Planner buckets.')
      return
    }
    const name = newBucketName.trim()
    if (!name) return
    setBucketError('')
    setBucketSubmitting(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/plan-buckets/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ name }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Bucket could not be created.')
      setLocalData(current => ({ ...current, buckets: current.buckets.some(bucket => bucket.id === responseData.bucket.id) ? current.buckets : [...current.buckets, responseData.bucket] }))
      setNewBucketName('')
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `Bucket “${responseData.bucket.name}” created.` }))
      onRefresh()
    } catch (error) {
      setBucketError(error.message || 'Bucket could not be created.')
    } finally {
      setBucketSubmitting(false)
    }
  }

  const createWorkstream = async event => {
    event.preventDefault()
    if (workstreamSubmitting) return
    if (!canManageMembers) {
      setWorkstreamError('Only workspace leaders can create operations workstreams.')
      return
    }
    const name = newWorkstreamName.trim()
    if (!name) return
    setWorkstreamError('')
    setWorkstreamSubmitting(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/lookup-values/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ kind: 'workstream', name, project_id: null }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Workstream could not be created.')
      setLocalData(current => ({ ...current, lookupValues: (current.lookupValues || []).some(value => value.id === responseData.lookup_value.id) ? current.lookupValues : [...(current.lookupValues || []), responseData.lookup_value] }))
      setNewWorkstreamName('')
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `Workstream ${responseData.lookup_value.name} created.` }))
      onRefresh()
    } catch (error) {
      setWorkstreamError(error.message || 'Workstream could not be created.')
    } finally {
      setWorkstreamSubmitting(false)
    }
  }

  const reorderBuckets = async bucketIds => {
    if (!canManageMembers) return
    const previousBuckets = [...localData.buckets]
    const byId = new Map(previousBuckets.map(bucket => [Number(bucket.id), bucket]))
    const ids = bucketIds.map(Number)
    if (ids.length !== previousBuckets.length || new Set(ids).size !== ids.length || ids.some(id => !byId.has(id))) {
      setBucketError('Bucket order could not be saved. Refresh the page and try again.')
      return
    }
    const nextBuckets = ids.map(id => byId.get(id))
    if (nextBuckets.every((bucket, index) => bucket.id === previousBuckets[index]?.id)) return
    setBucketError('')
    setLocalData(current => ({ ...current, buckets: nextBuckets }))
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/plan-buckets/reorder/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ bucket_ids: ids }) })
      const responseData = await response.json()
      if (!response.ok) throw new Error(responseData.error || 'Bucket order could not be saved.')
      setLocalData(current => ({ ...current, buckets: responseData.buckets }))
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Bucket order saved.' }))
      onRefresh()
    } catch (error) {
      setLocalData(current => ({ ...current, buckets: previousBuckets }))
      setBucketError(error.message || 'Bucket order could not be saved.')
    }
  }
  const calendarDays = getCalendarDays(calendarView, calendarDate)
  const calendarEventsForDay = day => localData.events.filter(event => {
    const eventDate = new Date(event.start_at)
    if (calendarView === 'year') return eventDate.getFullYear() === day.getFullYear() && eventDate.getMonth() === day.getMonth()
    return toDateKey(event.start_at) === toDateKey(day)
  })
  const upcomingEvents = localData.events
    .filter(event => new Date(event.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
  const calendarHeading = calendarView === 'year'
    ? formatCalendarDate(calendarDate, { year: 'numeric' })
    : formatCalendarDate(calendarDate, { month: 'long', year: 'numeric' })
  const shiftCalendar = amount => {
    const next = new Date(calendarDate)
    if (calendarView === 'day' || calendarView === 'agenda') next.setDate(next.getDate() + amount)
    if (calendarView === 'week') next.setDate(next.getDate() + amount * 7)
    if (calendarView === 'month') next.setMonth(next.getMonth() + amount)
    if (calendarView === 'year') next.setFullYear(next.getFullYear() + amount)
    setCalendarDate(next)
  }
  const updateProjectStatus = async (project, status) => {
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ status }) }), 'Project status could not be saved.')
    if (!responseData) return
    setLocalData(current => ({ ...current, projects: current.projects.map(item => item.id === project.id ? responseData.project : item) }))
    onRefresh()
  }
  const deleteProject = async project => {
    if (!canManageMembers || !(await onConfirm(`Delete ${project.name}? This cannot be undone.`, { title: 'Delete project', confirmLabel: 'Delete project' }))) return
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } }), 'Project could not be deleted.')
    if (!responseData) return
    setLocalData(current => ({ ...current, projects: current.projects.filter(item => item.id !== project.id) }))
    onRefresh()
  }
  const updateMemberRole = async (member, role) => {
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ role }) }), 'Member role could not be updated.')
    if (!responseData) return
    setLocalData(current => ({ ...current, members: current.members.map(item => item.id === member.id ? responseData.member : item) }))
    onRefresh()
  }
  const removeMember = async member => {
    if (member.role === 'owner' || !(await onConfirm(`Remove ${member.email} from this workspace?`, { title: 'Remove member', confirmLabel: 'Remove member' }))) return
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } }), 'Member could not be removed.')
    if (!responseData) return
    setLocalData(current => ({ ...current, members: current.members.filter(item => item.id !== member.id) }))
    onRefresh()
  }
  const cancelInvitation = async invitation => {
    if (!(await onConfirm(`Cancel invitation for ${invitation.email}?`, { title: 'Cancel invitation', confirmLabel: 'Cancel invitation' }))) return
    const responseData = await runAction(async () => fetch(`/api/workspaces/${workspaceId}/invitations/${invitation.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } }), 'Invitation could not be cancelled.')
    if (!responseData) return
    setLocalData(current => ({ ...current, invitations: current.invitations.map(item => item.id === invitation.id ? { ...item, status: 'cancelled' } : item) }))
    onRefresh()
  }
  const title = active === 'My tasks' ? 'My tasks' : active
  const subtitle = {
    'My tasks': 'Your personal work, deadlines, and follow-ups.',
    'Team board': 'See ownership and progress across the workspace.',
    Planner: 'Plan work visually across buckets, owners, and priorities.',
    'Daily operations': 'Track recurring and day-to-day work outside projects.',
    Calendar: 'Meetings, focus time, and deadlines in one view.',
    Reports: 'Understand progress, workload, and team health.',
    Settings: 'Manage your workspace preferences.',
    Projects: 'Keep initiatives, milestones, and ownership visible.',
    Channels: 'Shared workspace rooms for topics, projects, and teams.',
    Chats: 'Private one-to-one and group conversations.',
    'Follow-up': 'A clear queue for work that needs a response.',
    'Check-ins': 'Daily updates that keep the team aligned.',
    Help: 'Guides for tasks, conversations, and workspace settings.',
    Legal: 'Privacy, cookies, terms, and acceptable use.',
  }[active]

  if (active === 'Daily operations') {
    const persistedBacklog = localData.buckets.find(bucket => bucket.name === 'Backlog')
    const configuredBuckets = [persistedBacklog || { id: 'backlog', name: 'Backlog' }, ...localData.buckets.filter(bucket => bucket.name !== 'Backlog')]
    const configuredNames = new Set(configuredBuckets.map(bucket => bucket.name))
    const buckets = [...configuredBuckets, ...[...new Set(tasks.map(task => task.bucket || 'Backlog'))].filter(name => !configuredNames.has(name)).map(name => ({ id: `legacy-${name}`, name }))]
    const availableMembers = localData.members.filter(member => member.id)
    return <section className="workspace-view planner-view-wrapper">
      <PlannerBoard buckets={buckets} tasks={tasks} projects={localData.projects} lookupValues={localData.lookupValues || []} projectFilter="operations" scopeMode="operations" onSearchChange={onSearchChange} members={availableMembers} searchQuery={searchQuery} canManageTasks={canManageTasks} canManageBuckets={canManageMembers} currentUserId={currentUserId} onStatusChange={onStatusChange} onOpenTask={onOpenTask} onDeleteTask={onDelete} onAddTask={() => { sessionStorage.setItem('workspace-new-task-scope', 'operations'); onAddTask() }} onTaskMove={onBucketChange} onBucketReorder={reorderBuckets} newBucketName={newBucketName} setNewBucketName={setNewBucketName} bucketSubmitting={bucketSubmitting} bucketError={bucketError} onCreateBucket={createBucket} newWorkstreamName={newWorkstreamName} setNewWorkstreamName={setNewWorkstreamName} workstreamSubmitting={workstreamSubmitting} workstreamError={workstreamError} onCreateWorkstream={createWorkstream} externalFilter={plannerFilter} />
    </section>
  }

  if (active === 'Planner') {
    const persistedBacklog = localData.buckets.find(bucket => bucket.name === 'Backlog')
    const configuredBuckets = [persistedBacklog || { id: 'backlog', name: 'Backlog' }, ...localData.buckets.filter(bucket => bucket.name !== 'Backlog')]
    const configuredNames = new Set(configuredBuckets.map(bucket => bucket.name))
    const buckets = [...configuredBuckets, ...[...new Set(tasks.map(task => task.bucket || 'Backlog'))].filter(name => !configuredNames.has(name)).map(name => ({ id: `legacy-${name}`, name }))]
    const availableMembers = localData.members.filter(member => member.id)
    const saveView = async event => {
      event.preventDefault()
      const name = savedViewName.trim()
      if (!name) return
      setBucketError('')
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ name, filter: plannerFilter, search: searchQuery, project_scope: plannerProjectFilter }) })
        const responseData = await response.json()
        if (!response.ok) return setBucketError(responseData.error || 'Saved view could not be created.')
        setSavedViews(current => [...current.filter(view => view.name !== name), responseData.saved_view])
        setSavedViewName('')
      } catch (error) {
        setBucketError(error.message || 'Saved view could not be created.')
      }
    }
    const applyView = event => {
      const name = event.target.value
      setSelectedSavedView(name)
      const view = savedViews.find(item => item.name === name)
      if (view) {
        setPlannerFilter(view.filter)
        onSearchChange(view.search || '')
        setPlannerProjectFilter(view.project_scope || 'all')
      }
    }
    const deleteSavedView = async () => {
      const view = savedViews.find(item => item.name === selectedSavedView)
      if (!view || !(await onConfirm(`Delete saved view "${view.name}"?`, { title: 'Delete saved view', confirmLabel: 'Delete view' }))) return
      setBucketError('')
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/${view.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
        if (!response.ok) return setBucketError('Saved view could not be deleted.')
        setSavedViews(current => current.filter(item => item.id !== view.id))
        setSelectedSavedView('')
      } catch (error) {
        setBucketError(error.message || 'Saved view could not be deleted.')
      }
    }
    return <section className="workspace-view planner-view-wrapper">
      <div className="planner-saved-views-bar">
        <select value={selectedSavedView} onChange={applyView} aria-label="Load saved Planner view">
          <option value="">Saved views…</option>
          {savedViews.map(view => <option key={view.name} value={view.name}>{view.name}</option>)}
        </select>
        <button type="button" className="secondary-button" onClick={deleteSavedView} disabled={!selectedSavedView}>Delete view</button>
        <form className="bucket-create-form" onSubmit={saveView}>
          <input value={savedViewName} onChange={event => setSavedViewName(event.target.value)} placeholder="Save current filter as…" aria-label="Saved view name" maxLength="100" />
          <button type="submit" className="secondary-button">Save view</button>
        </form>
      </div>
      <PlannerBoard buckets={buckets} tasks={tasks} projects={localData.projects} lookupValues={localData.lookupValues || []} projectFilter={plannerProjectFilter} scopeMode="projects" onProjectFilterChange={setPlannerProjectFilter} onSearchChange={onSearchChange} members={availableMembers} searchQuery={searchQuery} canManageTasks={canManageTasks} canManageBuckets={canManageMembers} currentUserId={currentUserId} onStatusChange={onStatusChange} onOpenTask={onOpenTask} onDeleteTask={onDelete} onAddTask={onAddTask} onTaskMove={onBucketChange} onBucketReorder={reorderBuckets} newBucketName={newBucketName} setNewBucketName={setNewBucketName} bucketSubmitting={bucketSubmitting} bucketError={bucketError} onCreateBucket={createBucket} externalFilter={plannerFilter} />
    </section>
  }

  if (active === 'Reports') {
    const serverReport = data.reports || { total_tasks: 0, overdue_tasks: 0, due_this_week: 0, unassigned_tasks: 0, completion_rate: 0, blocked_tasks: 0, check_ins_today: 0, members: 0, status_counts: {}, workload: [] }
    const statusLabels = { todo: 'To do', in_progress: 'In progress', review: 'Review', blocked: 'Blocked', on_hold: 'On hold', cancelled: 'Cancelled', done: 'Done' }
    // Task counts/status breakdown are recomputed client-side when a scope is picked, since the
    // server's report summary is workspace-wide. Team workload, check-ins, and the audit trail stay
    // server-provided in every scope - they're people/workspace history, not project-scoped concepts.
    const scopedTasks = reportsScope === 'all' ? null : tasks.filter(task => taskMatchesScope(task, reportsScope))
    const report = scopedTasks ? (() => {
      const openTasks = scopedTasks.filter(task => task.status !== 'done')
      const statusCounts = scopedTasks.reduce((counts, task) => { const key = task.status === 'in progress' ? 'in_progress' : task.status; counts[key] = (counts[key] || 0) + 1; return counts }, {})
      const doneCount = statusCounts.done || 0
      return {
        ...serverReport,
        total_tasks: scopedTasks.length,
        status_counts: statusCounts,
        completion_rate: scopedTasks.length ? Math.round((doneCount / scopedTasks.length) * 100) : 0,
        overdue_tasks: openTasks.filter(task => task.due_date && task.due_date < today).length,
        blocked_tasks: statusCounts.blocked || 0,
        unassigned_tasks: openTasks.filter(task => !task.assignee_id).length,
      }
    })() : serverReport
    const openPlannerWithFilter = filter => { onSearchChange(''); if (reportsScope !== 'all' && reportsScope !== 'operations') window.dispatchEvent(new CustomEvent('planner:project', { detail: reportsScope })); window.dispatchEvent(new CustomEvent('planner:filter', { detail: filter })); onNavigate(reportsScope === 'operations' ? 'Daily operations' : 'Planner') }
    const checkInRate = report.members ? Math.round((report.check_ins_today / report.members) * 100) : 0
    return <section className="workspace-view"><WorkspaceViewHeading title="Reports" subtitle={subtitle} /><div className="report-toolbar"><WorkScopeSelector compact value={reportsScope} onChange={setReportsScope} projects={localData.projects} label="Scope" /><label>Reporting period<select value={reportRange} onChange={event => setReportRange(event.target.value)}><option value="all">All time</option><option value="week">Last 7 days</option><option value="month">This month</option></select></label><button type="button" className="secondary-button" onClick={onRefresh}>Refresh reports</button><span className="report-updated">{reportLastUpdated ? `Updated ${formatCalendarDate(reportLastUpdated, { timeStyle: 'short' })}` : 'Loading report data…'}</span></div><div className="report-metrics">
      <button type="button" className="report-stat report-stat-button" onClick={() => onNavigate('Planner')}><span>Total tasks</span><strong>{report.total_tasks}</strong><em>{report.completion_rate}% complete</em></button>
      <button type="button" className="report-stat report-stat-button is-warning" onClick={() => openPlannerWithFilter('overdue')}><span>Overdue</span><strong>{report.overdue_tasks}</strong><em>Needs attention</em></button>
      <button type="button" className="report-stat report-stat-button is-danger" onClick={() => openPlannerWithFilter('blocked')}><span>Blocked</span><strong>{report.blocked_tasks}</strong><em>{report.unassigned_tasks} unassigned open</em></button>
      <Card className="report-stat"><span>Check-ins today</span><strong>{checkInRate}%</strong><em>{report.check_ins_today} of {report.members} members</em></Card>
    </div><div className="report-grid">
      <Card className="report-panel"><div className="drawer-section-heading"><h3>Task status</h3><span>{report.total_tasks} total</span></div>{Object.entries(statusLabels).map(([key, label]) => { const count = report.status_counts[key] || 0; const percentage = report.total_tasks ? Math.round((count / report.total_tasks) * 100) : 0; return <button type="button" className="report-bar-row report-bar-button" key={key} onClick={() => openPlannerWithFilter(key === 'in_progress' ? 'in progress' : key)}><span>{label}</span><div><i style={{ width: `${percentage}%` }} /></div><strong>{count}</strong><small>{percentage}%</small></button> })}</Card>
      <Card className="report-panel"><div className="drawer-section-heading"><h3>Team workload</h3><span>{report.members} members</span></div>{report.workload.length ? report.workload.map(member => <div className="report-member-row" key={member.user_id}><span>{member.user_name}</span><strong>{member.open} open</strong><em>{member.blocked} blocked</em></div>) : <EmptyState text="No team workload yet." />}</Card>
    </div><div className="report-grid report-risk-grid"><Card className="report-panel"><div className="drawer-section-heading"><h3>Delivery risks</h3><span>Open work</span></div><div className="report-risk-list"><button type="button" onClick={() => openPlannerWithFilter('overdue')}><strong>{report.overdue_tasks}</strong><span>Overdue tasks</span></button><button type="button" onClick={() => onNavigate('Calendar')}><strong>{report.due_this_week}</strong><span>Due this week</span></button><button type="button" onClick={() => openPlannerWithFilter('unassigned')}><strong>{report.unassigned_tasks}</strong><span>Unassigned tasks</span></button></div></Card>
      <Card className="report-panel"><div className="drawer-section-heading"><h3>Report guidance</h3><span>Next actions</span></div><p className="report-guidance">Use the period filter to compare recent delivery. Open blocked or overdue counts to resolve the underlying tasks, then use Planner to rebalance ownership.</p></Card></div>
    <Card className="report-panel audit-panel"><div className="drawer-section-heading"><h3>Audit trail</h3><span>Latest 12 events</span></div>{data.auditLogs?.length ? data.auditLogs.slice(0, 12).map(log => <div className="audit-row" key={log.id}><span className="audit-action">{log.action.replaceAll('_', ' ')}</span><div><strong>{log.actor_name}</strong><span>{log.target_type}{log.target_id ? ` #${log.target_id}` : ''}</span></div><time dateTime={log.created_at}>{formatCalendarDate(new Date(log.created_at), { dateStyle: 'medium', timeStyle: 'short' })}</time></div>) : <EmptyState text="No audit events recorded yet." />}</Card>
    </section>
  }
  if (active === 'Activity') {
    const activityKinds = [...new Set(data.activity.map(event => event.kind).filter(Boolean))].sort()
    const activityActors = [...new Set(data.activity.map(event => event.actor_name).filter(Boolean))].sort()
    const visibleActivity = data.activity.filter(event => (activityActor === 'all' || event.actor_name === activityActor) && (activityKind === 'all' || event.kind === activityKind) && (!activitySearch.trim() || `${event.actor_name} ${event.message} ${event.kind}`.toLowerCase().includes(activitySearch.trim().toLowerCase())))
    const groupedActivity = visibleActivity.reduce((groups, event) => { const key = toDateKey(event.created_at); (groups[key] ||= []).push(event); return groups }, {})
    const activityDateLabel = key => { const date = new Date(`${key}T12:00:00`); const todayKey = toDateKey(new Date()); const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1); const yesterdayKey = toDateKey(yesterday); return key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) }
    return <section className="workspace-view"><WorkspaceViewHeading title="Activity" subtitle="A complete recent history of workspace changes." /><div className="activity-toolbar"><label className="activity-search"><Search size={15} /><input value={activitySearch} onChange={event => setActivitySearch(event.target.value)} placeholder="Search activity" aria-label="Search activity" /></label><label>Person<select value={activityActor} onChange={event => setActivityActor(event.target.value)}><option value="all">Everyone</option>{activityActors.map(actor => <option key={actor} value={actor}>{actor}</option>)}</select></label><label>Type<select value={activityKind} onChange={event => setActivityKind(event.target.value)}><option value="all">All activity</option>{activityKinds.map(kind => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label><button type="button" className="secondary-button" onClick={onRefresh}>Refresh</button><span className="activity-count">{visibleActivity.length} of {data.activity.length} events</span></div><Card className="activity-history">{visibleActivity.length ? Object.entries(groupedActivity).map(([date, events]) => <div className="activity-day" key={date}><h3>{activityDateLabel(date)}</h3><div className="activity-list">{events.map(event => <Activity key={`activity-history-${event.id}`} avatar={event.actor_name.slice(0, 2).toUpperCase()} color="blue" kind={event.kind} text={event.actor_name} strong={event.message} suffix="" time={formatRelativeActivityTime(event.created_at)} />)}</div></div>) : <EmptyState text={data.activity.length ? 'No activity matches these filters.' : 'No workspace activity yet.'} />}</Card></section>
  }

  if (active === 'Settings') {
    return <SettingsView theme={theme} onSetTheme={onSetTheme || onToggleTheme} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={onToggleSidebar} currentWorkspace={currentWorkspace} currentUserName={currentUserName} currentUserEmail={currentUserEmail} currentUserId={currentUserId} currentUserAvatarUrl={currentUserAvatarUrl} currentUserPresence={currentUserPresence} onProfileUpdated={onProfileUpdated} canManageMembers={canManageMembers} members={localData.members} notifications={localData.notifications} workspaceId={workspaceId} />
  }
  if (active === 'Help') return <HelpView onNavigate={onNavigate} />
  if (active === 'Legal') return <LegalView />

  if (active === 'Calendar') {
    const visibleCalendarEvents = localData.events.filter(event => calendarFilter === 'all' || event.event_type === calendarFilter)
    const upcomingVisibleEvents = visibleCalendarEvents.filter(event => new Date(event.start_at) >= new Date()).sort((a, b) => new Date(a.start_at) - new Date(b.start_at)).slice(0, 8)
    const agendaStart = new Date(calendarDate)
    agendaStart.setHours(0, 0, 0, 0)
    const agendaEvents = visibleCalendarEvents.filter(event => new Date(event.end_at || event.start_at) >= agendaStart).sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    const timeGridDays = calendarView === 'day' ? [calendarDate] : calendarDays
    const timeGrid = <div className="calendar-time-grid" style={{ '--calendar-day-count': timeGridDays.length }}><div className="calendar-time-corner" />{timeGridDays.map(day => <div className={`calendar-time-day${toDateKey(day) === today ? ' is-today' : ''}`} key={`head-${day.toISOString()}`}>{formatCalendarDate(day, { weekday: 'short', day: 'numeric' })}</div>)}{Array.from({ length: 24 }, (_, hour) => <React.Fragment key={`hour-${hour}`}><div className="calendar-time-label">{formatCalendarDate(new Date(2020, 0, 1, hour), { hour: 'numeric' })}</div>{timeGridDays.map(day => <div className="calendar-time-slot" key={`${day.toISOString()}-${hour}`} onDoubleClick={() => { setCalendarDate(new Date(day)); openComposer('calendar') }}>{visibleCalendarEvents.filter(event => { const start = new Date(event.start_at); return toDateKey(start) === toDateKey(day) && start.getHours() === hour }).map(event => <button type="button" className={`event-pill event-type-${event.event_type || 'meeting'}`} key={event.id} onClick={() => setSelectedEvent(event)}><span>{formatCalendarDate(new Date(event.start_at), { hour: 'numeric', minute: '2-digit' })}</span>{event.title}</button>)}</div>)}</React.Fragment>)}</div>
    return <section className="workspace-view">
      <WorkspaceViewHeading title={title} subtitle="Plan meetings, focus time, deadlines, and reminders in one place." action="Add event" onAction={() => openComposer('calendar')} />
      <div className="calendar-layout">
        <Card className={`calendar-week calendar-view-${calendarView} gap-0 py-0 overflow-hidden`}>
          <CardHeader className="calendar-toolbar items-center flex-wrap gap-3 px-5 py-4 border-b border-border">
            <div className="calendar-toolbar-title flex items-center gap-2">
              <Button type="button" variant="outline" size="icon" onClick={() => shiftCalendar(-1)} aria-label="Previous period"><ChevronLeft size={16} /></Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" className="px-2.5 text-sm font-extrabold text-foreground hover:bg-muted">{calendarHeading}</Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <DatePicker mode="single" selected={calendarDate} defaultMonth={calendarDate} onSelect={date => date && setCalendarDate(date)} />
                </PopoverContent>
              </Popover>
              <Button type="button" variant="outline" size="icon" onClick={() => shiftCalendar(1)} aria-label="Next period"><ChevronRight size={16} /></Button>
            </div>
            <div className="calendar-toolbar-actions flex items-center gap-2 flex-wrap">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCalendarDate(new Date())}>Today</Button>
              <Tabs value={calendarView} onValueChange={setCalendarView}>
                <TabsList aria-label="Calendar view">
                  {['day', 'week', 'month', 'year', 'agenda'].map(view => <TabsTrigger key={view} value={view}>{view[0].toUpperCase() + view.slice(1)}</TabsTrigger>)}
                </TabsList>
              </Tabs>
            </div>
            <div className="calendar-filter-row"><label>Show<select value={calendarFilter} onChange={event => setCalendarFilter(event.target.value)} aria-label="Filter calendar events"><option value="all">All events</option><option value="meeting">Meetings</option><option value="focus">Focus time</option><option value="deadline">Deadlines</option><option value="reminder">Reminders</option></select></label>{calendarFilter !== 'all' && <Button type="button" variant="ghost" size="sm" onClick={() => setCalendarFilter('all')}>Clear filter</Button>}</div>
          </CardHeader>
          <CardContent className={calendarView === 'agenda' ? 'calendar-agenda px-5' : (calendarView === 'day' || calendarView === 'week' ? 'calendar-time-content px-0' : 'calendar-grid px-0')}>
            {calendarView === 'agenda' ? (agendaEvents.length ? agendaEvents.map(event => <button type="button" className={`agenda-event-row event-type-${event.event_type || 'meeting'}`} key={event.id} onClick={() => setSelectedEvent(event)}><time><strong>{formatCalendarDate(new Date(event.start_at), { weekday: 'short', month: 'short', day: 'numeric' })}</strong><span>{formatCalendarDate(new Date(event.start_at), { hour: 'numeric', minute: '2-digit' })}</span></time><div><strong>{event.title}</strong><span>{event.event_type || 'Event'} · {formatCalendarDate(new Date(event.end_at || event.start_at), { hour: 'numeric', minute: '2-digit' })}</span></div><ArrowUpRight size={15} /></button>) : <EmptyState text="No upcoming events match this filter." />) : (calendarView === 'day' || calendarView === 'week' ? timeGrid : calendarDays.map(day => <div className={`calendar-day${toDateKey(day) === today ? ' is-today' : ''}`} key={day.toISOString()}>
              <strong>{calendarView === 'year' ? formatCalendarDate(day, { month: 'short' }) : formatCalendarDate(day, { weekday: 'short', day: 'numeric' })}{toDateKey(day) === today && <Badge variant="accent" className="today-badge">Today</Badge>}</strong>
              <div className="calendar-slot">{calendarEventsForDay(day).filter(event => calendarFilter === 'all' || event.event_type === calendarFilter).map(event => <button type="button" className={`event-pill event-type-${event.event_type || 'meeting'}`} key={event.id} onClick={() => setSelectedEvent(event)} aria-label={`View ${event.title}`}><span>{formatCalendarDate(new Date(event.start_at), calendarView === 'year' ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' })}</span>{event.title}</button>)}</div>
            </div>))}
          </CardContent>
        </Card>
        <Card className="workspace-side-card py-5 gap-4">
          <div className="calendar-side-heading"><h3>Upcoming</h3><a className="calendar-export" href={`/api/workspaces/${workspaceId}/calendar.ics`} download>Export ICS</a></div>
          {upcomingVisibleEvents.length ? upcomingVisibleEvents.map(event => <div className={`compact-row event-type-row-${event.event_type || 'meeting'}`} key={event.id}><CalendarDays size={15} /><div><strong>{event.title}</strong><span>{formatCalendarDate(new Date(event.start_at), { dateStyle: 'medium', timeStyle: 'short' })} · {event.event_type || 'event'}</span><a className="calendar-google-link" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">Add to Google Calendar</a></div><button type="button" className="inline-edit" onClick={() => setSelectedEvent(event)} aria-label={`View ${event.title}`}>View</button>{(canManageMembers || event.created_by === currentUserId) && <button type="button" className="inline-delete" onClick={() => deleteCalendarEvent(event.id)} aria-label={`Delete ${event.title}`}><X size={14} /></button>}</div>) : <EmptyState text="No upcoming events match this filter." />}
        </Card>
      </div>
      {composerOpen && <WorkspaceComposer type="calendar" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}
      {selectedEvent && <CalendarEventEditDialog event={selectedEvent} workspaceId={workspaceId} canEdit={canManageMembers || selectedEvent.created_by === currentUserId} onClose={() => setSelectedEvent(null)} onUpdated={updatedEvent => { setLocalData(current => ({ ...current, events: current.events.map(item => item.id === updatedEvent.id ? updatedEvent : item) })); onRefresh(); setSelectedEvent(null) }} />}
    </section>
  }

  if (active === 'Check-ins') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Start check-in" onAction={() => openComposer('checkin')} /><div className="checkin-toolbar"><DateField label="View date" value={checkInDate} onChange={event => setCheckInDate(event.target.value)} /><span>{checkInDate === today ? 'Today' : 'Updates for ' + checkInDate}</span></div>{checkInLoading && <p className="workspace-inline-status" role="status">Loading check-ins...</p>}{checkInError && <p className="auth-error" role="alert">{checkInError}</p>}<div className="checkin-grid">{localData.checkIns.length ? localData.checkIns.map(checkIn => <Card className="px-5" key={checkIn.id}><div className="card-person"><span className="avatar blue small">{checkIn.user_initials}</span><div><strong>{checkIn.user_name}</strong><span>{checkIn.date}</span></div>{checkIn.user_id === currentUserId && <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" onClick={() => setSelectedCheckIn(checkIn)} aria-label={`Edit ${checkIn.user_name}'s check-in`}><MoreHorizontal size={14} /></Button>}</div><p><b>Completed</b> {checkIn.completed || 'No update yet'}</p><p><b>Next</b> {checkIn.next_steps || 'No next step recorded'}</p><p><b>Blockers</b> {checkIn.blockers || 'None reported'}</p></Card>) : <EmptyState text={`No check-ins for ${checkInDate === today ? 'today' : checkInDate}. Start the first update.`} />}</div>{composerOpen && <WorkspaceComposer type="checkin" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}{selectedCheckIn && <CheckInEditDialog checkIn={selectedCheckIn} workspaceId={workspaceId} onClose={() => setSelectedCheckIn(null)} onUpdated={updatedCheckIn => { setLocalData(current => ({ ...current, checkIns: current.checkIns.map(item => item.id === updatedCheckIn.id ? updatedCheckIn : item) })); onRefresh(); setSelectedCheckIn(null) }} />}</section>
  }

  if (active === 'Projects') {
    const withStats = localData.projects.map(project => {
      const projectTasks = tasks.filter(task => String(task.project_id || '') === String(project.id))
      const completed = projectTasks.filter(task => task.status === 'done').length
      const blocked = projectTasks.filter(task => task.status === 'blocked').length
      const overdue = projectTasks.filter(task => task.status !== 'done' && task.due_date && task.due_date < today).length
      const completion = projectTasks.length ? Math.round((completed / projectTasks.length) * 100) : 0
      const dueSoon = project.due_date && project.due_date >= today && project.due_date <= toDateKey(new Date(Date.now() + 7 * 86400000))
      const health = project.status === 'completed' ? 'completed' : (project.due_date && project.due_date < today) || overdue ? 'off-track' : blocked || dueSoon ? 'at-risk' : 'on-track'
      return { ...project, taskCount: projectTasks.length, completed, blocked, overdue, completion, health }
    })
    const visibleProjects = withStats.filter(project => (!projectQuery.trim() || `${project.name} ${project.description}`.toLowerCase().includes(projectQuery.trim().toLowerCase())) && (projectStatusFilter === 'all' || project.status === projectStatusFilter) && (projectHealthFilter === 'all' || project.health === projectHealthFilter)).sort((a, b) => projectSort === 'name' ? a.name.localeCompare(b.name) : projectSort === 'progress' ? b.completion - a.completion : projectSort === 'updated' ? new Date(b.updated_at || 0) - new Date(a.updated_at || 0) : (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31'))
    const summary = { active: withStats.filter(project => project.status === 'active').length, risk: withStats.filter(project => ['at-risk', 'off-track'].includes(project.health)).length, overdue: withStats.filter(project => project.status !== 'completed' && project.due_date && project.due_date < today).length, completed: withStats.filter(project => project.status === 'completed').length }
    if (selectedProjectWorkspace) return <section className="workspace-view project-detail-view"><button type="button" className="text-button project-back-button" onClick={() => setSelectedProjectWorkspace(null)}>← Back to projects</button><WorkspaceViewHeading title={selectedProjectWorkspace.name} subtitle={selectedProjectWorkspace.description || 'Project workspace and delivery controls.'} action={canManageMembers ? 'Edit project' : undefined} onAction={() => setSelectedProject(selectedProjectWorkspace)} /><div className="project-detail-links"><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('planner:project', { detail: String(selectedProjectWorkspace.id) })); onNavigate('Planner') }}><strong>Planner</strong><span>Open tasks for this project</span></button><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('project-register:tab', { detail: 'risk' })); document.getElementById('project-risk-register')?.scrollIntoView({ behavior: 'smooth' }) }}><strong>Risk register</strong><span>Track threats and mitigations</span></button><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent('project-register:tab', { detail: 'issue' })); document.getElementById('project-risk-register')?.scrollIntoView({ behavior: 'smooth' }) }}><strong>Issue log</strong><span>Track problems to resolution</span></button></div><div id="project-risk-register"><ProjectRiskIssuePanel projects={[selectedProjectWorkspace]} workspaceId={workspaceId} /></div>{selectedProject && <ProjectEditDrawer project={selectedProject} workspaceId={workspaceId} onClose={() => setSelectedProject(null)} onUpdated={updatedProject => { setSelectedProjectWorkspace(updatedProject); setLocalData(current => ({ ...current, projects: current.projects.map(item => item.id === updatedProject.id ? updatedProject : item) })); onRefresh(); setSelectedProject(null) }} />}</section>
    return <section className="workspace-view projects-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action={canManageMembers ? 'New project' : undefined} onAction={() => openComposer('project')} />
      <div className="project-summary"><div><strong>{summary.active}</strong><span>Active</span></div><div className="is-warning"><strong>{summary.risk}</strong><span>At risk</span></div><div className="is-danger"><strong>{summary.overdue}</strong><span>Overdue</span></div><div><strong>{summary.completed}</strong><span>Completed</span></div></div>
      <div className="project-toolbar"><label className="project-search"><Search size={15} /><input value={projectQuery} onChange={event => setProjectQuery(event.target.value)} placeholder="Search projects" aria-label="Search projects" /></label><select value={projectStatusFilter} onChange={event => setProjectStatusFilter(event.target.value)} aria-label="Filter projects by status"><option value="all">All statuses</option><option value="planning">Planning</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select><select value={projectHealthFilter} onChange={event => setProjectHealthFilter(event.target.value)} aria-label="Filter projects by health"><option value="all">All health</option><option value="on-track">On track</option><option value="at-risk">At risk</option><option value="off-track">Off track</option><option value="completed">Completed</option></select><select value={projectSort} onChange={event => setProjectSort(event.target.value)} aria-label="Sort projects"><option value="due">Due date</option><option value="progress">Progress</option><option value="updated">Recently updated</option><option value="name">Name</option></select><span>{visibleProjects.length} of {withStats.length} projects</span></div>
      <div className="project-grid">{visibleProjects.length ? visibleProjects.map(project => <Card className={`project-card project-health-${project.health} px-5`} key={project.id}><div className="project-card-top"><span className="project-icon"><Target size={17} /></span><span className={`project-health ${project.health}`}>{project.health.replace('-', ' ')}</span><select className={`project-status ${project.status}`} value={project.status} onChange={event => updateProjectStatus(project, event.target.value)} disabled={!canManageMembers} aria-label={`Change status for ${project.name}`}><option value="planning">Planning</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select>{canManageMembers && <><Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelectedProject(project)} aria-label={`Edit ${project.name}`}><MoreHorizontal size={14} /></Button><Button type="button" variant="ghost" size="icon-sm" onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`}><X size={14} /></Button></>}</div><h3>{project.name}</h3><p>{project.description || 'No project description yet.'}</p><ProjectProgress project={project} tasks={tasks} /><div className="project-task-stats"><span>{project.taskCount - project.completed} open</span><span className={project.blocked ? 'risk' : ''}>{project.blocked} blocked</span><span className={project.overdue ? 'danger' : ''}>{project.overdue} overdue</span></div><div className="project-footer"><div><span>{project.due_date ? `Due ${project.due_date}` : 'No due date'}</span>{project.updated_at && <small>Updated {formatRelativeActivityTime(project.updated_at)}</small>}</div><button type="button" className="project-task-link" onClick={() => { onSearchChange(project.name); onNavigate('Planner') }} aria-label={`View tasks for ${project.name}`}>View tasks <ArrowUpRight size={15} /></button></div></Card>) : <EmptyState text={localData.projects.length ? 'No projects match these filters.' : 'No projects have been created yet.'} />}</div><ProjectRiskIssuePanel projects={localData.projects} workspaceId={workspaceId} />{composerOpen && <WorkspaceComposer type="project" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}{selectedProject && <ProjectEditDrawer project={selectedProject} workspaceId={workspaceId} onClose={() => setSelectedProject(null)} onUpdated={updatedProject => { setLocalData(current => ({ ...current, projects: current.projects.map(item => item.id === updatedProject.id ? updatedProject : item) })); onRefresh(); setSelectedProject(null) }} />}</section>
  }

  if (active === 'Channels' || active === 'Chats') {
    return <ChatWorkspaceView viewType={active === 'Channels' ? 'channels' : 'direct'} data={localData} workspaceId={workspaceId} currentUserId={currentUserId} onRefresh={onRefresh} onError={onActionError} onConfirm={onConfirm} />
  }

  if (active === 'Follow-up') {
    const isOverdueFollowUp = followUp => followUp.status === 'open' && followUp.due_date && followUp.due_date < today
    const visibleFollowUps = localData.followUps.filter(followUp => followUpFilter === 'all' || followUp.status === followUpFilter || (followUpFilter === 'overdue' && isOverdueFollowUp(followUp)))
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add follow-up" onAction={() => openComposer('followup')} /><div className="follow-up-toolbar"><label>Filter follow-ups<select value={followUpFilter} onChange={event => setFollowUpFilter(event.target.value)} aria-label="Filter follow-ups"><option value="all">All follow-ups</option><option value="open">Open</option><option value="completed">Completed</option><option value="overdue">Overdue</option></select></label><span>{visibleFollowUps.length} shown</span></div><Card className="follow-up-list px-5">{visibleFollowUps.length ? visibleFollowUps.map(followUp => { const linkedTask = tasks.find(task => task.id === followUp.task_id); const canEdit = canManageMembers || followUp.created_by === currentUserId || followUp.assigned_to === currentUserId; return <div className="follow-up-row" key={followUp.id}><span className={`follow-up-status ${followUp.status} ${isOverdueFollowUp(followUp) ? 'overdue' : ''}`} /> <div><strong>{followUp.note}</strong><span>{followUp.due_date ? `Due ${followUp.due_date}` : 'No due date'}{linkedTask ? ` | ${linkedTask.title}` : ''}{followUp.assigned_to_name ? ` | ${followUp.assigned_to_name}` : ''}</span></div><div className="follow-up-actions">{canEdit && <Button type="button" variant="outline" size="sm" onClick={() => setSelectedFollowUp(followUp)}>Edit</Button>}<Button type="button" variant="outline" size="sm" onClick={() => completeFollowUp(followUp)}>{followUp.status === 'completed' ? 'Reopen' : 'Mark done'}</Button>{(canManageMembers || followUp.created_by === currentUserId) && <Button type="button" variant="ghost" size="icon-sm" onClick={() => deleteFollowUp(followUp)} aria-label={`Delete ${followUp.note}`}><X size={14} /></Button>}</div></div> }) : <EmptyState text="Nothing needs follow-up right now." />}</Card>{composerOpen && <WorkspaceComposer type="followup" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} members={localData.members} tasks={tasks} />}{selectedFollowUp && <FollowUpEditDialog followUp={selectedFollowUp} members={localData.members} tasks={tasks} workspaceId={workspaceId} canManageMembers={canManageMembers} currentUserId={currentUserId} onClose={() => setSelectedFollowUp(null)} onUpdated={updatedFollowUp => { setLocalData(current => ({ ...current, followUps: current.followUps.map(item => item.id === updatedFollowUp.id ? updatedFollowUp : item) })); onRefresh(); setSelectedFollowUp(null) }} />}</section>
  }

  if (active === 'Team board') {
    return <TeamBoardView tasks={tasks} members={localData.members} projects={localData.projects} scope={teamBoardScope} onScopeChange={setTeamBoardScope} invitations={localData.invitations} canManageMembers={canManageMembers} onInvite={() => openComposer('invite')} onComplete={onComplete} onStatusChange={onStatusChange} onOpenTask={onOpenTask} onUpdateMemberRole={updateMemberRole} onRemoveMember={removeMember} onCancelInvitation={cancelInvitation} />
  }

  if (active === 'My tasks') {
    return <MyTasksView tasks={tasks} currentUserId={currentUserId} currentUserName={currentUserName} projects={localData.projects} buckets={localData.buckets} onAddTask={onAddTask} onOpenTask={onOpenTask} onComplete={onComplete} onStatusChange={onStatusChange} onDelete={onDelete} canManageTasks={canManageTasks} />
  }

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredTasks = tasks
    .filter(task => active !== 'My tasks' || String(task.assignee_id || '') === String(currentUserId))
    .filter(task => !normalizedSearch || taskSearchText(task).includes(normalizedSearch))
  return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add task" onAction={onAddTask} /><Card className="task-list-view px-5">{active === 'Team board' && <div className="member-summary"><Users size={18} /><strong>{localData.members.length || 0} members</strong><span>across this workspace</span></div>}{filteredTasks.length ? filteredTasks.map(task => <TaskCard key={task.id} task={task} onComplete={onComplete} onStatusChange={onStatusChange} onDelete={onDelete} onOpenTask={onOpenTask} canDelete={canManageTasks} />) : <EmptyState text="No tasks match this view yet." />}</Card></section>
}

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
          <tbody>{visibleItems.length ? visibleItems.map(item => <tr key={item.id}>
            <td><strong>{item.title}</strong><span>{item.detail || 'No description added.'}</span></td>
            <td><span className={`record-severity ${item.severity}`}>{item.severity}</span></td>
            <td>{item.owner || <span className="table-muted">Unassigned</span>}</td>
            <td>{item.due || <span className="table-muted">No date</span>}</td>
            <td><select value={item.status} onChange={event => updateStatus(item.id, event.target.value)} aria-label={`Set status for ${item.title}`}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
            <td><button type="button" className="inline-delete" onClick={() => remove(item.id)} aria-label={`Delete ${item.title}`}><X size={14} /></button></td>
          </tr>) : <tr><td className="project-register-empty" colSpan="6"><Brush size={22} /><strong>No {activeTab === 'risk' ? 'risks' : 'issues'} yet</strong><span>{activeTab === 'risk' ? 'Add a risk to begin tracking possible threats.' : 'Add an issue to track an active project problem.'}</span></td></tr>}</tbody>
        </table>
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

function TodayDashboard({ today, todayLabel, currentUserName, workspaceName, tasks, events, followUps, checkIns, members, canManageMembers, onAddTask, onOpenTask, onNavigate, onComplete, onStatusChange }) {
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
      <aside className="today-side-stack"><div className="today-panel"><div className="today-panel-heading"><div><h2>Schedule</h2><p>Events and deadlines today</p></div><Button variant="ghost" size="icon-sm" onClick={() => onNavigate('Calendar')} aria-label="Open calendar"><ArrowUpRight size={15} /></Button></div>{todaysEvents.length ? todaysEvents.map(event => <div className="today-event-row" key={event.id}><time>{new Date(event.start_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><div><strong>{event.title}</strong><span>{event.event_type || 'Event'}</span></div></div>) : <p className="today-muted">No events scheduled today.</p>}</div><div className="today-panel"><div className="today-panel-heading"><div><h2>Follow-ups</h2><p>Items needing a response</p></div><Button variant="ghost" size="icon-sm" onClick={() => onNavigate('Follow-up')} aria-label="Open follow-ups"><ArrowUpRight size={15} /></Button></div>{dueFollowUps.length ? dueFollowUps.map(item => <button className="today-followup-row" key={item.id} onClick={() => onNavigate('Follow-up')}><span className="priority-dot" /><span>{item.note}</span><small>{item.due_date || 'No due date'}</small></button>) : <p className="today-muted">No follow-ups due.</p>}</div></aside>
    </div><div className="today-lower-grid"><div className="today-panel"><div className="today-panel-heading"><div><h2>Team attention</h2><p>{canManageMembers ? 'Exceptions worth acting on' : 'Work that may need help'}</p></div><Button variant="ghost" size="sm" onClick={() => onNavigate('Team board')}>Open board <ArrowUpRight size={14} /></Button></div>{openExceptions.length ? <div className="today-exception-list">{openExceptions.map(task => <button key={task.id} onClick={() => onOpenTask(task)}><span className={`status-dot ${task.status}`} /><span>{task.title}</span><small>{task.status === 'blocked' ? 'Blocked' : !task.assignee_id ? 'Unassigned' : 'Overdue'}</small></button>)}</div> : <p className="today-muted">No team exceptions right now.</p>}</div><div className="today-panel today-checkin-panel"><div className="today-panel-heading"><div><h2>Check-ins</h2><p>Keep the team aligned</p></div><Hash size={17} /></div><strong className="today-checkin-count">{checkInsToday} of {members.length || 1}</strong><span className="today-muted">check-ins received today</span><Button variant="outline" size="sm" onClick={() => onNavigate('Check-ins')}>{checkInsToday ? 'View check-ins' : 'Start check-in'}</Button></div></div>
  </section>
}

function WorkspaceViewHeading({ title, subtitle, action, onAction }) {
  return <div className="workspace-view-heading"><div><p className="eyebrow">Workspace operations</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{action && <Button onClick={onAction}><Plus size={17} /> {action}</Button>}</div>
}

function SelectField({ label, name, value, onChange, options }) {
  return <label>{label}<Select value={String(value)} onValueChange={selected => onChange({ target: { name, value: selected } })}>
    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
    <SelectContent>{options.map(([optionValue, optionLabel]) => <SelectItem key={optionValue} value={optionValue}>{optionLabel}</SelectItem>)}</SelectContent>
  </Select></label>
}

function DateTimeField({ label, name, value, onChange, required }) {
  const [datePart, timePart] = value ? value.split('T') : ['', '']
  const dateObj = datePart ? new Date(`${datePart}T00:00:00`) : undefined
  const commit = (nextDate, nextTime) => onChange({ target: { name, value: `${nextDate ?? datePart ?? toDateKey(new Date())}T${nextTime ?? timePart ?? '09:00'}` } })
  return <label>{label}<div className="datetime-field">
    <Popover>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="datetime-trigger w-full justify-start rounded-lg font-medium"><CalendarDays size={14} />{dateObj ? formatCalendarDate(dateObj, { dateStyle: 'medium' }) : 'Select date'}</Button></PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start"><DatePicker mode="single" selected={dateObj} defaultMonth={dateObj} onSelect={picked => picked && commit(toDateKey(picked), null)} /></PopoverContent>
    </Popover>
    <input className="datetime-time" type="time" value={timePart || ''} onChange={change => commit(null, change.target.value)} required={required} />
  </div></label>
}

// Date-only equivalent of DateTimeField - same Popover + Calendar trigger, used
// wherever the app previously rendered a plain <input type="date"> (which shows
// the browser's own native calendar chrome instead of the app's styling).
function DateField({ label, name, value, onChange, required, disabled, placeholder = 'Select date' }) {
  const dateObj = value ? new Date(`${value}T00:00:00`) : undefined
  const commit = picked => onChange({ target: { name, value: picked } })
  return <label>{label}<Popover>
    <PopoverTrigger asChild><Button type="button" variant="outline" disabled={disabled} className="date-field-trigger w-full justify-start rounded-lg font-medium"><CalendarDays size={14} />{dateObj ? formatCalendarDate(dateObj, { dateStyle: 'medium' }) : placeholder}</Button></PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start"><DatePicker mode="single" selected={dateObj} defaultMonth={dateObj} onSelect={picked => picked && commit(toDateKey(picked))} /></PopoverContent>
  </Popover>
  {required && <input type="text" className="date-field-required-shadow" value={value || ''} required onChange={() => {}} tabIndex={-1} aria-hidden="true" />}
  </label>
}

function ChatWorkspaceView({ viewType, data, workspaceId, currentUserId, onRefresh, onError, onConfirm }) {
  const mode = viewType
  const [selectedChannel, setSelectedChannel] = useState('general')
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [directMessages, setDirectMessages] = useState([])
  const [directLoading, setDirectLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [directDialogOpen, setDirectDialogOpen] = useState(false)
  const [channelForm, setChannelForm] = useState({ name: '', description: '', is_private: false, member_ids: [] })
  const [directMemberIds, setDirectMemberIds] = useState([])
  const feedEndRef = useRef(null)
  const channels = data.channels || []
  const conversations = data.directConversations || []
  const selectedChannelInfo = channels.find(channel => channel.name === selectedChannel)
  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId)

  useEffect(() => {
    setSearch('')
    setDraft('')
    setReplyTo(null)
    setError('')
  }, [viewType])

  useEffect(() => {
    if (!selectedConversationId) return undefined
    let current = true
    setDirectLoading(true)
    setError('')
    fetch(`/api/direct-conversations/${selectedConversationId}/messages/`, { credentials: 'include' })
      .then(response => response.json().then(payload => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || 'Direct messages could not be loaded.')
        if (current) setDirectMessages(payload.messages)
      })
      .catch(loadError => { if (current) setError(loadError.message) })
      .finally(() => { if (current) setDirectLoading(false) })
    return () => { current = false }
  }, [selectedConversationId, data.directConversations])

  const visibleChannelMessages = data.messages.filter(message => message.channel === selectedChannel && (!search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase())))
  const visibleDirectMessages = directMessages.filter(message => !search.trim() || `${message.author_name} ${message.message}`.toLowerCase().includes(search.trim().toLowerCase()))
  const groupedMessages = visibleChannelMessages.reduce((groups, message) => {
    const key = toDateKey(message.created_at)
    ;(groups[key] ||= []).push(message)
    return groups
  }, {})

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [visibleChannelMessages.length, visibleDirectMessages.length, mode])

  const submitChannelMessage = async event => {
    event.preventDefault()
    const messageText = draft.trim()
    if (!messageText || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/chat-messages/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ channel: selectedChannel, message: messageText, parent_id: replyTo?.id || null }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be sent.')
      setDraft('')
      setReplyTo(null)
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const submitDirectMessage = async event => {
    event.preventDefault()
    const messageText = draft.trim()
    if (!selectedConversation || !messageText || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/direct-conversations/${selectedConversation.id}/messages/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ message: messageText }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Message could not be sent.')
      setDirectMessages(current => [...current, payload.message])
      setDraft('')
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const createChannel = async event => {
    event.preventDefault()
    if (!channelForm.name.trim() || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/chat-channels/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify(channelForm),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Channel could not be created.')
      setSelectedChannel(payload.channel.name)
      setChannelForm({ name: '', description: '', is_private: false, member_ids: [] })
      setChannelDialogOpen(false)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: `#${payload.channel.name} created.` }))
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const createDirectConversation = async event => {
    event.preventDefault()
    if (!directMemberIds.length || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/direct-conversations/`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) },
        body: JSON.stringify({ participant_ids: directMemberIds }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Conversation could not be created.')
      setSelectedConversationId(payload.conversation.id)
      setDirectMemberIds([])
      setDirectDialogOpen(false)
      onRefresh()
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const deleteChannel = async channel => {
    if (!(await onConfirm(`Delete #${channel.name} and all of its messages?`, { title: 'Delete channel', confirmLabel: 'Delete channel' }))) return
    try {
      const response = await fetch(`/api/chat-channels/${channel.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Channel could not be deleted.')
      setSelectedChannel('general')
      onRefresh()
    } catch (deleteError) {
      onError(deleteError.message)
    }
  }

  const memberName = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const toggleMember = (id, selectedIds, updateSelectedIds) => updateSelectedIds(selectedIds.includes(id) ? selectedIds.filter(value => value !== id) : [...selectedIds, id])
  const renderMessage = message => <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''}`} key={message.id}>
    <span className="avatar blue small">{message.author_name.slice(0, 2).toUpperCase()}</span>
    <div className="chat-message-body"><div className="chat-message-meta"><strong>{message.author_name}</strong><span>{formatRelativeActivityTime(message.created_at)}</span></div><p>{message.message}</p>{mode === 'channels' && !message.parent_id && <button type="button" className="chat-reply-button" onClick={() => { setReplyTo(message); setDraft('') }}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>}</div>
  </div>

  return <section className="workspace-view chat-workspace-view">
    <WorkspaceViewHeading title={mode === 'channels' ? 'Channels' : 'Chats'} subtitle={mode === 'channels' ? 'Shared rooms for workspace topics, teams, and projects.' : 'Private one-to-one and group conversations.'} />
    <div className="chat-toolbar"><label className="chat-search"><Search size={15} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={mode === 'channels' ? `Search #${selectedChannel}` : 'Search this chat'} aria-label="Search messages" /></label><button type="button" className="primary-button chat-create-button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }}><Plus size={15} /> {mode === 'channels' ? 'Create channel' : 'New chat'}</button></div>
    <div className="chat-layout">
      <Card className="chat-feed">
        <div className="chat-feed-heading"><div>{mode === 'channels' ? <><h2><Hash size={17} /> {selectedChannel}</h2><p>{selectedChannelInfo?.description || 'Team conversation'}</p></> : selectedConversation ? <><h2>{selectedConversation.is_group && <Users size={17} />}{selectedConversation.title}</h2><p>{selectedConversation.is_group ? `Group chat · ${selectedConversation.participants.length} people` : 'Direct chat · only you two'}</p></> : <><h2>Chats</h2><p>Select a person or start a group chat</p></>}</div></div>
        <div className="chat-message-scroll">{mode === 'channels' ? (visibleChannelMessages.length ? Object.entries(groupedMessages).map(([date, messages]) => <div className="chat-day" key={date}><h3>{date === toDateKey(new Date()) ? 'Today' : date === toDateKey(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>{messages.map(renderMessage)}</div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>{search ? 'No matching messages' : `No messages in #${selectedChannel}`}</h2><p>{search ? 'Try a different search term.' : 'Start the conversation below.'}</p></div>) : selectedConversation ? (directLoading ? <div className="chat-placeholder"><p>Loading messages…</p></div> : visibleDirectMessages.length ? visibleDirectMessages.map(renderMessage) : <div className="chat-placeholder"><h2>{search ? 'No matching messages' : 'No messages yet'}</h2><p>Send the first private message below.</p></div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><Users size={22} /></div><h2>Start a private conversation</h2><p>Choose an existing conversation or create a new one.</p></div>}<div ref={feedEndRef} /></div>
        {(mode === 'channels' || selectedConversation) && <form className="chat-inline-composer" onSubmit={mode === 'channels' ? submitChannelMessage : submitDirectMessage}>{replyTo && mode === 'channels' && <div className="reply-context"><span>Replying to <strong>{replyTo.author_name}</strong>: {replyTo.message.slice(0, 100)}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={14} /></button></div>}<div><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit() } }} placeholder={mode === 'channels' ? `Message #${selectedChannel}` : `Message ${selectedConversation?.title}`} maxLength="4000" aria-label="Message" /><button type="submit" className="primary-button" disabled={submitting || !draft.trim()}>{submitting ? 'Sending…' : 'Send'}</button></div>{error && <p className="auth-error" role="alert">{error}</p>}</form>}
      </Card>
      <Card className="workspace-side-card chat-conversation-list"><div className="chat-list-heading"><h3>{mode === 'channels' ? 'Channels' : 'Chats'}</h3><button type="button" onClick={() => { setError(''); mode === 'channels' ? setChannelDialogOpen(true) : setDirectDialogOpen(true) }} aria-label={mode === 'channels' ? 'Create channel' : 'New chat'}><Plus size={15} /></button></div>{mode === 'channels' ? channels.map(channel => { const unread = data.notifications.filter(notification => notification.target_type === 'chat_channel' && notification.target_id === channel.name && !notification.read).length; return <div className="channel-row-wrap" key={channel.id}><button type="button" className={`channel-row ${selectedChannel === channel.name ? 'active' : ''}`} onClick={() => { setSelectedChannel(channel.name); setSearch(''); setReplyTo(null) }}>{channel.is_private ? <span className="channel-private-mark">•</span> : <Hash size={15} />}<span className="channel-name">{channel.name}</span>{unread > 0 && <Badge>{unread}</Badge>}</button>{channel.name !== 'general' && channel.created_by === currentUserId && <button type="button" className="channel-delete" onClick={() => deleteChannel(channel)} aria-label={`Delete ${channel.name}`}><X size={13} /></button>}</div> }) : conversations.length ? conversations.map(conversation => { const unread = data.notifications.filter(notification => notification.target_type === 'direct_conversation' && notification.target_id === String(conversation.id) && !notification.read).length; return <button type="button" className={`direct-row ${selectedConversationId === conversation.id ? 'active' : ''}`} key={conversation.id} onClick={() => { setSelectedConversationId(conversation.id); setSearch('') }}><span className={`avatar blue small ${conversation.is_group ? 'group-chat-avatar' : ''}`}>{conversation.is_group ? <Users size={14} /> : conversation.title.slice(0, 2).toUpperCase()}</span><span><strong>{conversation.title}</strong><small>{conversation.is_group ? `Group · ${conversation.participants.length} people` : conversation.last_message || 'Direct chat'}</small></span>{unread > 0 && <Badge>{unread}</Badge>}</button> }) : <p className="chat-sidebar-empty">No chats yet.</p>}</Card>
    </div>
    {channelDialogOpen && <div className="modal-backdrop" onMouseDown={() => setChannelDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-channel-title" onSubmit={createChannel} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Channels</p><h2 id="create-channel-title">Create a channel</h2></div><button type="button" className="close-button" onClick={() => setChannelDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><label>Channel name<input autoFocus value={channelForm.name} onChange={event => setChannelForm(current => ({ ...current, name: event.target.value }))} placeholder="e.g. product-launch" maxLength="80" required /></label><label>Description<textarea value={channelForm.description} onChange={event => setChannelForm(current => ({ ...current, description: event.target.value }))} placeholder="What is this channel for?" maxLength="240" /></label><label className="chat-privacy-toggle"><input type="checkbox" checked={channelForm.is_private} onChange={event => setChannelForm(current => ({ ...current, is_private: event.target.checked, member_ids: [] }))} /> Private channel</label>{channelForm.is_private && <div className="chat-member-picker"><span>Add members</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={channelForm.member_ids.includes(member.id)} onChange={() => toggleMember(member.id, channelForm.member_ids, member_ids => setChannelForm(current => ({ ...current, member_ids })))} /> {memberName(member)}</label>)}</div>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create channel'}</button></form></div>}
    {directDialogOpen && <div className="modal-backdrop" onMouseDown={() => setDirectDialogOpen(false)}><form className="modal chat-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-direct-title" onSubmit={createDirectConversation} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Private chats</p><h2 id="create-direct-title">New chat</h2><p className="modal-subtitle">Choose one person for a direct chat or several people for a group chat.</p></div><button type="button" className="close-button" onClick={() => setDirectDialogOpen(false)} aria-label="Close"><X size={18} /></button></div><div className="chat-member-picker"><span>Choose people</span>{data.members.filter(member => member.id !== currentUserId).map(member => <label key={member.id}><input type="checkbox" checked={directMemberIds.includes(member.id)} onChange={() => toggleMember(member.id, directMemberIds, setDirectMemberIds)} /> {memberName(member)}</label>)}</div>{directMemberIds.length > 0 && <p className="chat-selection-summary">{directMemberIds.length === 1 ? 'Direct chat' : `Group chat with ${directMemberIds.length + 1} people`}</p>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={submitting || !directMemberIds.length}>{submitting ? 'Starting…' : directMemberIds.length > 1 ? 'Start group chat' : 'Start direct chat'}</button></form></div>}
  </section>
}

function WorkspaceComposer({ type, form, setForm, replyTo, error, submitting, onClose, onSubmit, members = [], tasks = [], channels = ['general'] }) {
  const titles = { calendar: 'Add calendar event', project: 'Create project', checkin: 'Daily check-in', chat: 'New team message', followup: 'Add follow-up', invite: 'Invite team member' }
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const field = (name, label, placeholder, inputType = 'text') => {
    if (inputType === 'date') return <DateField label={label} name={name} value={form[name]} onChange={update} required />
    const baseField = <label>{label}<input name={name} type={inputType} value={form[name]} onChange={update} placeholder={placeholder} required /></label>
    if (type !== 'calendar' || name !== 'title') return baseField
    return <>{baseField}<label>Description<textarea name="description" value={form.description} onChange={update} placeholder="What is this event for?" maxLength="4000" /></label><SelectField label="Event type" name="event_type" value={form.event_type} onChange={update} options={[['meeting', 'Meeting'], ['focus', 'Focus time'], ['deadline', 'Deadline'], ['reminder', 'Reminder']]} /></>
  }
    return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title" onSubmit={onSubmit} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace update</p><h2 id="composer-title">{titles[type]}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close workspace update dialog"><X size={18} /></button></div>{type === 'calendar' && <>{field('title', 'Event title', 'Daily planning session')}<DateTimeField label="Starts" name="start_at" value={form.start_at} onChange={update} required /><DateTimeField label="Ends" name="end_at" value={form.end_at} onChange={update} required /><SelectField label="Reminder" name="reminder_minutes" value={form.reminder_minutes} onChange={update} options={[['0', 'At event time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]} /></>}{type === 'project' && <>{field('name', 'Project name', 'Website refresh')}<label>Description<textarea name="description" value={form.description} onChange={update} placeholder="What is this project moving forward?" /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} /></>}{type === 'checkin' && <>{field('date', 'Date', '', 'date')}<label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} maxLength="4000" required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} maxLength="4000" /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} maxLength="4000" /></label></>}{type === 'chat' && <>{replyTo && <p className="reply-context">Replying to {replyTo.author_name}</p>}<label>Channel<input name="channel" list="workspace-chat-channels" value={form.channel} onChange={update} placeholder="team-updates" required /><datalist id="workspace-chat-channels">{channels.map(channel => <option key={channel} value={channel} />)}</datalist></label><label>Message<textarea name="message" value={form.message} onChange={update} placeholder="Share an update with the team" required autoFocus /></label></>}{type === 'followup' && <>{field('note', 'Follow-up note', 'Ask for launch approval')}{field('due_date', 'Due date', '', 'date')}<label>Assign to<select name="assigned_to" value={form.assigned_to || ''} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id || ''} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{type === 'invite' && <><label>Email<input name="email" type="email" value={form.email} onChange={update} placeholder="teammate@company.com" required /></label><label>Role<select name="role" value={form.role} onChange={update}><option value="member">Member</option><option value="manager">Manager</option></select></label></>}{error && <p className="auth-error">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save update'} <ArrowUpRight size={16} /></button></form></div>
}

function CalendarEventEditDialog({ event, workspaceId, canEdit = true, onClose, onUpdated }) {
  const [form, setForm] = useState({ title: event.title, description: event.description || '', start_at: toDateTimeLocal(event.start_at), end_at: toDateTimeLocal(event.end_at), event_type: event.event_type, reminder_minutes: event.reminder_minutes })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = change => setForm(current => ({ ...current, [change.target.name]: change.target.value }))
  const save = async submitEvent => {
    submitEvent.preventDefault()
    if (!canEdit) return
    setError('')
    setSaving(true)
    try {
      const payload = { title: form.title, description: form.description, start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString(), event_type: form.event_type, reminder_minutes: Number(form.reminder_minutes) }
      const response = await fetch(`/api/workspaces/${workspaceId}/calendar-events/${event.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Calendar event could not be saved.')
      onUpdated(data.event)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  if (!canEdit) return <Dialog open onOpenChange={openState => !openState && onClose()}><DialogContent className="modal composer-modal" showCloseButton={false}><DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0"><div><p className="eyebrow">Calendar event</p><DialogTitle>{event.title}</DialogTitle></div><Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close event details"><X size={18} /></Button></DialogHeader><div className="calendar-readonly-details"><p>{event.description || 'No description provided.'}</p><span>{formatCalendarDate(new Date(event.start_at), { dateStyle: 'full', timeStyle: 'short' })}</span><span>Ends {formatCalendarDate(new Date(event.end_at || event.start_at), { dateStyle: 'medium', timeStyle: 'short' })}</span><span className={`event-detail-type event-type-${event.event_type || 'meeting'}`}>{event.event_type || 'Event'}</span><span>Reminder: {event.reminder_minutes ? `${event.reminder_minutes} minutes before` : 'At event time'}</span></div><Button type="button" variant="secondary" onClick={onClose}>Close</Button></DialogContent></Dialog>
  return <Dialog open onOpenChange={openState => !openState && onClose()}>
    <DialogContent className="modal composer-modal" showCloseButton={false}>
      <form onSubmit={save}>
        <DialogHeader className="modal-heading flex-row items-start justify-between gap-3 space-y-0">
          <div><p className="eyebrow">Calendar management</p><DialogTitle>Edit event</DialogTitle></div>
          <Button type="button" variant="ghost" size="icon" className="close-button rounded-full" onClick={onClose} aria-label="Close calendar event editor"><X size={18} /></Button>
        </DialogHeader>
        <label>Event title<input name="title" value={form.title} onChange={update} maxLength="200" required /></label>
        <label>Description<textarea name="description" value={form.description} onChange={update} maxLength="4000" /></label>
        <div className="modal-grid">
          <DateTimeField label="Starts" name="start_at" value={form.start_at} onChange={update} required />
          <DateTimeField label="Ends" name="end_at" value={form.end_at} onChange={update} required />
        </div>
        <SelectField label="Event type" name="event_type" value={form.event_type} onChange={update} options={[['meeting', 'Meeting'], ['focus', 'Focus time'], ['deadline', 'Deadline'], ['reminder', 'Reminder']]} />
        <SelectField label="Reminder" name="reminder_minutes" value={form.reminder_minutes} onChange={update} options={[['0', 'At event time'], ['5', '5 minutes before'], ['15', '15 minutes before'], ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before']]} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <Button className="primary-button modal-submit w-full justify-center" disabled={saving}>{saving ? 'Saving...' : 'Save event'} <ArrowUpRight size={16} /></Button>
      </form>
    </DialogContent>
  </Dialog>
}

function FollowUpEditDialog({ followUp, members, tasks, workspaceId, canManageMembers, currentUserId, onClose, onUpdated }) {
  const isCreator = followUp.created_by === currentUserId
  const canEditAssignment = canManageMembers || isCreator
  const [form, setForm] = useState({ note: followUp.note, due_date: followUp.due_date || '', assigned_to: followUp.assigned_to || '', task_id: followUp.task_id || '', status: followUp.status })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = canEditAssignment ? { note: form.note, due_date: form.due_date || null, assigned_to: form.assigned_to || null, task_id: form.task_id || null, status: form.status } : { status: form.status }
      const response = await fetch(`/api/follow-ups/${followUp.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Follow-up could not be saved.')
      onUpdated(data.follow_up)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="follow-up-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Follow-up management</p><h2 id="follow-up-edit-title">Edit follow-up</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close follow-up editor"><X size={18} /></button></div><label>Follow-up note<textarea name="note" value={form.note} onChange={update} maxLength="500" required disabled={!canEditAssignment} /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} disabled={!canEditAssignment} /><label>Status<select name="status" value={form.status} onChange={update}><option value="open">Open</option><option value="completed">Completed</option></select></label>{canEditAssignment && <><label>Assign to<select name="assigned_to" value={form.assigned_to} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save follow-up'} <ArrowUpRight size={16} /></button></form></div>
}

function CheckInEditDialog({ checkIn, workspaceId, onClose, onUpdated }) {
  const [form, setForm] = useState({ date: checkIn.date, completed: checkIn.completed || '', next_steps: checkIn.next_steps || '', blockers: checkIn.blockers || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-ins/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(workspaceId) }, body: JSON.stringify({ date: form.date, completed: form.completed, next_steps: form.next_steps, blockers: form.blockers }) })
      const data = await readJsonResponse(response, 'Check-in could not be saved.')
      if (!response.ok) throw new Error(data.error || 'Check-in could not be saved.')
      onUpdated(data.check_in)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="checkin-edit-title" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Daily check-in</p><h2 id="checkin-edit-title">Edit check-in</h2><p className="modal-subtitle">Update what you completed, what is next, and any blockers.</p></div><button type="button" className="close-button" onClick={onClose} aria-label="Close check-in editor"><X size={18} /></button></div><DateField label="Date" name="date" value={form.date} onChange={update} /><label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} maxLength="4000" required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} maxLength="4000" /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} maxLength="4000" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save check-in'}</button></form></div>
}

function ProjectEditDrawer({ project, workspaceId, onClose, onUpdated }) {
  const [form, setForm] = useState({ name: project.name, description: project.description || '', due_date: project.due_date || '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const save = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ ...form, due_date: form.due_date || null }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Project could not be saved.')
      onUpdated(data.project)
      onClose()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="project-edit-title" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Project details</p><h2 id="project-edit-title">Edit project</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close project editor"><X size={18} /></button></div><form className="drawer-task-form" onSubmit={save}><label>Name<input name="name" value={form.name} onChange={update} maxLength="160" required /></label><label>Description<textarea name="description" value={form.description} onChange={update} /></label><DateField label="Due date" name="due_date" value={form.due_date} onChange={update} />{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save project'}</button></form></aside></div>
}

function EmptyState({ text }) {
  return <div className="empty-workspace"><div className="empty-workspace-icon" aria-hidden="true"><Brush size={18} /></div><p>{text}</p></div>
}

// Replaces window.confirm() everywhere in the app with a dialog styled like the
// rest of the UI. App owns the single instance; confirmAction() resolves the
// promise once the user picks Cancel or the (destructive, by default) action.
function ConfirmDialog({ state, onClose }) {
  const respond = value => { state?.resolve(value); onClose() }
  return <Dialog open={!!state} onOpenChange={open => { if (!open) respond(false) }}>
    <DialogContent showCloseButton={false} className="confirm-dialog">
      <DialogHeader>
        <DialogTitle>{state?.title || 'Are you sure?'}</DialogTitle>
        <DialogDescription>{state?.message}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => respond(false)}>{state?.cancelLabel || 'Cancel'}</Button>
        <Button type="button" variant="destructive" onClick={() => respond(true)}>{state?.confirmLabel || 'Delete'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function TaskCard({ task, onComplete, onStatusChange, onDelete, onOpenTask, onBucketChange, bucketOptions = [], canDelete = true, canEdit = task.can_edit ?? true, draggable = false }) { return <div className={`task-card ${task.status}`} draggable={draggable} onDragStart={event => event.dataTransfer.setData('text/plain', String(task.id))}><button type="button" className={`task-check ${task.status === 'done' ? 'checked' : ''}`} disabled={!canEdit} onClick={() => onComplete(task.id)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}>{task.status === 'done' && <Check size={12} />}</button><div className="task-copy"><button type="button" className="task-title-button" onClick={() => onOpenTask(task)}>{task.title}</button><div><select disabled={!canEdit} className={`task-status task-status-select ${task.status}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select>{bucketOptions.length > 1 && <select disabled={!canEdit} className="task-bucket-select" value={task.bucket || ''} onChange={event => onBucketChange?.(task.id, event.target.value)} aria-label={`Move ${task.title} to bucket`}>{bucketOptions.map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select>}<span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span>{canDelete && <button type="button" className="task-more-button" onClick={() => onDelete(task.id)} aria-label={`Archive ${task.title}`} title="Archive task"><Archive size={16} /></button>}</div> }

function TaskDetailDrawer({ task, workspaceId, members = [], projects = [], buckets = [], canManageTasks = false, onClose, onDelete, onTaskUpdated }) {
  const canEdit = task.can_edit ?? true
  const [comments, setComments] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [attachments, setAttachments] = useState([])
  const [comment, setComment] = useState('')
  const [subtask, setSubtask] = useState('')
  const [labelInput, setLabelInput] = useState((task.labels || []).join(', '))
  const [taskFields, setTaskFields] = useState({ title: task.title, description: task.description || '', status: task.status === 'in progress' ? 'in_progress' : task.status, priority: task.priority || 'normal', due_date: task.due_date || '', recurrence: task.recurrence || 'none', assignee_id: task.assignee_id || '', project_id: task.project_id || '', bucket: task.bucket || 'Backlog' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const selectedAssignee = members.find(member => String(member.id) === String(taskFields.assignee_id))
  const assigneeLabel = selectedAssignee ? ([selectedAssignee.first_name, selectedAssignee.last_name].filter(Boolean).join(' ') || selectedAssignee.email) : 'Unassigned'
  const projectLabel = projects.find(project => String(project.id) === String(taskFields.project_id))?.name || 'General'
  const dueLabel = taskFields.due_date ? taskDueLabel(taskFields.due_date, new Date().toISOString().slice(0, 10)) : 'No due date'
  const request = async (path, options = {}) => {
    try {
      return await fetch(path, { ...options, credentials: 'include', headers: { ...(options.headers || {}), 'X-Workspace-Id': String(workspaceId) } })
    } catch {
      return new Response(JSON.stringify({ error: 'The task service is unavailable. Try again.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    }
  }
  useEffect(() => {
    Promise.all([request(`/api/tasks/${task.id}/comments/`), request(`/api/tasks/${task.id}/subtasks/`), request(`/api/tasks/${task.id}/attachments/`)]).then(async ([commentResponse, subtaskResponse, attachmentResponse]) => {
      if (!commentResponse.ok || !subtaskResponse.ok || !attachmentResponse.ok) throw new Error('Task details could not be loaded.')
      const [commentData, subtaskData, attachmentData] = await Promise.all([commentResponse.json(), subtaskResponse.json(), attachmentResponse.json()])
      setComments(commentData.comments)
      setSubtasks(subtaskData.subtasks)
      setAttachments(attachmentData.attachments)
    }).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
  }, [task.id, workspaceId])
  const updateTaskField = event => setTaskFields(current => ({ ...current, [event.target.name]: event.target.value }))
  const saveTaskFields = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const leaderFields = ['assignee_id', 'project_id']
      const payload = canManageTasks ? taskFields : Object.fromEntries(Object.entries(taskFields).filter(([field]) => !leaderFields.includes(field)))
      const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(payload) })
      const data = await readJsonResponse(response, 'Task details could not be saved.')
      if (!response.ok) return setError(data.error || 'Task details could not be saved.')
      onTaskUpdated(data.task)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Task saved.' }))
    } catch (saveError) {
      setError(saveError.message || 'Task details could not be saved.')
    } finally {
      setSaving(false)
    }
  }
  const addComment = async event => {
    event.preventDefault()
    if (!comment.trim()) return
    setError('')
    const response = await request(`/api/tasks/${task.id}/comments/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ body: comment.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Comment could not be added.')
    setComments(current => [...current, data.comment])
    setComment('')
  }
  const addSubtask = async event => {
    event.preventDefault()
    if (!subtask.trim()) return
    setError('')
    const response = await request(`/api/tasks/${task.id}/subtasks/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ title: subtask.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be added.')
    setSubtasks(current => [...current, data.subtask])
    setSubtask('')
  }
  const toggleSubtask = async item => {
    setError('')
    const response = await request(`/api/subtasks/${item.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ completed: !item.completed }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be updated.')
    setSubtasks(current => current.map(existing => existing.id === item.id ? data.subtask : existing))
  }
  const deleteSubtask = async item => {
    setError('')
    const response = await request(`/api/subtasks/${item.id}/`, { method: 'DELETE', headers: { 'X-CSRFToken': await getCsrfToken() } })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be deleted.')
    setSubtasks(current => current.filter(existing => existing.id !== item.id))
  }
  const saveLabels = async event => {
    event.preventDefault()
    setError('')
    const labels = [...new Set(labelInput.split(',').map(label => label.trim()).filter(Boolean))]
    const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ labels }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Labels could not be saved.')
    setLabelInput((data.task.labels || []).join(', '))
    onTaskUpdated(data.task)
  }
  const uploadAttachment = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    const formData = new FormData()
    formData.append('file', file)
    const response = await request(`/api/tasks/${task.id}/attachments/`, { method: 'POST', headers: { 'X-CSRFToken': await getCsrfToken() }, body: formData })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Attachment could not be uploaded.')
    setAttachments(current => [data.attachment, ...current])
    event.target.value = ''
  }
  const deleteAttachment = async attachment => {
    setError('')
    const response = await request(`/api/attachments/${attachment.id}/`, { method: 'DELETE', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return setError('Attachment could not be deleted.')
    setAttachments(current => current.filter(item => item.id !== attachment.id))
  }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Task details</p><h2 id="task-detail-title">{taskFields.title || task.title}</h2><span>{assigneeLabel} | {projectLabel} | {dueLabel}</span></div><button type="button" className="close-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button></div>{error && <p className="auth-error">{error}</p>}{loading ? <p className="drawer-muted">Loading task details...</p> : <><section className="drawer-section"><div className="drawer-section-heading"><h3>Task controls</h3><span>Saved to workspace</span></div><form className="drawer-task-form" onSubmit={saveTaskFields}><label>Title<input name="title" value={taskFields.title} onChange={updateTaskField} disabled={!canEdit} maxLength="200" /></label><label>Description<textarea name="description" value={taskFields.description} onChange={updateTaskField} disabled={!canEdit} maxLength="4000" /></label><div className="modal-grid"><label>Assign to<select name="assignee_id" value={taskFields.assignee_id} onChange={updateTaskField} disabled={!canManageTasks}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Project<select name="project_id" value={taskFields.project_id} onChange={updateTaskField} disabled={!canManageTasks}><option value="">General</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div><label>Planner bucket<select name="bucket" value={taskFields.bucket} onChange={updateTaskField} disabled={!canEdit}>{(buckets.length ? buckets : [{ id: 'backlog', name: 'Backlog' }]).map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}</select></label><label>Status<select name="status" value={taskFields.status} onChange={updateTaskField} disabled={!canEdit}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option><option value="done">Done</option></select></label><label>Priority<select name="priority" value={taskFields.priority} onChange={updateTaskField} disabled={!canEdit}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><DateField label="Due date" name="due_date" value={taskFields.due_date} onChange={updateTaskField} disabled={!canEdit} /><label>Repeat<select name="recurrence" value={taskFields.recurrence} onChange={updateTaskField} disabled={!canEdit}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button type="submit" className="secondary-button" disabled={!canEdit}>Save task</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Labels</h3><span>Comma separated</span></div><form className="inline-form" onSubmit={saveLabels}><input value={labelInput} onChange={event => setLabelInput(event.target.value)} placeholder="priority, client, risk" aria-label="Task labels" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Save</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Attachments</h3><span>{attachments.length}</span></div>{attachments.map(attachment => <div className="attachment-row" key={attachment.id}><a href={attachment.file_url} target="_blank" rel="noreferrer">{attachment.original_name}</a>{canEdit && <button className="inline-delete" onClick={() => deleteAttachment(attachment)} aria-label={`Delete ${attachment.original_name}`}><X size={14} /></button>}</div>)}<label className="attachment-upload"><span>Upload file</span><input type="file" onChange={uploadAttachment} disabled={!canEdit} /></label></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Subtasks</h3><span>{subtasks.filter(item => item.completed).length} of {subtasks.length}</span></div>{subtasks.map(item => <div className="subtask-row" key={item.id}><label><input type="checkbox" checked={item.completed} onChange={() => toggleSubtask(item)} disabled={!canEdit} /><span className={item.completed ? 'completed' : ''}>{item.title}</span></label>{canEdit && <button type="button" className="inline-delete" onClick={() => deleteSubtask(item)} aria-label={`Delete subtask ${item.title}`}><X size={14} /></button>}</div>)}<form className="inline-form" onSubmit={addSubtask}><input value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Add</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Comments</h3><span>{comments.length}</span></div>{comments.length ? comments.map(item => <article className="drawer-comment" key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p></article>) : <p className="drawer-muted">No comments yet.</p>}<form className="drawer-comment-form" onSubmit={addComment}><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Write an update for the team" aria-label="Write a task comment" /><button type="submit" className="primary-button">Post comment</button></form></section></>}</aside></div>
}
function Activity({ avatar, color, kind, text, strong, suffix, time }) { const detail = strong && text && strong.toLowerCase().startsWith(`${text.toLowerCase()} `) ? strong.slice(text.length + 1) : strong; return <div className="activity-item"><span className={`activity-kind activity-kind-${kind || 'default'}`} aria-hidden="true">{(kind || '•').slice(0, 1).toUpperCase()}</span><span className={`avatar small ${color}`}>{avatar}</span><p><strong>{text}</strong> {detail} {suffix}<span title={time}>{time}</span></p></div> }

function AuthScreen({ theme, onToggleTheme, onAuthenticated, connectionError }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', first_name: '', workspace_name: '' })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const updateField = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const submit = async event => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await fetch('/api/auth/csrf/', { credentials: 'include' })
      const csrfCookie = document.cookie.split('; ').find(cookie => cookie.startsWith('csrftoken='))
      const csrfToken = csrfCookie?.split('=')[1]
      const endpoint = mode === 'login' ? '/api/auth/login/' : '/api/auth/me/'
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken || '' },
        body: JSON.stringify(form),
      })
      const data = await readJsonResponse(response, 'Unable to authenticate.')
      if (!response.ok) throw new Error(data.error || 'Unable to authenticate.')
      onAuthenticated(data.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="auth-screen"><button type="button" className="auth-theme-toggle" onClick={onToggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-pressed={theme === 'dark'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><div className="auth-panel"><div className="auth-brand"><img src="/tijha-logo.png" alt="TijhaBooks" className="brand-mark" /><span>WorkSpace</span></div><p className="eyebrow">Team operations</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to see your team pulse and priorities.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p><form onSubmit={submit}>{mode === 'signup' && <><label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label><label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label></>}<label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" required /></label><label>Password<input name="password" type="password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required /></label>{error && <p className="auth-error">{error}</p>}{connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}<button type="submit" className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create workspace'}</button></form><button type="button" className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to WorkSpace? Create an account' : 'Already have an account? Sign in'}</button></div></div>
}

export default App

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return <main className="error-boundary"><div><p className="eyebrow">WorkSpace</p><h1>Something went wrong</h1><p>The workspace could not render this view. Reload to try again.</p><button className="primary-button" onClick={() => window.location.reload()}>Reload workspace</button></div></main>
  }
}

createRoot(document.getElementById('root')).render(<AppErrorBoundary><App /></AppErrorBoundary>)
