import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import BrandedStatusScreen from './BrandedStatusScreen.jsx'

describe('BrandedStatusScreen', () => {
  it('renders a logo-only loading status', () => {
    const { container } = render(<BrandedStatusScreen loading />)
    const status = screen.getByRole('status', { name: 'Loading WorkSpace' })

    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status.textContent).toBe('')
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('.branded-status-wordmark')).toBeNull()
    expect(container.querySelector('[class*="spinner"]')).toBeNull()
  })

  it('keeps the error fallback actionable', () => {
    render(<BrandedStatusScreen error="The workspace could not render this view." />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'There was an error' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
