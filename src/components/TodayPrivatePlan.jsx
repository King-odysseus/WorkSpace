import { useEffect, useState } from 'react'
import { readJsonResponse } from '../lib/workspace-format.js'

export default function TodayPrivatePlan({ workspaceId, userId, today, onOpenPlanner }) {
  const key = `workspace-private-today:${userId}:${workspaceId}`
  const [visible, setVisible] = useState(() => localStorage.getItem(key) === 'true')
  const [tasks, setTasks] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    setVisible(localStorage.getItem(key) === 'true')
    setTasks([])
  }, [key])

  useEffect(() => {
    if (!visible || !workspaceId) return undefined
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/personal/planners/`, {
      credentials: 'include',
      headers: { 'X-Workspace-Id': String(workspaceId) },
    }).then(async response => {
      const data = await readJsonResponse(response, 'Private plan could not be loaded.')
      if (!response.ok) throw new Error(data?.error || 'Private plan could not be loaded.')
      return data
    }).then(data => {
      if (!cancelled) { setTasks(data.tasks || []); setError('') }
    }).catch(failure => { if (!cancelled) setError(failure.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [visible, workspaceId, revision])

  const toggle = () => {
    const next = !visible
    localStorage.setItem(key, String(next))
    setVisible(next)
  }
  const dayTasks = tasks.filter(task => !task.is_done && (!task.due_date || task.due_date <= today)).slice(0, 5)

  return <section className="mt-5 rounded-card border border-border bg-card p-5" aria-label="Private plan">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-[16px] font-semibold text-text-primary">Private plan</h2><p className="text-sm text-text-muted">Only you can see these items.</p></div>
      <button type="button" className="secondary-button" aria-expanded={visible} onClick={toggle}>{visible ? 'Hide private plan' : 'Show private plan'}</button>
    </div>
    {visible && <div className="mt-4">
      {loading && <p role="status">Loading your plan...</p>}
      {!loading && error && <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
      {!loading && !error && (dayTasks.length ? <ul className="space-y-2">{dayTasks.map(task => <li key={task.id} className="rounded-icon bg-surface-secondary px-3 py-2 text-sm text-text-primary">{task.title}</li>)}</ul> : <p className="text-sm text-text-muted">Nothing open in your private plan for today.</p>)}
      <button type="button" className="mt-3 text-sm font-semibold text-primary underline" onClick={onOpenPlanner}>Open my planner</button>
    </div>}
  </section>
}
