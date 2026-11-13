import React from 'react'
import { CalendarDays } from 'lucide-react'
import { AppSelect } from './ui/select.jsx'
import { DATE_PRESETS, rangeFor } from '../lib/date-ranges.js'

// Show only the tasks due on a day, in a week or month, overdue, or between two
// dates the person picks. Used on every kanban board, so they all filter the same way.
export default function BoardDateFilter({ today, preset, from, to, onChange, className = '' }) {
  const choose = next => {
    if (next === 'custom') return onChange({ preset: 'custom', from, to, due: 'all' })
    onChange({ preset: next, ...rangeFor(next, today) })
  }
  return (
    <div className={`board-date-filter ${className}`.trim()} role="group" aria-label="Filter by due date">
      <AppSelect className="chip-select board-date-select" value={preset} aria-label="Due date" onChange={event => choose(event.target.value)}>
        {DATE_PRESETS.map(([value, label]) => <option key={value} value={value}>{value === 'any' ? 'Due: any date' : label}</option>)}
      </AppSelect>
      {preset === 'custom' && (
        <span className="board-date-range">
          <CalendarDays size={15} aria-hidden="true" />
          <input type="date" aria-label="Due from" value={from} max={to || undefined} onChange={event => onChange({ preset: 'custom', from: event.target.value, to, due: 'all' })} />
          <span aria-hidden="true">to</span>
          <input type="date" aria-label="Due to" value={to} min={from || undefined} onChange={event => onChange({ preset: 'custom', from, to: event.target.value, due: 'all' })} />
        </span>
      )}
    </div>
  )
}
