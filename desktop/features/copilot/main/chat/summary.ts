/*
 * Compressing a thread once it outgrows what a model can be sent (section 8).
 *
 * A conversation that runs long enough stops fitting. The answer that keeps the
 * thread usable is a summary of the older part, marked with the sequence number
 * it reached, so the next turn sends the summary plus everything after it rather
 * than re-sending what the summary already says.
 *
 * Three decisions worth stating.
 *
 * 1. *Recent turns are never summarised.* The newest handful stay verbatim
 *    because they are what the next question is most likely about, and a summary
 *    of "what did I just ask" is a summary of the question itself.
 *
 * 2. *The summary is rolling, not cumulative from zero.* A second pass is given
 *    the previous summary and the turns since, so compressing a long thread costs
 *    one call about the new part rather than one call about everything.
 *
 * 3. *A failed pass changes nothing.* The previous summary and its watermark stay
 *    as they were, so the thread keeps working with slightly stale context instead
 *    of losing its older half because a model had a bad minute.
 *
 * Nothing here writes to the database - `applySummary` does that, and only when
 * it is handed text that validated.
 */

import { z } from 'zod'

import type { BusinessScope, MessageRow, SummaryRow } from '../../shared/storage-contract.js'
import type { BusinessStore } from '../db/store.js'

/** The longest summary a thread may carry. Roughly ten sentences. */
export const MAX_SUMMARY_TEXT = 4_000

/** How many turns stay verbatim and are therefore never summarised. */
export const SUMMARY_KEEP_RECENT = 10

export const summaryReplySchema = z.strictObject({
  /*
   * Trimmed before the length is judged, because the schema is the emptiness rule
   * and a reply of three spaces is empty. `applySummary` trims before it writes, so
   * without this the two disagree by exactly one whitespace-only pass.
   */
  summary: z.string().trim().min(1).max(MAX_SUMMARY_TEXT),
})

export type SummaryReply = z.infer<typeof summaryReplySchema>

export const SUMMARY_PROMPT = [
  'You compress the earlier part of a business conversation so it can be carried forward.',
  'Keep what changes future answers: what was decided, what is true of the business,',
  'what is still open, and any figure or date somebody stated.',
  'Drop pleasantries, and drop anything the assistant merely offered.',
  'Do not invent, and do not round a figure you were given.',
  'Write plain text, at most ten sentences. Answer with JSON only, in this shape:',
  '{"summary":"..."}',
].join('\n')

/**
 * Whether this thread is worth summarising now.
 *
 * The trigger is the number of turns *since* the summary, not the length of the
 * thread: a thread summarised once should not be summarised again on every turn
 * thereafter. The count is compared against twice the number kept verbatim, so a
 * pass happens when there is roughly a kept-window's worth of new material - often
 * enough to stay useful, rare enough not to cost a call per turn.
 */
export function needsSummary (
  messages: readonly MessageRow[],
  coveredThroughSeq: number,
  keepRecent = SUMMARY_KEEP_RECENT,
): boolean {
  return messages.filter((row) => row.seq > coveredThroughSeq).length > keepRecent * 2
}

export interface SummaryPlan {
  /** The turns the pass should compress, oldest first. */
  readonly toSummarise: readonly MessageRow[]
  /** The sequence number the new summary will have covered. */
  readonly coversThroughSeq: number
}

/**
 * The turns to compress, or null when there is nothing to do.
 *
 * Null rather than an empty plan, because "nothing to summarise" and "summarise
 * nothing" are different instructions to a caller, and only one of them should
 * produce a model call.
 */
export function planSummary (
  messages: readonly MessageRow[],
  coveredThroughSeq: number,
  keepRecent = SUMMARY_KEEP_RECENT,
): SummaryPlan | null {
  const fresh = messages.filter((row) => row.seq > coveredThroughSeq)
  if (fresh.length <= keepRecent) return null

  const toSummarise = fresh.slice(0, fresh.length - keepRecent)
  const last = toSummarise[toSummarise.length - 1]
  if (last === undefined) return null

  return { toSummarise, coversThroughSeq: last.seq }
}

/** The text a summary pass reads: the previous summary first, then the new turns. */
export function summaryBatch (
  previous: SummaryRow | null,
  plan: SummaryPlan,
): string {
  const lines: string[] = []
  if (previous !== null) lines.push(`Summary so far:\n${previous.text}`)
  for (const row of plan.toSummarise) {
    lines.push(`${row.seq}. ${roleLabel(row.role)}: ${row.content}`)
  }
  return lines.join('\n')
}

/** What a turn is called in a prompt. A system turn is never the person's words. */
function roleLabel (role: string): string {
  if (role === 'assistant') return 'Assistant'
  if (role === 'system') return 'System'
  return 'Person'
}

/**
 * Store a validated summary, or leave the old one exactly as it was.
 *
 * The repository refuses a summary that would move the watermark backwards, so a
 * pass that finished out of order cannot make the app forget that it had already
 * read further than it is now claiming to have read.
 */
export function applySummary (
  repositories: ReturnType<BusinessStore['repositories']>,
  scope: BusinessScope,
  threadId: string,
  text: string,
  coversThroughSeq: number,
): SummaryRow {
  return repositories.summaries.upsert(scope, {
    threadId,
    text: text.trim(),
    coversThroughSeq,
  })
}
