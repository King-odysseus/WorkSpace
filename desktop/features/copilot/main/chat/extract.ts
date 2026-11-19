/*
 * What the assistant remembers about a business, and how it refuses to learn the
 * same thing twice (section 8).
 *
 * Four kinds, taken straight from the storage vocabulary so there is no second
 * list to drift: a *decision* (somebody chose something), a *fact* (something is
 * true of this business), an *assumption* (something is being treated as true
 * without being settled) and an *open question* (something nobody has answered).
 * The distinction is not decoration: the recall block labels each kind, so an
 * assumption is shown to the model as an assumption rather than as a fact.
 *
 * Three rules this module owns.
 *
 * 1. *Every item cites the message it came from.* An item with no source is
 *    refused rather than stored. A remembered claim that cannot be traced back to
 *    something somebody said is a claim the panel cannot show, cannot correct and
 *    cannot delete - it would just be an opinion the app formed about the
 *    business.
 *
 * 2. *Only the person's own words are extracted from.* The assistant's replies are
 *    in the batch so the model can understand the exchange, but an item sourced
 *    from an assistant message is dropped: otherwise a model's suggestion becomes
 *    a "decision" the moment it is repeated back.
 *
 * 3. *Nothing is learned twice.* Three separate guards, because each catches a
 *    different way the same thing arrives again: the same sentence twice in one
 *    answer, the same sentence from a different message, and a second extraction
 *    pass over a message that already produced an item of that kind. The last one
 *    is what makes a person's edit stick: the row still exists, so a later pass
 *    cannot re-add the wording that was corrected. A removal is checked against the
 *    same guard from the other side: the row is a tombstone rather than gone, and
 *    `listRemoved` is read alongside `list` so a sentence a person took back cannot
 *    be stored again from the message it came from.
 *
 * Nothing here executes anything. An item is text and a kind; there is no action
 * attached to remembering.
 */

import { z } from 'zod'

import type { BusinessScope, MemoryRow, MessageRow } from '../../shared/storage-contract.js'
import { memoryKinds } from '../../shared/storage-contract.js'
import type { BusinessStore } from '../db/store.js'

/** How many items one pass may add. A long meeting yields a handful, not a list. */
export const MAX_ITEMS = 12

/** The longest single item. Longer than a sentence is usually a transcript. */
export const MAX_ITEM_TEXT = 400

/**
 * What the model is asked to answer.
 *
 * `source` is a message sequence number from the batch it was given, not an id:
 * the model never sees database ids and inventing one would be a link to nothing.
 * A number it cannot match is dropped by `applyExtraction`.
 */
export const extractedMemorySchema = z.strictObject({
  items: z.array(
    z.strictObject({
      kind: z.enum(memoryKinds),
      text: z.string().min(3).max(MAX_ITEM_TEXT),
      source: z.number().int().nonnegative(),
    }),
  ).max(MAX_ITEMS),
})

export type ExtractedMemory = z.infer<typeof extractedMemorySchema>

/** The instruction for one extraction pass. */
export const EXTRACTION_PROMPT = [
  'You read a conversation between a person and an assistant about their business.',
  'Record only what the person stated, decided, assumed or asked and nobody answered.',
  'Do not record anything the assistant suggested, offered or guessed.',
  'Do not record a question the assistant answered.',
  'Do not record names, phone numbers, email addresses or account numbers.',
  'Answer with JSON only, no prose and no code fence, in this shape:',
  '{"items":[{"kind":"decision","text":"one short sentence","source":3}]}',
  'kind is one of: decision, fact, assumption, open_question.',
  'source is the number at the start of the message the item came from.',
  `Answer with at most ${MAX_ITEMS} items. An empty list is a correct answer.`,
].join('\n')

/**
 * The text used to compare two items for "the same thing".
 *
 * Case, spacing and trailing punctuation are dropped because they are typography
 * rather than meaning: "Budget is 5m." and "budget is  5m" are one fact said
 * twice, and storing both would make the recall block look like it was stuttering.
 */
export function normaliseItem (text: string): string {
  return text
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?;:]+$/u, '')
    .toLowerCase()
}

/** The batch a pass reasons about, numbered the way the prompt asks it to cite. */
export function numberedBatch (messages: readonly MessageRow[]): string[] {
  return messages.map((row) => `${row.seq}. ${roleLabel(row.role)}: ${row.content}`)
}

/**
 * What a turn is called in a prompt.
 *
 * A system turn is named as one rather than folded in with the person: the
 * extractor refuses an item sourced from anything but the person's own words, and
 * labelling a system turn "Person" invited exactly the citation it then had to
 * throw away.
 */
function roleLabel (role: string): string {
  if (role === 'assistant') return 'Assistant'
  if (role === 'system') return 'System'
  return 'Person'
}

export interface ApplyExtractionResult {
  /** How many items were newly stored. */
  readonly added: number
  /** Why the rest were dropped, by count, so a test can name the reason. */
  readonly dropped: Readonly<Record<string, number>>
}

/**
 * Store what survived the rules, and report why the rest did not.
 *
 * `dropped` is returned rather than logged so the behaviour is checkable without
 * a logger, and so a failure of this feature is visible in a test rather than as
 * silence. The reasons are fixed words, never text: an item may quote a person.
 */
export function applyExtraction (
  repositories: ReturnType<BusinessStore['repositories']>,
  scope: BusinessScope,
  batch: readonly MessageRow[],
  extracted: ExtractedMemory,
): ApplyExtractionResult {
  const bySeq = new Map<number, MessageRow>()
  for (const row of batch) bySeq.set(row.seq, row)

  /*
   * What this business has already been told, plus what it has been asked to
   * forget. The second list is read for one reason: an item the person removed must
   * not come back. `closeThread` re-runs extraction over the whole thread, so a
   * model that offers the same sentence again from the same message would otherwise
   * restore it, and the person's deletion would be silently undone by housekeeping
   * they never asked for.
   *
   * The two lists are asked for separately rather than one list including
   * tombstones, so that the cap on each cannot push a live item out of the other's
   * window.
   */
  const existing = [
    ...repositories.memory.list(scope),
    ...repositories.memory.listRemoved(scope),
  ]
  const seenText = new Set(existing.map((row) => normaliseItem(row.text)))
  const seenSource = new Set(
    existing
      .filter((row: MemoryRow) => row.sourceMessageId !== null)
      .map((row: MemoryRow) => `${row.kind}|${row.sourceMessageId ?? ''}`),
  )

  const dropped: Record<string, number> = {}
  let added = 0

  for (const item of extracted.items) {
    const message = bySeq.get(item.source)

    // No source in this batch means the model cited something it was not given.
    if (message === undefined) {
      dropped.unknown_source = (dropped.unknown_source ?? 0) + 1
      continue
    }

    // The assistant's own words are context, not knowledge about the business.
    if (message.role !== 'user') {
      dropped.not_the_person = (dropped.not_the_person ?? 0) + 1
      continue
    }

    const text = normaliseItem(item.text)
    if (text.length === 0) {
      dropped.empty = (dropped.empty ?? 0) + 1
      continue
    }

    if (seenText.has(text)) {
      dropped.already_known = (dropped.already_known ?? 0) + 1
      continue
    }

    const sourceKey = `${item.kind}|${message.id}`
    if (seenSource.has(sourceKey)) {
      dropped.same_source = (dropped.same_source ?? 0) + 1
      continue
    }

    try {
      repositories.memory.add(scope, {
        kind: item.kind,
        text: item.text.trim(),
        sourceMessageId: message.id,
        origin: 'ai',
      })
    } catch {
      /*
       * A refusal here is the repository's ownership check or a row that failed
       * its own schema, and neither is worth failing a conversation over. The
       * item is counted as dropped so a test can see that the guard fired rather
       * than that the item vanished.
       */
      dropped.refused = (dropped.refused ?? 0) + 1
      continue
    }

    seenText.add(text)
    seenSource.add(sourceKey)
    added += 1
  }

  return { added, dropped }
}
