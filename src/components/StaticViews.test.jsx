import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CookieConsent, InstallAppView, WhatsNew } from './StaticViews.jsx'
import { RELEASE_NOTES } from '../lib/release-notes.js'

afterEach(() => {
  window.localStorage.clear()
})

it('lists what shipped, newest first, with the day in the app wide format', () => {
  render(<WhatsNew />)

  const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
  expect(headings).toEqual(RELEASE_NOTES.map(note => note.title))
  // Day first, because that is how the rest of the app writes a date.
  expect(screen.getAllByText(/\d{2}-\d{2}-\d{2}/).length).toBeGreaterThan(0)
})

it('keeps release details compact until the reader opens one', async () => {
  const user = userEvent.setup()
  render(<WhatsNew />)

  const latest = screen.getByText(RELEASE_NOTES[0].title).closest('details')
  expect(latest.open).toBe(false)

  await user.click(screen.getByText(RELEASE_NOTES[0].title))

  expect(latest.open).toBe(true)
  expect(screen.getByText(RELEASE_NOTES[0].items[0])).toBeVisible()
})

it('clears the sidebar marker as soon as it is opened', () => {
  const onOpen = vi.fn()

  render(<WhatsNew onOpen={onOpen} />)

  expect(onOpen).toHaveBeenCalled()
  expect(window.localStorage.getItem('workspace-whats-new-seen-v1')).toBeTruthy()
})

it('shows Android, iPhone, and desktop installation steps with screenshots', () => {
  render(<InstallAppView onNavigate={vi.fn()} />)

  expect(screen.getByRole('heading', { name: 'Android' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'iPhone and iPad' })).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Desktop' })).toBeVisible()

  expect(screen.getByRole('img', { name: /Android Chrome menu/ })).toHaveAttribute(
    'src',
    '/help/install-android.png',
  )
  expect(screen.getByRole('img', { name: /iPhone Safari share sheet/ })).toHaveAttribute(
    'src',
    '/help/install-iphone.png',
  )
  expect(screen.getByRole('img', { name: /Desktop browser install menu/ })).toHaveAttribute(
    'src',
    '/help/install-desktop.png',
  )
})

it('opens the Help center when the install option is unavailable', async () => {
  const user = userEvent.setup()
  const onNavigate = vi.fn()

  render(<InstallAppView onNavigate={onNavigate} />)
  await user.click(screen.getByRole('button', { name: 'Open Help center' }))

  expect(onNavigate).toHaveBeenCalledWith('Help')
})

it('shows the recommended cookie bar once and stores the accepted categories', async () => {
  const user = userEvent.setup()
  render(<CookieConsent onOpenLegal={vi.fn()} />)

  expect(screen.getByText('We use cookies')).toBeVisible()
  expect(screen.getByText('Read our cookie notice')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Preferences' })).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Accept all' }))

  expect(screen.queryByText('We use cookies')).not.toBeInTheDocument()
  expect(JSON.parse(window.localStorage.getItem('workspace-cookie-consent-v1'))).toMatchObject({
    analytics: true,
    preferences: true,
    productUpdates: true,
  })
})

it('saves a per-category cookie choice from the preference panel', async () => {
  const user = userEvent.setup()
  render(<CookieConsent onOpenLegal={vi.fn()} />)

  await user.click(screen.getByRole('button', { name: 'Preferences' }))

  expect(screen.getByRole('dialog', { name: 'Cookie preferences' })).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Analytics cookies' })).toBeChecked()
  expect(screen.getByRole('switch', { name: 'Preference cookies' })).toBeChecked()
  expect(screen.getByRole('switch', { name: 'Product update cookies' })).not.toBeChecked()

  await user.click(screen.getByRole('switch', { name: 'Product update cookies' }))
  await user.click(screen.getByRole('button', { name: 'Save preferences' }))

  expect(JSON.parse(window.localStorage.getItem('workspace-cookie-consent-v1'))).toMatchObject({
    analytics: true,
    preferences: true,
    productUpdates: true,
  })
})

it('declines optional cookies and opens the cookie notice from the compact card', async () => {
  const user = userEvent.setup()
  const onOpenLegal = vi.fn()
  render(<CookieConsent variant="card" onOpenLegal={onOpenLegal} />)

  expect(screen.getByText('Cookies on Workspace')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Read our cookie notice' }))
  expect(onOpenLegal).toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Decline optional' }))

  expect(JSON.parse(window.localStorage.getItem('workspace-cookie-consent-v1'))).toMatchObject({
    analytics: false,
    preferences: false,
    productUpdates: false,
  })
})

it('keeps the cookie choices hidden after a stored selection', () => {
  window.localStorage.setItem('workspace-cookie-consent-v1', 'all')

  render(<CookieConsent onOpenLegal={vi.fn()} />)

  expect(screen.queryByText('We use cookies')).not.toBeInTheDocument()
})
