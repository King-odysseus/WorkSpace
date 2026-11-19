/*
 * What may leave the machine when a conversation goes to a cloud provider.
 *
 * Section 10 of the plan is blunt about this: a business's conversation is the
 * business's, and sending it to somebody else's server is allowed only when the
 * person asked for a cloud model and only after the app has done what it can to
 * keep identifiable details out of it.
 *
 * Three rules live here, and they are deliberately separate.
 *
 * 1. *Placeholders.* The signed-in person's name and email, and the business's
 *    name, are replaced by stable tokens such as `[[business]]`. Stable matters:
 *    the model has to be able to see that two mentions are the same thing, and a
 *    sentence that said "the client" in one place and "they" in another would lose
 *    the thread of who is who. The person's own screen still shows the real words,
 *    because it draws the stored row, not this.
 *
 * 2. *Residual check.* Substitution covers the details the app knows. It cannot
 *    cover a phone number somebody typed, an email in a pasted paragraph, or a
 *    card number. So after substitution the text is scanned, and a hit is a
 *    refusal rather than a scrubbing: replacing a customer's phone number with a
 *    token would quietly change the question being asked, and the person would get
 *    an answer about `[[digits]]` without ever knowing why.
 *
 * 3. *The exact preview.* Whatever is decided above, the caller can ask for the
 *    precise text that would be sent. Not a summary and not a sample: the same
 *    messages in the same order the send would use, so approving the preview is
 *    approving those bytes.
 *
 * Nothing here talks to a provider and nothing here writes to a database. It is a
 * pure function of what the person said and what the app knows about them, which
 * is what makes it testable without a network or a key.
 */

import type { ChatMessage, MessagePart } from '../../shared/providers/types.js'

/**
 * A stable stand-in and the words it hides.
 *
 * `label` is what the screen shows next to the preview ("Business name"), so a
 * person can see what was taken out without the value being written anywhere the
 * preview could leak. The value itself never leaves this module except as the
 * thing being replaced.
 */
export interface Placeholder {
  readonly token: string
  readonly label: string
  readonly value: string
}

/** One message as the preview shows it: a role and the text, nothing else. */
export interface PreviewMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly text: string
}

/** What the preview answers. */
export interface PayloadPreview {
  readonly cloud: boolean
  readonly messages: readonly PreviewMessage[]
  readonly placeholders: readonly { token: string, label: string }[]
  readonly blocked: boolean
  readonly blockedReason: string | null
}

/** Who the app knows it is talking about, so those words can be taken out. */
export interface PrivacyIdentity {
  readonly displayName?: string | null
  readonly email?: string | null
  readonly businessName?: string | null
}

/* ------------------------------------------------------------------ *
 * What counts as identifiable
 * ------------------------------------------------------------------ */

/**
 * Runs of digits long enough to be a phone number, an account or a card.
 *
 * Seven is the shortest that is not an ordinary quantity: a price, a year and a
 * date written with dashes all stay below it, while a Nigerian mobile number, an
 * account number and a card number are all longer. Spaces inside the run are
 * allowed because that is how people type a phone number; dashes are handled by
 * `DASHED_DIGIT_RUN` below, at a higher threshold, so a due date still passes.
 */
const LONG_DIGIT_RUN = /\d(?:[\d\s]{5,})\d/

/**
 * The same run written with dashes instead of spaces.
 *
 * Ten digits rather than seven, because a date is written with dashes -
 * `14-03-26` is six digits - and refusing to send a conversation because it
 * mentioned a due date would make the privacy rule unusable. A phone number, an
 * account number and a card number are all longer than that, in every format this
 * app is likely to meet.
 */
const DASHED_DIGIT_RUN = /\d(?:[\d-]{9,})\d/

/**
 * A run of digits with the separators people put between them when writing a
 * contact number: brackets around an area code, dots, slashes, spaces and dashes.
 *
 * The two rules above each accept one separator, so the way a great many people
 * actually write a phone number - `(202) 555-0123` - slipped past both: the first
 * saw `202` and `555` on either side of a bracket, the second saw nothing to hold
 * on to. A run is only a hit when it is shaped like a number, which is checked in
 * `readsAsContactNumber` rather than in the pattern, because counting digits in a
 * regular expression is not something it can do honestly.
 */
const CONTACT_RUN = /\+?\d[0-9 \t()./-]*\d/g

/**
 * Whether a run of digits and separators is a contact number rather than a date.
 *
 * Two shapes qualify, and both are chosen so an ordinary date cannot be mistaken
 * for one:
 *
 * - Brackets. `(202) 555-0123` has ten digits, and seven inside brackets is already
 *   a phone number because nobody writes a date or a price that way. A year in
 *   brackets - `(2026)` - is four and stays clear.
 * - Dots or slashes. Ten digits, which no date reaches: `14.03.2026` is eight and
 *   `14/03/26` is six, so both still pass.
 *
 * A run of dashes and spaces alone is deliberately not judged here. It is already
 * covered by the two rules above, and treating it here would reread a pair of dates
 * written side by side - `14-03-2026 20-03-2026` - as one sixteen-digit number.
 */
function readsAsContactNumber (run: string): boolean {
  const digits = run.replace(/[^0-9]/gu, '').length
  if (run.includes('(') || run.includes(')')) return digits >= 7
  if (run.includes('.') || run.includes('/')) return digits >= 10
  return false
}

/** Something shaped like an email address. */
const EMAIL_SHAPE = /\S+@\S+\.\S+/

/** A handle, which is how a person is named on most of the places work is discussed. */
const HANDLE_SHAPE = /(?:^|\s)@[A-Za-z0-9_.-]{2,}/

/** A web address, which can carry a name in its path. */
const URL_SHAPE = /https?:\/\/\S+/i

/**
 * Why this text may not be sent, or null.
 *
 * The reason is a token rather than a sentence, because it travels to the screen
 * and into the log line that records the refusal, and neither may quote the text
 * that was refused.
 */
export function residualIdentifier (text: string): string | null {
  if (EMAIL_SHAPE.test(text)) return 'email'
  if (LONG_DIGIT_RUN.test(text)) return 'long_number'
  if (DASHED_DIGIT_RUN.test(text)) return 'long_number'
  for (const [run] of text.matchAll(CONTACT_RUN)) {
    if (readsAsContactNumber(run)) return 'long_number'
  }
  if (HANDLE_SHAPE.test(text)) return 'handle'
  if (URL_SHAPE.test(text)) return 'web_address'
  return null
}

/* ------------------------------------------------------------------ *
 * Substitution
 * ------------------------------------------------------------------ */

/** Escape a string so it can be used inside a regular expression literally. */
function literal (value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The placeholders this account produces.
 *
 * Only values long enough to be worth hiding are included. A one-character name
 * would match half the words in the conversation and turn a reply into nonsense,
 * and a name that appears as a substring of a common word causes the same damage
 * quietly. Two characters is the shortest that is still a name.
 *
 * Order matters: the longer value is replaced first, so a business called
 * "Zuri Lofts" is not half-replaced by a person called "Zuri".
 */
export function placeholdersFor (identity: PrivacyIdentity): Placeholder[] {
  const candidates: Placeholder[] = []

  if (typeof identity.businessName === 'string' && identity.businessName.trim().length >= 2) {
    candidates.push({ token: '[[business]]', label: 'Business name', value: identity.businessName.trim() })
  }
  if (typeof identity.displayName === 'string' && identity.displayName.trim().length >= 2) {
    candidates.push({ token: '[[person]]', label: 'Your name', value: identity.displayName.trim() })
  }
  if (typeof identity.email === 'string' && identity.email.includes('@')) {
    candidates.push({ token: '[[email]]', label: 'Email address', value: identity.email.trim() })
  }

  // An email is also reachable by the person's name, so the longest-first order
  // keeps the address itself from being replaced one part at a time.
  return candidates.sort((left, right) => right.value.length - left.value.length)
}

/**
 * The text with every known identifying value replaced by its token.
 *
 * Matching ignores case, because somebody writing "zuri lofts" means the same
 * business as "Zuri Lofts", and a case-sensitive replacement would leave the
 * lower-case spelling in the payload while reporting that it had been removed.
 */
export function substitute (text: string, placeholders: readonly Placeholder[]): string {
  let out = text
  for (const placeholder of placeholders) {
    out = out.replace(new RegExp(literal(placeholder.value), 'giu'), placeholder.token)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * The message list
 * ------------------------------------------------------------------ */

/** The text parts of one stored message, joined the way a chat turn reads. */
export function textOfParts (parts: readonly MessagePart[]): string {
  const pieces: string[] = []
  for (const part of parts) {
    if (part.type === 'text') pieces.push(part.text)
  }
  return pieces.join('\n')
}

/**
 * The exact messages a cloud provider would receive.
 *
 * `conversation` is what the caller is about to send, already in the provider's
 * shape. The substitution and the residual check are applied to every message,
 * including the earlier turns: a name typed five messages ago is still a name in
 * the payload, and hiding only the newest line would leave the older one exposed.
 *
 * The check runs on the *substituted* text rather than the original, so a value
 * the app knows about is not reported as a residual. That is the whole point of
 * doing the two steps in this order.
 */
export function buildCloudPayload (
  conversation: readonly ChatMessage[],
  identity: PrivacyIdentity,
): { messages: ChatMessage[], preview: PayloadPreview } {
  const placeholders = placeholdersFor(identity)
  const previewMessages: PreviewMessage[] = []
  const outbound: ChatMessage[] = []
  let blockedReason: string | null = null

  for (const message of conversation) {
    const parts: MessagePart[] = []

    for (const part of message.parts) {
      if (part.type !== 'text') {
        // Anything that is not text is carried through untouched and is not part
        // of the preview's own shape. An image is bytes the person chose to
        // attach, and its own schema already refuses a URL.
        parts.push(part)
        continue
      }

      const replaced = substitute(part.text, placeholders)
      if (blockedReason === null) blockedReason = residualIdentifier(replaced)
      parts.push({ type: 'text', text: replaced })
    }

    outbound.push({ role: message.role, parts })

    const text = textOfParts(parts)
    // A role the provider accepts but the preview's own schema does not - a
    // tool-role turn - is shown to the person as what the app said.
    const role: PreviewMessage['role'] = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user'
    previewMessages.push({ role, text })
  }

  return {
    messages: outbound,
    preview: {
      cloud: true,
      messages: previewMessages,
      placeholders: placeholders.map(({ token, label }) => ({ token, label })),
      blocked: blockedReason !== null,
      blockedReason,
    },
  }
}

/**
 * The preview for a local model.
 *
 * A local model runs on this machine, so nothing is substituted and nothing is
 * blocked: the model already sees what the person sees. The preview still exists
 * because the screen shows one panel either way, and a panel that silently showed
 * the wrong text for local models would be worse than no panel.
 */
export function buildLocalPayload (conversation: readonly ChatMessage[]): PayloadPreview {
  return {
    cloud: false,
    messages: conversation.map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user',
      text: textOfParts(message.parts),
    })),
    placeholders: [],
    blocked: false,
    blockedReason: null,
  }
}
