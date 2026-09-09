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
  let latestId = null
  let context
  const originalTitle = document.title
  const armSound = () => {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    try {
      context ||= new AudioContext()
      if (context.state === 'suspended') context.resume().catch(error => console.warn('Notification sound could not be enabled.', error))
    } catch (error) {
      console.warn('Notification sound is unavailable.', error)
    }
  }
  const chime = () => {
    if (!context || context.state !== 'running') return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.connect(gain)
    gain.connect(context.destination)
    const now = context.currentTime
    oscillator.frequency.setValueAtTime(880, now)
    oscillator.frequency.setValueAtTime(660, now + 0.12)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.12, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
    oscillator.start(now)
    oscillator.stop(now + 0.32)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  }
  const refresh = async () => {
    if (stopped || pending) return
    pending = true
    try {
      const response = await fetch('/api/notifications/summary/', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) throw new Error(`Notification summary returned ${response.status}`)
      const data = await response.json()
      if (stopped) return
      // Baseline existing history silently. A decrease (mark read) must never
      // make an old notification sound new on the following refresh.
      if (latestId !== null && data.latest_unread_id > latestId && document.visibilityState === 'visible') chime()
      latestId = Math.max(latestId || 0, data.latest_unread_id)
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
  document.addEventListener('pointerdown', armSound)
  document.addEventListener('keydown', armSound)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('workspace:notifications-changed', refresh)
  navigator.serviceWorker?.addEventListener('message', onMessage)
  const timer = window.setInterval(refresh, 15000)
  refresh()
  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('pointerdown', armSound)
    document.removeEventListener('keydown', armSound)
    document.removeEventListener('visibilitychange', refresh)
    window.removeEventListener('workspace:notifications-changed', refresh)
    navigator.serviceWorker?.removeEventListener('message', onMessage)
    if (context) context.close().catch(error => console.warn('Notification audio could not be closed.', error))
    document.title = originalTitle
    updateAppBadge(0)
  }
}
