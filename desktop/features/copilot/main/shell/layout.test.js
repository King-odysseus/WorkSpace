'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const shell = require('../../../../build/main/ipc.cjs')

/*
 * The geometry is the acceptance criterion the eye cannot check: "docking works
 * across window resizing" means these rectangles stay consistent at every width.
 * The test resizes the window virtually instead of scaling a real one.
 */
function layoutAt (width, height, mode, dockOpen) {
  return shell.computeShellLayout({ width, height, mode, dockOpen })
}

test('workspace mode gives the whole content area to the web app', () => {
  const layout = layoutAt(1440, 900, 'workspace', false)

  assert.deepEqual(layout.web, {
    x: shell.RAIL_WIDTH,
    y: shell.TITLE_BAR_HEIGHT,
    width: 1440 - shell.RAIL_WIDTH,
    height: 900 - shell.TITLE_BAR_HEIGHT,
  })
  assert.equal(layout.copilot, null)
  assert.equal(layout.docked, false)
  assert.deepEqual(layout.chrome, { x: 0, y: 0, width: 1440, height: 900 })
})

test('docking narrows the web app and puts a 360px panel against the right edge', () => {
  const layout = layoutAt(1440, 900, 'workspace', true)

  assert.equal(layout.docked, true)
  assert.equal(layout.copilot.width, shell.DOCK_WIDTH)
  assert.equal(layout.copilot.x + layout.copilot.width, 1440, 'the dock ends at the window edge')
  assert.equal(layout.web.width, 1440 - shell.RAIL_WIDTH - shell.DOCK_WIDTH)
  assert.equal(layout.web.x + layout.web.width, layout.copilot.x, 'the views meet, they do not overlap')
  assert.equal(layout.copilot.y, shell.TITLE_BAR_HEIGHT)
})

test('assistant mode takes the content area and ignores a stale dock flag', () => {
  for (const dockOpen of [true, false]) {
    const layout = layoutAt(1280, 820, 'copilot', dockOpen)
    assert.equal(layout.docked, false)
    assert.equal(layout.web, null, 'the web app is hidden, not destroyed')
    assert.deepEqual(layout.copilot, {
      x: shell.RAIL_WIDTH,
      y: shell.TITLE_BAR_HEIGHT,
      width: 1280 - shell.RAIL_WIDTH,
      height: 820 - shell.TITLE_BAR_HEIGHT,
    })
  }
})

test('the dock never squeezes the web app below its minimum width', () => {
  // 320 + rail leaves no spare width, so the dock gives up entirely rather than
  // becoming a sliver nobody can use.
  const tight = layoutAt(shell.RAIL_WIDTH + shell.MIN_WEB_WIDTH, 600, 'workspace', true)
  assert.equal(tight.docked, false)
  assert.equal(tight.copilot, null)
  assert.equal(tight.web.width, shell.MIN_WEB_WIDTH)

  // One pixel more and it earns a pixel of dock, still not the full 360.
  const nearly = layoutAt(shell.RAIL_WIDTH + shell.MIN_WEB_WIDTH + 40, 600, 'workspace', true)
  assert.equal(nearly.docked, true)
  assert.equal(nearly.copilot.width, 40)
  assert.equal(nearly.web.width, shell.MIN_WEB_WIDTH)
})

test('resizing from wide to narrow keeps every rectangle inside the window', () => {
  for (const width of [1920, 1440, 1366, 1024, 880, 800, 500, 76, 0]) {
    for (const mode of shell.SHELL_MODES) {
      for (const dockOpen of [true, false]) {
        const layout = layoutAt(width, 700, mode, dockOpen)
        for (const name of ['chrome', 'web', 'copilot']) {
          const rect = layout[name]
          if (!rect) continue
          assert.ok(rect.x >= 0 && rect.y >= 0, `${name} starts inside the window at ${width}`)
          assert.ok(rect.x + rect.width <= width, `${name} ends inside the window at ${width}`)
          assert.ok(rect.y + rect.height <= 700, `${name} ends inside the window at ${width}`)
        }
      }
    }
  }
})

test('a window smaller than its chrome is clipped, not negative', () => {
  const layout = layoutAt(20, 10, 'workspace', false)
  assert.deepEqual(layout.chrome, { x: 0, y: 0, width: 20, height: 10 })
  assert.equal(layout.web.width, 0)
  assert.equal(layout.web.height, 0)
})

test('a nonsensical size becomes zero rather than a broken rectangle', () => {
  const layout = layoutAt(Number.NaN, -40, 'workspace', false)
  assert.deepEqual(layout.chrome, { x: 0, y: 0, width: 0, height: 0 })
})

test('resolveDockWidth asks for 360 and settles for what is left', () => {
  assert.equal(shell.resolveDockWidth(2000), shell.DOCK_WIDTH)
  assert.equal(shell.resolveDockWidth(shell.DOCK_WIDTH + shell.MIN_WEB_WIDTH), shell.DOCK_WIDTH)
  assert.equal(shell.resolveDockWidth(shell.DOCK_WIDTH + shell.MIN_WEB_WIDTH - 1), shell.DOCK_WIDTH - 1)
  assert.equal(shell.resolveDockWidth(shell.MIN_WEB_WIDTH), 0)
  assert.equal(shell.resolveDockWidth(0), 0)
})
