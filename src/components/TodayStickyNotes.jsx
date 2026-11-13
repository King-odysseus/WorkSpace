import React, { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, LayoutGrid, List, StickyNote as StickyIcon } from 'lucide-react'
import StickyNote from './StickyNote.jsx'
import { parsePlan } from '../lib/day-plan-parse.js'
import { workspaceCall, isoDate } from '../lib/workspace-api.js'

// A board of sticky notes on Today: the blocks of today's day plan if there is one
// (the block you are in right now is marked), then your open planner items. Both
// are private to you. Selecting a note opens My planner, where they are edited.
const MAX_NOTES = 8
const minutes = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m }

export default function TodayStickyNotes({ workspaceId, onOpenPlanner }) {
  const [plan, setPlan] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loaded, setLoaded] = useState(false)
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
      setTasks(Array.isArray(plannerData.tasks) ? plannerData.tasks : [])
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [workspaceId])

  const notes = useMemo(() => {
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const blocks = plan ? parsePlan(plan.body).blocks : []
    const fromPlan = blocks.map(block => ({
      id: `plan-${block.key}`,
      header: `${block.start} - ${block.end}`,
      chip: block.duration,
      title: block.title,
      detail: (plan.notes || {})[block.key] || block.detail,
      tone: block.kind,
      active: minutes(block.start) <= nowMinutes && nowMinutes < minutes(block.end),
      // Past blocks go to the back so the board starts with what is next.
      past: minutes(block.end) <= nowMinutes,
    }))
    const upcoming = [...fromPlan.filter(note => !note.past), ...fromPlan.filter(note => note.past)]
    const fromPlanner = tasks
      .filter(task => !task.is_done)
      .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')))
      .map(task => ({
        id: `task-${task.id}`,
        header: task.due_date ? `Due ${task.due_date}${task.due_time ? ` ${task.due_time}` : ''}` : 'My planner',
        chip: task.progress_percent ? `${task.progress_percent}%` : '',
        title: task.title,
        detail: task.notes ? task.notes.slice(0, 90) : '',
        tone: 'task',
        active: false,
      }))
    return [...upcoming, ...fromPlanner]
  }, [plan, tasks])

  if (!loaded) return null
  const shown = notes.slice(0, MAX_NOTES)

  return (
    <section className="today-sticky" aria-label="Sticky notes">
      <header className="today-sticky-head">
        <button type="button" className="today-sticky-toggle" aria-expanded={open} aria-controls="today-sticky-body" onClick={toggleOpen}>
          {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <span>
            <strong><StickyIcon size={16} aria-hidden="true" /> Sticky notes</strong>
            <small>{open ? (plan ? 'Today\'s plan and your open planner items. Only you can see these.' : 'Your open planner items. Only you can see these.') : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} - select to show`}</small>
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
        {shown.length
          ? view === 'list'
            ? <ol className="plan-list" aria-label="Sticky notes as a list">
              {shown.map(note => (
                <li key={note.id} className={`plan-row is-${note.tone === 'break' ? 'break' : 'work'}`}>
                  <div className="plan-row-time"><strong>{note.header}</strong></div>
                  <div className="plan-row-main">
                    <div className="plan-row-title"><strong>{note.title}</strong>{note.chip && <em>{note.chip}</em>}</div>
                    {note.detail && <p>{note.detail}</p>}
                  </div>
                </li>
              ))}
            </ol>
            : <div className="plan-board" role="list" aria-label="Sticky notes">
              {shown.map((note, index) => (
                <StickyNote key={note.id} header={note.header} chip={note.chip} title={note.title} detail={note.detail} tone={note.tone} tilt={index} active={note.active} onClick={onOpenPlanner} label={`Open planner: ${note.title}`} />
              ))}
            </div>
          : <p className="today-sticky-empty">Nothing here yet. Use Plan my day, or add items in My planner, and they will appear as notes.</p>}
        {notes.length > shown.length && <p className="memo-card-meta">{notes.length - shown.length} more in My planner.</p>}
      </div>}
    </section>
  )
}
