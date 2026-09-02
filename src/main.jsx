import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle, ArrowUpRight, BarChart3, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Filter, Hash, LayoutDashboard, LayoutGrid, MessageSquare, MoreHorizontal,
  PanelLeftClose, PanelLeftOpen,
  ChevronLeft, ChevronRight,
  Plus, Search, Settings, Sparkles, Target, Users, X, Sun, Moon
} from 'lucide-react'
import './styles.css'
import './tijhabooks-theme.css'

function Avatar({ member, small = false }) {
  return <span className={`avatar ${member.color} ${small ? 'small' : ''}`}>{member.initials}</span>
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

function App() {
  const today = toDateKey(new Date())
  const todayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${today}T12:00:00`))
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [taskError, setTaskError] = useState('')
  const [selectedTask, setSelectedTask] = useState(null)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('workspace-sidebar-collapsed') === 'true')
  const [newTask, setNewTask] = useState('')
  const [newAssigneeId, setNewAssigneeId] = useState('')
  const [newProjectId, setNewProjectId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRecurrence, setNewRecurrence] = useState('none')
  const [newPriority, setNewPriority] = useState('normal')
  const [selectedFilter, setSelectedFilter] = useState('All work')
  const [teamBoardMode, setTeamBoardMode] = useState('people')
  const [searchQuery, setSearchQuery] = useState('')
  const [theme, setTheme] = useState(() => localStorage.getItem('workspace-theme') || 'dark')
  const [session, setSession] = useState({ loading: true, user: null, error: '' })
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceReload, setWorkspaceReload] = useState(0)
  const [workspaceData, setWorkspaceData] = useState({ members: [], projects: [], events: [], checkIns: [], messages: [], followUps: [], invitations: [], notifications: [], activity: [], auditLogs: [], buckets: [], savedViews: [], reports: null })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('workspace-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('workspace-sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    const closeOverlays = event => {
      if (event.key !== 'Escape') return
      setNotificationOpen(false)
      setShowModal(false)
      setSelectedTask(null)
    }
    window.addEventListener('keydown', closeOverlays)
    return () => window.removeEventListener('keydown', closeOverlays)
  }, [])

  useEffect(() => {
    if (session.user && !session.user.workspaces.some(workspace => workspace.id === activeWorkspaceId)) {
      setActiveWorkspaceId(session.user.workspaces[0]?.id || null)
    }
  }, [session.user, activeWorkspaceId])

  useEffect(() => {
    fetch('/api/auth/me/', { credentials: 'include' })
      .then(response => response.json())
      .then(data => setSession({ loading: false, user: data.user || null, error: '' }))
      .catch(error => setSession({ loading: false, user: null, error: error.message }))
  }, [])

  useEffect(() => {
    if (!session.user) return undefined
    let isCurrent = true
    const workspaceId = activeWorkspaceId
    if (!workspaceId) return undefined
    setWorkspaceLoading(true)
    setWorkspaceError('')

    const read = path => fetch(path, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => {
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json()
    })
    const workspaceRole = session.user.workspaces.find(workspace => workspace.id === workspaceId)?.role
    const auditRequest = ['owner', 'manager'].includes(workspaceRole) ? read(`/api/workspaces/${workspaceId}/audit-logs/`) : Promise.resolve({ audit_logs: [] })

    const refreshCollaboration = () => Promise.all([
      read(`/api/workspaces/${workspaceId}/chat-messages/`),
      read(`/api/workspaces/${workspaceId}/follow-ups/`),
      read(`/api/workspaces/${workspaceId}/notifications/`),
      read(`/api/workspaces/${workspaceId}/activity/`),
      read(`/api/workspaces/${workspaceId}/plan-buckets/`),
      read(`/api/workspaces/${workspaceId}/reports/summary/`),
    ]).then(([messageData, followUpData, notificationData, activityData, bucketData, reportData]) => {
      if (!isCurrent) return
      setWorkspaceData(current => ({ ...current, messages: messageData.messages, followUps: followUpData.follow_ups, notifications: notificationData.notifications, activity: activityData.activity, buckets: bucketData.buckets, reports: reportData.summary }))
    }).catch(error => console.warn('Collaboration data could not be refreshed.', error.message))

    Promise.all([
      read('/api/tasks/'),
      read(`/api/workspaces/${workspaceId}/members/`),
      read(`/api/workspaces/${workspaceId}/projects/`),
      read(`/api/workspaces/${workspaceId}/calendar-events/`),
      read(`/api/workspaces/${workspaceId}/check-ins/?date=${today}`),
      read(`/api/workspaces/${workspaceId}/chat-messages/`),
      read(`/api/workspaces/${workspaceId}/follow-ups/`),
      read(`/api/workspaces/${workspaceId}/invitations/`),
      read(`/api/workspaces/${workspaceId}/notifications/`),
      read(`/api/workspaces/${workspaceId}/activity/`),
      read(`/api/workspaces/${workspaceId}/plan-buckets/`),
      read(`/api/workspaces/${workspaceId}/saved-views/`),
      read(`/api/workspaces/${workspaceId}/reports/summary/`),
      auditRequest,
    ])
      .then(([taskData, memberData, projectData, eventData, checkInData, messageData, followUpData, invitationData, notificationData, activityData, bucketData, savedViewData, reportData, auditData]) => {
        if (!isCurrent) return
        setTasks(taskData.tasks.map(task => ({
          id: task.id,
          title: task.title,
          member: task.assignee_name || 'Unassigned',
          tag: task.project || 'General',
          status: task.status === 'in_progress' ? 'in progress' : task.status,
          priority: task.priority || 'normal',
          due: taskDueLabel(task.due_date, today),
          due_date: task.due_date || '',
          estimate: 'n/a',
          can_edit: ['owner', 'manager'].includes(workspaceRole) || task.assignee_id === session.user.id,
          recurrence: task.recurrence || 'none',
          bucket: task.bucket || 'Backlog',
          labels: task.labels || [],
        })))
        setWorkspaceData({ members: memberData.members, projects: projectData.projects, events: eventData.events, checkIns: checkInData.check_ins, messages: messageData.messages, followUps: followUpData.follow_ups, invitations: invitationData.invitations, notifications: notificationData.notifications, activity: activityData.activity, auditLogs: auditData.audit_logs, buckets: bucketData.buckets, savedViews: savedViewData.saved_views, reports: reportData.summary })
        setWorkspaceLoading(false)
      })
      .catch(error => {
        if (!isCurrent) return
        setWorkspaceLoading(false)
        setWorkspaceError(error.message || 'Workspace data could not be loaded.')
        console.warn('Workspace data could not be loaded.', error.message)
      })
    const refreshTimer = window.setInterval(refreshCollaboration, 15000)

    return () => {
      isCurrent = false
      window.clearInterval(refreshTimer)
    }
  }, [session.user, activeWorkspaceId, today, workspaceReload])

  const visibleTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return tasks.filter(task => {
      const matchesStatus = selectedFilter === 'All work' || task.status === selectedFilter
      const matchesSearch = !normalizedQuery || [task.title, task.member, task.tag].some(value => value.toLowerCase().includes(normalizedQuery))
      return matchesStatus && matchesSearch
    })
  }, [tasks, selectedFilter, searchQuery])
  if (session.loading) return <div className="auth-loading">Loading WorkSpace...</div>
  if (!session.user) return <AuthScreen onAuthenticated={user => setSession({ loading: false, user, error: '' })} connectionError={session.error} />
  const completeTask = async id => {
    const previousTask = tasks.find(task => task.id === id)
    const nextStatus = previousTask?.status === 'done' ? 'todo' : 'done'
    setTasks(current => current.map(task => task.id === id ? { ...task, status: nextStatus } : task))
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!response.ok) throw new Error(`Task update returned ${response.status}`)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      setWorkspaceError(error.message || 'Task status could not be saved.')
      console.warn('Task status could not be saved.', error.message)
    }
  }
  const changeTaskStatus = async (id, status) => {
    const previousTask = tasks.find(task => task.id === id)
    setTasks(current => current.map(task => task.id === id ? { ...task, status } : task))
    try {
      const apiStatus = status === 'in progress' ? 'in_progress' : status
      const response = await fetch(`/api/tasks/${id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') }, body: JSON.stringify({ status: apiStatus }) })
      if (!response.ok) throw new Error(`Task update returned ${response.status}`)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      setWorkspaceError(error.message || 'Task status could not be saved.')
      console.warn('Task status could not be saved.', error.message)
    }
  }
  const changeTaskBucket = async (id, bucket) => {
    const previousTask = tasks.find(task => task.id === id)
    setTasks(current => current.map(task => task.id === id ? { ...task, bucket } : task))
    try {
      const response = await fetch(`/api/tasks/${id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') }, body: JSON.stringify({ bucket }) })
      if (!response.ok) throw new Error(`Task bucket update returned ${response.status}`)
    } catch (error) {
      if (previousTask) setTasks(current => current.map(task => task.id === id ? previousTask : task))
      console.warn('Task bucket could not be saved.', error.message)
    }
  }
  const deleteTask = async id => {
    if (!window.confirm('Delete this task?')) return
    const response = await fetch(`/api/tasks/${id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') } })
    if (!response.ok) return setWorkspaceError('Task could not be deleted.')
    setTasks(current => current.filter(task => task.id !== id))
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
      setWorkspaceError(acceptError.message)
    }
  }
  const markNotificationsRead = async () => {
    const response = await fetch(`/api/workspaces/${activeWorkspaceId}/notifications/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ read_all: true }) })
    if (!response.ok) return setWorkspaceError('Notifications could not be marked as read.')
    setWorkspaceData(current => ({ ...current, notifications: current.notifications.map(notification => ({ ...notification, read: true })) }))
  }
  const markNotificationRead = async notificationId => {
    const response = await fetch(`/api/workspaces/${activeWorkspaceId}/notifications/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ notification_id: notificationId }) })
    if (!response.ok) return setWorkspaceError('Notification could not be marked as read.')
    setWorkspaceData(current => ({ ...current, notifications: current.notifications.map(notification => notification.id === notificationId ? { ...notification, read: true } : notification) }))
  }
  const addTask = async event => {
    event.preventDefault()
    setTaskError('')
    if (!newTask.trim()) {
      setTaskError('Task name is required.')
      return
    }
    try {
      const response = await fetch('/api/tasks/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(activeWorkspaceId || '') },
        body: JSON.stringify({ title: newTask.trim(), assignee_id: newAssigneeId || null, project_id: newProjectId || null, due_date: newDueDate || null, recurrence: newRecurrence, priority: newPriority }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Task creation returned ${response.status}`)
      setTasks(current => [...current, { id: data.task.id, title: data.task.title, member: data.task.assignee_name || 'Unassigned', tag: data.task.project || 'General', status: 'todo', priority: data.task.priority || 'normal', due: taskDueLabel(data.task.due_date, today), due_date: data.task.due_date || '', estimate: 'n/a', can_edit: ['owner', 'manager'].includes(currentWorkspace?.role) || data.task.assignee_id === session.user.id, recurrence: data.task.recurrence || 'none', bucket: data.task.bucket || 'Backlog', labels: data.task.labels || [] }])
      setNewTask('')
      setNewAssigneeId('')
      setNewProjectId('')
      setNewDueDate('')
      setNewRecurrence('none')
      setNewPriority('normal')
      setShowModal(false)
    } catch (error) {
      setTaskError(error.message || 'Task could not be created.')
      console.error('Task could not be created.', error.message)
    }
  }

  const navItems = [
    { label: 'Today', icon: LayoutDashboard }, { label: 'My tasks', icon: CheckCircle2 },
    { label: 'Team board', icon: Users }, { label: 'Planner', icon: LayoutGrid }, { label: 'Calendar', icon: CalendarDays }, { label: 'Reports', icon: BarChart3 },
    { label: 'Projects', icon: Target }, { label: 'Chat', icon: MessageSquare },
  ]
  const mobileNavItems = [...navItems, { label: 'Follow-up', icon: Bell }, { label: 'Check-ins', icon: Hash }, { label: 'Settings', icon: Settings }]
  const workspaceId = activeWorkspaceId
  const currentWorkspace = session.user.workspaces.find(workspace => workspace.id === activeWorkspaceId) || session.user.workspaces[0]
  const teamMembers = workspaceData.members.map(member => ({
    name: [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email,
    initials: [member.first_name, member.last_name].filter(Boolean).map(name => name[0]).join('').slice(0, 2).toUpperCase() || member.email.slice(0, 2).toUpperCase(),
    color: 'blue',
    role: member.role,
  }))
  const currentUserName = [session.user.first_name, session.user.last_name].filter(Boolean).join(' ') || session.user.email
  const completedTaskCount = tasks.filter(task => task.status === 'done').length
  const attentionTaskCount = tasks.filter(task => ['blocked', 'review'].includes(task.status) || task.due === 'Overdue').length
  const completionPercent = tasks.length ? Math.round((completedTaskCount / tasks.length) * 100) : 0
  const myTasks = tasks.filter(task => task.member === currentUserName)
  const myCompletedTaskCount = myTasks.filter(task => task.status === 'done').length

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">W</div><span>WorkSpace</span><button className="sidebar-toggle" onClick={() => setSidebarCollapsed(current => !current)} aria-label={`${sidebarCollapsed ? 'Expand' : 'Collapse'} navigation`} aria-expanded={!sidebarCollapsed}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
      <label className="workspace-switcher"><span className="workspace-dot" /><select value={activeWorkspaceId || ''} onChange={event => setActiveWorkspaceId(Number(event.target.value))}>{session.user.workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><ChevronDown size={14} /></label>
      <nav className="main-nav">
        <p className="nav-label">Workspace</p>
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)} title={sidebarCollapsed ? label : undefined}><Icon size={18} /><span>{label}</span>{label === 'Chat' && workspaceData.messages.length > 0 && <span className="nav-badge">{workspaceData.messages.length}</span>}</button>)}
        <p className="nav-label space-top">Manage</p>
        <button className={`nav-item ${active === 'Follow-up' ? 'active' : ''}`} onClick={() => setActive('Follow-up')} title={sidebarCollapsed ? 'Follow-up' : undefined}><Bell size={18} /><span>Follow-up</span>{workspaceData.followUps.filter(item => item.status !== 'completed').length > 0 && <span className="nav-badge alert">{workspaceData.followUps.filter(item => item.status !== 'completed').length}</span>}</button>
        <button className={`nav-item ${active === 'Check-ins' ? 'active' : ''}`} onClick={() => setActive('Check-ins')} title={sidebarCollapsed ? 'Check-ins' : undefined}><Hash size={18} /><span>Check-ins</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><Sparkles size={16} /><div><strong>Make your week flow</strong><span>Set your priorities</span></div><ArrowUpRight size={15} /></div><button className={`nav-item ${active === 'Settings' ? 'active' : ''}`} onClick={() => setActive('Settings')} title={sidebarCollapsed ? 'Settings' : undefined}><Settings size={18} /><span>Settings</span></button><div className="profile"><div className="avatar navy">KO</div><div><strong>{currentUserName}</strong><span>{currentWorkspace?.role || 'Member'}</span></div><MoreHorizontal size={17} /></div></div>
    </aside>
    <nav className="mobile-pill-nav" aria-label="Mobile workspace navigation">{mobileNavItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => setActive(label)} aria-label={label} title={label}><Icon size={18} /></button>)}</nav>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><label className="top-search"><Search size={16} /><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search work" aria-label="Search work" /></label><div className="notification-wrap"><button className="icon-button notification" onClick={() => setNotificationOpen(current => !current)} aria-label="Open notifications"><Bell size={18} />{workspaceData.notifications.some(notification => !notification.read) && <i />}</button>{notificationOpen && <div className="notification-panel"><div className="notification-panel-heading"><strong>Notifications</strong><button onClick={markNotificationsRead}>Mark all read</button></div>{workspaceData.notifications.length ? workspaceData.notifications.slice(0, 8).map(notification => <button type="button" className={`notification-row ${notification.read ? '' : 'unread'}`} key={notification.id} onClick={() => markNotificationRead(notification.id)} aria-label={`Mark ${notification.title} as read`}><strong>{notification.title}</strong><span>{notification.body || 'Workspace update'}</span></button>) : <EmptyState text="No notifications yet." />}</div>}</div><button className="theme-toggle" onClick={() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="help-button" onClick={() => setActive('Settings')}><CircleHelp size={17} /> Help</button><button className="user-avatar" onClick={logout} title="Sign out">KO</button></div></header>
      <div className="page-content">
        {session.user.pending_invitations?.map(invitation => <div className="workspace-status" key={invitation.id}><span>You are invited to join {invitation.workspace_name} as a {invitation.role}.</span><button className="secondary-button" onClick={() => acceptInvitation(invitation)}>Accept invitation</button></div>)}
        {workspaceLoading && <div className="workspace-status" role="status">Loading workspace data...</div>}
        {workspaceError && <div className="workspace-status error" role="alert"><span>Workspace data could not be loaded: {workspaceError}</span><button className="secondary-button" onClick={() => setWorkspaceReload(current => current + 1)}>Retry</button></div>}
        {active !== 'Today' && <WorkspaceView active={active} data={workspaceData} tasks={tasks} searchQuery={searchQuery} onSearchChange={setSearchQuery} theme={theme} sidebarCollapsed={sidebarCollapsed} workspaceId={workspaceId} currentUserName={[session.user.first_name, session.user.last_name].filter(Boolean).join(' ') || session.user.email} currentUserId={session.user.id} canManageMembers={['owner', 'manager'].includes(currentWorkspace?.role)} canManageTasks={['owner', 'manager'].includes(currentWorkspace?.role)} onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} onToggleSidebar={() => setSidebarCollapsed(current => !current)} onComplete={completeTask} onStatusChange={changeTaskStatus} onBucketChange={changeTaskBucket} onDelete={deleteTask} onAddTask={() => setShowModal(true)} onOpenTask={setSelectedTask} onActionError={message => setWorkspaceError(message)} />}
        {active === 'Today' && <>
        <section className="page-heading"><div><p className="eyebrow">{todayLabel}</p><h1>Good morning, {session.user.first_name || session.user.email.split('@')[0]}</h1><p className="subtitle">Here is what is moving across {currentWorkspace?.name || 'your workspace'} today.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Add task</button></section>
        <section className="metrics"><div className="metric-card"><div className="metric-icon navy-bg"><CheckCircle2 size={18} /></div><div><span>Team completion</span><strong>{completionPercent}%</strong></div><em><small>{completedTaskCount} of {tasks.length} tasks complete</small></em></div><div className="metric-card"><div className="metric-icon orange-bg"><AlertCircle size={18} /></div><div><span>Needs attention</span><strong>{attentionTaskCount} tasks</strong></div><em className={attentionTaskCount ? 'negative' : 'positive'}>{attentionTaskCount ? 'Blocked, review, or overdue' : 'Nothing urgent'}</em></div><div className="metric-card"><div className="metric-icon teal-bg"><Clock3 size={18} /></div><div><span>Focus tasks</span><strong>{myTasks.length}</strong></div><em><small>{myCompletedTaskCount} complete</small></em></div></section>
        <div className="content-grid">
          <section className="board-section"><div className="section-header"><div><h2>Team pulse</h2><p>Today's commitments across your team</p></div><div className="header-actions"><button className="filter-button" onClick={() => setSelectedFilter(current => current === 'All work' ? 'in progress' : 'All work')}><Filter size={15} /> {selectedFilter === 'All work' ? 'Filters' : selectedFilter} <ChevronDown size={14} /></button><button className="more-button" onClick={() => setActive('Planner')} aria-label="Open planner"><MoreHorizontal size={19} /></button></div></div><div className="board-tabs"><button className={`tab ${teamBoardMode === 'people' ? 'active' : ''}`} onClick={() => setTeamBoardMode('people')}>People</button><button className={`tab ${teamBoardMode === 'status' ? 'active' : ''}`} onClick={() => setTeamBoardMode('status')}>Status</button><button className={`tab ${teamBoardMode === 'priority' ? 'active' : ''}`} onClick={() => setTeamBoardMode('priority')}>Priority</button><label className="filter-select"><span className="status-dot all" /><select value={selectedFilter} onChange={event => setSelectedFilter(event.target.value)}><option>All work</option><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label></div><div className="team-board">{teamBoardMode === 'people' && teamMembers.map(member => { const memberTasks = visibleTasks.filter(task => task.member === member.name); return <div className="member-row" key={member.name}><div className="member-cell"><Avatar member={member} /><div><strong>{member.name}</strong><span>{member.role}</span></div></div><div className="task-stack">{memberTasks.length ? memberTasks.map(task => <TaskCard key={task.id} task={task} onComplete={completeTask} onStatusChange={changeTaskStatus} onDelete={deleteTask} onOpenTask={setSelectedTask} canDelete={canManageTasks} />) : <div className="empty-task">No tasks in this view</div>}</div><button className="row-add" onClick={() => setShowModal(true)} aria-label={`Add task for ${member.name}`}><Plus size={16} /></button></div> })}{teamBoardMode === 'status' && ['todo', 'in progress', 'review', 'blocked', 'done'].map(status => { const statusTasks = visibleTasks.filter(task => task.status === status); return <div className="member-row" key={status}><div className="member-cell"><span className="status-dot all" /><div><strong>{status}</strong><span>{statusTasks.length} tasks</span></div></div><div className="task-stack">{statusTasks.length ? statusTasks.map(task => <TaskCard key={task.id} task={task} onComplete={completeTask} onStatusChange={changeTaskStatus} onDelete={deleteTask} onOpenTask={setSelectedTask} canDelete={canManageTasks} />) : <div className="empty-task">No tasks in this view</div>}</div><button className="row-add" onClick={() => setShowModal(true)} aria-label={`Add ${status} task`}><Plus size={16} /></button></div> })}{teamBoardMode === 'priority' && ['urgent', 'high', 'normal', 'low'].map(priority => { const priorityTasks = visibleTasks.filter(task => task.priority === priority); return <div className="member-row" key={priority}><div className="member-cell"><span className="status-dot all" /><div><strong>{priority} priority</strong><span>{priorityTasks.length} tasks</span></div></div><div className="task-stack">{priorityTasks.length ? priorityTasks.map(task => <TaskCard key={task.id} task={task} onComplete={completeTask} onStatusChange={changeTaskStatus} onDelete={deleteTask} onOpenTask={setSelectedTask} canDelete={canManageTasks} />) : <div className="empty-task">No tasks in this view</div>}</div><button className="row-add" onClick={() => setShowModal(true)} aria-label={`Add ${priority} priority task`}><Plus size={16} /></button></div> })}</div><button className="add-person" onClick={() => setActive('Team board')}><Plus size={16} /> Add team member</button></section>
          <aside className="right-column"><section className="focus-card"><div className="section-header"><div><h2>My focus</h2><p>Your personal priorities</p></div><button className="more-button" onClick={() => setActive('My tasks')} aria-label="Open my tasks"><MoreHorizontal size={19} /></button></div><div className="focus-progress"><div><strong>{myCompletedTaskCount} of {myTasks.length}</strong><span>tasks completed</span></div><div className="progress-ring"><span>{myTasks.length ? Math.round((myCompletedTaskCount / myTasks.length) * 100) : 0}%</span></div></div><div className="focus-list">{myTasks.length ? myTasks.slice(0, 4).map(task => <div className={`focus-item ${task.status === 'done' ? 'done' : ''}`} key={task.id}><span className={`check ${task.status === 'done' ? 'checked' : ''}`}>{task.status === 'done' && <Check size={13} />}</span><div><button className="task-title-button" onClick={() => setSelectedTask(task)}>{task.title}</button><span>{task.due}</span></div></div>) : <EmptyState text="No tasks assigned to you yet." />}</div><button className="text-button" onClick={() => setActive('My tasks')}>View all my tasks <ArrowUpRight size={15} /></button></section><section className="checkin-card"><div className="checkin-heading"><div className="checkin-icon"><MessageSquare size={17} /></div><div><h3>Daily check-in</h3><p>Share a quick update with the team</p></div></div><div className="checkin-questions"><span><i />What did you complete?</span><span><i />What's next?</span><span><i />Any blockers?</span></div><button className="secondary-button" onClick={() => setActive('Check-ins')}><Plus size={16} /> Start check-in</button></section><section className="activity-card"><div className="section-header"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><button className="more-button" onClick={() => setActive('Chat')} aria-label="Open team chat"><MoreHorizontal size={19} /></button></div>{workspaceData.activity.length ? <div className="activity-list">{workspaceData.activity.slice(0, 6).map(event => <Activity key={`activity-${event.id}`} avatar={event.actor_name.slice(0, 2).toUpperCase()} color="blue" text={`${event.actor_name} activity`} strong={event.message.slice(0, 60)} suffix="" time={formatCalendarDate(new Date(event.created_at), { dateStyle: 'medium', timeStyle: 'short' })} />)}</div> : <EmptyState text="No workspace activity yet." />}</section></aside>
        </div>
        </>}
      </div>
    </main>
    {showModal && <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}><form className="modal" onSubmit={addTask} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Quick capture</p><h2>Add a task</h2></div><button type="button" className="close-button" onClick={() => setShowModal(false)}><X size={18} /></button></div><label>Task name<input autoFocus value={newTask} onChange={event => { setNewTask(event.target.value); setTaskError('') }} placeholder="What needs to happen?" /></label>{taskError && <p className="auth-error" role="alert">{taskError}</p>}<div className="modal-grid"><label>Assign to<select value={newAssigneeId} onChange={event => setNewAssigneeId(event.target.value)}><option value="">Unassigned</option>{workspaceData.members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Due date<input type="date" value={newDueDate} onChange={event => setNewDueDate(event.target.value)} /></label></div><div className="modal-grid"><label>Project<select value={newProjectId} onChange={event => setNewProjectId(event.target.value)}><option value="">General</option>{workspaceData.projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Priority<select value={newPriority} onChange={event => setNewPriority(event.target.value)}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label></div><label>Repeat<select value={newRecurrence} onChange={event => setNewRecurrence(event.target.value)}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button className="primary-button modal-submit">Create task <ArrowUpRight size={16} /></button></form></div>}
    {selectedTask && <TaskDetailDrawer task={selectedTask} workspaceId={activeWorkspaceId} onClose={() => setSelectedTask(null)} onTaskUpdated={updatedTask => setTasks(current => current.map(item => item.id === updatedTask.id ? { ...item, title: updatedTask.title, status: updatedTask.status === 'in_progress' ? 'in progress' : updatedTask.status, priority: updatedTask.priority || 'normal', due: taskDueLabel(updatedTask.due_date, today), due_date: updatedTask.due_date || '', recurrence: updatedTask.recurrence || 'none' } : item))} />}
  </div>
}

function WorkspaceView({ active, data, tasks, searchQuery, onSearchChange, theme, sidebarCollapsed, workspaceId, currentUserName, currentUserId, canManageMembers, canManageTasks, onToggleTheme, onToggleSidebar, onComplete, onStatusChange, onBucketChange, onDelete, onAddTask, onOpenTask, onActionError }) {
  const today = toDateKey(new Date())
  const [localData, setLocalData] = useState(data)
  const [calendarView, setCalendarView] = useState('week')
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [checkInDate, setCheckInDate] = useState(today)
  const [checkInLoading, setCheckInLoading] = useState(false)
  const [checkInError, setCheckInError] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerType, setComposerType] = useState('chat')
  const [composerError, setComposerError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [newBucketName, setNewBucketName] = useState('')
  const [bucketError, setBucketError] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [chatChannel, setChatChannel] = useState('general')
  const [plannerFilter, setPlannerFilter] = useState('all')
  const [savedViewName, setSavedViewName] = useState('')
  const [selectedSavedView, setSelectedSavedView] = useState('')
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedFollowUp, setSelectedFollowUp] = useState(null)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [savedViews, setSavedViews] = useState(data.savedViews?.length ? data.savedViews : () => JSON.parse(localStorage.getItem(`workspace-saved-views-${workspaceId}`) || '[]'))
  const [form, setForm] = useState({ title: '', name: '', description: '', start_at: '', end_at: '', event_type: 'meeting', reminder_minutes: 15, completed: '', next_steps: '', blockers: '', message: '', channel: 'general', note: '', due_date: '', assigned_to: '', task_id: '', date: today, email: '', role: 'member' })
  useEffect(() => setLocalData(data), [data])
  useEffect(() => setSavedViews(data.savedViews?.length ? data.savedViews : JSON.parse(localStorage.getItem(`workspace-saved-views-${workspaceId}`) || '[]')), [data.savedViews, workspaceId])

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
      setComposerOpen(false)
      setReplyTo(null)
    } catch (submitError) {
      setComposerError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  const completeFollowUp = async followUp => {
    const nextStatus = followUp.status === 'completed' ? 'open' : 'completed'
    const response = await fetch(`/api/follow-ups/${followUp.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ status: nextStatus }) })
    if (!response.ok) return onActionError('Follow-up could not be updated.')
    const responseData = await response.json()
    setLocalData(current => ({ ...current, followUps: current.followUps.map(item => item.id === followUp.id ? responseData.follow_up : item) }))
  }
  const deleteCalendarEvent = async eventId => {
    const response = await fetch(`/api/workspaces/${workspaceId}/calendar-events/${eventId}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return onActionError('Calendar event could not be deleted.')
    setLocalData(current => ({ ...current, events: current.events.filter(event => event.id !== eventId) }))
  }
  const createBucket = async event => {
    event.preventDefault()
    const name = newBucketName.trim()
    if (!name) return
    setBucketError('')
    const response = await fetch(`/api/workspaces/${workspaceId}/plan-buckets/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ name }) })
    const responseData = await response.json()
    if (!response.ok) return setBucketError(responseData.error || 'Bucket could not be created.')
    setLocalData(current => ({ ...current, buckets: [...current.buckets, responseData.bucket] }))
    setNewBucketName('')
  }
  const calendarDays = getCalendarDays(calendarView, calendarDate)
  const calendarEventsForDay = day => localData.events.filter(event => toDateKey(event.start_at) === toDateKey(day))
  const calendarHeading = calendarView === 'year'
    ? formatCalendarDate(calendarDate, { year: 'numeric' })
    : formatCalendarDate(calendarDate, { month: 'long', year: 'numeric' })
  const shiftCalendar = amount => {
    const next = new Date(calendarDate)
    if (calendarView === 'day') next.setDate(next.getDate() + amount)
    if (calendarView === 'week') next.setDate(next.getDate() + amount * 7)
    if (calendarView === 'month') next.setMonth(next.getMonth() + amount)
    if (calendarView === 'year') next.setFullYear(next.getFullYear() + amount)
    setCalendarDate(next)
  }
  const updateProjectStatus = async (project, status) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ status }) })
    if (!response.ok) return onActionError('Project status could not be saved.')
    const responseData = await response.json()
    setLocalData(current => ({ ...current, projects: current.projects.map(item => item.id === project.id ? responseData.project : item) }))
  }
  const deleteProject = async project => {
    if (!canManageMembers || !window.confirm(`Delete ${project.name}?`)) return
    const response = await fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return onActionError('Project could not be deleted.')
    setLocalData(current => ({ ...current, projects: current.projects.filter(item => item.id !== project.id) }))
  }
  const updateMemberRole = async (member, role) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ role }) })
    if (!response.ok) return onActionError('Member role could not be updated.')
    const responseData = await response.json()
    setLocalData(current => ({ ...current, members: current.members.map(item => item.id === member.id ? responseData.member : item) }))
  }
  const removeMember = async member => {
    if (member.role === 'owner' || !window.confirm(`Remove ${member.email} from this workspace?`)) return
    const response = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return onActionError('Member could not be removed.')
    setLocalData(current => ({ ...current, members: current.members.filter(item => item.id !== member.id) }))
  }
  const cancelInvitation = async invitation => {
    if (!window.confirm(`Cancel invitation for ${invitation.email}?`)) return
    const response = await fetch(`/api/workspaces/${workspaceId}/invitations/${invitation.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return onActionError('Invitation could not be cancelled.')
    setLocalData(current => ({ ...current, invitations: current.invitations.map(item => item.id === invitation.id ? { ...item, status: 'cancelled' } : item) }))
  }
  const title = active === 'My tasks' ? 'My tasks' : active
  const subtitle = {
    'My tasks': 'Your personal work, deadlines, and follow-ups.',
    'Team board': 'See ownership and progress across the workspace.',
    Planner: 'Plan work visually across buckets, owners, and priorities.',
    Calendar: 'Meetings, focus time, and deadlines in one view.',
    Reports: 'Understand progress, workload, and team health.',
    Settings: 'Manage your workspace preferences.',
    Projects: 'Keep initiatives, milestones, and ownership visible.',
    Chat: 'Keep decisions and team conversations close to the work.',
    'Follow-up': 'A clear queue for work that needs a response.',
    'Check-ins': 'Daily updates that keep the team aligned.',
  }[active]

  if (active === 'Planner') {
    const buckets = data.buckets.length ? data.buckets : [{ id: 'backlog', name: 'Backlog' }]
    const availableLabels = [...new Set(tasks.flatMap(task => task.labels || []))]
    const filteredTasks = tasks.filter(task => {
      const matchesSearch = !searchQuery || `${task.title} ${task.member} ${task.tag}`.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = plannerFilter === 'all' || task.status === plannerFilter || task.bucket === plannerFilter || (plannerFilter === 'mine' && task.member === currentUserName) || (task.labels || []).includes(plannerFilter)
      return matchesSearch && matchesFilter
    })
    const saveView = async event => {
      event.preventDefault()
      const name = savedViewName.trim()
      if (!name) return
      const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ name, filter: plannerFilter, search: searchQuery }) })
      const responseData = await response.json()
      if (!response.ok) return setBucketError(responseData.error || 'Saved view could not be created.')
      const nextViews = [...savedViews.filter(view => view.name !== name), responseData.saved_view]
      setSavedViews(nextViews)
      localStorage.setItem(`workspace-saved-views-${workspaceId}`, JSON.stringify(nextViews))
      setSavedViewName('')
    }
    const applyView = event => {
      setSelectedSavedView(event.target.value)
      const view = savedViews.find(item => item.name === event.target.value)
      if (view) {
        setPlannerFilter(view.filter)
        onSearchChange(view.search || '')
      }
    }
    const deleteSavedView = async () => {
      const view = savedViews.find(item => item.name === selectedSavedView)
      if (!view || !window.confirm(`Delete saved view ${view.name}?`)) return
      const response = await fetch(`/api/workspaces/${workspaceId}/saved-views/${view.id}/`, { method: 'DELETE', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() } })
      if (!response.ok) return setBucketError('Saved view could not be deleted.')
      const nextViews = savedViews.filter(item => item.id !== view.id)
      setSavedViews(nextViews)
      setSelectedSavedView('')
      localStorage.setItem(`workspace-saved-views-${workspaceId}`, JSON.stringify(nextViews))
    }
    return <section className="workspace-view"><WorkspaceViewHeading title="Planner" subtitle={subtitle} action="Add task" onAction={onAddTask} /><div className="planner-toolbar"><span>{filteredTasks.length} of {tasks.length} tasks shown</span><div className="planner-filter-controls"><select value={plannerFilter} onChange={event => setPlannerFilter(event.target.value)} aria-label="Filter Planner tasks"><option value="all">All tasks</option><option value="mine">My tasks</option><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="done">Done</option>{buckets.map(bucket => <option key={bucket.id} value={bucket.name}>{bucket.name}</option>)}{availableLabels.map(label => <option key={label} value={label}>Label: {label}</option>)}</select><select value={selectedSavedView} onChange={applyView} aria-label="Load saved Planner view"><option value="">Saved views</option>{savedViews.map(view => <option key={view.name} value={view.name}>{view.name}</option>)}</select><button type="button" className="secondary-button" onClick={deleteSavedView} disabled={!selectedSavedView}>Delete view</button><form className="bucket-create-form" onSubmit={saveView}><input value={savedViewName} onChange={event => setSavedViewName(event.target.value)} placeholder="Save view as" aria-label="Saved view name" /><button className="secondary-button">Save</button></form><form className="bucket-create-form" onSubmit={createBucket}><input value={newBucketName} onChange={event => setNewBucketName(event.target.value)} placeholder="New bucket" aria-label="New bucket name" /><button className="secondary-button">Add bucket</button></form></div></div>{bucketError && <p className="auth-error">{bucketError}</p>}<div className="planner-board">{buckets.map(bucket => <div className="planner-column" key={bucket.id} onDragOver={event => event.preventDefault()} onDrop={event => { const taskId = Number(event.dataTransfer.getData('text/plain')); if (taskId) onBucketChange?.(taskId, bucket.name) }}><div className="planner-column-heading"><strong>{bucket.name}</strong><span>{filteredTasks.filter(task => task.bucket === bucket.name).length}</span></div><div className="planner-column-tasks">{filteredTasks.filter(task => task.bucket === bucket.name).map(task => <TaskCard key={task.id} task={task} onComplete={onComplete} onStatusChange={onStatusChange} onDelete={onDelete} onOpenTask={onOpenTask} canDelete={canManageTasks} draggable />)}{!filteredTasks.some(task => task.bucket === bucket.name) && <EmptyState text="No tasks here yet." />}</div></div>)}</div></section>
  }

  if (active === 'Reports') {
    const report = data.reports || { total_tasks: 0, overdue_tasks: 0, blocked_tasks: 0, check_ins_today: 0, members: 0, status_counts: {}, workload: [] }
    const statusLabels = { todo: 'To do', in_progress: 'In progress', review: 'Review', blocked: 'Blocked', done: 'Done' }
    return <section className="workspace-view"><WorkspaceViewHeading title="Reports" subtitle={subtitle} /><div className="report-metrics"><article className="workspace-card report-stat"><span>Total tasks</span><strong>{report.total_tasks}</strong></article><article className="workspace-card report-stat"><span>Overdue</span><strong>{report.overdue_tasks}</strong></article><article className="workspace-card report-stat"><span>Blocked</span><strong>{report.blocked_tasks}</strong></article><article className="workspace-card report-stat"><span>Check-ins today</span><strong>{report.check_ins_today} of {report.members}</strong></article></div><div className="report-grid"><section className="workspace-card report-panel"><div className="drawer-section-heading"><h3>Task status</h3><span>{report.total_tasks} total</span></div>{Object.entries(statusLabels).map(([key, label]) => <div className="report-bar-row" key={key}><span>{label}</span><div><i style={{ width: `${report.total_tasks ? Math.round(((report.status_counts[key] || 0) / report.total_tasks) * 100) : 0}%` }} /></div><strong>{report.status_counts[key] || 0}</strong></div>)}</section><section className="workspace-card report-panel"><div className="drawer-section-heading"><h3>Member workload</h3><span>{report.members} members</span></div>{report.workload.length ? report.workload.map(member => <div className="report-member-row" key={member.user_id}><span>{member.user_name}</span><strong>{member.open} open</strong><em>{member.blocked} blocked</em></div>) : <EmptyState text="No team workload yet." />}</section></div><section className="workspace-card report-panel audit-panel"><div className="drawer-section-heading"><h3>Audit trail</h3><span>Leader access</span></div>{data.auditLogs?.length ? data.auditLogs.slice(0, 12).map(log => <div className="audit-row" key={log.id}><span className="audit-action">{log.action.replaceAll('_', ' ')}</span><div><strong>{log.actor_name}</strong><span>{log.target_type}{log.target_id ? ` #${log.target_id}` : ''}</span></div><time dateTime={log.created_at}>{formatCalendarDate(new Date(log.created_at), { dateStyle: 'medium', timeStyle: 'short' })}</time></div>) : <EmptyState text="No audit events recorded yet." />}</section></section>
  }

  if (active === 'Settings') {
    return <section className="workspace-view"><WorkspaceViewHeading title="Settings" subtitle={subtitle} /><div className="settings-grid"><section className="workspace-card settings-panel"><div className="drawer-section-heading"><h3>Appearance</h3></div><div className="settings-row"><div><strong>Theme</strong><span>Use the dark navy or light workspace theme.</span></div><button className="secondary-button settings-action" onClick={onToggleTheme}>{theme === 'dark' ? 'Switch to light' : 'Switch to dark'}</button></div><div className="settings-row"><div><strong>Sidebar</strong><span>Keep navigation expanded or use the compact icon rail.</span></div><button className="secondary-button settings-action" onClick={onToggleSidebar}>{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</button></div></section><section className="workspace-card settings-panel"><div className="drawer-section-heading"><h3>Workspace access</h3></div><div className="settings-row"><div><strong>Your role</strong><span>{currentUserName}</span></div><em>{canManageMembers ? 'Leader' : 'Member'}</em></div><div className="settings-row"><div><strong>Members</strong><span>People with access to this workspace.</span></div><strong>{data.members.length}</strong></div></section></div></section>
  }

  if (active === 'Calendar') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add event" onAction={() => openComposer('calendar')} /><div className="calendar-layout"><div className={`calendar-week calendar-${calendarView}`}><div className="calendar-toolbar"><div className="calendar-toolbar-title"><button className="calendar-nav-button" onClick={() => shiftCalendar(-1)} aria-label="Previous period"><ChevronLeft size={16} /></button><strong>{calendarHeading}</strong><button className="calendar-nav-button" onClick={() => shiftCalendar(1)} aria-label="Next period"><ChevronRight size={16} /></button></div><div className="calendar-toolbar-actions"><button className="secondary-button" onClick={() => setCalendarDate(new Date())}>Today</button><div className="calendar-view-switcher" role="group" aria-label="Calendar view">{['day', 'week', 'month', 'year'].map(view => <button key={view} className={calendarView === view ? 'active' : ''} onClick={() => setCalendarView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}</div></div></div><div className="calendar-grid">{calendarDays.map(day => <div className="calendar-day" key={day.toISOString()}><strong>{calendarView === 'year' ? formatCalendarDate(day, { month: 'short' }) : formatCalendarDate(day, { weekday: 'short', day: 'numeric' })}</strong><div className="calendar-slot">{calendarEventsForDay(day).map(event => <button type="button" className="event-pill" key={event.id} onClick={() => setSelectedEvent(event)} disabled={!(canManageMembers || event.created_by === currentUserId)} aria-label={`Edit ${event.title}`}><span>{formatCalendarDate(new Date(event.start_at), { hour: 'numeric', minute: '2-digit' })}</span>{event.title}</button>)}</div></div>)}</div></div><aside className="workspace-side-card"><div className="calendar-side-heading"><h3>Upcoming</h3><a className="calendar-export" href={`/api/workspaces/${workspaceId}/calendar.ics`} download>Export ICS</a></div>{localData.events.length ? localData.events.map(event => <div className="compact-row" key={event.id}><CalendarDays size={15} /><div><strong>{event.title}</strong><span>{formatCalendarDate(new Date(event.start_at), { dateStyle: 'medium', timeStyle: 'short' })}</span><a className="calendar-google-link" href={googleCalendarUrl(event)} target="_blank" rel="noreferrer">Add to Google Calendar</a></div>{(canManageMembers || event.created_by === currentUserId) && <><button type="button" className="inline-edit" onClick={() => setSelectedEvent(event)} aria-label={`Edit ${event.title}`}>Edit</button><button type="button" className="inline-delete" onClick={() => deleteCalendarEvent(event.id)} aria-label={`Delete ${event.title}`}><X size={14} /></button></>}</div>) : <EmptyState text="No events scheduled yet." />}</aside></div>{composerOpen && <WorkspaceComposer type="calendar" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}{selectedEvent && <CalendarEventEditDialog event={selectedEvent} workspaceId={workspaceId} onClose={() => setSelectedEvent(null)} onUpdated={updatedEvent => { setLocalData(current => ({ ...current, events: current.events.map(item => item.id === updatedEvent.id ? updatedEvent : item) })); setSelectedEvent(null) }} />}</section>
  }

  if (active === 'Check-ins') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Start check-in" onAction={() => openComposer('checkin')} /><div className="checkin-toolbar"><label>View date<input type="date" value={checkInDate} onChange={event => setCheckInDate(event.target.value)} aria-label="Check-in history date" /></label><span>{checkInDate === today ? 'Today' : 'Updates for ' + checkInDate}</span></div>{checkInLoading && <p className="workspace-inline-status" role="status">Loading check-ins...</p>}{checkInError && <p className="auth-error" role="alert">{checkInError}</p>}<div className="checkin-grid">{localData.checkIns.length ? localData.checkIns.map(checkIn => <article className="workspace-card" key={checkIn.id}><div className="card-person"><span className="avatar blue small">{checkIn.user_initials}</span><div><strong>{checkIn.user_name}</strong><span>{checkIn.date}</span></div></div><p><b>Completed</b> {checkIn.completed || 'No update yet'}</p><p><b>Next</b> {checkIn.next_steps || 'No next step recorded'}</p><p><b>Blockers</b> {checkIn.blockers || 'None reported'}</p></article>) : <EmptyState text="No check-ins for today. Start the first update." />}</div>{composerOpen && <WorkspaceComposer type="checkin" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}</section>
  }

  if (active === 'Projects') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action={canManageMembers ? 'New project' : undefined} onAction={() => openComposer('project')} /><div className="project-grid">{localData.projects.length ? localData.projects.map(project => <article className="workspace-card project-card" key={project.id}><div className="project-card-top"><span className="project-icon"><Target size={17} /></span><select className={`project-status ${project.status}`} value={project.status} onChange={event => updateProjectStatus(project, event.target.value)} disabled={!canManageMembers} aria-label={`Change status for ${project.name}`}><option value="planning">Planning</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option></select>{canManageMembers && <><button className="inline-delete" onClick={() => setSelectedProject(project)} aria-label={`Edit ${project.name}`}><MoreHorizontal size={14} /></button><button className="inline-delete" onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`}><X size={14} /></button></>}</div><h3>{project.name}</h3><p>{project.description || 'No project description yet.'}</p><div className="project-footer"><span>{project.due_date ? `Due ${project.due_date}` : 'No due date'}</span><ArrowUpRight size={15} /></div></article>) : <EmptyState text="No projects have been created yet." />}</div>{composerOpen && <WorkspaceComposer type="project" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}{selectedProject && <ProjectEditDrawer project={selectedProject} workspaceId={workspaceId} onClose={() => setSelectedProject(null)} onUpdated={updatedProject => setLocalData(current => ({ ...current, projects: current.projects.map(item => item.id === updatedProject.id ? updatedProject : item) }))} />}</section>
  }

  if (active === 'Chat') {
    const channelMessages = localData.messages.filter(message => message.channel === chatChannel)
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="New message" onAction={() => openComposer('chat')} /><div className="chat-layout"><div className="workspace-card chat-feed">{channelMessages.length ? channelMessages.map(message => <div className={`chat-message ${message.parent_id ? 'chat-reply' : ''}`} key={message.id}><span className="avatar blue small">{message.author_name.slice(0, 2).toUpperCase()}</span><div><div className="chat-message-meta"><strong>{message.author_name}</strong><span>#{message.channel}</span></div><p>{message.message}</p>{!message.parent_id && <button className="chat-reply-button" onClick={() => { setReplyTo(message); openComposer('chat') }}>Reply{message.reply_count ? ` (${message.reply_count})` : ''}</button>}</div></div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>No messages in #{chatChannel}</h2><p>Start a conversation to keep decisions close to the work.</p></div>}</div><aside className="workspace-side-card"><h3>Channels</h3>{['general', 'announcements', 'project-launch'].map(channel => <button className={`channel-row ${chatChannel === channel ? 'active' : ''}`} key={channel} onClick={() => setChatChannel(channel)}><Hash size={15} /> {channel} <span>{localData.messages.filter(message => message.channel === channel).length}</span></button>)}</aside></div>{composerOpen && <WorkspaceComposer type="chat" form={form} setForm={setForm} replyTo={replyTo} error={composerError} submitting={submitting} onClose={() => { setComposerOpen(false); setReplyTo(null) }} onSubmit={submitComposer} />}</section>
  }

  if (active === 'Follow-up') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add follow-up" onAction={() => openComposer('followup')} /><div className="workspace-card follow-up-list">{localData.followUps.length ? localData.followUps.map(followUp => { const linkedTask = tasks.find(task => task.id === followUp.task_id); const canEdit = canManageMembers || followUp.created_by === currentUserId || followUp.assigned_to === currentUserId; return <div className="follow-up-row" key={followUp.id}><span className={`follow-up-status ${followUp.status}`} /> <div><strong>{followUp.note}</strong><span>{followUp.due_date ? `Due ${followUp.due_date}` : 'No due date'}{linkedTask ? ` | ${linkedTask.title}` : ''}{followUp.assigned_to_name ? ` | ${followUp.assigned_to_name}` : ''}</span></div><div className="follow-up-actions">{canEdit && <button type="button" className="secondary-button" onClick={() => setSelectedFollowUp(followUp)}>Edit</button>}<button type="button" className="secondary-button" onClick={() => completeFollowUp(followUp)}>{followUp.status === 'completed' ? 'Reopen' : 'Mark done'}</button></div></div> }) : <EmptyState text="Nothing needs follow-up right now." />}</div>{composerOpen && <WorkspaceComposer type="followup" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} members={localData.members} tasks={tasks} />}{selectedFollowUp && <FollowUpEditDialog followUp={selectedFollowUp} members={localData.members} tasks={tasks} workspaceId={workspaceId} canManageMembers={canManageMembers} currentUserId={currentUserId} onClose={() => setSelectedFollowUp(null)} onUpdated={updatedFollowUp => { setLocalData(current => ({ ...current, followUps: current.followUps.map(item => item.id === updatedFollowUp.id ? updatedFollowUp : item) })); setSelectedFollowUp(null) }} />}</section>
  }

  if (active === 'Team board') {
    return <section className="workspace-view"><WorkspaceViewHeading title="Team board" subtitle={subtitle} action="Invite member" onAction={() => openComposer('invite')} /><div className="workspace-card team-directory"><h3>Workspace members</h3>{localData.members.map(member => <div className="directory-row" key={member.id}><span className="avatar blue small">{[member.first_name, member.last_name].filter(Boolean).map(name => name[0]).join('').slice(0, 2).toUpperCase() || member.email.slice(0, 2).toUpperCase()}</span><div><strong>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</strong><span>{member.email}</span></div>{canManageMembers && member.role !== 'owner' ? <><select className="member-role-select" value={member.role} onChange={event => updateMemberRole(member, event.target.value)} aria-label={`Change role for ${member.email}`}><option value="member">Member</option><option value="manager">Manager</option></select><button className="inline-delete" onClick={() => removeMember(member)} aria-label={`Remove ${member.email}`}><X size={14} /></button></> : <em>{member.role}</em>}</div>)}<h3 className="pending-heading">Pending invitations</h3>{localData.invitations.filter(invitation => invitation.status === "pending").length ? localData.invitations.filter(invitation => invitation.status === "pending").map(invitation => <div className="directory-row" key={invitation.id}><span className="invite-dot" /><div><strong>{invitation.email}</strong><span>Invited as {invitation.role}</span></div><em>{invitation.status}</em>{canManageMembers && <button className="inline-delete" onClick={() => cancelInvitation(invitation)} aria-label={`Cancel invitation for ${invitation.email}`}><X size={14} /></button>}</div>) : <EmptyState text="No pending invitations." />}</div>{composerOpen && <WorkspaceComposer type="invite" form={form} setForm={setForm} error={composerError} submitting={submitting} onClose={() => setComposerOpen(false)} onSubmit={submitComposer} />}</section>
  }

  const filteredTasks = active === 'My tasks' ? tasks.filter(task => task.member === currentUserName || task.member === 'Unassigned') : tasks
  return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add task" onAction={onAddTask} /><div className="workspace-card task-list-view">{active === 'Team board' && <div className="member-summary"><Users size={18} /><strong>{data.members.length || 0} members</strong><span>across this workspace</span></div>}{filteredTasks.length ? filteredTasks.map(task => <TaskCard key={task.id} task={task} onComplete={onComplete} onStatusChange={onStatusChange} onDelete={onDelete} onOpenTask={onOpenTask} canDelete={canManageTasks} />) : <EmptyState text="No tasks match this view yet." />}</div></section>
}

function WorkspaceViewHeading({ title, subtitle, action, onAction }) {
  return <div className="workspace-view-heading"><div><p className="eyebrow">Workspace operations</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{action && <button className="primary-button" onClick={onAction}><Plus size={17} /> {action}</button>}</div>
}

function WorkspaceComposer({ type, form, setForm, replyTo, error, submitting, onClose, onSubmit, members = [], tasks = [] }) {
  const titles = { calendar: 'Add calendar event', project: 'Create project', checkin: 'Daily check-in', chat: 'New team message', followup: 'Add follow-up', invite: 'Invite team member' }
  const update = event => setForm(current => ({ ...current, [event.target.name]: event.target.value }))
  const field = (name, label, placeholder, inputType = 'text') => <label>{label}<input name={name} type={inputType} value={form[name]} onChange={update} placeholder={placeholder} required /></label>
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" onSubmit={onSubmit} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Workspace update</p><h2>{titles[type]}</h2></div><button type="button" className="close-button" onClick={onClose}><X size={18} /></button></div>{type === 'calendar' && <>{field('title', 'Event title', 'Daily planning session')}{field('start_at', 'Starts', '', 'datetime-local')}{field('end_at', 'Ends', '', 'datetime-local')}<label>Reminder<select name="reminder_minutes" value={form.reminder_minutes} onChange={update}><option value="0">At event time</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label></>}{type === 'project' && <>{field('name', 'Project name', 'Website refresh')}<label>Description<textarea name="description" value={form.description} onChange={update} placeholder="What is this project moving forward?" /></label><label>Due date<input name="due_date" type="date" value={form.due_date} onChange={update} /></label></>}{type === 'checkin' && <>{field('date', 'Date', '', 'date')}<label>What did you complete?<textarea name="completed" value={form.completed} onChange={update} required /></label><label>What is next?<textarea name="next_steps" value={form.next_steps} onChange={update} /></label><label>Any blockers?<textarea name="blockers" value={form.blockers} onChange={update} /></label></>}{type === 'chat' && <>{replyTo && <p className="reply-context">Replying to {replyTo.author_name}</p>}<label>Channel<select name="channel" value={form.channel} onChange={update}><option value="general">general</option><option value="announcements">announcements</option><option value="project-launch">project-launch</option></select></label><label>Message<textarea name="message" value={form.message} onChange={update} placeholder="Share an update with the team" required autoFocus /></label></>}{type === 'followup' && <>{field('note', 'Follow-up note', 'Ask for launch approval')}{field('due_date', 'Due date', '', 'date')}<label>Assign to<select name="assigned_to" value={form.assigned_to || ''} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id || ''} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{type === 'invite' && <><label>Email<input name="email" type="email" value={form.email} onChange={update} placeholder="teammate@company.com" required /></label><label>Role<select name="role" value={form.role} onChange={update}><option value="member">Member</option><option value="manager">Manager</option></select></label></>}{error && <p className="auth-error">{error}</p>}<button className="primary-button modal-submit" disabled={submitting}>{submitting ? 'Saving...' : 'Save update'} <ArrowUpRight size={16} /></button></form></div>
}

function CalendarEventEditDialog({ event, workspaceId, onClose, onUpdated }) {
  const [form, setForm] = useState({ title: event.title, description: event.description || '', start_at: toDateTimeLocal(event.start_at), end_at: toDateTimeLocal(event.end_at), event_type: event.event_type, reminder_minutes: event.reminder_minutes })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const update = change => setForm(current => ({ ...current, [change.target.name]: change.target.value }))
  const save = async submitEvent => {
    submitEvent.preventDefault()
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
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" onSubmit={save} onMouseDown={change => change.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Calendar management</p><h2>Edit event</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close calendar event editor"><X size={18} /></button></div><label>Event title<input name="title" value={form.title} onChange={update} maxLength="200" required /></label><label>Description<textarea name="description" value={form.description} onChange={update} maxLength="4000" /></label><div className="modal-grid"><label>Starts<input name="start_at" type="datetime-local" value={form.start_at} onChange={update} required /></label><label>Ends<input name="end_at" type="datetime-local" value={form.end_at} onChange={update} required /></label></div><label>Event type<select name="event_type" value={form.event_type} onChange={update}><option value="meeting">Meeting</option><option value="focus">Focus time</option><option value="deadline">Deadline</option><option value="reminder">Reminder</option></select></label><label>Reminder<select name="reminder_minutes" value={form.reminder_minutes} onChange={update}><option value="0">At event time</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save event'} <ArrowUpRight size={16} /></button></form></div>
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
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal composer-modal" onSubmit={save} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Follow-up management</p><h2>Edit follow-up</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close follow-up editor"><X size={18} /></button></div><label>Follow-up note<textarea name="note" value={form.note} onChange={update} maxLength="500" required disabled={!canEditAssignment} /></label><label>Due date<input name="due_date" type="date" value={form.due_date} onChange={update} disabled={!canEditAssignment} /></label><label>Status<select name="status" value={form.status} onChange={update}><option value="open">Open</option><option value="completed">Completed</option></select></label>{canEditAssignment && <><label>Assign to<select name="assigned_to" value={form.assigned_to} onChange={update}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}</option>)}</select></label><label>Link to task<select name="task_id" value={form.task_id} onChange={update}><option value="">No linked task</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label></>}{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button modal-submit" disabled={saving}>{saving ? 'Saving...' : 'Save follow-up'} <ArrowUpRight size={16} /></button></form></div>
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
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Project details</p><h2>Edit project</h2></div><button type="button" className="close-button" onClick={onClose} aria-label="Close project editor"><X size={18} /></button></div><form className="drawer-task-form" onSubmit={save}><label>Name<input name="name" value={form.name} onChange={update} maxLength="160" required /></label><label>Description<textarea name="description" value={form.description} onChange={update} /></label><label>Due date<input name="due_date" type="date" value={form.due_date} onChange={update} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Save project'}</button></form></aside></div>
}

function EmptyState({ text }) {
  return <div className="empty-workspace"><div className="empty-workspace-icon"><Sparkles size={18} /></div><p>{text}</p></div>
}

function TaskCard({ task, onComplete, onStatusChange, onDelete, onOpenTask, canDelete = true, canEdit = task.can_edit ?? true, draggable = false }) { return <div className={`task-card ${task.status}`} draggable={draggable} onDragStart={event => event.dataTransfer.setData('text/plain', String(task.id))}><button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} disabled={!canEdit} onClick={() => onComplete(task.id)} aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`} aria-disabled={!canEdit}>{task.status === 'done' && <Check size={12} />}</button><div className="task-copy"><button className="task-title-button" onClick={() => onOpenTask(task)}>{task.title}</button><div><select disabled={!canEdit} className={`task-status task-status-select ${task.status}`} value={task.status} onChange={event => onStatusChange(task.id, event.target.value)} aria-label={`Change status for ${task.title}`}><option value="todo">To do</option><option value="in progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="done">Done</option></select><span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span>{canDelete && <button className="task-more-button" onClick={() => onDelete(task.id)} aria-label={`Delete ${task.title}`}><MoreHorizontal size={16} /></button>}</div> }

function TaskDetailDrawer({ task, workspaceId, onClose, onTaskUpdated }) {
  const canEdit = task.can_edit ?? true
  const [comments, setComments] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [attachments, setAttachments] = useState([])
  const [comment, setComment] = useState('')
  const [subtask, setSubtask] = useState('')
  const [labelInput, setLabelInput] = useState((task.labels || []).join(', '))
  const [taskFields, setTaskFields] = useState({ title: task.title, description: task.description || '', status: task.status === 'in progress' ? 'in_progress' : task.status, priority: task.priority || 'normal', due_date: task.due_date || '', recurrence: task.recurrence || 'none' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const request = async (path, options = {}) => fetch(path, { ...options, credentials: 'include', headers: { ...(options.headers || {}), 'X-Workspace-Id': String(workspaceId) } })
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
    const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify(taskFields) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Task details could not be saved.')
    onTaskUpdated(data.task)
  }
  const addComment = async event => {
    event.preventDefault()
    if (!comment.trim()) return
    const response = await request(`/api/tasks/${task.id}/comments/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ body: comment.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Comment could not be added.')
    setComments(current => [...current, data.comment])
    setComment('')
  }
  const addSubtask = async event => {
    event.preventDefault()
    if (!subtask.trim()) return
    const response = await request(`/api/tasks/${task.id}/subtasks/`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ title: subtask.trim() }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be added.')
    setSubtasks(current => [...current, data.subtask])
    setSubtask('')
  }
  const toggleSubtask = async item => {
    const response = await request(`/api/subtasks/${item.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ completed: !item.completed }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Subtask could not be updated.')
    setSubtasks(current => current.map(existing => existing.id === item.id ? data.subtask : existing))
  }
  const saveLabels = async event => {
    event.preventDefault()
    const labels = [...new Set(labelInput.split(',').map(label => label.trim()).filter(Boolean))]
    const response = await request(`/api/tasks/${task.id}/`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken() }, body: JSON.stringify({ labels }) })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Labels could not be saved.')
    setLabelInput((data.task.labels || []).join(', '))
  }
  const uploadAttachment = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    const response = await request(`/api/tasks/${task.id}/attachments/`, { method: 'POST', headers: { 'X-CSRFToken': await getCsrfToken() }, body: formData })
    const data = await response.json()
    if (!response.ok) return setError(data.error || 'Attachment could not be uploaded.')
    setAttachments(current => [data.attachment, ...current])
    event.target.value = ''
  }
  const deleteAttachment = async attachment => {
    const response = await request(`/api/attachments/${attachment.id}/`, { method: 'DELETE', headers: { 'X-CSRFToken': await getCsrfToken() } })
    if (!response.ok) return setError('Attachment could not be deleted.')
    setAttachments(current => current.filter(item => item.id !== attachment.id))
  }
  return <div className="drawer-backdrop" onMouseDown={onClose}><aside className="task-drawer" onMouseDown={event => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">Task details</p><h2>{task.title}</h2><span>{task.member} | {task.due}</span></div><button className="close-button" onClick={onClose} aria-label="Close task details"><X size={18} /></button></div>{error && <p className="auth-error">{error}</p>}{loading ? <p className="drawer-muted">Loading task details...</p> : <><section className="drawer-section"><div className="drawer-section-heading"><h3>Task controls</h3><span>Saved to workspace</span></div><form className="drawer-task-form" onSubmit={saveTaskFields}><label>Title<input name="title" value={taskFields.title} onChange={updateTaskField} disabled={!canEdit} maxLength="200" /></label><label>Description<textarea name="description" value={taskFields.description} onChange={updateTaskField} disabled={!canEdit} maxLength="4000" /></label><label>Status<select name="status" value={taskFields.status} onChange={updateTaskField} disabled={!canEdit}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="review">Review</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label><label>Priority<select name="priority" value={taskFields.priority} onChange={updateTaskField} disabled={!canEdit}><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><label>Due date<input name="due_date" type="date" value={taskFields.due_date} onChange={updateTaskField} disabled={!canEdit} /></label><label>Repeat<select name="recurrence" value={taskFields.recurrence} onChange={updateTaskField} disabled={!canEdit}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button className="secondary-button" disabled={!canEdit}>Save task</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Labels</h3><span>Comma separated</span></div><form className="inline-form" onSubmit={saveLabels}><input value={labelInput} onChange={event => setLabelInput(event.target.value)} placeholder="priority, client, risk" aria-label="Task labels" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Save</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Attachments</h3><span>{attachments.length}</span></div>{attachments.map(attachment => <div className="attachment-row" key={attachment.id}><a href={attachment.file_url} target="_blank" rel="noreferrer">{attachment.original_name}</a>{canEdit && <button className="inline-delete" onClick={() => deleteAttachment(attachment)} aria-label={`Delete ${attachment.original_name}`}><X size={14} /></button>}</div>)}<label className="attachment-upload"><span>Upload file</span><input type="file" onChange={uploadAttachment} /></label></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Subtasks</h3><span>{subtasks.filter(item => item.completed).length} of {subtasks.length}</span></div>{subtasks.map(item => <label className="subtask-row" key={item.id}><input type="checkbox" checked={item.completed} onChange={() => toggleSubtask(item)} disabled={!canEdit} /><span className={item.completed ? 'completed' : ''}>{item.title}</span></label>)}<form className="inline-form" onSubmit={addSubtask}><input value={subtask} onChange={event => setSubtask(event.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" disabled={!canEdit} /><button className="secondary-button" disabled={!canEdit}>Add</button></form></section><section className="drawer-section"><div className="drawer-section-heading"><h3>Comments</h3><span>{comments.length}</span></div>{comments.length ? comments.map(item => <article className="drawer-comment" key={item.id}><strong>{item.author_name}</strong><p>{item.body}</p></article>) : <p className="drawer-muted">No comments yet.</p>}<form className="drawer-comment-form" onSubmit={addComment}><textarea value={comment} onChange={event => setComment(event.target.value)} placeholder="Write an update for the team" aria-label="Write a task comment" /><button className="primary-button">Post comment</button></form></section></>}</aside></div>
}
function Activity({ avatar, color, text, strong, suffix, time }) { return <div className="activity-item"><span className={`avatar small ${color}`}>{avatar}</span><p>{text} <strong>{strong}</strong> {suffix}<span>{time}</span></p></div> }

function AuthScreen({ onAuthenticated, connectionError }) {
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
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to authenticate.')
      onAuthenticated(data.user)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="auth-screen"><div className="auth-panel"><div className="auth-brand"><span className="brand-mark">W</span><span>WorkSpace</span></div><p className="eyebrow">Team operations</p><h1>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1><p className="auth-subtitle">{mode === 'login' ? 'Sign in to see your team pulse and priorities.' : 'Bring your team, tasks, and follow-ups into one calm workspace.'}</p><form onSubmit={submit}>{mode === 'signup' && <><label>First name<input name="first_name" value={form.first_name} onChange={updateField} placeholder="Your first name" required /></label><label>Workspace name<input name="workspace_name" value={form.workspace_name} onChange={updateField} placeholder="Your team or company" required /></label></>}<label>Email<input name="email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" required /></label><label>Password<input name="password" type="password" value={form.password} onChange={updateField} placeholder="At least 8 characters" minLength="8" required /></label>{error && <p className="auth-error">{error}</p>}{connectionError && !error && <p className="auth-error">The API is unavailable. Start Django on port 8000.</p>}<button className="primary-button auth-submit" disabled={submitting}>{submitting ? 'Connecting...' : mode === 'login' ? 'Sign in' : 'Create workspace'}</button></form><button className="auth-switch" onClick={() => { setMode(current => current === 'login' ? 'signup' : 'login'); setError('') }}>{mode === 'login' ? 'New to WorkSpace? Create an account' : 'Already have an account? Sign in'}</button></div></div>
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
