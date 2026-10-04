import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRecordDraft,
  clearUserRecordDrafts,
  hasDraftContent,
  readRecordDraft,
  recordDraftKey,
  writeRecordDraft,
} from './record-drafts.js'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  window.localStorage.clear()
})

describe('readRecordDraft', () => {
  it('returns what was written, with the time it was written', () => {
    const now = Date.UTC(2026, 9, 4, 12, 0)
    writeRecordDraft(7, 1, 'checkin', { completed: 'Wrote the audit', next_steps: 'Ship phase one' }, now)

    const draft = readRecordDraft(7, 1, 'checkin', now + 1000)
    expect(draft.fields.completed).toBe('Wrote the audit')
    expect(draft.fields.next_steps).toBe('Ship phase one')
    expect(draft.savedAt.getTime()).toBe(now)
  })

  it('keeps each user, workspace, and record type apart', () => {
    writeRecordDraft(7, 1, 'checkin', { completed: 'Seven, workspace one' })
    writeRecordDraft(8, 1, 'checkin', { completed: 'Eight, workspace one' })
    writeRecordDraft(7, 2, 'checkin', { completed: 'Seven, workspace two' })
    writeRecordDraft(7, 1, 'project', { name: 'A project' })

    expect(readRecordDraft(7, 1, 'checkin').fields.completed).toBe('Seven, workspace one')
    expect(readRecordDraft(8, 1, 'checkin').fields.completed).toBe('Eight, workspace one')
    expect(readRecordDraft(7, 2, 'checkin').fields.completed).toBe('Seven, workspace two')
    expect(readRecordDraft(7, 1, 'project').fields.name).toBe('A project')
    // Nothing was ever written under this reader's id.
    expect(readRecordDraft(9, 1, 'checkin')).toBeNull()
  })

  it('ignores and removes a draft older than the expiry', () => {
    const savedAt = Date.UTC(2026, 9, 1, 12, 0)
    writeRecordDraft(7, 1, 'checkin', { completed: 'Old news' }, savedAt)

    expect(readRecordDraft(7, 1, 'checkin', savedAt + 6 * DAY)).not.toBeNull()
    expect(readRecordDraft(7, 1, 'checkin', savedAt + 8 * DAY)).toBeNull()
    // The expired draft is gone rather than merely skipped, so storage does not
    // accumulate abandoned private text.
    expect(window.localStorage.getItem(recordDraftKey(7, 1, 'checkin'))).toBeNull()
  })

  it('treats an unreadable entry as absent and clears it', () => {
    window.localStorage.setItem(recordDraftKey(7, 1, 'checkin'), 'not json')
    expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
    expect(window.localStorage.getItem(recordDraftKey(7, 1, 'checkin'))).toBeNull()
  })

  it('never returns something it could not ask for', () => {
    expect(readRecordDraft(null, 1, 'checkin')).toBeNull()
    expect(readRecordDraft(7, null, 'checkin')).toBeNull()
    expect(readRecordDraft(7, 1, 'not-a-type')).toBeNull()
  })
})

describe('writeRecordDraft', () => {
  it('keeps only the fields the type knows about', () => {
    writeRecordDraft(7, 1, 'calendar', {
      title: 'Planning',
      description: 'Sprint planning',
      start_at: '2026-10-05T09:00',
      end_at: '2026-10-05T10:00',
      reminder_minutes: 15,
      // Not a calendar field: an invitee email has no business in this draft.
      email: 'someone@example.com',
      role: 'manager',
    })

    const draft = readRecordDraft(7, 1, 'calendar')
    expect(draft.fields.title).toBe('Planning')
    expect(draft.fields.reminder_minutes).toBe(15)
    expect(draft.fields.email).toBeUndefined()
    expect(draft.fields.role).toBeUndefined()
  })

  it('stores nothing for a form that was only ever left at its defaults', () => {
    // A date, a bucket name, a status: all of these are filled in for the reader
    // before they type, so a draft of nothing but defaults would offer to resume
    // a form nobody started.
    expect(writeRecordDraft(7, 1, 'task', { newTask: '   ', newBucket: 'Backlog', newPriority: 'normal', newDueDate: '2026-10-09' })).toBe(false)
    expect(readRecordDraft(7, 1, 'task')).toBeNull()
  })

  it('clears a draft once its form no longer holds content', () => {
    writeRecordDraft(7, 1, 'checkin', { completed: 'Something' })
    expect(readRecordDraft(7, 1, 'checkin')).not.toBeNull()

    // Deleting the text is the reader withdrawing the draft, not a write error.
    expect(writeRecordDraft(7, 1, 'checkin', { completed: '' })).toBe(false)
    expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
  })

  it('reports failure instead of throwing when storage refuses', () => {
    // A full quota, or a browser with storage turned off, must cost the reader
    // nothing but the draft.
    vi.stubGlobal('localStorage', {
      length: 0,
      key: () => null,
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { throw new Error('QuotaExceededError') },
    })

    expect(writeRecordDraft(7, 1, 'checkin', { completed: 'Still typing' })).toBe(false)
    expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
  })
})

describe('hasDraftContent', () => {
  it('asks for the field the form cannot be saved without', () => {
    expect(hasDraftContent('task', { newTask: 'Ship it' })).toBe(true)
    expect(hasDraftContent('task', { newDescription: 'Only a description' })).toBe(false)
    expect(hasDraftContent('checkin', { completed: 'Done' })).toBe(true)
    expect(hasDraftContent('checkin', { blockers: 'Only a blocker' })).toBe(false)
    expect(hasDraftContent('not-a-type', { anything: 'x' })).toBe(false)
  })
})

describe('clearUserRecordDrafts', () => {
  it('signs out one reader and leaves everyone else alone', () => {
    writeRecordDraft(7, 1, 'checkin', { completed: 'Mine here' })
    writeRecordDraft(7, 2, 'task', { newTask: 'Mine there' })
    writeRecordDraft(8, 1, 'checkin', { completed: 'Theirs' })

    clearUserRecordDrafts(7)

    expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
    expect(readRecordDraft(7, 2, 'task')).toBeNull()
    expect(readRecordDraft(8, 1, 'checkin').fields.completed).toBe('Theirs')
  })

  it('does nothing without a reader to clear', () => {
    writeRecordDraft(7, 1, 'checkin', { completed: 'Mine' })
    clearUserRecordDrafts(null)
    expect(readRecordDraft(7, 1, 'checkin')).not.toBeNull()
  })
})

describe('clearRecordDraft', () => {
  it('clears one type without touching the others', () => {
    writeRecordDraft(7, 1, 'checkin', { completed: 'A check-in' })
    writeRecordDraft(7, 1, 'project', { name: 'A project' })

    clearRecordDraft(7, 1, 'checkin')

    expect(readRecordDraft(7, 1, 'checkin')).toBeNull()
    expect(readRecordDraft(7, 1, 'project').fields.name).toBe('A project')
  })
})
