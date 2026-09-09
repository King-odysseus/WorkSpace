import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

it.each([
  ['focused visible', 'visible', true, true],
  ['visible but backgrounded', 'visible', false, false],
  ['minimized', 'hidden', false, false],
])('updates the service-worker badge on push with a %s app', async (_, visibilityState, focused, silent) => {
  const handlers = {}
  const client = { visibilityState, focused, postMessage: vi.fn() }
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([client]) },
    navigator: { setAppBadge: vi.fn().mockResolvedValue(), clearAppBadge: vi.fn().mockResolvedValue() },
    registration: { showNotification: vi.fn().mockResolvedValue() },
  }
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unread_count: 31 }) })
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch, console, URL })
  let work
  handlers.push({ data: { json: () => ({ title: 'New message', body: 'Hello' }) }, waitUntil: promise => { work = promise } })
  await work
  expect(self.navigator.setAppBadge).toHaveBeenCalledWith(31)
  expect(self.registration.showNotification).toHaveBeenCalledWith('New message', expect.objectContaining({ silent }))
  expect(client.postMessage).toHaveBeenCalledWith({ type: 'NOTIFICATIONS_CHANGED' })
})

it('still shows a push notification if the badge request fails with the app closed', async () => {
  const handlers = {}
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([]) },
    navigator: {},
    registration: { showNotification: vi.fn().mockResolvedValue() },
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch: vi.fn().mockRejectedValue(new Error('Offline')), console: { warn: vi.fn() }, URL })
  let work
  handlers.push({ data: { json: () => ({ title: 'New message' }) }, waitUntil: promise => { work = promise } })
  await work
  expect(self.registration.showNotification).toHaveBeenCalledWith('New message', expect.objectContaining({ silent: false }))
})
