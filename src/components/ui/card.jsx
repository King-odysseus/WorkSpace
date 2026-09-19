import * as React from 'react'
import { cn } from '@/lib/utils'

// Surface from the C5 gap list. The design's card is flat: a 12px radius, a 1px
// border, and the near-invisible level-1 shadow, with rules separating header,
// body and footer. Earlier this was an 18px radius with a hand-tuned navy
// shadow, which is what the migration replaces.
//
// The rules belong to the header and footer bands rather than to the body, so a
// card that omits either band does not get a stray line.
//
// Call sites throughout src/ still carry a semantic class (.settings-panel,
// .project-register-card, ...) whose rules sit outside Tailwind's layers and
// therefore outrank these utilities. Those panels keep their old box until the
// page-by-page pass reaches them; this file is the spec they move onto.

function Card({ className, ...props }) {
  return (
    <div
      data-slot="card"
      className={cn('bg-card text-card-foreground flex flex-col rounded-control border border-border shadow-card', className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }) {
  return (
    <div
      data-slot="card-header"
      className={cn('flex items-start justify-between gap-3 border-b border-border-light px-6 pt-6 pb-4', className)}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }) {
  return (
    <h3
      data-slot="card-title"
      className={cn('text-xl font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }) {
  return (
    <p
      data-slot="card-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }) {
  return (
    <div data-slot="card-action" className={cn('ml-auto shrink-0', className)} {...props} />
  )
}

function CardContent({ className, ...props }) {
  return (
    <div data-slot="card-content" className={cn('grid gap-6 px-6 py-5', className)} {...props} />
  )
}

// Track plus caption, matching the design's card body: 4px rounded track, navy
// fill, caption 12px muted underneath.
//
// The track colour is a placeholder for the semantic surface ramp: the design
// draws it as #DBEAFE, while --semantic-info-bg currently resolves to the navy
// tint. Reconciling that ramp is the C1 feedback pass.
function CardProgress({ value = 0, label, className, ...props }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div data-slot="card-progress" className={cn('grid gap-3.5', className)} {...props}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
        className="h-1 overflow-hidden rounded-chip bg-info-soft"
      >
        <div
          data-slot="card-progress-fill"
          className="h-full rounded-chip bg-primary transition-[width] duration-300"
          style={{ width: `${clamped}%` }}
        />
      </div>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  )
}

// Footer meta sits left, action right: the design's footer is a space-between
// band, not a right-aligned button row.
function CardFooter({ className, ...props }) {
  return (
    <div
      data-slot="card-footer"
      className={cn('mt-auto flex items-center justify-between gap-3 border-t border-border-light px-6 py-5', className)}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent, CardProgress }
