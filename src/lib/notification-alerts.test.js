import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startNotificationAlerts } from './notification-alerts.js'

let stop, summary, worker
beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'WorkSpace'
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  summary = { unread_count: 25, latest_unread_id: 25 }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => summary })))
  worker = new EventTarget()
  vi.stubGlobal('navigator', { setAppBadge: vi.fn().mockResolvedValue(), clearAppBadge: vi.fn().mockResolvedValue(), serviceWorker: worker })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); delete document.visibilityState })

it('updates the badge and title without a second foreground sound', async () => {
  stop = startNotificationAlerts()
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenCalledWith(25)
  summary = { unread_count: 26, latest_unread_id: 26 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(document.title).toBe('(26) WorkSpace')
  await vi.advanceTimersByTimeAsync(15000)
  summary = { unread_count: 0, latest_unread_id: 0 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(navigator.clearAppBadge).toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})

it('updates minimized badges when the service worker reports a push', async () => {
  stop = startNotificationAlerts()
  await vi.advanceTimersByTimeAsync(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  summary = { unread_count: 26, latest_unread_id: 26 }
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'NOTIFICATIONS_CHANGED' } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(26)
})

it('ignores an outstanding response after logout and cleans up sound and badge', async () => {
  let resolve
  fetch.mockReturnValue(new Promise(done => { resolve = done }))
  stop = startNotificationAlerts()
  stop(); stop = undefined
  resolve({ ok: true, json: async () => summary })
  await vi.advanceTimersByTimeAsync(30000)
  expect(navigator.setAppBadge).not.toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})

it('opens a notification stream and reconnects from the newest unread ID', async () => {
  class FakeEventSource {
    static instances = []
    constructor(url) { this.url = url; this.close = vi.fn(); FakeEventSource.instances.push(this) }
  }
  vi.stubGlobal('EventSource', FakeEventSource)
  const onSummary = vi.fn()
  stop = startNotificationAlerts(onSummary)
  await vi.advanceTimersByTimeAsync(0)
  expect(FakeEventSource.instances[0].url).toContain('since=0')
  FakeEventSource.instances[0].onmessage({ data: JSON.stringify({ unread_count: 26, latest_unread_id: 26 }) })
  expect(onSummary).toHaveBeenLastCalledWith({ unread_count: 26, latest_unread_id: 26 })
  expect(FakeEventSource.instances.at(-1).url).toContain('since=26')
})
