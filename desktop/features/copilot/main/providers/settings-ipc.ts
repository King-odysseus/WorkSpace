/*
 * The Models channel surface.
 *
 * Same shape as the shell and access surfaces, for the same reasons: one
 * trusted-sender check before the payload is even looked at, one strict request
 * schema per channel, one validated reply before anything leaves the main
 * process, and a refusal that is a fixed token rather than an error object.
 *
 * The trusted-view registry is the shell bridge's, so there is still one answer
 * to "may this page talk to me". The web view has no preload and therefore no way
 * to reach any of this, which is what keeps a key-entry screen out of the page
 * that renders a customer's data.
 *
 * Two things differ from the access channel, and both are about a secret.
 *
 * 1. A service refusal is not an internal error. `ProviderSettingsError` carries a
 *    token the screen knows how to draw, so it is answered with that token instead
 *    of the generic one.
 * 2. Nothing logged can name a preset, a URL or a key. Every line below carries a
 *    token or a count.
 */

import {
  PROVIDER_CHANNELS,
  PROVIDER_REPLY_SCHEMAS,
  PROVIDER_REQUEST_SCHEMAS,
  providerFailureReply,
  providerSettingsStateSchema,
  type ProviderReply,
  type ProviderRequestChannelName,
  type ProviderSettingsFailure,
} from '../../shared/providers/settings-contract.js'

import { ProviderSettingsError, type ProviderSettingsService } from './settings-service.js'

export interface ProviderIpcMain {
  handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => void
  removeHandler?: (channel: string) => void
}

/** The trusted-view registry, owned by the shell bridge and shared with it. */
export interface ProviderTrustedViews {
  isTrustedSender: (event: unknown) => boolean
  broadcast: (channel: string, payload: unknown) => void
}

export interface ProviderLogger {
  warn: (message: string) => void
}

export interface RegisterProviderIpcOptions {
  ipcMain: ProviderIpcMain
  service: ProviderSettingsService
  views: ProviderTrustedViews
  log?: ProviderLogger
}

export interface ProviderIpcBridge {
  /** Push the current state to every trusted view. */
  publishState: () => void
  dispose: () => void
}

type ChannelKey = keyof typeof PROVIDER_CHANNELS

/**
 * The keys that are request channels.
 *
 * `stateChanged` is a push channel, not something a page may ask for, so it is
 * excluded here rather than registered and then refused. A channel that exists
 * only to be refused is a channel that will one day be forgotten.
 */
const REQUEST_KEYS = [
  'readState',
  'saveProvider',
  'removeProvider',
  'beginCredential',
  'saveCredential',
  'testConnection',
  'listModels',
  'discoverLocal',
] as const satisfies readonly ChannelKey[]

export function registerProviderIpc (options: RegisterProviderIpcOptions): ProviderIpcBridge {
  const { ipcMain, service, views, log = console } = options
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('registerProviderIpc needs an ipcMain with handle()')
  }
  if (!service || typeof service.readState !== 'function') {
    throw new TypeError('registerProviderIpc needs a provider settings service')
  }
  if (!views || typeof views.isTrustedSender !== 'function' || typeof views.broadcast !== 'function') {
    throw new TypeError('registerProviderIpc needs the shell bridge views')
  }

  function warn (message: string): void {
    if (log && typeof log.warn === 'function') log.warn(`zuricopilot providers: ${message}`)
  }

  function refuse (reason: ProviderSettingsFailure): ProviderReply<never> {
    warn(`request refused (${reason})`)
    return providerFailureReply(reason)
  }

  /**
   * Parse, answer, then check the answer.
   *
   * A service refusal keeps its own token. Anything else is `internal_error` and
   * its message is never forwarded, so a stack trace, a URL or a provider body
   * cannot reach the page through the error path.
   */
  function register (key: ChannelKey, run: (request: unknown) => Promise<unknown> | unknown): void {
    const channel = PROVIDER_CHANNELS[key] as ProviderRequestChannelName
    const requestSchema = PROVIDER_REQUEST_SCHEMAS[channel]
    const replySchema = PROVIDER_REPLY_SCHEMAS[channel]

    ipcMain.handle(channel, async (event: unknown, request: unknown) => {
      if (!views.isTrustedSender(event)) return refuse('untrusted_sender')

      const parsed = requestSchema.safeParse(request)
      if (!parsed.success) return refuse('invalid_request')

      let reply: unknown
      try {
        reply = await run(parsed.data)
      } catch (error) {
        if (error instanceof ProviderSettingsError) return refuse(error.failure)
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

  const wrap = (value: unknown): ProviderReply<unknown> => ({ ok: true, value })

  register('readState', () => wrap(service.readState()))

  register('saveProvider', request => {
    const body = request as { presetId: string; baseUrl: string; defaultModel: string }
    return wrap(service.saveProvider(body.presetId, body.baseUrl, body.defaultModel))
  })

  register('removeProvider', request => {
    const body = request as { presetId: string }
    return wrap(service.removeProvider(body.presetId))
  })

  register('beginCredential', request => {
    const body = request as { presetId: string }
    return wrap(service.beginCredential(body.presetId))
  })

  register('saveCredential', request => {
    const body = request as { presetId: string; nonce: string; secret: string }
    return wrap(service.saveCredential(body.presetId, body.nonce, body.secret))
  })

  register('testConnection', async request => {
    const body = request as { presetId: string }
    return wrap(await service.testConnection(body.presetId))
  })

  register('listModels', async request => {
    const body = request as { presetId: string }
    return wrap(await service.listModels(body.presetId))
  })

  register('discoverLocal', async () => wrap(await service.discoverLocal()))

  function publishState (): void {
    /*
     * Built from the service, which reads the session itself. When nobody is
     * signed in this is the signed-out state, so a push after a sign-out clears
     * the screen without the shell having to describe what to clear.
     *
     * Validated even though it was built here: every channel reply is checked
     * before it leaves, and a push that skipped the check would be the one way a
     * service bug could put a state on the screen that the page cannot draw.
     */
    let current: unknown
    try {
      current = service.readState()
    } catch (error) {
      warn(`state could not be read (${(error as { name?: string } | null)?.name ?? 'unknown'})`)
      return
    }

    const checked = providerSettingsStateSchema.safeParse(current)
    if (!checked.success) {
      warn('state did not match the contract, so nothing was pushed')
      return
    }
    views.broadcast(PROVIDER_CHANNELS.stateChanged, checked.data)
  }

  function dispose (): void {
    if (typeof ipcMain.removeHandler !== 'function') return
    for (const key of REQUEST_KEYS) ipcMain.removeHandler(PROVIDER_CHANNELS[key])
  }

  return Object.freeze({ publishState, dispose })
}
