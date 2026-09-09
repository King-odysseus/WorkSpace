// Hand-written service worker (no build-time precache manifest) for WorkSpace.
//
// This is a task-management app backed by a live API, so an aggressive
// offline-first cache would risk showing stale tasks as if they were current.
// The strategy is deliberately narrow:
//   - /api/*                      never cached - always hit the network.
//   - hashed build assets         cache-first - Vite content-hashes the filename,
//                                  so a cached copy can never go stale.
//   - navigations (the app shell) network-first, falling back to the cached
//                                  shell when offline, so the app still opens
//                                  (even if the data inside is stale) instead of
//                                  showing the browser's own offline page.
//   - everything else             pass straight through to the network.
//
// BUILD_ID is replaced at build time by the stampServiceWorkerBuildId plugin in
// vite.config.js, and it is what makes updates detectable at all: the browser
// only goes looking for a new worker when /sw.js differs byte for byte from the
// installed one. With a hand-maintained version constant, a deploy that changed
// only the app bundle left this file identical, so an installed app never
// noticed the new build. The id is derived from the emitted asset names, so it
// changes exactly when the bundle does. In dev the placeholder stays as-is,
// which is harmless because the worker is only registered in production builds.
const BUILD_ID = '__BUILD_ID__'
const CACHE_VERSION = `workspace-v4-${BUILD_ID}`
const SHELL_URL = '/'

// There's no build-time precache manifest here (no vite-plugin-pwa), so the
// install step fetches the shell HTML itself and pulls the content-hashed
// script/stylesheet URLs out of it. Without this, only '/' would be cached and
// a later offline visit would load a blank page: the HTML but none of the JS
// or CSS it references.
async function shellAssetUrls() {
  const response = await fetch(SHELL_URL)
  const html = await response.clone().text()
  const urls = new Set()
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) urls.add(match[1])
  return { response, urls: [...urls] }
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION)
      const { response, urls } = await shellAssetUrls()
      await cache.put(SHELL_URL, response)
      await Promise.all(urls.map(url => cache.add(url).catch(() => {})))
    })()
  )
})

// Deliberately no skipWaiting() above: a new worker parks in the waiting state
// so the page can offer the update instead of swapping the cached assets under a
// running session (which can break a lazily loaded chunk, and discards whatever
// the user was in the middle of without asking). src/lib/app-updates.js shows
// the banner and posts this message once the user accepts.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(SHELL_URL))
    )
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(response => {
        const copy = response.clone()
        caches.open(CACHE_VERSION).then(cache => cache.put(request, copy))
        return response
      }))
    )
  }
})

// Web push: shows a native notification bubble even when the app/PWA is fully
// closed. The payload is a small JSON object set by tasks/push.py.
self.addEventListener('push', event => {
  let data = { title: 'WorkSpace', body: '' }
  try { data = { ...data, ...event.data.json() } } catch { /* use default */ }
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Native notifications are the single sound source in every app state.
    // Using the same path while visible, backgrounded, or minimized prevents
    // duplicate foreground chimes and makes the setting reliable.
    const notification = self.registration.showNotification(data.title, {
      body: data.body, icon: '/icon-192.png', silent: data.sound === false, data: { url: data.url || '/' },
    })
    const badge = (async () => {
      try {
        const response = await fetch('/api/notifications/summary/', { credentials: 'include', cache: 'no-store' })
        if (!response.ok) return
        const { unread_count } = await response.json()
        if (unread_count > 0) await self.navigator.setAppBadge?.(unread_count)
        else await self.navigator.clearAppBadge?.()
      } catch (error) {
        console.warn('Push badge could not be updated.', error)
      }
    })()
    clients.forEach(client => client.postMessage({ type: 'NOTIFICATIONS_CHANGED' }))
    await Promise.all([notification, badge])
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow(targetUrl)
    })
  )
})
