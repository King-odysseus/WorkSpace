import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, LayoutGrid, List, Sparkles } from 'lucide-react'
import StickyNote from './StickyNote.jsx'
import { TaskProgressActions, TaskProgressBar, taskProgressValue } from './TaskProgressBar.jsx'
import { parsePlan } from '../lib/day-plan-parse.js'
import { workspaceCall, isoDate } from '../lib/workspace-api.js'

// A board (or list) on Today: the blocks of today's day plan if there is one (the
// block you are in right now is marked), then the tasks assigned to you that are
// wanted now, then your open planner items. Tasks and planner items can be ticked
// off and given a percentage right here; plan blocks are time slots, not tasks, so
// they have neither. Selecting a note opens My planner.
const MAX_NOTES = 8
const UNDO_MS = 8000
const minutes = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m }

export default function TodayStickyNotes({ workspaceId, teamTasks = [], onCompleteTask, onOpenPlanner }) {
  const setTeamProgress = useContext(TaskProgressActions)
  const [plan, setPlan] = useState(null)
  const [personal, setPersonal] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState([])
  const timers = useRef([])
  // Shut by default so Today stays short; what the person chooses is remembered.
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('today-sticky-open') === 'true' } catch { return false } })
  const [view, setView] = useState(() => { try { return localStorage.getItem('today-sticky-view') === 'list' ? 'list' : 'board' } catch { return 'board' } })
  const remember = (key, value) => { try { localStorage.setItem(key, value) } catch { /* not remembered */ } }
  const toggleOpen = () => setOpen(current => { remember('today-sticky-open', String(!current)); return !current })
  const chooseView = next => { setView(next); remember('today-sticky-view', next) }

  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    const today = isoDate(new Date())
    Promise.all([
      workspaceCall(workspaceId, `personal/day-plan/?date=${today}`, 'GET').catch(() => ({ note: null })),
      workspaceCall(workspaceId, 'personal/planners/', 'GET').catch(() => ({ tasks: [] })),
    ]).then(([planData, plannerData]) => {
      if (cancelled) return
      setPlan(planData.note)
      setPersonal(Array.isArray(plannerData.tasks) ? plannerData.tasks : [])
      setLoaded(true)
    })
    return () => { cancelled = true; timers.current.forEach(clearTimeout) }
  }, [workspaceId])

  const rememberDone = entry => {
    setRecent(current => [...current.filter(item => item.key !== entry.key), entry])
    timers.current.push(setTimeout(() => setRecent(current => current.filter(item => item.key !== entry.key)), UNDO_MS))
  }

  const patchPersonal = async (item, patch) => {
    setError('')
    const before = item
    setPersonal(current => current.map(task => (task.id === item.id ? { ...task, ...patch } : task)))
    try {
      const saved = (await workspaceCall(workspaceId, `personal/tasks/${item.id}/`, 'PATCH', patch)).task
      setPersonal(current => current.map(task => (task.id === item.id ? saved : task)))
      return saved
    } catch (failure) {
      setPersonal(current => current.map(task => (task.id === item.id ? before : task)))
      setError(failure.message || 'That did not save.')
      return null
    }
  }

  const finish = async note => {
    if (note.kind === 'team') {
      rememberDone({ key: note.id, title: note.title, undo: () => onCompleteTask?.(note.raw.id) })
      await onCompleteTask?.(note.raw.id)
    } else if (note.kind === 'personal') {
      const saved = await patchPersonal(note.raw, { is_done: true })
      if (saved) rememberDone({ key: note.id, title: note.title, undo: () => patchPersonal(saved, { is_done: false }) })
    }
  }
  const setPercent = async (note, percent) => {
    if (note.kind === 'team') return setTeamProgress?.(note.raw, percent)
    if (percent === 100) return finish(note)
    return patchPersonal(note.raw, { progress_percent: percent })
  }

  const notes = useMemo(() => {
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const blocks = plan ? parsePlan(plan.body).blocks : []
    const fromPlan = blocks.map(block => ({
      id: `plan-${block.key}`,
      kind: 'plan',
      header: `${block.start} - ${block.end}`,
      chip: block.duration,
      title: block.title,
      detail: (plan.notes || {})[block.key] || block.detail,
      tone: block.kind,
      active: minutes(block.start) <= nowMinutes && nowMinutes < minutes(block.end),
      past: minutes(block.end) <= nowMinutes,
    }))
    const planNotes = [...fromPlan.filter(note => !note.past), ...fromPlan.filter(note => note.past)]
    const fromTeam = teamTasks
      .filter(task => task.status !== 'done' && task.status !== 'cancelled')
      .map(task => ({
        id: `team-${task.id}`,
        kind: 'team',
        raw: task,
        header: task.due_date ? `Due ${task.due_date}` : 'Assigned to you',
        chip: task.project || task.workstream || '',
        title: task.title,
        detail: '',
        tone: 'task',
        active: Boolean(task.due_date && task.due_date < isoDate(now)),
      }))
    const fromPersonal = personal
      .filter(task => !task.is_done)
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
      .map(task => ({
        id: `personal-${task.id}`,
        kind: 'personal',
        raw: task,
        header: task.due_date ? `Due ${task.due_date}${task.due_time ? ` ${task.due_time}` : ''}` : 'My planner',
        chip: '',
        title: task.title,
        detail: task.notes ? task.notes.slice(0, 90) : '',
        tone: 'task',
        active: false,
      }))
    return [...planNotes, ...fromTeam, ...fromPersonal]
  }, [plan, teamTasks, personal])

  if (!loaded) return null
  const shown = notes.slice(0, MAX_NOTES)
  const canTick = note => note.kind === 'team' || note.kind === 'personal'
  const progressFor = note => (
    <TaskProgressBar
      className="sticky-progress"
      value={taskProgressValue(note.raw)}
      title={note.title}
      onChange={percent => setPercent(note, percent)}
    />
  )
  const tickFor = note => (
    <button type="button" className="sticky-tick" onClick={() => finish(note)} aria-label={`Mark ${note.title} complete`} aria-pressed={false}>
      <Check size={12} aria-hidden="true" />
    </button>
  )

  return (
    <section className="today-sticky" aria-label="Zuri day plan">
      <header className="today-sticky-head">
        <button type="button" className="today-sticky-toggle" aria-expanded={open} aria-controls="today-sticky-body" onClick={toggleOpen}>
          {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <span>
            <strong><Sparkles size={16} aria-hidden="true" /> Zuri&apos;s day plan</strong>
            <small>{open ? 'Zuri&apos;s plan for today, your tasks and your planner items. Only you can see your planner items.' : `${notes.length} ${notes.length === 1 ? 'item' : 'items'} - select to show`}</small>
          </span>
        </button>
        {open && <div className="today-sticky-tools">
          <div className="plan-view-toggle" role="group" aria-label="Sticky notes view">
            <button type="button" aria-pressed={view === 'board'} className={view === 'board' ? 'is-active' : ''} onClick={() => chooseView('board')}><LayoutGrid size={14} aria-hidden="true" /> Board</button>
            <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => chooseView('list')}><List size={14} aria-hidden="true" /> List</button>
          </div>
          <button type="button" className="secondary-button" onClick={onOpenPlanner}>Open planner</button>
        </div>}
      </header>
      {open && <div id="today-sticky-body">
        {error && <p className="memo-error" role="alert">{error}</p>}
        {recent.map(entry => (
          <p className="today-sticky-undo" role="status" key={entry.key}>
            Completed &quot;{entry.title}&quot;.
            <button type="button" onClick={() => { setRecent(current => current.filter(item => item.key !== entry.key)); entry.undo() }}>Undo</button>
          </p>
        ))}
        {shown.length
          ? view === 'list'
            ? <ol className="plan-list" aria-label="Sticky notes as a list">
              {shown.map(note => (
                <li key={note.id} className={`plan-row is-${note.tone === 'break' ? 'break' : 'work'}${canTick(note) ? ' has-actions' : ''}`}>
                  <div className="plan-row-time">
                    {canTick(note) && tickFor(note)}
                    <strong>{note.header}</strong>
                  </div>
                  <div className="plan-row-main">
                    <div className="plan-row-title"><strong>{note.title}</strong>{note.chip && <em>{note.chip}</em>}</div>
                    {note.detail && <p>{note.detail}</p>}
                  </div>
                  {canTick(note) && <div className="plan-row-actions">{progressFor(note)}</div>}
                </li>
              ))}
            </ol>
            : <div className="plan-board" role="list" aria-label="Sticky notes">
              {shown.map((note, index) => (
                <StickyNote
                  key={note.id}
                  header={note.header}
                  chip={note.chip}
                  title={note.title}
                  detail={note.detail}
                  tone={note.tone}
                  tilt={index}
                  active={note.active}
                  leading={canTick(note) ? tickFor(note) : undefined}
                  onClick={onOpenPlanner}
                  label={`Open planner: ${note.title}`}
                >
                  {canTick(note) && progressFor(note)}
                </StickyNote>
              ))}
            </div>
          : <p className="today-sticky-empty">Nothing here yet. Use Plan my day, or add items in My planner, and they will appear as notes.</p>}
        {notes.length > shown.length && <p className="memo-card-meta">{notes.length - shown.length} more in My planner.</p>}
      </div>}
    </section>
  )
}
