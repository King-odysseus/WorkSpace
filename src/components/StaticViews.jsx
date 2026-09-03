// Static, self-contained views: the help centre, the legal/policy pages, and the
// cookie banner. None of them touch workspace data, so they stay out of the
// application shell entirely.

import { useState } from 'react'
import {
  BarChart3, Bell, CalendarDays, Camera, CheckCircle2, ChevronDown, ClipboardList, Filter,
  Hash, LayoutGrid, MessageSquare, Plus, Settings, Target, Users,
} from 'lucide-react'
import { Card } from './ui/card.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'

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
  return <section className="workspace-view help-view"><WorkspaceViewHeading title="Help center" subtitle="Step-by-step instructions for getting work done in WorkSpace." /><div className="help-grid"><Card className="help-welcome"><p className="eyebrow">Welcome to WorkSpace</p><h2>Learn by doing</h2><p>Expand any workflow below to see the exact actions to take. Start with Create and assign a task, then move to Daily operations or Planner when your work has a clear home.</p><div className="help-actions"><button type="button" className="primary-button" onClick={() => onNavigate('Today')}>Open Today</button><button type="button" className="secondary-button" onClick={() => onNavigate('Planner')}>Open Planner</button></div></Card>{topics.map((topic, index) => <Card className={`help-topic ${openTopic === index ? 'is-open' : ''}`} key={topic.title}><button type="button" className="help-topic-header" onClick={() => setOpenTopic(current => current === index ? null : index)} aria-expanded={openTopic === index}><topic.icon size={16} /><h3>{topic.title}</h3><ChevronDown size={16} className="help-chevron" /></button>{openTopic === index && <div className="help-topic-content"><p>{topic.intro}</p><ul>{topic.steps.map(step => <li key={step}>{step}</li>)}</ul></div>}</Card>)}</div><Card className="help-contact"><div><p className="eyebrow">Need more help?</p><h2>Contact your workspace administrator</h2><p>For access, billing, deletion, or security requests, contact the person who manages your workspace.</p></div><button type="button" className="secondary-button" onClick={() => onNavigate('Settings')}>Open Settings</button></Card></section>
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
  const acceptPolicies = () => { localStorage.setItem('workspace-legal-accepted-v1', 'true'); setAccepted(true); window.dispatchEvent(new CustomEvent('workspace:notice', { detail: 'Policies accepted.' })) }
  const revokePolicies = () => { localStorage.removeItem('workspace-legal-accepted-v1'); setAccepted(false) }
  return <section className="workspace-view legal-view"><WorkspaceViewHeading title="Legal & privacy" subtitle="Review the policies that govern your use of WorkSpace." /><div className="legal-layout"><nav className="legal-nav" aria-label="Legal documents">{Object.entries(documents).map(([key, item]) => <button type="button" className={document === key ? 'active' : ''} key={key} onClick={() => setDocument(key)}>{item.label}</button>)}</nav><Card className="legal-document"><p className="eyebrow">WorkSpace policies</p><h2>{current.title}</h2><p className="legal-intro">{current.intro}</p>{current.sections.map(([heading, body]) => <section key={heading}><h3>{heading}</h3><p>{body}</p></section>)}<p className="legal-meta">Last updated: 3 September 2026 · Review this policy with your legal adviser for your organisation's specific obligations.</p></Card></div><Card className="legal-acceptance"><div><h3>Policy acknowledgement</h3><p>To continue using this workspace, confirm that you have read and agree to the Terms of service and Acceptable use policy, and acknowledge the Privacy and Cookie notices.</p></div><div className="legal-acceptance-actions"><button type="button" className="primary-button" onClick={acceptPolicies} disabled={accepted}>{accepted ? 'Policies accepted' : 'Accept policies'}</button></div></Card></section>
}

function CookieConsent({ onOpenLegal }) {
  const [choice, setChoice] = useState(() => localStorage.getItem('workspace-cookie-consent-v1'))
  if (choice) return null
  const save = value => { localStorage.setItem('workspace-cookie-consent-v1', value); setChoice(value) }
  return <aside className="cookie-consent" role="dialog" aria-label="Cookie preferences"><div><strong>Cookie preferences</strong><p>We use essential cookies to keep you signed in and secure. Optional analytics cookies are currently not enabled.</p><button type="button" className="cookie-link" onClick={onOpenLegal}>Read the Cookie notice</button></div><div className="cookie-actions"><button type="button" className="secondary-button" onClick={() => save('essential')}>Essential only</button><button type="button" className="primary-button" onClick={() => save('all')}>Accept all</button></div></aside>
}

export { HelpView, LegalView, CookieConsent }
