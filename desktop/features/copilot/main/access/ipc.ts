/*
 * The access channel surface.
 *
 * Same shape as the shell surface, for the same reasons: one trusted-sender
 * check before the payload is even looked at, one strict request schema per
 * channel, one validated reply before anything leaves the main process, and a
 * refusal that is a fixed token rather than an error object.
 *
 * The sender check and the trusted-view registry are taken from the shell
 * bridge rather than kept here. Two registries would mean two answers to "is
 * this page allowed to talk to me", and a page trusted by one and not the other
 * is exactly the kind of gap this surface must not have.
 */
import {
  ACCESS_CHANNELS,
  ACCESS_CHANNEL_NAMES,
  ACCESS_REPLY_SCHEMAS,
  ACCESS_REQUEST_SCHEMAS,
  ACCESS_STATE_PUSH_CHANNEL,
  accessStateSchema,
  accessFailureReply,
  type AccessFailure,
  type AccessReply,
} from '../../shared/access-contract.js'

import type { AccessController } from './controller.js'

export interface AccessIpcMain {
  handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => void
  removeHandler?: (channel: string) => void
}

/** The trusted-view registry, owned by the shell bridge and shared with it. */
export interface AccessTrustedViews {
  isTrustedSender: (event: unknown) => boolean
  broadcast: (channel: string, payload: unknown) => void
}

export interface AccessLogger {
  warn: (message: string) => void
}

export interface RegisterAccessIpcOptions {
  ipcMain: AccessIpcMain
  controller: AccessController
  views: AccessTrustedViews
  log?: AccessLogger
}

export interface AccessIpcBridge {
  /** Push the current state to every trusted view. */
  publishState: () => void
  dispose: () => void
}

export function registerAccessIpc (options: RegisterAccessIpcOptions): AccessIpcBridge {
  const { ipcMain, controller, views, log = console } = options
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('registerAccessIpc needs an ipcMain with handle()')
  }
  if (!controller || typeof controller.refresh !== 'function') {
    throw new TypeError('registerAccessIpc needs an access controller')
  }
  if (!views || typeof views.isTrustedSender !== 'function' || typeof views.broadcast !== 'function') {
    throw new TypeError('registerAccessIpc needs the shell bridge views')
  }

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot access: ${message}`)
  }

  function refuse (reason: AccessFailure): AccessReply<never> {
    warn(`request refused (${reason})`)
    return accessFailureReply(reason)
  }

  /**
   * Parse a request for one channel, then answer, then check the answer.
   *
   * The reply is re-parsed with the same schema the renderer will eventually
   * read, so an impossible state is caught here instead of becoming a rendering
   * bug. A thrown controller is reported as `internal_error` and its message is
   * never forwarded.
   */
  function register<K extends keyof typeof ACCESS_CHANNELS> (
    key: K,
    run: (request: unknown) => Promise<unknown>,
  ): void {
    const channel = ACCESS_CHANNELS[key]
    const requestSchema = ACCESS_REQUEST_SCHEMAS[channel]
    const replySchema = ACCESS_REPLY_SCHEMAS[channel]

    ipcMain.handle(channel, async (event: unknown, request: unknown) => {
      if (!views.isTrustedSender(event)) return refuse('untrusted_sender')

      const parsed = requestSchema.safeParse(request)
      if (!parsed.success) return refuse('invalid_request')

      let reply: unknown
      try {
        reply = await run(parsed.data)
      } catch (error) {
        warn(`handler failed (${(error as { name?: string } | null)?.name ?? 'unknown'})`)
        return refuse('internal_error')
      }

      const checked = replySchema.safeParse(reply)
      if (!checked.success) {
        warn('handler produced a reply the contract refuses')
        return refuse('internal_error')
      }
      return checked.data
    })
  }

  register('readState', async () => ({ ok: true as const, value: controller.getState() }))
  register('refresh', async () => controller.refresh())
  register('selectWorkspace', async request => {
    const workspaceId = (request as { workspaceId: number }).workspaceId
    return controller.selectWorkspace(workspaceId)
  })
  register('listManagers', async request => {
    const workspaceId = (request as { workspaceId: number }).workspaceId
    return controller.listManagers(workspaceId)
  })
  register('setPermission', async request => {
    const { workspaceId, userId, granted } = request as {
      workspaceId: number
      userId: number
      granted: boolean
    }
    return controller.setPermission(workspaceId, userId, granted)
  })
  register('signOut', async () => {
    const reply = await controller.signOut()
    /*
     * The lock lands before the server call, so the panel that asked is already
     * gone by the time a failure arrives and the gate that replaced it says
     * nothing about the server. A line here is the only durable record that the
     * machine was locked while the session cookie may still be alive; the reply
     * still carries the token, and the local lock stands either way.
     */
    if (!reply.ok) warn(`signed out locally, but the server call failed (${reply.reason})`)
    return reply
  })

  /**
   * Push the state after any transition.
   *
   * The state is validated before it is broadcast for the same reason the reply
   * is: a push the page cannot parse would leave the panel blank with no clue
   * why, and this is the one path where nobody is waiting to see an error.
   */
  function publishState (): void {
    const state = controller.getState()
    const checked = accessStateSchema.safeParse(state)
    if (!checked.success) {
      warn('refused to push a state the contract refuses')
      return
    }
    views.broadcast(ACCESS_STATE_PUSH_CHANNEL, checked.data)
  }

  const unsubscribe = controller.subscribe(() => {
    publishState()
  })

  function dispose (): void {
    unsubscribe()
    if (typeof ipcMain.removeHandler === 'function') {
      for (const channel of ACCESS_CHANNEL_NAMES) ipcMain.removeHandler(channel)
    }
  }

  return Object.freeze({ publishState, dispose })
}
