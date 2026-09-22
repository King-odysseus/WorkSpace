// Tells a running WorkSpace window when a newer build has been deployed.
//
// This matters most for the installed app. A browser tab picks up a deploy on
// its next navigation, but an installed WorkSpace window is opened once and left
// running for days, so without a prompt it keeps serving the bundle it started
// with long after the server moved on.
//
// The handoff is the standard service worker one:
//   1. A deploy publishes a new /sw.js (stamped with a fresh build id by the
//      plugin in vite.config.js). The browser installs it in the background and
//      parks it in the "waiting" state, because public/sw.js no longer calls
//      skipWaiting() on its own.
//   2. We spot the waiting worker and hand it to the banner.
//   3. The user accepts, we post SKIP_WAITING, the new worker activates and
//      claims the page, and controllerchange tells us the reload is safe.

// An installed window can outlive several deploys without ever navigating, so
// poll rather than waiting for a page load that may never come.
const POLL_INTERVAL_MS = 15 * 60 * 1000
// Re-checking on every tab focus would hammer the server for someone switching
// windows constantly, so a foreground check only counts after this long.
const MIN_RECHECK_INTERVAL_MS = 5 * 60 * 1000
// If the waiting worker does not take over in this long (it was already
// activated, or the message was lost), reload anyway so the button is never a
// dead end.
const ACTIVATION_TIMEOUT_MS = 4000
// A hard refresh should not hang indefinitely waiting for a slow update check.
// If the worker has not finished installing by this point, reload the build the
// browser already has; the new worker will remain available on the next visit.
const UPDATE_CHECK_TIMEOUT_MS = 4000

const listeners = new Set()
let waitingWorker = null
let updateRequested = false
let reloaded = false
let lastCheckedAt = 0
let controllerChangeWatching = false

function announce(worker) {
  if (!worker || worker === waitingWorker) return
  waitingWorker = worker
  listeners.forEach(listener => listener(true))
}

function reloadOnce() {
  if (reloaded) return
  reloaded = true
  window.location.reload()
}

function ensureControllerChangeWatch() {
  if (controllerChangeWatching || !('serviceWorker' in navigator)) return
  controllerChangeWatching = true
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // This also fires the first time any worker claims the page, which is the
    // initial install rather than an update, so only reload for one we asked for.
    if (updateRequested) reloadOnce()
  })
}

function waitForWorkerInstall(worker) {
  if (!worker || worker.state === 'installed' || worker.state === 'redundant') {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      worker.removeEventListener('statechange', onStateChange)
      resolve()
    }
    const onStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'redundant') finish()
    }
    const timeout = window.setTimeout(finish, UPDATE_CHECK_TIMEOUT_MS)
    worker.addEventListener('statechange', onStateChange)
  })
}

async function checkForHardRefresh(registration) {
  let installing = registration.installing
  const onUpdateFound = () => {
    installing = registration.installing
  }

  registration.addEventListener('updatefound', onUpdateFound)
  try {
    await registration.update()
  } catch {
    // The current bundle is still the best available response while offline.
  } finally {
    registration.removeEventListener('updatefound', onUpdateFound)
  }

  installing ||= registration.installing
  await waitForWorkerInstall(installing)

  // Only replace the page with a worker that is actually parked and ready. A
  // first install does not have a controller, and reloading is enough there.
  if (registration.waiting && navigator.serviceWorker.controller) {
    announce(registration.waiting)
    applyAppUpdate()
    return
  }

  reloadOnce()
}

/**
 * Subscribe to "a newer version is ready" transitions. The listener is called
 * with `true` when an update is waiting, including immediately on subscribe if
 * one is already waiting. Returns an unsubscribe function.
 */
export function subscribeToAppUpdates(listener) {
  listeners.add(listener)
  if (waitingWorker) listener(true)
  return () => listeners.delete(listener)
}

/** Hand over to the waiting worker and reload onto the new build. */
export function applyAppUpdate() {
  if (!waitingWorker || updateRequested) return
  updateRequested = true
  ensureControllerChangeWatch()
  waitingWorker.postMessage({ type: 'SKIP_WAITING' })
  window.setTimeout(reloadOnce, ACTIVATION_TIMEOUT_MS)
}

/**
 * Reload onto the newest build. If a service worker update is already waiting,
 * use the same activation handshake as the update banner. Otherwise check once
 * for a newer worker and reload when that check settles.
 */
export async function hardRefreshApp() {
  if (reloaded || updateRequested) return

  if (waitingWorker) {
    applyAppUpdate()
    return
  }

  if (
    !('serviceWorker' in navigator) ||
    !navigator.serviceWorker.controller ||
    typeof navigator.serviceWorker.getRegistration !== 'function'
  ) {
    reloadOnce()
    return
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) {
      reloadOnce()
      return
    }
    await checkForHardRefresh(registration)
  } catch {
    reloadOnce()
  }
}

/** Register the worker and start watching for newer builds. */
export function startAppUpdateWatch() {
  if (!('serviceWorker' in navigator)) return

  ensureControllerChangeWatch()

  navigator.serviceWorker.register('/sw.js').then(registration => {
    // A worker parked by an earlier visit is already waiting before any event
    // fires. Without a controller this is a first install, not an update.
    if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting)

    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) announce(installing)
      })
    })

    const checkForUpdate = () => {
      const now = Date.now()
      if (now - lastCheckedAt < MIN_RECHECK_INTERVAL_MS) return
      lastCheckedAt = now
      registration.update().catch(() => {
        // Offline, or the server is briefly unreachable. The next check retries.
      })
    }
    lastCheckedAt = Date.now()
    window.setInterval(checkForUpdate, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate()
    })
  }).catch(error => {
    console.warn('Service worker registration failed.', error)
  })
}
