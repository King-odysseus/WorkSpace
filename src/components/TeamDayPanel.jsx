import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, Building2, ChevronLeft, ChevronRight, Home, Plane, Trash2, X } from 'lucide-react'
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
  ['all', 'Everyone', () => true],
  ['overbooked', 'Overbooked', row => cellTone(row.planned_minutes, row.capacity_minutes) === 'over'],
  ['not_checked_in', 'Not checked in', row => row.expects_check_in && !row.checked_in && row.leave_share < 1],
  ['blocked', 'Blocked', row => row.blocked_count > 0],
  ['overdue', 'Overdue', row => row.overdue_count > 0],
  ['away', 'Away', row => row.leave_share >= 1],
]

const UNASSIGNED_SHOWN = 8
const RING_COLOURS = { ok: '#12b76a', full: '#f79009', over: '#d92d20', empty: '#98a2b3', off: '#98a2b3', navy: '#0B0B45' }

// A circle that fills with a share of a whole; the words sit in the middle so it never needs a legend.
export function Ring({ value, tone = 'navy', size = 84, stroke = 8, label, children }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const share = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <span className="team-ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--pencil-border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={RING_COLOURS[tone] || RING_COLOURS.navy} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="team-ring-text" aria-hidden="true">{children}</span>
    </span>
  )
}

const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('')

function LocationChip({ row }) {
  if (row.leave_share >= 1) return <span className="team-day-chip is-leave"><Plane size={12} aria-hidden="true" /> On leave</span>
  if (row.location === 'home') return <span className="team-day-chip"><Home size={12} aria-hidden="true" /> Home{row.location_source !== 'set' ? ' (usual)' : ''}</span>
  if (row.location === 'office') return <span className="team-day-chip"><Building2 size={12} aria-hidden="true" /> Office{row.location_source !== 'set' ? ' (usual)' : ''}</span>
  return null
}

function TaskLine({ task, members, ownerId, onReassign, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="team-day-task">
      <span><strong>{task.title}</strong>{task.due_date ? ` - due ${task.due_date}` : ''}{task.estimate_minutes ? ` - ${hours(task.estimate_minutes)}` : ' - no estimate'}</span>
      <span className="team-day-task-actions">
        {onReassign && (
          <AppSelect className="team-day-reassign" value="" aria-label={`Reassign ${task.title}`} onChange={event => event.target.value && onReassign(task, event.target.value)}>
            <option value="">Reassign...</option>
            {members.filter(member => member.id !== ownerId).map(member => <option key={member.id} value={String(member.id)}>{member.name}</option>)}
          </AppSelect>
        )}
        {onDelete && (confirming
          ? (
            <span className="team-day-confirm" role="group" aria-label={`Delete ${task.title}?`}>
              <Button type="button" variant="destructive" size="sm" onClick={() => { setConfirming(false); onDelete(task) }}>Delete</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
            </span>
          )
          : <button type="button" className="team-day-delete" aria-label={`Delete ${task.title}`} title="Delete this task" onClick={() => setConfirming(true)}><Trash2 size={15} aria-hidden="true" /></button>)}
      </span>
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

function PersonDetail({ workspaceId, row, members, date, onReassign, onDelete, onNudge }) {
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
          <ul>{items.map(task => <TaskLine key={task.id} task={task} members={members} ownerId={row.id} onReassign={canMove ? onReassign : null} onDelete={onDelete} />)}</ul>
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
  const [showAllUnassigned, setShowAllUnassigned] = useState(false)
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

  const deleteTask = async task => {
    try {
      const response = await fetch(`/api/tasks/${task.id}/`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'X-Workspace-Id': String(workspaceId), 'X-CSRFToken': await getCsrfToken() },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'That task could not be deleted.')
      toast.success('Task deleted.')
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

  const expandedRow = rows.find(row => row.id === expanded) || null
  const plannedCount = rows.reduce((total, row) => total + row.planned_count, 0)
  const doneShare = summary && summary.done_today + plannedCount ? summary.done_today / (summary.done_today + plannedCount) : 0
  const loadShare = summary && summary.capacity_minutes ? summary.planned_minutes / summary.capacity_minutes : summary?.planned_minutes ? 1 : 0
  const loadPercent = Math.round(loadShare * 100)
  const attention = summary ? [
    summary.overdue > 0 && { key: 'overdue', label: `${summary.overdue} overdue`, onClick: () => { setMode('today'); setFilter('overdue') } },
    summary.blocked > 0 && { key: 'blocked', label: `${summary.blocked} blocked`, onClick: () => { setMode('today'); setFilter('blocked') } },
    summary.expected_check_ins - summary.checked_in > 0 && { key: 'checkin', label: `${summary.expected_check_ins - summary.checked_in} not checked in`, onClick: () => { setMode('today'); setFilter('not_checked_in') } },
    summary.missing_estimates > 0 && { key: 'estimates', label: `${summary.missing_estimates} open ${summary.missing_estimates === 1 ? 'task has' : 'tasks have'} no estimate (counted as 3 hours each)`, onClick: () => onNavigate?.('Planner') },
    summary.unassigned > 0 && { key: 'unassigned', label: `${summary.unassigned} ${summary.unassigned === 1 ? 'task has' : 'tasks have'} no owner`, onClick: () => document.getElementById('team-day-unassigned')?.scrollIntoView?.({ behavior: 'smooth' }) },
  ].filter(Boolean) : []

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
        <div className="team-day-top">
          <div className="team-day-rings" role="group" aria-label="Today at a glance">
            <div className="team-day-ringcard">
              <Ring value={summary.expected_check_ins ? summary.checked_in / summary.expected_check_ins : 0} label={`${summary.checked_in} of ${summary.expected_check_ins} checked in`}><strong>{summary.checked_in}/{summary.expected_check_ins}</strong></Ring>
              <span>Checked in</span>
            </div>
            <div className="team-day-ringcard">
              <Ring value={doneShare} label={`${summary.done_today} done today, ${plannedCount} still planned`}><strong>{summary.done_today}</strong></Ring>
              <span>Done today</span>
              <small>{plannedCount} still planned</small>
            </div>
            <div className="team-day-ringcard">
              <Ring value={loadShare} tone={cellTone(summary.planned_minutes, summary.capacity_minutes)} label={`Team load ${loadPercent}%: ${hours(summary.planned_minutes)} planned of ${hours(summary.capacity_minutes)}`}><strong>{loadPercent}%</strong></Ring>
              <span>Team load</span>
              <small>{hours(summary.planned_minutes)} / {hours(summary.capacity_minutes)}</small>
            </div>
          </div>
          <div className="team-day-attention" role="group" aria-label="Needs attention">
            <h3>Needs attention</h3>
            {attention.length === 0 && <p className="team-day-muted">Nothing needs you right now.</p>}
            <ul>
              {attention.map(item => (
                <li key={item.key}><button type="button" onClick={item.onClick}><AlertTriangle size={14} aria-hidden="true" /> {item.label}</button></li>
              ))}
            </ul>
            <p className="team-day-muted">
              {summary.clocked_in} clocked in now - {summary.on_leave} on leave - {summary.at_home} at home - {summary.in_office} in the office
            </p>
          </div>
        </div>
      )}

      {mode === 'today' && day && (
        <>
          <div className="team-day-filters" role="group" aria-label="Filter people">
            {FILTERS.map(([key, label]) => (
              <button type="button" key={key} aria-pressed={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          <div className={`team-day-body${expandedRow ? ' has-side' : ''}`}>
            <ul className="team-day-people" aria-label="People">
              {shown.map(row => {
                const tone = cellTone(row.planned_minutes, row.capacity_minutes)
                const share = row.capacity_minutes ? row.planned_minutes / row.capacity_minutes : row.planned_minutes ? 1 : 0
                const open = expanded === row.id
                return (
                  <li key={row.id} className={`team-day-person${open ? ' is-open' : ''}`}>
                    <span className="team-day-avatar" aria-hidden="true">{initials(row.name)}</span>
                    <div className="team-day-who">
                      <strong>{row.name}</strong>
                      <LocationChip row={row} />
                    </div>
                    <Ring size={52} stroke={6} value={share} tone={tone} label={`${row.name}: ${hours(row.planned_minutes)} planned of ${hours(row.capacity_minutes)}`}><span>{row.capacity_minutes ? `${Math.round(share * 100)}%` : '-'}</span></Ring>
                    <div className="team-day-load">
                      <span>{hours(row.planned_minutes)} / {hours(row.capacity_minutes)}</span>
                      <small>{row.planned_count ? `${row.planned_count} ${row.planned_count === 1 ? 'task' : 'tasks'}` : 'No tasks planned'}{row.missing_estimates ? ' (some unestimated)' : ''}</small>
                    </div>
                    <div className="team-day-done">
                      <strong>{row.done_count} done</strong>
                      <small>{hours(row.logged_minutes)} logged{row.on_break ? ', on a break' : row.clocked_in ? ', clocked in' : ''}</small>
                    </div>
                    <div className="team-day-status">
                      {row.expects_check_in ? (row.checked_in ? <span className="team-day-yes">Checked in</span> : row.leave_share >= 1 ? <span className="team-day-muted">On leave</span> : <span className="team-day-no">Not yet</span>) : <span className="team-day-muted">Not needed</span>}
                      {row.blocked_count > 0 && <small>{row.blocked_count} blocked</small>}
                      {row.overdue_count > 0 && <small>{row.overdue_count} overdue</small>}
                    </div>
                    <button type="button" className="team-day-expand" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${row.name}'s day`} onClick={() => setExpanded(open ? null : row.id)}><ChevronRight size={16} aria-hidden="true" /></button>
                  </li>
                )
              })}
              {!shown.length && <li className="team-day-muted team-day-empty">Nobody matches this filter.</li>}
            </ul>
            {expandedRow && (
              <aside className="team-day-side" aria-label={`${expandedRow.name}'s day`}>
                <div className="team-day-side-head">
                  <h3>{expandedRow.name}</h3>
                  <button type="button" className="team-day-expand" aria-label="Close" onClick={() => setExpanded(null)}><X size={16} aria-hidden="true" /></button>
                </div>
                <PersonDetail workspaceId={workspaceId} row={expandedRow} members={rows} date={today} onReassign={reassign} onDelete={deleteTask} onNudge={() => onNavigate?.('Chats')} />
              </aside>
            )}
          </div>
        </>
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
              <ul>{openCell.tasks.map(task => <TaskLine key={task.id} task={{ ...task, estimate_minutes: task.estimated ? task.minutes : null }} members={week.members} ownerId={cellOpen.id} onReassign={reassign} onDelete={deleteTask} />)}</ul>
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
        <section className="team-day-unassigned" id="team-day-unassigned" aria-label="Work nobody owns">
          <h3>Nobody owns these yet ({summary.unassigned})</h3>
          <ul>
            {(showAllUnassigned ? day.unassigned : day.unassigned.slice(0, UNASSIGNED_SHOWN)).map(task => <TaskLine key={task.id} task={task} members={rows} ownerId={null} onReassign={reassign} onDelete={deleteTask} />)}
          </ul>
          {day.unassigned.length > UNASSIGNED_SHOWN && (
            <Button type="button" variant="outline" size="sm" className="team-day-more" onClick={() => setShowAllUnassigned(current => !current)}>
              {showAllUnassigned ? 'Show fewer' : `Show all ${day.unassigned.length} listed`}
            </Button>
          )}
        </section>
      )}
    </section>
  )
}
