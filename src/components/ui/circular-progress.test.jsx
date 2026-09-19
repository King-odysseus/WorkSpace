import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CircularProgress } from './circular-progress.jsx'

const arc = container => container.querySelectorAll('circle')[1]

describe('CircularProgress', () => {
  it('labels the ring with the value and its caption', () => {
    render(<CircularProgress value={67} caption="complete" />)
    expect(screen.getByRole('img', { name: '67% complete' })).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('complete')).toBeInTheDocument()
  })

  it('draws an arc proportional to the value', () => {
    const { container } = render(<CircularProgress value={50} size={140} stroke={12} />)
    const circumference = 2 * Math.PI * ((140 - 12) / 2)
    const [dash] = arc(container).getAttribute('stroke-dasharray').split(' ').map(Number)

    expect(dash).toBeCloseTo(circumference / 2, 5)
    expect(arc(container)).toHaveAttribute('stroke-linecap', 'round')
  })

  it('clamps values outside the range rather than drawing past the ring', () => {
    const { container: over } = render(<CircularProgress value={140} />)
    const { container: under } = render(<CircularProgress value={-20} />)
    const circumference = 2 * Math.PI * ((140 - 12) / 2)

    expect(over.querySelector('[data-slot="circular-progress"]')).toHaveAttribute('data-value', '100')
    expect(under.querySelector('[data-slot="circular-progress"]')).toHaveAttribute('data-value', '0')
    expect(Number(arc(over).getAttribute('stroke-dasharray').split(' ')[0])).toBeCloseTo(circumference, 5)
  })

  it('leaves the percentage out when the caller supplies its own centre', () => {
    render(<CircularProgress value={67} showValue={false} caption="complete" label="Sprint" />)
    expect(screen.queryByText('67%')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sprint' })).toBeInTheDocument()
  })
})
