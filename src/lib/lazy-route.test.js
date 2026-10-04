// A route view is fetched on demand, from a file named by the build's content
// hash. A reader holding the app open when a new build goes out is asking for a
// name that no longer exists, and the only thing that helps them is a reload
// onto the new build.
//
// The interesting half is the second failure. Reloading is a repair for one
// specific problem, and if the import failed for a different reason - a flaky
// connection, a server error - reloading again and again would be worse than
// showing the reader an error.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRouteChunk } from './lazy-route.js'

const failing = () => Promise.reject(new Error('Failed to fetch dynamically imported module'))
const working = () => Promise.resolve({ default: () => null })

let reload

afterEach(() => {
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

const stubReload = () => {
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
}

describe('loadRouteChunk', () => {
  it('loads normally when the build it was named in is still there', async () => {
    stubReload()

    await expect(loadRouteChunk('Something', working)).resolves.toMatchObject({ default: expect.any(Function) })
    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('workspace-chunk-reload:Something')).toBeNull()
  })

  it('reloads once when the chunk it asks for is gone', async () => {
    stubReload()

    // Deliberately not awaited: a chunk that is gone leaves the loader waiting
    // for the reload it asked for, which is the behaviour under test.
    loadRouteChunk('Gone', failing)

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    // Set before the reload is asked for, or the next attempt would reload too.
    expect(window.sessionStorage.getItem('workspace-chunk-reload:Gone')).toBe('1')
  })

  it('shows the failure rather than reloading again when it keeps failing', async () => {
    stubReload()
    window.sessionStorage.setItem('workspace-chunk-reload:StillGone', '1')

    await expect(loadRouteChunk('StillGone', failing)).rejects.toThrow('Failed to fetch')
    expect(reload).not.toHaveBeenCalled()
  })

  it('forgets the marker once a load succeeds, so a later build can reload', async () => {
    stubReload()
    window.sessionStorage.setItem('workspace-chunk-reload:Recovered', '1')

    await loadRouteChunk('Recovered', working)

    expect(window.sessionStorage.getItem('workspace-chunk-reload:Recovered')).toBeNull()
  })
})
