import { useEffect, useState } from 'react'
import { savePushSubscription, urlBase64ToUint8Array } from '../lib/push-subscriptions.js'

export default function NotificationPermissionPrompt({ unreadCount }) {
  const supported = 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator
  const [status, setStatus] = useState(supported ? 'checking' : 'unsupported')
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supported) return
    let current = true
    const check = async () => {
      try {
        const response = await fetch('/api/push/public-key/', { credentials: 'include' })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Notification setup could not be checked.')
        if (!current) return
        setConfig(data)
        setError('')
        if (Notification.permission === 'denied') return setStatus('blocked')
        if (!data.configured) return setStatus('unconfigured')
        if (Notification.permission !== 'granted') return setStatus('off')
        const registration = await navigator.serviceWorker.getRegistration('/')
        const subscription = await registration?.pushManager.getSubscription()
        if (subscription) {
          const key = new Uint8Array(subscription.options?.applicationServerKey || [])
          const expected = urlBase64ToUint8Array(data.public_key)
          if (key.length !== expected.length || !key.every((value, i) => value === expected[i])) {
            if (current) setStatus('off')
            return
          }
          await savePushSubscription(subscription)
        }
        if (current) setStatus(subscription ? 'enabled' : 'off')
      } catch (failure) {
        if (current) { setStatus('error'); setError(failure.message) }
      }
    }
    check()
    window.addEventListener('focus', check)
    window.addEventListener('workspace:push-changed', check)
    return () => {
      current = false
      window.removeEventListener('focus', check)
      window.removeEventListener('workspace:push-changed', check)
    }
  }, [supported])
  const enable = async () => {
    setBusy(true)
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setStatus(permission === 'denied' ? 'blocked' : 'off'); return }
      // Explicit registration also supports local development and surfaces a
      // failed worker install instead of waiting forever on serviceWorker.ready.
      await navigator.serviceWorker.register('/sw.js')
      let timeout
      let registration
      try {
        registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => { timeout = window.setTimeout(() => reject(new Error('Notification setup timed out. Please reload and try again.')), 15000) }),
        ])
      } finally { window.clearTimeout(timeout) }
      let subscription = await registration.pushManager.getSubscription()
      const expected = urlBase64ToUint8Array(config.public_key)
      if (subscription) {
        const key = new Uint8Array(subscription.options?.applicationServerKey || [])
        if (key.length !== expected.length || !key.every((value, i) => value === expected[i])) {
          await subscription.unsubscribe()
          subscription = null
        }
      }
      const created = !subscription
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected })
      try { await savePushSubscription(subscription) }
      catch (failure) { if (created) await subscription.unsubscribe(); throw failure }
      setStatus('enabled')
      window.dispatchEvent(new Event('workspace:push-changed'))
    } catch (failure) { setStatus('error'); setError(failure.message || 'Notifications could not be enabled.') }
    finally { setBusy(false) }
  }
  const messages = {
    checking: 'Checking notification status...',
    enabled: 'Notifications enabled on this device.',
    off: 'Allow WorkSpace to send notifications on this device, including when the app is closed.',
    blocked: 'Notifications blocked. Allow this site in your browser or device notification settings.',
    unconfigured: 'Notifications need administrator setup before this device can receive alerts.',
    unsupported: 'Push notifications are unavailable here. On iPhone or iPad, add WorkSpace to your Home Screen and open it there.',
    error: 'Notifications need attention.',
  }
  return <aside aria-label="Notification status" className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-2 text-sm text-text-secondary">
    <div><p role="status">{messages[status]} <strong>{unreadCount === null ? 'Checking unread count...' : `${unreadCount} unread across your workspaces.`}</strong></p>
      {error && <p role="alert" className="text-danger">{error}</p>}</div>
    {supported && config?.configured && ['off', 'error'].includes(status) && <button type="button" className="secondary-button" disabled={busy} onClick={enable}>{busy ? 'Enabling...' : 'Allow notifications'}</button>}
  </aside>
}
