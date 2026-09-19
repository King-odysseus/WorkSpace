import { describe, expect, it } from 'vitest'
import { cn } from './utils.js'
import { buttonVariants } from '../components/ui/button.jsx'

// These cover the two merge rules the design system depends on. Both failures
// they guard against are silent: the class simply never reaches the element, so
// nothing errors and the only symptom is type or a corner that looks wrong.
describe('cn', () => {
  it('keeps a type-scale class alongside a text colour', () => {
    expect(cn('text-overline text-primary')).toBe('text-overline text-primary')
    expect(cn('text-page-heading text-foreground')).toBe('text-page-heading text-foreground')
    expect(cn('text-body-small text-muted-foreground')).toBe('text-body-small text-muted-foreground')
    expect(cn('text-metric text-foreground')).toBe('text-metric text-foreground')
  })

  it('still treats two type-scale classes as a conflict', () => {
    expect(cn('text-overline', 'text-page-heading')).toBe('text-page-heading')
  })

  it('still treats two colours as a conflict', () => {
    expect(cn('text-primary', 'text-foreground')).toBe('text-foreground')
  })
})

describe('buttonVariants', () => {
  // The design gives every control the 12px control radius. Buttons used to be
  // pills, so a stray `rounded-full` surviving anywhere is the regression this
  // guards - it is silent, and the only symptom is a corner that looks wrong.
  it('gives every size the control radius rather than the pill', () => {
    for (const size of ['default', 'sm', 'lg', 'page', 'icon', 'icon-sm']) {
      const classes = buttonVariants({ size })
      expect(classes, size).toContain('rounded-control')
      expect(classes, size).not.toContain('rounded-full')
    }
  })

  it('gives the two full-size controls the design height', () => {
    for (const size of ['default', 'page']) {
      expect(buttonVariants({ size }), size).toContain('h-[42px]')
    }
  })

  it('squares the icon sizes', () => {
    expect(buttonVariants({ size: 'icon' })).toContain('size-[42px]')
    expect(buttonVariants({ size: 'icon-sm' })).toContain('size-9')
  })
})
