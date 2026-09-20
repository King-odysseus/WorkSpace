// Static, self-contained views: the help centre, the legal/policy pages, and the
// cookie banner. None of them touch workspace data, so they stay out of the
// application shell entirely.

import { useEffect, useState } from 'react'
import {
  ArrowRight, BarChart3, Bell, BookOpen, CalendarDays, Camera, CheckCircle2, ChevronDown,
  ChevronRight, CircleHelp, ClipboardList, Clock3, Cookie, Download, FileText, FolderKanban,
  Globe2, Hash, Keyboard, LayoutGrid, Laptop, Mail, Megaphone, MessageSquare, Monitor,
  MonitorDown, Plus, Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Target, Users,
  Volume2, X,
} from 'lucide-react'
import { Card } from './ui/card.jsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { formatDay } from '../lib/workspace-format.js'
import { RELEASE_NOTES, latestReleaseDate, markReleaseNotesSeen, releaseNotesUnread } from '../lib/release-notes.js'
import { getInstallSnapshot, promptToInstall, subscribeToInstallState } from '../lib/install-prompt.js'

const HELP_TOPICS = [
  {
    title: 'Create and assign a task',
    icon: ClipboardList,
    group: 'tasks',
    intro: 'Capture work so someone owns it and knows when it is due.',
    steps: [
      'Open Today, My tasks, Planner, or Daily operations and select Add task.',
      'Enter a clear task name and add any useful description.',
      'Assign the task to the right person or leave it unassigned.',
      'Choose a due date and project, then set priority and bucket.',
      'Select Create task.',
    ],
  },
  {
    title: 'Review task status and workload',
    icon: BarChart3,
    group: 'tasks',
    intro: 'Use My tasks, Team, and Reports to understand what is moving or blocked.',
    steps: [
      'Open My tasks to review work assigned to you.',
      'Open Team and choose a scope, then switch between People, Status, and Priority.',
      'Check Blocked, Overdue, and Unassigned metrics.',
      'Open a task to change status, owner, dates, or context.',
    ],
  },
  {
    title: 'Plan project work',
    icon: LayoutGrid,
    group: 'planner',
    intro: 'Use Planner to organise delivery work by bucket, owner, priority, and date.',
    steps: [
      'Open Planner and choose All projects or a specific project.',
      'Switch between Board, Table, and Gantt.',
      'Add a project task and assign it to the delivery owner.',
      'Drag tasks between buckets or use the bucket selector on a card.',
      'Save filtered views that the team should reuse.',
    ],
  },
  {
    title: 'Plan your own day',
    icon: CheckCircle2,
    group: 'planner',
    intro: 'My planner is private and separate from shared team work.',
    steps: [
      'Open My planner from the sidebar.',
      'Add a personal item and choose the planner it belongs to.',
      'Tick an item to finish it.',
      'Rename or add planners as your routines change.',
    ],
  },
  {
    title: 'Run daily operations',
    icon: ClipboardList,
    group: 'planner',
    intro: 'Keep recurring non-project work moving through predictable lanes.',
    steps: [
      'Open Daily operations from the sidebar.',
      'Create a workstream such as Finance, Customer Support, or People.',
      'Add an operation task and leave its project scope as operations.',
      'Move work through buckets and update status when it starts or finishes.',
      'Add a blocker and explanation when work is stuck.',
    ],
  },
  {
    title: 'Track a project',
    icon: Target,
    group: 'projects',
    intro: 'Keep delivery progress, controls, resources, and budget in one place.',
    steps: [
      'Open Projects and create or select a project.',
      'Use Overview, Kanban, Tasks, Risks, Issues, Resources, Budget, and Activity.',
      'Add risks and issues from the risk register and issue log.',
      'Update status as mitigation and delivery progress changes.',
    ],
  },
  {
    title: 'Talk with the team',
    icon: MessageSquare,
    group: 'messaging',
    intro: 'Use Channels for shared topics and Chats for private conversations.',
    steps: [
      'Open Channels for team-wide discussions.',
      'Open an existing channel or create a new one.',
      'Type a message and press Enter to send.',
      'Use reply to keep a thread clear.',
      'Open Chats for one-to-one or group conversations.',
    ],
  },
  {
    title: 'Use mentions and threads',
    icon: Hash,
    group: 'messaging',
    intro: 'Keep attention and context attached to the right conversation.',
    steps: [
      'Type @ in a message or comment to mention a teammate.',
      'Open a thread from the reply action under a message.',
      'Follow a thread to keep receiving replies.',
      'Use notifications to return to the message or task that needs attention.',
    ],
  },
  {
    title: 'Manage settings and access',
    icon: Settings,
    group: 'settings',
    intro: 'Keep profile, notifications, members, and workspace controls current.',
    steps: [
      'Open Settings and choose Profile, Notifications, Members, or Preferences.',
      'Update your photo, presence, and notification choices.',
      'Owners and managers can invite members and change roles.',
      'Review AI provider settings before enabling assistant features.',
    ],
  },
  {
    title: 'Update your profile',
    icon: Camera,
    group: 'settings',
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
    group: 'settings',
    intro: 'Bring someone into the workspace with the correct access level.',
    steps: [
      'Open Team or Settings.',
      'Scroll to Members and access.',
      'Select Invite team member.',
      'Enter their email address and choose Member or Manager.',
      'Send the invitation.',
    ],
  },
]

const HELP_GUIDES = [
  { id: 'tasks', title: 'Task guidance', icon: ClipboardList, description: 'Statuses, buckets, estimates and moving work around.' },
  { id: 'planner', title: 'Planner guidance', icon: LayoutGrid, description: 'Buckets, workstreams, drag-and-drop and archiving.' },
  { id: 'projects', title: 'Project guidance', icon: FolderKanban, description: 'Owners, progress, risk panels and budgets.' },
  { id: 'messaging', title: 'Chat and channel guidance', icon: MessageSquare, description: 'Channels, direct messages, mentions and threads.' },
  { id: 'settings', title: 'Settings guidance', icon: Settings, description: 'Members, roles, AI providers and webhooks.' },
]

const HELP_SHORTCUTS = [
  ['Search', '/'],
  ['New task', 'N'],
  ['Open notifications', 'Shift N'],
  ['Toggle sidebar', 'Ctrl \\'],
  ['Close overlay', 'Esc'],
]

function HelpView({ onNavigate }) {
  const [query, setQuery] = useState('')
  const [selectedGuide, setSelectedGuide] = useState(HELP_GUIDES[0].id)
  const [openTopic, setOpenTopic] = useState(null)
  const normalizedQuery = query.trim().toLowerCase()
  const matches = topic => !normalizedQuery || [topic.title, topic.intro, ...topic.steps].join(' ').toLowerCase().includes(normalizedQuery)
  const matchingTopics = HELP_TOPICS.filter(matches)
  const guideTopics = HELP_TOPICS.filter(topic => topic.group === selectedGuide && matches(topic))
  const guideCount = guide => HELP_TOPICS.filter(topic => topic.group === guide.id).length
  const visibleGuides = HELP_GUIDES.filter(guide => !normalizedQuery || guideTopics.some(topic => topic.group === guide.id) || HELP_TOPICS.some(topic => topic.group === guide.id && matches(topic)))

  const openArticle = topic => {
    setSelectedGuide(topic.group)
    setOpenTopic(topic.title)
  }

  return (
    <section className="workspace-view help-resource-view">
      <WorkspaceViewHeading
        title="Help"
        subtitle="Short guides for each part of Workspace, plus ways to reach us."
      />
      <label className="help-search-bar">
        <Search size={18} />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search help articles" aria-label="Search help articles" />
        <kbd>/</kbd>
      </label>

      <div className="help-resource-layout">
        <div className="help-resource-main">
          <header className="help-section-heading">
            <h2>Guides</h2>
            <span>{visibleGuides.length} topics - {matchingTopics.length} articles</span>
          </header>
          <div className="help-guide-grid">
            {visibleGuides.map(guide => {
              const Icon = guide.icon
              const selected = selectedGuide === guide.id
              return (
                <button type="button" className={`help-guide-card${selected ? ' is-selected' : ''}`} key={guide.id} onClick={() => setSelectedGuide(guide.id)}>
                  <span><Icon size={20} /></span>
                  <strong>{guide.title}</strong>
                  <small>{guide.description}</small>
                  <em>{guideCount(guide)} articles</em>
                </button>
              )
            })}
          </div>
          {!visibleGuides.length && <p className="help-empty">No articles match that search.</p>}

          {guideTopics.length > 0 && (
            <Card className="help-article-list">
              <header className="help-section-heading">
                <h2>{HELP_GUIDES.find(guide => guide.id === selectedGuide)?.title}</h2>
                <span>{guideTopics.length} articles</span>
              </header>
              <div className="help-article-items">
                {guideTopics.map(topic => {
                  const Icon = topic.icon
                  const expanded = openTopic === topic.title
                  return (
                    <article key={topic.title}>
                      <button type="button" onClick={() => setOpenTopic(expanded ? null : topic.title)} aria-expanded={expanded}>
                        <span className="help-article-icon"><Icon size={18} /></span>
                        <span><strong>{topic.title}</strong><small>{topic.intro}</small></span>
                        <ChevronRight size={18} aria-hidden="true" />
                      </button>
                      {expanded && <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>}
                    </article>
                  )
                })}
              </div>
            </Card>
          )}

          <Card className="help-popular-card">
            <header className="help-section-heading">
              <h2>Popular articles</h2>
              <span>Most read this week</span>
            </header>
            <div className="help-popular-list">
              {matchingTopics.slice(0, 3).map(topic => (
                <button type="button" key={topic.title} onClick={() => openArticle(topic)}>
                  <FileText size={17} />
                  <strong>{topic.title}</strong>
                  <small>{HELP_GUIDES.find(guide => guide.id === topic.group)?.title} - 2 min read</small>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <aside className="help-resource-side">
          <Card className="help-support-card">
            <h2>Still stuck?</h2>
            <button type="button" className="help-support-primary" onClick={() => onNavigate('Channels')}>
              <Hash size={17} /> Ask in #help
            </button>
            <button type="button" className="help-support-secondary" onClick={() => onNavigate('Settings')}>
              <Mail size={17} /> Open support settings
            </button>
            <p><Clock3 size={14} /> Typical reply within 1 working day.</p>
            <small>Workspace admins can also reach us from Settings.</small>
          </Card>

          <Card className="help-shortcuts-card">
            <h2>Keyboard shortcuts</h2>
            <div>
              {HELP_SHORTCUTS.map(([label, keys]) => (
                <span key={label}><strong>{label}</strong><kbd>{keys}</kbd></span>
              ))}
            </div>
            <small>Shortcuts follow your operating system conventions.</small>
          </Card>
        </aside>
      </div>
    </section>
  )
}

const INSTALL_PLATFORMS = [
  {
    id: 'desktop',
    title: 'Chrome or Edge on desktop',
    description: 'Install from the address bar, or use the button above.',
    icon: Monitor,
  },
  {
    id: 'macos',
    title: 'macOS',
    description: 'Add to the Dock from Safari or Chrome.',
    icon: Laptop,
  },
  {
    id: 'windows',
    title: 'Windows',
    description: 'Install as a desktop app from Edge or Chrome.',
    icon: MonitorDown,
  },
  {
    id: 'mobile',
    title: 'iOS and Android',
    description: 'Add to the home screen from the share menu.',
    icon: Smartphone,
  },
]

function detectedDeviceLabel() {
  const userAgent = navigator.userAgent || ''
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : 'Browser'
  const version = userAgent.match(/Chrome\/(\d+)/)?.[1] || userAgent.match(/Version\/(\d+)/)?.[1]
  const platform = /Windows/.test(userAgent)
    ? 'Windows'
    : /Macintosh|Mac OS X/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(userAgent)
          ? 'iOS'
          : 'your device'
  return `${browser}${version ? ` ${version}` : ''} on ${platform}`
}

function InstallAppView({ onNavigate }) {
  const [installState, setInstallState] = useState(() => getInstallSnapshot())
  const [message, setMessage] = useState('')

  useEffect(() => subscribeToInstallState(() => setInstallState(getInstallSnapshot())), [])

  const install = async () => {
    setMessage('')
    if (installState.installed) {
      setMessage('Workspace is already installed on this device.')
      return
    }
    if (!installState.canPrompt) {
      setMessage(
        installState.ios
          ? 'On iPhone or iPad, open the browser share menu and choose Add to Home Screen.'
          : 'Open the browser menu and choose Install app or Install this site as an app.',
      )
      return
    }
    const outcome = await promptToInstall()
    if (outcome === 'dismissed') setMessage('Installation was dismissed. You can try again at any time.')
    if (outcome === 'unavailable') setMessage('This browser did not provide an install prompt. Use the browser menu instead.')
  }

  return (
    <section className="workspace-view install-app-view">
      <WorkspaceViewHeading
        title="Install app"
        subtitle="Run Workspace like a desktop app, with its own window and notifications."
      />

      <div className="install-resource-layout">
        <div className="install-resource-main">
          <Card className="install-hero-card">
            <span className="install-app-mark" aria-hidden="true">W</span>
            <div className="install-hero-copy">
              <h2>Install Workspace on this device</h2>
              <p>Installing adds Workspace to your dock or home screen and opens it in its own window - no browser tabs, and it stays signed in.</p>
            </div>
            <button type="button" className="primary-button" onClick={install} disabled={installState.installed}>
              <Download size={16} /> {installState.installed ? 'Already installed' : 'Install now'}
            </button>
            <span className="install-hero-state">{installState.installed ? 'Installed' : 'Already installed?'}</span>
            <div className="install-detected-device">
              <Globe2 size={17} />
              <span><strong>Detected: {detectedDeviceLabel()}</strong><small>{installState.eligible || installState.installed ? 'Installation is available from this browser.' : 'Use a supported browser and browser menu to install.'}</small></span>
            </div>
            {message && <div className="install-inline-message" role="status">{message}</div>}
          </Card>

          <Card className="install-platforms-card">
            <header className="install-section-heading">
              <h2>Supported platforms</h2>
              <span>4 platforms</span>
            </header>
            <div className="install-platform-list">
              {INSTALL_PLATFORMS.map(platform => {
                const Icon = platform.icon
                const status = platform.id === 'mobile' && installState.ios ? 'Limited on iOS' : 'Supported'
                return (
                  <div key={platform.id}>
                    <span className="install-platform-icon"><Icon size={19} /></span>
                    <span><strong>{platform.title}</strong><small>{platform.description}</small></span>
                    <em className={status === 'Supported' ? '' : 'is-limited'}>{status}</em>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card className="install-troubleshooting-card">
            <h2>Troubleshooting</h2>
            <details open>
              <summary>No install option in the address bar</summary>
              <p>Update the browser, or open this page in a private window without extensions.</p>
            </details>
            <details>
              <summary>Installed app stays signed out</summary>
              <p>Allow third-party cookies for this workspace, then sign in again.</p>
            </details>
            <details>
              <summary>Notifications are not appearing</summary>
              <p>Open Settings, then Notifications, and enable browser notifications for this device.</p>
            </details>
          </Card>
        </div>

        <aside className="install-resource-side">
          <Card className="install-side-card">
            <h2>How it works</h2>
            <p>Workspace is a progressive web app. Installing does not download a separate build - it pins the web app to your device and gives it its own window.</p>
            <span><CheckCircle2 size={16} /> Always the latest version - no updates to install.</span>
          </Card>
          <Card className="install-side-card">
            <h2>Why install</h2>
            <ul>
              <li><Monitor size={17} /> Its own window, separate from your browser tabs.</li>
              <li><Bell size={17} /> Desktop notifications for mentions and assignments.</li>
              <li><Volume2 size={17} /> Faster startup from the dock or home screen.</li>
              <li><Keyboard size={17} /> Global keyboard shortcut to open Workspace.</li>
            </ul>
          </Card>
          <aside className="install-keep-working">
            <h2>Keep working</h2>
            <p>You do not have to install anything. Workspace runs fully in the browser.</p>
            <button type="button" className="secondary-button" onClick={() => onNavigate('Today')}>Back to Workspace</button>
            <small>Returns you to Today.</small>
          </aside>
        </aside>
      </div>
    </section>
  )
}

const LEGAL_DOCUMENTS = {
  privacy: {
    label: 'Privacy',
    icon: ShieldCheck,
    title: 'Privacy notice',
    version: 'Current - Sep 2026',
    summary: 'How Workspace collects, uses and stores data on behalf of your workspace. This notice covers product telemetry, workspace content, member records and the AI features you enable.',
    contents: ['What we collect', 'How we use it', 'AI features and your content', 'Retention and deletion', 'Your rights and contact'],
    sections: [
      ['What we collect', 'Account details, workspace membership, tasks, messages, calendar entries, check-ins, documents and technical information needed to keep the service secure.'],
      ['How we use it', 'We use this data to provide the workspace, authenticate users, deliver notifications, support collaboration, prevent abuse and improve reliability.'],
      ['AI features and your content', 'AI features only receive workspace context needed for the request you make. Personal details in attached documents can be replaced with placeholders before processing.'],
      ['Retention and deletion', 'Workspace data is retained while the workspace is active or as required for legitimate business and legal purposes. Workspace administrators can request deletion through their account process.'],
      ['Your rights and contact', 'Depending on your location, you may have rights to access, correct, export, restrict, object to, or delete your personal data. Contact your workspace administrator to make a request.'],
    ],
  },
  cookies: {
    label: 'Cookies',
    icon: Cookie,
    title: 'Cookie notice',
    version: 'Current - Sep 2026',
    summary: 'Workspace uses a small number of cookies and browser storage entries to keep you signed in and remember your preferences.',
    contents: ['Essential cookies', 'Preference storage', 'Analytics', 'Product updates', 'Managing your choice'],
    sections: [
      ['Essential cookies', 'Session and CSRF cookies are required for authentication and secure form submissions. They cannot be switched off in the app.'],
      ['Preference storage', 'Theme, sidebar layout, saved views and legal acceptance are stored locally in your browser so the app can remember your choices.'],
      ['Analytics', 'This application does not intentionally use advertising cookies. Optional analytics are disabled unless the workspace enables and the user allows them.'],
      ['Product updates', 'Product-update storage may be used to remember whether release notes have been reviewed.'],
      ['Managing your choice', 'Use the controls in this page or the cookie banner to accept, decline or change optional categories.'],
    ],
  },
  terms: {
    label: 'Terms of service',
    icon: FileText,
    title: 'Terms of service',
    version: 'Current - Sep 2026',
    summary: 'The rules for using Workspace, protecting accounts and working responsibly with other people and their data.',
    contents: ['Your account', 'Workspace content', 'Availability', 'Acceptable use', 'Changes to the service'],
    sections: [
      ['Your account', 'Provide accurate account information, keep credentials private, and tell your administrator if you suspect unauthorized access.'],
      ['Workspace content', 'You remain responsible for the content you add and for ensuring you have permission to share it with workspace members.'],
      ['Availability', 'We aim to keep Workspace reliable, but maintenance, outages and changes may occur. Do not use the service for emergency or safety-critical decisions.'],
      ['Acceptable use', 'Use Workspace lawfully and follow the separate acceptable use policy.'],
      ['Changes to the service', 'Material changes to the service or these terms should be communicated to workspace administrators before they take effect.'],
    ],
  },
  acceptable: {
    label: 'Acceptable use',
    icon: CircleHelp,
    title: 'Acceptable use policy',
    version: 'Current - Sep 2026',
    summary: 'Use Workspace responsibly and do not put other people, the service or sensitive data at unreasonable risk.',
    contents: ['Do not misuse the service', 'Respect people', 'Protect data', 'Report concerns'],
    sections: [
      ['Do not misuse the service', 'Do not access accounts without permission, probe or disrupt systems, distribute malware, or attempt to bypass security controls.'],
      ['Respect people', 'Do not use Workspace for harassment, threats, unlawful discrimination, or sharing content that you do not have the right to distribute.'],
      ['Protect data', 'Use the workspace permissions provided and avoid adding personal or confidential data that the workspace is not authorised to hold.'],
      ['Report concerns', 'Tell your workspace administrator promptly about suspected abuse, data exposure or security issues.'],
    ],
  },
  processing: {
    label: 'Data processing',
    icon: SlidersHorizontal,
    title: 'Data processing addendum',
    version: 'Current - Sep 2026',
    summary: 'A workspace-level summary of processing roles, subprocessors, security measures and international transfer safeguards.',
    contents: ['Controller and processor roles', 'Processing instructions', 'Security measures', 'Subprocessors and transfers'],
    sections: [
      ['Controller and processor roles', 'The workspace owner determines why workspace data is processed. The service provider processes that data to operate Workspace and the features enabled by the owner.'],
      ['Processing instructions', 'The workspace owner is responsible for configuring roles, retention, imports and optional AI providers in line with its own policies.'],
      ['Security measures', 'Access controls, authentication, audit records, tenant boundaries and backup procedures are used to protect workspace data.'],
      ['Subprocessors and transfers', 'A production workspace should maintain an approved subprocessor list and applicable transfer safeguards. The current app does not expose that list.'],
    ],
  },
}

function LegalView() {
  const [activeDocument, setActiveDocument] = useState('privacy')
  const [accepted, setAccepted] = useState(() => localStorage.getItem('workspace-legal-accepted-v1') === 'true')
  const [cookiePreferences, setCookiePreferences] = useState(() => readCookieConsent() || DEFAULT_COOKIE_PREFERENCES)
  const current = LEGAL_DOCUMENTS[activeDocument]
  const acceptPolicies = () => {
    localStorage.setItem('workspace-legal-accepted-v1', 'true')
    setAccepted(true)
    window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Policies accepted.' }))
  }
  const revokePolicies = () => {
    localStorage.removeItem('workspace-legal-accepted-v1')
    setAccepted(false)
  }
  const saveCookiePreferences = () => {
    writeCookieConsent(cookiePreferences)
    window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Cookie preferences saved.' }))
  }
  const openSection = heading => {
    const target = document.getElementById(`legal-section-${activeDocument}-${heading.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <section className="workspace-view legal-resource-view">
      <WorkspaceViewHeading
        title="Legal"
        subtitle="Privacy, cookies, terms and acceptable use for this Workspace."
      />
      <div className="legal-resource-layout">
        <aside className="legal-resource-side">
          <Card className="legal-document-nav">
            <p className="eyebrow">Documents</p>
            {Object.entries(LEGAL_DOCUMENTS).map(([key, item]) => {
              const Icon = item.icon
              return (
                <button type="button" className={activeDocument === key ? 'active' : ''} key={key} onClick={() => setActiveDocument(key)}>
                  <Icon size={18} /> {item.label}
                </button>
              )
            })}
            <small>Updated 20 September 2026</small>
          </Card>
          <Card className="legal-details-card">
            <h2>Document details</h2>
            <dl>
              <div><dt>Current version</dt><dd>{current.version}</dd></div>
              <div><dt>Effective from</dt><dd>20 September 2026</dd></div>
              <div><dt>Previous version</dt><dd>Not published</dd></div>
            </dl>
            <p><Bell size={15} /> We notify workspace admins 30 days before a material change takes effect.</p>
          </Card>
          <Card className="legal-related-card">
            <h2>Related documents</h2>
            {Object.entries(LEGAL_DOCUMENTS).filter(([key]) => key !== activeDocument).slice(0, 3).map(([key, item]) => (
              <button type="button" key={key} onClick={() => setActiveDocument(key)}>
                <FileText size={17} /><span><strong>{item.label}</strong><small>{item.version}</small></span>
              </button>
            ))}
            <small>PDF downloads are not available in this build.</small>
          </Card>
        </aside>

        <div className="legal-resource-main">
          <Card className="legal-document-panel">
            <header>
              <div>
                <p className="eyebrow">Workspace policy</p>
                <h2>{current.title}</h2>
              </div>
              <span>{current.version}</span>
            </header>
            <p className="legal-document-summary">{current.summary}</p>
            <div className="legal-advice-note"><ShieldCheck size={16} /> This summary is not legal advice. The full document is authoritative.</div>
          </Card>

          <Card className="legal-contents-card">
            <p className="eyebrow">In this document</p>
            <div>
              {current.contents.map((heading, index) => (
                <button type="button" key={heading} onClick={() => openSection(heading)}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{heading}</strong>
                  <small>{current.sections[index]?.[1] ? '1 subsection' : 'Overview'}</small>
                </button>
              ))}
            </div>
          </Card>

          <Card className="legal-document-body">
            {current.sections.map(([heading, body]) => (
              <section id={`legal-section-${activeDocument}-${heading.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`} key={heading}>
                <h3>{heading}</h3>
                <p>{body}</p>
              </section>
            ))}
          </Card>

          <Card className="legal-cookie-card">
            <header className="legal-cookie-heading">
              <h2>Cookie categories</h2>
              <span>Applies to this browser</span>
            </header>
            <div className="legal-cookie-list">
              <div><span className="legal-cookie-dot essential" /><span><strong>Essential</strong><small>Sign-in, security and workspace routing.</small></span><em>Always on</em></div>
              <div>
                <span className="legal-cookie-dot analytics" />
                <span><strong>Analytics</strong><small>Aggregate usage, no personal profiling.</small></span>
                <button type="button" role="switch" aria-checked={cookiePreferences.analytics} aria-label="Analytics cookies" onClick={() => setCookiePreferences(currentValue => ({ ...currentValue, analytics: !currentValue.analytics }))}><span /></button>
              </div>
              <div>
                <span className="legal-cookie-dot preferences" />
                <span><strong>Preferences</strong><small>Theme, sidebar state and saved filters.</small></span>
                <button type="button" role="switch" aria-checked={cookiePreferences.preferences} aria-label="Preference cookies" onClick={() => setCookiePreferences(currentValue => ({ ...currentValue, preferences: !currentValue.preferences }))}><span /></button>
              </div>
            </div>
            <button type="button" className="primary-button legal-manage-cookies" onClick={saveCookiePreferences}>Manage preferences</button>
          </Card>

          <Card className="legal-acceptance">
            <div>
              <h3>Policy acknowledgement</h3>
              <p>Confirm that you have read and agree to the Terms of service and Acceptable use policy, and acknowledge the Privacy and Cookie notices.</p>
            </div>
            <div className="legal-acceptance-actions">
              {accepted && <button type="button" className="secondary-button" onClick={revokePolicies}>Revoke acknowledgement</button>}
              <button type="button" className="primary-button" onClick={acceptPolicies} disabled={accepted}>{accepted ? 'Policies accepted' : 'Accept policies'}</button>
            </div>
          </Card>
        </div>
      </div>
    </section>
  )
}

const COOKIE_CONSENT_KEY = 'workspace-cookie-consent-v1'
const EMPTY_COOKIE_PREFERENCES = {
  analytics: false,
  preferences: false,
  productUpdates: false,
}
const DEFAULT_COOKIE_PREFERENCES = {
  analytics: true,
  preferences: true,
  productUpdates: false,
}
const ALL_COOKIE_PREFERENCES = {
  analytics: true,
  preferences: true,
  productUpdates: true,
}

function readCookieConsent() {
  const stored = localStorage.getItem(COOKIE_CONSENT_KEY)
  if (!stored) return null
  if (stored === 'essential') return EMPTY_COOKIE_PREFERENCES
  if (stored === 'all') return ALL_COOKIE_PREFERENCES
  try {
    const parsed = JSON.parse(stored)
    return {
      analytics: parsed.analytics === true,
      preferences: parsed.preferences === true,
      productUpdates: parsed.productUpdates === true,
    }
  } catch {
    return EMPTY_COOKIE_PREFERENCES
  }
}

function writeCookieConsent(preferences) {
  localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({
    version: 1,
    analytics: preferences.analytics === true,
    preferences: preferences.preferences === true,
    productUpdates: preferences.productUpdates === true,
  }))
}

function CookieConsent({ onOpenLegal, variant = 'bar' }) {
  const [choice, setChoice] = useState(() => readCookieConsent())
  const [preferencesOpen, setPreferencesOpen] = useState(false)
  const [draft, setDraft] = useState(() => readCookieConsent() || DEFAULT_COOKIE_PREFERENCES)

  const saveChoice = (nextChoice) => {
    writeCookieConsent(nextChoice)
    setChoice(nextChoice)
    setDraft(nextChoice)
    setPreferencesOpen(false)
  }

  const openPreferences = () => {
    setDraft(choice || DEFAULT_COOKIE_PREFERENCES)
    setPreferencesOpen(true)
  }

  const toggleDraft = (key) => {
    setDraft((current) => ({ ...current, [key]: !current[key] }))
  }

  if (choice) return null

  const preferencePanel = (
    <Dialog open={preferencesOpen} onOpenChange={setPreferencesOpen} modal={false}>
      <DialogContent
        className="cookie-preferences-dialog"
        overlayClassName="hidden"
        showCloseButton={false}
        aria-describedby="cookie-preferences-description"
      >
        <header className="cookie-preferences-header">
          <DialogTitle className="cookie-preferences-title">Cookie preferences</DialogTitle>
          <button
            type="button"
            className="cookie-icon-button"
            onClick={() => setPreferencesOpen(false)}
            aria-label="Close cookie preferences"
          >
            <X size={18} />
          </button>
        </header>
        <DialogDescription id="cookie-preferences-description" className="cookie-preferences-copy">
          Choose which categories you allow. Essential cookies cannot be turned off.
        </DialogDescription>
        <div className="cookie-preferences-list">
          <div className="cookie-preference-row">
            <div className="cookie-preference-copy">
              <strong>Essential</strong>
              <span>Sign-in, security and load balancing.</span>
            </div>
            <span className="cookie-fixed-badge">Always</span>
          </div>
          <div className="cookie-preference-row">
            <div className="cookie-preference-copy">
              <strong>Analytics</strong>
              <span>Aggregate usage statistics.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.analytics}
              aria-label="Analytics cookies"
              className={`cookie-toggle ${draft.analytics ? 'is-on' : ''}`}
              onClick={() => toggleDraft('analytics')}
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <div className="cookie-preference-row">
            <div className="cookie-preference-copy">
              <strong>Preferences</strong>
              <span>Theme, layout and saved views.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.preferences}
              aria-label="Preference cookies"
              className={`cookie-toggle ${draft.preferences ? 'is-on' : ''}`}
              onClick={() => toggleDraft('preferences')}
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <div className="cookie-preference-row">
            <div className="cookie-preference-copy">
              <strong>Product updates</strong>
              <span>Occasional in-app announcements.</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.productUpdates}
              aria-label="Product update cookies"
              className={`cookie-toggle ${draft.productUpdates ? 'is-on' : ''}`}
              onClick={() => toggleDraft('productUpdates')}
            >
              <span aria-hidden="true" />
            </button>
          </div>
        </div>
        <footer className="cookie-preferences-footer">
          <button type="button" className="cookie-cancel-button" onClick={() => setPreferencesOpen(false)}>Cancel</button>
          <button type="button" className="cookie-save-button" onClick={() => saveChoice(draft)}>Save preferences</button>
        </footer>
      </DialogContent>
    </Dialog>
  )

  if (variant === 'card') {
    return (
      <>
        <aside className="cookie-consent-card" role="region" aria-label="Cookie consent">
          <div className="cookie-card-heading">
            <span className="cookie-card-tile" aria-hidden="true"><Cookie size={20} /></span>
            <h2>Cookies on Workspace</h2>
            <button type="button" className="cookie-icon-button" onClick={() => saveChoice(EMPTY_COOKIE_PREFERENCES)} aria-label="Dismiss cookie notice">
              <X size={18} />
            </button>
          </div>
          <p className="cookie-card-copy">We use essential cookies to run Workspace, and optional cookies to understand how it is used. You can accept, decline or choose per category.</p>
          <button type="button" className="cookie-notice-link" onClick={onOpenLegal}>Read our cookie notice</button>
          <button type="button" className="cookie-card-preferences" onClick={openPreferences}>Manage preferences</button>
          <div className="cookie-card-actions">
            <button type="button" className="cookie-card-decline" onClick={() => saveChoice(EMPTY_COOKIE_PREFERENCES)}>Decline optional</button>
            <button type="button" className="cookie-card-accept" onClick={() => saveChoice(ALL_COOKIE_PREFERENCES)}>Accept all</button>
          </div>
        </aside>
        {preferencePanel}
      </>
    )
  }

  return (
    <>
      <aside className="cookie-consent-bar" role="region" aria-label="Cookie consent">
        <div className="cookie-consent-copy">
          <span className="cookie-consent-tile" aria-hidden="true"><Cookie size={20} /></span>
          <div className="cookie-consent-message">
            <strong>We use cookies</strong>
            <p>Essential cookies keep you signed in. Analytics and preference cookies are optional, and you can change your choice at any time.</p>
          </div>
          <button type="button" className="cookie-notice-link" onClick={onOpenLegal}>Read our cookie notice</button>
        </div>
        <div className="cookie-consent-actions">
          <button type="button" className="cookie-bar-preferences" onClick={openPreferences}>Preferences</button>
          <button type="button" className="cookie-bar-decline" onClick={() => saveChoice(EMPTY_COOKIE_PREFERENCES)}>Decline</button>
          <button type="button" className="cookie-bar-accept" onClick={() => saveChoice(ALL_COOKIE_PREFERENCES)}>Accept all</button>
          <button type="button" className="cookie-bar-close" onClick={() => saveChoice(EMPTY_COOKIE_PREFERENCES)} aria-label="Dismiss cookie notice">
            <X size={16} />
          </button>
        </div>
      </aside>
      {preferencePanel}
    </>
  )
}

const RELEASE_ACTIONS = {
  'Zuri can read your documents': null,
  'Plan your own day': ['Open My planner', 'My planner'],
  'Share a task between several people': ['Open My tasks', 'My tasks'],
  'A calmer calendar': ['Open Calendar', 'Calendar'],
}

const RELEASE_FILTERS = [
  ['all', 'All'],
  ['product', 'Product'],
  ['fix', 'Fixes'],
  ['announcement', 'Announcements'],
]

function WhatsNew({ onOpen, onNavigate }) {
  const [filter, setFilter] = useState('all')
  const [seen, setSeen] = useState(() => !releaseNotesUnread())
  const notes = RELEASE_NOTES.map(note => ({ ...note, category: note.category || 'product' }))
  const visibleNotes = filter === 'all' ? notes : notes.filter(note => note.category === filter)
  const filterCount = value => value === 'all' ? notes.length : notes.filter(note => note.category === value).length
  const latestDate = latestReleaseDate()
  const quarterStart = new Date(latestDate)
  quarterStart.setDate(quarterStart.getDate() - 90)
  const quarterNotes = notes.filter(note => new Date(note.date) >= quarterStart)

  const markSeen = () => {
    markReleaseNotesSeen()
    setSeen(true)
    onOpen?.()
  }

  return (
    <section className="workspace-view whats-new-view">
      <WorkspaceViewHeading
        title="What's new"
        subtitle="Release notes and product announcements, newest first."
      />
      <div className="whats-new-actions">
        <button type="button" className="secondary-button" onClick={markSeen} disabled={seen}>
          <CheckCircle2 size={16} /> {seen ? 'Marked as seen' : 'Mark as seen'}
        </button>
      </div>

      <div className="whats-new-filter-row" role="tablist" aria-label="Release note filters">
        {RELEASE_FILTERS.map(([value, label]) => {
          const count = filterCount(value)
          return (
            <button
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? 'active' : ''}
              key={value}
              onClick={() => setFilter(value)}
              disabled={value !== 'all' && count === 0}
            >
              {label} <span>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="whats-new-layout">
        <div className="whats-new-list">
          {visibleNotes.map((note, index) => {
            const action = RELEASE_ACTIONS[note.title]
            return (
              <Card className={`whats-new-entry${index === 0 && filter === 'all' ? ' is-latest' : ''}`} key={`${note.date}-${note.title}`}>
                <header>
                  <span className="whats-new-version">{index === 0 ? 'Latest' : 'Update'}</span>
                  {index === 0 && <span className="whats-new-new">New</span>}
                  <time dateTime={note.date}>{formatDay(note.date)}</time>
                </header>
                <h2>{note.title}</h2>
                <ul className="whats-new-items">{note.items.map(item => <li key={item}><CheckCircle2 size={15} /> <span>{item}</span></li>)}</ul>
                <footer>
                  {action && <button type="button" onClick={() => onNavigate?.(action[1])}>{action[0]}</button>}
                  <span>{seen ? 'Seen in this browser' : 'Unread release'}</span>
                </footer>
              </Card>
            )
          })}
          {!visibleNotes.length && <p className="whats-new-empty">No release notes in this category yet.</p>}
        </div>

        <aside className="whats-new-sidebar">
          <Card className="whats-new-update-card">
            <h2>Updates</h2>
            <div className="whats-new-unread">
              <strong>{seen ? '0' : '1'}</strong>
              <span>{seen ? 'all caught up' : 'unread release'}</span>
            </div>
            <dl>
              <div><dt>Seen this release</dt><dd>{seen ? 'Yes' : 'Not yet'}</dd></div>
              <div><dt>Total this quarter</dt><dd>{quarterNotes.length} releases</dd></div>
              <div><dt>Latest shipped</dt><dd>{latestDate ? formatDay(latestDate) : 'None'}</dd></div>
            </dl>
          </Card>

          <Card className="whats-new-cadence-card">
            <h2>Release cadence</h2>
            <p>The current release-note data does not publish a ship schedule or next planned release.</p>
            <div className="whats-new-cadence" aria-hidden="true">
              {Array.from({ length: 7 }, (_, index) => <span className={index < Math.min(notes.length, 7) ? 'is-shipped' : ''} key={index}>S{index + 1}</span>)}
            </div>
            <small>Metadata for release cadence is not available from the current app.</small>
          </Card>

          <aside className="whats-new-cta">
            <h2>Stay up to date</h2>
            <p>Workspace notifications can tell you when tasks, mentions or reminders need attention.</p>
            <button type="button" className="secondary-button" onClick={() => onNavigate?.('Settings')}><Bell size={16} /> Review notification settings</button>
            <small>Change this any time in notification settings.</small>
          </aside>
        </aside>
      </div>
    </section>
  )
}

export { HelpView, InstallAppView, LegalView, WhatsNew, CookieConsent }
