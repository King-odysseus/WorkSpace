import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CheckInOptOut from './CheckInOptOut.jsx'

function stubFetch(initial) {
  let skips = initial
  const calls = []
  global.fetch = vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body })
    if (String(url).includes('csrf')) return { ok: true, json: async () => ({ csrfToken: 'token' }) }
    if (options.method === 'PATCH') skips = JSON.parse(options.body).skips_check_ins
    return { ok: true, json: async () => ({ skips_check_ins: skips }) }
  })
  return calls
}

afterEach(() => { vi.restoreAllMocks() })

describe('CheckInOptOut', () => {
  it('shows nothing to a member and makes no request', () => {
    const calls = stubFetch(false)
    const { container } = render(<CheckInOptOut workspaceId={1} role="member" />)
    expect(container.firstChild).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('lets a manager turn check-ins off and tells the page to refresh', async () => {
    const calls = stubFetch(false)
    const onChanged = vi.fn()
    render(<CheckInOptOut workspaceId={1} role="manager" onChanged={onChanged} />)
    const toggle = await screen.findByRole('switch', { name: 'Skip my daily check-ins' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    fireEvent.click(toggle)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(calls.some(call => call.method === 'PATCH' && JSON.parse(call.body).skips_check_ins === true)).toBe(true)
    expect(await screen.findByText('Skipping check-ins')).toBeTruthy()
  })
})
