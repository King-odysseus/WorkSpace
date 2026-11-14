'use strict'

/*
 * The two probe flows the spike reports on.
 *
 * `read` proves the desktop inherits the web sign-in. `write` proves the same session
 * can create one real task and remove it again. Both return a plain outcome object
 * built from the shared contract's field list; the IPC layer sanitizes it, and nothing
 * here ever holds a cookie, a token or an email address.
 *
 * The write flow is deliberately paranoid, because a half-finished probe leaves a row
 * in somebody's workspace:
 *
 * - it writes only into the workspace the caller selected by id, and only when that
 *   membership is an active owner, so the task cannot land in a shared board;
 * - it sends a title and nothing else, which is what makes the task unassigned;
 * - it keeps the returned id in memory and removes the row with `?permanent=true`;
 * - it believes the response only when the response says the row was permanently
 *   deleted, because the server archives instead of deleting when the flag is missing.
 */

const { randomBytes } = require('node:crypto')

const { PROBE_ACTIONS } = require('../../shared/probe-contract.js')

const MARKER_PREFIX = 'Probe task '
const MAX_TITLE_LENGTH = 200

const SYSTEM_CLOCK = Object.freeze({
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
})

function isPlainObject (value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Ids reach this module two ways: as numbers in the server's JSON, and as strings from
 * configuration, because `process.env` only ever holds strings. Both are accepted, but
 * digits only: a fraction, a `0`, `'12abc'` or `'0x10'` is null, so a misconfigured id
 * can never be read as a real workspace.
 */
function toPositiveInt (value) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^[0-9]+$/.test(trimmed)) return null
    value = Number(trimmed)
  }
  return Number.isInteger(value) && value > 0 ? value : null
}

/**
 * The server's answer to a refused request. A 403 without a JSON body is Django's
 * `CsrfViewMiddleware` turning the request away before the view runs, which is how a
 * missing or stale token looks. A 403 with a JSON body came from the view, so the
 * session was accepted and the permission was not.
 */
function classifyRefusal (status, payload) {
  if (status === 403 && payload === null) return 'csrf_rejected'
  return 'http_error'
}

/**
 * `user.workspaces` from GET /api/auth/me/, reduced to the fields the probe reads.
 * Returns null when the answer is not the shape the endpoint documents, so a changed
 * server cannot be mistaken for a user with no workspaces.
 */
function readWorkspaces (user) {
  if (!isPlainObject(user) || !Array.isArray(user.workspaces)) return null
  return user.workspaces.flatMap(entry => {
    if (!isPlainObject(entry)) return []
    const id = toPositiveInt(entry.id)
    if (id === null) return []
    return [{
      id,
      role: typeof entry.role === 'string' ? entry.role : '',
      status: typeof entry.status === 'string' ? entry.status : '',
      permissions: Array.isArray(entry.permissions)
        ? entry.permissions.filter(permission => typeof permission === 'string')
        : null,
    }]
  })
}

/**
 * The write target: the workspace the caller named, which this user owns, which is
 * still active, and which grants task creation. Anything else is `no_workspace`
 * rather than a write into a workspace that happens to be first in the list.
 */
function selectWriteWorkspace (workspaces, requestedId) {
  if (!Array.isArray(workspaces)) return null
  const wanted = toPositiveInt(requestedId)
  if (wanted === null) return null
  const match = workspaces.find(workspace => workspace.id === wanted)
  if (!match) return null
  if (match.role !== 'owner' || match.status !== 'active') return null
  if (match.permissions !== null && !match.permissions.includes('create_tasks')) return null
  return match
}

function readTaskId (payload) {
  if (!isPlainObject(payload) || !isPlainObject(payload.task)) return null
  return toPositiveInt(payload.task.id)
}

/**
 * A 200 answer to `?permanent=true` is not proof on its own: the archive branch of the
 * same endpoint answers with `archived: true` and the task still exists.
 */
function isConfirmedPermanentDelete (payload, taskId) {
  if (!isPlainObject(payload)) return false
  if (payload.archived === true) return false
  return payload.permanent === true && payload.deleted === taskId
}

function createMarker (clock) {
  const stamp = Math.floor(clock.now()).toString(36)
  const suffix = randomBytes(4).toString('hex')
  const title = `${MARKER_PREFIX}${stamp}-${suffix}`
  return title.slice(0, MAX_TITLE_LENGTH)
}

function errorCodeOf (error) {
  if (error && typeof error.code === 'string' && error.name === 'WorkspaceApiError') return error.code
  return 'unknown'
}

/**
 * @param {object} options
 * @param {object} options.client     from createWorkspaceClient
 * @param {number|string} options.workspaceId the isolated workspace chosen by
 *   configuration; a numeric string is accepted and converted here
 * @param {object} [options.clock]     injectable so tests get fixed timings
 */
function createProbe ({ client, workspaceId = null, clock = SYSTEM_CLOCK } = {}) {
  if (!client || typeof client.getMe !== 'function' || typeof client.createTask !== 'function') {
    throw new TypeError('a workspace client is required')
  }
  if (!clock || typeof clock.now !== 'function' || typeof clock.iso !== 'function') {
    throw new TypeError('a clock is required')
  }

  function report (action, startedAt, fields) {
    return {
      action,
      status: fields.errorCode ? 'failed' : 'ok',
      errorCode: fields.errorCode || null,
      httpStatus: fields.httpStatus === undefined ? null : fields.httpStatus,
      cleanupHttpStatus: fields.cleanupHttpStatus === undefined ? null : fields.cleanupHttpStatus,
      // A clock that steps backwards must not produce a negative duration.
      durationMs: Math.max(0, Math.floor(clock.now() - startedAt)),
      checkedAt: clock.iso(),
      workspaceCount: fields.workspaceCount === undefined ? null : fields.workspaceCount,
      workspaceId: fields.workspaceId === undefined ? null : fields.workspaceId,
      taskCreated: fields.taskCreated === undefined ? null : fields.taskCreated,
      taskDeleted: fields.taskDeleted === undefined ? null : fields.taskDeleted,
    }
  }

  async function runRead () {
    const startedAt = clock.now()
    try {
      const me = await client.getMe()
      if (me.status !== 200) {
        return report('read', startedAt, { errorCode: classifyRefusal(me.status, me.payload), httpStatus: me.status })
      }
      // A visitor gets 200 with `authenticated: false`, so the flag decides, not the
      // status code.
      if (!me.payload || me.payload.authenticated !== true) {
        return report('read', startedAt, { errorCode: 'not_signed_in', httpStatus: me.status })
      }
      const workspaces = readWorkspaces(me.payload.user)
      if (workspaces === null) {
        return report('read', startedAt, { errorCode: 'unknown', httpStatus: me.status })
      }
      const wanted = toPositiveInt(workspaceId)
      const selected = wanted === null ? null : workspaces.find(workspace => workspace.id === wanted) || null
      return report('read', startedAt, {
        httpStatus: me.status,
        workspaceCount: workspaces.length,
        workspaceId: selected ? selected.id : null,
      })
    } catch (error) {
      return report('read', startedAt, { errorCode: errorCodeOf(error) })
    }
  }

  async function runWrite () {
    const startedAt = clock.now()
    // Filled in as the flow learns more, so a failure halfway through still reports a
    // task that was created and not removed.
    const state = { workspaceCount: null, workspaceId: null, taskCreated: null, taskDeleted: null }
    let httpStatus = null

    try {
      const me = await client.getMe()
      httpStatus = me.status
      if (me.status !== 200) {
        return report('write', startedAt, { errorCode: classifyRefusal(me.status, me.payload), httpStatus })
      }
      if (!me.payload || me.payload.authenticated !== true) {
        return report('write', startedAt, { errorCode: 'not_signed_in', httpStatus })
      }
      const workspaces = readWorkspaces(me.payload.user)
      if (workspaces === null) {
        return report('write', startedAt, { errorCode: 'unknown', httpStatus })
      }
      state.workspaceCount = workspaces.length

      const selected = selectWriteWorkspace(workspaces, workspaceId)
      if (selected === null) {
        return report('write', startedAt, { errorCode: 'no_workspace', httpStatus, workspaceCount: workspaces.length })
      }
      state.workspaceId = selected.id

      const created = await client.createTask(selected.id, { title: createMarker(clock) })
      httpStatus = created.status
      if (created.status !== 201) {
        state.taskCreated = false
        return report('write', startedAt, {
          errorCode: classifyRefusal(created.status, created.payload),
          httpStatus,
          workspaceCount: state.workspaceCount,
          workspaceId: state.workspaceId,
          taskCreated: false,
        })
      }
      state.taskCreated = true

      const taskId = readTaskId(created.payload)
      if (taskId === null) {
        // The status says a task exists, but without its id no cleanup is possible.
        // Report that instead of claiming a deletion that cannot happen.
        return report('write', startedAt, {
          errorCode: 'unknown',
          httpStatus,
          workspaceCount: state.workspaceCount,
          workspaceId: state.workspaceId,
          taskCreated: true,
          taskDeleted: false,
        })
      }

      const cleanup = await client.deleteTaskPermanently(taskId)
      if (cleanup.status < 200 || cleanup.status > 299) {
        return report('write', startedAt, {
          errorCode: classifyRefusal(cleanup.status, cleanup.payload),
          httpStatus,
          cleanupHttpStatus: cleanup.status,
          workspaceCount: state.workspaceCount,
          workspaceId: state.workspaceId,
          taskCreated: true,
          taskDeleted: false,
        })
      }
      if (!isConfirmedPermanentDelete(cleanup.payload, taskId)) {
        // 2xx but the row survived: the server archived it, or answered without
        // confirming. Either way the workspace is not clean.
        return report('write', startedAt, {
          errorCode: 'unknown',
          httpStatus,
          cleanupHttpStatus: cleanup.status,
          workspaceCount: state.workspaceCount,
          workspaceId: state.workspaceId,
          taskCreated: true,
          taskDeleted: false,
        })
      }
      state.taskDeleted = true
      return report('write', startedAt, {
        httpStatus,
        cleanupHttpStatus: cleanup.status,
        workspaceCount: state.workspaceCount,
        workspaceId: state.workspaceId,
        taskCreated: true,
        taskDeleted: true,
      })
    } catch (error) {
      // Anything already created but not confirmed deleted stays reported as such.
      return report('write', startedAt, {
        errorCode: errorCodeOf(error),
        httpStatus,
        workspaceCount: state.workspaceCount,
        workspaceId: state.workspaceId,
        taskCreated: state.taskCreated,
        taskDeleted: state.taskDeleted === true,
      })
    }
  }

  async function run (action) {
    if (!PROBE_ACTIONS.includes(action)) {
      // A rejected promise rather than a synchronous throw, so the IPC handler has one
      // shape to await.
      throw new TypeError('unknown probe action')
    }
    return action === 'read' ? runRead() : runWrite()
  }

  return Object.freeze({ run, runRead, runWrite })
}

module.exports = {
  MARKER_PREFIX,
  SYSTEM_CLOCK,
  classifyRefusal,
  createMarker,
  createProbe,
  isConfirmedPermanentDelete,
  readWorkspaces,
  selectWriteWorkspace,
  toPositiveInt,
}
