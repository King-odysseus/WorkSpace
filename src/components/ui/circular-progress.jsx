import * as React from 'react'
import { cn } from '@/lib/utils'

// Circular progress from the C5 gap list: a 140px ring with a 12px stroke and
// round caps, the value and its caption stacked in the middle.
//
// Drawn as two SVG circles rather than a conic-gradient so the caps stay round
// and the arc starts at twelve o'clock, going clockwise like the design. The
// dash maths is on the ring's own circumference, so any size keeps the same
// proportions as long as `stroke` scales with it.
//
// The arc is the brand navy via currentColor, so a caller can recolour it with
// a text-* class without touching this file.
function CircularProgress({
  value = 0,
  size = 140,
  stroke = 12,
  caption,
  showValue = true,
  label,
  className,
  ...props
}) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const dash = (clamped / 100) * circumference

  return (
    <div
      data-slot="circular-progress"
      data-value={clamped}
      className={cn('relative inline-grid place-items-center text-primary', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={label || `${clamped}%${caption ? ` ${caption}` : ''}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          className="stroke-current transition-[stroke-dasharray] duration-300"
        />
      </svg>
      {(showValue || caption) && (
        <div className="absolute inset-0 grid place-content-center gap-0.5 text-center" aria-hidden="true">
          {showValue && (
            <span className="text-metric leading-none font-bold tracking-[-0.6px] text-foreground">
              {Math.round(clamped)}%
            </span>
          )}
          {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
        </div>
      )}
    </div>
  )
}

export { CircularProgress }
