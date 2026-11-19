/*
 * One conversation, from the typing to the stored row.
 *
 * This is where four rules meet. Each is written down because each one has already
 * been the cause of a bug somewhere in this app.
 *
 * 1. *The person's words are saved first.* A turn writes the user's message before
 *    any provider is called. If the network fails, the key is rejected or the model
 *    answers with nonsense, the message is still in the thread and the screen can
 *    offer a retry. The other order - call first, save on success - loses what
 *    somebody typed because a provider had a bad minute.
 *
 * 2. *A turn is one thing, and it can be stopped.* One turn runs at a time per
 *    conversation, it carries an id, and its cancellation is an AbortSignal that
 *    reaches the socket. A second send while one is running is refused as `busy`
 *    rather than queued, because a queued turn would answer a question the person
 *    has already stopped caring about.
 *
 * 3. *Events are for one conversation in one account.* Every event is checked
 *    against the running turn before it is published. A sign-out, a switch to
 *    another business, or a withdrawn workspace ends the turn and its events stop.
 *    That is what stops a slow reply landing in whatever conversation happens to be
 *    open when it arrives.
 *
 * 4. *A cloud turn decides what it may send, and says so.* Before a cloud model is
 *    called, the conversation is rewritten with placeholders and checked for
 *    anything that still identifies a person or a business. A hit is a refusal, not
 *    a scrub, and the person's own message stays stored so nothing is lost by it.
 *
 * Nothing here builds a URL, holds a key, or writes a log line with content in it.
 * The provider comes from the Models layer, which owns the key; the database comes
 * from the store, which owns the encryption and the access check.
 */

import {
  ChatError,
  type CancelTurnReply,
  type ChatEvent,
  type CreateThreadRequest,
  type ListMessagesRequest,
  type ListThreadsRequest,
  type ListMemoryRequest,
  type EditMemoryRequest,
  type RemoveMemoryRequest,
  type ListProposalsRequest,
  type SetProposalStatusRequest,
  type EditProposalRequest,
  type CloseThreadRequest,
  type CloseThreadReply,
  type MemoryListReply,
  type MemoryReply,
  type ProposalListReply,
  type ProposalReply,
  type MessageListReply,
  type PayloadPreviewReply,
  type PayloadPreviewRequest,
  type PinThreadRequest,
  type RenameThreadRequest,
  type SendMessageReply,
  type SendMessageRequest,
  type ThreadIdRequest,
  type ThreadListReply,
  type ThreadReply,
} from '../../shared/chat-contract.js'
import type { BusinessScope, MessageRow, SummaryRow, ThreadRow } from '../../shared/storage-contract.js'
import { StorageError } from '../../shared/storage-contract.js'
import { ProviderError } from '../../shared/providers/errors.js'
import { createCallContext, type ChatMessage, type ChatRequest } from '../../shared/providers/types.js'
import type { BusinessStore } from '../db/store.js'
import type { ProviderSettingsService, RoutedProvider } from '../providers/settings-service.js'
import { buildCloudPayload, buildLocalPayload, type PrivacyIdentity } from './privacy.js'
import { assembleContext, CONTEXT_CHARS, CONTEXT_MESSAGES, budgetForWindow } from './context.js'
import { resolveCapabilities } from '../providers/capabilities.js'
import { findPreset } from '../providers/presets.js'
import { applyExtraction, EXTRACTION_PROMPT, extractedMemorySchema, numberedBatch } from './extract.js'
import { applySummary, needsSummary, planSummary, SUMMARY_PROMPT, summaryBatch, summaryReplySchema } from './summary.js'
import { applyProposals, DRAFTING_PROMPT, draftedTasksSchema } from './proposals.js'
import { askStructured, recallConversation } from './recall.js'

/** The name a conversation carries before anything has been said in it. */
const PLACEHOLDER_TITLE = 'New conversation'

/**
 * What a person's message looks like when they are asking for work to be created.
 *
 * This is a cost guard, not a safety mechanism. Drafting means a second model call
 * in the same turn, and paying for that on "what is overdue?" would be paying for
 * an answer nobody asked for. Whether a draft is *allowed* is decided elsewhere and
 * does not depend on this pattern matching.
 *
 * The failure direction is deliberate: a phrasing this does not recognise costs a
 * draft the person has to ask for again, while a looser pattern costs a call on
 * every turn.
 */
export const DRAFT_CUE = /\b(create|add|make|draft|set up|schedule|remind me|put together)\b[\s\S]{0,40}\b(task|tasks|to-?do|reminder)\b/iu

/**
 * A title taken from the first thing said.
 *
 * The honest name for a conversation is the first question. A model-written title
 * would be one more call to pay for and one more place to be wrong. Whitespace is
 * collapsed because a pasted paragraph would otherwise produce a title of
 * newlines, which the sidebar draws as a blank row.
 */
function titleFrom (text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (collapsed.length === 0) return PLACEHOLDER_TITLE
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}...` : collapsed
}

/** One stored message in the provider's own shape. */
function toChatMessage (row: MessageRow): ChatMessage {
  const role = row.role === 'assistant' ? 'assistant' : row.role === 'system' ? 'system' : 'user'
  return { role, parts: [{ type: 'text', text: row.content }] }
}
/**
 * A provider failure as a token this surface knows.
 *
 * The two lists are different on purpose - a chat screen has words for "nobody is
 * signed in" that a provider never needs - so the overlap is mapped explicitly
 * rather than cast. `egress_blocked` is the guard refusing to send, which from the
 * person's side is the provider being unreachable for that request; it is not
 * their content's fault, so it is not `blocked_content`.
 */
const PROVIDER_TO_CHAT: Readonly<Record<string, string>> = Object.freeze({
  aborted: 'aborted',
  network: 'network',
  timeout: 'timeout',
  provider_unauthorized: 'provider_unauthorized',
  provider_rate_limited: 'provider_rate_limited',
  provider_unavailable: 'provider_unavailable',
  provider_rejected: 'provider_rejected',
  model_not_found: 'model_not_found',
  context_too_long: 'context_too_long',
  malformed_response: 'malformed_response',
  schema_mismatch: 'schema_mismatch',
  unsupported: 'unsupported',
  blocked: 'blocked_content',
  egress_blocked: 'network',
})

/** A storage refusal as the token a screen can draw. */
function asChatFailure (error: unknown): ChatError {
  if (error instanceof ChatError) return error
  if (error instanceof StorageError) {
    if (error.failure === 'not_found') return new ChatError('not_found')
    if (error.failure === 'invalid_request') return new ChatError('invalid_request')
    if (error.failure === 'closed') return new ChatError('not_signed_in')
    return new ChatError('internal_error')
  }
  return new ChatError('internal_error')
}

/** A provider refusal as a chat token, or a fixed internal error for anything else. */
function asTurnFailure (error: unknown): ChatError {
  if (error instanceof ChatError) return error
  if (error instanceof ProviderError) {
    const mapped = PROVIDER_TO_CHAT[error.failure]
    if (mapped !== undefined) return new ChatError(mapped as ChatError['failure'])
    return new ChatError('internal_error')
  }
  return asChatFailure(error)
}

/**
 * Whether offering a retry is honest.
 *
 * A rejected key or a model that does not exist will fail in exactly the same way
 * again, so a retry button for those is a lie. A blip, a rate limit and a provider
 * having trouble are all worth one more try.
 */
function isRetryable (failure: string): boolean {
  return failure === 'network' || failure === 'timeout' ||
    failure === 'provider_unavailable' || failure === 'provider_rate_limited'
}

/** What a running turn is, held so it can be stopped and so its events can be judged. */
interface ActiveTurn {
  readonly turnId: string
  readonly threadId: string
  readonly scopeKey: string
  readonly abort: AbortController
}

export interface ChatLogger {
  warn: (message: string) => void
}

export interface ChatServiceDeps {
  readonly store: BusinessStore
  /** The signed-in account, or null. Read on every call so a sign-out takes effect. */
  readonly scope: () => { serverHost: string, userId: number } | null
  /** The workspace chosen in the assistant, or null. */
  readonly businessId: () => string | null
  /** The Models layer, or null before it exists. Owns every key and every address. */
  readonly providers: () => ProviderSettingsService | null
  /** Who the person is, so their own name can be kept out of a cloud payload. */
  readonly identity: () => PrivacyIdentity
  /** Where an event goes: the chat screen in the desktop window, and nowhere else. */
  readonly publish: (event: ChatEvent) => void
  readonly log?: ChatLogger
}

export interface ChatService {
  listThreads: (request: ListThreadsRequest) => ThreadListReply
  createThread: (request: CreateThreadRequest) => ThreadReply
  renameThread: (request: RenameThreadRequest) => ThreadReply
  pinThread: (request: PinThreadRequest) => ThreadReply
  removeThread: (request: ThreadIdRequest) => { removed: true }
  listMessages: (request: ListMessagesRequest) => MessageListReply
  /**
   * Start a turn and answer with its id.
   *
   * The answer arrives before the reply does, on purpose: the screen needs an id to
   * discard events from a turn it has abandoned, and it cannot wait for text it has
   * not been given yet.
   */
  sendMessage: (request: SendMessageRequest) => Promise<SendMessageReply>
  cancelTurn: (request: ThreadIdRequest) => CancelTurnReply
  payloadPreview: (request: PayloadPreviewRequest) => PayloadPreviewReply
  /*
   * What the business remembers, and the drafts its conversations produced.
   *
   * Editing an item is a person's correction and the repository marks it as
   * theirs, so no later pass can quietly replace it with what a model thought
   * first. Removing one takes it out of every future turn immediately, because
   * the context is assembled from what is stored right now rather than from
   * anything cached.
   */
  listMemory: (request: ListMemoryRequest) => MemoryListReply
  editMemory: (request: EditMemoryRequest) => MemoryReply
  removeMemory: (request: RemoveMemoryRequest) => { removed: true }
  listProposals: (request: ListProposalsRequest) => ProposalListReply
  /**
   * A person's decision about a draft. Records it and does nothing else.
   *
   * Approving a draft creates no task and calls no server: execution is a later
   * phase, and this surface deliberately has no way to ask for it.
   */
  setProposalStatus: (request: SetProposalStatusRequest) => ProposalReply
  /**
   * Correct a draft that is still waiting on a person.
   *
   * The repository refuses this once the draft has been decided, so a card left open
   * in another window cannot rewrite text that a decision was already made about.
   * Like the decision itself, an edit creates nothing: it changes three fields of a
   * row and stops there.
   */
  editProposal: (request: EditProposalRequest) => ProposalReply
  /**
   * Settle a thread: summarise what it covered and keep what it taught.
   *
   * Asynchronous because it asks a model, and allowed to fail softly for the same
   * reason: a thread that could not be summarised is still a thread that can be
   * read, and refusing to close it would be worse than closing it with what it
   * already had.
   */
  closeThread: (request: CloseThreadRequest) => Promise<CloseThreadReply>
  /** Stop everything. Called when the window closes. */
  dispose: () => void
}

export function createChatService (deps: ChatServiceDeps): ChatService {
  let active: ActiveTurn | null = null
  let disposed = false
  let counter = 0

  /**
   * One signal for every recall call, aborted when the conversation surface closes.
   *
   * Shared rather than one per call because these calls are not the person's to
   * wait for: closing the window stops all of them, and a set of per-call
   * controllers would be a set of per-call leaks.
   */
  const recallAbort = new AbortController()

  /** The account and workspace both, or null when either is missing. */
  function currentScope (): BusinessScope | null {
    const scope = deps.scope()
    const businessId = deps.businessId()
    if (scope === null || businessId === null) return null
    return { serverHost: scope.serverHost, userId: scope.userId, businessId }
  }

  function scopeKeyOf (scope: BusinessScope): string {
    return `${scope.serverHost.trim().toLowerCase()}|${scope.userId}|${scope.businessId}`
  }

  /** The repositories for the signed-in business, refusing when there is none. */
  function scoped (): { scope: BusinessScope, repositories: ReturnType<BusinessStore['repositories']> } {
    if (disposed) throw new ChatError('not_signed_in')
    const scope = currentScope()
    if (scope === null) throw new ChatError('no_business')
    /*
     * The store is asked for the *account's* repositories, not the business's.
     * `repositories` parses a strict account scope and refuses the extra key, so
     * handing it the business scope would answer `invalid_request` on every call -
     * a refusal that looks like a bad request rather than what it is, a shape
     * mistake here. The business travels on every repository call instead.
     */
    return {
      scope,
      repositories: deps.store.repositories({ serverHost: scope.serverHost, userId: scope.userId }),
    }
  }

  /**
   * Whether the turn that produced an event is still the one that should be seen.
   *
   * Three things can go wrong while a model is answering: the person signs out, the
   * person switches workspace, or the workspace's access is withdrawn. All three
   * make the answer worthless, and all three are checked here rather than trusted to
   * the screen, because a screen that forgot would leak a reply into the wrong
   * conversation.
   */
  function stillCurrent (turn: ActiveTurn): boolean {
    if (disposed) return false
    if (active === null || active.turnId !== turn.turnId) return false
    const scope = currentScope()
    if (scope === null) return false
    return scopeKeyOf(scope) === turn.scopeKey
  }

  /** Publish, unless the turn it belongs to has been superseded. */
  function publish (turn: ActiveTurn, event: ChatEvent): void {
    if (!stillCurrent(turn)) return
    deps.publish(event)
  }

  function endTurn (turn: ActiveTurn): void {
    if (active !== null && active.turnId === turn.turnId) active = null
  }

  function startTurn (scope: BusinessScope, threadId: string): ActiveTurn {
    if (active !== null) throw new ChatError('busy')
    counter += 1
    const turn: ActiveTurn = {
      turnId: `turn-${counter.toString(16)}-${Date.now().toString(16)}`,
      threadId,
      scopeKey: scopeKeyOf(scope),
      abort: new AbortController(),
    }
    active = turn
    return turn
  }

  /**
   * The conversation to send: the thread's tail, bounded twice.
   *
   * Trimmed from the oldest end, because a follow-up question is about the recent
   * part. A turn that sent everything would eventually be refused as
   * `context_too_long`, which is a worse answer than a shorter question about the
   * same thing.
   *
   * What changed with memory: the tail is no longer the whole of it. The assembled
   * context also carries what this business has settled and a compression of what
   * the thread already covered, each labelled, and the budget is shared across all
   * three. `trimmed` is returned because a screen that wants to say "this thread is
   * being summarised" should be told rather than left to guess.
   */
  function contextFor (
    repositories: ReturnType<BusinessStore['repositories']>,
    scope: BusinessScope,
    threadId: string,
    routed: RoutedProvider | null = null,
    pendingText: string | null = null,
  ): ReturnType<typeof assembleContext> {
    // Twice the window is read so the budget, rather than the query, decides what
    // is dropped: a page of short turns and a page of long ones are not the same
    // amount of conversation.
    const stored = repositories.messages.list(scope, threadId, { limit: CONTEXT_MESSAGES * 2 })
    return assembleContext({
      summary: repositories.summaries.get(scope, threadId),
      memory: repositories.memory.list(scope),
      /*
       * `pendingText` is the question a preview is previewing. It joins the stored
       * turns *before* the trim rather than after it, because that is where the send
       * puts it: the send writes the row first and reads the context back. Appended
       * afterwards it would sit outside the budget, and the panel could show a
       * message the send would then drop.
       */
      messages: pendingText === null ? stored : [...stored, pendingRow(threadId, stored, pendingText)],
      budget: budgetFor(routed),
      maxMessages: CONTEXT_MESSAGES,
    })
  }

  /**
   * The question being asked, in the shape a stored row has.
   *
   * A preview runs before anything is written, so the turn it describes is not a row
   * yet. Giving it this shape is what lets it travel the same path as a stored one
   * instead of a second path written to imitate it. The id and the timestamp are
   * placeholders: `assembleContext` reads the role, the wording and the sequence
   * number, and nothing built here is ever stored or published.
   */
  function pendingRow (threadId: string, stored: readonly MessageRow[], text: string): MessageRow {
    let last = 0
    for (const row of stored) {
      if (row.seq > last) last = row.seq
    }
    return {
      id: 'pending',
      threadId,
      // Above every stored turn, so the rule that drops what a summary already covers
      // reads this as the newest thing said rather than as something it has seen.
      seq: last + 1,
      role: 'user',
      content: text,
      provider: null,
      model: null,
      cloud: null,
      createdAt: new Date(0).toISOString(),
    }
  }

  /**
   * What would actually go out, and the panel that describes it.
   *
   * One function for both, so the preview and the send cannot disagree: the panel is
   * the list the provider is handed, described in the preview's own shape. They were
   * built separately until this was written, which is how the preview came to be
   * budgeted for another model and to include a message the send would drop. A
   * preview that is not the send is worse than no preview at all, because the person
   * is being asked to approve words that are not the words leaving.
   *
   * A cloud turn is substituted and checked for anything that still identifies
   * somebody; the caller is what refuses to send in that case. A local model runs on
   * this machine, so its list is the person's own words and nothing can be blocked.
   */
  function outboundFor (
    conversation: ChatMessage[],
    routed: RoutedProvider,
    identity: PrivacyIdentity,
  ): { preview: PayloadPreviewReply; messages: ChatMessage[] } {
    if (!routed.cloud) {
      return { preview: emptyPreviewFor(buildLocalPayload(conversation)), messages: conversation }
    }
    const built = buildCloudPayload(conversation, identity)
    return { preview: emptyPreviewFor(built.preview), messages: built.messages }
  }

  /**
   * The budget for the model that is about to answer.
   *
   * A model that says it has an eight-thousand token window gets a context sized for
   * it rather than the ceiling this app uses when it knows nothing. An unknown
   * preset or model falls back to the ceiling rather than to a guess: being told
   * `context_too_long` is honest, and refusing to send would not be.
   */
  function budgetFor (routed: RoutedProvider | null): number {
    if (routed === null) return CONTEXT_CHARS
    try {
      const preset = findPreset(routed.presetId)
      if (preset === null) return CONTEXT_CHARS
      const capabilities = resolveCapabilities(preset, (routed.modelId ?? preset.defaultModel).trim())
      return budgetForWindow(capabilities.contextWindow)
    } catch {
      return CONTEXT_CHARS
    }
  }

  /** The thread, refusing an id this business does not own. */
  function requireThread (
    repositories: ReturnType<BusinessStore['repositories']>,
    scope: BusinessScope,
    threadId: string,
  ): ThreadRow {
    return repositories.threads.get(scope, threadId)
  }

  /**
   * One turn, from the stored question to the stored answer.
   *
   * Every exit publishes exactly one terminal event - `done` or `failed` - which is
   * what lets the screen stop a spinner rather than waiting for something that will
   * never come.
   */
  async function runTurn (input: {
    turn: ActiveTurn
    scope: BusinessScope
    repositories: ReturnType<BusinessStore['repositories']>
    routed: RoutedProvider
    threadId: string
    userMessageId: string
    identity: PrivacyIdentity
  }): Promise<void> {
    const { turn, scope, repositories, routed, threadId, userMessageId, identity } = input
    const signal = turn.abort.signal
    let accumulated = ''

    try {
      const conversation = contextFor(repositories, scope, threadId, routed).messages
      if (conversation.length === 0) throw new ChatError('internal_error')

      /*
       * The same call the preview makes, on the same list. `preview.blocked` is the
       * one thing a send does that a preview cannot: a preview draws the refusal, a
       * send raises it. Nothing is transmitted in that case.
       */
      const outboundForTurn = outboundFor(conversation, routed, identity)
      if (outboundForTurn.preview.blocked) throw new ChatError('blocked_content')
      const outbound = outboundForTurn.messages

      /*
       * The context the guard needs: which account, which workspace, which provider
       * and why. The remote workspace id is the number the provider side knows; the
       * local row id would mean nothing outside this database.
       *
       * `unredactedContent` is the promise this turn makes to the guard. The privacy
       * rules only rewrite the text for a cloud model, so a turn that skipped them is
       * carrying the person's own words - and the guard then holds every hop of it to
       * a verified local address. Without that, a local server could answer with a
       * redirect to a public one and the transport would carry the private text out.
       */
      const business = repositories.businesses.get(scope, scope.businessId)
      const ctx = createCallContext({
        businessId: business.remoteWorkspaceId ?? null,
        providerId: routed.provider.id,
        userId: scope.userId,
        purpose: 'quick',
        unredactedContent: !routed.cloud,
      }, signal)

      const request: ChatRequest = {
        modelId: routed.modelId ?? undefined,
        messages: outbound,
      }

      for await (const delta of routed.provider.stream(request, ctx)) {
        if (signal.aborted) throw new ChatError('aborted')
        if (delta.type === 'text') {
          accumulated += delta.text
          publish(turn, { type: 'delta', turnId: turn.turnId, threadId, text: delta.text })
        }
        if (delta.type === 'done') break
      }

      // A reply that outlived its account is stored nowhere: writing it would put
      // one person's answer into a session that is no longer theirs.
      if (!stillCurrent(turn)) return

      // The attribution the plan requires: which provider, which model, and whether
      // it ran in the cloud. `presetId` rather than the adapter's internal id,
      // because the preset is what the screen names.
      const assistant = repositories.messages.append(scope, {
        threadId,
        role: 'assistant',
        content: accumulated,
        provider: routed.presetId,
        model: routed.modelId,
        cloud: routed.cloud,
      })
      repositories.threads.touch(scope, threadId)

      publish(turn, { type: 'done', turnId: turn.turnId, threadId, message: assistant })

      /*
       * What the turn taught the app is worked out after the person already has
       * their answer. Deliberately after: summarising and remembering are a second
       * and third model call, and holding the finished reply back to make them
       * would spend the person's time on housekeeping they did not ask for.
       */
      void recallPass({ scope, repositories, routed, threadId, userMessageId, identity })
    } catch (error) {
      const failure = asTurnFailure(error)

      /*
       * A cancelled turn keeps what it has. The partial answer is stored so the
       * person can read what arrived before they stopped it, and a terminal event
       * still fires so the screen stops waiting. A partial answer that cannot be
       * stored must not be presented as if it had been.
       */
      const stopped = failure.failure === 'aborted'
      if (stopped && accumulated.length > 0 && stillCurrent(turn)) {
        try {
          const partial = repositories.messages.append(scope, {
            threadId,
            role: 'assistant',
            content: accumulated,
            provider: routed.presetId,
            model: routed.modelId,
            cloud: routed.cloud,
          })
          repositories.threads.touch(scope, threadId)
          publish(turn, { type: 'done', turnId: turn.turnId, threadId, message: partial })
          return
        } catch {
          // Falls through to the failure event.
        }
      }

      publish(turn, {
        type: 'failed',
        turnId: turn.turnId,
        threadId,
        failure: failure.failure,
        userMessageId,
        retryable: isRetryable(failure.failure),
      })
    } finally {
      endTurn(turn)
    }
  }

  /**
   * What a finished turn teaches the app: a summary, remembered items, and maybe a draft.
   *
   * Every part is best-effort and every part fails alone. The person has already
   * been given their answer, so a model having a bad minute here must cost them
   * nothing - not a failed turn, not an error on screen, not a lost reply. What it
   * costs is that this turn teaches the app nothing, which is the right trade and
   * is recorded as a fixed word rather than as text, because the text is a
   * conversation.
   *
   * The three passes run in order of what is most valuable to lose least: the
   * summary first because it is what keeps a long thread usable, then the items,
   * then a draft, which is the only one the person can ask for again by simply
   * asking again.
   */
  async function recallPass (input: {
    scope: BusinessScope
    repositories: ReturnType<BusinessStore['repositories']>
    routed: RoutedProvider
    threadId: string
    userMessageId: string
    identity: PrivacyIdentity
  }): Promise<void> {
    const { scope, repositories, routed, threadId, userMessageId, identity } = input

    try {
      // Nothing is learned for an account that has ended. Both a sign-out and a
      // workspace switch make this throw, and a summary written after either would
      // be one person's reading of another person's conversation.
      routed.assertCurrent()
      const messages = repositories.messages.list(scope, threadId)
      if (messages.length === 0) return

      const business = repositories.businesses.get(scope, scope.businessId)
      const ctx = createCallContext({
        businessId: business.remoteWorkspaceId ?? null,
        providerId: routed.provider.id,
        userId: scope.userId,
        purpose: 'quick',
        // The same promise the turn made: a cloud call has had its identifying
        // words replaced, a local one has not.
        unredactedContent: !routed.cloud,
      }, recallAbort.signal)

      await passWith('summary', async () => {
        const previous = repositories.summaries.get(scope, threadId)
        const covered = previous === null ? 0 : previous.coversThroughSeq
        if (!needsSummary(messages, covered)) return

        const plan = planSummary(messages, covered)
        if (plan === null) return

        const sendable = recallConversation(
          [{ role: 'user', parts: [{ type: 'text', text: summaryBatch(previous, plan) }] }],
          routed,
          identity,
        )
        // Null is the privacy rule refusing, which is not a failure to report.
        if (sendable === null) return

        const answer = await askStructured(
          { routed, ctx, system: SUMMARY_PROMPT, conversation: sendable },
          summaryReplySchema,
        )
        routed.assertCurrent()
        applySummary(repositories, scope, threadId, answer.summary, plan.coversThroughSeq)
      })

      /*
       * Only the exchange that just happened, not the whole thread. Extraction reads
       * for what was *said*; the same sentence re-read on every later turn is the
       * same item offered again, and the repository would refuse it while the cost
       * was paid anyway.
       */
      const exchange = messages.slice(-2)
      await passWith('memory', async () => {
        if (exchange.length === 0) return
        const sendable = recallConversation(
          [{ role: 'user', parts: [{ type: 'text', text: numberedBatch(exchange).join('\n') }] }],
          routed,
          identity,
        )
        if (sendable === null) return

        const extracted = await askStructured(
          { routed, ctx, system: EXTRACTION_PROMPT, conversation: sendable },
          extractedMemorySchema,
        )
        routed.assertCurrent()
        applyExtraction(repositories, scope, exchange, extracted)
      })

      /*
       * A draft is only drafted from the person's own message. The cue keeps the
       * cost down; the rule that a draft needs a person asking is enforced where
       * the draft is written, against the message id this turn was started with
       * rather than against anything a model said.
       */
      const asked = messages.find((row) => row.id === userMessageId)
      if (asked === undefined || asked.role !== 'user' || !DRAFT_CUE.test(asked.content)) return

      await passWith('proposal', async () => {
        const sendable = recallConversation(
          [{ role: 'user', parts: [{ type: 'text', text: asked.content }] }],
          routed,
          identity,
        )
        if (sendable === null) return

        const drafted = await askStructured(
          { routed, ctx, system: DRAFTING_PROMPT, conversation: sendable },
          draftedTasksSchema,
        )
        routed.assertCurrent()
        applyProposals(repositories, scope, threadId, drafted, 'user_message')
      })
    } catch {
      // The account ended mid-pass. Nothing was written and nothing is owed.
    }

    /**
     * Run one pass, keeping its failure to itself.
     *
     * The word is fixed per pass and carries no text: these calls carry a
     * conversation, and a log line is not the place to learn one.
     */
    async function passWith (name: string, work: () => Promise<void>): Promise<void> {
      try {
        await work()
      } catch {
        deps.log?.warn(`recall pass skipped (${name})`)
      }
    }
  }

  /** A preview refusal keeps the shape of a preview, so the screen draws one panel. */
  function emptyPreview (cloud: boolean): PayloadPreviewReply {
    return { cloud, messages: [], placeholders: [], blocked: false, blockedReason: null }
  }

  return {
    listThreads (request) {
      try {
        const { scope, repositories } = scoped()
        const search = typeof request?.search === 'string' ? request.search.trim() : ''
        const threads = repositories.threads.list(scope, search.length > 0 ? { search } : {})
        return { threads }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    createThread (request) {
      try {
        const { scope, repositories } = scoped()
        const title = typeof request?.title === 'string' ? request.title.trim() : ''
        const thread = repositories.threads.create(scope, {
          title: title.length > 0 ? title : PLACEHOLDER_TITLE,
        })
        return { thread }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    renameThread (request) {
      try {
        const { scope, repositories } = scoped()
        const thread = repositories.threads.rename(scope, request.threadId, request.title)
        return { thread }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    pinThread (request) {
      try {
        const { scope, repositories } = scoped()
        const thread = repositories.threads.setPinned(scope, request.threadId, request.pinned)
        return { thread }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    removeThread (request) {
      try {
        const { scope, repositories } = scoped()
        /*
         * A turn running in the thread being removed is stopped first. Letting it
         * finish would write an assistant message into a row that no longer exists,
         * and the refusal would surface as an internal error on a screen nobody is
         * looking at.
         */
        if (active !== null && active.threadId === request.threadId) active.abort.abort()
        /*
         * The read comes first so removing something that is already gone answers
         * `not_found` rather than a cheerful `removed: true`. The repository's own
         * delete is deliberately idempotent - a reply arriving for a thread the
         * person just deleted is ordinary - but a screen asking to remove an id it
         * no longer has is asking about something that is not here.
         */
        requireThread(repositories, scope, request.threadId)
        repositories.threads.remove(scope, request.threadId)
        return { removed: true }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    listMessages (request) {
      try {
        const { scope, repositories } = scoped()
        const options = typeof request?.afterSeq === 'number' ? { afterSeq: request.afterSeq } : {}
        const messages = repositories.messages.list(scope, request.threadId, options)
        return { messages }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    payloadPreview (request) {
      const { scope, repositories } = scoped()
      const providers = deps.providers()
      if (providers === null) throw new ChatError('unsupported')

      // A preview is refused for a thread this business does not own, so it cannot
      // be used to probe for ids.
      requireThread(repositories, scope, request.threadId)

      /*
       * Opened with the model, exactly as `sendMessage` opens it. The budget for a
       * turn comes from the window the answering model says it has, so opening
       * without it sized this list for a different model than the one that would
       * answer.
       *
       * The question is handed in rather than appended afterwards, so it goes through
       * the same trim a stored turn goes through. The preview writes nothing, starts
       * no turn and calls no model: `outboundFor` is the same pure pair of
       * substitutions the send runs over the same list.
       */
      const routed = providers.openProvider(request.presetId, request.modelId)
      const conversation = contextFor(repositories, scope, request.threadId, routed, request.text).messages
      return outboundFor(conversation, routed, deps.identity()).preview
    },

    cancelTurn (request) {
      if (active === null || active.threadId !== request.threadId) {
        return { turnId: '', stopped: false }
      }
      const turn = active
      turn.abort.abort()
      return { turnId: turn.turnId, stopped: true }
    },

    async sendMessage (request) {
      const { scope, repositories } = scoped()
      const providers = deps.providers()
      if (providers === null) throw new ChatError('unsupported')

      // The thread must belong to this business before anything is written into it.
      // The repository would refuse too; checking first keeps the refusal ahead of
      // the person's own message being saved into a thread that is not theirs.
      requireThread(repositories, scope, request.threadId)

      const routed = providers.openProvider(request.presetId, request.modelId)
      const turn = startTurn(scope, request.threadId)

      try {
        const userMessage = repositories.messages.append(scope, {
          threadId: request.threadId,
          role: 'user',
          content: request.text,
        })

        // A thread that has only this message is named after it, so the sidebar
        // says what the conversation is about without another call to a model.
        const thread = repositories.threads.get(scope, request.threadId)
        if (thread.title === PLACEHOLDER_TITLE || thread.title.trim() === '') {
          repositories.threads.rename(scope, request.threadId, titleFrom(request.text))
        }
        repositories.threads.touch(scope, request.threadId)

        const reply: SendMessageReply = {
          turnId: turn.turnId,
          threadId: request.threadId,
          userMessage,
        }

        /*
         * The turn runs without being awaited, so the screen has its id immediately.
         * Its failures are reported as events; a rejection here would be a bug in
         * this file, and an unhandled rejection would take the main process down.
         */
        void runTurn({
          turn,
          scope,
          repositories,
          routed,
          threadId: request.threadId,
          userMessageId: userMessage.id,
          identity: deps.identity(),
        }).catch(() => {
          deps.log?.warn('chat turn ended without reporting')
          endTurn(turn)
        })

        return reply
      } catch (error) {
        endTurn(turn)
        throw asChatFailure(error)
      }
    },

    listMemory () {
      try {
        const { scope, repositories } = scoped()
        return { memory: repositories.memory.list(scope) }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    editMemory (request) {
      try {
        const { scope, repositories } = scoped()
        /*
         * The repository marks an edit as the person's own and locks it, which is
         * what stops a later extraction pass from replacing their correction with
         * the wording a model produced first. No extra flag is needed here: the act
         * of editing is the statement that this wording is the true one.
         */
        return { item: repositories.memory.edit(scope, request.memoryId, request.text) }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    removeMemory (request) {
      try {
        const { scope, repositories } = scoped()
        /*
         * The read comes first so removing something already gone answers
         * `not_found` rather than a cheerful success, for the same reason a thread
         * removal does: a screen asking about an id it no longer has is asking
         * about something that is not here.
         */
        repositories.memory.get(scope, request.memoryId)
        repositories.memory.remove(scope, request.memoryId)
        return { removed: true }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    listProposals () {
      try {
        const { scope, repositories } = scoped()
        return { proposals: repositories.proposals.list(scope) }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    setProposalStatus (request) {
      try {
        const { scope, repositories } = scoped()
        /*
         * Recording a decision is the whole of it. There is no branch here that
         * calls anywhere else, and there is no import in this file that could: the
         * absence of an execution path is the guarantee, not a check inside one.
         */
        return { proposal: repositories.proposals.setStatus(scope, request.proposalId, request.status) }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    editProposal (request) {
      try {
        const { scope, repositories } = scoped()
        /*
         * Three fields, rebuilt by the repository from the named values. Nothing here
         * can widen what a draft holds, and nothing here can make it execute: the
         * same absence of an execution path that governs approval governs an edit.
         */
        return {
          proposal: repositories.proposals.update(scope, request.proposalId, {
            title: request.title,
            notes: request.notes,
            dueHint: request.dueHint,
          }),
        }
      } catch (error) {
        throw asChatFailure(error)
      }
    },

    async closeThread (request) {
      const { scope, repositories } = scoped()
      requireThread(repositories, scope, request.threadId)

      const messages = repositories.messages.list(scope, request.threadId)
      const providers = deps.providers()

      /*
       * The model to ask is the one that answered last in this thread, read from
       * the stored row rather than from a request: closing a thread is not a place
       * for a caller to choose which provider sees its content. A thread nobody has
       * answered in has nothing to compress and answers honestly.
       */
      let routed: RoutedProvider | null = null
      for (let index = messages.length - 1; index >= 0 && providers !== null; index -= 1) {
        const row = messages[index]
        if (row === undefined || row.role !== 'assistant' || row.provider === null) continue
        try {
          routed = providers.openProvider(row.provider, row.model)
        } catch {
          routed = null
        }
        break
      }

      if (routed === null || messages.length === 0) return { summary: null, added: 0 }

      const identity = deps.identity()
      const business = repositories.businesses.get(scope, scope.businessId)
      const ctx = createCallContext({
        businessId: business.remoteWorkspaceId ?? null,
        providerId: routed.provider.id,
        userId: scope.userId,
        purpose: 'quick',
        unredactedContent: !routed.cloud,
      }, recallAbort.signal)

      let summary: SummaryRow | null = repositories.summaries.get(scope, request.threadId)
      let added = 0

      // A closing pass reads the whole thread, not the last exchange: the point of
      // closing is that nothing said in it is still only in the thread.
      const plan = planSummary(messages, summary === null ? 0 : summary.coversThroughSeq, 0)
      if (plan !== null) {
        const sendable = recallConversation(
          [{ role: 'user', parts: [{ type: 'text', text: summaryBatch(summary, plan) }] }],
          routed,
          identity,
        )
        if (sendable !== null) {
          try {
            const answer = await askStructured(
              { routed, ctx, system: SUMMARY_PROMPT, conversation: sendable },
              summaryReplySchema,
            )
            routed.assertCurrent()
            summary = applySummary(repositories, scope, request.threadId, answer.summary, plan.coversThroughSeq)
          } catch {
            deps.log?.warn('recall pass skipped (summary)')
          }
        }
      }

      const sendable = recallConversation(
        [{ role: 'user', parts: [{ type: 'text', text: numberedBatch(messages).join('\n') }] }],
        routed,
        identity,
      )
      if (sendable !== null) {
        try {
          const extracted = await askStructured(
            { routed, ctx, system: EXTRACTION_PROMPT, conversation: sendable },
            extractedMemorySchema,
          )
          routed.assertCurrent()
          added = applyExtraction(repositories, scope, messages, extracted).added
        } catch {
          deps.log?.warn('recall pass skipped (memory)')
        }
      }

      return { summary, added }
    },

    dispose () {
      disposed = true
      // Both the turn in progress and the housekeeping behind it stop here. A
      // summary written after the window closed would be a write nobody is left
      // to read.
      recallAbort.abort()
      if (active !== null) active.abort.abort()
      active = null
    },
  }
}

/** A preview in the reply's own shape, with its lists copied out of the readonly ones. */
function emptyPreviewFor (preview: {
  cloud: boolean
  messages: readonly { role: 'system' | 'user' | 'assistant', text: string }[]
  placeholders: readonly { token: string, label: string }[]
  blocked: boolean
  blockedReason: string | null
}): PayloadPreviewReply {
  return {
    cloud: preview.cloud,
    messages: preview.messages.map((message) => ({ role: message.role, text: message.text })),
    placeholders: preview.placeholders.map(({ token, label }) => ({ token, label })),
    blocked: preview.blocked,
    blockedReason: preview.blockedReason,
  }
}
