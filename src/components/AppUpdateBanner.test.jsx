import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppUpdateBanner from './AppUpdateBanner.jsx'
import { applyAppUpdate, subscribeToAppUpdates } from '../lib/app-updates.js'

// The worker handshake itself is covered in lib/app-updates.test.js; here the
// module is a stub so the tests can drive the banner straight from a subscribe.
vi.mock('../lib/app-updates.js', () => ({
  subscribeToAppUpdates: vi.fn(),
  applyAppUpdate: vi.fn(),
}))

// Announces a waiting update through the listener the banner registered.
let announce

beforeEach(() => {
  applyAppUpdate.mockClear()
  let listen = null
  subscribeToAppUpdates.mockImplementation(listener => {
    listen = listener
    return () => {}
  })
  announce = () => act(() => listen(true))
})

describe('AppUpdateBanner', () => {
  it('shows nothing until a new version is waiting', () => {
    render(<AppUpdateBanner />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces the new version and reloads onto it when accepted', async () => {
    render(<AppUpdateBanner />)

    announce()

    expect(await screen.findByText(/new version of workspace is available/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /reload now/i }))

    expect(applyAppUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /reloading/i })).toBeDisabled()
  })

  it('can be dismissed, leaving the update to apply on the next restart', async () => {
    render(<AppUpdateBanner />)

    announce()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /later/i }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(applyAppUpdate).not.toHaveBeenCalled()
  })
})
