import React, { useState } from 'react'
import { LayoutGrid, Minus, PanelRight, Settings as SettingsIcon, Sparkles, Square, X } from 'lucide-react'
import { applyWorkspaceTheme, readWorkspaceTheme } from '../../lib/theme.js'
import Chat from './Chat.jsx'
import Dashboard from './Dashboard.jsx'
import WeeklyPlan from './WeeklyPlan.jsx'
import { WorkspaceView } from './WorkspaceMode.jsx'
import { Rail, TopBar } from './parts.jsx'

/*
 * Option A: the desktop shell.
 *
 *   Desktop rail (far left, drawn by the Electron shell)
 *     Workspace      the full existing web app, exactly as today
 *     ZuriCopilot    the Copilot's own screens
 *     Dock           shows the Copilot panel beside the web app
 *
 * The web app is not edited. The rail, the dock and every Copilot screen are
 * desktop-only and live outside the web bundle. This page is a design proposal,
 * served only by the mockup dev server, not part of the production build.
 */

// The two proposed shadows the repo's existing mockup shell relies on.
const shadows = {
  '--shadow-soft': '0 1px 2px rgb(11 11 69 / 0.04), 0 8px 24px -6px rgb(11 11 69 / 0.10)',
  '--shadow-lift': '0 2px 4px rgb(11 11 69 / 0.05), 0 16px 36px -8px rgb(11 11 69 / 0.18)',
}

function ShellButton({ label, icon: Icon, active, onClick, badge, pressed }) {
  return (
    <button type="button" aria-label={label} title={label} aria-current={active ? 'page' : undefined} aria-pressed={pressed} onClick={onClick} className={`relative flex w-full flex-col items-center gap-1.5 overflow-hidden rounded-2xl px-1 py-2.5 ${active ? 'bg-white text-navy' : 'text-white/70 hover:bg-white/10'}`}>
      <Icon size={20} />
      <span style={{ fontSize: 10, lineHeight: 1.1 }} className="max-w-full text-center font-medium">{label}</span>
      {badge ? <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-bronze px-1 text-[10px] font-bold leading-4 text-navy">{badge}</span> : null}
    </button>
  )
}

export default function CopilotMockup() {
  const [mode, setMode] = useState('copilot')
  const [screen, setScreen] = useState('Dashboard')
  const [wsActive, setWsActive] = useState('Planner')
  const [collapsed, setCollapsed] = useState(false)
  const [dock, setDock] = useState(false)
  const [business, setBusiness] = useState('harbor')
  const [created, setCreated] = useState([])
  const [theme, setTheme] = useState(() => readWorkspaceTheme())
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; applyWorkspaceTheme(next); setTheme(next) }

  const openCopilot = name => { setScreen(name); setMode('copilot') }
  const isChat = mode === 'copilot' && screen === 'Chat'

  const copilotBody = (
    <>
      <Rail active={screen} onPick={name => (['Dashboard', 'Weekly plan', 'Chat'].includes(name) ? setScreen(name) : null)} business={business} onBusiness={setBusiness} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={screen} business={business} theme={theme} onTheme={toggleTheme} />
        <div className={`min-h-0 flex-1 ${isChat ? 'overflow-hidden' : 'overflow-y-auto px-8 py-6'}`}>
          {isChat && <Chat />}
          {mode === 'copilot' && screen === 'Dashboard' && <div className="mx-auto w-full max-w-[1240px]"><Dashboard onPlan={() => setScreen('Weekly plan')} /></div>}
          {mode === 'copilot' && screen === 'Weekly plan' && (
            <div className="mx-auto w-full max-w-[1240px]">
              <WeeklyPlan created={created.length ? created : null} onApprove={tasks => setCreated(tasks)} onViewPlanner={() => { setWsActive('Planner'); setMode('workspace') }} />
            </div>
          )}
        </div>
      </div>
    </>
  )

  return (
    <main style={shadows} className="min-h-screen bg-surface-secondary px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[1760px]">
        <div className="mb-5">
          <h1 className="text-xl font-bold text-text-primary">WorkSpace Desktop with ZuriCopilot (option A)</h1>
          <p className="max-w-3xl text-sm text-text-secondary">Left rail switches between the full existing WorkSpace and ZuriCopilot. The web app is untouched. Try: Dashboard, Turn into tasks, Approve, View in Planner. Use the panel icon to dock the Copilot beside the web app. Fictional data.</p>
        </div>

        <div className="overflow-x-auto rounded-control border border-border shadow-card">
          <div className="@container flex h-[max(840px,calc(100vh-190px))] min-w-[1280px] flex-col overflow-hidden bg-surface-secondary">
            <div className="flex h-9 shrink-0 items-center justify-between bg-navy-dark pl-4 text-xs text-white/80">
              <span className="flex items-center gap-2"><Sparkles size={13} /> WorkSpace - Harbor Coffee Roasters</span>
              <span className="flex" aria-hidden="true">
                {[Minus, Square, X].map((Icon, index) => <span key={index} className="grid h-9 w-12 place-items-center hover:bg-white/10"><Icon size={13} /></span>)}
              </span>
            </div>
            <div className="flex min-h-0 flex-1">
              <nav aria-label="Desktop" className="flex w-[76px] shrink-0 flex-col gap-2 bg-navy-dark px-2 py-4">
                <ShellButton label="Workspace" icon={LayoutGrid} active={mode === 'workspace'} onClick={() => setMode('workspace')} />
                <ShellButton label="ZuriCopilot" icon={Sparkles} active={mode === 'copilot'} onClick={() => setMode('copilot')} badge={created.length ? null : 5} />
                {mode === 'workspace' && <ShellButton label="Dock panel" icon={PanelRight} pressed={dock} active={false} onClick={() => setDock(value => !value)} />}
                <div className="mt-auto"><ShellButton label="App settings" icon={SettingsIcon} onClick={() => {}} /></div>
              </nav>
              {mode === 'workspace'
                ? <WorkspaceView active={wsActive} onPick={setWsActive} collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} theme={theme} onTheme={toggleTheme} created={created} onOpenCopilot={openCopilot} dock={dock} onDock={() => setDock(false)} />
                : copilotBody}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
