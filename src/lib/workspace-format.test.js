import { describe, expect, it } from 'vitest'
import { effectivePresence, filterCheckInsByRange, mapTaskFromApi, sortMembersByRecentActivity, taskDueLabel, taskSearchText, readJsonResponse } from './workspace-format.js'
import { taskMatchesScope } from '../components/WorkScopeSelector.jsx'

const jsonResponse = (body, { ok = true, status = 200, contentType = 'application/json' } = {}) => ({
  ok,
  status,
  headers: { get: () => contentType },
  json: async () => body,
})

describe('taskDueLabel', () => {
  it('reports overdue only for dates strictly before today', () => {
    expect(taskDueLabel('2026-09-04', '2026-09-05')).toBe('Overdue')
    expect(taskDueLabel('2026-09-05', '2026-09-05')).toBe('2026-09-05')
    expect(taskDueLabel('', '2026-09-05')).toBe('No due date')
  })
})

describe('mapTaskFromApi', () => {
  const apiTask = { id: 7, title: 'Ship release', status: 'in_progress', assignee_id: 42, due_date: '2026-09-04' }

  it('normalises the wire status to the label the UI renders', () => {
    expect(mapTaskFromApi(apiTask, { today: '2026-09-05' }).status).toBe('in progress')
  })

  it('applies defaults for fields the API omits', () => {
    const mapped = mapTaskFromApi({ id: 1, title: 'Bare' }, { today: '2026-09-05' })
    expect(mapped.member).toBe('Unassigned')
    expect(mapped.tag).toBe('General')
    expect(mapped.bucket).toBe('Backlog')
    expect(mapped.priority).toBe('normal')
    expect(mapped.labels).toEqual([])
  })

  it('grants edit rights to leaders and to the assignee, but nobody else', () => {
    const asOwner = mapTaskFromApi(apiTask, { today: '2026-09-05', workspaceRole: 'owner', currentUserId: 1 })
    const asAssignee = mapTaskFromApi(apiTask, { today: '2026-09-05', workspaceRole: 'member', currentUserId: 42 })
    const asBystander = mapTaskFromApi(apiTask, { today: '2026-09-05', workspaceRole: 'member', currentUserId: 1 })
    expect(asOwner.can_edit).toBe(true)
    expect(asAssignee.can_edit).toBe(true)
    expect(asBystander.can_edit).toBe(false)
  })

  it('keeps a zero progress value rather than falling back to a default', () => {
    expect(mapTaskFromApi({ id: 1, title: 'T', progress_percent: 0 }, { today: '2026-09-05' }).progress_percent).toBe(0)
  })
})

describe('taskSearchText', () => {
  it('folds the searchable fields into one lowercase haystack', () => {
    const text = taskSearchText({ title: 'Ship Release', member: 'Ada', tag: 'Apollo', labels: ['Urgent'] })
    expect(text).toBe('ship release ada apollo urgent')
  })
})

describe('filterCheckInsByRange', () => {
  const checkIns = [
    { id: 1, date: '2026-08-14' },
    { id: 2, date: '2026-08-15' },
    { id: 3, date: '2026-09-06' },
    { id: 4, date: '2026-09-07' },
    { id: 5, date: '2026-09-13' },
    { id: 6, date: '2026-09-14' },
  ]

  it('shows only today for the today range', () => {
    expect(filterCheckInsByRange(checkIns, 'today', '2026-09-13').map(item => item.id)).toEqual([5])
  })

  it('uses an inclusive seven-day window for the past week', () => {
    expect(filterCheckInsByRange(checkIns, 'week', '2026-09-13').map(item => item.id)).toEqual([5, 4])
  })

  it('uses an inclusive thirty-day window for the past month', () => {
    expect(filterCheckInsByRange(checkIns, 'month', '2026-09-13').map(item => item.id)).toEqual([5, 4, 3, 2])
  })

  it('returns every check-in newest first for all time without mutating the input', () => {
    const source = [...checkIns]
    expect(filterCheckInsByRange(source, 'all', '2026-09-13').map(item => item.id)).toEqual([6, 5, 4, 3, 2, 1])
    expect(source.map(item => item.id)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('taskMatchesScope', () => {
  const operationsTask = { project_id: '' }
  const projectTask = { project_id: 12 }

  it('matches everything when no scope is selected', () => {
    expect(taskMatchesScope(projectTask, 'all')).toBe(true)
    expect(taskMatchesScope(projectTask, undefined)).toBe(true)
  })

  it('separates operations work from project work', () => {
    expect(taskMatchesScope(operationsTask, 'operations')).toBe(true)
    expect(taskMatchesScope(projectTask, 'operations')).toBe(false)
  })

  it('compares project ids across string and number forms', () => {
    expect(taskMatchesScope(projectTask, '12')).toBe(true)
    expect(taskMatchesScope(projectTask, '13')).toBe(false)
  })
})

describe('readJsonResponse', () => {
  it('returns the parsed body for a JSON response', async () => {
    await expect(readJsonResponse(jsonResponse({ ok: true }), 'fallback')).resolves.toEqual({ ok: true })
  })

  it('reports the status instead of a parse error when the body is not JSON', async () => {
    // This is the regression that surfaced as "Unexpected token '<' ... is not
    // valid JSON" when an endpoint answered 405 with an empty body.
    const response = jsonResponse('', { ok: false, status: 405, contentType: 'text/html' })
    await expect(readJsonResponse(response, 'Bucket could not be archived.')).rejects.toThrow(
      'Bucket could not be archived. (server returned 405)',
    )
  })
})

describe('effectivePresence', () => {
  it('shows the self-reported presence while last_seen_at is fresh', () => {
    expect(effectivePresence({ presence: 'busy', last_seen_at: new Date().toISOString() })).toBe('busy')
  })

  it('overrides a stale self-reported presence with offline', () => {
    const elevenHoursAgo = new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString()
    expect(effectivePresence({ presence: 'available', last_seen_at: elevenHoursAgo })).toBe('offline')
  })

  it('treats a member who has never been seen as offline', () => {
    expect(effectivePresence({ presence: 'available', last_seen_at: '' })).toBe('offline')
  })
})

describe('sortMembersByRecentActivity', () => {
  it('excludes the current user and sorts most-recently-active first', () => {
    const members = [
      { id: 1, last_seen_at: '2026-09-07T08:00:00Z' },
      { id: 2, last_seen_at: '2026-09-07T10:00:00Z' },
      { id: 3, last_seen_at: '2026-09-06T10:00:00Z' },
    ]
    const result = sortMembersByRecentActivity(members, 2)
    expect(result.map(member => member.id)).toEqual([1, 3])
  })

  it('treats members with no last-seen as least recent', () => {
    const members = [
      { id: 1, last_seen_at: '' },
      { id: 2, last_seen_at: '2026-09-07T10:00:00Z' },
    ]
    const result = sortMembersByRecentActivity(members, 999)
    expect(result.map(member => member.id)).toEqual([2, 1])
  })

  it('respects the limit', () => {
    const members = [1, 2, 3, 4, 5].map(id => ({ id, last_seen_at: '2026-09-07T10:00:00Z' }))
    const result = sortMembersByRecentActivity(members, 999, 3)
    expect(result.length).toBe(3)
  })
})
