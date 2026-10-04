import { describe, expect, it } from 'vitest'
import { messageIdFromGroupKey, parseNotificationDeepLink, resolveNotificationTarget, resolveSearchResultTarget } from './notification-navigation.js'

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
    expect(resolveNotificationTarget(notification('risk', 8))).toEqual({ action: 'pending', targetType: 'risk', targetId: '8', operation: 'risks' })
    expect(resolveNotificationTarget(notification('workstream', 6), { lookupValues: [{ id: 6, kind: 'workstream' }] })).toMatchObject({ action: 'open', targetType: 'workstream' })
    expect(resolveNotificationTarget(notification('workstream', 11))).toMatchObject({ action: 'pending', targetType: 'workstream', targetId: '11' })
  })

  it('routes document, screen-sharing, and workspace notifications to their destinations', () => {
    expect(resolveNotificationTarget(notification('document', 23))).toEqual({ action: 'pending', targetType: 'document', targetId: '23' })
    expect(resolveNotificationTarget(notification('screen_share_session', 'abc'))).toEqual({ action: 'pending', targetType: 'screen_share_session', targetId: 'abc' })
    expect(resolveNotificationTarget(notification('workspace', 1))).toEqual({ action: 'destination', targetType: 'workspace', destination: 'Today' })
  })

  it('opens the named chat thread rather than only its view', () => {
    expect(resolveNotificationTarget(notification('direct_conversation', 12))).toEqual({ action: 'chat', targetType: 'direct_conversation', targetId: '12', destination: 'Chats', messageId: '' })
    expect(resolveNotificationTarget(notification('chat_channel', 'general'))).toEqual({ action: 'chat', targetType: 'chat_channel', targetId: 'general', destination: 'Channels', messageId: '' })
  })

  it('carries the message a chat alert is about, from either the row or a push link', () => {
    // A bell row was loaded first, so the reference comes back as the group key
    // create_notification wrote; a push tap only has the url param.
    expect(resolveNotificationTarget({ target_type: 'direct_conversation', target_id: 12, group_key: 'message:88' })).toMatchObject({ action: 'chat', messageId: '88' })
    expect(resolveNotificationTarget({ target_type: 'chat_channel', target_id: 'general', message_id: '91' })).toMatchObject({ action: 'chat', messageId: '91' })
    expect(resolveNotificationTarget({ target_type: 'chat_channel', target_id: 'general', group_key: 'chat_channel:general' })).toMatchObject({ action: 'chat', messageId: '' })
  })
})

describe('resolveSearchResultTarget', () => {
  it('names the matched record for task, check-in, and follow-up hits', () => {
    expect(resolveSearchResultTarget({ kind: 'task', id: 4, target_type: 'task', target_id: 4 })).toEqual({ target_type: 'task', target_id: '4', message_id: '' })
    expect(resolveSearchResultTarget({ kind: 'check_in', id: 6, target_type: 'check_in', target_id: 6 })).toEqual({ target_type: 'check_in', target_id: '6', message_id: '' })
    expect(resolveSearchResultTarget({ kind: 'follow_up', id: 2, target_type: 'follow_up', target_id: 2 })).toEqual({ target_type: 'follow_up', target_id: '2', message_id: '' })
    expect(resolveSearchResultTarget({ kind: 'risk_issue', id: 9, target_type: 'risk_issue', target_id: 9 })).toEqual({ target_type: 'risk_issue', target_id: '9', message_id: '' })
  })

  it('carries the message id for a chat hit, whose target is the thread', () => {
    expect(resolveSearchResultTarget({ kind: 'chat_message', id: 55, target_type: 'chat_channel', target_id: 'design' })).toEqual({ target_type: 'chat_channel', target_id: 'design', message_id: '55' })
    expect(resolveSearchResultTarget({ kind: 'direct_message', id: 56, target_type: 'direct_conversation', target_id: 12 })).toEqual({ target_type: 'direct_conversation', target_id: '12', message_id: '56' })
  })

  it('opens the parent task for a comment hit, which has no target of its own', () => {
    expect(resolveSearchResultTarget({ kind: 'task_comment', id: 77, target_type: 'task', target_id: 4 })).toEqual({ target_type: 'task', target_id: '4', message_id: '' })
  })

  it('returns null rather than a target it cannot open', () => {
    expect(resolveSearchResultTarget({ kind: 'task', id: 4 })).toBeNull()
    expect(resolveSearchResultTarget({ kind: 'task', target_type: 'task' })).toBeNull()
    expect(resolveSearchResultTarget()).toBeNull()
    expect(resolveSearchResultTarget({ kind: 'task', target_type: 'task', target_id: 0 })).toEqual({ target_type: 'task', target_id: '0', message_id: '' })
  })
})

describe('messageIdFromGroupKey', () => {
  it('reads the message out of the key create_notification writes and ignores every other key', () => {
    expect(messageIdFromGroupKey('message:42')).toBe('42')
    expect(messageIdFromGroupKey('task:42')).toBe('')
    expect(messageIdFromGroupKey('')).toBe('')
    expect(messageIdFromGroupKey(undefined)).toBe('')
  })
})

describe('parseNotificationDeepLink', () => {
  it('reads the notification and its target from a full url', () => {
    expect(parseNotificationDeepLink('/?notification=7&target_type=task&target_id=42')).toEqual({ id: '7', target_type: 'task', target_id: '42', message_id: '' })
  })

  it('reads a bare query string the same way', () => {
    expect(parseNotificationDeepLink('?notification=7&target_type=check_in&target_id=3')).toEqual({ id: '7', target_type: 'check_in', target_id: '3', message_id: '' })
  })

  it('reads the message a chat push link was sent for', () => {
    expect(parseNotificationDeepLink('/?notification=7&target_type=chat_channel&target_id=general&message_id=91')).toEqual({ id: '7', target_type: 'chat_channel', target_id: 'general', message_id: '91' })
  })

  it('returns null when there is no notification to open', () => {
    expect(parseNotificationDeepLink('')).toBeNull()
    expect(parseNotificationDeepLink('/?view=Today')).toBeNull()
    expect(parseNotificationDeepLink(undefined)).toBeNull()
  })

  it('keeps the notification when the target params are missing', () => {
    expect(parseNotificationDeepLink('/?notification=7')).toEqual({ id: '7', target_type: '', target_id: '', message_id: '' })
  })
})
