import * as React from 'react'
import { Button as FlowbiteButton } from 'flowbite-react'
import { cn } from '@/lib/utils'

/**
 * The app's Button, rendering Flowbite React's Button.
 *
 * The public API is unchanged - the same `variant` and `size` names the 78
 * call sites already pass - so this file is the only one that had to change
 * when the primitive moved onto Flowbite. `variant` and `size` map onto
 * Flowbite's `color` and `size`, and everything else passes through.
 *
 * The design's control is 42x42 with a 12px radius and a 14px/500 label, so
 * `default` and `page` both resolve to Flowbite's `md`, which
 * src/lib/flowbite-theme.js restates to that geometry. `page` differs only in
 * the icon size it carries, which is why it still has its own entry.
 */
const VARIANT_TO_COLOR = {
  default: 'primary',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  destructive: 'danger',
  /* The brand bronze, kept from the app rather than the design's #B7791F. */
  gold: 'gold',
  link: 'link',
}

const SIZE_TO_FLOWBITE = {
  default: 'md',
  sm: 'sm',
  lg: 'lg',
  page: 'md',
  icon: 'icon',
  'icon-sm': 'icon-sm',
}

/**
 * Returns the class string for a variant/size pair.
 *
 * Kept because ui/calendar.jsx styles its day cells with it. This is the one
 * place the app still composes button classes by hand rather than rendering a
 * Button; if the calendar is ever rebuilt on Flowbite's own controls, this can
 * go with it.
 */
function buttonVariants({ variant = 'default', size = 'default', className } = {}) {
  const geometry = {
    default: 'h-[42px] px-5 text-label',
    sm: 'h-9 px-3.5 text-body-small',
    lg: 'h-12 px-6 text-subheading',
    page: 'h-[42px] px-5 text-label gap-2.5 [&_svg]:size-5',
    icon: 'size-[42px] p-0',
    'icon-sm': 'size-9 p-0',
  }[size]

  const skin = {
    default: 'border border-navy bg-navy text-text-on-navy',
    secondary: 'bg-surface-hover text-text-primary',
    outline: 'border border-border bg-transparent text-text-primary',
    ghost: 'bg-transparent text-text-primary',
    destructive: 'bg-danger text-white',
    gold: 'bg-bronze text-navy',
    link: 'bg-transparent text-info underline-offset-4',
  }[variant]

  return cn(
    'relative inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap',
    geometry,
    skin,
    className,
  )
}

// A `loading` prop swaps the label region for a spinner and disables the
// control, so callers do not have to juggle disabled and spinner markup at
// every call site. Flowbite has its own processing state; this keeps the
// app's shape so the call site that uses it did not have to change.
function Button({
  className,
  variant = 'default',
  size = 'default',
  loading = false,
  disabled,
  children,
  ...props
}) {
  const iconSized = size === 'icon' || size === 'icon-sm'

  return (
    <FlowbiteButton
      data-slot="button"
      color={VARIANT_TO_COLOR[variant] ?? 'primary'}
      size={SIZE_TO_FLOWBITE[size] ?? 'md'}
      className={cn(iconSized && 'p-0', className)}
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
    </FlowbiteButton>
  )
}

export { Button, buttonVariants }
