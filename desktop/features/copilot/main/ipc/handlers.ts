/*
 * The one place the desktop main process registers Copilot IPC.
 *
 * Nothing else in the app calls `ipcMain.handle` for a Copilot channel. Keeping
 * registration in a single function is what makes the surface reviewable: the
 * set of channels a renderer can reach is the `CHANNELS` table, and every
 * handler here validates the request, checks who sent it, and validates its own
 * reply before it leaves.
 *
 * The Phase 0 probe channel is registered by `registerProbeIpc`, which already
 * has its own tested request validator, sender check and one-at-a-time guard.
 * This module delegates to it rather than reimplementing it, and reuses its
 * trust map so a window is trusted once, not twice.
 *
 * `ipcMain` is passed in and Electron is never imported at runtime, so these
 * paths run under plain Node in the test suite.
 */
import { registerProbeIpc } from './probe-ipc.js'
import {
  CHANNELS,
  contractInfo,
  contractInfoRequestSchema,
  contractInfoResultSchema,
  type ContractInfoResult,
  type RefusalReason,
} from '../../shared/ipc-contract.js'

export interface CopilotLogger {
  warn (message: string): void
}

/** The slice of Electron's `ipcMain` this module uses. */
export interface CopilotIpcMain {
  handle (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
  removeHandler (channel: string): void
}

export type ProbeAction = 'read' | 'write'

export interface CopilotIpcBridge {
  trust (contents: unknown, pageUrl: string): void
  forget (contents: unknown): void
  isTrustedSender (event: unknown): boolean
  dispose (): void
}

export interface RegisterCopilotIpcOptions {
  ipcMain: CopilotIpcMain
  runProbe: (action: ProbeAction) => Promise<object>
  log?: CopilotLogger
}

/**
 * Register every Copilot channel and return the trust handles for them.
 *
 * A refusal is returned as an envelope, never thrown: Electron copies a thrown
 * message straight into the renderer, and an error string is the easiest place
 * for an internal detail to leak.
 */
export function registerCopilotIpc (options: RegisterCopilotIpcOptions): CopilotIpcBridge {
  const { ipcMain, runProbe, log = console } = options

  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('registerCopilotIpc needs an ipcMain with handle()')
  }
  if (typeof runProbe !== 'function') {
    throw new TypeError('registerCopilotIpc needs a probe runner')
  }

  // probe-ipc.js is untyped JavaScript; the shape is asserted by its own tests.
  // It declares a wider `string` action because it reads the action off a wire
  // message; it validates that value against PROBE_ACTIONS before calling the
  // runner, so this narrowing guard closes the type gap without a cast.
  function runProbeChecked (action: string): Promise<object> {
    if (action !== 'read' && action !== 'write') {
      return Promise.reject(new TypeError('unexpected probe action'))
    }
    return runProbe(action)
  }

  const probeBridge = registerProbeIpc(
    { ipcMain, runProbe: runProbeChecked, log }
  ) as unknown as CopilotIpcBridge

  function refuse (reason: RefusalReason): ContractInfoResult {
    if (log && typeof log.warn === 'function') {
      log.warn(`zuricopilot ipc: reply refused (${reason})`)
    }
    return { ok: false, reason }
  }

  ipcMain.handle(CHANNELS.contractInfo, (event: unknown, rawRequest: unknown): ContractInfoResult => {
    // Trust first: an untrusted frame learns nothing about the request schema.
    if (!probeBridge.isTrustedSender(event)) return refuse('untrusted_sender')

    if (!contractInfoRequestSchema.safeParse(rawRequest).success) return refuse('invalid_request')

    // The reply is parsed rather than trusted, so a future edit that adds a
    // field cannot widen what a window receives.
    const result = contractInfoResultSchema.safeParse({ ok: true, value: contractInfo() })
    if (!result.success) return refuse('invalid_response')
    return result.data
  })

  function dispose (): void {
    if (typeof ipcMain.removeHandler === 'function') ipcMain.removeHandler(CHANNELS.contractInfo)
    probeBridge.dispose()
  }

  return Object.freeze({
    trust: (contents: unknown, pageUrl: string) => probeBridge.trust(contents, pageUrl),
    forget: (contents: unknown) => probeBridge.forget(contents),
    isTrustedSender: (event: unknown) => probeBridge.isTrustedSender(event),
    dispose
  })
}
