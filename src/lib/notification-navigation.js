export const notificationDestinations = {
  follow_up: 'Follow-up',
  chat_channel: 'Channels',
  direct_conversation: 'Chats',
  calendar_event: 'Calendar',
  check_in: 'Check-ins',
  screen_share_session: 'Screen sharing',
  project: 'Projects',
  risk_issue: 'Projects',
  workstream: 'Planner',
  workspace: 'Today',
}

const sameId = (left, right) => String(left) === String(right)

// A push carries a deep link so tapping it lands on the record the notification
// is about. Both entry points use this: a cold start reads it off
// window.location, an already-running window receives the same url in an
// OPEN_NOTIFICATION message from the service worker. Accepts a full url or a
// bare query string.
export function parseNotificationDeepLink(value) {
  const text = String(value || '')
  const query = text.includes('?') ? text.slice(text.indexOf('?')) : text
  const params = new URLSearchParams(query)
  const id = params.get('notification')
  if (!id) return null
  return {
    id,
    target_type: params.get('target_type') || '',
    target_id: params.get('target_id') || '',
  }
}

export function resolveNotificationTarget(notification, { tasks = [], events = [], followUps = [], projects = [], lookupValues = [] } = {}) {
  const targetId = String(notification.target_id || '')
  const targetType = notification.target_type
  if (targetType === 'task') {
    const target = tasks.find(item => sameId(item.id, targetId))
    return target ? { action: 'open', targetType, target } : { action: 'fetch', targetType, targetId }
  }
  if (targetType === 'calendar_event') {
    const target = events.find(item => sameId(item.id, targetId))
    return target ? { action: 'open', targetType, target } : { action: 'pending', targetType, targetId }
  }
  if (targetType === 'follow_up') {
    const target = followUps.find(item => sameId(item.id, targetId))
    return target ? { action: 'open', targetType, target } : { action: 'pending', targetType, targetId }
  }
  if (targetType === 'project') {
    const target = projects.find(item => sameId(item.id, targetId))
    return target ? { action: 'open', targetType, target } : { action: 'pending', targetType, targetId, operation: '' }
  }
  if (targetType === 'risk_issue') {
    return { action: 'pending', targetType, targetId, operation: 'risks' }
  }
  if (targetType === 'workstream') {
    const target = lookupValues.find(item => item.kind === 'workstream' && sameId(item.id, targetId))
    return target ? { action: 'open', targetType, target } : { action: 'pending', targetType, targetId }
  }
  if (targetType === 'screen_share_session') {
    return { action: 'pending', targetType, targetId }
  }
  return { action: 'destination', targetType, destination: notificationDestinations[targetType] }
}
