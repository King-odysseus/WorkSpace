'use strict'

/*
 * What the assistant view draws, tested without a renderer.
 *
 * The desktop package runs its tests on node's runner, which has no DOM, so the
 * decision about which screen to draw lives in `shared/access-screen.ts` rather
 * than in a branch inside the view. This file is the proof that the branch has
 * four safe answers and one unsafe one, and that the unsafe one is reachable only
 * from a verified, ready state on a chosen workspace.
 *
 * The first group is the regression: the view used to draw its normal content
 * whenever `window.zuriAccess` was missing, because the page is also opened in a
 * browser during design work. The page that renders this view is only reached
 * with a shell bridge present, so that case could only ever mean a preload that
 * exposed half its surface - and it handed out assistant content to a person
 * nobody had checked.
 *
 * Run through the built bundle, like the rest of the desktop tests:
 *
 *   cd desktop && node --test features/copilot/shared/access-screen.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const shared = require('../../../build/main/ipc.cjs')

const { accessScreenFor } = shared

/** A state shaped exactly like AccessState, unlocked on one owner workspace. */
function state (overrides = {}) {
  return {
    version: 1,
    status: 'ready',
    reason: null,
    identity: { id: 5, name: 'Ada Obi' },
    workspaces: [{ id: 4, name: 'Zuri', role: 'owner', granted: true }],
    selectedWorkspaceId: 4,
    ...overrides,
  }
}

/** A locked state, as the push delivers it after a sign-out. */
function locked (reason = 'signed_out') {
  return state({ status: 'locked', reason, identity: null, workspaces: [], selectedWorkspaceId: null })
}

/*
 * The bridge itself is never called by the decision: it only has to exist, and it
 * is carried through so the view cannot pair one moment's state with another's
 * bridge. A bare object is therefore the honest stand-in.
 */
const BRIDGE = Object.freeze({ kind: 'stand-in' })

test('a missing access bridge draws nothing, whatever the state says', () => {
  // The state here is fully ready: unlocked, one granted workspace, one selected.
  // If absence of the bridge produced content, this is the exact payload that
  // would render the assistant to an unverified page.
  for (const provided of [state(), locked(), state({ status: 'ready', selectedWorkspaceId: null }), null]) {
    assert.equal(accessScreenFor(undefined, provided).kind, 'unverified')
  }
})

test('a bridge that has not answered yet draws nothing either', () => {
  assert.equal(accessScreenFor(BRIDGE, null).kind, 'pending')
})

test('a locked state draws the gate, carrying the bridge and the state it was given', () => {
  const lockedState = locked('revoked')
  const screen = accessScreenFor(BRIDGE, lockedState)

  assert.equal(screen.kind, 'gate')
  assert.equal(screen.bridge, BRIDGE)
  assert.equal(screen.state, lockedState)
  assert.equal(screen.state.reason, 'revoked')
})

test('an unlocked state with no workspace chosen draws the workspace panel', () => {
  const ready = state({ selectedWorkspaceId: null, workspaces: [{ id: 4, name: 'Zuri', role: 'manager', granted: false }] })
  const screen = accessScreenFor(BRIDGE, ready)

  assert.equal(screen.kind, 'panel')
  assert.equal(screen.bridge, BRIDGE)
  assert.equal(screen.state, ready)
})

test('an unlocked state on a chosen workspace draws the assistant content', () => {
  assert.equal(accessScreenFor(BRIDGE, state()).kind, 'content')
})

test('content is reachable only from a verified bridge and a ready, selected state', () => {
  const cases = [
    { bridge: undefined, state: state(), expected: 'unverified' },
    { bridge: undefined, state: null, expected: 'unverified' },
    { bridge: BRIDGE, state: null, expected: 'pending' },
    { bridge: BRIDGE, state: locked(), expected: 'gate' },
    { bridge: BRIDGE, state: state({ selectedWorkspaceId: null }), expected: 'panel' },
    { bridge: BRIDGE, state: state(), expected: 'content' },
  ]

  for (const { bridge, state: provided, expected } of cases) {
    // The whole table is checked by name, so a reordered branch shows up as the
    // wrong answer here rather than as a screen nobody looked at.
    assert.equal(accessScreenFor(bridge, provided).kind, expected)
  }
})
