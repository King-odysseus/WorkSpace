import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

// Hover and focus tooltip from the C5 gap list. Deliberately not built on a
// positioning library: the app has none, and every tooltip here hangs off a
// small, fixed-position trigger (icon buttons in the rail and the topbar). The
// bubble is portalled to the body so it can escape scroll containers such as
// the collapsed sidebar nav, then positioned from the trigger rect.
//
// Keyboard access matches hover: the bubble opens on focus and is wired to the
// trigger through aria-describedby, so a screen reader announces it.

const tooltipSurface =
  'pointer-events-none fixed z-[95] w-max max-w-[min(260px,calc(100vw-24px))] rounded-icon bg-foreground px-3.5 py-[11px] text-xs leading-4 font-normal text-background opacity-0 shadow-[0_8px_20px_rgb(2_5_31_/22%)] transition-opacity duration-150 data-[state=visible]:opacity-100'

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const runHandler = (handler, event) => {
  if (typeof handler === 'function') handler(event)
}

function Tooltip({ content, side = 'top', className, children }) {
  const id = React.useId()
  const triggerRef = React.useRef(null)
  const bubbleRef = React.useRef(null)
  const [open, setOpen] = React.useState(false)
  const [position, setPosition] = React.useState(null)
  const childRef = React.isValidElement(children) ? children.props.ref : null

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current
    const bubble = bubbleRef.current
    if (!trigger || !bubble) return

    const triggerRect = trigger.getBoundingClientRect()
    const bubbleRect = bubble.getBoundingClientRect()
    const gap = 8
    const viewportPadding = 8
    let top = triggerRect.top + (triggerRect.height - bubbleRect.height) / 2
    let left = triggerRect.left + (triggerRect.width - bubbleRect.width) / 2

    if (side === 'right') {
      left = triggerRect.right + gap
    } else if (side === 'left') {
      left = triggerRect.left - bubbleRect.width - gap
    } else if (side === 'bottom') {
      top = triggerRect.bottom + gap
    } else {
      top = triggerRect.top - bubbleRect.height - gap
    }

    setPosition({
      left: `${Math.round(clamp(left, viewportPadding, window.innerWidth - bubbleRect.width - viewportPadding))}px`,
      top: `${Math.round(clamp(top, viewportPadding, window.innerHeight - bubbleRect.height - viewportPadding))}px`,
    })
  }, [side])

  React.useLayoutEffect(() => {
    if (!open) return undefined
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [content, open, updatePosition])

  if (!content) return children

  // Described-by has to land on the trigger itself, not on a wrapper, or it
  // never reaches the accessibility tree: a plain span is not focusable.
  const trigger = React.isValidElement(children)
    ? React.cloneElement(children, {
        ref: (node) => {
          triggerRef.current = node
          if (typeof childRef === 'function') childRef(node)
          else if (childRef) childRef.current = node
        },
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
        onBlur: (event) => {
          runHandler(children.props.onBlur, event)
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        },
        onFocus: (event) => {
          runHandler(children.props.onFocus, event)
          setOpen(true)
        },
        onMouseEnter: (event) => {
          runHandler(children.props.onMouseEnter, event)
          setOpen(true)
        },
        onMouseLeave: (event) => {
          runHandler(children.props.onMouseLeave, event)
          setOpen(false)
        },
      })
    : children

  const bubble = (
    <span
      ref={bubbleRef}
      role="tooltip"
      id={id}
      data-slot="tooltip"
      data-side={side}
      data-state={open ? 'visible' : 'hidden'}
      style={position || { left: 0, top: 0 }}
      className={cn(tooltipSurface, className)}
    >
      {content}
    </span>
  )

  return (
    <>
      {trigger}
      {typeof document === 'undefined' ? bubble : createPortal(bubble, document.body)}
    </>
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
