import { useEffect, useState } from 'react'

export default function FirstSessionChecklist({ workspaceId, userId, isManager, onNavigate, onCreateTask, onInvite }) {
  const key = `workspace-first-session-dismissed:${userId}:${workspaceId}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(key) === 'true')
  useEffect(() => { setDismissed(localStorage.getItem(key) === 'true') }, [key])
  if (dismissed) return null

  const steps = [
    { label: 'Create or complete a task', action: onCreateTask, button: 'Add a task' },
    { label: 'Plan your day', action: () => onNavigate('My planner'), button: 'Open my planner' },
    { label: 'Set notification preferences', action: () => onNavigate('Settings'), button: 'Open settings' },
  ]
  if (isManager) steps.push({ label: 'Invite a teammate', action: onInvite, button: 'Invite' })

  return <section className="mt-5 rounded-card border border-border bg-card p-5" aria-label="Getting started">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-[16px] font-semibold text-text-primary">Get started</h2><p className="text-sm text-text-muted">A few useful first steps in this workspace.</p></div>
      <button type="button" className="text-sm text-text-secondary underline" onClick={() => { localStorage.setItem(key, 'true'); setDismissed(true) }}>Dismiss</button>
    </div>
    <ul className="mt-4 grid gap-2 sm:grid-cols-2">{steps.map(step => <li key={step.label} className="flex items-center justify-between gap-3 rounded-icon bg-surface-secondary px-3 py-2 text-sm"><span>{step.label}</span><button type="button" className="font-semibold text-primary underline" onClick={step.action}>{step.button}</button></li>)}</ul>
  </section>
}
