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

export function startNotificationAlerts(onSummary = () => {}) {
  let stopped = false
  let pending = false
  const originalTitle = document.title
  const refresh = async () => {
    if (stopped || pending) return
    pending = true
    try {
      const response = await fetch('/api/notifications/summary/', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) throw new Error(`Notification summary returned ${response.status}`)
      const data = await response.json()
      if (stopped) return
      // Baseline existing history silently. The service worker is the only
      // sound source, so a foreground alert cannot chime twice.
      onSummary(data)
      document.title = data.unread_count ? `(${data.unread_count}) ${originalTitle}` : originalTitle
      await updateAppBadge(data.unread_count)
    } catch (error) {
      if (!stopped) console.warn('Notification alerts could not be refreshed.', error)
    } finally {
      pending = false
    }
  }
  const onMessage = event => {
    if (event.data?.type === 'NOTIFICATIONS_CHANGED') refresh()
  }
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('workspace:notifications-changed', refresh)
  navigator.serviceWorker?.addEventListener('message', onMessage)
  const timer = window.setInterval(refresh, 15000)
  refresh()
  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
    window.removeEventListener('workspace:notifications-changed', refresh)
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    document.title = originalTitle
    updateAppBadge(0)
  }
}
