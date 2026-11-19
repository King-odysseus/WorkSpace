/*
 * What the chat surface of the desktop app is allowed to say.
 *
 * Same discipline as the access and Models surfaces: one fixed channel name per
 * request, one strict schema per request, one strict schema per reply, and a
 * refusal that is a token rather than an error object. A page names a thread and
 * some text; it never names an account, a business, a URL or a channel.
 *
 * Three decisions are worth stating, because each of them is a rule the rest of
 * this feature leans on.
 *
 * 1. A reply is the stored row. `listMessages` answers with the message rows the
 *    repository holds, not with a separate screen shape. A second shape would be
 *    a second place for "which provider answered" to be dropped, and the plan's
 *    attribution rule is exactly the thing that must not be dropped.
 *
 * 2. A streamed turn is identified, not ordered. Every event carries the turn id
 *    it belongs to, so the screen can discard an event from a turn it has already
 *    abandoned. Without that, a cancelled turn's last delta lands in whatever
 *    conversation is open by then.
 *
 * 3. The failure list is closed. A caller maps a token to its own words, and a
 *    token this build does not know is a bug in the build rather than a sentence
 *    to invent.
 */

import { z } from 'zod'
import {
  memoryRowSchema,
  messageRowSchema,
  proposalRowSchema,
  summaryRowSchema,
  threadRowSchema,
} from './storage-contract.js'

/** Bumped when a payload's meaning changes rather than its shape. */
export const CHAT_VERSION = 1

/**
 * The channel names.
 *
 * Written out rather than generated: the preload copies these strings by hand and
 * a drift guard compares the two lists, so a rename here is caught at test time
 * instead of becoming a channel that answers nothing.
 */
export const CHAT_CHANNELS = Object.freeze({
  listThreads: 'zuri:chat:listThreads',
  createThread: 'zuri:chat:createThread',
  renameThread: 'zuri:chat:renameThread',
  pinThread: 'zuri:chat:pinThread',
  removeThread: 'zuri:chat:removeThread',
  listMessages: 'zuri:chat:listMessages',
  sendMessage: 'zuri:chat:sendMessage',
  cancelTurn: 'zuri:chat:cancelTurn',
  payloadPreview: 'zuri:chat:payloadPreview',
  /*
   * Remembered items and drafted actions. These are on the chat surface rather
   * than a surface of their own because every one of them is about a conversation:
   * an item remembers what was said, a draft is drawn under the reply that
   * suggested it, and closing a thread is what settles both.
   */
  listMemory: 'zuri:chat:listMemory',
  editMemory: 'zuri:chat:editMemory',
  removeMemory: 'zuri:chat:removeMemory',
  listProposals: 'zuri:chat:listProposals',
  setProposalStatus: 'zuri:chat:setProposalStatus',
  editProposal: 'zuri:chat:editProposal',
  closeThread: 'zuri:chat:closeThread',
  /** Main to renderer: one event of the turn that is currently running. */
  event: 'zuri:chat:event',
})

export type ChatRequestChannelName = Exclude<keyof typeof CHAT_CHANNELS, 'event'>

/* ------------------------------------------------------------------ *
 * Refusals
 * ------------------------------------------------------------------ */

/**
 * Every way this surface can refuse.
 *
 * The first group is about the request, the second about the person's session,
 * the third about the network, and the last about what the request contained. A
 * `blocked_content` is the privacy rule refusing to send something, which is a
 * decision rather than a failure to reach anybody.
 */
export const CHAT_FAILURES = Object.freeze([
  'untrusted_sender',
  'invalid_request',
  'not_signed_in',
  'no_business',
  'not_found',
  'busy',
  'unsupported',
  'aborted',
  'stale',
  'network',
  'timeout',
  'provider_unauthorized',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_rejected',
  'model_not_found',
  'context_too_long',
  'malformed_response',
  'schema_mismatch',
  'blocked_content',
  'storage_unavailable',
  'internal_error',
] as const)

export type ChatFailure = (typeof CHAT_FAILURES)[number]

/** One plain sentence per token. Never a value, never a URL. */
export const CHAT_FAILURE_MESSAGES: Readonly<Record<ChatFailure, string>> = Object.freeze({
  untrusted_sender: 'That window is not allowed to ask for this.',
  invalid_request: 'That request could not be understood.',
  not_signed_in: 'Nobody is signed in.',
  no_business: 'Choose a workspace first.',
  not_found: 'That conversation is not here.',
  busy: 'A reply is already being written.',
  unsupported: 'That model cannot do this.',
  aborted: 'That reply was stopped.',
  stale: 'That request belonged to a session that has ended.',
  network: 'The provider could not be reached.',
  timeout: 'The provider took too long to answer.',
  provider_unauthorized: 'The provider rejected the key.',
  provider_rate_limited: 'The provider is limiting how often this can be asked.',
  provider_unavailable: 'The provider is having trouble.',
  provider_rejected: 'The provider turned that request down.',
  model_not_found: 'That model is not available on this provider.',
  context_too_long: 'That conversation is too long for this model.',
  malformed_response: 'The provider sent something this app could not read.',
  schema_mismatch: 'The model did not answer in the shape that was asked for.',
  blocked_content: 'Something in that message identifies a person or a business.',
  storage_unavailable: 'Encrypted storage is not available on this machine.',
  internal_error: 'Something went wrong inside the app.',
})

/** An error the screen knows how to draw. Carries a token, never a value. */
export class ChatError extends Error {
  readonly failure: ChatFailure

  constructor (failure: ChatFailure) {
    super(CHAT_FAILURE_MESSAGES[failure])
    this.name = 'ChatError'
    this.failure = failure
  }
}

/* ------------------------------------------------------------------ *
 * Requests
 * ------------------------------------------------------------------ */

/** An id as the storage layer writes one: lowercase hex, short. */
const idSchema = z.string().min(1).max(64)

/**
 * A conversation title.
 *
 * Empty is allowed and means "name this from what is said in it", which is what a
 * new conversation is until the person types. It is trimmed by the service so a
 * title of spaces does not become an unnamed row.
 */
const titleSchema = z.string().max(200)

/**
 * What to say.
 *
 * The bound is the message row's own, restated here so an oversized turn is
 * refused before a database write rather than after one. `presetId` names the
 * provider *entry*, never an address: the address is the entry's.
 */
export const sendMessageRequestSchema = z.strictObject({
  threadId: idSchema,
  text: z.string().min(1).max(200_000),
  presetId: z.string().min(1).max(60),
  modelId: z.string().min(1).max(200).optional(),
})

export const listThreadsRequestSchema = z.strictObject({
  search: z.string().max(120).optional(),
})

export const createThreadRequestSchema = z.strictObject({
  title: titleSchema.optional(),
})

export const threadIdRequestSchema = z.strictObject({ threadId: idSchema })

export const renameThreadRequestSchema = z.strictObject({
  threadId: idSchema,
  title: titleSchema,
})

export const pinThreadRequestSchema = z.strictObject({
  threadId: idSchema,
  pinned: z.boolean(),
})

export const listMessagesRequestSchema = z.strictObject({
  threadId: idSchema,
  /** Strictly after this sequence number, for drawing a longer thread in pages. */
  afterSeq: z.number().int().nonnegative().max(1_000_000).optional(),
})

/**
 * What a turn would send, before it is sent.
 *
 * `modelId` is here for the same reason it is on a send: the budget for a turn comes
 * from the window the answering model says it has, so a preview built without the
 * model would size the context for a different one and show a list the send does not
 * use. Optional and bounded exactly as on `sendMessageRequestSchema`, because a
 * preview of a send that omits it has to be a preview of that same send.
 */
export const payloadPreviewRequestSchema = z.strictObject({
  threadId: idSchema,
  presetId: z.string().min(1).max(60),
  text: z.string().min(1).max(200_000),
  modelId: z.string().min(1).max(200).optional(),
})

/**
 * The remembered items of the business.
 *
 * No thread id: memory belongs to the business, not to the conversation it was
 * learned in. Scoping it to a thread would hide what the assistant knows every
 * time somebody starts a new one.
 */
export const listMemoryRequestSchema = z.strictObject({})

/**
 * A person's correction to a remembered item.
 *
 * The bound is the row's own. `memoryId` is an id the screen already has; a
 * caller with no id has nothing to edit.
 */
export const editMemoryRequestSchema = z.strictObject({
  memoryId: idSchema,
  text: z.string().min(1).max(4_000),
})

export const removeMemoryRequestSchema = z.strictObject({ memoryId: idSchema })

export const listProposalsRequestSchema = z.strictObject({})

/**
 * A person's decision about a draft.
 *
 * `pending` and `expired` are deliberately not offered. A proposal arrives
 * pending and becomes expired on its own; the two things a person can say about
 * one are yes and no. Accepting `pending` here would be offering a way to make a
 * decided draft undecided, which is not a decision anybody needs to record.
 */
export const setProposalStatusRequestSchema = z.strictObject({
  proposalId: idSchema,
  status: z.enum(['approved', 'rejected']),
})

/**
 * A person correcting a draft before they decide about it.
 *
 * Only the three fields a card draws, and only while the draft is still pending: the
 * row itself refuses an edit once a decision exists, because a decision made about
 * one wording must not end up attached to another.
 */
export const editProposalRequestSchema = z.strictObject({
  proposalId: idSchema,
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(600).optional(),
  dueHint: z.string().max(40).optional(),
})

/** Closing a thread settles its summary and its remembered items. */
export const closeThreadRequestSchema = z.strictObject({ threadId: idSchema })

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>
export type ListThreadsRequest = z.infer<typeof listThreadsRequestSchema>
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>
export type ThreadIdRequest = z.infer<typeof threadIdRequestSchema>
export type RenameThreadRequest = z.infer<typeof renameThreadRequestSchema>
export type PinThreadRequest = z.infer<typeof pinThreadRequestSchema>
export type ListMessagesRequest = z.infer<typeof listMessagesRequestSchema>
export type PayloadPreviewRequest = z.infer<typeof payloadPreviewRequestSchema>
export type ListMemoryRequest = z.infer<typeof listMemoryRequestSchema>
export type EditMemoryRequest = z.infer<typeof editMemoryRequestSchema>
export type RemoveMemoryRequest = z.infer<typeof removeMemoryRequestSchema>
export type ListProposalsRequest = z.infer<typeof listProposalsRequestSchema>
export type SetProposalStatusRequest = z.infer<typeof setProposalStatusRequestSchema>
export type EditProposalRequest = z.infer<typeof editProposalRequestSchema>
export type CloseThreadRequest = z.infer<typeof closeThreadRequestSchema>

/** The one schema per channel, so the IPC layer is a table rather than a chain. */
export const CHAT_REQUEST_SCHEMAS: Readonly<Record<ChatRequestChannelName, z.ZodTypeAny>> =
  Object.freeze({
    listThreads: listThreadsRequestSchema,
    createThread: createThreadRequestSchema,
    renameThread: renameThreadRequestSchema,
    pinThread: pinThreadRequestSchema,
    removeThread: threadIdRequestSchema,
    listMessages: listMessagesRequestSchema,
    sendMessage: sendMessageRequestSchema,
    cancelTurn: threadIdRequestSchema,
    payloadPreview: payloadPreviewRequestSchema,
    listMemory: listMemoryRequestSchema,
    editMemory: editMemoryRequestSchema,
    removeMemory: removeMemoryRequestSchema,
    listProposals: listProposalsRequestSchema,
    setProposalStatus: setProposalStatusRequestSchema,
    editProposal: editProposalRequestSchema,
    closeThread: closeThreadRequestSchema,
  })

/* ------------------------------------------------------------------ *
 * Replies
 * ------------------------------------------------------------------ */

export const threadListReplySchema = z.strictObject({
  threads: z.array(threadRowSchema).max(200),
})

export const messageListReplySchema = z.strictObject({
  messages: z.array(messageRowSchema).max(500),
})

export const threadReplySchema = z.strictObject({ thread: threadRowSchema })

/**
 * What a send answers immediately.
 *
 * The answer is the turn's id, not its text: the text arrives as events. A caller
 * that has the id can discard events from a turn it has abandoned, which is the
 * only way a cancelled turn cannot leak into the next conversation.
 */
export const sendMessageReplySchema = z.strictObject({
  turnId: z.string().min(1).max(64),
  threadId: idSchema,
  userMessage: messageRowSchema,
})

export const cancelTurnReplySchema = z.strictObject({
  turnId: z.string().min(1).max(64),
  stopped: z.boolean(),
})

/**
 * One placeholder standing in for something that identifies a person or a
 * business, and the words it replaced.
 */
export const chatPlaceholderSchema = z.strictObject({
  token: z.string().min(1).max(40),
  label: z.string().min(1).max(40),
})

/**
 * The exact text a cloud provider would receive, and what was replaced to make it
 * acceptable.
 *
 * This is a preview, not a summary: `messages` is the same list, in the same
 * order, that the send would use. A person approving a preview is approving those
 * bytes, so anything else here would be a promise the send does not keep.
 */
export const payloadPreviewReplySchema = z.strictObject({
  cloud: z.boolean(),
  messages: z.array(
    z.strictObject({
      role: z.enum(['system', 'user', 'assistant']),
      text: z.string().max(200_000),
    }),
  ).max(200),
  placeholders: z.array(chatPlaceholderSchema).max(200),
  /** True when nothing would be sent because the content identifies someone. */
  blocked: z.boolean(),
  blockedReason: z.string().min(1).max(60).nullable(),
})

export type ThreadListReply = z.infer<typeof threadListReplySchema>
export type MessageListReply = z.infer<typeof messageListReplySchema>
export type ThreadReply = z.infer<typeof threadReplySchema>
export type SendMessageReply = z.infer<typeof sendMessageReplySchema>
export type CancelTurnReply = z.infer<typeof cancelTurnReplySchema>
export type PayloadPreviewReply = z.infer<typeof payloadPreviewReplySchema>

/** The business's remembered items, newest last, as the panel draws them. */
export const memoryListReplySchema = z.strictObject({
  memory: z.array(memoryRowSchema).max(500),
})

export const memoryReplySchema = z.strictObject({ item: memoryRowSchema })

export const proposalListReplySchema = z.strictObject({
  proposals: z.array(proposalRowSchema).max(200),
})

export const proposalReplySchema = z.strictObject({ proposal: proposalRowSchema })

/**
 * What closing a thread answers.
 *
 * `added` is how many items the closing pass newly remembered, and it is a
 * number rather than the items themselves because the panel already subscribes
 * to the list. `summary` is null when there was nothing worth summarising, which
 * is an ordinary answer for a thread of two lines.
 */
export const closeThreadReplySchema = z.strictObject({
  summary: summaryRowSchema.nullable(),
  added: z.number().int().nonnegative().max(500),
})

export type MemoryListReply = z.infer<typeof memoryListReplySchema>
export type MemoryReply = z.infer<typeof memoryReplySchema>
export type ProposalListReply = z.infer<typeof proposalListReplySchema>
export type ProposalReply = z.infer<typeof proposalReplySchema>
export type CloseThreadReply = z.infer<typeof closeThreadReplySchema>

export const CHAT_REPLY_SCHEMAS: Readonly<Record<ChatRequestChannelName, z.ZodTypeAny>> =
  Object.freeze({
    listThreads: threadListReplySchema,
    createThread: threadReplySchema,
    renameThread: threadReplySchema,
    pinThread: threadReplySchema,
    removeThread: z.strictObject({ removed: z.literal(true) }),
    listMessages: messageListReplySchema,
    sendMessage: sendMessageReplySchema,
    cancelTurn: cancelTurnReplySchema,
    payloadPreview: payloadPreviewReplySchema,
    listMemory: memoryListReplySchema,
    editMemory: memoryReplySchema,
    removeMemory: z.strictObject({ removed: z.literal(true) }),
    listProposals: proposalListReplySchema,
    setProposalStatus: proposalReplySchema,
    editProposal: proposalReplySchema,
    closeThread: closeThreadReplySchema,
  })

/** The reply to a refusal, on every channel. A token and its sentence, no value. */
export const chatFailureReplySchema = z.strictObject({
  ok: z.literal(false),
  failure: z.enum(CHAT_FAILURES),
  message: z.string().min(1).max(200),
})

export type ChatFailureReply = z.infer<typeof chatFailureReplySchema>

export function chatFailureReply (failure: ChatFailure): ChatFailureReply {
  return { ok: false, failure, message: CHAT_FAILURE_MESSAGES[failure] }
}

/* ------------------------------------------------------------------ *
 * Streamed events
 * ------------------------------------------------------------------ */

/**
 * One event of one turn.
 *
 * A delta is a fragment of text the screen appends. A `done` carries the stored
 * assistant row, so the screen ends up showing exactly what was persisted rather
 * than what it accumulated - the two can differ when a provider says something
 * the row schema then trims. A `failed` carries the token and the id of the
 * person's own message, which is what makes a retry possible without retyping.
 */
export const chatEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('delta'),
    turnId: z.string().min(1).max(64),
    threadId: idSchema,
    text: z.string().min(1).max(200_000),
  }),
  z.strictObject({
    type: z.literal('done'),
    turnId: z.string().min(1).max(64),
    threadId: idSchema,
    message: messageRowSchema,
  }),
  z.strictObject({
    type: z.literal('failed'),
    turnId: z.string().min(1).max(64),
    threadId: idSchema,
    failure: z.enum(CHAT_FAILURES),
    userMessageId: idSchema,
    /** True when retrying with the same text is worth offering. */
    retryable: z.boolean(),
  }),
])

export type ChatEvent = z.infer<typeof chatEventSchema>
export type ChatDeltaEvent = Extract<ChatEvent, { type: 'delta' }>
export type ChatDoneEvent = Extract<ChatEvent, { type: 'done' }>
export type ChatFailedEvent = Extract<ChatEvent, { type: 'failed' }>

/* ------------------------------------------------------------------ *
 * The page's bridge
 * ------------------------------------------------------------------ */

/**
 * What the page is given, and the whole of it.
 *
 * Fixed methods rather than a call-and-channel pair, for the same reason the other
 * surfaces are: a page that could name a channel could name one it was not meant
 * to have. `onEvent` is the only push, and it answers with a way to stop listening
 * so a screen that unmounts does not leave a listener appending to nothing.
 */
export interface ChatBridge {
  listThreads: (request: ListThreadsRequest) => Promise<unknown>
  createThread: (request: CreateThreadRequest) => Promise<unknown>
  renameThread: (request: RenameThreadRequest) => Promise<unknown>
  pinThread: (request: PinThreadRequest) => Promise<unknown>
  removeThread: (request: ThreadIdRequest) => Promise<unknown>
  listMessages: (request: ListMessagesRequest) => Promise<unknown>
  sendMessage: (request: SendMessageRequest) => Promise<unknown>
  cancelTurn: (request: ThreadIdRequest) => Promise<unknown>
  payloadPreview: (request: PayloadPreviewRequest) => Promise<unknown>
  listMemory: (request: ListMemoryRequest) => Promise<unknown>
  editMemory: (request: EditMemoryRequest) => Promise<unknown>
  removeMemory: (request: RemoveMemoryRequest) => Promise<unknown>
  listProposals: (request: ListProposalsRequest) => Promise<unknown>
  setProposalStatus: (request: SetProposalStatusRequest) => Promise<unknown>
  editProposal: (request: EditProposalRequest) => Promise<unknown>
  closeThread: (request: CloseThreadRequest) => Promise<unknown>
  onEvent: (listener: (event: unknown) => void) => () => void
}

/** The order the preload must copy `CHAT_CHANNELS` in, checked by a drift guard. */
export const CHAT_CHANNEL_ORDER: readonly ChatRequestChannelName[] = Object.freeze([
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
