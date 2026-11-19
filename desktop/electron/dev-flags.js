'use strict'

/*
 * The command-line switches that exist to make the boundary testable.
 *
 * Each one either opens a window that carries the signed-in session or runs
 * script inside a page: the shell smoke drives the real window, the probe smoke
 * drives the Phase 0 bridge, and --smoke-test proves a page loads. None of that
 * belongs in a build a person installs, so a packaged app ignores them outright
 * rather than trusting a shortcut not to pass them.
 *
 * `isPackaged` comes from Electron, never from the argument list, so a flag
 * cannot talk its way past the check.
 */

const DEV_FLAGS = Object.freeze({
  smokeTest: '--smoke-test',
  shellSmoke: '--shell-smoke',
  probeViewSmoke: '--probe-view-smoke',
  probeView: '--probe-view',
  noProbeView: '--no-probe-view',
})

function hasFlag (argv, flag) {
  return Array.isArray(argv) && argv.includes(flag)
}

/**
 * Which development switches this launch honours, and which it refused.
 *
 * `ignored` is the caller's chance to say so out loud: a flag that does nothing
 * silently is a bug report waiting to happen.
 */
function resolveDevFlags (options = {}) {
  const argv = options.argv || []
  const allowed = options.isPackaged !== true
  const requested = Object.entries(DEV_FLAGS)
    .filter(([, flag]) => hasFlag(argv, flag))
    .map(([name]) => name)

  return {
    allowed,
    smokeTest: allowed && hasFlag(argv, DEV_FLAGS.smokeTest),
    shellSmoke: allowed && hasFlag(argv, DEV_FLAGS.shellSmoke),
    probeViewSmoke: allowed && hasFlag(argv, DEV_FLAGS.probeViewSmoke),
    ignored: allowed ? [] : requested,
  }
}

/**
 * Whether to open the throwaway debug view.
 *
 * It shares the web view's session, so the packaged answer is always no,
 * whatever the argument list says.
 */
function shouldOpenProbeView (options = {}) {
  const argv = options.argv || []
  if (options.isPackaged === true) return false
  if (hasFlag(argv, DEV_FLAGS.noProbeView)) return false
  return hasFlag(argv, DEV_FLAGS.probeView)
}

module.exports = { DEV_FLAGS, resolveDevFlags, shouldOpenProbeView }
