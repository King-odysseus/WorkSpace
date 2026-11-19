'use strict'

/*
 * The Copilot bridge for the probe view and contract info, and nothing else.
 *
 * This file runs in a sandboxed preload, which means `require` only resolves
 * Electron and a short list of built-ins: a sandboxed preload cannot load a
 * project file. The channel names are therefore repeated here as literals, and
 * `features/copilot/main/ipc/preload-bridge.test.js` asserts that they equal
 * PROBE_CHANNEL and CONTRACT_INFO_CHANNEL, so the two cannot drift apart silently.
 *
 * What is exposed is three methods with no arguments. There is no generic
 * `invoke`, no channel parameter, no `ipcRenderer` and no event subscription, so
 * page code has no way to name a channel of its own or listen to main-process
 * traffic. Each method sends one fixed request from the shared contract:
 * `probe.read` and `probe.write` send to the probe channel, and `contractInfo`
 * sends to the contract-info channel.
 */

const { contextBridge, ipcRenderer } = require('electron')

const PROBE_CHANNEL = 'copilot:probe:run'
const CONTRACT_INFO_CHANNEL = 'copilot:contract:info'

function createCopilotApi (invoke) {
  if (typeof invoke !== 'function') throw new TypeError('createCopilotApi needs an invoke function')

  return Object.freeze({
    probe: Object.freeze({
      read: () => invoke(PROBE_CHANNEL, { action: 'read', confirmWrite: false }),
      write: () => invoke(PROBE_CHANNEL, { action: 'write', confirmWrite: true }),
    }),
    contractInfo: () => invoke(CONTRACT_INFO_CHANNEL, {}),
  })
}

contextBridge.exposeInMainWorld('copilot', createCopilotApi((channel, request) => ipcRenderer.invoke(channel, request)))
