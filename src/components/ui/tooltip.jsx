import * as React from 'react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Hover and focus tooltip from the C5 gap list. Deliberately not built on a
// positioning library: the app has none, and every tooltip here hangs off a
// small, fixed-position trigger (icon buttons in the rail and the topbar), so
// an absolutely positioned bubble inside a relative wrapper covers the real
// cases without a new dependency.
//
// The trade-off is that a tooltip cannot escape an ancestor with
// `overflow: hidden`. For those triggers, use a Popover instead.
//
// Keyboard access matches hover: the bubble opens on focus and is wired to the
// trigger through aria-describedby, so a screen reader announces it.

const tooltipSurface =
  'pointer-events-none absolute z-[95] w-max max-w-[min(260px,calc(100vw-24px))] rounded-icon bg-foreground px-3.5 py-[11px] text-xs leading-4 font-normal text-background opacity-0 shadow-[0_8px_20px_rgb(2_5_31_/22%)] transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100'

const tooltipSide = cva('', {
  variants: {
    side: {
      top: 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2',
      bottom: 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2',
      left: 'top-1/2 right-[calc(100%+8px)] -translate-y-1/2',
      right: 'top-1/2 left-[calc(100%+8px)] -translate-y-1/2',
    },
  },
  defaultVariants: { side: 'top' },
})

function Tooltip({ content, side = 'top', className, children }) {
  const id = React.useId()
  if (!content) return children

  // Described-by has to land on the trigger itself, not on a wrapper, or it
  // never reaches the accessibility tree: a plain span is not focusable.
  const trigger = React.isValidElement(children)
    ? React.cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })
    : children

  return (
    <span className="group/tooltip relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        id={id}
        data-slot="tooltip"
        data-side={side}
        className={cn(tooltipSurface, tooltipSide({ side }), className)}
      >
        {content}
      </span>
    </span>
  )
}

// 40px icon control the design pairs with a tooltip: soft fill, 12px radius.
function TooltipTrigger({ className, label, children, ...props }) {
  return (
    <button
      type="button"
      data-slot="tooltip-trigger"
      aria-label={label}
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-control bg-secondary text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-info/35',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export { Tooltip, TooltipTrigger }
