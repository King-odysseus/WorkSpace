import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Tooltip, TooltipTrigger } from './tooltip.jsx'

describe('Tooltip', () => {
  it('describes its trigger rather than wrapping it in a second node', () => {
    render(
      <Tooltip content="Collapse sidebar">
        <TooltipTrigger label="Collapse sidebar" />
      </Tooltip>,
    )

    const trigger = screen.getByRole('button', { name: 'Collapse sidebar' })
    const bubble = screen.getByRole('tooltip')
    expect(trigger).toHaveAttribute('aria-describedby', bubble.id)
  })

  it('keeps any described-by the trigger already had', () => {
    render(
      <Tooltip content="Collapse sidebar">
        <TooltipTrigger label="Collapse" aria-describedby="existing" />
      </Tooltip>,
    )

    expect(screen.getByRole('button', { name: 'Collapse' }))
      .toHaveAttribute('aria-describedby', expect.stringContaining('existing'))
  })

  it('portals the bubble and opens it for hover and keyboard focus', () => {
    render(
      <Tooltip content="Collapse sidebar" side="right">
        <button type="button">Collapse sidebar</button>
      </Tooltip>,
    )

    const trigger = screen.getByRole('button', { name: 'Collapse sidebar' })
    const bubble = screen.getByRole('tooltip')
    expect(bubble.parentElement).toBe(document.body)
    expect(bubble).toHaveAttribute('data-side', 'right')
    expect(bubble).toHaveAttribute('data-state', 'hidden')

    fireEvent.mouseEnter(trigger)
    expect(bubble).toHaveAttribute('data-state', 'visible')

    fireEvent.mouseLeave(trigger)
    expect(bubble).toHaveAttribute('data-state', 'hidden')

    fireEvent.focus(trigger)
    expect(bubble).toHaveAttribute('data-state', 'visible')

    fireEvent.blur(trigger)
    expect(bubble).toHaveAttribute('data-state', 'hidden')
  })

  it('renders the trigger bare when there is no content to show', () => {
    render(
      <Tooltip content="">
        <TooltipTrigger label="Collapse sidebar" />
      </Tooltip>,
    )

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).not.toHaveAttribute('aria-describedby')
  })
})
