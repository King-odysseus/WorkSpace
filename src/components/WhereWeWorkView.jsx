import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Building2, ChevronLeft, ChevronRight, Home, MapPin, Plane } from 'lucide-react'
import { Button } from './ui/button.jsx'
import { AppSelect } from './ui/select.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { fmtDate, isoDate, useWorkspaceCall } from '../lib/workspace-api.js'

// Where the team works each day: office, home or elsewhere. People set their own
// usual week and can change any single day. A day nobody has set is assumed from
// the usual week, then from the workspace's optional office days, and is shown
// lighter so an assumption never looks like something somebody said.
const PLACES = { office: ['Office', Building2], home: ['Home', Home], other: ['Other', MapPin] }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayOf(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7))
  return copy
}

export function summariseDay(members, key) {
  const counts = { office: 0, home: 0, other: 0, leave: 0 }
  members.forEach(member => {
    const day = member.days[key]
    if (!day) return
    if (day.source === 'leave') counts.leave += 1
    else if (day.location) counts[day.location] += 1
  })
  return counts
}

function Cell({ day, officeDays, weekday }) {
  if (!day || day.source === 'off') return <span className="where-cell is-off" aria-label="Not working">-</span>
  if (day.source === 'leave') return <span className="where-cell is-leave"><Plane size={14} aria-hidden="true" /> On leave</span>
  if (!day.location) return <span className="where-cell is-none" aria-label="Not set">?</span>
  const [label, Icon] = PLACES[day.location]
  const assumed = day.source === 'pattern' || day.source === 'policy'
  const awayFromPolicy = officeDays.includes(weekday) && day.location !== 'office'
  return (
    <span
      className={`where-cell is-${day.location}${assumed ? ' is-assumed' : ''}${awayFromPolicy ? ' is-off-policy' : ''}`}
      title={`${label}${day.source === 'set' ? '' : ' (assumed from the usual week)'}${awayFromPolicy ? ' - not an office day' : ''}`}
    >
      <Icon size={14} aria-hidden="true" /> {label}{day.leave > 0 && day.leave < 1 ? ' (half day off)' : ''}
    </span>
  )
}

export default function WhereWeWorkView({ workspaceId, currentUserId }) {
  const call = useWorkspaceCall(workspaceId)
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [pattern, setPattern] = useState({})
  const [officeDays, setOfficeDays] = useState([])

  const start = isoDate(weekStart)
  const end = isoDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6))

  const load = useCallback(async () => {
    try {
      const result = await call(`locations/?start=${start}&end=${end}`, 'GET')
      setData(result)
      setPattern(result.my_pattern || {})
      setOfficeDays(result.office_days || [])
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [call, start, end])
  useEffect(() => { load() }, [load])

  const dates = useMemo(() => Array.from({ length: 7 }, (_, index) => isoDate(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index))), [weekStart])
  const shownIndexes = useMemo(() => dates.map((_, index) => index).filter(index => index < 5 || data?.members.some(member => member.working_days.includes(index))), [dates, data])

  const run = async work => {
    setError('')
    try { await work(); await load() } catch (runError) { setError(runError.message) }
  }
  const setDay = (date, value) => run(async () => { await call('locations/', 'PUT', { date, location: value || null }); toast.success(value ? `Saved: ${PLACES[value][0]} on ${fmtDate(date)}.` : `Back to your usual place on ${fmtDate(date)}.`) })
  const savePattern = () => run(async () => { await call('location-pattern/', 'PUT', { pattern }); toast.success('Your usual week is saved.') })
  const savePolicy = () => run(async () => { await call('office-days/', 'PATCH', { office_days: officeDays }); toast.success('Office days are saved.') })
  const shift = weeks => setWeekStart(current => new Date(current.getFullYear(), current.getMonth(), current.getDate() + weeks * 7))

  const members = data?.members || []
  const todayKey = isoDate(new Date())
  const today = summariseDay(members, todayKey)
  const me = members.find(member => member.id === currentUserId)

  return (
    <section className="workspace-view where-view">
      <WorkspaceViewHeading
        eyebrow="People"
        title="Where we work"
        subtitle={members.length && dates.includes(todayKey)
          ? `Today: ${today.office} in the office, ${today.home} at home${today.other ? `, ${today.other} elsewhere` : ''}${today.leave ? `, ${today.leave} on leave` : ''}.`
          : 'Office, home or elsewhere, day by day.'}
      />
      {error && <p className="memo-error" role="alert">{error}</p>}
      <div className="where-toolbar">
        <Button type="button" variant="secondary" size="sm" onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft size={14} aria-hidden="true" /></Button>
        <strong>{fmtDate(start, { dateStyle: 'medium' })} to {fmtDate(end, { dateStyle: 'medium' })}</strong>
        <Button type="button" variant="secondary" size="sm" onClick={() => shift(1)} aria-label="Next week"><ChevronRight size={14} aria-hidden="true" /></Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => setWeekStart(mondayOf(new Date()))}>This week</Button>
      </div>
      <div className="where-scroll">
        <table className="where-table">
          <thead>
            <tr><th scope="col">Person</th>{shownIndexes.map(index => <th scope="col" key={dates[index]} className={dates[index] === todayKey ? 'is-today' : ''}>{WEEKDAYS[index]} {new Date(`${dates[index]}T00:00:00`).getDate()}</th>)}</tr>
          </thead>
          <tbody>
            {members.map(member => (
              <tr key={member.id} className={member.id === currentUserId ? 'is-me' : ''}>
                <th scope="row">{member.name}{member.id === currentUserId ? ' (you)' : ''}</th>
                {shownIndexes.map(index => {
                  const key = dates[index]
                  const day = member.days[key]
                  return (
                    <td key={key}>
                      {member.id === currentUserId && day && day.source !== 'off' && day.source !== 'leave'
                        ? <AppSelect className="where-select" aria-label={`Where you work on ${fmtDate(key)}`} value={day.source === 'set' ? day.location : ''} onChange={event => setDay(key, event.target.value)}>
                          <option value="">{day.location ? `${PLACES[day.location][0]} (usual)` : 'Not set'}</option>
                          {Object.entries(PLACES).map(([value, [label]]) => <option key={value} value={value}>{label}</option>)}
                        </AppSelect>
                        : <Cell day={day} officeDays={data.office_days} weekday={index} />}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="memo-card-meta where-legend">Lighter entries are assumed from a usual week or the office days, not set by the person. A ? means nobody has said.</p>

      <div className="requests-panel">
        <section aria-label="My usual week" className="request-form">
          <h2>My usual week</h2>
          <p className="memo-card-meta">Set where you normally work. You can still change any single day above.</p>
          <div className="where-pattern">
            {WEEKDAYS.slice(0, 5).map((label, index) => (
              <label key={label}>{label}
                <AppSelect aria-label={`Usual place on ${label}`} className="form-select" value={pattern[String(index)] || ''} onChange={event => setPattern(current => { const next = { ...current }; if (event.target.value) next[String(index)] = event.target.value; else delete next[String(index)]; return next })}>
                  <option value="">Not set</option>
                  {Object.entries(PLACES).map(([value, [placeLabel]]) => <option key={value} value={value}>{placeLabel}</option>)}
                </AppSelect>
              </label>
            ))}
          </div>
          <div className="memo-actions"><Button type="button" onClick={savePattern} disabled={!me}>Save my usual week</Button></div>
        </section>
        {data?.can_set_policy && (
          <section aria-label="Office days" className="request-form">
            <h2>Office days (optional)</h2>
            <p className="memo-card-meta">If your team has days everyone should be in, choose them. People on a different location those days are highlighted. It never blocks anyone.</p>
            <div className="where-pattern">
              {WEEKDAYS.map((label, index) => (
                <label key={label} className="leave-check"><input type="checkbox" checked={officeDays.includes(index)} onChange={event => setOfficeDays(current => (event.target.checked ? [...current, index].sort() : current.filter(item => item !== index)))} /> {label}</label>
              ))}
            </div>
            <div className="memo-actions"><Button type="button" onClick={savePolicy}>Save office days</Button></div>
          </section>
        )}
      </div>
    </section>
  )
}
