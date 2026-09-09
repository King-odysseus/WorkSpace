import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startNotificationAlerts } from './notification-alerts.js'

let stop, summary, oscillator, audio, worker
beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'WorkSpace'
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  summary = { unread_count: 25, latest_unread_id: 25 }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => summary })))
  oscillator = { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() } }
  audio = { state: 'running', currentTime: 0, destination: {}, createOscillator: vi.fn(() => oscillator), createGain: () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }), close: vi.fn().mockResolvedValue() }
  vi.stubGlobal('AudioContext', vi.fn(function () { return audio }))
  worker = new EventTarget()
  vi.stubGlobal('navigator', { setAppBadge: vi.fn().mockResolvedValue(), clearAppBadge: vi.fn().mockResolvedValue(), serviceWorker: worker })
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); delete document.visibilityState })

it('silently baselines history, sounds once for new unread, and clears the badge after reading', async () => {
  stop = startNotificationAlerts()
  document.dispatchEvent(new Event('pointerdown'))
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenCalledWith(25)
  expect(oscillator.start).not.toHaveBeenCalled()
  summary = { unread_count: 26, latest_unread_id: 26 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(oscillator.start).toHaveBeenCalledTimes(1)
  expect(document.title).toBe('(26) WorkSpace')
  await vi.advanceTimersByTimeAsync(15000)
  expect(oscillator.start).toHaveBeenCalledTimes(1)
  summary = { unread_count: 0, latest_unread_id: 0 }
  await vi.advanceTimersByTimeAsync(15000)
  expect(navigator.clearAppBadge).toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})

it('updates minimized badges on push without duplicating the OS sound', async () => {
  stop = startNotificationAlerts()
  document.dispatchEvent(new Event('keydown'))
  await vi.advanceTimersByTimeAsync(0)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
  summary = { unread_count: 26, latest_unread_id: 26 }
  worker.dispatchEvent(new MessageEvent('message', { data: { type: 'NOTIFICATIONS_CHANGED' } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(navigator.setAppBadge).toHaveBeenLastCalledWith(26)
  expect(oscillator.start).not.toHaveBeenCalled()
})

it('ignores an outstanding response after logout and cleans up sound and badge', async () => {
  let resolve
  fetch.mockReturnValue(new Promise(done => { resolve = done }))
  stop = startNotificationAlerts()
  document.dispatchEvent(new Event('pointerdown'))
  stop(); stop = undefined
  resolve({ ok: true, json: async () => summary })
  await vi.advanceTimersByTimeAsync(30000)
  expect(navigator.setAppBadge).not.toHaveBeenCalled()
  expect(audio.close).toHaveBeenCalled()
  expect(document.title).toBe('WorkSpace')
})
