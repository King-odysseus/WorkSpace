/*
 * The main process's published Copilot surface, and the entry esbuild bundles
 * to `build/main/ipc.cjs`.
 *
 * `electron/main.js` requires `registerCopilotIpc` from here, and the tests
 * require the same bundle, so what is tested is exactly what ships.
 */
export {
  registerCopilotIpc,
  type CopilotIpcBridge,
  type CopilotIpcMain,
  type CopilotLogger,
  type RegisterCopilotIpcOptions
} from './handlers.js'

export {
  createKeychain,
  type Keychain,
  type KeychainLogger,
  type KeychainOptions,
  type SafeStorageLike,
  type SecretFailureReason,
  type SecretReadResult,
  type SecretWriteResult
} from '../security/keychain.js'

/*
 * The shell surface: modes, geometry, native menu, tray menu, and the channels
 * the title bar and the dock talk to. Exported through this one bundle so the
 * tests exercise the CommonJS Electron actually loads.
 */
export {
  computeShellLayout,
  resolveDockWidth,
  type ShellLayout,
  type ShellLayoutInput,
  type ShellRect
} from '../shell/layout.js'

export {
  createShellSession,
  describeShellState,
  setShellMode,
  toggleShellDock,
  type ShellSession,
  type ShellSessionSeed,
  type ShellWindowFacts
} from '../shell/session.js'

export { buildMenuTemplate, type MenuItemLike, type ShellMenuActions } from '../shell/menu.js'

export { buildTrayMenuTemplate, trayTooltip, type ShellTrayActions } from '../shell/tray.js'

export { registerShellIpc, isSameShellPage, type RegisterShellIpcOptions, type ShellIpcActions, type ShellIpcBridge } from '../shell/ipc.js'

/*
 * The access surface: who may use the assistant, on which workspace, and the
 * owner-only control that grants it. Exported through the same bundle so the
 * tests load exactly what Electron loads.
 */
export {
  createAccessController,
  type AccessController
} from '../access/controller.js'

export {
  createAccessStore,
  type AccessStore,
  type AccessStoreSeed
} from '../access/store.js'

export {
  AccessServiceError,
  createAccessService,
  type AccessApi,
  type AccessService,
  type SessionRead
} from '../access/service.js'

export {
  registerAccessIpc,
  type AccessIpcBridge,
  type AccessIpcMain,
  type AccessTrustedViews,
  type RegisterAccessIpcOptions
} from '../access/ipc.js'

/*
 * The egress surface (sections 7.1 and 7.3 of the plan): address classification,
 * sanitized audit records, durable ciphertext storage, the account-scoped
 * credential store, the guard every model call passes through, and the
 * credential-entry boundary.
 *
 * Exported through the same bundle as everything else so these tests exercise
 * the CommonJS Electron loads. That matters more here than usual: this is the
 * surface that decides whether bytes may leave the machine, and a test running
 * against a separately compiled copy would prove nothing about the shipped one.
 */
export * from '../security/ip-ranges.js'

export * from '../security/audit.js'

export * from '../security/secret-file.js'

export * from '../security/credentials.js'

export * from '../security/egress-guard.js'

/*
 * The socket the guard dials: the transport that connects only to verified
 * addresses, and the resolver that produces them. Exported because the pin only
 * means something if the transport acting on it is the one that ships.
 */
export * from '../security/pinned-transport.js'

export * from '../security/credential-entry.js'

export { createWorkspaceClient } from '../workspace-api/client.js'

export * from '../../shared/access-contract.js'

export * from '../../shared/access-screen.js'

/*
 * The provider layer (section 9 of the plan): the neutral contract every model
 * adapter answers to, the fixed failure tokens, the local token estimate, the
 * prompted-tool check, and the shared adapter suite.
 *
 * Exported through this one bundle for the same reason as the shell and access
 * surfaces: an adapter's tests must load exactly the CommonJS Electron loads, so
 * a passing suite cannot be passing against a differently-compiled copy.
 */
export * from '../../shared/providers/types.js'

export * from '../../shared/providers/errors.js'

export * from '../../shared/providers/tokens.js'

export * from '../../shared/providers/structured.js'

export * from '../../shared/providers/contract-suite.js'

/*
 * The adapters and the catalogue behind them.
 *
 * Exported here so their tests run against the bundle Electron loads: the whole
 * point of the contract suite is that it passes on the shipped code, and the
 * connector between a chosen preset and an adapter is part of that code.
 */
export * from '../providers/presets.js'
export * from '../providers/capabilities.js'
export * from '../providers/wire.js'
export * from '../providers/transport.js'
export * from '../providers/registry.js'
export * from '../providers/adapters/anthropic.js'
export * from '../providers/adapters/openai-compatible.js'
export * from '../providers/adapters/ollama.js'
export * from '../providers/discovery.js'

/*
 * The Models settings surface: the resolver the guard asks about a hostname, the
 * service behind the screen, its restricted channel, and the pure decisions the
 * screen draws.
 *
 * The contract and the screen decisions are exported through the same bundle as
 * the service, so a test of "what does a missing key look like" exercises the code
 * Electron runs rather than a second copy of it.
 */
export * from '../security/resolver.js'
export * from '../../shared/providers/settings-contract.js'
export * from '../../shared/providers/models-screen.js'
export * from '../../shared/chat-screen.js'
export * from '../providers/settings-service.js'
export * from '../providers/settings-ipc.js'

export * from '../../shared/shell-contract.js'

export {
  CHANNELS,
  CHANNEL_NAMES,
  CONTRACT_VERSION,
  PROBE_CHANNEL,
  PROBE_RESULT_FIELDS,
  REFUSAL_REASONS,
  contractInfo,
  contractInfoRequestSchema,
  contractInfoResultSchema,
  contractInfoValueSchema,
  probeRequestSchema,
  probeResultSchema,
  type ChannelName,
  type ContractInfoResult,
  type ContractInfoValue,
  type ProbeRequest,
  type ProbeResult,
  type RefusalReason
} from '../../shared/ipc-contract.js'

/*
 * The storage layer (sections 7.2 and 14 of the plan): the row contract, the
 * field encryption, the engine wrapper, the numbered migrations, the scoped
 * repositories and the lifecycle that owns one database per signed-in person.
 *
 * Exported through this bundle for the same reason as every other surface. The
 * tests that prove isolation open a real database and write real rows, so they
 * have to reach the code Electron reaches; a test against a separately compiled
 * copy would prove nothing about the shipped one.
 */
export * from '../../shared/storage-contract.js'
export * from '../db/cipher.js'
export * from '../db/driver.js'
export * from '../db/connection.js'
export * from '../db/migrations/index.js'
export * from '../db/repositories/context.js'
export * from '../db/repositories/businesses.js'
export * from '../db/repositories/threads.js'
export * from '../db/repositories/messages.js'
export * from '../db/repositories/summaries.js'
export * from '../db/repositories/memory.js'
export * from '../db/repositories/proposals.js'
export * from '../db/repositories/audit.js'
export * from '../db/repositories/documents.js'
export * from '../db/repositories/chunks.js'
export * from '../db/repositories/document-jobs.js'
export * from '../db/repositories/dna.js'
export * from '../db/repositories/dna-proposals.js'
export * from '../db/store.js'

/*
 * The chat layer: the contract a conversation answers to, the privacy rules that
 * decide what may leave the machine, the turn runner that writes and streams, and
 * the channel surface a page reaches.
 *
 * Exported through this bundle for the same reason as everything above: the tests
 * that prove a streamed delta arrives before the body ends, and that a reply cannot
 * outlive its account, have to exercise the code Electron runs.
 */
export * from '../../shared/chat-contract.js'
export * from '../chat/privacy.js'
export * from '../chat/service.js'
export * from '../chat/ipc.js'
export * from '../chat/context.js'
export * from '../chat/extract.js'
export * from '../chat/summary.js'
export * from '../chat/proposals.js'
export * from '../chat/recall.js'

/*
 * The document layer: reading a file's bytes into text with page and section
 * provenance, cutting that text into citable passages, and running the whole thing as
 * a persisted job that survives a restart.
 *
 * Exported through this bundle for the same reason as everything above: the tests that
 * prove a scanned page is reported rather than silently emptied, and that a restarted
 * job replaces rather than duplicates its chunks, have to exercise the code Electron
 * runs - including the parts that read zlib and the filesystem's own archive format.
 */
export * from '../documents/types.js'
export * from '../documents/zip.js'
export * from '../documents/kinds.js'
export * from '../documents/text.js'
export * from '../documents/pdf.js'
export * from '../documents/office.js'
export * from '../documents/ocr.js'
export * from '../documents/extract.js'
export * from '../documents/chunk.js'
export * from '../documents/ingest.js'
