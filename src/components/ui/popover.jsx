import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

// Menu surface from the C5 gap list: 12px outer radius, 4px inset, 36px items
// at 6px radius, and destructive actions last below a rule.
//
// The inset dropped from 12px to 4px to match the design. Both existing
// consumers (the date pickers and the assignee picker) already set their own
// padding, so neither moves.

function Popover(props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({ className, align = 'center', sideOffset = 8, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground z-50 w-auto rounded-control border border-border p-1 shadow-[0_18px_40px_rgb(2_5_31_/20%)] outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

// One 36px row. Icon at 12px, label at 40px, both in the secondary text colour,
// so a row reads the same whether or not it has an icon.
function PopoverItem({ className, icon: Icon, destructive = false, children, ...props }) {
  return (
    <button
      type="button"
      data-slot="popover-item"
      data-destructive={destructive || undefined}
      className={cn(
        'flex h-9 w-full items-center gap-2.5 rounded-badge px-3 text-sm outline-none transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10'
          : 'text-secondary-foreground hover:bg-muted focus-visible:bg-muted',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="size-4 shrink-0" strokeWidth={1.7} />}
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
    </button>
  )
}

// Inset to 12px so it stops short of the surface edge, as drawn.
function PopoverSeparator({ className, ...props }) {
  return (
    <div
      data-slot="popover-separator"
      role="separator"
      className={cn('mx-3 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

export { Popover, PopoverTrigger, PopoverContent, PopoverItem, PopoverSeparator }
