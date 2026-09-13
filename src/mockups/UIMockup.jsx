import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUpRight,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  FolderKanban,
  Hash,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Menu,
  MessageSquare,
  Mic,
  Minus,
  MoreHorizontal,
  Moon,
  Paperclip,
  PanelRight,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  Sun,
  ThumbsUp,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react'
import './ui-mockup.css'

const conversations = [
  { id: 'design', name: 'Design system', preview: 'Maya: Composer spacing is much better', time: '10:42', unread: 3, tone: 'blue' },
  { id: 'launch', name: 'Launch room', preview: 'Noah: QA is clear for Thursday', time: '09:54', unread: 1, tone: 'gold' },
  { id: 'product', name: 'Product team', preview: 'You: I added the review notes', time: 'Yesterday', unread: 0, tone: 'green' },
  { id: 'client', name: 'Northstar client', preview: 'Amelia: Shared the final brief', time: 'Yesterday', unread: 0, tone: 'rose' },
  { id: 'operations', name: 'Operations', preview: 'Kai: The schedule is published', time: 'Mon', unread: 0, tone: 'violet' },
]

const initialMessages = [
  {
    id: 1,
    author: 'Nadia Khan',
    initials: 'NK',
    time: '09:18',
    text: 'The new workspace shell is feeling much cleaner. I moved the conversation into one open surface, so messages read like a thread instead of a stack of cards.',
    tone: 'blue',
  },
  {
    id: 2,
    author: 'Noah Williams',
    initials: 'NW',
    time: '09:24',
    text: 'I like it. The composer feels anchored, and the header keeps the channel context visible without taking over the page.',
    tone: 'gold',
    attachment: { name: 'workspace-ui-review.fig', label: 'Figma file', size: '2.4 MB' },
  },
  {
    id: 3,
    author: 'You',
    initials: 'YO',
    time: '09:31',
    text: "Let's keep the thread light, but bring the AI update in as a bottom status when the panel is minimised.",
    mine: true,
    tone: 'navy',
  },
  {
    id: 4,
    author: 'Maya Chen',
    initials: 'MC',
    time: '09:42',
    text: 'That works. The depth now comes from the shell and the page hierarchy, not from boxing every individual message.',
    tone: 'green',
    reactionCount: 4,
  },
]

const stats = [
  { label: 'Active projects', value: '8', detail: '2 due this week', icon: FolderKanban, tone: 'blue' },
  { label: 'Open tasks', value: '24', detail: '6 assigned to you', icon: ListChecks, tone: 'gold' },
  { label: 'Team online', value: '9/14', detail: '3 in this conversation', icon: Users, tone: 'green' },
  { label: 'Needs attention', value: '3', detail: '1 high priority', icon: ArrowUpRight, tone: 'rose' },
]

const navSections = [
  {
    label: 'Workspace',
    items: [
      { label: 'Today', icon: LayoutDashboard },
      { label: 'My tasks', icon: CheckSquare },
      { label: 'Planner', icon: CalendarDays },
      { label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    label: 'Collaboration',
    items: [
      { label: 'Team chat', icon: MessageSquare, active: true, badge: '4' },
      { label: 'Team', icon: Users },
      { label: 'Activity', icon: Inbox },
      { label: 'Reports', icon: BarChart3 },
    ],
  },
]

function Avatar({ initials, tone = 'blue', size = 'md' }) {
  return <span className={`avatar avatar-${tone} avatar-${size}`}>{initials}</span>
}

function IconButton({ label, children, className = '', onClick, active = false }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark"><img src="/tijha-logo.png" alt="" /></div>
        <div className="brand-copy">
          <strong>WorkSpace</strong>
          <span>Team operations</span>
        </div>
      </div>

      <button type="button" className="workspace-switcher">
        <span className="workspace-avatar">NS</span>
        <span>
          <strong>Northstar Studio</strong>
          <small>14 members</small>
        </span>
        <ChevronDown size={15} />
      </button>

      <nav className="side-nav" aria-label="Primary navigation">
        {navSections.map((section) => (
          <div className="nav-section" key={section.label}>
            <span className="nav-section-label">{section.label}</span>
            {section.items.map((item) => {
              const Icon = item.icon
              return (
                <button type="button" className={`nav-item ${item.active ? 'active' : ''}`} key={item.label}>
                  <Icon size={17} strokeWidth={1.9} />
                  <span>{item.label}</span>
                  {item.badge && <em>{item.badge}</em>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="nav-item"><CircleHelp size={17} /><span>Help and support</span></button>
        <button type="button" className="nav-item"><Settings size={17} /><span>Settings</span></button>
        <div className="profile-row">
          <Avatar initials="YO" tone="navy" />
          <span><strong>Yemi Okafor</strong><small>Workspace admin</small></span>
          <MoreHorizontal size={17} />
        </div>
      </div>
    </aside>
  )
}

function StatCard({ stat }) {
  const Icon = stat.icon
  return (
    <article className="stat-card">
      <div className={`stat-icon tone-${stat.tone}`}><Icon size={18} /></div>
      <div className="stat-copy">
        <span>{stat.label}</span>
        <strong>{stat.value}</strong>
        <small>{stat.detail}</small>
      </div>
    </article>
  )
}

function ConversationItem({ conversation, active, onSelect }) {
  return (
    <button type="button" className={`conversation-item ${active ? 'active' : ''}`} onClick={onSelect}>
      <Avatar initials={conversation.name.slice(0, 2).toUpperCase()} tone={conversation.tone} />
      <span className="conversation-copy">
        <span className="conversation-heading">
          <strong>{conversation.name}</strong>
          <time>{conversation.time}</time>
        </span>
        <span className="conversation-preview">{conversation.preview}</span>
      </span>
      {conversation.unread > 0 && <em className="unread-count">{conversation.unread}</em>}
    </button>
  )
}

function MessageRow({ message }) {
  return (
    <article className={`message-row ${message.mine ? 'is-mine' : ''}`}>
      <Avatar initials={message.initials} tone={message.tone} />
      <div className="message-body">
        <header className="message-meta">
          <strong>{message.author}</strong>
          <time>{message.time}</time>
          {message.mine && <span className="edited-label">Edited</span>}
        </header>
        <p>{message.text}</p>
        {message.attachment && (
          <button type="button" className="attachment-row">
            <span className="attachment-icon"><Paperclip size={15} /></span>
            <span className="attachment-copy">
              <strong>{message.attachment.name}</strong>
              <small>{message.attachment.label} - {message.attachment.size}</small>
            </span>
            <Upload size={15} />
          </button>
        )}
        <div className="message-actions">
          <button type="button"><ThumbsUp size={14} /> {message.reactionCount || 'React'}</button>
          <button type="button"><MessageSquare size={14} /> Reply</button>
          <button type="button"><MoreHorizontal size={15} /></button>
        </div>
      </div>
    </article>
  )
}

function ContextPane({ onClose }) {
  return (
    <aside className="context-pane">
      <header className="context-heading">
        <strong>Conversation details</strong>
        <IconButton label="Close details" onClick={onClose}><X size={17} /></IconButton>
      </header>

      <section className="context-section">
        <span className="context-label">Project pulse</span>
        <div className="pulse-heading">
          <div><strong>Northstar redesign</strong><span>On track</span></div>
          <em>72%</em>
        </div>
        <div className="progress-track"><span style={{ width: '72%' }} /></div>
        <div className="pulse-stats">
          <span><strong>18</strong> tasks</span>
          <span><strong>6</strong> done</span>
          <span><strong>3</strong> blocked</span>
        </div>
      </section>

      <section className="context-section">
        <span className="context-label">In this conversation</span>
        <div className="member-list">
          <div><Avatar initials="NK" tone="blue" /><span><strong>Nadia Khan</strong><small>Product designer</small></span><i className="presence online" /></div>
          <div><Avatar initials="NW" tone="gold" /><span><strong>Noah Williams</strong><small>Engineering lead</small></span><i className="presence online" /></div>
          <div><Avatar initials="MC" tone="green" /><span><strong>Maya Chen</strong><small>Project manager</small></span><i className="presence away" /></div>
        </div>
      </section>

      <section className="context-section">
        <span className="context-label">Shared in this chat</span>
        <button type="button" className="shared-row">
          <span className="shared-icon"><FolderKanban size={16} /></span>
          <span><strong>Launch checklist</strong><small>Updated 18 minutes ago</small></span>
          <ArrowUpRight size={14} />
        </button>
        <button type="button" className="shared-row">
          <span className="shared-icon"><MessageSquare size={16} /></span>
          <span><strong>Review notes</strong><small>8 comments</small></span>
          <ArrowUpRight size={14} />
        </button>
      </section>
    </aside>
  )
}

function MinimizedAiToast({ onOpen }) {
  return (
    <div className="ai-toast" role="status" aria-live="polite">
      <span className="ai-toast-icon"><Sparkles size={17} /></span>
      <span className="ai-toast-copy">
        <strong>Zuri updated the project brief</strong>
        <small>Edited just now</small>
      </span>
      <button type="button" onClick={onOpen}>Open</button>
    </div>
  )
}

function AiPanel({ onMinimize, onHide }) {
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState([
    { role: 'user', text: 'Update the project summary with the design review notes.' },
    { role: 'assistant', text: 'I updated the summary and highlighted the two product decisions that still need sign-off.', edited: true },
  ])

  function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setTurns((current) => [...current, { role: 'user', text }])
    setDraft('')
  }

  return (
    <section className="ai-panel" aria-label="Zuri AI assistant">
      <header className="ai-panel-header">
        <span className="ai-identity">
          <span className="ai-identity-icon"><Bot size={19} /></span>
          <span><strong>Zuri</strong><small>Workspace assistant</small></span>
        </span>
        <div className="ai-panel-actions">
          <IconButton label="Minimize Zuri" onClick={onMinimize}><Minus size={17} /></IconButton>
          <IconButton label="Hide Zuri" onClick={onHide}><X size={17} /></IconButton>
        </div>
      </header>

      <div className="ai-messages">
        {turns.map((turn, index) => (
          <article className={`ai-message ai-message-${turn.role}`} key={`${turn.role}-${index}`}>
            <span>{turn.role === 'assistant' ? 'Zuri' : 'You'}</span>
            <p>{turn.text}</p>
            {turn.edited && <small>Edited just now</small>}
          </article>
        ))}
      </div>

      <form className="ai-composer" onSubmit={submit}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask Zuri about this workspace" aria-label="Message Zuri" />
        <div>
          <IconButton label="Attach a file"><Paperclip size={17} /></IconButton>
          <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /></button>
        </div>
      </form>
    </section>
  )
}

function App() {
  const [theme, setTheme] = useState('light')
  const [activeConversation, setActiveConversation] = useState('design')
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [aiMode, setAiMode] = useState('minimized')
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const messageScrollRef = useRef(null)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const scroller = messageScrollRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messages])

  const selected = conversations.find((conversation) => conversation.id === activeConversation) || conversations[0]

  function sendMessage(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [
      ...current,
      { id: Date.now(), author: 'You', initials: 'YO', time: 'Now', text, mine: true, tone: 'navy' },
    ])
    setDraft('')
  }

  return (
    <div className="app-shell">
      <Sidebar />

      <main className="main-shell">
        <header className="topbar">
          <IconButton label="Open navigation" className="mobile-menu"><Menu size={19} /></IconButton>
          <label className="top-search">
            <Search size={17} />
            <input type="search" placeholder="Search work, chats, people..." />
            <kbd>/</kbd>
          </label>
          <div className="topbar-actions">
            <IconButton label="Toggle theme" onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </IconButton>
            <IconButton label="Notifications" className="notification-button"><Bell size={18} /><i /></IconButton>
            <Avatar initials="YO" tone="navy" />
          </div>
        </header>

        <div className="page-content">
          <section className="page-heading">
            <div>
              <span className="eyebrow">Collaboration</span>
              <h1>Team chat</h1>
              <p>Keep decisions, updates, and project context in one place.</p>
            </div>
            <div className="heading-actions">
              <button type="button" className="secondary-button"><Users size={16} /> Invite people</button>
              <button type="button" className="primary-button"><Plus size={17} /> New conversation</button>
            </div>
          </section>

          <section className="stat-grid" aria-label="Workspace summary">
            {stats.map((stat) => <StatCard stat={stat} key={stat.label} />)}
          </section>

          <section className={`chat-shell ${detailsOpen ? '' : 'details-hidden'}`}>
            <aside className="conversation-pane">
              <div className="conversation-pane-heading">
                <div><strong>Conversations</strong><span>4 unread messages</span></div>
                <IconButton label="New conversation"><Plus size={17} /></IconButton>
              </div>
              <label className="conversation-search">
                <Search size={15} />
                <input type="search" placeholder="Search conversations" />
              </label>
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <ConversationItem key={conversation.id} conversation={conversation} active={conversation.id === activeConversation} onSelect={() => setActiveConversation(conversation.id)} />
                ))}
              </div>
            </aside>

            <section className="conversation-pane-main">
              <header className="conversation-header">
                <div className="conversation-title">
                  <span className="channel-icon"><Hash size={19} /></span>
                  <div>
                    <h2>{selected.name}</h2>
                    <p><i className="presence online" /> 6 members | 3 online</p>
                  </div>
                </div>
                <div className="conversation-actions">
                  <IconButton label="Start video call"><Video size={18} /></IconButton>
                  <IconButton label="Start audio call"><Phone size={18} /></IconButton>
                  <IconButton label={detailsOpen ? 'Hide conversation details' : 'Show conversation details'} active={detailsOpen} onClick={() => setDetailsOpen((current) => !current)}><PanelRight size={18} /></IconButton>
                </div>
              </header>

              <div className="message-scroll" ref={messageScrollRef}>
                <div className="date-divider"><span>Today</span></div>
                {messages.map((message) => <MessageRow key={message.id} message={message} />)}
                <div className="typing-row">
                  <span className="typing-avatar"><Avatar initials="MC" tone="green" size="sm" /></span>
                  <span><strong>Maya</strong> is typing</span>
                  <i /><i /><i />
                </div>
              </div>

              <form className="chat-composer" onSubmit={sendMessage}>
                <div className="composer-input-wrap">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        event.currentTarget.form?.requestSubmit()
                      }
                    }}
                    placeholder={`Message ${selected.name}`}
                    aria-label={`Message ${selected.name}`}
                  />
                  <div className="composer-tools">
                    <IconButton label="Attach a file"><Paperclip size={18} /></IconButton>
                    <IconButton label="Add a reaction"><Smile size={18} /></IconButton>
                    <IconButton label="Record a voice note"><Mic size={18} /></IconButton>
                  </div>
                </div>
                <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send message"><Send size={18} /></button>
              </form>
            </section>

            {detailsOpen && <ContextPane onClose={() => setDetailsOpen(false)} />}
          </section>
        </div>
      </main>

      {aiMode === 'open' && (
        <AiPanel
          onMinimize={() => setAiMode('minimized')}
          onHide={() => setAiMode('hidden')}
        />
      )}

      {aiMode === 'minimized' && <MinimizedAiToast onOpen={() => setAiMode('open')} />}

      {aiMode === 'hidden' && (
        <button
          type="button"
          className="ai-flyout-tab"
          onClick={() => setAiMode('open')}
          aria-label="Show Zuri assistant"
        >
          <ChevronLeft size={15} />
          <Bot size={19} />
        </button>
      )}
    </div>
  )
}

createRoot(document.getElementById('ui-mockup-root')).render(<App />)
