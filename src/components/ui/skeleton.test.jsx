import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Skeleton, SkeletonGroup } from './skeleton.jsx'

describe('Skeleton', () => {
  it('renders a decorative shape without entering the accessibility tree', () => {
    const { container } = render(<Skeleton variant="card" />)
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute('data-variant', 'card')
    expect(container.querySelector('[data-slot="skeleton"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('announces a loading group through one status label', () => {
    render(
      <SkeletonGroup label="Loading files">
        <Skeleton />
      </SkeletonGroup>,
    )
    expect(screen.getByRole('status', { name: 'Loading files' })).toBeInTheDocument()
  })
})
