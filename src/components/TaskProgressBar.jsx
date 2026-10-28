import React from 'react'
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

// A task that has not been started still draws its empty track, so a column of
// cards reads the same top to bottom instead of bars appearing as work begins.
export function TaskProgressBar({ value = 0, label = 'Progress', className }) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
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
        <div className="h-full rounded-chip bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">{percent}%</span>
    </div>
  )
}
