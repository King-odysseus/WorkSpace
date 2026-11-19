import React from 'react'
import {
  BarChart3, Bell, CalendarDays, CheckSquare, ClipboardList, FileText, FolderOpen, Hash, HelpCircle, Home, ListChecks,
  MessageSquare, Monitor, Settings as SettingsIcon, Sparkles, Upload, Users, Activity as ActivityIcon, Flag, LayoutGrid,
  Download, Megaphone, Repeat, X, ArrowRight, CalendarRange,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sidebar, TopBar } from '../Shell.jsx'
import { PageHead, Section, TaskRow } from '../kit.jsx'

/*
 * "Workspace" mode: the existing web app, unchanged. The sidebar and top bar are
 * the repo's own mockup shell (src/mockups/Shell.jsx), which mirrors the real
 * shell feature for feature. Tasks created by the Copilot appear here as
 * ordinary tasks. The dock panel is the only Copilot piece, and it belongs to
 * the desktop shell, not to the web app.
 */

export const WORKSPACE_SCREENS = [
  { name: 'Today', icon: Home, group: 'Overview' },
  { name: 'My tasks', icon: ClipboardList, group: 'Overview' },
  { name: 'My planner', icon: ListChecks, group: 'Overview' },
  { name: 'Daily operations', icon: Repeat, group: 'Overview' },
  { name: 'Team', icon: Users, group: 'Overview' },
  { name: 'Channels', icon: Hash, group: 'Collaborate' },
  { name: 'Chats', icon: MessageSquare, group: 'Collaborate' },
  { name: 'Follow-up', icon: Flag, group: 'Collaborate' },
  { name: 'Check-ins', icon: CheckSquare, group: 'Collaborate' },
  { name: 'Planner', icon: LayoutGrid, group: 'Work' },
  { name: 'Projects', icon: FolderOpen, group: 'Work' },
  { name: 'Calendar', icon: CalendarDays, group: 'Work' },
  { name: 'Files', icon: FileText, group: 'Work' },
  { name: 'Import data', icon: Upload, group: 'Work' },
  { name: 'Reports', icon: BarChart3, group: 'Insights' },
  { name: 'Activity', icon: ActivityIcon, group: 'Insights' },
  { name: 'Notifications', icon: Bell, group: 'More' },
  { name: 'Screen sharing', icon: Monitor, group: 'More' },
  { name: "What's new", icon: Megaphone, group: 'More' },
  { name: 'Install app', icon: Download, group: 'More' },
  { name: 'Help', icon: HelpCircle, group: 'More' },
  { name: 'Settings', icon: SettingsIcon, group: 'More' },
]

const GROUPS = [...new Set(WORKSPACE_SCREENS.map(screen => screen.group))]

const existing = [
  { title: 'Draft wholesale price sheet', meta: 'Wholesale launch - due 19-11-26', who: 'Sarah Okafor', tag: 'In progress', tone: 'info' },
  { title: 'Photograph the new single-origin bags', meta: 'Website - due 20-11-26', who: 'Dev Rao', tag: 'To do', tone: 'muted' },
  { title: 'Reconcile October invoices', meta: 'Finance - overdue 3 days', who: 'Marcus Bell', tag: 'Overdue', tone: 'danger' },
]

function PlannerBody({ created, onOpenCopilot }) {
  return (
    <div className="@container">
      <PageHead eyebrow="Work" title="Planner" sub="Everyone's tasks for the workspace. This is the existing web screen, unchanged." actions={<Button variant="outline" onClick={() => onOpenCopilot('Weekly plan')}><Sparkles size={15} /> Plan the week with ZuriCopilot</Button>} />
      {created.length > 0 && (
        <Section title={`New this week from your approved plan (${created.length})`} className="mb-10">
          <div className="space-y-3">
            {created.map(task => <TaskRow key={task.id} title={task.title} meta={`${task.project} - due ${task.due}`} who={task.who} tag="ZuriCopilot plan" tone="bronze" />)}
          </div>
        </Section>
      )}
      <Section title="Already on the board">
        <div className="space-y-3">{existing.map(task => <TaskRow key={task.title} {...task} />)}</div>
      </Section>
    </div>
  )
}

export function WorkspaceView({ active, onPick, collapsed, onToggle, theme, onTheme, created, onOpenCopilot, dock, onDock }) {
  const isPlanner = active === 'Planner'
  return (
    <>
      <Sidebar screens={WORKSPACE_SCREENS} groups={GROUPS} active={active} onPick={onPick} collapsed={collapsed} onToggle={onToggle} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar title={active} theme={theme} onTheme={onTheme} />
        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface-secondary px-14 pb-20 pt-8">
            <div className="mx-auto w-full max-w-[1100px]">
              {isPlanner
                ? <PlannerBody created={created} onOpenCopilot={onOpenCopilot} />
                : <div className="rounded-3xl bg-surface p-10 text-center text-text-secondary shadow-[var(--shadow-soft)]"><p className="text-lg font-semibold text-text-primary">{active}</p><p className="mt-2 text-sm">The existing web screen, unchanged. Open Planner to see tasks from the Copilot plan.</p></div>}
            </div>
          </div>
          {dock && <CopilotDock onClose={onDock} onOpenCopilot={onOpenCopilot} planned={created.length} />}
        </div>
      </div>
    </>
  )
}

// The docked panel: a compact ZuriCopilot beside the web app, so the owner can
// plan the week while looking at Planner.
function CopilotDock({ onClose, onOpenCopilot, planned }) {
  return (
    <aside aria-label="ZuriCopilot panel" className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-surface px-5 py-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary"><span className="grid size-8 place-items-center rounded-full bg-navy text-white"><Sparkles size={15} /></span> ZuriCopilot</h2>
        <button type="button" aria-label="Close panel" onClick={onClose} className="grid size-8 place-items-center rounded-full text-text-muted hover:bg-surface-hover"><X size={16} /></button>
      </div>
      <p className="text-xs text-text-muted">Harbor Coffee Roasters - cloud allowed</p>

      <div className="rounded-control bg-gradient-to-br from-navy to-navy-hover p-4 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bronze">This week</p>
        <p className="mt-1 text-sm font-semibold leading-snug">Protect the wholesale launch, and stop adding scope.</p>
      </div>

      {planned === 0 ? (
        <div className="rounded-control border border-border p-4">
          <p className="text-sm font-semibold text-text-primary">Weekly plan draft is ready</p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">7 tasks for 4 people, matched to capacity. Waiting for your approval.</p>
          <Button size="sm" className="mt-3" onClick={() => onOpenCopilot('Weekly plan')}><CalendarRange size={14} /> Review plan</Button>
        </div>
      ) : (
        <div className="rounded-control border border-alert-success-stroke bg-alert-success-fill p-4 text-xs leading-relaxed text-alert-success-text">Plan approved. {planned} tasks are on the Planner board.</div>
      )}

      <div className="rounded-control border border-border p-4">
        <p className="text-sm font-semibold text-text-primary">Waiting for you</p>
        <ul className="mt-2 space-y-1.5 text-xs text-text-secondary">
          <li>2 email drafts to approve</li>
          <li>1 conflict with your brand guide</li>
          <li>2 decisions to review</li>
        </ul>
      </div>

      <div className="mt-auto space-y-3">
        <label className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 focus-within:ring-[3px] focus-within:ring-info/30">
          <input type="text" aria-label="Ask ZuriCopilot" placeholder="Ask about this business..." style={{ border: 0, boxShadow: 'none', background: 'transparent', outline: 0, padding: 0, height: 'auto' }} className="min-w-0 flex-1 text-sm text-text-primary placeholder:text-text-muted" />
        </label>
        <Button variant="outline" className="w-full" onClick={() => onOpenCopilot('Dashboard')}>Open full ZuriCopilot <ArrowRight size={14} /></Button>
      </div>
    </aside>
  )
}
