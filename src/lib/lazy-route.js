import { lazy } from 'react'

// A route view that survives a deploy.
//
// The route views are fetched on demand, and the file each one asks for is
// named by a content hash of the build. A reader who has the app open when a
// new build goes out is holding the old names, so asking for a view can fail
// with a chunk that no longer exists - through no fault of theirs and with
// nothing they could have done about it.
//
// One reload gets them onto the new build, which is what they need. The marker
// in sessionStorage is what stops that becoming a loop: if the import fails for
// some other reason - a flaky connection, a server error - the second attempt
// throws and the reader sees the shell's error boundary instead of a page that
// reloads for ever.
// Separated from lazy() so the interesting part - what happens when the import
// fails - can be tested without rendering a React tree. lazy() is a thin
// wrapper around this.
export async function loadRouteChunk(name, load) {
  const marker = `workspace-chunk-reload:${name}`
  try {
    const module = await load()
    sessionStorage.removeItem(marker)
    return module
  } catch (error) {
    if (!sessionStorage.getItem(marker)) {
      sessionStorage.setItem(marker, '1')
      window.location.reload()
      // Never settles: the page is on its way out, and a resolved promise would
      // flash the view in the moment before it does.
      await new Promise(() => {})
    }
    throw error
  }
}

export function lazyRoute(name, load) {
  return lazy(() => loadRouteChunk(name, load))
}
