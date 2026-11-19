/*
 * The access service: the typed layer between the raw workspace client and the
 * access store.
 *
 * Three rules, each of which is a way this could otherwise go wrong.
 *
 * 1. The server decides eligibility. This module reads the permission list the
 *    server put in `/api/auth/me/` and maps it to a workspace row; it never
 *    assumes that being able to name a workspace means being allowed to use it.
 *    A manager therefore appears with `granted: false` rather than being hidden,
 *    so the person can be told which workspace to ask about.
 *
 * 2. A permission write is read, edit, write. The endpoint replaces the stored
 *    list, so sending `['use_copilot']` would revoke everything else that manager
 *    holds. The current list is read first and exactly one key is added or
 *    removed.
 *
 * 3. Nothing thrown by the transport escapes. A fetch error names the full URL
 *    and a server body can echo an address back, so failures become the fixed
 *    tokens in the contract and the original error is never re-thrown, logged or
 *    placed in a reply.
 */
import { z } from 'zod'

import {
  USE_COPILOT_PERMISSION,
  type AccessFailure,
  type AccessIdentity,
  type AccessManager,
  type AccessManagers,
  type AccessPermission,
  type AccessWorkspace,
} from '../../shared/access-contract.js'

/**
 * The slice of the workspace client this module uses.
 *
 * Declared rather than imported as a concrete type so a test can hand in a stub
 * with the same three methods, and so a change to the client's unrelated probe
 * endpoints cannot reach this code.
 */
export interface AccessApi {
  getMe(): Promise<{ status: number; payload: unknown }>
  listMembers(workspaceId: number): Promise<{ members: unknown[] }>
  updateMemberPermissions(
    workspaceId: number,
    userId: number,
    permissions: string[],
  ): Promise<{ status: number; payload: unknown }>
  signOut(): Promise<{ status: number; payload: unknown }>
}

export interface AccessLogger {
  warn(message: string): void
}

/**
 * A failure already reduced to a contract token. The `failure` field is the only
 * thing a caller reads, so nothing from the network can leak through this object.
 */
class AccessServiceError extends Error {
  readonly failure: AccessFailure

  constructor(failure: AccessFailure) {
    super(failure)
    this.name = 'AccessServiceError'
    this.failure = failure
  }
}

/**
 * What `/api/auth/me/` must contain for this module to trust it.
 *
 * `z.object` strips unknown keys, which is what is wanted here: the endpoint
 * returns a much larger document (avatar, presence, invitations) and none of it
 * belongs in the access state. A missing or wrongly typed field fails the parse,
 * so a half-shaped answer can never produce a workspace list.
 */
const meWorkspaceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(120),
  role: z.string().max(20),
  status: z.string().max(20),
  permissions: z.array(z.string().max(60)).max(100),
})

const meUserSchema = z.object({
  id: z.number().int().positive(),
  username: z.string().max(150).optional(),
  email: z.string().max(200).optional(),
  first_name: z.string().max(150).optional(),
  last_name: z.string().max(150).optional(),
  workspaces: z.array(meWorkspaceSchema).max(500),
})

const meSchema = z.object({
  authenticated: z.boolean(),
  user: meUserSchema.optional(),
})

const memberSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().max(200).optional(),
  first_name: z.string().max(150).optional(),
  last_name: z.string().max(150).optional(),
  role: z.string().max(20),
  permissions: z.array(z.string().max(60)).max(100),
})

export type SessionRead =
  | { kind: 'signed_out' }
  | { kind: 'signed_in'; identity: AccessIdentity; workspaces: AccessWorkspace[] }

export interface AccessService {
  readSession(): Promise<SessionRead>
  listManagers(workspaceId: number): Promise<AccessManagers>
  setPermission(workspaceId: number, userId: number, granted: boolean): Promise<AccessPermission>
  signOut(): Promise<void>
}

/** The roles that can hold the permission at all. A member never can. */
const GRANTABLE_ROLES = new Set(['owner', 'manager'])

function displayName (parts: {
  first_name?: string | undefined
  last_name?: string | undefined
  email?: string | undefined
  username?: string | undefined
}): string {
  const full = [parts.first_name, parts.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .trim()
  if (full !== '') return full
  if (typeof parts.username === 'string' && parts.username !== '') return parts.username
  if (typeof parts.email === 'string' && parts.email !== '') return parts.email
  return 'Signed-in person'
}

/**
 * Map the server's memberships to the rows the assistant uses.
 *
 * Archived workspaces are dropped here rather than being shown as unusable: an
 * archived workspace stays in the web switcher so an owner can restore it, but
 * it is not somewhere to start an assistant conversation.
 */
function toAccessWorkspaces (
  memberships: readonly z.infer<typeof meWorkspaceSchema>[],
): AccessWorkspace[] {
  const rows: AccessWorkspace[] = []
  for (const membership of memberships) {
    if (membership.status !== 'active') continue
    if (!GRANTABLE_ROLES.has(membership.role)) continue
    const role = membership.role === 'owner' ? 'owner' : 'manager'
    rows.push({
      id: membership.id,
      name: membership.name,
      role,
      // An owner holds every key by definition on the server, so this is the
      // server's rule restated, not a second opinion about it.
      granted: role === 'owner' || membership.permissions.includes(USE_COPILOT_PERMISSION),
    })
  }
  return rows
}

/**
 * Reduce anything thrown into a contract token.
 *
 * A 401 from a write means the session ended under the call, which is a
 * different instruction to the person than "the server refused", so it keeps its
 * own token.
 */
function toFailure (error: unknown): AccessFailure {
  if (error instanceof AccessServiceError) return error.failure
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined
  if (status === 401) return 'not_signed_in'
  switch (code) {
    case 'network_error':
      return 'network'
    case 'not_signed_in':
      return 'not_signed_in'
    case 'csrf_rejected':
    case 'http_error':
    case 'unknown':
      return 'rejected'
    default:
      return 'rejected'
  }
}

export function createAccessService (api: AccessApi): AccessService {
  async function readSession (): Promise<SessionRead> {
    let answer: { status: number; payload: unknown }
    try {
      answer = await api.getMe()
    } catch (error) {
      throw new AccessServiceError(toFailure(error))
    }
    if (answer.status !== 200) throw new AccessServiceError(toFailure({ status: answer.status }))

    const parsed = meSchema.safeParse(answer.payload)
    if (!parsed.success) throw new AccessServiceError('rejected')
    // The endpoint answers 200 with `authenticated: false` for a visitor, so the
    // flag decides the session and the status code does not.
    if (!parsed.data.authenticated || parsed.data.user === undefined) {
      return { kind: 'signed_out' }
    }

    const user = parsed.data.user
    return {
      kind: 'signed_in',
      identity: { id: user.id, name: displayName(user) },
      workspaces: toAccessWorkspaces(user.workspaces),
    }
  }

  async function listManagers (workspaceId: number): Promise<AccessManagers> {
    let answer: { members: unknown[] }
    try {
      answer = await api.listMembers(workspaceId)
    } catch (error) {
      throw new AccessServiceError(toFailure(error))
    }

    const members: AccessManager[] = []
    for (const raw of answer.members) {
      const parsed = memberSchema.safeParse(raw)
      // A member row this module cannot read is skipped instead of failing the
      // whole panel: one unusual row must not hide every other manager.
      if (!parsed.success) continue
      // Only managers are shown. Owners cannot be edited (the server refuses the
      // change) and members can never hold the permission, so listing either
      // would offer a control that cannot work.
      if (parsed.data.role !== 'manager') continue
      members.push({
        userId: parsed.data.id,
        name: displayName(parsed.data),
        email: parsed.data.email ?? '',
        granted: parsed.data.permissions.includes(USE_COPILOT_PERMISSION),
      })
    }
    return { workspaceId, members }
  }

  async function setPermission (
    workspaceId: number,
    userId: number,
    granted: boolean,
  ): Promise<AccessPermission> {
    // Read the member first: the write replaces the stored list, so the list this
    // person already holds is the starting point, not a single key.
    let answer: { members: unknown[] }
    try {
      answer = await api.listMembers(workspaceId)
    } catch (error) {
      throw new AccessServiceError(toFailure(error))
    }

    const target = answer.members
      .map(raw => memberSchema.safeParse(raw))
      .find(parsed => parsed.success && parsed.data.id === userId)
    if (!target || !target.success) throw new AccessServiceError('rejected')
    if (target.data.role !== 'manager') throw new AccessServiceError('rejected')

    const current = target.data.permissions
    const next = granted
      ? current.includes(USE_COPILOT_PERMISSION)
        ? current
        : [...current, USE_COPILOT_PERMISSION]
      : current.filter(key => key !== USE_COPILOT_PERMISSION)

    try {
      const write = await api.updateMemberPermissions(workspaceId, userId, next)
      if (write.status < 200 || write.status > 299) {
        throw new AccessServiceError(toFailure({ status: write.status }))
      }
    } catch (error) {
      throw new AccessServiceError(toFailure(error))
    }

    return { workspaceId, userId, granted }
  }

  async function signOut (): Promise<void> {
    try {
      await api.signOut()
    } catch (error) {
      throw new AccessServiceError(toFailure(error))
    }
  }

  return { readSession, listManagers, setPermission, signOut }
}

export { AccessServiceError }
