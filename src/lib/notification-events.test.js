import { afterEach, expect, it, vi } from 'vitest'
import { announceNotificationChange, NOTIFICATION_CHANGE_EVENT, startNotificationChangeBridge } from './notification-events.js'

const cleanups = []
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop())
  window.localStorage.clear()
  vi.restoreAllMocks()
})

it('announces notification changes locally and for other same-origin windows', () => {
  const listener = vi.fn()
  const postMessage = vi.spyOn(window.BroadcastChannel.prototype, 'postMessage')
  window.addEventListener(NOTIFICATION_CHANGE_EVENT, listener)
  cleanups.push(() => window.removeEventListener(NOTIFICATION_CHANGE_EVENT, listener))

  announceNotificationChange('activity-read')

  expect(listener).toHaveBeenCalledOnce()
  expect(listener.mock.calls[0][0].detail).toEqual({ source: 'activity-read' })
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'activity-read' }))
})

it('bridges a notification change received from another window', () => {
  const listener = vi.fn()
  window.addEventListener(NOTIFICATION_CHANGE_EVENT, listener)
  cleanups.push(() => window.removeEventListener(NOTIFICATION_CHANGE_EVENT, listener))
  cleanups.push(startNotificationChangeBridge())

  window.dispatchEvent(new StorageEvent('storage', {
    key: 'workspace-notifications-revision',
    newValue: JSON.stringify({ type: NOTIFICATION_CHANGE_EVENT, source: 'other-window' }),
  }))

  expect(listener).toHaveBeenCalledOnce()
})
