import { useEffect, useMemo, useState } from 'react'
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

function App() {
  const [active, setActive] = useState('Today')
  const [tasks, setTasks] = useState(initialTasks)
  const [showModal, setShowModal] = useState(false)
  const [newTask, setNewTask] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('All work')
  const [theme, setTheme] = useState(() => localStorage.getItem('workspace-theme') || 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('workspace-theme', theme)
  }, [theme])

  const visibleTasks = useMemo(() => selectedFilter === 'All work' ? tasks : tasks.filter(task => task.status === selectedFilter), [tasks, selectedFilter])
  const completeTask = (id) => setTasks(current => current.map(task => task.id === id ? { ...task, status: 'done' } : task))
  const addTask = (event) => {
    event.preventDefault()
    if (!newTask.trim()) return
    setTasks(current => [...current, { id: Date.now(), title: newTask, member: 'Sarah Chen', tag: 'New task', status: 'todo', priority: 'normal', due: 'Today', estimate: 'n/a' }])
    setNewTask('')
    setShowModal(false)
  }

  const navItems = [
    { label: 'Today', icon: LayoutDashboard }, { label: 'My tasks', icon: CheckCircle2 },
    { label: 'Team board', icon: Users }, { label: 'Calendar', icon: CalendarDays },
    { label: 'Projects', icon: Target }, { label: 'Chat', icon: MessageSquare },
  ]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">W</div><span>WorkSpace</span></div>
      <button className="workspace-switcher"><span className="workspace-dot" />Northstar Studio <ChevronDown size={14} /></button>
      <nav className="main-nav">
        <p className="nav-label">Workspace</p>
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}><Icon size={18} /><span>{label}</span>{label === 'Chat' && <span className="nav-badge">4</span>}</button>)}
        <p className="nav-label space-top">Manage</p>
        <button className="nav-item"><Bell size={18} /><span>Follow-up</span><span className="nav-badge alert">6</span></button>
        <button className="nav-item"><Hash size={18} /><span>Check-ins</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="upgrade-card"><Sparkles size={16} /><div><strong>Make your week flow</strong><span>Set your priorities</span></div><ArrowUpRight size={15} /></div><button className="nav-item"><Settings size={18} /><span>Settings</span></button><div className="profile"><div className="avatar navy">KO</div><div><strong>King Odysseus</strong><span>Admin</span></div><MoreHorizontal size={17} /></div></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><button className="icon-button"><Search size={18} /></button><button className="icon-button notification"><Bell size={18} /><i /></button><button className="theme-toggle" onClick={() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button><button className="help-button"><CircleHelp size={17} /> Help</button><button className="user-avatar">KO</button></div></header>
      <div className="page-content">
        <section className="page-heading"><div><p className="eyebrow">Tuesday, September 2, 2026</p><h1>Good morning, King</h1><p className="subtitle">Here is what is moving across Northstar today.</p></div><button className="primary-button" onClick={() => setShowModal(true)}><Plus size={18} /> Add task</button></section>
        <section className="metrics"><div className="metric-card"><div className="metric-icon navy-bg"><CheckCircle2 size={18} /></div><div><span>Team completion</span><strong>68%</strong></div><em className="positive">+12% <small>vs last week</small></em></div><div className="metric-card"><div className="metric-icon orange-bg"><AlertCircle size={18} /></div><div><span>Needs attention</span><strong>6 tasks</strong></div><em className="negative">2 overdue</em></div><div className="metric-card"><div className="metric-icon teal-bg"><Clock3 size={18} /></div><div><span>Focus time</span><strong>24h 30m</strong></div><em>this week</em></div></section>
        <div className="content-grid">
          <section className="board-section"><div className="section-header"><div><h2>Team pulse</h2><p>Today's commitments across your team</p></div><div className="header-actions"><button className="filter-button"><Filter size={15} /> Filters <ChevronDown size={14} /></button><button className="more-button"><MoreHorizontal size={19} /></button></div></div><div className="board-tabs"><button className="tab active">People</button><button className="tab">Status</button><button className="tab">Priority</button><div className="filter-select"><span className="status-dot all" />{selectedFilter}<ChevronDown size={14} /></div></div><div className="team-board">{members.map(member => { const memberTasks = visibleTasks.filter(task => task.member === member.name); return <div className="member-row" key={member.name}><div className="member-cell"><Avatar member={member} /><div><strong>{member.name}</strong><span>{member.role}</span></div></div><div className="task-stack">{memberTasks.length ? memberTasks.map(task => <TaskCard key={task.id} task={task} onComplete={completeTask} />) : <div className="empty-task">No tasks in this view</div>}</div><button className="row-add"><Plus size={16} /></button></div> })}</div><button className="add-person"><Plus size={16} /> Add team member</button></section>
          <aside className="right-column"><section className="focus-card"><div className="section-header"><div><h2>My focus</h2><p>Your personal priorities</p></div><button className="more-button"><MoreHorizontal size={19} /></button></div><div className="focus-progress"><div><strong>4 of 6</strong><span>tasks completed</span></div><div className="progress-ring"><span>67%</span></div></div><div className="focus-list"><div className="focus-item done"><span className="check checked"><Check size={13} /></span><div><strong>Review team priorities</strong><span>Completed 9:12 AM</span></div></div><div className="focus-item"><span className="check" /><div><strong>Finalize homepage concepts</strong><span>Due today - 2h</span></div><span className="priority-dot high" /></div><div className="focus-item"><span className="check" /><div><strong>Schedule launch sync</strong><span>Due today - 30m</span></div></div></div><button className="text-button">View all my tasks <ArrowUpRight size={15} /></button></section><section className="checkin-card"><div className="checkin-heading"><div className="checkin-icon"><MessageSquare size={17} /></div><div><h3>Daily check-in</h3><p>Share a quick update with the team</p></div></div><div className="checkin-questions"><span><i />What did you complete?</span><span><i />What's next?</span><span><i />Any blockers?</span></div><button className="secondary-button"><Plus size={16} /> Start check-in</button></section><section className="activity-card"><div className="section-header"><div><h2>Recent activity</h2><p>Updates from your workspace</p></div><button className="more-button"><MoreHorizontal size={19} /></button></div><div className="activity-list"><Activity avatar="PS" color="green" text="Priya marked" strong="API integration" suffix="as blocked" time="8m ago" /><Activity avatar="JW" color="blue" text="James completed" strong="Campaign brief" suffix="" time="24m ago" /><Activity avatar="SC" color="blue" text="Sarah commented on" strong="Homepage concepts" suffix="" time="1h ago" /></div></section></aside>
        </div>
      </div>
    </main>
    {showModal && <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}><form className="modal" onSubmit={addTask} onMouseDown={event => event.stopPropagation()}><div className="modal-heading"><div><p className="eyebrow">Quick capture</p><h2>Add a task</h2></div><button type="button" className="close-button" onClick={() => setShowModal(false)}><X size={18} /></button></div><label>Task name<input autoFocus value={newTask} onChange={event => setNewTask(event.target.value)} placeholder="What needs to happen?" /></label><div className="modal-grid"><label>Assign to<select><option>Sarah Chen</option><option>James Wilson</option><option>Priya Shah</option></select></label><label>Due date<select><option>Today</option><option>Tomorrow</option><option>This week</option></select></label></div><button className="primary-button modal-submit">Create task <ArrowUpRight size={16} /></button></form></div>}
  </div>
}

function TaskCard({ task, onComplete }) { const statusLabel = task.status === 'in progress' ? 'In progress' : task.status === 'todo' ? 'To do' : task.status === 'review' ? 'Review' : task.status === 'blocked' ? 'Blocked' : 'Done'; return <div className={`task-card ${task.status}`}><button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => onComplete(task.id)}>{task.status === 'done' && <Check size={12} />}</button><div className="task-copy"><strong>{task.title}</strong><div><span className={`task-status ${task.status}`}>{statusLabel}</span><span className="task-tag">{task.tag}</span></div></div><span className={`due ${task.due === 'Overdue' ? 'overdue' : ''}`}>{task.due}</span><span className="estimate">{task.estimate}</span><MoreHorizontal size={16} className="task-more" /></div> }
function Activity({ avatar, color, text, strong, suffix, time }) { return <div className="activity-item"><span className={`avatar small ${color}`}>{avatar}</span><p>{text} <strong>{strong}</strong> {suffix}<span>{time}</span></p></div> }

export default App

createRoot(document.getElementById('root')).render(<App />)
