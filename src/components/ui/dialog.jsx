import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

function Dialog(props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-[#08182a9c] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

function readDockViewport() {
  if (typeof window === 'undefined' || !window.visualViewport) return undefined
  const viewport = window.visualViewport
  return {
    left: viewport.offsetLeft,
    top: viewport.offsetTop,
    width: viewport.width,
    height: viewport.height,
    right: 'auto',
    bottom: 'auto',
  }
}

function useDockViewport(enabled) {
  const [style, setStyle] = React.useState(() => enabled ? readDockViewport() : undefined)

  React.useEffect(() => {
    if (!enabled) return undefined
    const update = () => setStyle(readDockViewport())
    update()
    const viewport = window.visualViewport
    window.addEventListener('resize', update)
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('resize', update)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
    }
  }, [enabled])

  return enabled ? style : undefined
}

function DialogContent({ className, overlayClassName, children, showCloseButton = true, position = 'center', ...props }) {
  const docked = position === 'dock'
  const dockViewportStyle = useDockViewport(docked)
  const content = (
    <DialogPrimitive.Content
      data-slot="dialog-content"
      className={cn(
        'bg-card z-50 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        docked
          ? 'pointer-events-auto absolute right-0 bottom-0'
          : 'fixed top-1/2 left-1/2 grid w-[min(440px,calc(100vw-30px))] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border border-border p-6 shadow-[0_20px_70px_rgb(7_26_45_/31%)]',
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className="absolute top-4 right-4 grid size-8 place-items-center rounded-full bg-secondary text-secondary-foreground opacity-90 transition-opacity hover:bg-muted hover:opacity-100 focus:outline-none">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  )

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      {docked ? (
        <div data-slot="dialog-dock-layer" className="dialog-dock-layer" style={dockViewportStyle}>
          {content}
        </div>
      ) : content}
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5', className)} {...props} />
}

function DialogFooter({ className, ...props }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-xl font-extrabold text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-xs', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
