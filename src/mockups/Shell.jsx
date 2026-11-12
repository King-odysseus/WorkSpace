import React, { useState } from 'react'
import {
  Bell, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, HelpCircle, Hash, Home, LayoutGrid, LogOut,
  MessageSquare, Moon, MoreHorizontal, RefreshCw, Settings as SettingsIcon, Sparkles, Sun, User, X, Check, Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PillSearch } from './kit.jsx'
import Avatar from '../components/Avatar.jsx'

/*
 * The app shell, kept feature-for-feature with the real one (src/main.jsx):
 *
 *   Sidebar    collapsible to an icon rail (the edge button, remembered between
 *              visits), workspace switcher, grouped nav with a Follow-up count,
 *              dismissible upgrade card. On a phone it becomes the drawer opened
 *              by the More tab.
 *   Top bar    breadcrumb, workspace search ("/" focuses it), hard refresh,
 *              Ask Zuri, light/dark switch, Help, Messages, notifications with an
 *              unread count, and the profile menu (Settings, Sign out).
 *   Phone      seven-slot tab bar with Today in the middle.
 *
 * Anything the real shell does that is not listed here still has to be carried
 * into the final design; see the checklist in the pull request or the chat.
 */

const iconButton = 'relative grid size-11 shrink-0 place-items-center rounded-full bg-surface text-text-primary shadow-[var(--shadow-soft)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]'

export function IconBtn({ label, children, badge, onClick, pressed }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} aria-pressed={pressed} className={iconButton}>
      {children}
      {badge ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white">{badge}</span> : null}
    </button>
  )
}

export function Sidebar({ screens, groups, active, onPick, collapsed, onToggle, drawer = false, onClose }) {
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [upgrade, setUpgrade] = useState(true)
  const rail = collapsed && !drawer
  const counts = { 'Follow-up': 3 }

  return (
    <div className={`relative shrink-0 ${drawer ? 'h-full w-[300px]' : `hidden @3xl:block ${rail ? 'w-[104px]' : 'w-[290px]'} transition-[width] duration-200`}`}>
      <aside aria-label="Sidebar" className={`flex h-full flex-col overflow-y-auto overflow-x-hidden bg-navy py-8 text-white ${rail ? 'px-4' : 'px-5'} ${drawer ? 'rounded-r-[32px] shadow-[var(--shadow-lift)]' : ''}`}>
        <div className={`mb-6 flex items-center ${rail ? 'justify-center' : 'justify-between px-3'}`}>
          <span className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-full bg-white text-navy"><Sparkles size={20} /></span>{!rail && <span className="text-lg font-bold">WorkSpace</span>}</span>
          {drawer && <button type="button" aria-label="Close sidebar" onClick={onClose} className="grid size-10 place-items-center rounded-full bg-white/10"><X size={18} /></button>}
        </div>

        <div className="mb-8">
          <button type="button" aria-expanded={workspaceOpen} aria-label="Switch workspace" title="Visual QA Workspace" onClick={() => setWorkspaceOpen(open => !open)} className={`flex w-full items-center gap-3 rounded-full bg-white/10 py-3 ${rail ? 'justify-center px-0' : 'px-4'}`}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bronze text-xs font-bold text-navy">V</span>
            {!rail && <><span className="flex-1 truncate text-left text-sm font-semibold">Visual QA Workspace</span><ChevronDown size={16} className={`transition-transform ${workspaceOpen ? 'rotate-180' : ''}`} /></>}
          </button>
          {workspaceOpen && !rail && (
            <div className="mt-3 space-y-1 rounded-3xl bg-white/10 p-2">
              {[['Visual QA Workspace', true], ['Northstar', false]].map(([name, on]) => <button key={name} type="button" className="flex w-full items-center justify-between rounded-full px-4 py-2.5 text-left text-sm hover:bg-white/10">{name}{on && <Check size={15} className="text-bronze" />}</button>)}
              <button type="button" className="flex w-full items-center gap-2 rounded-full px-4 py-2.5 text-left text-sm text-bronze hover:bg-white/10"><Plus size={15} /> Create workspace</button>
            </div>
          )}
        </div>

        {groups.map(group => (
          <div key={group} className="mb-9">
            {rail
              ? <span className="mx-auto mb-4 block h-1 w-6 rounded-full bg-white/20" aria-hidden="true" />
              : <p className="mb-3 px-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">{group}</p>}
            <div className="space-y-2">
              {screens.filter(screen => screen.group === group).map(({ name, icon: Icon }) => (
                <button key={name} type="button" title={name} aria-label={name} aria-current={active === name ? 'page' : undefined} onClick={() => { onPick(name); onClose?.() }} className={`relative flex w-full items-center rounded-full py-3.5 text-left text-sm font-medium transition-colors ${rail ? 'justify-center px-0' : 'gap-3 px-5'} ${active === name ? 'bg-white text-navy shadow-[var(--shadow-soft)]' : 'text-white/80 hover:bg-white/10'}`}>
                  <Icon size={19} />
                  {!rail && name}
                  {counts[name] && (rail
                    ? <span className="absolute right-2 top-2 size-2.5 rounded-full bg-orange-500" />
                    : <span className="ml-auto grid min-w-6 place-items-center rounded-full bg-orange-500 px-1.5 text-[11px] font-bold leading-6 text-white">{counts[name]}</span>)}
                </button>
              ))}
            </div>
          </div>
        ))}

        {upgrade && !rail && (
          <div className="mt-auto rounded-3xl bg-gradient-to-br from-white/15 to-white/5 p-5">
            <div className="mb-2 flex items-start justify-between"><span className="grid size-9 place-items-center rounded-full bg-bronze text-navy"><Sparkles size={16} /></span><button type="button" aria-label="Dismiss upgrade card" onClick={() => setUpgrade(false)} className="text-white/60 hover:text-white"><X size={16} /></button></div>
            <p className="text-sm font-semibold">Unlock more with Pro</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">Higher storage, reports and priority support.</p>
            <Button variant="gold" size="sm" className="mt-4 w-full">See plans</Button>
          </div>
        )}
      </aside>

      {!drawer && (
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={rail ? 'Expand sidebar' : 'Collapse sidebar'} className="absolute -right-4 top-28 z-20 grid size-9 place-items-center rounded-full bg-surface text-text-primary shadow-[var(--shadow-lift)] transition-transform hover:scale-105">
          {rail ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      )}
    </div>
  )
}

export function TopBar({ title, mobile, theme, onTheme }) {
  const [profile, setProfile] = useState(false)
  return (
    <div className="relative z-30 flex items-center gap-3 bg-surface-secondary px-6 py-5 @3xl:gap-4 @3xl:px-14 @3xl:py-6">
      {!mobile && <nav aria-label="Breadcrumb" className="mr-2 hidden items-center gap-2 text-sm text-text-muted @3xl:flex"><span>Visual QA Workspace</span><ChevronRight size={14} /><span className="font-semibold text-text-primary">{title}</span></nav>}
      <PillSearch placeholder="Search workspace" className="flex-1 @3xl:max-w-xl" />
      <span className="hidden rounded-full bg-surface-secondary px-2.5 py-1 text-xs text-text-muted @3xl:inline" aria-hidden="true">/</span>
      <div className="ml-auto flex items-center gap-3">
        <IconBtn label="Hard refresh WorkSpace"><RefreshCw size={17} /></IconBtn>
        <button type="button" aria-label="Ask Zuri" title="Ask Zuri" className="hidden h-11 items-center gap-2 rounded-full bg-info-soft px-5 text-sm font-semibold text-info shadow-[var(--shadow-soft)] @3xl:inline-flex"><Sparkles size={16} /> Assistant</button>
        <IconBtn label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={onTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconBtn>
        <span className="hidden @3xl:contents"><IconBtn label="Help"><HelpCircle size={17} /></IconBtn><IconBtn label="Open messages" badge={2}><MessageSquare size={17} /></IconBtn></span>
        <IconBtn label="Open workspace activity notifications" badge={7}><Bell size={17} /></IconBtn>
        <div className="relative">
          <button type="button" aria-label="Open profile menu" aria-expanded={profile} onClick={() => setProfile(open => !open)} className="flex items-center gap-1 rounded-full bg-surface p-1 pr-3 shadow-[var(--shadow-soft)]"><Avatar name="Nate Foster" presence="available" /><ChevronDown size={14} className="text-text-muted" /></button>
          {profile && (
            <div role="menu" className="absolute right-0 top-14 w-60 rounded-3xl bg-surface p-3 shadow-[var(--shadow-lift)]">
              <div className="px-4 py-3"><p className="text-sm font-semibold text-text-primary">Nate Foster</p><p className="text-xs text-text-muted">nate@example.com</p></div>
              {[[User, 'Profile'], [SettingsIcon, 'Settings']].map(([Icon, label]) => <button key={label} type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-full px-4 py-3 text-left text-sm text-text-primary hover:bg-surface-secondary"><Icon size={16} />{label}</button>)}
              <button type="button" role="menuitem" className="flex w-full items-center gap-3 rounded-full px-4 py-3 text-left text-sm text-danger hover:bg-danger-soft"><LogOut size={16} /> Sign out</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function TabBar({ active, onPick, onMore }) {
  const tabs = [['My tasks', ClipboardList], ['Planner', LayoutGrid], ['Channels', Hash], ['Today', Home], ['Chats', MessageSquare], ['Check-ins', CheckSquare], ['More', MoreHorizontal]]
  return (
    <nav aria-label="Primary" className="absolute inset-x-3 bottom-3 z-10 flex rounded-full bg-navy px-2 py-2 text-white shadow-[var(--shadow-lift)]">
      {tabs.map(([name, Icon]) => (
        <button key={name} type="button" onClick={() => (name === 'More' ? onMore() : onPick(name))} className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-full px-0.5 py-2 font-medium ${active === name ? 'bg-white text-navy' : 'text-white/70'}`}><Icon size={17} /><span className="max-w-full truncate" style={{ fontSize: 9, lineHeight: 1 }}>{name}</span></button>
      ))}
    </nav>
  )
}
