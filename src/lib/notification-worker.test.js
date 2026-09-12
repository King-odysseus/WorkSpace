import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'

it.each([
  ['focused visible', 'visible', true],
  ['visible but backgrounded', 'visible', false],
  ['minimized', 'hidden', false],
])('plays the enabled native sound and updates the badge with a %s app', async (_, visibilityState, focused) => {
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
  expect(self.registration.showNotification).toHaveBeenCalledWith('New message', expect.objectContaining({ silent: false, requireInteraction: false }))
  expect(client.postMessage).toHaveBeenCalledWith({ type: 'NOTIFICATIONS_CHANGED' })
})

it('silences a notification only when the user disabled notification sound', async () => {
  const handlers = {}
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([]) },
    navigator: {},
    registration: { showNotification: vi.fn().mockResolvedValue() },
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ unread_count: 0 }) }), console, URL })
  let work
  handlers.push({ data: { json: () => ({ title: 'Quiet update', sound: false }) }, waitUntil: promise => { work = promise } })
  await work
  expect(self.registration.showNotification).toHaveBeenCalledWith('Quiet update', expect.objectContaining({ silent: true }))
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
  expect(self.registration.showNotification).toHaveBeenCalledWith('New message', expect.objectContaining({ silent: false, requireInteraction: false }))
})

it('sends an already open window to the record instead of only focusing it', async () => {
  const handlers = {}
  const client = { postMessage: vi.fn(), focus: vi.fn().mockResolvedValue() }
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([client]), openWindow: vi.fn() },
    navigator: {},
    registration: { showNotification: vi.fn() },
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch: vi.fn(), console, URL })
  const url = '/?notification=7&target_type=task&target_id=42'
  let work
  handlers.notificationclick({ notification: { close: vi.fn(), data: { url } }, waitUntil: promise => { work = promise } })
  await work
  expect(client.focus).toHaveBeenCalled()
  expect(client.postMessage).toHaveBeenCalledWith({ type: 'OPEN_NOTIFICATION', url })
  expect(self.clients.openWindow).not.toHaveBeenCalled()
})

it('opens a new window at the deep link when the app is closed', async () => {
  const handlers = {}
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn() },
    navigator: {},
    registration: { showNotification: vi.fn() },
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch: vi.fn(), console, URL })
  let work
  handlers.notificationclick({ notification: { close: vi.fn(), data: { url: '/?notification=7' } }, waitUntil: promise => { work = promise } })
  await work
  expect(self.clients.openWindow).toHaveBeenCalledWith('/?notification=7')
})

it('falls back to the shell when a push carried no url', async () => {
  const handlers = {}
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler },
    clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn() },
    navigator: {},
    registration: { showNotification: vi.fn() },
  }
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, fetch: vi.fn(), console, URL })
  let work
  handlers.notificationclick({ notification: { close: vi.fn(), data: {} }, waitUntil: promise => { work = promise } })
  await work
  expect(self.clients.openWindow).toHaveBeenCalledWith('/')
})
