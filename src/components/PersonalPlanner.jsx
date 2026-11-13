// A member's own day planner. Deliberately separate from team tasks rather than
// a private flag on one: there is no board, report, reminder or notification in
// the app that can be pointed at this list, so there is no query that has to
// remember to filter it out.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, LayoutGrid, List, MoreHorizontal, NotebookPen, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { Card } from './ui/card.jsx'
import { CollapsibleSection } from './ui/collapsible-section.jsx'
import { TaskProgressBar, progressOptions, taskProgressValue } from './TaskProgressBar.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import DayPlanNote from './DayPlanNote.jsx'
import { NOTE_COLORS, NOTE_COLOR_LABEL } from '../lib/note-colors.js'
import { formatDay, getCsrfToken, readJsonResponse, toDateKey } from '../lib/workspace-format.js'

// A due time is the reason the field exists, so a task that named one is late the
// moment it passes rather than at the end of the day. A task carrying only a date
// keeps the older meaning: due on that day, late from the next one. today and
// nowTime are passed in rather than read here so the row and the summary cannot
// disagree about what "now" was.
function isOverdue(task, today, nowTime) {
  if (!task.due_date || task.is_done) return false
  if (task.due_date !== today) return task.due_date < today
  return Boolean(task.due_time) && task.due_time < nowTime
}

// Open planner items as sticky notes on a board. A note can be dragged anywhere
// (by its top bar, or with the arrow keys when it has focus) and stays where it was
// put, on every device. Its title and text can be edited in place and its colour
// changed. Ticking finishes it; removing offers to archive it (it can come back)
// or delete it for good.
const NOTE_W = 248
const NOTE_H = 232
const GAP = 16

function StickyCard({ task, x, y, today, nowTime, dragging, raised, onRaise, onToggle, onPatch, onArchive, onDelete, onDragStart, onDragMove, onDragEnd, onNudge }) {
  const [palette, setPalette] = React.useState(false)
  const [removing, setRemoving] = React.useState(false)
  const color = task.color || 'blue'
  const overdue = isOverdue(task, today, nowTime)
  return (
    <article
      className={`sticky-card plan-sticky color-${color}${overdue ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
      role="listitem"
      tabIndex={0}
      aria-label={`Sticky note: ${task.title}. Use the arrow keys to move it.`}
      style={{ left: x, top: y, width: NOTE_W, minHeight: NOTE_H, zIndex: raised ? 15 : undefined }}
      onFocus={onRaise}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        const step = event.shiftKey ? 48 : 16
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
        if (moves[event.key]) { event.preventDefault(); onNudge(task, ...moves[event.key]) }
      }}
    >
      <div
        className="sticky-bar"
        title="Drag to move"
        onPointerDown={event => { if (event.target.closest('button')) return; event.currentTarget.setPointerCapture?.(event.pointerId); onDragStart(task, event) }}
        onPointerMove={event => onDragMove(task, event)}
        onPointerUp={event => { event.currentTarget.releasePointerCapture?.(event.pointerId); onDragEnd(task, event) }}
        onPointerCancel={event => onDragEnd(task, event, true)}
      >
        <button type="button" className="sticky-tick" onClick={() => onToggle(task)} aria-label={`Finish ${task.title}`} aria-pressed={false} />
        <span className="sticky-due">{task.due_date ? `Due ${formatDay(task.due_date)}${task.due_time ? ` ${task.due_time}` : ''}` : 'No due date'}</span>
        <button type="button" className="sticky-icon" onClick={() => { setPalette(open => !open); setRemoving(false) }} aria-label={`Change colour of ${task.title}`} aria-expanded={palette} title="Colour"><span className={`sticky-dot color-${color}`} /></button>
        <button type="button" className="sticky-icon" onClick={() => { setRemoving(open => !open); setPalette(false) }} aria-label={`Remove ${task.title}`} aria-expanded={removing} title="Remove"><X size={14} aria-hidden="true" /></button>
      </div>
      {palette && <div className="note-colors" role="group" aria-label={`Colour for ${task.title}`}>
        {NOTE_COLORS.map(name => (
          <button key={name} type="button" className={`note-color color-${name}${color === name ? ' is-selected' : ''}`} aria-label={`${NOTE_COLOR_LABEL[name]} for ${task.title}`} aria-pressed={color === name} onClick={() => { onPatch(task, { color: name }, true); setPalette(false) }} />
        ))}
      </div>}
      {removing && <div className="sticky-remove" role="group" aria-label={`Remove ${task.title}`}>
        <button type="button" onClick={() => onArchive(task)}>Archive</button>
        <button type="button" className="is-danger" onClick={() => onDelete(task)}>Delete</button>
        <button type="button" onClick={() => setRemoving(false)}>Cancel</button>
      </div>}
      <input
        className="sticky-title-input"
        aria-label={`Title of ${task.title}`}
        defaultValue={task.title}
        maxLength={300}
        onBlur={event => { const next = event.target.value.trim(); if (!next) { event.target.value = task.title } else if (next !== task.title) onPatch(task, { title: next }, true) }}
        onKeyDown={event => { if (event.key === 'Enter') event.target.blur() }}
      />
      <textarea
        className="plan-block-note"
        aria-label={`Notes for ${task.title}`}
        placeholder="Add a note"
        rows={3}
        defaultValue={task.notes}
        onBlur={event => { if (event.target.value !== (task.notes || '')) onPatch(task, { notes: event.target.value }, true) }}
      />
    </article>
  )
}

function PersonalStickyBoard({ tasks, archived, today, nowTime, onToggle, onPatch, onArchive, onRestore, onDelete }) {
  const boardRef = React.useRef(null)
  const [width, setWidth] = React.useState(900)
  const [drag, setDrag] = React.useState(null)
  const [topId, setTopId] = React.useState(null)
  React.useLayoutEffect(() => {
    const element = boardRef.current
    if (!element) return undefined
    const measure = () => setWidth(element.clientWidth || 900)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])

  const columns = Math.max(1, Math.floor((width - GAP) / (NOTE_W + GAP)))
  const maxX = Math.max(0, width - NOTE_W - GAP)
  const clamp = (value, limit) => Math.max(0, Math.min(limit, Math.round(value)))
  // A note nobody has moved yet takes the next free slot in a tidy grid.
  let unplaced = 0
  const spots = new Map(tasks.map(task => {
    if (task.pos_x != null && task.pos_y != null) return [task.id, { x: clamp(task.pos_x, maxX), y: task.pos_y }]
    const index = unplaced
    unplaced += 1
    return [task.id, { x: GAP + (index % columns) * (NOTE_W + GAP), y: GAP + Math.floor(index / columns) * (NOTE_H + GAP) }]
  }))
  const where = task => (drag && drag.id === task.id ? { x: drag.x, y: drag.y } : spots.get(task.id))
  const height = Math.max(520, ...tasks.map(task => where(task).y + NOTE_H + GAP))

  const dragStart = (task, event) => {
    setTopId(task.id)
    const spot = spots.get(task.id)
    setDrag({ id: task.id, x: spot.x, y: spot.y, startX: event.clientX, startY: event.clientY, originX: spot.x, originY: spot.y })
  }
  const dragMove = (task, event) => {
    setDrag(current => (current && current.id === task.id
      ? { ...current, x: clamp(current.originX + event.clientX - current.startX, maxX), y: clamp(current.originY + event.clientY - current.startY, 5800) }
      : current))
  }
  const dragEnd = (task, event, cancelled) => {
    const current = drag
    setDrag(null)
    if (!current || current.id !== task.id || cancelled) return
    const spot = spots.get(task.id)
    if (current.x !== spot.x || current.y !== spot.y) onPatch(task, { pos_x: current.x, pos_y: current.y }, true)
  }
  const nudge = (task, dx, dy) => {
    const spot = spots.get(task.id)
    onPatch(task, { pos_x: clamp(spot.x + dx, maxX), pos_y: clamp(spot.y + dy, 5800) }, true)
  }

  return (
    <>
      <div className="sticky-canvas" ref={boardRef} role="list" aria-label="My planner as sticky notes" style={{ height }}>
        {/* Notes that were moved are drawn last, so they sit above the ones still in the grid. */}
        {[...tasks.filter(task => task.pos_x == null || task.pos_y == null), ...tasks.filter(task => task.pos_x != null && task.pos_y != null)].map(task => {
          const spot = where(task)
          return (
            <StickyCard
              key={task.id}
              task={task}
              x={spot.x}
              y={spot.y}
              today={today}
              nowTime={nowTime}
              dragging={drag?.id === task.id}
              raised={topId === task.id}
              onRaise={() => setTopId(task.id)}
              onToggle={onToggle}
              onPatch={onPatch}
              onArchive={onArchive}
              onDelete={onDelete}
              onDragStart={dragStart}
              onDragMove={dragMove}
              onDragEnd={dragEnd}
              onNudge={nudge}
            />
          )
        })}
      </div>
      {archived.length > 0 && (
        <details className="sticky-archive">
          <summary>Archived notes ({archived.length})</summary>
          <ul>
            {archived.map(task => (
              <li key={task.id}>
                <span>{task.title}</span>
                <button type="button" onClick={() => onRestore(task)} aria-label={`Restore ${task.title}`}>Restore</button>
                <button type="button" className="is-danger" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`}>Delete</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function PersonalPlanner({ workspaceId }) {
  const [planners, setPlanners] = useState([])
  const [tasks, setTasks] = useState([])
  const [archivedTasks, setArchivedTasks] = useState([])
  const [selectedPlannerId, setSelectedPlannerId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState('')
  const [addingPlanner, setAddingPlanner] = useState(false)
  const [plannerName, setPlannerName] = useState('')
  const [managingPlannerId, setManagingPlannerId] = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingPlannerId, setConfirmingPlannerId] = useState(null)
  const [confirmingTaskId, setConfirmingTaskId] = useState(null)
  const [openNotesId, setOpenNotesId] = useState(null)
  const [view, setView] = useState(() => { try { return localStorage.getItem('planner-view') === 'board' ? 'board' : 'list' } catch { return 'list' } })
  const chooseView = next => { setView(next); try { localStorage.setItem('planner-view', next) } catch { /* not remembered */ } }
  const now = new Date()
  const today = toDateKey(now)
  // The clock half of "is this late", in the same HH:MM the server writes a due
  // time in, so the two compare as strings without either side parsing the other.
  const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const request = useCallback(async (suffix, method, body) => {
    const response = await fetch(`/api/workspaces/${workspaceId}/personal${suffix}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Workspace-Id': String(workspaceId),
        'X-CSRFToken': await getCsrfToken(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // readJsonResponse hands back a non-ok body instead of throwing, so the
    // message the server chose is the one the page shows.
    const data = await readJsonResponse(response, 'That did not work.')
    if (!response.ok) throw new Error(data?.error || 'That did not work.')
    return data
  }, [workspaceId])

  const replaceTask = useCallback((task) => {
    setTasks(current => current.map(item => (item.id === task.id ? task : item)))
  }, [])

  useEffect(() => {
    if (!workspaceId) return undefined
    let cancelled = false
    setLoading(true)
    request('/planners/', 'GET')
      .then(data => {
        if (cancelled) return
        setPlanners(data.planners || [])
        setTasks(data.tasks || [])
        setArchivedTasks(data.archived_tasks || [])
        setError('')
      })
      .catch(failure => { if (!cancelled) setError(failure.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [request, workspaceId])

  // Derived rather than stored. A stored open planner needs an effect to keep it
  // pointing at a planner that still exists, and that leaves a render where the
  // list has loaded but nothing is open - which reads as "no planners yet".
  const activePlanner = planners.find(planner => planner.id === selectedPlannerId) || planners[0] || null
  const activeId = activePlanner?.id ?? null
  const activeTasks = useMemo(() => tasks.filter(task => task.planner_id === activeId), [tasks, activeId])
  const openCountFor = useCallback(
    plannerId => tasks.filter(task => task.planner_id === plannerId && !task.is_done).length,
    [tasks],
  )
  const totalCountFor = useCallback(
    plannerId => tasks.filter(task => task.planner_id === plannerId).length,
    [tasks],
  )
  const summary = useMemo(() => {
    if (!activeTasks.length) return 'Nothing planned yet.'
    const done = activeTasks.filter(task => task.is_done).length
    const overdue = activeTasks.filter(task => isOverdue(task, today, nowTime)).length
    return overdue ? `${done} of ${activeTasks.length} done - ${overdue} overdue` : `${done} of ${activeTasks.length} done`
  }, [activeTasks, today, nowTime])

  const run = async (work) => {
    setSaving(true)
    try {
      await work()
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSaving(false)
    }
  }

  const submitPlanner = (event) => {
    event.preventDefault()
    const name = plannerName.trim()
    if (!name) return
    return run(async () => {
      const data = await request('/planners/', 'POST', { name })
      setPlanners(current => [...current, data.planner])
      setSelectedPlannerId(data.planner.id)
      setPlannerName('')
      setAddingPlanner(false)
    })
  }

  const submitRename = (event) => {
    event.preventDefault()
    const name = renameValue.trim()
    if (!name) return
    return run(async () => {
      const data = await request(`/planners/${renamingId}/`, 'PATCH', { name })
      setPlanners(current => current.map(planner => (planner.id === data.planner.id ? data.planner : planner)))
      setRenamingId(null)
      setManagingPlannerId(null)
    })
  }

  const deletePlanner = (planner) => run(async () => {
    await request(`/planners/${planner.id}/`, 'DELETE')
    setPlanners(current => current.filter(item => item.id !== planner.id))
    setTasks(current => current.filter(task => task.planner_id !== planner.id))
    setConfirmingPlannerId(null)
    setManagingPlannerId(null)
  })

  const submitTask = (event) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title || !activeId) return
    return run(async () => {
      const data = await request('/tasks/', 'POST', { title, planner_id: activeId })
      setTasks(current => [...current, data.task])
      setDraft('')
    })
  }

  // Ticking is optimistic because it is the one action done in a burst, and a
  // round trip per tick makes a list feel broken. A failure puts the tick back.
  const toggleTask = async (task) => {
    const next = !task.is_done
    setTasks(current => current.map(item => (item.id === task.id ? { ...item, is_done: next, progress_percent: next ? 100 : 0 } : item)))
    try {
      replaceTask((await request(`/tasks/${task.id}/`, 'PATCH', { is_done: next })).task)
      setError('')
    } catch (failure) {
      replaceTask(task)
      setError(failure.message)
    }
  }

  const patchTask = async (task, patch, optimistic) => {
    if (optimistic) setTasks(current => current.map(item => (item.id === task.id ? { ...item, ...patch } : item)))
    try {
      replaceTask((await request(`/tasks/${task.id}/`, 'PATCH', patch)).task)
      setError('')
      return true
    } catch (failure) {
      replaceTask(task)
      setError(failure.message)
      return false
    }
  }

  // 100 finishes the item and anything less reopens it, so the bar and the tick
  // can never disagree about whether it is done.
  const setProgress = (task, percent) => {
    if (percent === 100 && !task.is_done) return toggleTask(task)
    return patchTask(task, task.is_done ? { is_done: false, progress_percent: percent } : { progress_percent: percent }, true)
  }

  const deleteTask = (task) => run(async () => {
    await request(`/tasks/${task.id}/`, 'DELETE')
    setTasks(current => current.filter(item => item.id !== task.id))
    setConfirmingTaskId(null)
  })

  // Committing on blur rather than on every keystroke: a title is one edit, and
  // a request per character would put the caret behind the network.
  const commitTitle = async (task, input) => {
    const title = input.value.trim()
    if (!title || title === task.title) {
      input.value = task.title
      return
    }
    if (!await patchTask(task, { title })) input.value = task.title
  }

  const commitNotes = (task, input) => patchTask(task, { notes: input.value })
  // Putting a note away keeps it (it can be restored); deleting removes it for good.
  const archiveNote = task => run(async () => {
    const saved = (await request(`/tasks/${task.id}/`, 'PATCH', { archived: true })).task
    setTasks(current => current.filter(item => item.id !== task.id))
    setArchivedTasks(current => [...current, saved])
    toast.success('Note archived. You can restore it from Archived notes.')
  })
  const restoreNote = task => run(async () => {
    const saved = (await request(`/tasks/${task.id}/`, 'PATCH', { archived: false })).task
    setArchivedTasks(current => current.filter(item => item.id !== task.id))
    setTasks(current => [...current, saved])
    toast.success('Note restored.')
  })
  const deleteNote = task => run(async () => {
    await request(`/tasks/${task.id}/`, 'DELETE')
    setTasks(current => current.filter(item => item.id !== task.id))
    setArchivedTasks(current => current.filter(item => item.id !== task.id))
    toast.success('Note deleted.')
  })
  const isManaging = Boolean(addingPlanner || managingPlannerId || renamingId || confirmingPlannerId)
  const compactLayout = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 900px)').matches

  // Ticking an item moves it out of the day's list and into the folded Done band
  // below it, so a finished item stops taking up the room a next one needs. One
  // row shape serves both lists: an item moving between them should not change
  // how it looks on the way.
  const openTasks = activeTasks.filter(task => !task.is_done)
  const doneTasks = activeTasks.filter(task => task.is_done)

  const renderPersonalTask = (task) => <li className={`personal-task-shell ${task.is_done ? 'is-done' : ''} ${openNotesId === task.id ? 'is-editing' : ''}`} key={task.id}>
    <div className="personal-task-row">
      <button
        type="button"
        className="personal-task-tick"
        onClick={() => toggleTask(task)}
        aria-pressed={task.is_done}
        aria-label={task.is_done ? `Reopen ${task.title}` : `Finish ${task.title}`}
      >{task.is_done && <Check size={13} />}</button>
      <div className="personal-task-body">
        <input
          className="personal-task-title"
          aria-label={`Title for ${task.title}`}
          defaultValue={task.title}
          onBlur={event => commitTitle(task, event.target)}
          onKeyDown={event => { if (event.key === 'Enter') event.target.blur() }}
        />
        <div className="personal-task-meta">
          {task.is_done && task.completed_at
            ? <span className="personal-task-flag is-quiet">Done {formatDay(task.completed_at)}</span>
            : <span className={`personal-task-flag${isOverdue(task, today, nowTime) ? ' is-overdue' : ''}`}>{task.due_date ? `Due ${formatDay(task.due_date)}${task.due_time ? ` ${task.due_time}` : ''}` : 'No due date'}</span>}
        </div>
        <TaskProgressBar className="personal-task-progress" value={taskProgressValue(task)} title={task.title} onChange={percent => setProgress(task, percent)} />
        {openNotesId === task.id && <div className="personal-task-notes-panel" id={`personal-task-editor-${task.id}`}>
          <div className="personal-task-edit-controls">
            <label className="personal-task-date-control">
              <CalendarDays size={15} aria-hidden="true" />
              <input
                type="date"
                aria-label={`Due date for ${task.title}`}
                value={task.due_date}
                // The day and the clock are one moment, so losing the day loses
                // the time with it and in the same request: the server refuses a
                // time it cannot hang on a date.
                onChange={event => patchTask(
                  task,
                  event.target.value ? { due_date: event.target.value } : { due_date: '', due_time: '' },
                  true,
                )}
              />
            </label>
            <label className={`personal-task-time-control${task.due_date ? '' : ' is-disabled'}`}>
              <Clock size={15} aria-hidden="true" />
              <input
                type="time"
                aria-label={`Due time for ${task.title}`}
                value={task.due_time || ''}
                disabled={!task.due_date}
                title={task.due_date ? `Due time for ${task.title}` : 'Set a due date before adding a time'}
                onChange={event => patchTask(task, { due_time: event.target.value }, true)}
              />
            </label>
            <span className="personal-task-notes-toggle is-active"><NotebookPen size={15} /> Notes</span>
          </div>
          <label className="personal-task-planner-control">
            <span>Progress</span>
            <select
              aria-label={`Set percent complete for ${task.title}`}
              value={taskProgressValue(task)}
              onChange={event => setProgress(task, Number(event.target.value))}
            >{progressOptions(taskProgressValue(task)).map(step => <option value={step} key={step}>{step}%</option>)}</select>
          </label>
          {planners.length > 1 && <label className="personal-task-planner-control">
            <span>Planner</span>
            <select
              aria-label={`Planner for ${task.title}`}
              value={task.planner_id}
              onChange={event => patchTask(task, { planner_id: Number(event.target.value) }, true)}
            >{planners.map(planner => <option value={planner.id} key={planner.id}>{planner.name}</option>)}</select>
          </label>}
          <textarea
            className="personal-task-notes"
            aria-label={`Notes for ${task.title}`}
            placeholder="Anything you want to remember about this"
            defaultValue={task.notes}
            onBlur={event => commitNotes(task, event.target)}
          />
          <p>Notes save when the field loses focus.</p>
        </div>}
      </div>
      <div className="personal-task-side">
        <button
          type="button"
          className={`personal-task-edit${openNotesId === task.id ? ' is-active' : ''}`}
          aria-label={`${openNotesId === task.id ? 'Close editor for' : 'Edit'} ${task.title}`}
          aria-expanded={openNotesId === task.id}
          aria-controls={`personal-task-editor-${task.id}`}
          title={`${openNotesId === task.id ? 'Close editor for' : 'Edit'} ${task.title}`}
          onClick={() => setOpenNotesId(current => (current === task.id ? null : task.id))}
        ><Pencil size={15} /></button>
        <button type="button" className="personal-task-delete" aria-label={`Delete ${task.title}`} title={`Delete ${task.title}`} onClick={() => setConfirmingTaskId(task.id)}><Trash2 size={15} /></button>
      </div>
    </div>
    {confirmingTaskId === task.id && <div className="personal-task-delete-confirm" role="group" aria-label={`Delete ${task.title}`}>
      <Trash2 size={17} aria-hidden="true" />
      <div><strong>Delete {task.title}?</strong><span>This removes the item from your private planner.</span></div>
      <div className="personal-planner-confirm-actions">
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingTaskId(null)}>Cancel</Button>
        <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => deleteTask(task)}>Delete</Button>
      </div>
    </div>}
  </li>

  return <section className="workspace-view personal-planner-view" aria-busy={loading}>
    <WorkspaceViewHeading title="My planner" subtitle="Your own list for planning the day. Private to you - nobody else in the workspace can see it." />
    <div className={`personal-planner-layout${isManaging ? ' is-managing' : ''}${!planners.length && !loading ? ' is-empty' : ''}`}>
      <aside className="personal-planner-rail" aria-label="My planners">
        <header className="personal-planner-rail-header">
          <h2>My planners</h2>
          <button type="button" aria-label="Add planner" title="New planner" onClick={() => { setAddingPlanner(true); setManagingPlannerId(null) }}><Plus size={16} /></button>
        </header>
        <div className="personal-planner-list" role="list">
          {planners.map(planner => renamingId === planner.id
            ? <form className="personal-planner-rename" key={planner.id} onSubmit={submitRename} role="listitem">
              <input autoFocus aria-label="Planner name" value={renameValue} onChange={event => setRenameValue(event.target.value)} />
              <button type="submit" className="personal-planner-form-check" aria-label="Save planner name" disabled={saving}><Check size={16} /></button>
              <button type="button" className="personal-planner-form-cancel" aria-label="Cancel rename" onClick={() => { setRenamingId(null); setManagingPlannerId(null) }}><X size={16} /></button>
            </form>
            : <div className={`personal-planner-item${planner.id === activeId ? ' is-active' : ''}${confirmingPlannerId === planner.id ? ' is-confirming' : ''}`} key={planner.id} role="listitem">
              <div className="personal-planner-row">
                <button
                  type="button"
                  className="personal-planner-pick"
                  onClick={() => {
                    if (compactLayout && planner.id === activeId) {
                      setManagingPlannerId(current => (current === planner.id ? null : planner.id))
                      return
                    }
                    setSelectedPlannerId(planner.id)
                  }}
                  aria-current={planner.id === activeId ? 'page' : undefined}
                  aria-expanded={compactLayout ? managingPlannerId === planner.id : undefined}
                >
                  <span className="personal-planner-name">{planner.name}</span>
                  <span className="personal-planner-count" aria-label={`${openCountFor(planner.id)} open items`}>{openCountFor(planner.id)}</span>
                </button>
                {managingPlannerId === planner.id
                  ? <span className="personal-planner-item-actions">
                    <button type="button" aria-label={`Rename ${planner.name}`} title={`Rename ${planner.name}`} onClick={() => { setRenamingId(planner.id); setRenameValue(planner.name) }}><Pencil size={14} /></button>
                    <button type="button" aria-label={`Delete ${planner.name}`} title={`Delete ${planner.name}`} onClick={() => setConfirmingPlannerId(planner.id)}><Trash2 size={14} /></button>
                  </span>
                  : <button type="button" className="personal-planner-manage" aria-label={`Manage ${planner.name}`} title={`Manage ${planner.name}`} onClick={() => setManagingPlannerId(planner.id)}><MoreHorizontal size={17} /></button>}
              </div>
              {confirmingPlannerId === planner.id && <div className="personal-planner-delete-confirm" role="group" aria-label={`Delete ${planner.name}`}>
                <Trash2 size={16} aria-hidden="true" />
                <div>
                  <strong>Delete {planner.name} and its {totalCountFor(planner.id)} {totalCountFor(planner.id) === 1 ? 'item' : 'items'}?</strong>
                  <span>This cannot be undone.</span>
                </div>
                <div className="personal-planner-confirm-actions">
                  <Button type="button" variant="outline" size="sm" onClick={() => { setConfirmingPlannerId(null); setManagingPlannerId(null) }}>Cancel</Button>
                  <Button type="button" variant="destructive" size="sm" disabled={saving} onClick={() => deletePlanner(planner)}>Delete</Button>
                </div>
              </div>}
            </div>)}
          {!planners.length && !loading && <div className="personal-planner-list-empty"><NotebookPen size={18} /><span>No planners yet</span></div>}
        </div>
        <div className="personal-planner-rail-footer">
          {addingPlanner
            ? <form className="personal-planner-new-form" onSubmit={submitPlanner}>
              <label htmlFor="new-personal-planner">New planner</label>
              <div className="personal-planner-rename">
                <input id="new-personal-planner" autoFocus aria-label="New planner name" placeholder="Name this planner" value={plannerName} onChange={event => setPlannerName(event.target.value)} />
                <button type="submit" className="personal-planner-form-check" aria-label="Create planner" disabled={saving || !plannerName.trim()}><Check size={16} /></button>
                <button type="button" className="personal-planner-form-cancel" aria-label="Cancel new planner" onClick={() => { setAddingPlanner(false); setPlannerName('') }}><X size={16} /></button>
              </div>
            </form>
            : <button type="button" className="personal-planner-new" onClick={() => setAddingPlanner(true)}><Plus size={14} /> New planner</button>}
        </div>
      </aside>
      <div className="personal-planner-main">
        <Card className="personal-planner-card">
          {error && <div className="personal-planner-error" role="alert">
            <span aria-hidden="true">!</span>
            <div><strong>That did not work. Nothing was saved.</strong><p>{error}</p></div>
          </div>}
          {loading
            ? <div className="personal-planner-loading" role="status" aria-label="Loading your planner">
              <div className="personal-planner-loading-heading"><span /><span /></div>
              <div className="personal-planner-loading-card" />
              <div className="personal-planner-loading-card" />
              <div className="personal-planner-loading-card is-short" />
            </div>
            : !activePlanner
              ? <div className="personal-planner-empty">
                <span className="personal-planner-empty-icon"><NotebookPen size={20} /></span>
                <strong>Create a planner to start planning your day</strong>
                <p>Each planner is private to you. Use one for today, your week, or a project you want to keep separate.</p>
                <Button type="button" size="page" aria-label="Create your first planner" className="personal-planner-empty-action" onClick={() => setAddingPlanner(true)}><Plus size={18} /> New planner</Button>
              </div>
              : <>
                <header className="personal-planner-header">
                  <div>
                    <h2>{activePlanner.name}</h2>
                    <p className="personal-planner-summary">{summary}</p>
                  </div>
                  <div className="personal-planner-header-actions">
                    {saving && <span className="personal-planner-saving">Saving</span>}
                    <div className="plan-view-toggle" role="group" aria-label="Planner view">
                      <button type="button" aria-pressed={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => chooseView('list')}><List size={14} aria-hidden="true" /> List</button>
                      <button type="button" aria-pressed={view === 'board'} className={view === 'board' ? 'is-active' : ''} onClick={() => chooseView('board')}><LayoutGrid size={14} aria-hidden="true" /> Notes</button>
                    </div>
                    <NotebookPen size={20} aria-hidden="true" />
                  </div>
                </header>
                <form className="personal-planner-composer" onSubmit={submitTask}>
                  <Plus size={18} aria-hidden="true" />
                  <input aria-label="Add to my day" placeholder="Add something to your day" value={draft} onChange={event => setDraft(event.target.value)} />
                  <Button type="submit" disabled={saving || !draft.trim()}>Add</Button>
                </form>
                {activeTasks.length
                  ? <>
                    {openTasks.length > 0 && (view === 'board'
                      ? <PersonalStickyBoard tasks={[...openTasks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)} archived={archivedTasks} today={today} nowTime={nowTime} onToggle={toggleTask} onPatch={patchTask} onArchive={archiveNote} onRestore={restoreNote} onDelete={deleteNote} />
                      : <ul className="personal-task-list">{openTasks.map(renderPersonalTask)}</ul>)}
                    {doneTasks.length > 0 && <CollapsibleSection
                      className="personal-planner-done"
                      title="Done"
                      count={doneTasks.length}
                      contentClassName="personal-planner-done-list"
                    >
                      <ul className="personal-task-list">{doneTasks.map(renderPersonalTask)}</ul>
                    </CollapsibleSection>}
                  </>
                  : <div className="personal-task-empty"><NotebookPen size={22} aria-hidden="true" /><strong>Nothing here yet</strong><p>Add your first item above.</p></div>}
              </>}
        </Card>
        {!loading && <DayPlanNote workspaceId={workspaceId} openPersonalTitles={tasks.filter(task => !task.is_done).map(task => task.title)} />}
      </div>
    </div>
  </section>
}

export default PersonalPlanner
