import { playNotificationSound, primeNotificationAudio } from './notification-sounds.js'
import { signalAuthenticationRequired } from './auth-events.js'
import { announceNotificationChange, startNotificationChangeBridge } from './notification-events.js'

// A separate lightweight poll keeps badges current without loading every workspace
// collection. Push wakes this poll immediately, including while minimized.
export async function updateAppBadge(count) {
  try {
    if (count > 0) await navigator.setAppBadge?.(count)
    else if (navigator.clearAppBadge) await navigator.clearAppBadge()
    else await navigator.setAppBadge?.(0)
  } catch (error) {
    console.warn('App badge could not be updated.', error)
  }
}

export function startNotificationAlerts(onSummary = () => {}, playSound = playNotificationSound, primeAudio = primeNotificationAudio, workspaceId = null) {
  let stopped = false
  let pending = false
  let refreshQueued = false
  let refreshSequence = 0
  let stream = null
  let streamReconnect = null
  let latestNotificationId = 0
  let latestUnreadCount = null
  let hasBaseline = false
  let lastPlayedId = 0
  let audioPrimed = false
  let audioPriming = false
  const originalTitle = document.title
  const canPlayCustomSound = () =>
    document.visibilityState === 'visible'
    && (typeof document.hasFocus !== 'function' || document.hasFocus())
  const applySummary = data => {
    const nextNotificationId = Number(data.latest_notification_id ?? data.latest_unread_id ?? 0)
    const arrived = hasBaseline && nextNotificationId > lastPlayedId
    if (arrived && data.sound !== false && canPlayCustomSound()) {
      playSound(data.sound_name || 'chime', data.volume ?? 70)
    }
    lastPlayedId = Math.max(lastPlayedId, nextNotificationId)
    // The summary and the bell both read the active workspace's activity, but
    // the bell list is fetched separately, so a new arrival still has to say so
    // or an open popout keeps showing the list it loaded with.
    if (arrived) announceNotificationChange('alert-arrival')
    latestNotificationId = nextNotificationId
    hasBaseline = true
    onSummary(data)
    applyUnreadCount(data.unread_count)
  }
  const applyUnreadCount = count => {
    const nextUnreadCount = Number(count) || 0
    latestUnreadCount = nextUnreadCount
    document.title = nextUnreadCount ? `(${nextUnreadCount}) ${originalTitle}` : originalTitle
    updateAppBadge(nextUnreadCount)
  }
  const refresh = async () => {
    if (stopped) return
    const requestSequence = ++refreshSequence
    if (pending) {
      refreshQueued = true
      return
    }
    pending = true
    try {
      const params = new URLSearchParams({ scope: 'activity' })
      if (workspaceId) params.set('workspace_id', String(workspaceId))
      const response = await fetch(`/api/notifications/summary/?${params.toString()}`, { credentials: 'include', cache: 'no-store' })
      if (response.status === 401) {
        signalAuthenticationRequired()
        return
      }
      if (!response.ok) throw new Error(`Notification summary returned ${response.status}`)
      const data = await response.json()
      if (stopped || requestSequence !== refreshSequence) return
      applySummary(data)
    } catch (error) {
      if (!stopped) console.warn('Notification alerts could not be refreshed.', error)
    } finally {
      pending = false
      if (refreshQueued && !stopped) {
        refreshQueued = false
        void refresh()
      }
    }
  }
  const openStream = () => {
    if (stopped || !window.EventSource) return
    stream?.close()
    const params = new URLSearchParams({ since: String(latestNotificationId), scope: 'activity' })
    if (workspaceId) params.set('workspace_id', String(workspaceId))
    if (latestUnreadCount !== null) params.set('unread', String(latestUnreadCount))
    stream = new EventSource(`/api/notifications/stream/?${params.toString()}`, { withCredentials: true })
    stream.onmessage = event => {
      try {
        const data = JSON.parse(event.data)
        applySummary(data)
      } catch (error) {
        console.warn('Notification stream payload could not be read.', error)
      }
      openStream()
    }
    stream.onerror = () => {
      stream?.close()
      if (!stopped && !streamReconnect) streamReconnect = window.setTimeout(() => { streamReconnect = null; openStream() }, 15000)
    }
  }
  const onMessage = event => {
    if (event.data?.type === 'NOTIFICATIONS_CHANGED') refresh()
  }
  const onNotificationChange = event => {
    if (event.detail?.source === 'alert-arrival') return
    const unreadCount = Number(event.detail?.unreadCount)
    // A successful mark-read request is authoritative. Apply its count now so
    // a failed or delayed summary refresh cannot leave a stale title or badge.
    if (Number.isFinite(unreadCount)) applyUnreadCount(unreadCount)
    else refresh()
  }
  const removeAudioUnlockListeners = () => {
    document.removeEventListener('pointerdown', unlockAudio, true)
    document.removeEventListener('keydown', unlockAudio, true)
    document.removeEventListener('touchstart', unlockAudio, true)
  }
  const unlockAudio = () => {
    if (audioPrimed || audioPriming) return
    audioPriming = true
    let result
    try {
      result = primeAudio()
    } catch {
      audioPriming = false
      return
    }
    Promise.resolve(result).then(
      ready => { audioPrimed = Boolean(ready) },
      () => {},
    ).finally(() => {
      audioPriming = false
      if (audioPrimed) removeAudioUnlockListeners()
    })
  }
  document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true })
  document.addEventListener('keydown', unlockAudio, true)
  document.addEventListener('touchstart', unlockAudio, { capture: true, passive: true })
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('workspace:notifications-changed', onNotificationChange)
  const stopNotificationChangeBridge = startNotificationChangeBridge()
  navigator.serviceWorker?.addEventListener('message', onMessage)
  const timer = window.setInterval(refresh, 15000)
  refresh()
  openStream()
  return () => {
    stopped = true
    window.clearInterval(timer)
    if (streamReconnect) window.clearTimeout(streamReconnect)
    stream?.close()
    removeAudioUnlockListeners()
    document.removeEventListener('visibilitychange', refresh)
    window.removeEventListener('workspace:notifications-changed', onNotificationChange)
    stopNotificationChangeBridge()
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    document.title = originalTitle
    updateAppBadge(0)
  }
}
