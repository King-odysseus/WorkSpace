import React from 'react'
import { Check, Repeat } from 'lucide-react'
import { Button } from './ui/button.jsx'

// Daily operations: the recurring work that keeps coming back. A routine is any
// open task with a repeat rule that does not belong to a project. Finishing one
// uses the ordinary status change, and the server then creates its next
// occurrence, so "Mark done" here is exactly the checkbox on the board.
//
// There is no streak or history here on purpose: the board has no record to
// build one from, and a number that is not backed by data would mislead.

const CADENCE = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

export function routinesFrom(tasks) {
  return tasks
    .filter(task => task.recurrence && task.recurrence !== 'none' && !task.project_id && task.status !== 'done' && task.status !== 'cancelled' && task.state !== 'archived')
    .sort((left, right) => String(left.due_date || '9999').localeCompare(String(right.due_date || '9999')) || left.id - right.id)
}

export function routinesDoneThisWeek(tasks, today) {
  const weekAgo = new Date(`${today}T12:00:00`)
  weekAgo.setDate(weekAgo.getDate() - 6)
  return tasks.filter(task => task.recurrence && task.recurrence !== 'none' && !task.project_id && task.status === 'done' && task.completed_at && new Date(task.completed_at) >= weekAgo).length
}

export default function RoutinesPanel({ tasks, today, onOpenTask, onStatusChange }) {
  const routines = routinesFrom(tasks)
  const doneThisWeek = routinesDoneThisWeek(tasks, today)
  if (!routines.length && !doneThisWeek) return null

  return (
    <section data-panel="routines" className="routines-panel" aria-label="Routines">
      <div className="routines-heading">
        <h2><Repeat size={16} aria-hidden="true" /> Routines</h2>
        <span>{routines.length} due to run{doneThisWeek ? ` - ${doneThisWeek} done this week` : ''}</span>
      </div>
      {routines.length ? (
        <ul className="routines-list">
          {routines.slice(0, 6).map(task => {
            const overdue = task.due_date && task.due_date < today
            return (
              <li key={task.id} className="routines-row">
                <button type="button" className="routines-title" onClick={() => onOpenTask?.(task)}>{task.title}</button>
                <span className="routines-cadence">{CADENCE[task.recurrence] || task.recurrence}</span>
                <span className={`routines-due${overdue ? ' is-overdue' : ''}`}>{task.due_date ? (task.due_date === today ? 'Due today' : overdue ? `Was due ${task.due_date}` : `Next ${task.due_date}`) : 'No date'}</span>
                {onStatusChange && <Button type="button" size="sm" variant="secondary" aria-label={`Mark ${task.title} done`} onClick={() => onStatusChange(task.id, 'done')}><Check size={14} aria-hidden="true" /> Mark done</Button>}
              </li>
            )
          })}
        </ul>
      ) : <p className="routines-empty">Every routine has run. The next ones appear when the current ones are finished.</p>}
    </section>
  )
}
