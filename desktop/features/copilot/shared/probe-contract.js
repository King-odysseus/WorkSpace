'use strict'

/*
 * The only request and result shapes the desktop spike exchanges over IPC.
 *
 * Two properties make this safe to hand to a renderer:
 *
 * 1. A request carries no URL, method, header or body. The renderer can ask for
 *    one of two fixed actions and nothing else, so it cannot turn the main
 *    process into a proxy for an arbitrary request. Validation rejects unknown
 *    keys instead of ignoring them, which is what makes that guarantee real.
 * 2. A result is rebuilt from an allowlist of scalar fields. Cookies, CSRF
 *    tokens, response bodies and email addresses are dropped here rather than
 *    trusted to the window that renders them.
 *
 * This module has no dependencies and no Electron import, so both the main
 * process and the test runner can load it.
 */

const CONTRACT_VERSION = 1

// One channel, one action pair. There is deliberately no generic invoke.
const PROBE_CHANNEL = 'copilot:probe:run'
const CONTRACT_INFO_CHANNEL = 'copilot:contract:info'

const PROBE_ACTIONS = Object.freeze(['read', 'write'])

// Fixed vocabulary: the probe reports a code, never a provider or server
// message, because those can echo credentials back.
const PROBE_ERROR_CODES = Object.freeze([
  'csrf_rejected',
  'http_error',
  'network_error',
  'no_workspace',
  'not_implemented',
  'not_signed_in',
  'unknown',
])

// Every field a renderer may ever see. The order is also the order of the
// object this module builds.
const PROBE_RESULT_FIELDS = Object.freeze([
  'contractVersion',
  'action',
  'status',
  'errorCode',
  'httpStatus',
  'cleanupHttpStatus',
  'durationMs',
  'checkedAt',
  'workspaceCount',
  'workspaceId',
  'taskCreated',
  'taskDeleted',
])

const REQUEST_FIELDS = Object.freeze(['action', 'confirmWrite'])

// Reasons are for logs and tests only. They never echo the offending input.
const VALIDATION_REASONS = Object.freeze([
  'invalid_action',
  'invalid_confirm_write',
  'not_a_plain_object',
  'too_large',
  'unknown_key',
  'write_not_confirmed',
])

const MAX_REQUEST_BYTES = 512
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

function isPlainObject (value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isOneOf (value, allowed) {
  return typeof value === 'string' && allowed.includes(value)
}

function toStatusCode (value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null
}

function toCount (value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

function toId (value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

function toBoolean (value) {
  return typeof value === 'boolean' ? value : null
}

function toDuration (value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return Math.round(value)
}

function toIsoTimestamp (value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

function fail (reason) {
  return Object.freeze({ ok: false, reason })
}

/**
 * Validate a renderer request. Accepts only the two known keys, so a caller
 * that tries to smuggle a URL, header, body or workspace id is rejected rather
 * than partially honoured.
 *
 * Returns { ok: true, value } with a frozen copy, or { ok: false, reason }.
 */
function validateProbeRequest (request) {
  if (!isPlainObject(request)) return fail('not_a_plain_object')
  if (Object.getOwnPropertySymbols(request).length > 0) return fail('unknown_key')

  for (const key of Object.keys(request)) {
    if (!REQUEST_FIELDS.includes(key)) return fail('unknown_key')
  }

  let serialised
  try {
    serialised = JSON.stringify(request)
  } catch {
    // A getter that throws or a circular value: not something to interpret.
    return fail('not_a_plain_object')
  }
  if (typeof serialised !== 'string' || serialised.length > MAX_REQUEST_BYTES) {
    return fail('too_large')
  }

  if (!isOneOf(request.action, PROBE_ACTIONS)) return fail('invalid_action')
  if (typeof request.confirmWrite !== 'boolean') return fail('invalid_confirm_write')
  // Creating a task is the only write the spike performs, so it is never
  // implicit. The check lives here, not in the UI.
  if (request.action === 'write' && request.confirmWrite !== true) return fail('write_not_confirmed')

  return Object.freeze({
    ok: true,
    value: Object.freeze({ action: request.action, confirmWrite: request.confirmWrite }),
  })
}

/**
 * Project an internal probe outcome onto the allowed fields.
 *
 * Throws TypeError when `action` is missing or unknown: that is a programming
 * error in the main process, not something to render, and returning an invented
 * action would misreport which request ran.
 */
function sanitizeProbeResult (raw) {
  if (!isPlainObject(raw)) throw new TypeError('probe result must be a plain object')
  if (!isOneOf(raw.action, PROBE_ACTIONS)) throw new TypeError('probe result action is invalid')

  const status = raw.status === 'ok' ? 'ok' : 'failed'
  const errorCode = status === 'ok'
    ? null
    : (isOneOf(raw.errorCode, PROBE_ERROR_CODES) ? raw.errorCode : 'unknown')

  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    action: raw.action,
    status,
    errorCode,
    httpStatus: toStatusCode(raw.httpStatus),
    cleanupHttpStatus: toStatusCode(raw.cleanupHttpStatus),
    durationMs: toDuration(raw.durationMs),
    checkedAt: toIsoTimestamp(raw.checkedAt),
    workspaceCount: toCount(raw.workspaceCount),
    workspaceId: toId(raw.workspaceId),
    taskCreated: toBoolean(raw.taskCreated),
    taskDeleted: toBoolean(raw.taskDeleted),
  })
}

/** A sanitized failure, so callers never hand-build one. */
function failedProbeResult (action, errorCode, extra) {
  return sanitizeProbeResult({
    action,
    status: 'failed',
    errorCode,
    checkedAt: new Date().toISOString(),
    ...(isPlainObject(extra) ? extra : {}),
  })
}

/**
 * Structural check for anything crossing to a window. Stricter than
 * sanitizeProbeResult: exact key set, enum values only, and no free-text field,
 * so an ISO timestamp is the only arbitrary-looking string permitted.
 */
function isSanitizedProbeResult (value) {
  if (!isPlainObject(value)) return false

  const keys = Object.keys(value)
  if (keys.length !== PROBE_RESULT_FIELDS.length) return false
  if (!PROBE_RESULT_FIELDS.every(field => Object.hasOwn(value, field))) return false

  if (value.contractVersion !== CONTRACT_VERSION) return false
  if (!isOneOf(value.action, PROBE_ACTIONS)) return false
  if (value.status !== 'ok' && value.status !== 'failed') return false
  if (value.errorCode !== null && !isOneOf(value.errorCode, PROBE_ERROR_CODES)) return false
  if (value.status === 'ok' && value.errorCode !== null) return false
  if (value.httpStatus !== null && toStatusCode(value.httpStatus) !== value.httpStatus) return false
  if (value.cleanupHttpStatus !== null && toStatusCode(value.cleanupHttpStatus) !== value.cleanupHttpStatus) return false
  if (value.durationMs !== null && toDuration(value.durationMs) !== value.durationMs) return false
  if (value.checkedAt !== null && toIsoTimestamp(value.checkedAt) !== value.checkedAt) return false
  if (value.workspaceCount !== null && toCount(value.workspaceCount) !== value.workspaceCount) return false
  if (value.workspaceId !== null && toId(value.workspaceId) !== value.workspaceId) return false
  if (value.taskCreated !== null && typeof value.taskCreated !== 'boolean') return false
  if (value.taskDeleted !== null && typeof value.taskDeleted !== 'boolean') return false

  return true
}

module.exports = {
  CONTRACT_VERSION,
  PROBE_CHANNEL,
  CONTRACT_INFO_CHANNEL,
  PROBE_ACTIONS,
  PROBE_ERROR_CODES,
  PROBE_RESULT_FIELDS,
  REQUEST_FIELDS,
  VALIDATION_REASONS,
  MAX_REQUEST_BYTES,
  validateProbeRequest,
  sanitizeProbeResult,
  failedProbeResult,
  isSanitizedProbeResult,
}
