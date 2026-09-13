import { describe, expect, it } from 'vitest'
import { calendarDayOffset, calendarEventConflictCounts, calendarUpcomingGroup, effectivePresence, filterCheckInsByRange, formatDate, formatDateTime, formatDay, formatDayMonth, formatLastSeen, mapTaskFromApi, sortMembersByRecentActivity, taskAssigneeLabel, taskDueLabel, taskIsAssignedTo, taskSearchText, readJsonResponse } from './workspace-format.js'
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
    expect(taskDueLabel('2026-09-05', '2026-09-05')).toBe('05/09/2026')
    expect(taskDueLabel('', '2026-09-05')).toBe('No due date')
  })
})

describe('formatDay', () => {
  it('writes a day as DD/MM/YYYY', () => {
    expect(formatDay('2026-09-05')).toBe('05/09/2026')
  })

  it('takes the day off a timestamp without shifting it', () => {
    // Read as text, not through Date: a UTC timestamp late in the evening is the
    // previous day for anyone west of UTC, and a due date must not move.
    expect(formatDay('2026-09-05T23:30:00Z')).toBe('05/09/2026')
  })

  it('renders nothing rather than a broken date', () => {
    expect(formatDay('')).toBe('')
    expect(formatDay('next tuesday')).toBe('')
  })
})

describe('formatDate', () => {
  // Built from local parts rather than an ISO string, so the expectation holds
  // wherever the suite runs.
  it('writes a timestamp in the reader own time zone as DD/MM/YYYY', () => {
    expect(formatDate(new Date(2026, 8, 5, 23, 30))).toBe('05/09/2026')
  })

  it('renders nothing rather than a broken date', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate('not a date')).toBe('')
  })
})

describe('formatDateTime', () => {
  it('puts a 24 hour clock beside the day', () => {
    expect(formatDateTime(new Date(2026, 8, 5, 9, 5))).toBe('05/09/2026 09:05')
    expect(formatDateTime(new Date(2026, 8, 5, 18, 45))).toBe('05/09/2026 18:45')
  })

  it('renders nothing rather than a broken date', () => {
    expect(formatDateTime('')).toBe('')
  })
})

describe('formatDayMonth', () => {
  it('drops the year for the narrow slots', () => {
    expect(formatDayMonth(new Date(2026, 8, 5, 12))).toBe('05/09')
  })

  it('renders nothing rather than a broken date', () => {
    expect(formatDayMonth('')).toBe('')
  })
})

describe('formatLastSeen', () => {
  it('gives the day in the app wide format once relative wording runs out', () => {
    expect(formatLastSeen(new Date(2020, 0, 5, 12).toISOString())).toBe('Last seen 05/01/2020')
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

describe('taskAssigneeLabel', () => {
  it('names the sole assignee without a count', () => {
    expect(taskAssigneeLabel({ member: 'Ada Lovelace', assignee_ids: [1] })).toBe('Ada Lovelace')
  })

  it('counts the co-owners beyond the primary', () => {
    expect(taskAssigneeLabel({ member: 'Ada Lovelace', assignee_ids: [1, 2, 3] })).toBe('Ada Lovelace + 2')
  })

  it('falls back to the legacy name when the API sends no assignee ids', () => {
    expect(taskAssigneeLabel({ member: 'Ada Lovelace' })).toBe('Ada Lovelace')
  })
})

describe('taskIsAssignedTo', () => {
  const coOwned = { member: 'Ada Lovelace', assignee_id: 1, assignee_ids: [1, 2] }

  it('matches any co-owner, not just the primary', () => {
    expect(taskIsAssignedTo(coOwned, 1)).toBe(true)
    expect(taskIsAssignedTo(coOwned, 2)).toBe(true)
    expect(taskIsAssignedTo(coOwned, 3)).toBe(false)
  })

  it('compares ids across string and number forms', () => {
    expect(taskIsAssignedTo(coOwned, '2')).toBe(true)
  })

  it('treats assignee_ids as authoritative once the API sends them', () => {
    // assignee_id still names the primary, but it must not grant membership on
    // its own - otherwise clearing a co-owner would not take effect.
    expect(taskIsAssignedTo({ member: 'Ada', assignee_id: 1, assignee_ids: [2] }, 1)).toBe(false)
  })

  it('falls back to the single assignee id when the API sends no list', () => {
    expect(taskIsAssignedTo({ member: 'Ada', assignee_id: 7 }, 7)).toBe(true)
    expect(taskIsAssignedTo({ member: 'Ada', assignee_id: 7 }, 8)).toBe(false)
  })

  it('falls back to the reported name for the oldest payloads', () => {
    expect(taskIsAssignedTo({ member: 'Ada Lovelace' }, 9, 'Ada Lovelace')).toBe(true)
    expect(taskIsAssignedTo({ member: 'Ada Lovelace' }, 9, 'Grace Hopper')).toBe(false)
  })

  it('does not claim a task sitting on the Unassigned placeholder', () => {
    expect(taskIsAssignedTo({ member: 'Unassigned', assignee_id: '' }, 9, 'Ada Lovelace')).toBe(false)
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

describe('calendarUpcomingGroup', () => {
  const reference = new Date(2026, 8, 13, 12)

  it('uses local calendar days for the upcoming buckets', () => {
    expect(calendarDayOffset(new Date(2026, 8, 20, 8), reference)).toBe(7)
    expect(calendarUpcomingGroup(new Date(2026, 8, 13, 23), reference).key).toBe('today')
    expect(calendarUpcomingGroup(new Date(2026, 8, 14, 9), reference).key).toBe('tomorrow')
    expect(calendarUpcomingGroup(new Date(2026, 8, 20, 9), reference).key).toBe('next-seven-days')
    expect(calendarUpcomingGroup(new Date(2026, 8, 21, 9), reference).key).toBe('later')
  })
})

describe('calendarEventConflictCounts', () => {
  it('counts overlapping events and ignores ranges that only touch', () => {
    const conflicts = calendarEventConflictCounts([
      { id: 1, start_at: '2026-09-13T09:00:00Z', end_at: '2026-09-13T10:00:00Z' },
      { id: 2, start_at: '2026-09-13T09:30:00Z', end_at: '2026-09-13T10:30:00Z' },
      { id: 3, start_at: '2026-09-13T10:00:00Z', end_at: '2026-09-13T11:00:00Z' },
      { id: 4, start_at: '2026-09-13T14:00:00Z', end_at: '2026-09-13T15:00:00Z' },
    ])

    expect(conflicts.get(1)).toBe(1)
    expect(conflicts.get(2)).toBe(2)
    expect(conflicts.get(3)).toBe(1)
    expect(conflicts.has(4)).toBe(false)
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
