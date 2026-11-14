'use strict'

/*
 * The only bridge between the debug view and the probe.
 *
 * Three rules, in the order a request meets them:
 *
 * 1. The sender must be the renderer this bridge was told to trust, and it must
 *    be that window's main frame. A subframe, a second window or a destroyed
 *    frame is refused before anything else is read.
 * 2. The request must pass the shared contract's validator, which rejects
 *    unknown keys rather than ignoring them. So a renderer cannot name a URL, a
 *    method, a header, a body or a workspace id and have it used.
 * 3. The answer must pass the contract's stricter boundary check before it
 *    leaves this module. A probe that returns something wider than the allowed
 *    field list is replaced with a sanitized failure, not forwarded.
 *
 * Everything refused answers `null`. That is deliberately uninformative: it
 * reveals neither why it was refused nor anything about the server, and the
 * debug view renders it as "refused" without inventing a result.
 *
 * `ipcMain` is passed in, so this module has no Electron import and its tests
 * run on plain Node.
 */

const {
  PROBE_CHANNEL,
  failedProbeResult,
  isSanitizedProbeResult,
  sanitizeProbeResult,
  validateProbeRequest,
} = require('../../shared/probe-contract.js')

// Reasons here are fixed tokens for logs. The offending value is never echoed:
// a refused request may carry anything, including a pasted credential.
const REFUSAL_UNTRUSTED_SENDER = 'untrusted_sender'
const REFUSAL_ALREADY_RUNNING = 'already_running'

/**
 * Whether a frame URL is the local page this bridge trusts.
 *
 * Both sides describe the same file, so the comparison is done on parsed URLs
 * rather than raw strings: a percent-encoded space in the install path must not
 * break the bridge on Windows, and a different document must not open it.
 */
function isSameFilePage (frameUrl, pageUrl) {
  let frame
  let page
  try {
    frame = new URL(String(frameUrl))
    page = new URL(String(pageUrl))
  } catch {
    return false
  }
  if (frame.protocol !== 'file:' || page.protocol !== 'file:') return false
  if (frame.host !== page.host) return false
  return frame.pathname === page.pathname
}

function toWebContentsId (value) {
  if (Number.isInteger(value)) return value
  if (value && Number.isInteger(value.id)) return value.id
  return null
}

/**
 * @param {object} options
 * @param {object} options.ipcMain        Electron's ipcMain, or a stand-in with handle/removeHandler
 * @param {(action: string) => Promise<object>} options.runProbe
 * @param {object} [options.log]          console-like sink; warnings are fixed sentences
 * @returns {{ trust: Function, forget: Function, isTrustedSender: Function, dispose: Function }}
 */
function registerProbeIpc (options = {}) {
  const { ipcMain, runProbe, log = console } = options
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('registerProbeIpc needs an ipcMain with handle()')
  }
  if (typeof runProbe !== 'function') {
    throw new TypeError('registerProbeIpc needs a probe runner')
  }

  // webContents id -> the exact page URL that window is allowed to speak from.
  const trusted = new Map()
  // One probe at a time: a renderer that fires both buttons must not create two
  // tasks and interleave two cleanups.
  let inFlight = false

  function warn (message) {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot probe: ${message}`)
  }

  function refuse (reason) {
    warn(`request refused (${reason})`)
    return null
  }

  function isTrustedSender (event) {
    if (!event || !event.sender) return false
    const id = toWebContentsId(event.sender)
    if (id === null) return false
    const pageUrl = trusted.get(id)
    if (!pageUrl) return false

    const frame = event.senderFrame
    // No frame means the sender is gone; a parent means it is not the view.
    if (!frame || frame.parent) return false
    return isSameFilePage(frame.url, pageUrl)
  }

  /**
   * Run the probe and hand back something that has passed the boundary check.
   *
   * The double check is not redundant: `sanitizeProbeResult` narrows the fields,
   * and `isSanitizedProbeResult` re-reads the result the way the renderer would.
   * If either step fails, the answer is a sanitized failure, so a future probe
   * change cannot widen what a renderer receives.
   */
  async function runChecked (action) {
    let raw
    try {
      raw = await runProbe(action)
    } catch (error) {
      // The error's message may name a URL or a server phrase; only its name is
      // logged, and the result is built from the fixed vocabulary.
      warn(`run failed (${(error && error.name) || 'unknown'})`)
      return failedProbeResult(action, 'unknown')
    }

    let sanitized
    try {
      sanitized = isSanitizedProbeResult(raw) ? raw : sanitizeProbeResult(raw)
    } catch {
      warn('run produced a result the contract refuses')
      return failedProbeResult(action, 'unknown')
    }
    if (!isSanitizedProbeResult(sanitized)) {
      warn('run produced a result the boundary check refuses')
      return failedProbeResult(action, 'unknown')
    }
    return sanitized
  }

  async function handle (event, request) {
    let action = null
    try {
      if (!isTrustedSender(event)) return refuse(REFUSAL_UNTRUSTED_SENDER)
      if (inFlight) return refuse(REFUSAL_ALREADY_RUNNING)

      const validated = validateProbeRequest(request)
      if (!validated.ok) return refuse(validated.reason)
      action = validated.value.action

      inFlight = true
      try {
        return await runChecked(action)
      } finally {
        inFlight = false
      }
    } catch (error) {
      // A handler that throws would reject in the renderer with a stack trace.
      warn(`handler failed (${(error && error.name) || 'unknown'})`)
      if (action === null) return null
      return failedProbeResult(action, 'unknown')
    }
  }

  ipcMain.handle(PROBE_CHANNEL, handle)

  /** Allow one window's main frame to use the bridge. Local files only. */
  function trust (webContents, pageUrl) {
    const id = toWebContentsId(webContents)
    if (id === null) throw new TypeError('trust needs a webContents or a webContents id')

    let page
    try {
      page = new URL(String(pageUrl))
    } catch {
      throw new TypeError('trust needs an absolute page URL')
    }
    // The probe view is a local file. Trusting an http(s) page here would hand
    // the bridge to whatever the network served.
    if (page.protocol !== 'file:') throw new TypeError('the probe view must be a local file')

    trusted.set(id, page.href)
  }

  function forget (webContents) {
    const id = toWebContentsId(webContents)
    if (id === null) return
    trusted.delete(id)
  }

  function dispose () {
    trusted.clear()
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(PROBE_CHANNEL)
  }

  return Object.freeze({ trust, forget, isTrustedSender, dispose })
}

module.exports = {
  REFUSAL_UNTRUSTED_SENDER,
  REFUSAL_ALREADY_RUNNING,
  isSameFilePage,
  registerProbeIpc,
}
