/*
 * The desktop bridge's message contract: one closed table of channels, and a
 * zod schema for every request and reply that crosses it.
 *
 * Two rules keep the surface shut:
 *
 * 1. Channels are a closed table. A renderer names a method, never a channel
 *    string, and there is no generic invoke, so a window cannot reach a handler
 *    it was never given.
 * 2. Every schema is strict. An unknown key is a rejection, not a silent strip.
 *    That is what stops a caller smuggling a URL, header or workspace id into a
 *    request that is supposed to carry two booleans.
 *
 * The probe's vocabulary (actions, error codes, result fields) lives in
 * probe-contract.js, which the Phase 0 probe already uses at runtime. It is
 * imported here rather than copied, so the schema and the hand-written
 * validator cannot drift apart about what a probe is.
 */
import { z } from 'zod'

import {
  CONTRACT_VERSION,
  MAX_REQUEST_BYTES,
  PROBE_ACTIONS,
  PROBE_CHANNEL,
  PROBE_ERROR_CODES,
  PROBE_RESULT_FIELDS,
} from './probe-contract.js'

export { CONTRACT_VERSION, PROBE_CHANNEL, PROBE_RESULT_FIELDS }

/**
 * Every channel the desktop main process will ever register.
 *
 * `probeRun` is the Phase 0 channel, kept at the same string because an
 * installed build and the probe view's smoke check both name it.
 */
export const CHANNELS = Object.freeze({
  contractInfo: 'copilot:contract:info',
  probeRun: PROBE_CHANNEL,
})

export type ChannelKey = keyof typeof CHANNELS
export type ChannelName = (typeof CHANNELS)[ChannelKey]

export const CHANNEL_NAMES: readonly ChannelName[] = Object.freeze(Object.values(CHANNELS))

/**
 * Why a request was refused. Fixed tokens only: a refusal may be caused by
 * anything a renderer sent, including a pasted credential, so nothing from the
 * request is ever echoed back or logged.
 */
export const REFUSAL_REASONS = Object.freeze([
  'internal_error',
  'invalid_request',
  'invalid_response',
  'untrusted_sender',
])

export type RefusalReason = (typeof REFUSAL_REASONS)[number]

/** zod needs a non-empty tuple; the source constants are plain readonly arrays. */
function tupleOf<T extends string> (values: readonly T[], label: string): [T, ...T[]] {
  const [first, ...rest] = values
  if (first === undefined) throw new Error(`${label} must list at least one value`)
  return [first, ...rest]
}

const PROBE_ACTION_ENUM = z.enum(tupleOf(PROBE_ACTIONS, 'PROBE_ACTIONS'))
const PROBE_ERROR_ENUM = z.enum(tupleOf(PROBE_ERROR_CODES, 'PROBE_ERROR_CODES'))
const CHANNEL_ENUM = z.enum(tupleOf(CHANNEL_NAMES, 'CHANNEL_NAMES'))
const REFUSAL_ENUM = z.enum(tupleOf(REFUSAL_REASONS, 'REFUSAL_REASONS'))

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/** A status code, or null when the request never reached a server. */
const httpStatus = z.union([z.number().int().min(100).max(599), z.null()])

/* ------------------------------------------------------------------ probe -- */

/**
 * The probe request. Same two keys and the same refusal rule as
 * `validateProbeRequest`, expressed as a schema so the shape has a type.
 *
 * The size limit is checked after parsing because zod does not measure bytes;
 * a 2 MB string in `action` fails the enum first, but a caller can still send a
 * large object whose keys all happen to be valid.
 */
export const probeRequestSchema = z
  .strictObject({
    action: PROBE_ACTION_ENUM,
    confirmWrite: z.boolean(),
  })
  .refine(value => value.action !== 'write' || value.confirmWrite, {
    message: 'write_not_confirmed',
  })
  .refine(value => JSON.stringify(value).length <= MAX_REQUEST_BYTES, {
    message: 'too_large',
  })

export type ProbeRequest = z.infer<typeof probeRequestSchema>

/**
 * The probe reply, exactly as `sanitizeProbeResult` builds it: every field
 * present, every optional field null rather than missing, no free text.
 */
export const probeResultSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  action: PROBE_ACTION_ENUM,
  status: z.enum(['ok', 'failed']),
  errorCode: z.union([PROBE_ERROR_ENUM, z.null()]),
  httpStatus,
  cleanupHttpStatus: httpStatus,
  durationMs: z.union([z.number().int().min(0), z.null()]),
  checkedAt: z.union([z.string().regex(ISO_TIMESTAMP), z.null()]),
  workspaceCount: z.union([z.number().int().min(0), z.null()]),
  workspaceId: z.union([z.number().int().positive(), z.null()]),
  taskCreated: z.union([z.boolean(), z.null()]),
  taskDeleted: z.union([z.boolean(), z.null()]),
})

export type ProbeResult = z.infer<typeof probeResultSchema>

/* ---------------------------------------------------------- contract info -- */

/** The status call takes nothing. An empty strict object rejects any payload. */
export const contractInfoRequestSchema = z.strictObject({})

export const contractInfoValueSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  channels: z.array(CHANNEL_ENUM).min(1),
})

export type ContractInfoValue = z.infer<typeof contractInfoValueSchema>

/**
 * Every Phase 1 reply is an envelope, so a refusal travels as data instead of a
 * thrown error: Electron copies a thrown message into the renderer, and an
 * error string is the easiest place to leak an internal detail.
 */
export const contractInfoResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: contractInfoValueSchema }),
  z.strictObject({ ok: z.literal(false), reason: REFUSAL_ENUM }),
])

export type ContractInfoResult = z.infer<typeof contractInfoResultSchema>

/** The one value the contract-info channel answers with. */
export function contractInfo (): ContractInfoValue {
  return { contractVersion: CONTRACT_VERSION, channels: [...CHANNEL_NAMES] }
}
