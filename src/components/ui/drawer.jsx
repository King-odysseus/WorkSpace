import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Side sheet from the C5 gap list. Built on the Dialog primitive the app
// already depends on rather than a second overlay library, so focus trapping,
// escape handling and the scrim behave exactly like every other modal here.
//
// The shell splits into three bands the design draws explicitly: a 76px header
// with its own rule, a scrolling body, and a footer rule above the actions.
// Body padding splits so the two rules stay flush to the edges.

const Drawer = DialogPrimitive.Root
const DrawerTrigger = DialogPrimitive.Trigger
const DrawerClose = DialogPrimitive.Close
const DrawerPortal = DialogPrimitive.Portal

const drawerSide = cva(
  'bg-card text-card-foreground fixed z-50 flex flex-col shadow-[0_20px_70px_rgb(7_26_45_/31%)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 w-[min(420px,100vw)] border-l border-border data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        left:
          'inset-y-0 left-0 w-[min(420px,100vw)] border-r border-border data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        bottom:
          'inset-x-0 bottom-0 max-h-[min(85dvh,720px)] rounded-t-container border-t border-border data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  }
)

function DrawerContent({ className, overlayClassName, side = 'right', showCloseButton = true, children, ...props }) {
  return (
    <DrawerPortal>
      <DialogPrimitive.Overlay
        data-slot="drawer-overlay"
        className={cn(
          'fixed inset-0 z-50 bg-[#08182a9c] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          overlayClassName
        )}
      />
      <DialogPrimitive.Content
        data-slot="drawer-content"
        data-side={side}
        aria-describedby={props['aria-describedby'] ?? undefined}
        className={cn(drawerSide({ side }), className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="drawer-close"
            className="absolute top-6 right-5 grid size-7 place-items-center rounded-icon text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-info/35"
          >
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DrawerPortal>
  )
}

// Renders its own 76px band and rule, so a DrawerBody directly after it starts
// flush against the rule rather than against the header's padding.
function DrawerHeader({ className, ...props }) {
  return (
    <div
      data-slot="drawer-header"
      className={cn('flex h-[76px] shrink-0 items-center border-b border-border px-6 pr-14', className)}
      {...props}
    />
  )
}

function DrawerTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn('text-lg font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function DrawerDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function DrawerBody({ className, ...props }) {
  return (
    <div
      data-slot="drawer-body"
      className={cn('grid min-h-0 flex-1 auto-rows-min content-start gap-5 overflow-y-auto px-6 pt-7 pb-6', className)}
      {...props}
    />
  )
}

// One labelled control in the body. The label is 12/500 muted and sits 4px
// above its control, matching the design's field rhythm.
function DrawerField({ label, hint, className, children, ...props }) {
  return (
    <div data-slot="drawer-field" className={cn('grid gap-1', className)} {...props}>
      {label && <span className="text-xs leading-none font-medium text-muted-foreground">{label}</span>}
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

function DrawerFooter({ className, ...props }) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn('flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-5', className)}
      {...props}
    />
  )
}

// Destructive actions are quarantined below the footer rule on their own, so a
// destructive control is never adjacent to the primary one.
function DrawerDangerZone({ className, ...props }) {
  return (
    <div
      data-slot="drawer-danger-zone"
      className={cn('flex shrink-0 items-center gap-2 border-t border-border px-6 py-4', className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDangerZone,
  DrawerDescription,
  DrawerField,
  DrawerFooter,
  DrawerHeader,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
}
