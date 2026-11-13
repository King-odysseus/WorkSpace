import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Check, LayoutGrid, List, Sparkles, Trash2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import { getCsrfToken, readJsonResponse, toDateKey } from '../lib/workspace-format.js'
import { takePendingDayPlan } from '../lib/day-plan-navigation.js'
import { parsePlan } from '../lib/day-plan-parse.js'

// Zuri's plan for the day, kept as a note at the bottom of My planner. It is a
// note and not a planner item: nothing that counts planner work (the Today ring,
// the planner totals) ever reads it, and the person can delete it at any time.
export function buildPlanPrompt(openPersonalTitles, today, dailyMinutes) {
  const hours = dailyMinutes ? Math.round((dailyMinutes / 60) * 10) / 10 : 0
  const length = hours
    ? `My working day is ${hours} hours long (Settings), so plan no more than ${hours} hours of work in total, and say what to move if it does not fit.`
    : ''
  const own = openPersonalTitles.length
    ? `My private planner items still open: ${openPersonalTitles.slice(0, 40).map(title => `"${title}"`).join('; ')}.`
    : 'I have no open items in my private planner.'
  return [
    `Plan my working day for ${today}.`,
    length,
    'Use the tasks assigned to me in the workspace that are overdue, due today or in progress, plus my planner items below.',
    own,
    'Give a short schedule as plain lines like "09:00-11:00 Task name (2h)". Say how long each task should take, group small ones together, and put breaks in (just 5 minutes about every 90 minutes). Do not schedule a lunch break: lunch is already covered by my employer, outside the hours I am planning.',
    'Put the most important or most overdue work first. If it cannot all fit in one day, say what to move to another day.',
    'Reply with the plan only, in plain text without markdown. Do not propose any changes to tasks: the actions must be null.',
  ].join(' ')
}

// One block of the plan with the person's own note under it. The note saves when
// the box loses focus, and stays with the block (by its start time) if the plan is
// edited.
function BlockNote({ block, saved, onSave }) {
  const [text, setText] = useState(saved || '')
  useEffect(() => { setText(saved || '') }, [saved])
  return (
    <textarea
      className="plan-block-note"
      aria-label={`Note for ${block.start} ${block.title}`}
      placeholder="Add a note"
      rows={2}
      maxLength={500}
      value={text}
      onChange={event => setText(event.target.value)}
      onBlur={() => { if (text.trim() !== (saved || '').trim()) onSave(block.key, text) }}
    />
  )
}

// The blocks of the plan as sticky notes on a board. Each can be dragged anywhere
// (by its top bar, or with the arrow keys when it has focus) and stays where it was
// put; each can be ticked off as done, which greys it out. Neither changes the plan
// text or counts as planner work.
const CARD_W = 248
const CARD_H = 210
const CARD_GAP = 16

function PlanBoard({ blocks, notes, done, layout, onSaveNote, onToggleDone, onMove }) {
  const boardRef = useRef(null)
  const [width, setWidth] = useState(900)
  const [drag, setDrag] = useState(null)
  // The note last picked up stays in front, so overlapping notes can still be reached.
  const [topKey, setTopKey] = useState(null)
  useLayoutEffect(() => {
    const element = boardRef.current
    if (!element) return undefined
    const measure = () => setWidth(element.clientWidth || 900)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  const columns = Math.max(1, Math.floor((width - CARD_GAP) / (CARD_W + CARD_GAP)))
  const maxX = Math.max(0, width - CARD_W - CARD_GAP)
  const clamp = (value, limit) => Math.max(0, Math.min(limit, Math.round(value)))
  let unplaced = 0
  const spots = new Map(blocks.map(block => {
    const saved = layout[block.key]
    if (Array.isArray(saved)) return [block.key, { x: clamp(saved[0], maxX), y: saved[1] }]
    const index = unplaced
    unplaced += 1
    return [block.key, { x: CARD_GAP + (index % columns) * (CARD_W + CARD_GAP), y: CARD_GAP + Math.floor(index / columns) * (CARD_H + CARD_GAP) }]
  }))
  const where = block => (drag && drag.key === block.key ? drag : spots.get(block.key))
  const height = Math.max(420, ...blocks.map(block => where(block).y + CARD_H + CARD_GAP))
  const start = (block, event) => { setTopKey(block.key); const spot = spots.get(block.key); setDrag({ key: block.key, x: spot.x, y: spot.y, startX: event.clientX, startY: event.clientY, originX: spot.x, originY: spot.y }) }
  const move = (block, event) => setDrag(current => (current && current.key === block.key
    ? { ...current, x: clamp(current.originX + event.clientX - current.startX, maxX), y: clamp(current.originY + event.clientY - current.startY, 5800) }
    : current))
  const end = (block, cancelled) => {
    const current = drag
    setDrag(null)
    if (!current || current.key !== block.key || cancelled) return
    const spot = spots.get(block.key)
    if (current.x !== spot.x || current.y !== spot.y) onMove(block.key, current.x, current.y)
  }
  return (
    <div className="sticky-canvas" ref={boardRef} role="list" aria-label="Day plan as sticky notes" style={{ height }}>
      {/* Notes that were moved are drawn last, so they sit above the ones still in the grid. */}
      {[...blocks.filter(block => !Array.isArray(layout[block.key])), ...blocks.filter(block => Array.isArray(layout[block.key]))].map(block => {
        const spot = where(block)
        const isDone = done.includes(block.key)
        return (
          <article
            key={block.key}
            role="listitem"
            tabIndex={0}
            aria-label={`Plan block: ${block.title}. Use the arrow keys to move it.`}
            className={`sticky-card plan-sticky is-${block.kind}${isDone ? ' is-done' : ''}${drag?.key === block.key ? ' is-dragging' : ''}`}
            style={{ left: spot.x, top: spot.y, width: CARD_W, minHeight: CARD_H, zIndex: topKey === block.key ? 15 : undefined }}
            onFocus={() => setTopKey(block.key)}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              const step = event.shiftKey ? 48 : 16
              const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
              if (moves[event.key]) { event.preventDefault(); onMove(block.key, clamp(spot.x + moves[event.key][0], maxX), clamp(spot.y + moves[event.key][1], 5800)) }
            }}
          >
            <div
              className="sticky-bar"
              title="Drag to move"
              onPointerDown={event => { if (event.target.closest('button')) return; event.currentTarget.setPointerCapture?.(event.pointerId); start(block, event) }}
              onPointerMove={event => move(block, event)}
              onPointerUp={event => { event.currentTarget.releasePointerCapture?.(event.pointerId); end(block, false) }}
              onPointerCancel={() => end(block, true)}
            >
              <button type="button" className={`sticky-tick${isDone ? ' is-checked' : ''}`} onClick={() => onToggleDone(block.key)} aria-pressed={isDone} aria-label={isDone ? `Mark ${block.title} not done` : `Mark ${block.title} done`}><Check size={12} aria-hidden="true" /></button>
              <span className="sticky-due">{block.start} - {block.end}</span>
              {block.duration && <span className="sticky-chip">{block.duration}</span>}
            </div>
            <h3 className="sticky-block-title">{block.title}</h3>
            {block.detail && <p className="sticky-block-detail">{block.detail}</p>}
            <BlockNote block={block} saved={notes[block.key]} onSave={onSaveNote} />
          </article>
        )
      })}
    </div>
  )
}

function PlanList({ blocks, notes, done, onSaveNote, onToggleDone }) {
  return (
    <ol className="plan-list" aria-label="Day plan as a list">
      {blocks.map(block => {
        const isDone = done.includes(block.key)
        return (
          <li key={block.key} className={`plan-row is-${block.kind}${isDone ? ' is-done' : ''}`}>
            <div className="plan-row-time">
              <button type="button" className={`sticky-tick${isDone ? ' is-checked' : ''}`} onClick={() => onToggleDone(block.key)} aria-pressed={isDone} aria-label={isDone ? `Mark ${block.title} not done` : `Mark ${block.title} done`}><Check size={12} aria-hidden="true" /></button>
              <div><strong>{block.start}</strong><span>{block.end}</span></div>
            </div>
            <div className="plan-row-main">
              <div className="plan-row-title"><strong>{block.title}</strong>{block.duration && <em>{block.duration}</em>}</div>
              {block.detail && <p>{block.detail}</p>}
              <BlockNote block={block} saved={notes[block.key]} onSave={onSaveNote} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default function DayPlanNote({ workspaceId, openPersonalTitles }) {
  const today = toDateKey(new Date())
  const [note, setNote] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [dailyMinutes, setDailyMinutes] = useState(0)
  const [leaveShare, setLeaveShare] = useState(0)
  const minutesRef = useRef(0)
  minutesRef.current = dailyMinutes
  const [view, setView] = useState(() => { try { return localStorage.getItem('day-plan-view') === 'list' ? 'list' : 'board' } catch { return 'board' } })
  const titlesRef = useRef(openPersonalTitles)
  titlesRef.current = openPersonalTitles

  const call = useCallback(async (url, method, body) => {
    const response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': String(workspaceId), 'X-CSRFToken': await getCsrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await readJsonResponse(response, 'That did not work.')
    if (!response.ok) throw new Error(data?.error || 'That did not work.')
    return data
  }, [workspaceId])

  const save = useCallback(async (body) => {
    const data = await call(`/api/workspaces/${workspaceId}/personal/day-plan/`, 'PUT', { date: today, body })
    setNote(data.note)
    return data.note
  }, [call, workspaceId, today])

  const generate = useCallback(async () => {
    setBusy('Zuri is planning your day...')
    setError('')
    try {
      const data = await call(`/api/workspaces/${workspaceId}/ai/chat/`, 'POST', { message: buildPlanPrompt(titlesRef.current, today, minutesRef.current), history: [] })
      const plan = String(data.answer || '').trim()
      if (!plan) throw new Error('Zuri did not return a plan. Try again.')
      await save(plan)
    } catch (failure) {
      setError(failure.message || 'Zuri could not plan your day.')
    } finally {
      setBusy('')
    }
  }, [call, save, today, workspaceId])

  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    call(`/api/workspaces/${workspaceId}/personal/day-plan/?date=${today}`, 'GET')
      .then(data => {
        if (cancelled) return
        setNote(data.note)
        const share = Number(data.leave_share) || 0
        setLeaveShare(share)
        setDailyMinutes(Number(data.daily_minutes) || 0)
        // A half day off halves the hours there are to plan.
        minutesRef.current = Math.round((Number(data.daily_minutes) || 0) * (1 - share))
        setLoaded(true)
        if (takePendingDayPlan() && share < 1) generate()
      })
      .catch(failure => { if (!cancelled) { setError(failure.message); setLoaded(true) } })
    return () => { cancelled = true }
    // generate is stable per workspace; today only changes at midnight.
  }, [workspaceId, today]) // eslint-disable-line react-hooks/exhaustive-deps

  const chooseView = next => {
    setView(next)
    try { localStorage.setItem('day-plan-view', next) } catch { /* the choice just is not remembered */ }
  }
  const saveBlockNote = async (key, text) => {
    setError('')
    try {
      const data = await call(`/api/workspaces/${workspaceId}/personal/day-plan/`, 'PUT', { date: today, notes: { ...(note?.notes || {}), [key]: text } })
      setNote(data.note)
      toast.success('Note saved.')
    } catch (failure) {
      setError(failure.message)
    }
  }
  // Done blocks and where blocks were moved are saved on the plan, not in the text.
  const savePlanState = async fields => {
    setError('')
    try {
      const data = await call(`/api/workspaces/${workspaceId}/personal/day-plan/`, 'PUT', { date: today, ...fields })
      setNote(data.note)
    } catch (failure) {
      setError(failure.message)
    }
  }
  const toggleDone = key => {
    const current = note?.done || []
    const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]
    setNote(existing => ({ ...existing, done: next }))
    savePlanState({ done: next })
  }
  const moveBlock = (key, x, y) => {
    const next = { ...(note?.layout || {}), [key]: [x, y] }
    setNote(existing => ({ ...existing, layout: next }))
    savePlanState({ layout: next })
  }
  const plan = note ? parsePlan(note.body) : null

  const remove = async () => {
    setBusy('Deleting...')
    setError('')
    try {
      await call(`/api/workspaces/${workspaceId}/personal/day-plan/?date=${today}`, 'DELETE')
      setNote(null)
      setEditing(false)
      toast.success('Day plan deleted.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy('')
    }
  }

  const saveEdit = async () => {
    if (!draft.trim()) return
    setBusy('Saving...')
    setError('')
    try {
      await save(draft.trim())
      setEditing(false)
      toast.success('Day plan saved.')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="day-plan-note" aria-label="Day plan">
      <header className="day-plan-header">
        <div>
          <h2><Sparkles size={16} aria-hidden="true" /> Day plan</h2>
          <p>Zuri&apos;s suggestion for today. It is a note: it does not count in your progress ring.</p>
        </div>
        <div className="day-plan-actions">
          {note && plan.blocks.length > 0 && <div className="plan-view-toggle" role="group" aria-label="Plan view">
            <button type="button" aria-pressed={view === 'board'} className={view === 'board' ? 'is-active' : ''} onClick={() => chooseView('board')}><LayoutGrid size={14} aria-hidden="true" /> Board</button>
            <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => chooseView('list')}><List size={14} aria-hidden="true" /> List</button>
          </div>}
          <Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || leaveShare >= 1} onClick={generate}>{note ? 'Plan again' : 'Plan my day with Zuri'}</Button>
          {note && <button type="button" className="day-plan-delete" aria-label="Delete day plan" title="Delete day plan" disabled={Boolean(busy)} onClick={remove}><Trash2 size={15} /></button>}
        </div>
      </header>
      {leaveShare >= 1 && <p className="day-plan-status">You are on approved leave today, so there is nothing to plan.</p>}
      {leaveShare > 0 && leaveShare < 1 && <p className="day-plan-status">You have half a day off today, so Zuri plans around the other half.</p>}
      {busy && <p className="day-plan-status" role="status">{busy}</p>}
      {error && <p className="day-plan-error" role="alert">{error}</p>}
      {note && !editing && <>
        {plan.blocks.length > 0
          ? <>
            {plan.intro.length > 0 && <p className="plan-text">{plan.intro.join(' ')}</p>}
            {view === 'list'
              ? <PlanList blocks={plan.blocks} notes={note.notes || {}} done={note.done || []} onSaveNote={saveBlockNote} onToggleDone={toggleDone} />
              : <PlanBoard blocks={plan.blocks} notes={note.notes || {}} done={note.done || []} layout={note.layout || {}} onSaveNote={saveBlockNote} onToggleDone={toggleDone} onMove={moveBlock} />}
            {plan.outro.length > 0 && <div className="plan-text plan-outro">{plan.outro.map(line => <p key={line}>{line}</p>)}</div>}
          </>
          : <pre className="day-plan-body">{note.body}</pre>}
        <button type="button" className="day-plan-edit" onClick={() => { setDraft(note.body); setEditing(true) }}>Edit plan text</button>
      </>}
      {editing && <div className="day-plan-edit-form">
        <textarea aria-label="Day plan text" value={draft} onChange={event => setDraft(event.target.value)} rows={8} />
        <div><Button type="button" size="sm" onClick={saveEdit} disabled={Boolean(busy) || !draft.trim()}>Save</Button> <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button></div>
      </div>}
      {loaded && !note && !busy && !error && <p className="day-plan-empty">No plan for today yet.</p>}
    </Card>
  )
}
