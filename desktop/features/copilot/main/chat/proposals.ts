/*
 * A drafted task, waiting for a person to decide (section 8).
 *
 * The rule this file exists to keep is one sentence long: *a draft is not an
 * action*. Nothing here creates a task, calls a task API, or reaches the work
 * space server. A proposal is a row of text with three things a person can do to
 * it - approve, edit, reject - and approving one is still only a recorded
 * decision until a later phase teaches the app to execute it.
 *
 * That matters most where it is least visible. A conversation carries text the
 * person did not write: a remembered item, a summary, an excerpt pasted in from an
 * email, and the assistant's own replies. Any of those can contain something that
 * reads like an instruction. So the trigger is not a string the model produces and
 * not a field a caller can set from content: it is stated by the one caller that
 * has a person's own message in hand, and any other value adds nothing.
 *
 * Three further rules keep the cards honest.
 *
 * 1. *A title and no more.* The draft carries a title, an optional note and an
 *    optional due hint. Assignee ids, task ids and server references are not
 *    accepted even if a model offers them, because a draft that named a real
 *    record would be a draft that could be executed by a bug.
 *
 * 2. *Five at most.* A reply that proposes forty tasks is a reply that has stopped
 *    reading the conversation. Five is what a person will look at.
 *
 * 3. *Nothing proposed twice.* A second pass over the same exchange, or a model
 *    repeating itself, must not fill the panel with the same card. The check is
 *    against the thread's pending drafts, so a rejected draft may be proposed
 *    again - a person said no to that wording once, not to the idea forever.
 */

import { z } from 'zod'

import type { BusinessScope } from '../../shared/storage-contract.js'
import type { BusinessStore } from '../db/store.js'

/** How many drafts one reply may produce. */
export const MAX_DRAFTS = 5

export const MAX_DRAFT_TITLE = 120
export const MAX_DRAFT_NOTES = 600

/**
 * What the model is asked to answer when the person asks for work to be created.
 *
 * Only the two fields the card edits. A model that helpfully adds an assignee or a
 * project id is refused by the strict object rather than silently trimmed, because
 * a strict refusal shows up in a test while a silent trim shows up in production.
 */
export const draftedTasksSchema = z.strictObject({
  tasks: z.array(
    z.strictObject({
      title: z.string().min(3).max(MAX_DRAFT_TITLE),
      notes: z.string().max(MAX_DRAFT_NOTES).optional(),
      dueHint: z.string().max(40).optional(),
    }),
  ).max(MAX_DRAFTS),
})

export type DraftedTasks = z.infer<typeof draftedTasksSchema>

/**
 * What caused a draft to be written.
 *
 * `user_message` is the only value that produces anything. The other exists so a
 * caller that finds itself holding stored content has somewhere to say so and be
 * refused, rather than having to be trusted not to call.
 */
export type ProposalTrigger = 'user_message' | 'stored_content' | 'assistant_reply'

export const DRAFTING_PROMPT = [
  'The person has asked for work to be created. Draft the tasks they asked for.',
  'Draft only what they actually asked for, split the way they described it.',
  'Do not invent a deadline, an owner or a project they did not mention.',
  'If they did not ask for work to be created, answer {"tasks":[]}.',
  'Answer with JSON only, no prose and no code fence, in this shape:',
  '{"tasks":[{"title":"short imperative title","notes":"optional","dueHint":"optional"}]}',
  `Answer with at most ${MAX_DRAFTS} tasks.`,
].join('\n')

/** A title reduced to the words that carry meaning, for "already proposed" checks. */
function normaliseTitle (text: string): string {
  return text.replace(/\s+/gu, ' ').trim().toLowerCase()
}

export interface ApplyProposalsResult {
  readonly added: number
  /** Set when the trigger was not a person's own request, so a caller can log it. */
  readonly refused?: 'not_a_user_request'
}

/**
 * Store the drafts, or refuse to store anything.
 *
 * Returns a count rather than the rows: the panel lists proposals through its own
 * read, and returning both would be two shapes for one thing.
 */
export function applyProposals (
  repositories: ReturnType<BusinessStore['repositories']>,
  scope: BusinessScope,
  threadId: string | null,
  drafts: DraftedTasks,
  trigger: ProposalTrigger,
): ApplyProposalsResult {
  if (trigger !== 'user_message') return { added: 0, refused: 'not_a_user_request' }
  if (drafts.tasks.length === 0) return { added: 0 }

  /*
   * Pending drafts of this thread, so a repeated proposal is skipped. Approved and
   * rejected ones are deliberately not consulted: a decision has already been
   * made about those, and re-proposing after a rejection is a person's second
   * chance rather than a bug.
   */
  const pending = repositories.proposals.list(scope, { status: 'pending' })
  const seen = new Set(
    pending
      .filter((row) => row.threadId === threadId)
      .map((row) => normaliseTitle(row.title)),
  )

  let added = 0
  for (const draft of drafts.tasks) {
    const title = draft.title.trim()
    const key = normaliseTitle(title)
    if (key.length === 0 || seen.has(key)) continue

    /*
     * The payload is built here rather than spread from the model's object, so
     * only these three keys can ever reach a row. Anything else it sent has
     * already been refused by the strict schema; this keeps the write honest even
     * if that schema is later widened for some other reason.
     */
    const payload: Record<string, unknown> = { title }
    if (typeof draft.notes === 'string' && draft.notes.trim().length > 0) {
      payload.notes = draft.notes.trim()
    }
    if (typeof draft.dueHint === 'string' && draft.dueHint.trim().length > 0) {
      payload.dueHint = draft.dueHint.trim()
    }

    try {
      repositories.proposals.create(scope, { kind: 'task', title, payload, threadId })
    } catch {
      // A refused row is not worth failing a conversation over; it is simply not
      // offered. The reason is the repository's ownership check or its own schema.
      continue
    }

    seen.add(key)
    added += 1
  }

  return { added }
}
