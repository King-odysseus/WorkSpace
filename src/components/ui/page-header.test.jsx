import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageHeader } from './page-header.jsx'

const slot = name => document.querySelector(`[data-slot="${name}"]`)

describe('PageHeader', () => {
  it('renders the eyebrow, title and support line together', () => {
    render(
      <PageHeader
        eyebrow="Friday - 3 October"
        title="Today"
        description="Here is what needs your attention."
      />
    )

    expect(screen.getByText('Friday - 3 October')).toBe(slot('page-header-eyebrow'))
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBe(slot('page-header-title'))
    expect(screen.getByText('Here is what needs your attention.')).toBe(slot('page-header-description'))
  })

  it('omits the optional slots rather than rendering them empty', () => {
    render(<PageHeader title="Planner" />)

    expect(slot('page-header-eyebrow')).toBeNull()
    expect(slot('page-header-description')).toBeNull()
    expect(slot('page-header-actions')).toBeNull()
  })

  it('keeps the divider unless a caller opts out', () => {
    const { rerender } = render(<PageHeader title="Today" />)
    expect(slot('page-header-divider')).not.toBeNull()

    rerender(<PageHeader title="Today" divider={false} />)
    expect(slot('page-header-divider')).toBeNull()
  })

  it('treats actions and children as the same slot', () => {
    render(
      <PageHeader title="Today" actions={<button type="button">Add task</button>}>
        <button type="button">Add event</button>
      </PageHeader>
    )

    expect(slot('page-header-actions')).toContainElement(screen.getByRole('button', { name: 'Add task' }))
    expect(slot('page-header-actions')).toContainElement(screen.getByRole('button', { name: 'Add event' }))
  })
})
