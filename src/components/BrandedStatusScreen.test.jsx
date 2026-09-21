import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

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
    render(<BrandedStatusScreen />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: 'The workspace could not render this view',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/your data is safe/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeInTheDocument()
  })

  it('calls the recovery actions supplied by the app', async () => {
    const user = userEvent.setup()
    const onReload = vi.fn()
    const onGoToToday = vi.fn()

    render(
      <BrandedStatusScreen
        onReload={onReload}
        onGoToToday={onGoToToday}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Reload view' }))
    await user.click(screen.getByRole('button', { name: 'Go to Today' }))

    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onGoToToday).toHaveBeenCalledTimes(1)
  })
})
