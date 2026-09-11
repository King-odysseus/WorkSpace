import { describe, expect, it } from 'vitest'
import { resolveNotificationTarget } from './notification-navigation.js'

const notification = (target_type, target_id) => ({ target_type, target_id })

describe('resolveNotificationTarget', () => {
  it('opens a loaded task and fetches a missing task', () => {
    expect(resolveNotificationTarget(notification('task', 4), { tasks: [{ id: 4, title: 'Ship it' }] })).toMatchObject({ action: 'open', target: { title: 'Ship it' } })
    expect(resolveNotificationTarget(notification('task', 9))).toEqual({ action: 'fetch', targetType: 'task', targetId: '9' })
  })

  it('opens loaded follow-ups and calendar events or keeps pending IDs', () => {
    expect(resolveNotificationTarget(notification('follow_up', 3), { followUps: [{ id: 3 }] })).toMatchObject({ action: 'open', targetType: 'follow_up' })
    expect(resolveNotificationTarget(notification('follow_up', 8))).toMatchObject({ action: 'pending', targetType: 'follow_up', targetId: '8' })
    expect(resolveNotificationTarget(notification('calendar_event', 5), { events: [{ id: 5 }] })).toMatchObject({ action: 'open', targetType: 'calendar_event' })
    expect(resolveNotificationTarget(notification('calendar_event', 10))).toMatchObject({ action: 'pending', targetType: 'calendar_event', targetId: '10' })
  })

  it('opens projects, preserves risk navigation, and resolves workstream filters', () => {
    expect(resolveNotificationTarget(notification('project', 2), { projects: [{ id: 2 }] })).toMatchObject({ action: 'open', targetType: 'project' })
    expect(resolveNotificationTarget(notification('risk_issue', 7))).toEqual({ action: 'pending', targetType: 'risk_issue', targetId: '7', operation: 'risks' })
    expect(resolveNotificationTarget(notification('workstream', 6), { lookupValues: [{ id: 6, kind: 'workstream' }] })).toMatchObject({ action: 'open', targetType: 'workstream' })
    expect(resolveNotificationTarget(notification('workstream', 11))).toMatchObject({ action: 'pending', targetType: 'workstream', targetId: '11' })
  })

  it('routes screen-sharing and workspace notifications to their destinations', () => {
    expect(resolveNotificationTarget(notification('screen_share_session', 'abc'))).toEqual({ action: 'pending', targetType: 'screen_share_session', targetId: 'abc' })
    expect(resolveNotificationTarget(notification('workspace', 1))).toEqual({ action: 'destination', targetType: 'workspace', destination: 'Today' })
  })
})
