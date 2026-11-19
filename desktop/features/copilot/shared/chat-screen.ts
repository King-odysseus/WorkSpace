/*
 * What the conversation screen draws, decided in functions rather than in branches
 * inside a component.
 *
 * The screen itself is a layout: it reads a bridge, keeps a little state, and draws.
 * Everything that could be wrong - which model a reply is attributed to, whether a
 * cloud payload was rewritten before it left, which remembered items exist and in
 * what order, whether a draft card may be acted on - is decided here, as a pure
 * function of rows this file is given. That is what makes the answers testable
 * without a browser, a database or a model, which is the same arrangement the
 * Models screen uses and for the same reason.
 *
 * Four rules are worth stating, because each is one a careless version breaks.
 *
 * 1. *An answer is attributed to the model that actually answered, not to the one
 *    the person picked.* The row carries the provider, the model and whether it ran
 *    in the cloud, and those three are what the chip reads. A screen that showed the
 *    picker's selection above every reply would be quietly lying the first time the
 *    two disagreed.
 *
 * 2. *Nothing here claims a fallback happened.* Automatic fallback is a later phase,
 *    so the honest line under an answer is that none is configured and this reply
 *    came from the model that was chosen. When fallback arrives it will add a field
 *    to the row, and this file will read it; inventing the sentence now would make a
 *    future fallback invisible and a present non-fallback sound like one.
 *
 * 3. *A draft card shows three fields and no more.* The payload is free-form, so the
 *    card reads `title`, `notes` and `dueHint` by name and shows nothing else. A card
 *    that spread the payload onto the screen would draw whatever a model happened to
 *    include, including fields that mean something to a later phase.
 *
 * 4. *Remembered items are grouped by kind, in the order of what changes an answer.*
 *    A settled decision outranks an assumption, and an assumption outranks a question
 *    nobody has answered. Ordering by insertion would put them in whatever order the
 *    extractor happened to emit them, which is not an order anybody chose.
 *
 * Nothing here talks to a provider, opens a database or reads a key. It is a pure
 * function of the rows the main process already validated.
 */

import type {
  MemoryKind,
  MemoryRow,
  MessageRow,
  ProposalRow,
  ThreadRow,
} from './storage-contract.js'
import type { PayloadPreviewReply } from './chat-contract.js'
import type { ModelInfo, ProviderCapabilities } from './providers/types.js'
import { capabilityChips, modelLabel, originLabel as originLabelFor } from './providers/models-screen.js'

/** Where an answer came from, as far as the stored row can say. */
export type AnswerOrigin = 'cloud' | 'local' | 'unknown'

/**
 * One answer's chip, and the sentence under it.
 *
 * `label` is the model's own name as the endpoint reported it. `origin` is what the
 * row recorded when the turn was stored, and `unknown` is a real answer: a row from
 * before the field existed, or one written by a path that did not know, must not be
 * drawn as `Cloud` on the strength of a guess.
 */
export interface AnswerAttribution {
  readonly label: string
  readonly provider: string | null
  readonly origin: AnswerOrigin
  readonly originLabel: string
  /** What is true about how this answer was produced. Never a claim of fallback. */
  readonly note: string
}

/** The sentence under every answer, because no fallback is configured yet. */
export const NO_FALLBACK_NOTE = 'No fallback is set up, so this answer came from the model you chose.'

/** Why this answer has no citations, stated rather than left as an empty list. */
export const NO_SOURCES_NOTE = 'Documents are not used yet, so this answer cites no sources.'

/** Said on every draft card: a decision is recorded, an action is not taken. */
export const PROPOSAL_NOTE = 'Approving records your decision only. Nothing is created or sent until Phase 6.'

/** Said once in the memory rail, so a person knows where their words are kept. */
export const MEMORY_LOCALITY_NOTE =
  'Stored on this device. Another business cannot see what this one has been told.'

/**
 * The origin of one stored answer.
 *
 * Null is not false: a row whose `cloud` was never recorded is `unknown`, and the
 * chip says so. Reading null as `false` would label an unrecorded answer `Local`,
 * which is the one label that would make a person relax about a cloud call.
 */
export function originOf (cloud: boolean | null | undefined): AnswerOrigin {
  if (cloud === true) return 'cloud'
  if (cloud === false) return 'local'
  return 'unknown'
}

/** The word in the chip. Reuses the Models screen's vocabulary so the two agree. */
export function originLabelOf (origin: AnswerOrigin): string {
  if (origin === 'cloud') return originLabelFor(true)
  if (origin === 'local') return originLabelFor(false)
  return 'Origin not recorded'
}

/**
 * The chip and sentence for one answer.
 *
 * Both fields are read from the row and neither from the picker. `streaming` is not
 * a property of a stored row - it is the screen's own state - so it is passed in
 * and only changes the note, never the attribution.
 */
export function answerAttribution (message: MessageRow, streaming = false): AnswerAttribution {
  const origin = originOf(message.cloud)
  const label = (message.model ?? '').trim().length > 0
    ? (message.model ?? '').trim()
    : 'Model not recorded'

  let note: string
  if (origin === 'unknown') {
    note = 'This answer did not record where it ran.'
  } else if (origin === 'local') {
    note = 'Answered by a model on this machine. Nothing left the device.'
  } else {
    note = 'Answered by a cloud model, after the text below was checked.'
  }

  return {
    label,
    provider: message.provider ?? null,
    origin,
    originLabel: originLabelOf(origin),
    note: streaming ? `${note} Still writing.` : note,
  }
}

/* ------------------------------------------------------------------ *
 * What a cloud request would send
 * ------------------------------------------------------------------ */

/** How a payload preview reads at a glance. */
export type PrivacyTone = 'blocked' | 'substituted' | 'direct' | 'checking'

export interface PrivacyView {
  readonly tone: PrivacyTone
  /** One short line, drawn next to the send button. */
  readonly headline: string
  /** What was checked or replaced, and its limit, or why nothing will be sent. */
  readonly detail: string
  /** True only when the request would not leave at all. */
  readonly blocks: boolean
}

/**
 * What the identifier checks do not cover.
 *
 * The residual check behind the composer (`chat/privacy.ts`) reads shapes: an email
 * address, a run of digits, a handle, a web address. It has no name detection of any
 * kind, so a message naming a client, a member of staff or a street address travels
 * exactly as typed. Stating that limit is the honest replacement for the sentence
 * this screen used to show, which promised that nothing in the message identified a
 * person or the business - a promise the code could not keep.
 */
const NOT_CHECKED_NOTE =
  'Client or staff names and postal addresses are not checked, so those would still be sent.'

/**
 * The preview of a cloud request, as the composer draws it.
 *
 * `null` is "not asked yet", not "safe". A screen that showed a green line before the
 * preview had arrived would be reassuring somebody about a check that had not run.
 *
 * A preview for a local model is not a privacy event at all, so it says the words go
 * to this machine rather than claiming they were rewritten.
 */
export function privacyView (preview: PayloadPreviewReply | null): PrivacyView {
  if (preview === null) {
    return {
      tone: 'checking',
      headline: 'Checking what would be sent',
      detail: 'The exact text is confirmed before anything leaves this device.',
      blocks: false,
    }
  }

  if (preview.blocked) {
    return {
      tone: 'blocked',
      headline: 'This would not be sent',
      detail: preview.blockedReason ?? 'The text still identifies somebody, so nothing would leave.',
      blocks: true,
    }
  }

  if (!preview.cloud) {
    return {
      tone: 'direct',
      headline: 'Runs on this machine',
      detail: 'The model is local, so this text is not sent anywhere.',
      blocks: false,
    }
  }

  if (preview.placeholders.length > 0) {
    const labels = preview.placeholders.map(row => row.label)
    const unique = [...new Set(labels)]
    return {
      tone: 'substituted',
      headline: `${preview.placeholders.length} detail${preview.placeholders.length === 1 ? '' : 's'} replaced`,
      /*
       * The limit belongs on this line too. A replaced business name says nothing
       * about the client whose name sits in the same sentence, and this is the
       * notice most accounts see, so leaving the note off here would hide the
       * boundary exactly where it matters.
       */
      detail: `Replaced before sending: ${unique.join(', ')}. The model sees a token, not the name. ${NOT_CHECKED_NOTE}`,
      blocks: false,
    }
  }

  /*
   * The text goes out unchanged, so the line says what was looked for rather than
   * what was found. Naming those shapes keeps "unchanged" from reading as "safe",
   * and the note says which names and addresses were never looked at.
   */
  return {
    tone: 'direct',
    headline: 'Sent as written',
    detail: `Checked for email addresses, phone and account numbers, handles and web addresses. ${NOT_CHECKED_NOTE}`,
    blocks: false,
  }
}

/* ------------------------------------------------------------------ *
 * Remembered items
 * ------------------------------------------------------------------ */

/** The heading one kind of remembered item is drawn under. */
export const MEMORY_KIND_LABELS: Readonly<Record<MemoryKind, string>> = Object.freeze({
  decision: 'Settled decisions',
  fact: 'Known facts',
  assumption: 'Assumptions, which may be wrong',
  open_question: 'Questions still open',
})

/**
 * The order the kinds are drawn in: what was settled, what is true, what is being
 * assumed, then what nobody has answered.
 */
export const MEMORY_KIND_ORDER: readonly MemoryKind[] = Object.freeze([
  'decision',
  'fact',
  'assumption',
  'open_question',
])

export interface MemorySection {
  readonly kind: MemoryKind
  readonly label: string
  readonly items: readonly MemoryRow[]
}

/**
 * The remembered items, grouped, newest first inside each group.
 *
 * Newest first because a correction arrives as a newer item: the person edits what
 * was wrong, and the newest wording is the one that is still true. An empty kind is
 * omitted rather than drawn as an empty heading, which would read as "there are no
 * decisions", a claim this screen has no way to make.
 */
export function memorySections (memory: readonly MemoryRow[]): MemorySection[] {
  const sections: MemorySection[] = []
  for (const kind of MEMORY_KIND_ORDER) {
    const items = memory.filter(row => row.kind === kind)
    if (items.length === 0) continue
    // `memory` arrives newest last, so reversing gives newest first without a clock.
    sections.push({ kind, label: MEMORY_KIND_LABELS[kind], items: [...items].reverse() })
  }
  return sections
}

/** How many items a person has told the assistant about this business. */
export function memoryCount (memory: readonly MemoryRow[]): number {
  return memory.length
}

/** True when the row is the person's own wording, which the panel marks. */
export function isEditedItem (row: MemoryRow): boolean {
  return row.origin === 'user' || row.locked
}

/* ------------------------------------------------------------------ *
 * Drafted work
 * ------------------------------------------------------------------ */

export interface ProposalCard {
  readonly id: string
  readonly title: string
  readonly notes: string | null
  readonly dueHint: string | null
  /** `Pending`, `Approved` or `Rejected`, as the card's badge reads. */
  readonly statusLabel: string
  /** True once a decision exists, so the buttons stop being offered. */
  readonly decided: boolean
  /** Always false in this phase, and stated rather than implied. */
  readonly executes: false
  readonly note: string
}

/** The three payload keys a card may show. Anything else stays in the row. */
function payloadText (payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * One draft, as its card draws it.
 *
 * The payload is free-form in the database and is read key by key here, so a model
 * that added an assignee, a project or a task id cannot get one drawn as though the
 * app had agreed to it. That is the same rule the drafting pass enforces on the way
 * in, applied again on the way out.
 */
export function proposalCard (proposal: ProposalRow): ProposalCard {
  const statusLabel = proposal.status === 'pending'
    ? 'Pending'
    : proposal.status === 'approved'
      ? 'Approved'
      : proposal.status === 'rejected'
        ? 'Rejected'
        : 'Expired'

  return {
    id: proposal.id,
    title: proposal.title,
    notes: payloadText(proposal.payload, 'notes'),
    dueHint: payloadText(proposal.payload, 'dueHint'),
    statusLabel,
    decided: proposal.status !== 'pending',
    executes: false,
    note: PROPOSAL_NOTE,
  }
}

/** The drafts still waiting on a person, oldest first so the oldest is answered first. */
export function pendingProposals (proposals: readonly ProposalRow[]): ProposalRow[] {
  return proposals.filter(row => row.status === 'pending')
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

export interface ThreadListRow {
  readonly id: string
  readonly label: string
  readonly pinned: boolean
  /** DD-MM-YY, as the design system writes dates. */
  readonly when: string
  readonly messageCount: number
}

/**
 * A stored timestamp as `DD-MM-YY`.
 *
 * The date part is taken from the string rather than through a Date, so a value
 * stored in UTC is drawn as the day it was stored instead of shifting by the
 * reader's offset. An unparseable value is drawn as an empty string rather than as
 * "Invalid Date", which is what a Date would produce on the screen.
 */
export function shortDate (iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (match === null) return ''
  const [, year = '', month = '', day = ''] = match
  if (year.length !== 4 || month.length !== 2 || day.length !== 2) return ''
  return `${day}-${month}-${year.slice(2)}`
}

/**
 * The thread list as drawn: pinned first, then most recently touched.
 *
 * Pinned first because that is what pinning is for. `updatedAt` breaks the tie
 * inside each group, and the id is the last resort so the order is the same on every
 * render - a list that reshuffled between two identical states would look like it
 * was doing something.
 */
export function threadRows (threads: readonly ThreadRow[]): ThreadListRow[] {
  const rows = threads.map(thread => ({
    id: thread.id,
    label: thread.title.trim().length > 0 ? thread.title.trim() : 'New conversation',
    pinned: thread.pinned,
    when: shortDate(thread.updatedAt),
    messageCount: thread.messageCount,
    sortKey: thread.updatedAt,
  }))

  rows.sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
    if (left.sortKey !== right.sortKey) return left.sortKey < right.sortKey ? 1 : -1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })

  return rows.map(({ sortKey, ...row }) => row)
}

/* ------------------------------------------------------------------ *
 * The composer
 * ------------------------------------------------------------------ */

export interface ComposerState {
  readonly canSend: boolean
  /** What to say when the button is not available, or null when it is. */
  readonly hint: string | null
}

/**
 * Whether the send button is available, and why not when it is not.
 *
 * One reason at a time, in the order a person would meet them: signed out, no
 * business chosen, a turn already running, nothing typed. The screen draws the
 * button from this rather than from four conditions of its own, so the button and its
 * explanation cannot disagree.
 */
export function composerState (input: {
  readonly text: string
  readonly busy: boolean
  readonly signedIn: boolean
  readonly hasBusiness: boolean
}): ComposerState {
  if (!input.signedIn) return { canSend: false, hint: 'Sign in to send a message.' }
  if (!input.hasBusiness) return { canSend: false, hint: 'Choose a business first.' }
  if (input.busy) return { canSend: false, hint: 'Waiting for the current answer to finish.' }
  if (input.text.trim().length === 0) return { canSend: false, hint: 'Type a message to send.' }
  return { canSend: true, hint: null }
}

/* ------------------------------------------------------------------ *
 * The model picker
 * ------------------------------------------------------------------ */

export interface PickerModel {
  readonly id: string
  readonly presetId: string
  readonly label: string
  readonly originLabel: string
  /**
   * Where the provider says this model runs.
   *
   * Carried as the boolean rather than as text so nothing downstream has to compare
   * a label to decide whether a turn is local. A screen that tested `originLabel ===
   * 'Cloud'` would make the wording of a chip load-bearing, and the Local-only
   * badge would then depend on a translation.
   */
  readonly cloud: boolean
  readonly chips: readonly string[]
}

/**
 * One configured provider's models, as the picker lists them.
 *
 * A model that answers a conversation must be reachable, so the list is drawn per
 * provider and carries the provider's id: the send call needs both, and a picker that
 * offered a model without the provider it belongs to would be offering something that
 * cannot be sent.
 */
export function pickerModels (
  presetId: string,
  models: readonly ModelInfo[],
  capabilitiesOf: (capabilities: ProviderCapabilities) => string[] = capabilityChips,
): PickerModel[] {
  return models.map(model => ({
    id: model.id,
    presetId,
    label: modelLabel(model.id, model.label),
    originLabel: originLabelFor(model.cloud),
    cloud: model.cloud,
    chips: capabilitiesOf(model.capabilities),
  }))
}

/** The picker's trigger text when nothing has been chosen yet. */
export const NO_MODEL_CHOSEN = 'Choose a model'

/** What the picker's trigger reads for one chosen model. */
export function chosenModelLabel (model: PickerModel | null): string {
  return model === null ? NO_MODEL_CHOSEN : model.label
}

/* ------------------------------------------------------------------ *
 * The turn that is running
 * ------------------------------------------------------------------ */

export interface TurnState {
  readonly turnId: string
  readonly threadId: string
  readonly text: string
}

/**
 * Whether one event belongs to the turn the screen is drawing.
 *
 * Two things have to match: the turn and the thread. A reply that outlives a business
 * switch arrives with the old thread's id on it, so comparing the turn alone would
 * append it to whatever conversation is on screen now. The main process already
 * refuses to publish such an event; this is the second half of the same rule, at the
 * point where a list is appended to.
 */
export function eventBelongsTo (
  turn: TurnState | null,
  threadId: string,
  event: { readonly turnId: string; readonly threadId: string },
): boolean {
  if (turn === null) return false
  return turn.turnId === event.turnId && turn.threadId === threadId && event.threadId === threadId
}

/** A failure token as the sentence the composer shows. */
export function failureSentence (
  messages: Readonly<Record<string, string>>,
  failure: string,
): string {
  return messages[failure] ?? 'Something went wrong. Try again.'
}
