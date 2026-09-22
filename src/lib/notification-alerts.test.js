import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startNotificationAlerts } from './notification-alerts.js'

let stop, summary, worker, playSound
beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'WorkSpace'
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  summary = { unread_count: 25, latest_unread_id: 25, latest_notification_id: 25 }
  playSound = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => summary })))
  worker = new EventTarget()
  vi.stubGlobal('navigator', { setAppBadge: vi.fn().mockResolvedValue(), clearAppBadge: vi.fn().mockResolvedValue(), serviceWorker: worker })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); delete document.visibilityState })

it('baselines history and plays the selected sound for a new focused alert', async () => {
  stop = startNotificationAlerts(() => {}, playSound)
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenCalledWith(25)
  expect(playSound).not.toHaveBeenCalled()
  summary = { unread_count: 26, latest_unread_id: 26, latest_notification_id: 26, sound: true, sound_name: 'bell', volume: 35 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(document.title).toBe('(26) WorkSpace')
  expect(playSound).toHaveBeenCalledOnce()
  expect(playSound).toHaveBeenCalledWith('bell', 35)
  summary = { unread_count: 26, latest_unread_id: 26, latest_notification_id: 26, sound: true, sound_name: 'bell', volume: 35 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(playSound).toHaveBeenCalledOnce()
  summary = { unread_count: 27, latest_unread_id: 27, latest_notification_id: 27, sound: false, sound_name: 'pulse', volume: 80 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(playSound).toHaveBeenCalledOnce()
  summary = { unread_count: 0, latest_unread_id: 0, latest_notification_id: 27 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(navigator.clearAppBadge).toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})

it.each([
  ['minimized', 'hidden', true],
  ['visible but backgrounded', 'visible', false],
])('updates badges but does not play custom audio when %s', async (_, visibilityState, focused) => {
  stop = startNotificationAlerts(() => {}, playSound)
  await vi.advanceTimersByTimeAsync(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibilityState })
  document.hasFocus.mockReturnValue(focused)
  summary = { unread_count: 26, latest_unread_id: 26, latest_notification_id: 26, sound: true, sound_name: 'pulse', volume: 80 }
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'NOTIFICATIONS_CHANGED' } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(26)
  expect(playSound).not.toHaveBeenCalled()
})

it('asks listeners to re-read the notification list when a new one arrives', async () => {
  const onChanged = vi.fn()
  window.addEventListener('workspace:notifications-changed', onChanged)
  stop = startNotificationAlerts(() => {}, playSound)
  await vi.advanceTimersByTimeAsync(0)
  expect(onChanged).not.toHaveBeenCalled()
  summary = { unread_count: 26, latest_unread_id: 26, latest_notification_id: 26 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(onChanged).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(15000)
  expect(onChanged).toHaveBeenCalledOnce()
  summary = { unread_count: 0, latest_unread_id: 0, latest_notification_id: 26 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(onChanged).toHaveBeenCalledOnce()
  window.removeEventListener('workspace:notifications-changed', onChanged)
})

it('fetches a fresh summary after a change arrives during an in-flight refresh', async () => {
  let resolveFirst
  fetch.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ unread_count: 0, latest_unread_id: 0, latest_notification_id: 27 }) })
  stop = startNotificationAlerts(() => {}, playSound)
  await vi.advanceTimersByTimeAsync(0)
  expect(fetch).toHaveBeenCalledTimes(1)

  window.dispatchEvent(new Event('workspace:notifications-changed'))
  expect(fetch).toHaveBeenCalledTimes(1)

  resolveFirst({ ok: true, json: async () => summary })
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)

  expect(fetch).toHaveBeenCalledTimes(2)
  expect(document.title).toBe('WorkSpace')
  expect(navigator.clearAppBadge).toHaveBeenCalled()
})

it('ignores an outstanding response after logout and cleans up sound and badge', async () => {
  let resolve
  fetch.mockReturnValue(new Promise(done => { resolve = done }))
  stop = startNotificationAlerts(() => {}, playSound)
  stop(); stop = undefined
  resolve({ ok: true, json: async () => summary })
  await vi.advanceTimersByTimeAsync(30000)
  expect(navigator.setAppBadge).not.toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})

it('asks the app to re-authenticate when the notification session expires', async () => {
  const authRequired = vi.fn()
  fetch.mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({ error: 'Authentication is required.' }) })
  window.addEventListener('workspace:auth-required', authRequired)
  try {
    stop = startNotificationAlerts(() => {}, playSound)
    await vi.advanceTimersByTimeAsync(0)
    expect(authRequired).toHaveBeenCalledOnce()
    expect(navigator.setAppBadge).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('workspace:auth-required', authRequired)
  }
})

it('plays an arrival even when it was read before the next poll', async () => {
  summary = { unread_count: 0, latest_unread_id: 0, latest_notification_id: 25 }
  stop = startNotificationAlerts(() => {}, playSound)
  await vi.advanceTimersByTimeAsync(0)
  summary = { unread_count: 0, latest_unread_id: 0, latest_notification_id: 26, sound: true, sound_name: 'pop', volume: 60 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(playSound).toHaveBeenCalledOnce()
  expect(playSound).toHaveBeenCalledWith('pop', 60)
})

it('primes the audio context once on a user gesture', async () => {
  const primeAudio = vi.fn().mockResolvedValue(true)
  stop = startNotificationAlerts(() => {}, playSound, primeAudio)
  await vi.advanceTimersByTimeAsync(0)
  document.dispatchEvent(new Event('pointerdown'))
  await vi.advanceTimersByTimeAsync(0)
  expect(primeAudio).toHaveBeenCalledOnce()
  document.dispatchEvent(new Event('keydown'))
  await vi.advanceTimersByTimeAsync(0)
  expect(primeAudio).toHaveBeenCalledOnce()
})

it('opens a notification stream and reconnects from the newest notification ID', async () => {
  class FakeEventSource {
    static instances = []
    constructor(url) { this.url = url; this.close = vi.fn(); FakeEventSource.instances.push(this) }
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  const onSummary = vi.fn()
  stop = startNotificationAlerts(onSummary, playSound)
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeEventSource.instances[0].url).toContain('since=0')
  FakeEventSource.instances[0].onmessage({ data: JSON.stringify({ unread_count: 26, latest_unread_id: 26, latest_notification_id: 26 }) })
  expect(onSummary).toHaveBeenLastCalledWith({ unread_count: 26, latest_unread_id: 26, latest_notification_id: 26 })
  expect(FakeEventSource.instances.at(-1).url).toContain('since=26')
  expect(FakeEventSource.instances.at(-1).url).toContain('unread=26')
})
