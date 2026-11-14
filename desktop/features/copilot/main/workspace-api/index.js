'use strict'

/*
 * The module surface: one function the IPC layer calls, and nothing else.
 *
 * The caller (the main process) owns the Electron session and passes it in, so this
 * module never imports Electron and its tests run on plain Node. The session must be
 * the one the web view uses:
 *
 *   const { session } = require('electron')
 *   const workspaceProbe = createWorkspaceProbe({
 *     session: session.fromPartition(WORKSPACE_PARTITION),
 *     serverUrl: process.env.WORKSPACE_SERVER_URL,
 *     workspaceId: process.env.ZURICOPILOT_PROBE_WORKSPACE_ID,
 *   })
 *
 * A probe that cannot be built (no session yet, a server address this module refuses)
 * answers `not_implemented` instead of throwing, so the IPC handler has one shape to
 * deal with and the renderer never sees a stack trace.
 */

const { PROBE_ACTIONS } = require('../../shared/probe-contract.js')
const { SYSTEM_CLOCK, createProbe, toPositiveInt } = require('./probe.js')
const { createWorkspaceClient } = require('./client.js')

// The web view and this client share one partition, which is what makes the desktop
// inherit the browser sign-in. Kept here so both sides name it the same way.
const WORKSPACE_PARTITION = 'persist:ws'

function unavailableOutcome (action, clock) {
  return {
    action,
    status: 'failed',
    errorCode: 'not_implemented',
    httpStatus: null,
    cleanupHttpStatus: null,
    durationMs: 0,
    checkedAt: clock.iso(),
    workspaceCount: null,
    workspaceId: null,
    taskCreated: null,
    taskDeleted: null,
  }
}

/**
 * @param {object} options
 * @param {object} options.session    Electron session for WORKSPACE_PARTITION
 * @param {string} options.serverUrl  configured server origin
 * @param {number|string} [options.workspaceId] isolated owner workspace to write into;
 *   `process.env` hands this over as a string, so it is converted once here
 * @param {number} [options.timeoutMs]
 * @param {object} [options.clock]
 * @param {object} [options.log]      console-like sink for one startup warning
 * @returns {{ run: (action: string) => Promise<object> }}
 */
function createWorkspaceProbe (options = {}) {
  const { session, serverUrl, timeoutMs, clock = SYSTEM_CLOCK, log = console } = options

  // The id is converted at this one boundary so every check below compares numbers.
  // Leaving it as an environment string would make every write answer `no_workspace`.
  const workspaceId = toPositiveInt(options.workspaceId)
  if (workspaceId === null && options.workspaceId !== undefined && options.workspaceId !== null) {
    // One fixed sentence: the misconfigured value itself is never echoed, so nothing a
    // configuration holds can reach a log line.
    if (log && typeof log.warn === 'function') {
      log.warn('zuricopilot probe workspace id is not a positive whole number; writes report no_workspace')
    }
  }

  let probe = null
  try {
    const client = createWorkspaceClient({ session, serverUrl, timeoutMs })
    probe = createProbe({ client, workspaceId, clock })
  } catch (error) {
    // Worth one line, because a desktop window that quietly never reaches the server
    // is hard to diagnose. Only the message is logged: it is a fixed sentence about a
    // missing session or a refused address, never the address or a credential.
    if (log && typeof log.warn === 'function') {
      log.warn(`zuricopilot workspace-api unavailable: ${error && error.message}`)
    }
  }

  async function run (action) {
    if (!PROBE_ACTIONS.includes(action)) throw new TypeError('unknown probe action')
    if (probe === null) return unavailableOutcome(action, clock)
    return probe.run(action)
  }

  return Object.freeze({ run })
}

module.exports = {
  WORKSPACE_PARTITION,
  createWorkspaceProbe,
  unavailableOutcome,
}
