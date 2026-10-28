import React, { createContext } from 'react'
import { cn } from '@/lib/utils'

// Progress is entered in tens, so the control offers 0, 10 ... 100. A value saved
// before that (an import, an AI action) can sit between steps; it is kept as an
// extra option rather than silently rounded, so opening a task and saving it
// never rewrites a percentage the person did not touch.
export const PROGRESS_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

export function progressOptions(current) {
  const value = Number(current)
  return Number.isFinite(value) && !PROGRESS_STEPS.includes(value) ? [...PROGRESS_STEPS, value].sort((a, b) => a - b) : PROGRESS_STEPS
}

// A finished task reads 100 whatever number it was last saved with.
export function taskProgressValue(task) {
  if (task.is_done || task.status === 'done') return 100
  return Math.max(0, Math.min(100, Number(task.progress_percent) || 0))
}

// The colour says how far along the work is, so a column can be read at a glance:
// red just started, amber midway, blue nearly there, green finished. The number
// stays on screen beside it, so the colour is never the only signal.
export function progressTone(percent) {
  if (percent >= 100) return { fill: 'bg-success', text: 'text-success' }
  if (percent >= 70) return { fill: 'bg-info', text: 'text-info' }
  if (percent >= 40) return { fill: 'bg-warning-fill', text: 'text-warning' }
  if (percent > 0) return { fill: 'bg-danger', text: 'text-danger' }
  return { fill: 'bg-primary', text: 'text-muted-foreground' }
}

// Supplied once by the app: (task, percent) => Promise. Cards read it instead of
// taking it as a prop, so the boards need no extra wiring and a card rendered
// without a provider (a test, a read-only view) just shows the number.
export const TaskProgressActions = createContext(null)

// A task that has not been started still draws its empty track, so a column of
// cards reads the same top to bottom instead of bars appearing as work begins.
// With onChange the percent becomes a dropdown, so progress can be set on the
// card itself.
export function TaskProgressBar({ value = 0, title, className, onChange }) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
  const tone = progressTone(percent)
  const label = title ? `Progress for ${title}` : 'Progress'
  // The card around this is draggable and clickable; a press on the dropdown is
  // neither a drag nor a card click.
  const keepToSelf = event => event.stopPropagation()
  return (
    <div className={cn('task-progress flex items-center gap-2', className)} data-slot="task-progress">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-chip bg-info-soft"
      >
        <div className={cn('h-full rounded-chip transition-[width,background-color] duration-300', tone.fill)} style={{ width: `${percent}%` }} />
      </div>
      {onChange
        ? <select
            aria-label={title ? `Percent complete for ${title}` : 'Percent complete'}
            value={percent}
            onChange={event => onChange(Number(event.target.value))}
            onClick={keepToSelf}
            onMouseDown={keepToSelf}
            onPointerDown={keepToSelf}
            onKeyDown={keepToSelf}
            draggable={false}
            className={cn('task-progress-select shrink-0 cursor-pointer rounded-chip border border-border bg-card px-1 py-0.5 text-xs font-semibold tabular-nums outline-none focus-visible:border-info focus-visible:ring-[3px] focus-visible:ring-info/20', tone.text)}
          >
            {progressOptions(percent).map(step => <option value={step} key={step}>{step}%</option>)}
          </select>
        : <span className={cn('shrink-0 text-xs font-semibold tabular-nums', tone.text)} aria-hidden="true">{percent}%</span>}
    </div>
  )
}
