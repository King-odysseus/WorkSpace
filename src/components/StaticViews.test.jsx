import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { WhatsNew } from './StaticViews.jsx'
import { RELEASE_NOTES } from '../lib/release-notes.js'

afterEach(() => {
  window.localStorage.clear()
})

it('lists what shipped, newest first, with the day in the app wide format', () => {
  render(<WhatsNew />)

  const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
  expect(headings).toEqual(RELEASE_NOTES.map(note => note.title))
  // Day first, because that is how the rest of the app writes a date.
  expect(screen.getAllByText(/\d{2}\/\d{2}\/\d{4}/).length).toBeGreaterThan(0)
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
