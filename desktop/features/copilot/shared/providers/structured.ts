/*
 * Getting a typed answer out of a model that cannot call tools natively
 * (section 9.4).
 *
 * For a `prompted` model the adapter asks for JSON matching a schema, and a
 * model will still, some of the time, answer with JSON that does not match:
 * a missing field, an enum value it invented, prose around the object. The plan
 * allows exactly one repair attempt, and this module is that policy in one
 * place so every feature gets the same behaviour instead of each writing its
 * own retry.
 *
 * Three decisions worth stating.
 *
 * 1. The validation is the schema's, not this module's. A caller passes the
 *    schema it wants and receives the parsed value, so a feature and its test
 *    agree on one definition of "correct".
 *
 * 2. The repair prompt carries the validation issues and nothing else. The
 *    model already has its own previous answer in the conversation; re-sending
 *    the output would double the prompt and, on a cloud call, send the same
 *    text twice. Issue messages describe the shape, not the payload.
 *
 * 3. A failure throws a token, never the reply. The reply may contain a
 *    document excerpt or a person's name, so it must not travel in an error
 *    that a log or an IPC reply could carry.
 */
import { z } from 'zod'

import { ProviderError } from './errors.js'

/** The plan allows one repair, so a failing call costs at most two asks. */
export const MAX_REPAIRS = 1

/**
 * How many validation issues are reported back to the model.
 *
 * A large strict schema can produce dozens of issues for one bad reply, and the
 * repair message is a prompt: five issues describe the problem, fifty would
 * bury the request in its own error report.
 */
export const MAX_REPORTED_ISSUES = 5

/** What the adapter is told about the attempt it is about to make. */
export interface StructuredAttempt {
  /** 1 for the first ask, 2 for the single repair. */
  readonly attempt: number
  /** False on the first ask. True only for the repair. */
  readonly repair: boolean
  /** Why the previous answer was refused. Empty on the first ask. */
  readonly issues: readonly string[]
}

export interface StructuredOutputRequest<T> {
  /** The shape wanted. Use a strict object so an extra key is refused. */
  readonly schema: z.ZodType<T>
  /**
   * Ask the model and return its raw reply.
   *
   * Called once, or twice when the first reply does not validate. The caller
   * owns the wording of the prompt and the conversation it appends to; this
   * module owns only "ask, validate, maybe ask once more".
   */
  ask(attempt: StructuredAttempt): Promise<string>
}

/**
 * A fenced code block, which is how models wrap JSON when they are being
 * helpful. A single fence is stripped; anything else is left for the repair,
 * because guessing at half-parsed prose is how a schema check stops meaning
 * anything.
 */
const FENCE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i

export type JsonReply = { ok: true; value: unknown } | { ok: false }

/**
 * Parse a reply as JSON, or say it was not JSON.
 *
 * `ok` is explicit rather than returning `undefined`, because `null` is valid
 * JSON and would otherwise be indistinguishable from a parse failure.
 */
export function parseJsonReply(reply: string): JsonReply {
  const text = reply.trim()
  if (text.length === 0) return { ok: false }

  const fenced = FENCE.exec(text)
  const body = (fenced === null ? text : (fenced[1] ?? '')).trim()
  if (body.length === 0) return { ok: false }

  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    return { ok: false }
  }
}

/** The issues to report back, capped and flattened to one line each. */
function issuesFrom(error: z.ZodError, limit = MAX_REPORTED_ISSUES): string[] {
  const issues: string[] = []
  for (const issue of error.issues.slice(0, limit)) {
    const path = issue.path.length === 0 ? '(root)' : issue.path.join('.')
    issues.push(`${path}: ${issue.message}`)
  }
  return issues
}

/**
 * Ask until the reply validates, at most twice.
 *
 * Resolves with the parsed value, so the caller never sees unvalidated JSON.
 * Rejects with `schema_mismatch` once the single repair has also failed; the
 * thrown error is built from the token, so the reply and the issues stay out of
 * it (issue text can quote a received value, which may be user content).
 */
export async function requestStructuredOutput<T>(
  request: StructuredOutputRequest<T>,
): Promise<T> {
  let issues: readonly string[] = []

  for (let attempt = 1; attempt <= MAX_REPAIRS + 1; attempt += 1) {
    const reply = await request.ask({ attempt, repair: attempt > 1, issues })

    const parsed = parseJsonReply(reply)
    if (!parsed.ok) {
      // Not JSON at all is a repair reason like any other, so it takes the same
      // single retry rather than failing the first time.
      issues = ['reply was not valid JSON']
      continue
    }

    const checked = request.schema.safeParse(parsed.value)
    if (checked.success) return checked.data

    issues = issuesFrom(checked.error)
  }

  throw new ProviderError('schema_mismatch')
}
