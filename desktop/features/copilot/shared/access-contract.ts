/*
 * Who may use the assistant, and on which workspace: the contract for the
 * access surface.
 *
 * The same two rules the IPC contract keeps apply here, because this is the
 * surface that decides whether a signed-in person is allowed to do anything at
 * all:
 *
 * 1. Channels are a closed table. A renderer names a method, never a channel
 *    string, and no method takes a channel or a URL.
 * 2. Every schema is strict. An unknown key is a rejection, not a silent strip,
 *    so a caller cannot smuggle a role, a permission list or an arbitrary
 *    endpoint into a request that is supposed to name one workspace.
 *
 * The eligibility rule itself lives in the server (section 17 of the plan): an
 * owner always holds `use_copilot`, a manager only when an owner granted it, and
 * a member never. This module only names that rule; it does not decide it.
 */
import { z } from 'zod'

/** Bumped only when the shape below changes incompatibly. */
export const ACCESS_VERSION = 1

/**
 * The one permission this surface reads. Spelled once so the main process, the
 * renderer and the tests cannot disagree about the key the server stores.
 */
export const USE_COPILOT_PERMISSION = 'use_copilot'

/**
 * Every channel the access surface registers.
 *
 * `readState`, `refresh` and `signOut` take no payload. The other three name one
 * workspace, and the server re-checks that the person may act on it: naming a
 * workspace is a request, never an authorization.
 */
export const ACCESS_CHANNELS = Object.freeze({
  readState: 'zuri:access:state',
  refresh: 'zuri:access:refresh',
  selectWorkspace: 'zuri:access:select',
  listManagers: 'zuri:access:managers',
  setPermission: 'zuri:access:permission',
  signOut: 'zuri:access:signout',
})

export type AccessChannelKey = keyof typeof ACCESS_CHANNELS
export type AccessChannelName = (typeof ACCESS_CHANNELS)[AccessChannelKey]

export const ACCESS_CHANNEL_NAMES: readonly AccessChannelName[] = Object.freeze(
  Object.values(ACCESS_CHANNELS),
)

/**
 * The main process pushes state on this channel. It is main-to-renderer only:
 * no handler is registered for it, so a renderer cannot push state back.
 */
export const ACCESS_STATE_PUSH_CHANNEL = 'zuri:access:state:changed'

/** The roles that can hold the permission. A member never appears here. */
export const ACCESS_ROLES = Object.freeze(['owner', 'manager'] as const)

/**
 * Why the assistant is locked. Each reason is a different instruction to the
 * person, so they are kept apart instead of collapsing into one "not allowed".
 */
export const LOCK_REASONS = Object.freeze([
  'signed_out', // no session yet, or the session ended
  'no_access', // signed in, but no workspace grants the permission
  'expired', // the session ended while a request was in flight
  'revoked', // the grant was withdrawn while the session was open
  'account_changed', // a different person signed in
] as const)

export type LockReason = (typeof LOCK_REASONS)[number]

/** Why a call was refused. Fixed tokens: nothing from a request is echoed. */
export const ACCESS_FAILURES = Object.freeze([
  'untrusted_sender',
  'invalid_request',
  'not_signed_in',
  'no_access',
  'not_owner',
  'network',
  'rejected',
  'internal_error',
  // The answer arrived after the session, the account or the selection had
  // already moved on, so it was dropped rather than applied.
  'stale',
] as const)

export type AccessFailure = (typeof ACCESS_FAILURES)[number]

/**
 * One workspace the person may use the assistant in.
 *
 * `granted` is false only for a manager whose grant an owner has not given: the
 * row still appears so the person is told which workspace to ask about, rather
 * than a bare "no access".
 */
export const accessWorkspaceSchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  role: z.enum(ACCESS_ROLES),
  granted: z.boolean(),
})

export type AccessWorkspace = z.infer<typeof accessWorkspaceSchema>

export const accessIdentitySchema = z.strictObject({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200),
})

export type AccessIdentity = z.infer<typeof accessIdentitySchema>

/**
 * The whole access state. This is what the renderer draws and what the main
 * process pushes, validated in both directions, so the two cannot drift.
 */
export const accessStateSchema = z.strictObject({
  version: z.literal(ACCESS_VERSION),
  status: z.enum(['locked', 'ready']),
  reason: z.enum(LOCK_REASONS).nullable(),
  identity: accessIdentitySchema.nullable(),
  workspaces: z.array(accessWorkspaceSchema).max(200),
  selectedWorkspaceId: z.number().int().positive().nullable(),
})

export type AccessState = z.infer<typeof accessStateSchema>

/** An owner or manager row as the owner-only panel sees it. */
export const accessManagerSchema = z.strictObject({
  userId: z.number().int().positive(),
  name: z.string().max(200),
  email: z.string().max(200),
  granted: z.boolean(),
})

export type AccessManager = z.infer<typeof accessManagerSchema>

export const accessManagersSchema = z.strictObject({
  workspaceId: z.number().int().positive(),
  members: z.array(accessManagerSchema).max(500),
})

export type AccessManagers = z.infer<typeof accessManagersSchema>

export const accessPermissionSchema = z.strictObject({
  workspaceId: z.number().int().positive(),
  userId: z.number().int().positive(),
  granted: z.boolean(),
})

export type AccessPermission = z.infer<typeof accessPermissionSchema>

/* The three request bodies, each a closed object. */
export const accessEmptyRequestSchema = z.strictObject({})
export const accessWorkspaceRequestSchema = z.strictObject({
  workspaceId: z.number().int().positive(),
})
export const accessPermissionRequestSchema = accessPermissionSchema

/**
 * The reply envelope. Every call answers with one of these two shapes, so the
 * renderer has exactly one way to read a result and one place failures appear.
 */
export type AccessReply<T> = { ok: true; value: T } | { ok: false; reason: AccessFailure }

export const accessFailureReply = (reason: AccessFailure): AccessReply<never> => ({
  ok: false,
  reason,
})

export const accessValueReply = <T>(value: T): AccessReply<T> => ({ ok: true, value })

const accessFailureReplySchema = z.strictObject({
  ok: z.literal(false),
  reason: z.enum(ACCESS_FAILURES),
})

/**
 * The reply schemas, parsed before anything leaves the main process.
 *
 * This is the same discipline the probe channel uses: a controller that returns
 * a shape the contract does not describe is a bug, and the renderer must not be
 * the place that finds out.
 */
export const accessStateReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: accessStateSchema }),
  accessFailureReplySchema,
])

export const accessManagersReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: accessManagersSchema }),
  accessFailureReplySchema,
])

export const accessPermissionReplySchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: accessPermissionSchema }),
  accessFailureReplySchema,
])

/** Which reply shape each channel answers with. */
export const ACCESS_REPLY_SCHEMAS = Object.freeze({
  [ACCESS_CHANNELS.readState]: accessStateReplySchema,
  [ACCESS_CHANNELS.refresh]: accessStateReplySchema,
  [ACCESS_CHANNELS.selectWorkspace]: accessStateReplySchema,
  [ACCESS_CHANNELS.listManagers]: accessManagersReplySchema,
  [ACCESS_CHANNELS.setPermission]: accessPermissionReplySchema,
  [ACCESS_CHANNELS.signOut]: accessStateReplySchema,
}) as Readonly<Record<AccessChannelName, z.ZodType>>

/**
 * The request schema for one channel, or null when the channel takes none.
 *
 * Kept as a table rather than a branch so adding a channel without a schema is
 * a type error instead of an unchecked default.
 */
export const ACCESS_REQUEST_SCHEMAS = Object.freeze({
  [ACCESS_CHANNELS.readState]: accessEmptyRequestSchema,
  [ACCESS_CHANNELS.refresh]: accessEmptyRequestSchema,
  [ACCESS_CHANNELS.selectWorkspace]: accessWorkspaceRequestSchema,
  [ACCESS_CHANNELS.listManagers]: accessWorkspaceRequestSchema,
  [ACCESS_CHANNELS.setPermission]: accessPermissionRequestSchema,
  [ACCESS_CHANNELS.signOut]: accessEmptyRequestSchema,
}) as Readonly<Record<AccessChannelName, z.ZodType>>

export type AccessRequestFor<K extends AccessChannelKey> = z.infer<
  (typeof ACCESS_REQUEST_SCHEMAS)[(typeof ACCESS_CHANNELS)[K]]
>

/**
 * The bridge the sandboxed preload exposes as `window.zuriAccess`.
 *
 * Every method is a fixed channel with a typed payload, so the page can name a
 * workspace but never a URL, a header or a channel. `onState` is the push side:
 * it delivers the state the main process already validated, and the returned
 * function removes exactly that listener.
 */
export interface AccessBridge {
  readState(): Promise<AccessReply<AccessState>>
  refresh(): Promise<AccessReply<AccessState>>
  selectWorkspace(workspaceId: number): Promise<AccessReply<AccessState>>
  listManagers(workspaceId: number): Promise<AccessReply<AccessManagers>>
  setPermission(
    workspaceId: number,
    userId: number,
    granted: boolean,
  ): Promise<AccessReply<AccessPermission>>
  signOut(): Promise<AccessReply<AccessState>>
  onState(listener: (state: AccessState) => void): () => void
}
