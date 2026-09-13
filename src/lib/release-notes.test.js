import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELEASE_NOTES, latestReleaseDate, markReleaseNotesSeen, releaseNotesUnread } from './release-notes.js'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('release notes', () => {
  it('is written newest first, which is what the page and the marker both assume', () => {
    const dates = RELEASE_NOTES.map(note => note.date)
    expect([...dates].sort().reverse()).toEqual(dates)
    expect(latestReleaseDate()).toBe(dates[0])
  })

  it('counts as unread until the page has been opened', () => {
    expect(releaseNotesUnread()).toBe(true)

    markReleaseNotesSeen()

    expect(releaseNotesUnread()).toBe(false)
  })

  it('goes unread again once an entry is newer than the one this browser saw', () => {
    markReleaseNotesSeen()
    window.localStorage.setItem('workspace-whats-new-seen-v1', '1999-01-01')

    expect(releaseNotesUnread()).toBe(true)
  })

  it('stays quiet when storage cannot be read, rather than badging a page that cannot be cleared', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })

    expect(releaseNotesUnread()).toBe(false)
  })

  it('does not throw when storage cannot be written', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    expect(() => markReleaseNotesSeen()).not.toThrow()
  })
})
