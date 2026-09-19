import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from './alert.jsx'

describe('Alert', () => {
  it('uses alert semantics for danger feedback', () => {
    render(<Alert tone="danger" title="Upload failed">Try again.</Alert>)
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed')
    expect(screen.getByRole('alert')).toHaveTextContent('Try again.')
  })

  it('uses status semantics for informational feedback', () => {
    render(<Alert tone="info" compact>Saved</Alert>)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  // The tone is carried by a data attribute because the ramp is CSS. If the
  // attribute stops matching the tone name the alert silently falls back to the
  // info colours, which no assertion on the text would catch.
  it('carries the tone the ramp keys off', () => {
    render(<Alert tone="warning" title="Slow sync">Some rows may lag.</Alert>)
    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'warning')
  })

  it('falls back to the info icon for an unknown tone', () => {
    render(<Alert tone="chartreuse">Odd.</Alert>)
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'chartreuse')
  })
})
