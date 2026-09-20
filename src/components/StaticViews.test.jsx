import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { CookieConsent, HelpView, InstallAppView, LegalView, WhatsNew } from './StaticViews.jsx'
import { RELEASE_NOTES } from '../lib/release-notes.js'

afterEach(() => {
  window.localStorage.clear()
})

it('lists what shipped, newest first, with the day in the app wide format', () => {
  const { container } = render(<WhatsNew />)

  const headings = [...container.querySelectorAll('.whats-new-entry h2')].map(node => node.textContent)
  expect(headings).toEqual(RELEASE_NOTES.map(note => note.title))
  // Day first, because that is how the rest of the app writes a date.
  expect(screen.getAllByText(/\d{2}-\d{2}-\d{2}/).length).toBeGreaterThan(0)
})

it('keeps release details visible and lets the reader filter by the available categories', async () => {
  const user = userEvent.setup()
  render(<WhatsNew />)

  expect(screen.getByText(RELEASE_NOTES[0].items[0])).toBeVisible()
  expect(screen.getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: /Fixes/ })).toBeDisabled()
  expect(screen.getByRole('tab', { name: /Announcements/ })).toBeDisabled()

  await user.click(screen.getByRole('tab', { name: /Product/ }))
  expect(screen.getByRole('tab', { name: /Product/ })).toHaveAttribute('aria-selected', 'true')
  RELEASE_NOTES.forEach(note => expect(screen.getByText(note.title)).toBeVisible())
})

it('marks releases as seen only when the reader confirms it', async () => {
  const user = userEvent.setup()
  const onOpen = vi.fn()

  render(<WhatsNew onOpen={onOpen} />)

  expect(onOpen).not.toHaveBeenCalled()
  expect(window.localStorage.getItem('workspace-whats-new-seen-v1')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Mark as seen' }))

  expect(onOpen).toHaveBeenCalled()
  expect(window.localStorage.getItem('workspace-whats-new-seen-v1')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Marked as seen' })).toBeDisabled()
})

it('shows the supported install platforms and a browser-menu fallback', async () => {
  const user = userEvent.setup()
  render(<InstallAppView onNavigate={vi.fn()} />)

  expect(screen.getByRole('heading', { name: 'Supported platforms' })).toBeVisible()
  expect(screen.getByText('Chrome or Edge on desktop')).toBeVisible()
  expect(screen.getByText('macOS')).toBeVisible()
  expect(screen.getByText('Windows')).toBeVisible()
  expect(screen.getByText('iOS and Android')).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Install now' }))
  expect(screen.getByRole('status')).toHaveTextContent(/browser menu/i)
})

it('returns the reader to the workspace when installation is not wanted', async () => {
  const user = userEvent.setup()
  const onNavigate = vi.fn()

  render(<InstallAppView onNavigate={onNavigate} />)
  await user.click(screen.getByRole('button', { name: 'Back to Workspace' }))

  expect(onNavigate).toHaveBeenCalledWith('Today')
})

it('filters Help guides and expands a matching article', async () => {
  const user = userEvent.setup()
  const { container } = render(<HelpView onNavigate={vi.fn()} />)

  await user.type(screen.getByRole('textbox', { name: 'Search help articles' }), 'Create and assign a task')

  expect(screen.getByRole('heading', { level: 2, name: 'Task guidance' })).toBeVisible()
  expect(screen.queryByText('Project guidance')).not.toBeInTheDocument()

  await user.click(container.querySelector('.help-article-items button'))
  expect(screen.getByText(/Capture work so someone owns it/)).toBeVisible()
  expect(screen.getByText('Enter a clear task name and add any useful description.')).toBeVisible()
})

it('navigates legal documents and persists cookie and policy choices', async () => {
  const user = userEvent.setup()
  render(<LegalView />)

  await user.click(screen.getByRole('button', { name: 'Terms of service' }))
  expect(screen.getByRole('heading', { level: 2, name: 'Terms of service' })).toBeVisible()
  expect(screen.getByText('Use Workspace lawfully and follow the separate acceptable use policy.')).toBeVisible()

  const analytics = screen.getByRole('switch', { name: 'Analytics cookies' })
  expect(analytics).toBeChecked()
  await user.click(analytics)
  await user.click(screen.getByRole('button', { name: 'Manage preferences' }))

  expect(JSON.parse(window.localStorage.getItem('workspace-cookie-consent-v1'))).toMatchObject({
    analytics: false,
    preferences: true,
  })

  await user.click(screen.getByRole('button', { name: 'Accept policies' }))
  expect(window.localStorage.getItem('workspace-legal-accepted-v1')).toBe('true')
  expect(screen.getByRole('button', { name: 'Policies accepted' })).toBeDisabled()
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
