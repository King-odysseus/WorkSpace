import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Finished work leaves the active list instead of sitting in it struck through.
// One band at the end of a list keeps completed items reachable without letting
// them compete with open work, and it starts closed because the section exists
// to get out of the way.
//
// The whole heading is the control: a button carrying aria-expanded and
// aria-controls, so assistive tech hears a disclosure it can open rather than a
// heading that happens to respond to a click. The count is not a bare number
// beside a label - "Done 12" reads poorly on its own - so the digits keep their
// visual treatment while the button's own label spells the tally out.

function CollapsibleSection({
  title,
  count,
  hint,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  contentClassName,
  children,
  ...props
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = open !== undefined
  const expanded = isControlled ? open : uncontrolledOpen
  const contentId = React.useId()
  const tally = typeof count === 'number' ? count : null
  const tallyLabel = tally === null ? '' : ` (${tally} ${tally === 1 ? 'item' : 'items'})`

  const toggle = () => {
    const next = !expanded
    if (!isControlled) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }

  return (
    <section
      data-slot="collapsible-section"
      data-state={expanded ? 'open' : 'closed'}
      className={cn('group grid gap-3', className)}
      {...props}
    >
      <button
        type="button"
        data-slot="collapsible-section-trigger"
        className="flex w-full items-center gap-2.5 rounded-card border border-border-light bg-card px-5 py-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-focus"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={`${expanded ? 'Hide' : 'Show'} ${title}${tallyLabel}`}
        onClick={toggle}
      >
        <ChevronDown
          data-slot="collapsible-section-chevron"
          className="shrink-0 text-text-muted transition-transform duration-150 group-data-[state=open]:rotate-180"
          size={16}
          aria-hidden="true"
        />
        <h2 className="text-subheading text-text-primary">{title}</h2>
        {tally !== null && (
          <span
            className="rounded-badge bg-status-done-bg px-2 py-0.5 text-caption font-semibold text-status-done"
            aria-hidden="true"
          >
            {tally}
          </span>
        )}
        {hint && <span className="ml-auto text-caption text-text-muted">{hint}</span>}
      </button>
      {expanded && (
        <div id={contentId} data-slot="collapsible-section-content" className={contentClassName}>
          {children}
        </div>
      )}
    </section>
  )
}

export { CollapsibleSection }
