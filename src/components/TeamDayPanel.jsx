import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Building2, ChevronDown, ChevronLeft, ChevronRight, Home, Plane } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { AppSelect } from './ui/select.jsx'
import { fmtDate, isoDate, workspaceCall } from '../lib/workspace-api.js'
import { getCsrfToken } from '../lib/workspace-format.js'

// The Team page's daily picture, for owners and managers: who is planned for what,
// what is done, who has checked in and clocked in; a week grid of planned hours
// against capacity; hints for moving work from an overbooked day to a free one; and
// work nobody owns yet. Every number comes from the server (tasks, check-ins, shifts,
// leave and location), and a task with no estimate counts as three hours and is
// flagged, so a low figure is never trusted by mistake.
export const hours = minutes => {
  const value = Math.round((Number(minutes) || 0) / 6) / 10
  if (!minutes) return '0h'
  return minutes < 60 ? `${minutes}m` : `${value}h`
}

export function cellTone(planned, capacity) {
  if (capacity <= 0) return planned > 0 ? 'over' : 'off'
  if (planned > capacity) return 'over'
  if (planned >= capacity * 0.9) return 'full'
  return planned === 0 ? 'empty' : 'ok'
}

// Moves from an overbooked day to the person with the most room that day, never
// automatically: each hint is a suggestion with one button.
export function rebalanceHints(members) {
  const hints = []
  members.forEach(from => {
    Object.entries(from.days).forEach(([day, cell]) => {
      if (cellTone(cell.planned_minutes, cell.capacity_minutes) !== 'over' || !cell.tasks.length) return
      const excess = cell.planned_minutes - cell.capacity_minutes
      const candidates = [...cell.tasks].sort((a, b) => b.minutes - a.minutes)
      const task = candidates.find(item => item.minutes >= excess) || candidates[0]
      let best = null
      members.forEach(to => {
        if (to.id === from.id) return
        const target = to.days[day]
        if (!target || target.capacity_minutes <= 0) return
        const free = target.capacity_minutes - target.planned_minutes
        if (free >= task.minutes && (!best || free > best.free)) best = { to, free }
      })
      if (best) hints.push({ key: `${from.id}-${day}-${task.id}`, from, day, task, to: best.to, free: best.free })
    })
  })
  return hints.slice(0, 5)
}

const FILTERS = [
  ['not_checked_in', s => `${s.checked_in} of ${s.expected_check_ins} checked in`, row => row.expects_check_in && !row.checked_in && row.leave_share < 1],
  ['clocked_in', s => `${s.clocked_in} clocked in now`, row => row.clocked_in],
  ['done', s => `${s.done_today} done today`, row => row.done_count > 0],
  ['blocked', s => `${s.blocked} blocked`, row => row.blocked_count > 0],
  ['overdue', s => `${s.overdue} overdue`, row => row.overdue_count > 0],
  ['on_leave', s => `${s.on_leave} on leave`, row => row.leave_share >= 1],
  ['at_home', s => `${s.at_home} at home`, row => row.location === 'home'],
]

function LocationChip({ row }) {
  if (row.leave_share >= 1) return <span className="team-day-chip is-leave"><Plane size={12} aria-hidden="true" /> On leave</span>
  if (row.location === 'home') return <span className="team-day-chip"><Home size={12} aria-hidden="true" /> Home{row.location_source !== 'set' ? ' (usual)' : ''}</span>
  if (row.location === 'office') return <span className="team-day-chip"><Building2 size={12} aria-hidden="true" /> Office{row.location_source !== 'set' ? ' (usual)' : ''}</span>
  return null
}

function TaskLine({ task, members, ownerId, onReassign }) {
  return (
    <li className="team-day-task">
      <span><strong>{task.title}</strong>{task.due_date ? ` - due ${task.due_date}` : ''}{task.estimate_minutes ? ` - ${hours(task.estimate_minutes)}` : ' - no estimate'}</span>
      {onReassign && (
        <AppSelect className="team-day-reassign" value="" aria-label={`Reassign ${task.title}`} onChange={event => event.target.value && onReassign(task, event.target.value)}>
          <option value="">Reassign...</option>
          {members.filter(member => member.id !== ownerId).map(member => <option key={member.id} value={String(member.id)}>{member.name}</option>)}
        </AppSelect>
      )}
    </li>
  )
}

function Sparkline({ values }) {
  const top = Math.max(1, ...values)
  return (
    <span className="team-day-spark" role="img" aria-label={`Tasks finished in the last four weeks: ${values.join(', ')}`}>
      {values.map((value, index) => <i key={index} style={{ height: `${Math.max(8, (value / top) * 100)}%` }} title={`${value} finished`} />)}
    </span>
  )
}

function PersonDetail({ workspaceId, row, members, date, onReassign, onNudge }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    workspaceCall(workspaceId, `team-day/${row.id}/?date=${date}`, 'GET')
      .then(data => { if (!cancelled) setDetail(data) })
      .catch(failure => { if (!cancelled) setError(failure.message) })
    return () => { cancelled = true }
  }, [workspaceId, row.id, date])
  if (error) return <p className="memo-error" role="alert">{error}</p>
  if (!detail) return <p className="team-day-muted" role="status">Loading {row.name}&apos;s day...</p>
  const sections = [['Done today', detail.done, false], ['In progress', detail.in_progress, true], ['Blocked', detail.blocked, true], ['Overdue', detail.overdue, true], ['Due today', detail.due_today, true]]
  return (
    <div className="team-day-detail">
      <div className="team-day-detail-head">
        <span>{row.last_done ? <>Last finished: <strong>{row.last_done.title}</strong> at {new Date(row.last_done.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</> : 'Nothing finished yet today.'}</span>
        <span className="team-day-spark-label">Finished per week <Sparkline values={detail.weekly_done} /></span>
        <Button type="button" variant="outline" size="sm" onClick={() => onNudge(row)}>Message {row.name.split(' ')[0]}</Button>
      </div>
      {detail.check_in
        ? <p className="team-day-checkin"><strong>Check-in:</strong> {detail.check_in.completed || 'No update written'}{detail.check_in.blockers ? ` Blockers: ${detail.check_in.blockers}` : ''}</p>
        : <p className="team-day-muted">{row.expects_check_in ? 'Has not checked in today.' : 'Does not check in.'}</p>}
      {sections.map(([title, items, canMove]) => items.length > 0 && (
        <section key={title}>
          <h4>{title} ({items.length})</h4>
          <ul>{items.map(task => <TaskLine key={task.id} task={task} members={members} ownerId={row.id} onReassign={canMove ? onReassign : null} />)}</ul>
        </section>
      ))}
      {sections.every(([, items]) => !items.length) && <p className="team-day-muted">No tasks for this person today.</p>}
    </div>
  )
}

export default function TeamDayPanel({ workspaceId, isLeader, onNavigate }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('team-day-mode') === 'week' ? 'week' : 'today' } catch { return 'today' } })
  const [day, setDay] = useState(null)
  const [week, setWeek] = useState(null)
  const [weekStart, setWeekStart] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)) })
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [cellOpen, setCellOpen] = useState(null)
  const today = isoDate(new Date())

  const loadDay = useCallback(async () => {
    try { setDay(await workspaceCall(workspaceId, `team-day/?date=${today}`, 'GET')); setError('') } catch (failure) { setError(failure.message) }
  }, [workspaceId, today])
  const loadWeek = useCallback(async () => {
    try { setWeek(await workspaceCall(workspaceId, `team-week/?start=${isoDate(weekStart)}`, 'GET')); setError('') } catch (failure) { setError(failure.message) }
  }, [workspaceId, weekStart])
  useEffect(() => { if (isLeader && mode === 'today') loadDay() }, [isLeader, mode, loadDay])
  useEffect(() => { if (isLeader && mode === 'week') { loadWeek(); if (!day) loadDay() } }, [isLeader, mode, loadWeek]) // eslint-disable-line react-hooks/exhaustive-deps

  const chooseMode = next => { setMode(next); try { localStorage.setItem('team-day-mode', next) } catch { /* not remembered */ } }
  const reassign = async (task, userId) => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': String(workspaceId), 'X-CSRFToken': await getCsrfToken() },
        body: JSON.stringify({ assignee_id: Number(userId) }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'That task could not be reassigned.')
      toast.success('Task reassigned.')
      setExpanded(null)
      setCellOpen(null)
      await Promise.all([loadDay(), mode === 'week' ? loadWeek() : null])
    } catch (failure) {
      setError(failure.message)
    }
  }

  const rows = day?.members || []
  const summary = day?.summary
  const shown = useMemo(() => {
    const chosen = FILTERS.find(([key]) => key === filter)
    return chosen ? rows.filter(chosen[2]) : rows
  }, [rows, filter])
  const hints = useMemo(() => (week ? rebalanceHints(week.members) : []), [week])
  if (!isLeader) return null

  // The days come from the week the server answered for, so a late answer for another week never mixes in.
  const firstOfWeek = week ? new Date(`${week.start}T00:00:00`) : null
  const weekDays = week ? Array.from({ length: 7 }, (_, index) => isoDate(new Date(firstOfWeek.getFullYear(), firstOfWeek.getMonth(), firstOfWeek.getDate() + index))) : []
  const shownDays = weekDays.filter((key, index) => index < 5 || week.members.some(member => member.days[key]?.capacity_minutes > 0 || member.days[key]?.planned_minutes > 0))
  const openCell = cellOpen && week ? week.members.find(member => member.id === cellOpen.id)?.days[cellOpen.day] : null

  return (
    <section className="team-day" aria-label="Daily team picture">
      <header className="team-day-header">
        <div>
          <h2>Daily picture</h2>
          <p>{mode === 'today' ? `Planned, done and logged today (${fmtDate(today)}).` : 'Planned hours against capacity, day by day.'}</p>
        </div>
        <div className="plan-view-toggle" role="group" aria-label="Team view">
          <button type="button" aria-pressed={mode === 'today'} className={mode === 'today' ? 'is-active' : ''} onClick={() => chooseMode('today')}>Today</button>
          <button type="button" aria-pressed={mode === 'week'} className={mode === 'week' ? 'is-active' : ''} onClick={() => chooseMode('week')}>This week</button>
        </div>
      </header>
      {error && <p className="memo-error" role="alert">{error}</p>}

      {summary && (
        <div className="team-day-strip" role="group" aria-label="Today at a glance">
          {FILTERS.map(([key, label]) => (
            <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(current => (current === key ? 'all' : key))}>{label(summary)}</button>
          ))}
        </div>
      )}
      {summary && summary.missing_estimates > 0 && (
        <p className="team-day-warning" role="note">
          <AlertTriangle size={15} aria-hidden="true" /> {summary.missing_estimates} open {summary.missing_estimates === 1 ? 'task has' : 'tasks have'} no estimate, so workload is understated (each counts as 3 hours).
          <button type="button" onClick={() => onNavigate?.('Planner')}>Review tasks</button>
        </p>
      )}

      {mode === 'today' && day && (
        <div className="team-day-scroll">
          <table className="team-day-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Planned today</th><th scope="col">Done today</th><th scope="col">Logged</th><th scope="col">Check-in</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
            <tbody>
              {shown.map(row => {
                const tone = cellTone(row.planned_minutes, row.capacity_minutes)
                const percent = row.capacity_minutes ? Math.min(100, Math.round((row.planned_minutes / row.capacity_minutes) * 100)) : row.planned_minutes ? 100 : 0
                const open = expanded === row.id
                return (
                  <React.Fragment key={row.id}>
                    <tr className={open ? 'is-open' : ''}>
                      <th scope="row"><strong>{row.name}</strong><LocationChip row={row} /></th>
                      <td><span className={`team-day-bar is-${tone}`}><i style={{ width: `${percent}%` }} /></span><small>{hours(row.planned_minutes)} / {hours(row.capacity_minutes)}{row.planned_count ? ` - ${row.planned_count} ${row.planned_count === 1 ? 'task' : 'tasks'}` : ''}{row.missing_estimates ? ' (some unestimated)' : ''}</small></td>
                      <td><strong>{row.done_count}</strong><small>{row.done_minutes ? hours(row.done_minutes) : row.done_count ? 'no estimate' : ''}</small></td>
                      <td><strong>{hours(row.logged_minutes)}</strong><small>{row.on_break ? 'on a break' : row.clocked_in ? 'clocked in' : ''}</small></td>
                      <td>{row.expects_check_in ? (row.checked_in ? <span className="team-day-yes">Checked in</span> : row.leave_share >= 1 ? <span className="team-day-muted">On leave</span> : <span className="team-day-no">Not yet</span>) : <span className="team-day-muted">Not needed</span>}</td>
                      <td><button type="button" className="team-day-expand" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${row.name}'s day`} onClick={() => setExpanded(open ? null : row.id)}><ChevronDown size={16} aria-hidden="true" /></button></td>
                    </tr>
                    {open && <tr className="team-day-open-row"><td colSpan={6}><PersonDetail workspaceId={workspaceId} row={row} members={rows} date={today} onReassign={reassign} onNudge={() => onNavigate?.('Chats')} /></td></tr>}
                  </React.Fragment>
                )
              })}
              {!shown.length && <tr><td colSpan={6} className="team-day-muted">Nobody matches this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {mode === 'week' && week && (
        <>
          <div className="where-toolbar">
            <Button type="button" variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeekStart(current => new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7))}><ChevronLeft size={14} aria-hidden="true" /></Button>
            <strong>{fmtDate(week.start)} to {fmtDate(week.end)}</strong>
            <Button type="button" variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeekStart(current => new Date(current.getFullYear(), current.getMonth(), current.getDate() + 7))}><ChevronRight size={14} aria-hidden="true" /></Button>
          </div>
          <div className="team-day-scroll">
            <table className="team-day-table team-week-table">
              <thead><tr><th scope="col">Person</th>{shownDays.map(key => <th scope="col" key={key} className={key === today ? 'is-today' : ''}>{new Date(`${key}T00:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</th>)}</tr></thead>
              <tbody>
                {week.members.map(member => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}</th>
                    {shownDays.map(key => {
                      const cell = member.days[key]
                      if (!cell) return <td key={key} />
                      const tone = cellTone(cell.planned_minutes, cell.capacity_minutes)
                      return (
                        <td key={key}>
                          <button type="button" className={`team-week-cell is-${tone}`} disabled={!cell.task_count} aria-label={`${member.name} on ${fmtDate(key)}: ${hours(cell.planned_minutes)} planned of ${hours(cell.capacity_minutes)}`} onClick={() => setCellOpen(current => (current?.id === member.id && current.day === key ? null : { id: member.id, day: key }))}>
                            <strong>{hours(cell.planned_minutes)}</strong><small>of {hours(cell.capacity_minutes)}</small>
                            {cell.leave_share >= 1 ? <Plane size={12} aria-label="On leave" /> : cell.location === 'home' ? <Home size={12} aria-label="Home" /> : cell.location === 'office' ? <Building2 size={12} aria-label="Office" /> : null}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="team-day-muted team-day-legend">Green has room, amber is nearly full, red is over capacity. Select a cell to see its tasks.</p>
          {openCell && (
            <div className="team-day-cell-tasks">
              <h4>{week.members.find(member => member.id === cellOpen.id)?.name} on {fmtDate(cellOpen.day)}</h4>
              <ul>{openCell.tasks.map(task => <TaskLine key={task.id} task={{ ...task, estimate_minutes: task.estimated ? task.minutes : null }} members={week.members} ownerId={cellOpen.id} onReassign={reassign} />)}</ul>
            </div>
          )}
          {hints.length > 0 && (
            <section className="team-day-hints" aria-label="Suggested moves">
              <h3>Suggested moves</h3>
              {hints.map(hint => (
                <p key={hint.key}>
                  <span><strong>{hint.from.name}</strong> is over capacity on {fmtDate(hint.day, { weekday: 'long' })}; <strong>{hint.to.name}</strong> has {hours(hint.free)} free. Move &quot;{hint.task.title}&quot; ({hours(hint.task.minutes)})?</span>
                  <Button type="button" size="sm" onClick={() => reassign(hint.task, String(hint.to.id))}>Move to {hint.to.name.split(' ')[0]}</Button>
                </p>
              ))}
            </section>
          )}
        </>
      )}

      {day && day.unassigned.length > 0 && (
        <section className="team-day-unassigned" aria-label="Work nobody owns">
          <h3>Nobody owns these yet ({summary.unassigned})</h3>
          <ul>
            {day.unassigned.map(task => <TaskLine key={task.id} task={task} members={rows} ownerId={null} onReassign={reassign} />)}
          </ul>
        </section>
      )}
    </section>
  )
}
