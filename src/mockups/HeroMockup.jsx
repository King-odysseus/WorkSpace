import React, { useState } from 'react'
import { BarChart3, Bell, CalendarDays, CheckSquare, ClipboardList, FileText, FolderOpen, Hash, HelpCircle, Home, ListChecks, MessageSquare, Monitor, Settings as SettingsIcon, Smartphone, Sparkles, Upload, Users, Activity as ActivityIcon, Flag, LayoutGrid, Download, Megaphone, Repeat } from 'lucide-react'
import { Sidebar, TabBar, TopBar } from './Shell.jsx'
import { applyWorkspaceTheme, readWorkspaceTheme } from '../lib/theme.js'
import * as A from './screensA.jsx'
import * as B from './screensB.jsx'

/*
 * Proposal: soft, modern surfaces for every WorkSpace screen.
 *
 * Built from the app's own primitives and Tailwind tokens (navy, bronze,
 * surface, text-*), so there is no second design vocabulary. The ideas:
 *
 *   1. Depth instead of lines: cards drop their 1px border and float on a soft,
 *      navy-tinted shadow that deepens on hover.
 *   2. Rounder shapes: cards 28px, tiles 24px, rows 20px; every button a pill and
 *      every icon-only button a circle.
 *   3. One surface per field: search and inputs are a single filled pill, never a
 *      bordered box with a second border inside it.
 *   4. A hero card where a page has one thing to say.
 *
 * Every existing feature stays. The shell (Shell.jsx) carries the collapsible
 * sidebar, workspace switcher, breadcrumb, refresh, Ask Zuri, light/dark switch,
 * Help, Messages, notifications and the profile menu. The two shadows below are
 * the only new values; if adopted they become --shadow-soft and --shadow-lift.
 *
 * Layouts use container-query breakpoints, so each screen reflows to its frame.
 */
const shadows = {
  '--shadow-soft': '0 1px 2px rgb(11 11 69 / 0.04), 0 8px 24px -6px rgb(11 11 69 / 0.10)',
  '--shadow-lift': '0 2px 4px rgb(11 11 69 / 0.05), 0 16px 36px -8px rgb(11 11 69 / 0.18)',
}

const screens = [
  { name: 'Sign in', icon: Home, group: 'Account', view: A.SignIn, bare: true },
  { name: 'Today', icon: Home, group: 'Overview', view: A.Today },
  { name: 'My tasks', icon: ClipboardList, group: 'Overview', view: A.MyTasks },
  { name: 'My planner', icon: ListChecks, group: 'Overview', view: A.MyPlanner },
  { name: 'Daily operations', icon: Repeat, group: 'Overview', view: A.DailyOps },
  { name: 'Team', icon: Users, group: 'Overview', view: A.Team },
  { name: 'Channels', icon: Hash, group: 'Collaborate', view: A.Channels },
  { name: 'Chats', icon: MessageSquare, group: 'Collaborate', view: A.Chats },
  { name: 'Follow-up', icon: Flag, group: 'Collaborate', view: A.FollowUp },
  { name: 'Check-ins', icon: CheckSquare, group: 'Collaborate', view: A.CheckIns },
  { name: 'Planner', icon: LayoutGrid, group: 'Work', view: A.Planner },
  { name: 'Projects', icon: FolderOpen, group: 'Work', view: A.Projects },
  { name: 'Calendar', icon: CalendarDays, group: 'Work', view: B.Calendar },
  { name: 'Files', icon: FileText, group: 'Work', view: B.Files },
  { name: 'Import data', icon: Upload, group: 'Work', view: B.ImportData },
  { name: 'Reports', icon: BarChart3, group: 'Insights', view: B.Reports },
  { name: 'Activity', icon: ActivityIcon, group: 'Insights', view: B.Activity },
  { name: 'Notifications', icon: Bell, group: 'More', view: B.Notifications },
  { name: 'Screen sharing', icon: Monitor, group: 'More', view: B.ScreenSharing },
  { name: "What's new", icon: Megaphone, group: 'More', view: B.WhatsNew },
  { name: 'Install app', icon: Download, group: 'More', view: B.InstallApp },
  { name: 'Help', icon: HelpCircle, group: 'More', view: B.Help },
  { name: 'Settings', icon: SettingsIcon, group: 'More', view: B.Settings },
  { name: 'Assistant', icon: Sparkles, group: 'More', view: B.Assistant },
]

const groups = [...new Set(screens.filter(screen => !screen.bare).map(screen => screen.group))]

const COLLAPSE_KEY = 'mockup-sidebar-collapsed'
const readCollapsed = () => { try { return window.localStorage.getItem(COLLAPSE_KEY) === 'true' } catch { return false } }

export default function HeroMockup() {
  const [active, setActive] = useState('Today')
  const [device, setDevice] = useState('desktop')
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [drawer, setDrawer] = useState(false)
  const [theme, setTheme] = useState(() => readWorkspaceTheme())
  const screen = screens.find(item => item.name === active) || screens[1]
  const View = screen.view
  const mobile = device === 'mobile'

  const toggleCollapsed = () => setCollapsed(current => {
    try { window.localStorage.setItem(COLLAPSE_KEY, String(!current)) } catch { /* private mode */ }
    return !current
  })
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; applyWorkspaceTheme(next); setTheme(next) }

  const body = screen.bare
    ? <div className="p-4"><View /></div>
    : <div className="flex min-h-0 flex-1 flex-col"><TopBar title={screen.name} mobile={mobile} theme={theme} onTheme={toggleTheme} /><div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-surface-secondary px-6 pb-32 pt-4 @3xl:px-14 @3xl:pb-20 @3xl:pt-8"><div className="mx-auto w-full max-w-[1280px] [&_.grid>*]:min-w-0"><View /></div></div></div>

  return (
    <main style={shadows} className="min-h-screen bg-surface-secondary px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-[1760px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Soft, modern surfaces: every screen</h1>
            <p className="max-w-2xl text-sm text-text-secondary">Shadows instead of hairlines, rounder shapes, pill buttons, circular icon buttons and single-surface search. Every existing feature is kept. Navy and bronze are unchanged.</p>
          </div>
          <div className="inline-flex rounded-full bg-surface p-1 shadow-[var(--shadow-soft)]">
            {[['desktop', Monitor, 'Desktop'], ['mobile', Smartphone, 'Mobile']].map(([id, Icon, label]) => (
              <button key={id} type="button" onClick={() => setDevice(id)} aria-pressed={device === id} className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium ${device === id ? 'bg-navy text-white' : 'text-text-muted'}`}><Icon size={16} />{label}</button>
            ))}
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Screens">
          {screens.map(({ name }) => (
            <button key={name} type="button" role="tab" aria-selected={active === name} onClick={() => setActive(name)} className={`rounded-full px-4 py-1.5 text-sm font-medium shadow-[var(--shadow-soft)] ${active === name ? 'bg-navy text-white' : 'bg-surface text-text-primary hover:-translate-y-0.5'}`}>{name}</button>
          ))}
        </div>

        {mobile ? (
          <div className="mx-auto w-[390px] max-w-full rounded-[48px] bg-navy p-3 shadow-[var(--shadow-lift)]">
            <div className="@container relative flex h-[800px] flex-col overflow-hidden rounded-[38px] bg-surface-secondary">
              {body}
              {!screen.bare && <TabBar active={active} onPick={setActive} onMore={() => setDrawer(true)} />}
              {drawer && (
                <div className="absolute inset-0 z-40 flex bg-navy/40">
                  <Sidebar drawer screens={screens} groups={groups} active={active} onPick={setActive} onClose={() => setDrawer(false)} />
                  <button type="button" aria-label="Dismiss sidebar" className="flex-1" onClick={() => setDrawer(false)} />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[32px] shadow-[var(--shadow-lift)]">
            <div className="@container flex h-[max(860px,calc(100vh-200px))] min-w-[1180px] overflow-hidden rounded-[32px] bg-surface-secondary">
              {!screen.bare && <Sidebar screens={screens} groups={groups} active={active} onPick={setActive} collapsed={collapsed} onToggle={toggleCollapsed} />}
              {body}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
