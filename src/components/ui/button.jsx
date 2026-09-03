import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-xs font-bold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-accent/40 focus-visible:border-accent",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border border-accent shadow-[0_8px_18px_rgb(7_26_46_/16%)] hover:bg-secondary hover:-translate-y-px',
        gold:
          'bg-accent text-navy shadow-[0_4px_12px_-4px_rgb(196_154_108_/50%)] hover:bg-accent-hover hover:-translate-y-px',
        secondary:
          'bg-secondary text-secondary-foreground border border-border hover:-translate-y-px',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-muted hover:-translate-y-px',
        ghost: 'text-foreground hover:bg-muted',
        destructive:
          'bg-destructive text-destructive-foreground hover:opacity-90',
        link: 'text-blue-600 underline-offset-4 hover:underline rounded-none',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3.5',
        sm: 'h-8 px-3 text-[11px] has-[>svg]:px-2.5',
        lg: 'h-11 px-6 has-[>svg]:px-5',
        icon: 'size-9 rounded-full',
        'icon-sm': 'size-8 rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

// Mirrors TijhaBooks' Button: a `loading` prop swaps the label region for a
// spinner and disables the control, so callers don't juggle disabled+spinner
// markup at every call site (see tijhabooks/frontend button.tsx).
function Button({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </Comp>
  )
}

export { Button, buttonVariants }
