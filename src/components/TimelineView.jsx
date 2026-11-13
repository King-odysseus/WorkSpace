import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Diamond, Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { AppSelect } from './ui/select.jsx'
import { workspaceCall } from '../lib/workspace-api.js'
import { getCsrfToken, taskIsAssignedTo } from '../lib/workspace-format.js'

// The plan on a calendar: every task with dates is a bar from its start to its due
// date, grouped under the milestone it belongs to. Bars can be dragged to move them or
// pulled at either end to change a date; the small link button on a bar says "this
// task must finish before another one starts", and the arrow it draws turns red when
// the later task is planned to start too early. Milestones are checkpoints with a
// date; they are reached when every task on them is done, or by hand.
const DAY = 86400000
export const dayNumber = value => { const [year, month, day] = String(value).slice(0, 10).split('-').map(Number); return Math.floor(Date.UTC(year, month - 1, day) / DAY) }
export const isoFromDay = number => new Date(number * DAY).toISOString().slice(0, 10)
const ROW = 40
const HEAD = 52
const LABEL = 270
const ZOOMS = { week: 34, month: 14 }
// How much of the calendar to show at once. Anything but Auto zooms the chart so that the
// whole stretch fits across the screen, and shows only the tasks that fall inside it.
export const SPANS = [
  ['auto', 'All dates', 0], ['7', '1 week', 7], ['14', '2 weeks', 14], ['30', '1 month', 30],
  ['90', '3 months', 90], ['180', '6 months', 180], ['270', '9 months', 270], ['365', '1 year', 365],
]
const MIN_DRAG = 4

const statusOf = task => String(task.status || '').replace('_', ' ')
const STATUS_FILTERS = [
  ['all', 'Any status'], ['open', 'Not finished'], ['todo', 'Not started'], ['in progress', 'In progress'],
  ['review', 'In review'], ['blocked', 'Blocked'], ['late', 'Late'], ['done', 'Done'],
]
const memberName = member => [member.first_name, member.last_name].filter(Boolean).join(' ') || member.name || member.email || 'Member'
const NO_FILTERS = { q: '', status: 'all', assignee: 'all', milestone: 'all' }

export const barSpan = task => {
  const start = dayNumber(task.start_date || task.due_date)
  const end = dayNumber(task.due_date || task.start_date)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

// A link is in conflict when the task that has to wait is planned to start before the one it waits for ends.
export const linkConflict = (before, after) => barSpan(after).start <= barSpan(before).end

async function taskCall(path, method, body, workspaceId) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': String(workspaceId), 'X-CSRFToken': await getCsrfToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'That did not save.')
  return data
}

function MilestonesPanel({ milestones, isLeader, onAdd, onChange, onDelete }) {
  const [form, setForm] = useState({ title: '', due_date: '' })
  const [editing, setEditing] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('timeline-milestones-open') !== 'false' } catch { return true } })
  const toggle = () => setOpen(current => { try { localStorage.setItem('timeline-milestones-open', String(!current)) } catch { /* not remembered */ } return !current })
  const submit = async event => {
    event.preventDefault()
    if (!form.title.trim() || !form.due_date) return
    if (await onAdd(form)) setForm({ title: '', due_date: '' })
  }
  return (
    <section className="timeline-milestones" aria-label="Milestones">
      <header><h3><Diamond size={15} aria-hidden="true" /> Milestones</h3><span>{milestones.length}</span><button type="button" aria-expanded={open} onClick={toggle}>{open ? 'Hide' : 'Show'}</button></header>
      {open && <>
      {milestones.length === 0 && <p className="team-day-muted">No milestones yet.{isLeader ? ' Add one, then attach tasks to it from the task or from this timeline.' : ''}</p>}
      <ul>
        {milestones.map(milestone => (
          <li key={milestone.id} className={`${milestone.complete ? 'is-complete' : ''}${milestone.is_late ? ' is-late' : ''}`}>
            {editing?.id === milestone.id ? (
              <form className="timeline-ms-edit" onSubmit={async event => { event.preventDefault(); if (await onChange(milestone, { title: editing.title, due_date: editing.due_date })) setEditing(null) }}>
                <input aria-label="Milestone title" value={editing.title} maxLength={200} onChange={event => setEditing({ ...editing, title: event.target.value })} />
                <input aria-label="Milestone date" type="date" value={editing.due_date} onChange={event => setEditing({ ...editing, due_date: event.target.value })} />
                <Button type="submit" size="sm">Save</Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            ) : (
              <>
                <span className="timeline-ms-name"><Diamond size={14} aria-hidden="true" /> <strong>{milestone.title}</strong></span>
                <span className="timeline-ms-meta">{milestone.due_date} - {milestone.task_count ? `${milestone.done_count} of ${milestone.task_count} done` : 'no tasks yet'}{milestone.complete ? ' - reached' : milestone.is_late ? ' - late' : ''}</span>
                {isLeader && (
                  <span className="timeline-ms-actions">
                    <Button type="button" size="sm" variant="outline" onClick={() => onChange(milestone, { completed: !milestone.manually_completed })}>{milestone.manually_completed ? 'Reopen' : 'Mark reached'}</Button>
                    <button type="button" className="team-day-delete" aria-label={`Edit ${milestone.title}`} onClick={() => setEditing({ id: milestone.id, title: milestone.title, due_date: milestone.due_date })}><Pencil size={14} aria-hidden="true" /></button>
                    {confirming === milestone.id
                      ? <span className="team-day-confirm" role="group" aria-label={`Delete ${milestone.title}?`}><Button type="button" size="sm" variant="destructive" onClick={() => { setConfirming(null); onDelete(milestone) }}>Delete</Button><Button type="button" size="sm" variant="outline" onClick={() => setConfirming(null)}>Keep</Button></span>
                      : <button type="button" className="team-day-delete" aria-label={`Delete ${milestone.title}`} onClick={() => setConfirming(milestone.id)}><Trash2 size={14} aria-hidden="true" /></button>}
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {isLeader && (
        <form className="timeline-ms-add" onSubmit={submit}>
          <input aria-label="New milestone title" placeholder="New milestone, such as Beta release" value={form.title} maxLength={200} onChange={event => setForm({ ...form, title: event.target.value })} />
          <input aria-label="New milestone date" type="date" value={form.due_date} onChange={event => setForm({ ...form, due_date: event.target.value })} />
          <Button type="submit" size="sm" disabled={!form.title.trim() || !form.due_date}><Plus size={14} aria-hidden="true" /> Add milestone</Button>
        </form>
      )}
      </>}
    </section>
  )
}

export default function TimelineView({ workspaceId, tasks, isLeader = false, canEdit = false, projectFilter = 'all', defaultGroup = 'milestone', members = [], currentUserId = null, onOpenTask, onTaskPatched }) {
  const [milestones, setMilestones] = useState([])
  const [zoom, setZoom] = useState(() => { try { return localStorage.getItem('timeline-zoom') === 'month' ? 'month' : 'week' } catch { return 'week' } })
  // Rows are grouped under milestones, or under the workstream a task belongs to; the choice is remembered.
  const [group, setGroup] = useState(() => { try { return localStorage.getItem('timeline-group-' + defaultGroup) || defaultGroup } catch { return defaultGroup } })
  const chooseGroup = next => { setGroup(next); try { localStorage.setItem('timeline-group-' + defaultGroup, next) } catch { /* not remembered */ } }
  const [filters, setFilters] = useState(NO_FILTERS)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(null)
  const [pickedLink, setPickedLink] = useState(null)
  const [drag, setDrag] = useState(null)
  const scroller = useRef(null)
  const dragRef = useRef(null)
  const scrolledByHand = useRef(false)
  const setByCode = useRef(false)
  const [span, setSpan] = useState(() => { try { const saved = localStorage.getItem('timeline-span'); return SPANS.some(([key]) => key === saved) ? saved : 'auto' } catch { return 'auto' } })
  const [anchor, setAnchor] = useState(null)
  const [viewWidth, setViewWidth] = useState(900)
  const spanDays = SPANS.find(([key]) => key === span)[2]
  const windowed = spanDays > 0
  const localToday = (() => { const now = new Date(); return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY) })()

  const loadMilestones = useCallback(async () => {
    try { setMilestones((await workspaceCall(workspaceId, 'milestones/', 'GET')).milestones || []) } catch (failure) { setError(failure.message) }
  }, [workspaceId])
  useEffect(() => { loadMilestones() }, [loadMilestones])
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') { setLinking(null); setPickedLink(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chooseSpan = next => { setSpan(next); setAnchor(null); try { localStorage.setItem('timeline-span', next) } catch { /* not remembered */ } }
  const chooseZoom = next => { setZoom(next); try { localStorage.setItem('timeline-zoom', next) } catch { /* not remembered */ } }

  const hasAssignee = task => Boolean((task.assignee_ids || []).length || task.assignee_id)
  const matches = useCallback(task => {
    const status = statusOf(task)
    if (filters.q.trim() && !String(task.title).toLowerCase().includes(filters.q.trim().toLowerCase())) return false
    if (filters.status === 'open' && status === 'done') return false
    if (filters.status === 'late') { if (status === 'done' || !task.due_date || dayNumber(task.due_date) >= localToday) return false }
    else if (!['all', 'open'].includes(filters.status) && status !== filters.status) return false
    if (filters.assignee === 'me' && !taskIsAssignedTo(task, currentUserId)) return false
    if (filters.assignee === 'none' && hasAssignee(task)) return false
    if (!['all', 'me', 'none'].includes(filters.assignee) && !taskIsAssignedTo(task, filters.assignee)) return false
    if (filters.milestone === 'none' && task.milestone_id) return false
    if (!['all', 'none'].includes(filters.milestone) && String(task.milestone_id) !== String(filters.milestone)) return false
    return true
  }, [filters, localToday, currentUserId])
  const everything = useMemo(() => tasks.filter(task => task.state !== 'archived' && statusOf(task) !== 'cancelled'), [tasks])
  const live = useMemo(() => everything.filter(matches), [everything, matches])
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS)
  // A window of a week or two starts on a Monday so the weeks line up; longer ones start where you are looking.
  const windowStart = (() => {
    const at = anchor ?? localToday
    return spanDays > 0 && spanDays <= 14 ? at - ((((at + 4) % 7) + 6) % 7) : at
  })()
  const windowEnd = windowStart + spanDays - 1
  const scheduled = useMemo(() => live.filter(task => {
    if (!task.start_date && !task.due_date) return false
    if (!windowed) return true
    const taskSpan = barSpan(task)
    return taskSpan.end >= windowStart && taskSpan.start <= windowEnd
  }), [live, windowed, windowStart, windowEnd])
  const unscheduled = useMemo(() => live.filter(task => !task.start_date && !task.due_date && statusOf(task) !== 'done'), [live])
  const shownMilestones = useMemo(
    () => milestones.filter(milestone => projectFilter === 'all' || projectFilter === 'operations' || !milestone.project_id || String(milestone.project_id) === String(projectFilter)),
    [milestones, projectFilter],
  )

  // Rows: each milestone with its tasks, then everything that belongs to none.
  const rows = useMemo(() => {
    const result = []
    const orderTasks = list => [...list].sort((a, b) => barSpan(a).start - barSpan(b).start || a.id - b.id)
    if (group === 'workstream') {
      const byWorkstream = new Map()
      scheduled.forEach(task => { const key = task.workstream || ''; byWorkstream.set(key, [...(byWorkstream.get(key) || []), task]) })
      const names = [...byWorkstream.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      names.forEach(name => {
        const list = orderTasks(byWorkstream.get(name))
        result.push({ type: 'group', key: 'w' + name, label: name || 'No workstream', count: list.length })
        list.forEach(task => result.push({ type: 'task', key: `t${task.id}`, task }))
      })
      return result
    }
    // In a window, only milestones that fall in it, or have a task in it, take a row.
    const rowMilestones = windowed ? shownMilestones.filter(milestone => { const due = dayNumber(milestone.due_date); return (due >= windowStart && due <= windowEnd) || scheduled.some(task => task.milestone_id === milestone.id) }) : shownMilestones
    const byMilestone = new Map()
    scheduled.forEach(task => { const key = task.milestone_id ?? 'none'; byMilestone.set(key, [...(byMilestone.get(key) || []), task]) })
    rowMilestones.forEach(milestone => {
      result.push({ type: 'milestone', key: `m${milestone.id}`, milestone })
      orderTasks(byMilestone.get(milestone.id) || []).forEach(task => result.push({ type: 'task', key: `t${task.id}`, task }))
    })
    const loose = orderTasks([...(byMilestone.get('none') || []), ...[...byMilestone.entries()].filter(([key]) => key !== 'none' && !rowMilestones.some(milestone => milestone.id === key)).flatMap(([, list]) => list)])
    if (loose.length) {
      if (rowMilestones.length) result.push({ type: 'group', key: 'none', label: 'No milestone' })
      loose.forEach(task => result.push({ type: 'task', key: `t${task.id}`, task }))
    }
    return result
  }, [scheduled, shownMilestones, group, windowed, windowStart, windowEnd])

  const range = useMemo(() => {
    if (windowed) return { first: windowStart, last: windowEnd, days: spanDays }
    const spans = scheduled.map(barSpan)
    const dates = [localToday, ...spans.flatMap(item => [item.start, item.end]), ...shownMilestones.map(milestone => dayNumber(milestone.due_date))]
    let first = Math.min(...dates) - 4
    let last = Math.max(...dates) + 10
    if (last - first < 28) last = first + 28
    first -= (((first + 4) % 7) + 6) % 7 // start the grid on a Monday
    return { first, last, days: last - first + 1 }
  }, [scheduled, shownMilestones, localToday, windowed, windowStart, windowEnd, spanDays])
  const pxPerDay = windowed ? Math.max(2, viewWidth / range.days) : ZOOMS[zoom]
  const x = day => (day - range.first) * pxPerDay
  const width = range.days * pxPerDay

  // Open on today, a little in from the left. The tasks may arrive after the chart first draws, which
  // moves where today sits, so the position is set again until the person scrolls by themselves.
  const showToday = () => {
    const node = scroller.current
    if (!node) return
    setByCode.current = true
    node.scrollLeft = Math.max(0, (localToday - range.first) * pxPerDay - 120)
    requestAnimationFrame(() => { setByCode.current = false })
  }
  useEffect(() => { scrolledByHand.current = false }, [zoom, span])
  useEffect(() => { if (!windowed && !scrolledByHand.current) showToday() }, [zoom, span, range.first, range.days]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = scroller.current
    if (!node) return undefined
    const measure = () => { if (node.clientWidth > 0) setViewWidth(node.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  })

  const patchTask = async (task, body) => {
    try {
      const data = await taskCall(`/api/tasks/${task.id}/`, 'PATCH', body, workspaceId)
      onTaskPatched?.(data.task)
      return data.task
    } catch (failure) { setError(failure.message); return null }
  }
  const setMilestone = async (task, milestoneId) => {
    try {
      const data = await taskCall(`/api/tasks/${task.id}/milestone/`, 'PUT', { milestone_id: milestoneId ? Number(milestoneId) : null }, workspaceId)
      onTaskPatched?.(data.task)
      await loadMilestones()
    } catch (failure) { setError(failure.message) }
  }
  const addLink = async (before, after) => {
    setLinking(null)
    if (before.id === after.id) return
    if ((after.blocked_by_ids || []).includes(before.id)) { toast('Those tasks are already linked.'); return }
    const saved = await patchTask(after, { blocked_by_ids: [...(after.blocked_by_ids || []), before.id] })
    if (saved) { setError(''); toast.success(`"${after.title}" now waits for "${before.title}".`) }
  }
  const removeLink = async ({ before, after }) => {
    setPickedLink(null)
    const saved = await patchTask(after, { blocked_by_ids: (after.blocked_by_ids || []).filter(id => id !== before.id) })
    if (saved) toast.success('Link removed.')
  }

  const addMilestone = async form => {
    try {
      await workspaceCall(workspaceId, 'milestones/', 'POST', { title: form.title.trim(), due_date: form.due_date, project_id: projectFilter !== 'all' && projectFilter !== 'operations' ? Number(projectFilter) : undefined })
      setError('')
      await loadMilestones()
      toast.success('Milestone added.')
      return true
    } catch (failure) { setError(failure.message); return false }
  }
  const changeMilestone = async (milestone, patch) => {
    try { await workspaceCall(workspaceId, `milestones/${milestone.id}/`, 'PATCH', patch); setError(''); await loadMilestones(); return true } catch (failure) { setError(failure.message); return false }
  }
  const deleteMilestone = async milestone => {
    try { await workspaceCall(workspaceId, `milestones/${milestone.id}/`, 'DELETE'); await loadMilestones(); toast.success('Milestone deleted. Its tasks stay.') } catch (failure) { setError(failure.message) }
  }

  // Dragging a bar: the body moves both dates, an end changes one. A press that barely moves is a click.
  const startDrag = (task, mode, event) => {
    if (!canEdit || linking) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const span = barSpan(task)
    dragRef.current = { id: task.id, mode, startX: event.clientX, span, moved: false }
    setDrag({ id: task.id, start: span.start, end: span.end })
  }
  const moveDrag = event => {
    const current = dragRef.current
    if (!current) return
    const dx = event.clientX - current.startX
    if (Math.abs(dx) > MIN_DRAG) current.moved = true
    const delta = Math.round(dx / pxPerDay)
    const { start, end } = current.span
    const next = current.mode === 'move' ? { start: start + delta, end: end + delta } : current.mode === 'start' ? { start: Math.min(start + delta, end), end } : { start, end: Math.max(end + delta, start) }
    setDrag({ id: current.id, ...next })
  }
  const endDrag = async (task, event) => {
    const current = dragRef.current
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    dragRef.current = null
    const shown = drag
    setDrag(null)
    if (!current) return
    if (!current.moved) { if (linking) return; onOpenTask?.(task); return }
    if (!shown || (shown.start === current.span.start && shown.end === current.span.end)) return
    await patchTask(task, { start_date: isoFromDay(shown.start), due_date: isoFromDay(shown.end) })
  }

  const positions = new Map()
  rows.forEach((row, index) => { if (row.type === 'task') positions.set(row.task.id, index) })
  const spanFor = task => (drag && drag.id === task.id ? { start: drag.start, end: drag.end } : barSpan(task))
  const links = []
  rows.forEach(row => {
    if (row.type !== 'task') return
    ;(row.task.blocked_by_ids || []).forEach(beforeId => {
      const before = scheduled.find(item => item.id === beforeId)
      if (before && positions.has(before.id)) links.push({ before, after: row.task })
    })
  })

  const months = []
  for (let day = range.first; day <= range.last; day += 1) {
    const date = new Date(day * DAY)
    if (day === range.first || date.getUTCDate() === 1) months.push({ day, label: date.toLocaleDateString([], { month: 'long', year: 'numeric', timeZone: 'UTC' }) })
  }
  const ticks = []
  for (let day = range.first; day <= range.last; day += 1) {
    const date = new Date(day * DAY)
    const weekday = date.getUTCDay()
    const everyDay = windowed ? pxPerDay >= 22 : zoom === 'week'
    const everyWeek = windowed ? pxPerDay >= 6 : true
    if (everyDay || (everyWeek && weekday === 1)) ticks.push({ day, label: String(date.getUTCDate()), weekend: weekday === 0 || weekday === 6 })
  }
  const weekends = []
  for (let day = range.first; day <= range.last && pxPerDay >= 6; day += 1) { const weekday = new Date(day * DAY).getUTCDay(); if (weekday === 0 || weekday === 6) weekends.push(day) }
  const height = Math.max(rows.length, 1) * ROW

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-toolbar">
        <AppSelect className="timeline-span-select chip-select" value={span} aria-label="Time range" onChange={event => chooseSpan(event.target.value)}>
          {SPANS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </AppSelect>
        {windowed && (
          <span className="timeline-pager" role="group" aria-label="Move the time range">
            <Button type="button" variant="outline" size="sm" aria-label="Earlier" onClick={() => setAnchor(windowStart - spanDays)}>&lsaquo;</Button>
            <strong>{isoFromDay(windowStart)} to {isoFromDay(windowEnd)}</strong>
            <Button type="button" variant="outline" size="sm" aria-label="Later" onClick={() => setAnchor(windowStart + spanDays)}>&rsaquo;</Button>
          </span>
        )}
        {!windowed && <div className="plan-view-toggle" role="group" aria-label="Timeline zoom">
          <button type="button" aria-pressed={zoom === 'week'} className={zoom === 'week' ? 'is-active' : ''} onClick={() => chooseZoom('week')}>Days</button>
          <button type="button" aria-pressed={zoom === 'month'} className={zoom === 'month' ? 'is-active' : ''} onClick={() => chooseZoom('month')}>Weeks</button>
        </div>}
        <div className="plan-view-toggle" role="group" aria-label="Group rows by">
          <button type="button" aria-pressed={group === 'milestone'} className={group === 'milestone' ? 'is-active' : ''} onClick={() => chooseGroup('milestone')}>By milestone</button>
          <button type="button" aria-pressed={group === 'workstream'} className={group === 'workstream' ? 'is-active' : ''} onClick={() => chooseGroup('workstream')}>By workstream</button>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { setAnchor(null); scrolledByHand.current = false; showToday() }}>Today</Button>
        <span className="timeline-legend"><i className="is-todo" /> Not started <i className="is-in-progress" /> In progress <i className="is-done" /> Done <i className="is-blocked" /> Blocked</span>
      </div>
      <div className="timeline-filters" role="search" aria-label="Filter the timeline">
        <input type="search" aria-label="Find a task on the timeline" placeholder="Find a task" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} />
        <AppSelect className="timeline-filter-select chip-select" value={filters.status} aria-label="Status" onChange={event => setFilters({ ...filters, status: event.target.value })}>
          {STATUS_FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </AppSelect>
        <AppSelect className="timeline-filter-select chip-select" value={filters.assignee} aria-label="Person" onChange={event => setFilters({ ...filters, assignee: event.target.value })}>
          <option value="all">Everyone</option>
          {currentUserId != null && <option value="me">Me</option>}
          <option value="none">Unassigned</option>
          {members.filter(member => member.id !== currentUserId).map(member => <option key={member.id} value={String(member.id)}>{memberName(member)}</option>)}
        </AppSelect>
        <AppSelect className="timeline-filter-select chip-select" value={filters.milestone} aria-label="Milestone filter" onChange={event => setFilters({ ...filters, milestone: event.target.value })}>
          <option value="all">Any milestone</option>
          <option value="none">No milestone</option>
          {shownMilestones.map(milestone => <option key={milestone.id} value={String(milestone.id)}>{milestone.title}</option>)}
        </AppSelect>
        <span className="timeline-filter-count" aria-live="polite">Showing {live.length} of {everything.length} tasks</span>
        {filtering && <button type="button" className="timeline-filter-clear" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>}
      </div>
      {error && <p className="memo-error" role="alert">{error}</p>}
      {linking && <p className="timeline-banner" role="status">Select the task that must wait for <strong>{linking.title}</strong>. Press Esc to cancel. <button type="button" onClick={() => setLinking(null)}>Cancel</button></p>}
      {pickedLink && <p className="timeline-banner" role="status">&quot;{pickedLink.after.title}&quot; waits for &quot;{pickedLink.before.title}&quot;.{linkConflict(pickedLink.before, pickedLink.after) ? ' It is planned to start too early.' : ''} {canEdit && <button type="button" onClick={() => removeLink(pickedLink)}>Remove link</button>} <button type="button" onClick={() => setPickedLink(null)}>Close</button></p>}

      <MilestonesPanel milestones={shownMilestones} isLeader={isLeader} onAdd={addMilestone} onChange={changeMilestone} onDelete={deleteMilestone} />

      {scheduled.length === 0 && shownMilestones.length === 0
        ? <p className="today-sticky-empty">Nothing is scheduled yet. Give tasks a start and due date, or add a milestone, and they will appear here.</p>
        : (
          <div className="timeline-frame">
            <div className="timeline-labels" style={{ width: LABEL }}>
              <div className="timeline-corner" style={{ height: HEAD }}>Task</div>
              {rows.map(row => (
                <div className={`timeline-label is-${row.type}`} style={{ height: ROW }} key={row.key}>
                  {row.type === 'milestone' && <span className={`timeline-label-ms${row.milestone.complete ? ' is-complete' : ''}${row.milestone.is_late ? ' is-late' : ''}`}><Diamond size={14} aria-hidden="true" /> <strong>{row.milestone.title}</strong> <small>{row.milestone.done_count}/{row.milestone.task_count}</small></span>}
                  {row.type === 'group' && <span className="timeline-group-label"><strong>{row.label}</strong>{row.count ? <small>{row.count}</small> : null}</span>}
                  {row.type === 'task' && (
                    <>
                      <button type="button" className="timeline-task-name" onClick={() => onOpenTask?.(row.task)} title={row.task.title}>{row.task.title}</button>
                      {canEdit && shownMilestones.length > 0 && (
                        <AppSelect className="timeline-ms-select" value={row.task.milestone_id ? String(row.task.milestone_id) : ''} aria-label={`Milestone for ${row.task.title}`} onChange={event => setMilestone(row.task, event.target.value)}>
                          <option value="">No milestone</option>
                          {shownMilestones.map(milestone => <option key={milestone.id} value={String(milestone.id)}>{milestone.title}</option>)}
                        </AppSelect>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="timeline-scroll" ref={scroller} onScroll={() => { if (setByCode.current) setByCode.current = false; else scrolledByHand.current = true }}>
              <div className={`timeline-canvas${windowed ? ' is-windowed' : ''}`} style={{ width, height: HEAD + height }}>
                <div className="timeline-head" style={{ height: HEAD, width }}>
                  {months.map(month => <span key={month.day} className="timeline-month" style={{ left: x(month.day) }}>{month.label}</span>)}
                  {ticks.map(tick => <span key={tick.day} className={`timeline-tick${tick.weekend ? ' is-weekend' : ''}${tick.day === localToday ? ' is-today' : ''}`} style={{ left: x(tick.day), width: windowed ? (pxPerDay >= 22 ? pxPerDay : pxPerDay * 7) : zoom === 'week' ? pxPerDay : pxPerDay * 7 }}>{tick.label}</span>)}
                </div>
                <div className="timeline-body" style={{ top: HEAD, height, width }}>
                  {weekends.map(day => <i key={day} className="timeline-weekend" style={{ left: x(day), width: pxPerDay }} />)}
                  {rows.map((row, index) => <i key={row.key} className={`timeline-rule${row.type === 'milestone' ? ' is-milestone' : ''}`} style={{ top: index * ROW, height: ROW }} />)}
                  <i className="timeline-today" style={{ left: x(localToday) + pxPerDay / 2 }} aria-label="Today" />
                  <svg className="timeline-links" width={width} height={height} aria-hidden="false">
                    <defs>
                      <marker id="tl-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#667085" /></marker>
                      <marker id="tl-arrow-bad" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#d92d20" /></marker>
                    </defs>
                    {links.map(({ before, after }) => {
                      const from = spanFor(before)
                      const to = spanFor(after)
                      const x1 = x(from.end + 1)
                      const y1 = positions.get(before.id) * ROW + ROW / 2
                      const x2 = x(to.start)
                      const y2 = positions.get(after.id) * ROW + ROW / 2
                      const bad = to.start <= from.end
                      const path = x2 >= x1 + 12 ? `M${x1} ${y1} H${x1 + 8} V${y2} H${x2 - 2}` : `M${x1} ${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2 - 2}`
                      return (
                        <g key={`${before.id}-${after.id}`} className={`timeline-link${bad ? ' is-bad' : ''}`}>
                          <path d={path} fill="none" stroke="transparent" strokeWidth="12" style={{ cursor: 'pointer' }} role="button" tabIndex={0} aria-label={`Link: ${after.title} waits for ${before.title}`} onClick={() => setPickedLink({ before, after })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setPickedLink({ before, after }) }} />
                          <path d={path} fill="none" stroke={bad ? '#d92d20' : '#667085'} strokeWidth="1.6" markerEnd={bad ? 'url(#tl-arrow-bad)' : 'url(#tl-arrow)'} pointerEvents="none" />
                        </g>
                      )
                    })}
                  </svg>
                  {rows.map((row, index) => {
                    if (row.type === 'milestone') {
                      const left = x(dayNumber(row.milestone.due_date)) + pxPerDay / 2
                      return <span key={row.key} className={`timeline-diamond${row.milestone.complete ? ' is-complete' : ''}${row.milestone.is_late ? ' is-late' : ''}`} style={{ left, top: index * ROW + ROW / 2 }} title={`${row.milestone.title} - ${row.milestone.due_date}`} role="img" aria-label={`Milestone ${row.milestone.title}, ${row.milestone.due_date}`} />
                    }
                    if (row.type !== 'task') return null
                    const task = row.task
                    const span = spanFor(task)
                    const blocked = statusOf(task) === 'blocked' || task.is_blocked_by_dependency
                    const tone = statusOf(task) === 'done' ? 'done' : blocked ? 'blocked' : statusOf(task) === 'in progress' || statusOf(task) === 'review' ? 'in-progress' : 'todo'
                    const barWidth = (span.end - span.start + 1) * pxPerDay
                    return (
                      <div
                        key={row.key}
                        className={`timeline-bar is-${tone}${drag?.id === task.id ? ' is-dragging' : ''}${linking?.id === task.id ? ' is-linking' : ''}${canEdit && !linking ? ' is-draggable' : ''}`}
                        style={{ left: x(span.start), width: barWidth, top: index * ROW + 7 }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${task.title}, ${isoFromDay(span.start)} to ${isoFromDay(span.end)}${task.progress_percent ? `, ${task.progress_percent}% done` : ''}`}
                        onPointerDown={event => { if (event.target.closest('button')) return; startDrag(task, 'move', event) }}
                        onPointerMove={moveDrag}
                        onPointerUp={event => { if (event.target.closest('button')) return; endDrag(task, event) }}
                        onPointerCancel={() => { dragRef.current = null; setDrag(null) }}
                        onClick={event => { if (linking && linking.id !== task.id) { event.stopPropagation(); addLink(linking, task) } }}
                        onKeyDown={event => { if (event.key === 'Enter') { if (linking && linking.id !== task.id) addLink(linking, task); else if (!linking) onOpenTask?.(task) } }}
                      >
                        <i className="timeline-bar-fill" style={{ width: `${Math.min(100, task.progress_percent || 0)}%` }} />
                        {barWidth >= 150 && <span className="timeline-bar-title">{task.title}</span>}
                        {barWidth < 150 && <span className={`timeline-bar-outside${x(span.start) + barWidth > width - 220 ? ' is-left' : ''}`}>{task.title}</span>}
                        {canEdit && <span className="timeline-grip is-start" onPointerDown={event => { event.stopPropagation(); startDrag(task, 'start', event) }} onPointerMove={moveDrag} onPointerUp={event => { event.stopPropagation(); endDrag(task, event) }} aria-hidden="true" />}
                        {canEdit && <span className="timeline-grip is-end" onPointerDown={event => { event.stopPropagation(); startDrag(task, 'end', event) }} onPointerMove={moveDrag} onPointerUp={event => { event.stopPropagation(); endDrag(task, event) }} aria-hidden="true" />}
                        {canEdit && <button type="button" className="timeline-link-button" aria-label={`Link from ${task.title}`} title="Another task must wait for this one" onClick={event => { event.stopPropagation(); setLinking(task); setPickedLink(null) }}><Link2 size={12} aria-hidden="true" /></button>}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

      {unscheduled.length > 0 && (
        <section className="timeline-unscheduled" aria-label="Tasks without dates">
          <h3><AlertTriangle size={15} aria-hidden="true" /> {unscheduled.length} {unscheduled.length === 1 ? 'task has' : 'tasks have'} no dates, so {unscheduled.length === 1 ? 'it is' : 'they are'} not on the timeline</h3>
          <ul>
            {unscheduled.slice(0, 12).map(task => (
              <li key={task.id}>
                <button type="button" className="timeline-task-name" onClick={() => onOpenTask?.(task)}>{task.title}</button>
                {canEdit && (
                  <span className="timeline-schedule">
                    <input type="date" aria-label={`Start date for ${task.title}`} onChange={event => event.target.value && patchTask(task, { start_date: event.target.value })} />
                    <input type="date" aria-label={`Due date for ${task.title}`} onChange={event => event.target.value && patchTask(task, { due_date: event.target.value })} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {unscheduled.length > 12 && <p className="team-day-muted">And {unscheduled.length - 12} more.</p>}
        </section>
      )}
    </section>
  )
}

