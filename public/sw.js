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
// CACHE_VERSION must be bumped whenever this file's caching *behaviour* changes,
// so returning visitors pick up the new logic instead of an old worker's cache.
const CACHE_VERSION = 'workspace-v2'
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
      await self.skipWaiting()
    })()
  )
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
