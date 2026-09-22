export const NOTIFICATION_CHANGE_EVENT = 'workspace:notifications-changed'

const CHANNEL_NAME = 'workspace-notifications'
const STORAGE_KEY = 'workspace-notifications-revision'

let notificationChannel
let channelInitialized = false

function getNotificationChannel() {
  if (channelInitialized) return notificationChannel
  channelInitialized = true
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return null
  try {
    notificationChannel = new window.BroadcastChannel(CHANNEL_NAME)
  } catch {
    notificationChannel = null
  }
  return notificationChannel
}

function publishCrossWindowChange(source) {
  if (typeof window === 'undefined') return
  const message = { type: NOTIFICATION_CHANGE_EVENT, source, at: Date.now() }
  let delivered = false
  try {
    if (getNotificationChannel()) {
      notificationChannel.postMessage(message)
      delivered = true
    }
  } catch {
    // Some privacy modes expose BroadcastChannel but refuse to create or use it.
  }
  if (delivered) return
  try {
    // Storage events are a same-origin fallback when BroadcastChannel is absent.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(message))
  } catch {
    // Notification state still refreshes in this window when storage is blocked.
  }
}

export function announceNotificationChange(source = 'client') {
  if (typeof window === 'undefined') return
  publishCrossWindowChange(source)
  window.dispatchEvent(new CustomEvent(NOTIFICATION_CHANGE_EVENT, { detail: { source } }))
}

export function startNotificationChangeBridge() {
  if (typeof window === 'undefined') return () => {}
  const channel = getNotificationChannel()
  const receiveChange = () => window.dispatchEvent(new Event(NOTIFICATION_CHANGE_EVENT))
  const handleChannelMessage = event => {
    if (event?.data?.type === NOTIFICATION_CHANGE_EVENT) receiveChange()
  }
  const handleStorage = event => {
    if (event.key === STORAGE_KEY && event.newValue) receiveChange()
  }
  channel?.addEventListener('message', handleChannelMessage)
  window.addEventListener('storage', handleStorage)
  return () => {
    channel?.removeEventListener('message', handleChannelMessage)
    window.removeEventListener('storage', handleStorage)
  }
}
