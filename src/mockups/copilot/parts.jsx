import React, { useState } from 'react'
import {
  Bell, CalendarRange, Check, ChevronDown, Cloud, FileText, HardDrive, Inbox, LayoutDashboard, Library, Mail, MessageSquare, Moon,
  Search, Settings as SettingsIcon, ShieldCheck, Sparkles, Sun, Target, Users, Compass, ListChecks, Cpu, Plus, Lock,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

/*
 * Shared pieces for the ZuriCopilot mockup. Everything uses the app's own
 * primitives and Tailwind tokens (navy, bronze, surface, text-*, status
 * colours). No second design vocabulary.
 */

export const BUSINESSES = [
  { id: 'harbor', name: 'Harbor Coffee Roasters', short: 'H', localOnly: false },
  { id: 'tidewater', name: 'Tidewater Studio', short: 'T', localOnly: true },
  { id: 'northline', name: 'Northline Logistics', short: 'N', localOnly: false },
]

export const NAV = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Weekly plan', icon: CalendarRange },
  { name: 'Chat', icon: MessageSquare },
  { name: 'Strategy', icon: Compass },
  { name: 'Documents', icon: Library },
  { name: 'Tasks', icon: ListChecks },
  { name: 'Email', icon: Mail },
  { name: 'Research', icon: Search },
  { name: 'Team insights', icon: Users },
  { name: 'Approvals', icon: Inbox, count: 5 },
  { name: 'Models', icon: Cpu },
  { name: 'Settings', icon: SettingsIcon },
]

export function Rail({ active, onPick, business, onBusiness }) {
  const [open, setOpen] = useState(false)
  const current = BUSINESSES.find(item => item.id === business)
  return (
    <aside aria-label="ZuriCopilot navigation" className="flex w-[248px] shrink-0 flex-col gap-4 overflow-y-auto bg-navy px-4 py-5 text-white">
      <div className="flex items-center gap-3 px-2">
        <span className="grid size-10 place-items-center rounded-full bg-white text-navy"><Sparkles size={20} /></span>
        <div className="leading-tight">
          <p className="text-base font-bold">ZuriCopilot</p>
          <p className="text-[11px] text-white/60">Desktop only</p>
        </div>
      </div>

      <div>
        <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Business</p>
        <button type="button" aria-expanded={open} aria-label="Switch business" onClick={() => setOpen(value => !value)} className="flex w-full items-center gap-3 rounded-full bg-white/10 px-3 py-2.5 text-left">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bronze text-xs font-bold text-navy">{current.short}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{current.name}</span>
          <ChevronDown size={15} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="mt-2 space-y-1 rounded-2xl bg-white/10 p-2">
            {BUSINESSES.map(item => (
              <button key={item.id} type="button" onClick={() => { onBusiness(item.id); setOpen(false) }} className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm hover:bg-white/10">
                <span className="flex-1 truncate">{item.name}</span>
                {item.localOnly && <Lock size={13} className="text-bronze" aria-label="Local-only" />}
                {item.id === business && <Check size={14} className="text-bronze" />}
              </button>
            ))}
            <button type="button" className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm text-bronze hover:bg-white/10"><Plus size={14} /> Link another workspace</button>
          </div>
        )}
      </div>

      <nav className="space-y-1">
        {NAV.map(({ name, icon: Icon, count }) => (
          <button key={name} type="button" aria-current={active === name ? 'page' : undefined} onClick={() => onPick(name)} className={`flex w-full items-center gap-3 rounded-full px-4 py-2 text-left text-sm font-medium transition-colors ${active === name ? 'bg-white text-navy' : 'text-white/80 hover:bg-white/10'}`}>
            <Icon size={18} />
            <span className="flex-1">{name}</span>
            {count ? <span className="grid min-w-5 place-items-center rounded-full bg-bronze px-1.5 text-[11px] font-bold leading-5 text-navy">{count}</span> : null}
          </button>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl bg-white/10 p-4">
        <p className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} className="text-bronze" /> Documents stay on this device</p>
        <p className="mt-1 text-[11px] leading-relaxed text-white/70">Cloud models only see the excerpts you approve.</p>
      </div>
    </aside>
  )
}

export function TopBar({ title, business, theme, onTheme }) {
  const current = BUSINESSES.find(item => item.id === business)
  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface px-8 py-4">
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{current.name}</p>
        <h1 className="text-xl font-bold text-text-primary">{title}</h1>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {current.localOnly
          ? <Badge variant="secondary" className="gap-1.5 px-3 py-1.5 text-xs"><Lock size={12} /> Local-only: nothing leaves this device</Badge>
          : <Badge variant="outline" className="gap-1.5 px-3 py-1.5 text-xs"><Cloud size={12} /> Cloud allowed</Badge>}
        <button type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={onTheme} className="grid size-10 place-items-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-hover">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button type="button" aria-label="Notifications" className="relative grid size-10 place-items-center rounded-full border border-border bg-surface text-text-primary hover:bg-surface-hover">
          <Bell size={16} />
          <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-5 text-white">3</span>
        </button>
      </div>
    </div>
  )
}

// Which model answered, and whether it ran on this device or in the cloud.
export function ModelChip({ name, kind = 'cloud', note }) {
  const Icon = kind === 'local' ? HardDrive : Cloud
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-2.5 py-1 text-[11px] font-semibold text-text-secondary" title={note}>
      <Icon size={12} /> {name} <span className="font-normal text-text-muted">{kind === 'local' ? 'Local' : 'Cloud'}</span>
    </span>
  )
}

// A cited document and page or section, as the copilot shows it under an answer.
export function SourceChip({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-text-secondary">
      <FileText size={11} /> {children}
    </span>
  )
}

// Where an insight came from inside the copilot's own memory.
export function FromChip({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2.5 py-1 text-[11px] font-semibold text-info">
      <MessageSquare size={11} /> {children}
    </span>
  )
}

export function Panel({ title, sub, action, children, className = '' }) {
  return (
    <Card className={className}>
      <div className="flex items-start justify-between gap-3 px-6 pt-5">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="px-6 pb-5 pt-4">{children}</div>
    </Card>
  )
}

export function StatTile({ label, value, sub, tone = 'neutral', icon: Icon = Target }) {
  const toneText = { neutral: 'text-text-muted', good: 'text-success', warn: 'text-warning', bad: 'text-danger' }[tone]
  return (
    <Card className="gap-1 px-5 py-4">
      <div className="flex items-center justify-between text-text-muted">
        <span className="text-xs font-medium">{label}</span>
        <Icon size={15} aria-hidden="true" />
      </div>
      <p className="text-2xl font-bold text-text-primary">{value}</p>
      <p className={`text-xs font-medium ${toneText}`}>{sub}</p>
    </Card>
  )
}

export function Notice({ icon: Icon = ShieldCheck, children }) {
  return (
    <div className="flex items-start gap-3 rounded-control border border-alert-info-stroke bg-alert-info-fill px-4 py-3 text-xs leading-relaxed text-alert-info-text">
      <Icon size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  )
}
