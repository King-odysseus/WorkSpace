import { playNotificationSound, primeNotificationAudio } from './notification-sounds.js'
import { signalAuthenticationRequired } from './auth-events.js'

// A separate lightweight poll keeps badges current without loading every workspace
// collection. Push wakes this poll immediately, including while minimized.
export async function updateAppBadge(count) {
  try {
    if (count > 0) await navigator.setAppBadge?.(count)
    else await navigator.clearAppBadge?.()
  } catch (error) {
    console.warn('App badge could not be updated.', error)
  }
}

export function startNotificationAlerts(onSummary = () => {}, playSound = playNotificationSound, primeAudio = primeNotificationAudio) {
  let stopped = false
  let pending = false
  let stream = null
  let streamReconnect = null
  let latestNotificationId = 0
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
    // This poll reads an account-wide count, but the bell reads one workspace's
    // history and is fetched separately, so a new arrival has to say so or the
    // open popout keeps showing the list it loaded with.
    if (arrived) window.dispatchEvent(new Event('workspace:notifications-changed'))
    latestNotificationId = nextNotificationId
    hasBaseline = true
    onSummary(data)
    document.title = data.unread_count ? `(${data.unread_count}) ${originalTitle}` : originalTitle
    updateAppBadge(data.unread_count)
  }
  const refresh = async () => {
    if (stopped || pending) return
    pending = true
    try {
      const response = await fetch('/api/notifications/summary/', { credentials: 'include', cache: 'no-store' })
      if (response.status === 401) {
        signalAuthenticationRequired()
        return
      }
      if (!response.ok) throw new Error(`Notification summary returned ${response.status}`)
      const data = await response.json()
      if (stopped) return
      applySummary(data)
    } catch (error) {
      if (!stopped) console.warn('Notification alerts could not be refreshed.', error)
    } finally {
      pending = false
    }
  }
  const openStream = () => {
    if (stopped || !window.EventSource) return
    stream?.close()
    stream = new EventSource(`/api/notifications/stream/?since=${latestNotificationId}`, { withCredentials: true })
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
  window.addEventListener('workspace:notifications-changed', refresh)
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
    window.removeEventListener('workspace:notifications-changed', refresh)
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    document.title = originalTitle
    updateAppBadge(0)
  }
}
