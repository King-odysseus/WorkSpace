import { afterEach, describe, expect, it, vi } from 'vitest'

// The interesting behaviour here is all in the service worker handshake, so the
// tests drive fake worker/registration objects rather than a real worker. Module
// state (the waiting worker, the "already reloaded" guard) is per-import, hence
// the resetModules + dynamic import in loadModule.

function fakeWorker() {
  const worker = new EventTarget()
  worker.state = 'installing'
  worker.postMessage = vi.fn()
  return worker
}

function fakeRegistration({ waiting = null } = {}) {
  const registration = new EventTarget()
  registration.waiting = waiting
  registration.installing = null
  registration.update = vi.fn(async () => {})
  return registration
}

let reload

async function loadModule({ registration, controller = {} }) {
  const container = new EventTarget()
  container.controller = controller
  container.register = vi.fn(async () => registration)
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true })

  reload = vi.fn()
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true })

  vi.resetModules()
  const module = await import('./app-updates.js')
  return { module, container }
}

afterEach(() => {
  delete navigator.serviceWorker
})

describe('app update detection', () => {
  it('offers a worker that was already waiting from an earlier visit', async () => {
    const registration = fakeRegistration({ waiting: fakeWorker() })
    const { module } = await loadModule({ registration })
    const listener = vi.fn()

    module.subscribeToAppUpdates(listener)
    module.startAppUpdateWatch()

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(true))
  })

  it('stays quiet on a first install, which is the current version and not an update', async () => {
    const registration = fakeRegistration({ waiting: fakeWorker() })
    const { module } = await loadModule({ registration, controller: null })
    const listener = vi.fn()

    module.subscribeToAppUpdates(listener)
    module.startAppUpdateWatch()

    await vi.waitFor(() => expect(registration.update).not.toHaveBeenCalled())
    expect(listener).not.toHaveBeenCalled()
  })

  it('offers a new build that finishes installing while the app is open', async () => {
    const registration = fakeRegistration()
    const { module } = await loadModule({ registration })
    const listener = vi.fn()

    module.subscribeToAppUpdates(listener)
    module.startAppUpdateWatch()
    await vi.waitFor(() => expect(navigator.serviceWorker.register).toHaveBeenCalled())

    const installing = fakeWorker()
    registration.installing = installing
    registration.dispatchEvent(new Event('updatefound'))
    expect(listener).not.toHaveBeenCalled()

    installing.state = 'installed'
    installing.dispatchEvent(new Event('statechange'))

    expect(listener).toHaveBeenCalledWith(true)
  })

  it('hands over to the waiting worker and reloads once it takes control', async () => {
    const waiting = fakeWorker()
    const registration = fakeRegistration({ waiting })
    const { module, container } = await loadModule({ registration })

    module.startAppUpdateWatch()
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    module.applyAppUpdate()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()

    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)

    // A second handover event must not send the page round again.
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload when a worker claims the page without being asked', async () => {
    const registration = fakeRegistration()
    const { module, container } = await loadModule({ registration, controller: null })

    module.startAppUpdateWatch()
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled())

    container.dispatchEvent(new Event('controllerchange'))

    expect(reload).not.toHaveBeenCalled()
  })
})
