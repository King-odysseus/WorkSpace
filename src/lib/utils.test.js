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
  it('gives the page size the control radius rather than the pill', () => {
    const page = buttonVariants({ size: 'page' })
    expect(page).toContain('rounded-control')
    expect(page).not.toContain('rounded-full')
    expect(page).toContain('h-[42px]')
  })

  it('leaves the other sizes as pills', () => {
    for (const size of ['default', 'sm', 'lg', 'icon', 'icon-sm']) {
      expect(buttonVariants({ size }), size).toContain('rounded-full')
    }
  })
})
