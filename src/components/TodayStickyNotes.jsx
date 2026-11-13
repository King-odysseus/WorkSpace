import React, { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, LayoutGrid, List, Sparkles } from 'lucide-react'
import StickyNote from './StickyNote.jsx'
import { TaskProgressActions, TaskProgressBar, taskProgressValue } from './TaskProgressBar.jsx'
import { parsePlan } from '../lib/day-plan-parse.js'
import { workspaceCall, isoDate } from '../lib/workspace-api.js'

// A board (or list) on Today: the blocks of today's day plan if there is one (the
// block you are in right now is marked), then the tasks assigned to you that are
// wanted now, then your open planner items. Tasks and planner items can be ticked
// off and given a percentage right here. Plan blocks are time slots, not tasks: they
// can be ticked done (saved on the plan) but have no percentage. Selecting a note
// opens My planner.
const MAX_NOTES = 8
const UNDO_MS = 8000
const ORDER_KEY = 'today-sticky-order'
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
  // The order the person gave the notes by dragging them, remembered on this device.
  const [order, setOrder] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(ORDER_KEY)); return Array.isArray(saved) ? saved : [] } catch { return [] } })
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)
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

  // A plan block ticked done is kept on the plan itself, not as a task.
  const togglePlanBlock = async note => {
    const key = note.id.replace('plan-', '')
    const current = plan?.done || []
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]
    setPlan(existing => ({ ...existing, done: next }))
    try {
      const saved = (await workspaceCall(workspaceId, 'personal/day-plan/', 'PUT', { date: isoDate(new Date()), done: next })).note
      setPlan(saved)
    } catch (failure) {
      setPlan(existing => ({ ...existing, done: current }))
      setError(failure.message || 'That did not save.')
    }
  }

  const finish = async note => {
    if (note.kind === 'plan') return togglePlanBlock(note)
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
      isDone: (plan.done || []).includes(block.key),
    }))
    // What is still to do comes first; past and ticked-off blocks go to the back.
    const planNotes = [...fromPlan.filter(note => !note.past && !note.isDone), ...fromPlan.filter(note => note.past || note.isDone)]
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

  // Notes the person has placed come first in the order they set; anything new follows in the usual order.
  const ordered = useMemo(() => {
    const rank = id => { const at = order.indexOf(id); return at === -1 ? Number.MAX_SAFE_INTEGER : at }
    return notes.map((note, index) => ({ note, index })).sort((a, b) => rank(a.note.id) - rank(b.note.id) || a.index - b.index).map(item => item.note)
  }, [notes, order])

  const moveNote = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    const ids = ordered.map(note => note.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from === -1 || to === -1) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setOrder(ids)
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)) } catch { /* not remembered */ }
  }
  const nudgeNote = (id, delta) => {
    const ids = ordered.map(note => note.id)
    const target = ids[ids.indexOf(id) + delta]
    if (target) moveNote(id, target)
  }
  // Drag and drop with the pointer, or Alt with the arrow keys on a focused note.
  const dragProps = note => ({
    draggable: true,
    tabIndex: 0,
    onDragStart: event => { setDragId(note.id); event.dataTransfer.effectAllowed = 'move'; try { event.dataTransfer.setData('text/plain', note.id) } catch { /* some browsers refuse */ } },
    onDragOver: event => { if (!dragId) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOverId(note.id) },
    onDragLeave: () => setOverId(current => (current === note.id ? null : current)),
    onDrop: event => { event.preventDefault(); moveNote(dragId, note.id); setDragId(null); setOverId(null) },
    onDragEnd: () => { setDragId(null); setOverId(null) },
    onKeyDown: event => {
      if (!event.altKey || event.target !== event.currentTarget) return
      const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key]
      if (!delta) return
      event.preventDefault()
      nudgeNote(note.id, delta)
      const node = event.currentTarget
      requestAnimationFrame(() => node.isConnected && node.focus())
    },
    'data-note-id': note.id,
    className: `${dragId === note.id ? 'is-dragging' : ''}${overId === note.id && dragId !== note.id ? ' is-over' : ''}`.trim(),
  })

  if (!loaded) return null
  const shown = ordered.slice(0, MAX_NOTES)
  const canTick = note => note.kind === 'team' || note.kind === 'personal' || note.kind === 'plan'
  const hasPercent = note => note.kind === 'team' || note.kind === 'personal'
  const progressFor = note => (
    <TaskProgressBar
      className="sticky-progress"
      value={taskProgressValue(note.raw)}
      title={note.title}
      onChange={percent => setPercent(note, percent)}
    />
  )
  const tickFor = note => (
    <button type="button" className={`sticky-tick${note.isDone ? ' is-checked' : ''}`} onClick={() => finish(note)} aria-label={note.kind === 'plan' ? (note.isDone ? `Mark ${note.title} not done` : `Mark ${note.title} done`) : `Mark ${note.title} complete`} aria-pressed={Boolean(note.isDone)}>
      <Check size={12} aria-hidden="true" />
    </button>
  )

  return (
    <section className="today-sticky" aria-label="Zuri day plan">
      <header className="today-sticky-head">
        <button type="button" className="today-sticky-toggle" aria-expanded={open} aria-controls="today-sticky-body" onClick={toggleOpen}>
          {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
          <span>
            <strong><Sparkles size={16} aria-hidden="true" /> {"Zuri's day plan"}</strong>
            <small>{open ? 'Zuri\'s plan for today, your tasks and your planner items. Only you can see your planner items.' : `${notes.length} ${notes.length === 1 ? 'item' : 'items'} - select to show`}</small>
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
                <li key={note.id} {...dragProps(note)} className={`plan-row is-${note.tone === 'break' ? 'break' : 'work'}${hasPercent(note) ? ' has-actions' : ''}${note.isDone ? ' is-done' : ''} ${dragProps(note).className}`}>
                  <div className="plan-row-time">
                    {canTick(note) && tickFor(note)}
                    <strong>{note.header}</strong>
                  </div>
                  <div className="plan-row-main">
                    <div className="plan-row-title"><strong>{note.title}</strong>{note.chip && <em>{note.chip}</em>}</div>
                    {note.detail && <p>{note.detail}</p>}
                  </div>
                  {hasPercent(note) && <div className="plan-row-actions">{progressFor(note)}</div>}
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
                  tone={note.isDone ? 'done' : note.tone}
                  tilt={index}
                  active={note.active}
                  leading={canTick(note) ? tickFor(note) : undefined}
                  onClick={onOpenPlanner}
                  label={`Open planner: ${note.title}`}
                  articleProps={dragProps(note)}
                >
                  {hasPercent(note) && progressFor(note)}
                </StickyNote>
              ))}
            </div>
          : <p className="today-sticky-empty">Nothing here yet. Use Plan my day, or add items in My planner, and they will appear as notes.</p>}
        {shown.length > 1 && <p className="memo-card-meta today-sticky-hint">Drag a note to put it where you want it. With the keyboard, focus a note and press Alt with an arrow key.</p>}
        {notes.length > shown.length && <p className="memo-card-meta">{notes.length - shown.length} more in My planner.</p>}
      </div>}
    </section>
  )
}
