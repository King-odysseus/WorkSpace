'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const shell = require('../../../../build/main/ipc.cjs')

const FACTS = { maximized: false, theme: 'light', platform: 'win32' }

test('a new session starts in workspace mode with the dock closed', () => {
  assert.deepEqual(shell.createShellSession(), { mode: 'workspace', dockOpen: false })
  assert.deepEqual(shell.createShellSession({ dockOpen: true }), { mode: 'workspace', dockOpen: true })
})

test('the dock cannot be the starting state of assistant mode', () => {
  // The dock only exists beside the web app, so a stored flag must not open one.
  assert.deepEqual(shell.createShellSession({ mode: 'copilot', dockOpen: true }), { mode: 'copilot', dockOpen: false })
})

test('choosing the mode already on screen is not a change', () => {
  const session = shell.createShellSession({ mode: 'workspace' })
  assert.equal(shell.setShellMode(session, 'workspace'), null)
})

test('the dock flag survives a trip through assistant mode', () => {
  const docked = shell.createShellSession({ mode: 'workspace', dockOpen: true })
  const copilot = shell.setShellMode(docked, 'copilot')
  assert.deepEqual(copilot, { mode: 'copilot', dockOpen: true })

  const back = shell.setShellMode(copilot, 'workspace')
  assert.deepEqual(back, { mode: 'workspace', dockOpen: true }, 'coming back restores the panel')
})

test('toggling the dock flips it in workspace mode and opens it from assistant mode', () => {
  const closed = shell.createShellSession()
  assert.deepEqual(shell.toggleShellDock(closed), { mode: 'workspace', dockOpen: true })
  assert.deepEqual(shell.toggleShellDock({ mode: 'workspace', dockOpen: true }), { mode: 'workspace', dockOpen: false })

  // From assistant mode the toggle is a shortcut back to the docked layout,
  // because that is the only place the dock can appear.
  assert.deepEqual(shell.toggleShellDock({ mode: 'copilot', dockOpen: false }), { mode: 'workspace', dockOpen: true })
})

test('the described state is exactly what the contract accepts', () => {
  const state = shell.describeShellState({ mode: 'copilot', dockOpen: true }, FACTS)

  assert.deepEqual(state, { mode: 'copilot', dockOpen: true, maximized: false, theme: 'light', platform: 'win32' })
  assert.equal(shell.isShellState(state), true, 'the renderer guard accepts it')
  assert.equal(shell.isShellState({ ...state, mode: 'browser' }), false, 'an invented mode is refused')
  assert.equal(shell.isShellState({ ...state, extra: 1 }), false, 'an extra key is refused')
})
