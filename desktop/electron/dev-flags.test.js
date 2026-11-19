'use strict'

/*
 * Checks for the packaged-versus-development switch rules.
 *
 * The point of these tests is the packaged case: a development flag must never
 * open a window or run script in a build a person installs, and the only input
 * that decides that is Electron's `isPackaged`, not the argument list.
 *
 *   cd desktop && node --test electron/dev-flags.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { DEV_FLAGS, resolveDevFlags, shouldOpenProbeView } = require('./dev-flags.js')

test('development builds honour the smoke and probe switches', () => {
  const flags = resolveDevFlags({
    isPackaged: false,
    argv: ['electron', '.', DEV_FLAGS.shellSmoke, DEV_FLAGS.probeView],
  })

  assert.equal(flags.allowed, true)
  assert.equal(flags.shellSmoke, true)
  assert.equal(flags.smokeTest, false)
  assert.deepEqual(flags.ignored, [])
})

test('a packaged build ignores every development switch and reports it', () => {
  const flags = resolveDevFlags({
    isPackaged: true,
    argv: ['app', DEV_FLAGS.smokeTest, DEV_FLAGS.shellSmoke, DEV_FLAGS.probeViewSmoke],
  })

  assert.equal(flags.allowed, false)
  assert.equal(flags.smokeTest, false)
  assert.equal(flags.shellSmoke, false)
  assert.equal(flags.probeViewSmoke, false)
  assert.deepEqual(flags.ignored.sort(), ['probeViewSmoke', 'shellSmoke', 'smokeTest'])
})

test('missing arguments mean no switches, not an error', () => {
  const flags = resolveDevFlags({ isPackaged: false })
  assert.equal(flags.shellSmoke, false)
  assert.deepEqual(flags.ignored, [])
})

test('the probe view opens only when a development build asks for it', () => {
  assert.equal(shouldOpenProbeView({ isPackaged: false, argv: ['app', DEV_FLAGS.probeView] }), true)
  assert.equal(shouldOpenProbeView({ isPackaged: false, argv: ['app'] }), false)
  assert.equal(shouldOpenProbeView({ isPackaged: true, argv: ['app', DEV_FLAGS.probeView] }), false)
})

test('--no-probe-view wins over --probe-view', () => {
  assert.equal(shouldOpenProbeView({
    isPackaged: false,
    argv: ['app', DEV_FLAGS.probeView, DEV_FLAGS.noProbeView],
  }), false)
})
