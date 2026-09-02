import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AlertCircle, ArrowUpRight, Bell, CalendarDays, Check, CheckCircle2, ChevronDown,
  CircleHelp, Clock3, Filter, Hash, LayoutDashboard, MessageSquare, MoreHorizontal,
  Plus, Search, Settings, Sparkles, Target, Users, X, Sun, Moon
} from 'lucide-react'
import './styles.css'
import './tijhabooks-theme.css'

const members = [
  { name: 'Sarah Chen', initials: 'SC', color: 'blue', role: 'Design lead' },
  { name: 'James Wilson', initials: 'JW', color: 'blue', role: 'Product' },
  { name: 'Priya Shah', initials: 'PS', color: 'green', role: 'Engineering' },
  { name: 'Marcus Lee', initials: 'ML', color: 'orange', role: 'Marketing' },
]

const initialTasks = [
  { id: 1, title: 'Finalize homepage concepts', member: 'Sarah Chen', tag: 'Website refresh', status: 'in progress', priority: 'high', due: 'Today', estimate: '2h' },
  { id: 2, title: 'Review onboarding flow', member: 'Sarah Chen', tag: 'Product design', status: 'review', priority: 'normal', due: 'Today', estimate: '45m' },
  { id: 3, title: 'Prepare launch checklist', member: 'James Wilson', tag: 'Q3 launch', status: 'in progress', priority: 'high', due: 'Today', estimate: '1h' },
  { id: 4, title: 'Update analytics events', member: 'Priya Shah', tag: 'Q3 launch', status: 'blocked', priority: 'urgent', due: 'Overdue', estimate: '3h' },
  { id: 5, title: 'Draft customer update', member: 'Marcus Lee', tag: 'Communications', status: 'todo', priority: 'normal', due: 'Today', estimate: '1h' },
]

function Avatar({ member, small = false }) {
  return <span className={`avatar ${member.color} ${small ? 'small' : ''}`}>{member.initials}</span>
}

async function getCsrfToken() {
  await fetch('/api/auth/csrf/', { credentials: 'include' })
  const cookie = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))
  return cookie?.split('=')[1] || ''
}

function App() {
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useState(initialTasks)
  const [showModal, setShowModal] = useState(false)
  const [newTask, setNewTask] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('All work')
  const [theme, setTheme] = useState(() => localStorage.getItem('workspace-theme') || 'dark')
  const [session, setSession] = useState({ loading: true, user: null, error: '' })
  const [workspaceData, setWorkspaceData] = useState({ members: [], projects: [], events: [], checkIns: [], messages: [], followUps: [] })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('workspace-theme', theme)
  }, [theme])

  useEffect(() => {
    fetch('/api/auth/me/', { credentials: 'include' })
      .then(response => response.json())
      .then(data => setSession({ loading: false, user: data.user || null, error: '' }))
      .catch(error => setSession({ loading: false, user: null, error: error.message }))
  }, [])

  useEffect(() => {
    if (!session.user) return undefined
    let isCurrent = true
    const workspaceId = session.user.workspaces[0]?.id
    if (!workspaceId) return undefined

    const read = path => fetch(path, { credentials: 'include', headers: { 'X-Workspace-Id': String(workspaceId) } }).then(response => {
      if (!response.ok) throw new Error(`${path} returned ${response.status}`)
      return response.json()
    })

    Promise.all([
      read('/api/tasks/'),
      read(`/api/workspaces/${workspaceId}/members/`),
      read(`/api/workspaces/${workspaceId}/projects/`),
      read(`/api/workspaces/${workspaceId}/calendar-events/`),
      read(`/api/workspaces/${workspaceId}/check-ins/?date=2026-09-02`),
      read(`/api/workspaces/${workspaceId}/chat-messages/`),
      read(`/api/workspaces/${workspaceId}/follow-ups/`),
    ])
      .then(([taskData, memberData, projectData, eventData, checkInData, messageData, followUpData]) => {
        if (!isCurrent) return
        if (taskData.tasks.length > 0) {
          setTasks(taskData.tasks.map(task => ({
            id: task.id,
            title: task.title,
            member: task.assignee_name || 'Unassigned',
            tag: task.project || 'General',
            status: task.status === 'in_progress' ? 'in progress' : task.status,
            priority: 'normal',
            due: task.due_date || 'No due date',
            estimate: 'n/a',
          })))
        }
        setWorkspaceData({ members: memberData.members, projects: projectData.projects, events: eventData.events, checkIns: checkInData.check_ins, messages: messageData.messages, followUps: followUpData.follow_ups })
      })
      .catch(error => console.warn('Workspace data could not be loaded.', error.message))

    return () => {
      isCurrent = false
    }
  }, [session.user])

  const visibleTasks = useMemo(() => selectedFilter === 'All work' ? tasks : tasks.filter(task => task.status === selectedFilter), [tasks, selectedFilter])
  if (session.loading) return <div className="auth-loading">Loading WorkSpace...</div>
  if (!session.user) return <AuthScreen onAuthenticated={user => setSession({ loading: false, user, error: '' })} connectionError={session.error} />
  const completeTask = async id => {
    setTasks(current => current.map(task => task.id === id ? { ...task, status: 'done' } : task))
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(session.user.workspaces[0]?.id || '') },
        body: JSON.stringify({ status: 'done' }),
      })
      if (!response.ok && response.status !== 404) throw new Error(`Task update returned ${response.status}`)
    } catch (error) {
      console.warn('Task status could not be saved.', error.message)
    }
  }
  const addTask = async event => {
    event.preventDefault()
    if (!newTask.trim()) return
    try {
      const response = await fetch('/api/tasks/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': await getCsrfToken(), 'X-Workspace-Id': String(session.user.workspaces[0]?.id || '') },
        body: JSON.stringify({ title: newTask.trim(), assignee_name: 'Sarah Chen', project: 'New task' }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Task creation returned ${response.status}`)
      setTasks(current => [...current, { id: data.task.id, title: data.task.title, member: data.task.assignee_name || 'Unassigned', tag: data.task.project || 'General', status: 'todo', priority: 'normal', due: 'Today', estimate: 'n/a' }])
      setNewTask('')
      setShowModal(false)
    } catch (error) {
      console.error('Task could not be created.', error.message)
    }
  }

  const navItems = [
    { label: 'Today', icon: LayoutDashboard }, { label: 'My tasks', icon: CheckCircle2 },
    { label: 'Team board', icon: Users }, { label: 'Calendar', icon: CalendarDays },
    { label: 'Projects', icon: Target }, { label: 'Chat', icon: MessageSquare },
  ]
  const workspaceId = session.user.workspaces[0]?.id

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">W</div><span>WorkSpace</span></div>
      <button className="workspace-switcher"><span className="workspace-dot" />Northstar Studio <ChevronDown size={14} /></button>
      <nav className="main-nav">
        <p className="nav-label">Workspace</p>
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}><Icon size={18} /><span>{label}</span>{label === 'Chat' && <span className="nav-badge">4</span>}</button>)}
        <p className="nav-label space-top">Manage</p>
        <button className={`nav-item ${active === 'Follow-up' ? 'active' : ''}`} onClick={() => setActive('Follow-up')}><Bell size={18} /><span>Follow-up</span><span className="nav-badge alert">6</span></button>
        <button className={`nav-item ${active === 'Check-ins' ? 'active' : ''}`} onClick={() => setActive('Check-ins')}><Hash size={18} /><span>Check-ins</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><Sparkles size={16} /><div><strong>Make your week flow</strong><span>Set your priorities</span></div><ArrowUpRight size={15} /></div><button className="nav-item"><Settings size={18} /><span>Settings</span></button><div className="profile"><div className="avatar navy">KO</div><div><strong>King Odysseus</strong><span>Admin</span></div><MoreHorizontal size={17} /></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><button className="icon-button"><Search size={18} /></button><button className="icon-button notification"><Bell size={18} /><i /></button><button className="theme-toggle" onClick={() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="help-button"><CircleHelp size={17} /> Help</button><button className="user-avatar">KO</button></div></header>
      <div className="page-content">
        {active !== 'Today' && <WorkspaceView active={active} data={workspaceData} tasks={tasks} workspaceId={workspaceId} />}
        {active === 'Today' && <>
        <section className="page-heading"><div><p className="eyebrow">Tuesday, September 2, 2026</p><h1>Good morning, King</h1><p className="subtitle">Here is what is moving across Northstar today.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Add task</button></section>
        <section className="metrics"><div className="metric-card"><div className="metric-icon navy-bg"><CheckCircle2 size={18} /></div><div><span>Team completion</span><strong>68%</strong></div><em className="positive">+12% <small>vs last week</small></em></div><div className="metric-card"><div className="metric-icon orange-bg"><AlertCircle size={18} /></div><div><span>Needs attention</span><strong>6 tasks</strong></div><em className="negative">2 overdue</em></div><div className="metric-card"><div className="metric-icon teal-bg"><Clock3 size={18} /></div><div><span>Focus time</span><strong>24h 30m</strong></div><em>this week</em></div></section>
        <div className="content-grid">
          <section className="board-section"><div className="section-header"><div><h2>Team pulse</h2><p>Today's commitments across your team</p></div><div className="header-actions"><button className="filter-button"><Filter size={15} /> Filters <ChevronDown size={14} /></button><button className="more-button"><MoreHorizontal size={19} /></button></div></div><div className="board-tabs"><button className="tab active">People</button><button className="tab">Status</button><button className="tab">Priority</button><div className="filter-select"><span className="status-dot all" />{selectedFilter}<ChevronDown size={14} /></div></div><div className="team-board">{members.map(member => { const memberTasks = visibleTasks.filter(task => task.member === member.name); return <div className="member-row" key={member.name}><div className="member-cell"><Avatar member={member} /><div><strong>{member.name}</strong><span>{member.role}</span></div></div><div className="task-stack">{memberTasks.length ? memberTasks.map(task => <TaskCard key={task.id} task={task} onComplete={completeTask} />) : <div className="empty-task">No tasks in this view</div>}</div><button className="row-add"><Plus size={16} /></button></div> })}</div><button className="add-person"><Plus size={16} /> Add team member</button></section>
          <aside className="right-column"><section className="focus-card"><div className="section-header"><div><h2>My focus</h2><p>Your personal priorities</p></div><button className="more-button"><MoreHorizontal size={19} /></button></div><div className="focus-progress"><div><strong>4 of 6</strong><span>tasks completed</span></div><div className="progress-ring"><span>67%</span></div></div><div className="focus-list"><div className="focus-item done"><span className="check checked"><Check size={13} /></span><div><strong>Review team priorities</strong><span>Completed 9:12 AM</span></div></div><div className="focus-item"><span className="check" /><div><strong>Finalize homepage concepts</strong><span>Due today - 2h</span></div><span className="priority-dot high" /></div><div className="focus-item"><span className="check" /><div><strong>Schedule launch sync</strong><span>Due today - 30m</span></div></div></div><button className="text-button">View all my tasks <ArrowUpRight size={15} /></button></section><section className="checkin-card"><div className="checkin-heading"><div className="checkin-icon"><MessageSquare size={17} /></div><div><h3>Daily check-in</h3><p>Share a quick update with the team</p></div></div><div className="checkin-questions"><span><i />What did you complete?</span><span><i />What's next?</span><span><i />Any blockers?</span></div><button className="secondary-button"><Plus size={16} /> Start check-in</button></section><section className="activity-card"><div className="section-header"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><button className="more-button"><MoreHorizontal size={19} /></button></div><div className="activity-list"><Activity avatar="PS" color="green" text="Priya marked" strong="API integration" suffix="as blocked" time="8m ago" /><Activity avatar="JW" color="blue" text="James completed" strong="Campaign brief" suffix="" time="24m ago" /><Activity avatar="SC" color="blue" text="Sarah commented on" strong="Homepage concepts" suffix="" time="1h ago" /></div></section></aside>
        </div>
        </>}
      </div>
    </main>
    {showModal && <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}><form className="modal" onSubmit={addTask} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Quick capture</p><h2>Add a task</h2></div><button type="button" className="close-button" onClick={() => setShowModal(false)}><X size={18} /></button></div><label>Task name<input autoFocus value={newTask} onChange={event => setNewTask(event.target.value)} placeholder="What needs to happen?" /></label><div className="modal-grid"><label>Assign to<select><option>Sarah Chen</option><option>James Wilson</option><option>Priya Shah</option></select></label><label>Due date<select><option>Today</option><option>Tomorrow</option><option>This week</option></select></label></div><button className="primary-button modal-submit">Create task <ArrowUpRight size={16} /></button></form></div>}
  </div>
}

function WorkspaceView({ active, data, tasks }) {
  const title = active === 'My tasks' ? 'My tasks' : active
  const subtitle = {
    'My tasks': 'Your personal work, deadlines, and follow-ups.',
    'Team board': 'See ownership and progress across the workspace.',
    Calendar: 'Meetings, focus time, and deadlines in one view.',
    Projects: 'Keep initiatives, milestones, and ownership visible.',
    Chat: 'Keep decisions and team conversations close to the work.',
    'Follow-up': 'A clear queue for work that needs a response.',
    'Check-ins': 'Daily updates that keep the team aligned.',
  }[active]

  if (active === 'Calendar') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add event" /><div className="calendar-layout"><div className="calendar-week"><div className="calendar-toolbar"><strong>September 2026</strong><span>Today</span></div>{['Monday 31', 'Tuesday 1', 'Wednesday 2', 'Thursday 3', 'Friday 4'].map(day => <div className="calendar-day" key={day}><strong>{day}</strong><div className="calendar-slot">{data.events.filter(event => event.start_at.startsWith('2026-09-02') && day.startsWith('Wednesday')).map(event => <div className="event-pill" key={event.id}><span>{event.start_at.slice(11, 16)}</span>{event.title}</div>)}</div></div>)}</div><aside className="workspace-side-card"><h3>Upcoming</h3>{data.events.length ? data.events.map(event => <div className="compact-row" key={event.id}><CalendarDays size={15} /><div><strong>{event.title}</strong><span>{event.start_at.replace('T', ' ').slice(0, 16)}</span></div></div>) : <EmptyState text="No events scheduled yet." />}</aside></div></section>
  }

  if (active === 'Check-ins') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Start check-in" /><div className="checkin-grid">{data.checkIns.length ? data.checkIns.map(checkIn => <article className="workspace-card" key={checkIn.id}><div className="card-person"><span className="avatar blue small">{checkIn.user_id === 1 ? 'KO' : 'TM'}</span><div><strong>Team member</strong><span>{checkIn.date}</span></div></div><p><b>Completed</b> {checkIn.completed || 'No update yet'}</p><p><b>Next</b> {checkIn.next_steps || 'No next step recorded'}</p><p><b>Blockers</b> {checkIn.blockers || 'None reported'}</p></article>) : <EmptyState text="No check-ins for today. Start the first update." />}</div></section>
  }

  if (active === 'Projects') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="New project" /><div className="project-grid">{data.projects.length ? data.projects.map(project => <article className="workspace-card project-card" key={project.id}><div className="project-card-top"><span className="project-icon"><Target size={17} /></span><span className={`project-status ${project.status}`}>{project.status}</span></div><h3>{project.name}</h3><p>{project.description || 'No project description yet.'}</p><div className="project-footer"><span>Workspace project</span><ArrowUpRight size={15} /></div></article>) : <EmptyState text="No projects have been created yet." />}</div></section>
  }

  if (active === 'Chat') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="New message" /><div className="chat-layout"><div className="workspace-card chat-feed">{data.messages.length ? data.messages.map(message => <div className="chat-message" key={message.id}><span className="avatar blue small">{message.author_name.slice(0, 2).toUpperCase()}</span><div><div className="chat-message-meta"><strong>{message.author_name}</strong><span>#{message.channel}</span></div><p>{message.message}</p></div></div>) : <div className="chat-placeholder"><div className="chat-placeholder-icon"><MessageSquare size={22} /></div><h2>No messages yet</h2><p>Start a conversation to keep decisions close to the work.</p></div>}</div><aside className="workspace-side-card"><h3>Channels</h3><div className="channel-row active"><Hash size={15} /> general <span>{data.messages.length}</span></div><div className="channel-row"><Hash size={15} /> announcements</div><div className="channel-row"><Hash size={15} /> project-launch</div></aside></div></section>
  }

  if (active === 'Follow-up') {
    return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add follow-up" /><div className="workspace-card follow-up-list">{data.followUps.length ? data.followUps.map(followUp => <div className="follow-up-row" key={followUp.id}><span className={`follow-up-status ${followUp.status}`} /> <div><strong>{followUp.note}</strong><span>{followUp.due_date ? `Due ${followUp.due_date}` : 'No due date'}{followUp.task_id ? ` | Task ${followUp.task_id}` : ''}</span></div><button className="secondary-button">{followUp.status === 'completed' ? 'Completed' : 'Mark done'}</button></div>) : <EmptyState text="Nothing needs follow-up right now." />}</div></section>
  }

  const filteredTasks = active === 'My tasks' ? tasks.filter(task => task.member === 'King Odysseus' || task.member === 'Unassigned') : tasks
  return <section className="workspace-view"><WorkspaceViewHeading title={title} subtitle={subtitle} action="Add task" /><div className="workspace-card task-list-view">{active === 'Team board' && <div className="member-summary"><Users size={18} /><strong>{data.members.length || 0} members</strong><span>across this workspace</span></div>}{filteredTasks.length ? filteredTasks.map(task => <TaskCard key={task.id} task={task} onComplete={() => undefined} />) : <EmptyState text="No tasks match this view yet." />}</div></section>
}

function WorkspaceViewHeading({ title, subtitle, action }) {
  return <div className="workspace-view-heading"><div><p className="eyebrow">Workspace operations</p><h1>{title}</h1><p className="subtitle">{subtitle}</p></div><button className="primary-button"><Plus size={17} /> {action}</button></div>
}

function EmptyState({ text }) {
  return <div className="empty-workspace"><div className="empty-workspace-icon"><Sparkles size={18} /></div><p>{text}</p></div>
}

function TaskCard({ task, onComplete }) { const statusLabel = task.status === 'in progress' ? 'In progress' : task.status === 'todo' ? 'To do' : task.status === 'review' ? 'Review' : task.status === 'blocked' ? 'Blocked' : 'Done'; return <div className={`task-card ${task.status}`}><button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => onComplete(task.id)}>{task.status === 'done' && <Check size={12} />}</button><div className="task-copy"><strong>{task.title}</strong><div><span className={`task-status ${task.status}`}>{statusLabel}</span><span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span><MoreHorizontal size={16} className="task-more" /></div> }
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

createRoot(document.getElementById('root')).render(<App />)
