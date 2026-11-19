/*
 * The shape of `window.copilot`, as injected by the sandboxed preload
 * (desktop/electron/preload/copilot.js). It mirrors the validated IPC contract
 * in desktop/features/copilot/shared/ipc-contract.ts: a short list of named
 * methods, no channel parameter, no generic invoke.
 *
 * The declaration lives in a module (it exports types), so the window
 * augmentation is written inside `declare global`; without an export that block
 * would be a syntax error.
 */

export type RefusalReason = 'internal_error' | 'invalid_request' | 'invalid_response' | 'untrusted_sender'

export type ContractInfoResult =
  | { ok: true; value: { contractVersion: 1; channels: string[] } }
  | { ok: false; reason: RefusalReason }

export type ProbeResult = {
  contractVersion: 1
  action: 'read' | 'write'
  status: 'ok' | 'failed'
  errorCode: null | 'csrf_rejected' | 'http_error' | 'network_error' | 'no_workspace' | 'not_implemented' | 'not_signed_in' | 'unknown'
  httpStatus: number | null
  cleanupHttpStatus: number | null
  durationMs: number | null
  checkedAt: string | null
  workspaceCount: number | null
  workspaceId: number | null
  taskCreated: boolean | null
  taskDeleted: boolean | null
}

export interface CopilotBridge {
  contract (): Promise<ContractInfoResult>
  probe: {
    read (): Promise<ProbeResult>
    write (): Promise<ProbeResult>
  }
}

declare global {
  interface Window { copilot?: CopilotBridge }
}
