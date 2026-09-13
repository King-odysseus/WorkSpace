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
})
