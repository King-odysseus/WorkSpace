import * as React from 'react'
import { cn } from '@/lib/utils'
import { formatSentenceBreaks } from '@/lib/sentence-format.js'

// The block that opens every view: an uppercase overline eyebrow, the page
// title, a one-line support sentence, and the page's primary action, closed by
// a hairline rule above the body.
//
// The three text slots map one-to-one onto type tokens this app already
// declares but nothing consumed - --text-overline, --text-page-heading and
// --text-body-small - so the header follows the scale rather than restating its
// numbers. Montserrat is the display family and Roboto the body family per the
// settled typography decision; the design file's Inter is a stand-in for them.
//
// The two vertical gaps are the design's own, not steps on the 4px spacing
// scale: 4px under the eyebrow and 6px above the support line. They are literal
// values for that reason.
//
// The eyebrow is text-primary rather than a fixed navy so it tracks the brand
// token in both themes, where a literal #001666 would go unreadable on dark.

function PageHeaderEyebrow({ className, ...props }) {
  return (
    <p
      data-slot="page-header-eyebrow"
      className={cn('mb-1 font-display text-overline uppercase text-primary', className)}
      {...props}
    />
  )
}

function PageHeaderTitle({ className, ...props }) {
  return (
    <h1
      data-slot="page-header-title"
      className={cn('font-display text-page-heading text-foreground', className)}
      {...props}
    />
  )
}

function PageHeaderDescription({ className, children, ...props }) {
  return (
    <p
      data-slot="page-header-description"
      className={cn('sentence-breaks mt-1.5 max-w-[70ch] text-body-small text-muted-foreground', className)}
      {...props}
    >
      {formatSentenceBreaks(children)}
    </p>
  )
}

function PageHeaderActions({ className, ...props }) {
  return (
    <div
      data-slot="page-header-actions"
      className={cn('flex shrink-0 flex-wrap items-center gap-2', className)}
      {...props}
    />
  )
}

// `actions` and `children` are the same slot; `children` is there so a view can
// pass several controls as JSX without wrapping them in a fragment.
//
// The row only goes side-by-side once there is width for it, so on a narrow
// screen the action drops under the text instead of squeezing the title.
function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  divider = true,
  className,
  children,
  ...props
}) {
  const hasActions = Boolean(actions) || Boolean(children)

  return (
    <header data-slot="page-header" className={cn('grid gap-5', className)} {...props}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <PageHeaderEyebrow>{eyebrow}</PageHeaderEyebrow>}
          <PageHeaderTitle>{title}</PageHeaderTitle>
          {description && <PageHeaderDescription>{description}</PageHeaderDescription>}
        </div>
        {hasActions && (
          <PageHeaderActions className="sm:pb-px">
            {actions}
            {children}
          </PageHeaderActions>
        )}
      </div>
      {divider && <div data-slot="page-header-divider" className="h-px bg-border" />}
    </header>
  )
}

export {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
}
