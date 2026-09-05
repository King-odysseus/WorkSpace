import { describe, expect, it } from 'vitest'
import { mapTaskFromApi, taskDueLabel, taskSearchText, readJsonResponse } from './workspace-format.js'
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
