'use strict'

/*
 * The Copilot bridge for the probe view, and nothing else.
 *
 * This file runs in a sandboxed preload, which means `require` only resolves
 * Electron and a short list of built-ins: a sandboxed preload cannot load a
 * project file. The channel name is therefore repeated here as a literal, and
 * `features/copilot/main/ipc/preload-bridge.test.js` asserts that literal equals
 * PROBE_CHANNEL, so the two cannot drift apart silently.
 *
 * What is exposed is two methods with no arguments. There is no generic
 * `invoke`, no channel parameter, no `ipcRenderer` and no event subscription, so
 * page code has no way to name a channel of its own or listen to main-process
 * traffic. Each method sends one fixed request from the shared contract:
 * `read` is read-only, and `write` sends the confirmation the contract requires
 * for the only write the spike performs.
 */

const { contextBridge, ipcRenderer } = require('electron')

const PROBE_CHANNEL = 'copilot:probe:run'

function createCopilotApi (invoke) {
  if (typeof invoke !== 'function') throw new TypeError('createCopilotApi needs an invoke function')

  return Object.freeze({
    probe: Object.freeze({
      read: () => invoke(PROBE_CHANNEL, { action: 'read', confirmWrite: false }),
      write: () => invoke(PROBE_CHANNEL, { action: 'write', confirmWrite: true }),
    }),
  })
}

contextBridge.exposeInMainWorld('copilot', createCopilotApi((channel, request) => ipcRenderer.invoke(channel, request)))
