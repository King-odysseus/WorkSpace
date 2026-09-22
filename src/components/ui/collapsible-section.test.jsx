import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { CollapsibleSection } from './collapsible-section.jsx'

describe('CollapsibleSection', () => {
  it('starts closed so the section stays out of the way', () => {
    render(
      <CollapsibleSection title="Done" count={3}>
        <p>Finished task</p>
      </CollapsibleSection>,
    )
    expect(screen.getByRole('button', { name: 'Show Done (3 items)' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
  })

  it('reveals its content when the heading is opened', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection title="Done" count={1}>
        <p>Finished task</p>
      </CollapsibleSection>,
    )
    const trigger = screen.getByRole('button', { name: 'Show Done (1 item)' })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Hide Done (1 item)' })).toBe(trigger)
    expect(screen.getByText('Finished task')).toBeInTheDocument()
  })

  it('hides the content again on a second click', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection title="Done" defaultOpen>
        <p>Finished task</p>
      </CollapsibleSection>,
    )
    await user.click(screen.getByRole('button', { name: 'Hide Done' }))
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
  })

  it('names the controlled content from the trigger', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleSection title="Done">
        <p>Finished task</p>
      </CollapsibleSection>,
    )
    const trigger = screen.getByRole('button', { name: 'Show Done' })
    await user.click(trigger)
    const contentId = trigger.getAttribute('aria-controls')
    expect(contentId).toBeTruthy()
    expect(document.getElementById(contentId)).toHaveTextContent('Finished task')
  })

  it('reports an open change to the caller when controlled', async () => {
    const user = userEvent.setup()
    const changes = []
    render(
      <CollapsibleSection title="Done" open={false} onOpenChange={next => changes.push(next)}>
        <p>Finished task</p>
      </CollapsibleSection>,
    )
    await user.click(screen.getByRole('button', { name: 'Show Done' }))
    expect(changes).toEqual([true])
    // A controlled section does not open itself: the caller owns the state.
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
  })
})
