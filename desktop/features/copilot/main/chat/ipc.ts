/*
 * The chat channel surface.
 *
 * Same shape as the access and Models surfaces, for the same reasons: one
 * trusted-sender check before the payload is looked at, one strict request schema
 * per channel, one validated reply before anything leaves the main process, and a
 * refusal that is a fixed token rather than an error object.
 *
 * Two things are specific to a conversation.
 *
 * 1. *The reply is validated on the way out.* A message row is drawn on a screen
 *    and quotes a person's words, so a row that fails its own schema is answered as
 *    an internal error rather than passed on as a plausible-looking object with a
 *    field missing.
 *
 * 2. *Events go to every trusted view, not to the sender.* A turn outlives the call
 *    that started it, so its deltas cannot be answered to a request. They are
 *    pushed, and the push is the same trusted-view registry the shell bridge owns,
 *    which means there is still one answer to "may this page hear me".
 */

import {
  CHAT_CHANNELS,
  CHAT_FAILURE_MESSAGES,
  CHAT_REPLY_SCHEMAS,
  CHAT_REQUEST_SCHEMAS,
  ChatError,
  chatFailureReply,
  type ChatEvent,
  type ChatFailure,
  type ChatRequestChannelName,
} from '../../shared/chat-contract.js'

import type { ChatService } from './service.js'

export interface ChatIpcMain {
  handle: (channel: string, listener: (event: unknown, request: unknown) => unknown) => void
  removeHandler?: (channel: string) => void
}

/** The trusted-view registry, owned by the shell bridge and shared with it. */
export interface ChatTrustedViews {
  isTrustedSender: (event: unknown) => boolean
  broadcast: (channel: string, payload: unknown) => void
}

export interface ChatIpcLogger {
  warn: (message: string) => void
}

export interface RegisterChatIpcOptions {
  ipcMain: ChatIpcMain
  service: ChatService
  views: ChatTrustedViews
  log?: ChatIpcLogger
}

export interface ChatIpcBridge {
  /** Push one streamed event to every trusted view. */
  publish: (event: ChatEvent) => void
  /** Remove every handler this module registered. */
  dispose: () => void
}

/** The handlers, in the order the channel list is written. */
const CHANNEL_ORDER: readonly ChatRequestChannelName[] = Object.freeze([
  'listThreads',
  'createThread',
  'renameThread',
  'pinThread',
  'removeThread',
  'listMessages',
  'sendMessage',
  'cancelTurn',
  'payloadPreview',
  'listMemory',
  'editMemory',
  'removeMemory',
  'listProposals',
  'setProposalStatus',
  'editProposal',
  'closeThread',
])

export function registerChatIpc (options: RegisterChatIpcOptions): ChatIpcBridge {
  const { ipcMain, service, views, log } = options
  const registered: string[] = []

  /**
   * One channel, however it answers.
   *
   * The order of the two checks is the point: the sender is judged before the
   * payload is read, so a page that is not allowed to talk here cannot learn
   * anything from how its malformed request was refused.
   */
  function handle (name: ChatRequestChannelName): void {
    const channel = CHAT_CHANNELS[name]

    ipcMain.handle(channel, async (event, request) => {
      if (!views.isTrustedSender(event)) {
        log?.warn('refused a chat request from an untrusted view')
        return chatFailureReply('untrusted_sender')
      }

      const parsed = CHAT_REQUEST_SCHEMAS[name].safeParse(request)
      if (!parsed.success) return chatFailureReply('invalid_request')

      try {
        const reply = await run(name, parsed.data)

        /*
         * The reply is checked on the way out. A message row is drawn on a screen
         * and quotes a person's words, so a row that fails its own schema is
         * refused here rather than passed on as a plausible object with a field
         * missing. The check runs after the await because the service is typed and
         * a shape mismatch is a bug in the service, not a user error.
         */
        const checked = CHAT_REPLY_SCHEMAS[name].safeParse(reply)
        if (!checked.success) {
          log?.warn(`chat reply refused (${name})`)
          return chatFailureReply('internal_error')
        }

        return checked.data
      } catch (error) {
        const failure: ChatFailure = error instanceof ChatError ? error.failure : 'internal_error'
        // The token, never the message: a ChatError's message is fixed, but an
        // unexpected error's is not, and a log line is not the place to learn a
        // conversation's content.
        log?.warn(`chat request refused (${failure})`)
        return chatFailureReply(failure)
      }
    })

    registered.push(channel)
  }

  /**
   * Call the service and check its answer.
   *
   * The service is typed, so a schema failure here is a bug rather than a user
   * error; it is reported as an internal error because the alternative is handing a
   * screen an object its own schema just refused.
   */
  async function run (name: ChatRequestChannelName, request: unknown): Promise<unknown> {
    switch (name) {
      case 'listThreads': return service.listThreads(request as never)
      case 'createThread': return service.createThread(request as never)
      case 'renameThread': return service.renameThread(request as never)
      case 'pinThread': return service.pinThread(request as never)
      case 'removeThread': return service.removeThread(request as never)
      case 'listMessages': return service.listMessages(request as never)
      case 'sendMessage': return service.sendMessage(request as never)
      case 'cancelTurn': return service.cancelTurn(request as never)
      case 'payloadPreview': return service.payloadPreview(request as never)
      case 'listMemory': return service.listMemory(request as never)
      case 'editMemory': return service.editMemory(request as never)
      case 'removeMemory': return service.removeMemory(request as never)
      case 'listProposals': return service.listProposals(request as never)
      case 'setProposalStatus': return service.setProposalStatus(request as never)
      case 'editProposal': return service.editProposal(request as never)
      case 'closeThread': return service.closeThread(request as never)
      default: {
        // Unreachable while the switch covers the channel list, which the compiler
        // checks. Kept as a refusal rather than a throw so a future channel added
        // to one list and not the other fails closed.
        const exhaustive: never = name
        void exhaustive
        return chatFailureReply('invalid_request')
      }
    }
  }

  for (const name of CHANNEL_ORDER) handle(name)

  return {
    publish (event) {
      /*
       * A delta is drawn word by word, so an empty one would append nothing and
       * cost a repaint; it is dropped. Everything else is pushed as it is, and the
       * page validates it against the same schema before drawing it.
       */
      if (event.type === 'delta' && event.text.length === 0) return
      views.broadcast(CHAT_CHANNELS.event, event)
    },
    dispose () {
      for (const channel of registered) ipcMain.removeHandler?.(channel)
      registered.length = 0
    },
  }
}

/** Re-exported so a caller can name the sentence for a token without importing twice. */
export { CHAT_FAILURE_MESSAGES }
