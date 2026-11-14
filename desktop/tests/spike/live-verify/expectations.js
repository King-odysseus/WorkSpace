'use strict'

/*
 * Turn one live run into the acceptance checks the Lead will re-read.
 *
 * Every check is a plain predicate over the run record, so the same list can be
 * printed by the runner, asserted by a unit test, and quoted in the report. The
 * runner refuses to call a run successful unless all of them pass.
 */

const EXPECTATIONS = Object.freeze([
  {
    id: 'read_loaded_from_web_view_session',
    description: 'The main process read the signed-in user workspaces on the web view session',
    check: run => {
      const read = run.read || {}
      const signIn = run.signIn || {}
      return read.status === 'ok' &&
        Number.isInteger(read.workspaceCount) && read.workspaceCount >= 1 &&
        Number.isInteger(read.workspaceId) && read.workspaceId > 0 &&
        signIn.sessionCookieObserved === true &&
        signIn.sameSessionAsWebView === true
    },
    detail: run => {
      const read = run.read || {}
      const signIn = run.signIn || {}
      return `status=${read.status} workspaces=${read.workspaceCount} workspaceId=${read.workspaceId} ` +
        `sessionCookie=${signIn.sessionCookieObserved === true} sameSession=${signIn.sameSessionAsWebView === true}`
    },
  },
  {
    id: 'write_created_task',
    description: 'The main process created the uniquely marked task',
    check: run => {
      const write = run.write || {}
      return write.status === 'ok' && write.taskCreated === true && write.httpStatus === 201
    },
    detail: run => {
      const write = run.write || {}
      return `status=${write.status} httpStatus=${write.httpStatus} taskCreated=${write.taskCreated}`
    },
  },
  {
    id: 'write_removed_task_permanently',
    description: 'The marked task was permanently deleted and is gone from the database',
    check: run => {
      const write = run.write || {}
      const cleanup = run.cleanup || {}
      return write.taskDeleted === true &&
        write.cleanupHttpStatus === 200 &&
        cleanup.checked === true &&
        cleanup.markersRemaining === 0 &&
        cleanup.tasksAfter === cleanup.tasksBefore
    },
    detail: run => {
      const write = run.write || {}
      const cleanup = run.cleanup || {}
      return `taskDeleted=${write.taskDeleted} cleanupHttpStatus=${write.cleanupHttpStatus} ` +
        `dbChecked=${cleanup.checked === true} markersRemaining=${cleanup.markersRemaining} ` +
        `tasksBefore=${cleanup.tasksBefore} tasksAfter=${cleanup.tasksAfter}`
    },
  },
  {
    id: 'signed_out_read_refused',
    description: 'With no session, the read reported not_signed_in instead of data',
    check: run => {
      const out = run.signedOut || {}
      const read = out.read || {}
      return out.cookiesBefore === 0 &&
        read.status === 'failed' &&
        read.errorCode === 'not_signed_in' &&
        read.workspaceCount === null
    },
    detail: run => {
      const out = run.signedOut || {}
      const read = out.read || {}
      return `cookiesBefore=${out.cookiesBefore} status=${read.status} errorCode=${read.errorCode} ` +
        `workspaceCount=${read.workspaceCount}`
    },
  },
  {
    id: 'signed_out_write_refused_without_task',
    description: 'With no session, the write reported not_signed_in and attempted no task creation',
    check: run => {
      const out = run.signedOut || {}
      const write = out.write || {}
      return write.status === 'failed' &&
        write.errorCode === 'not_signed_in' &&
        write.taskCreated !== true &&
        out.writeRequests === 0
    },
    detail: run => {
      const out = run.signedOut || {}
      const write = out.write || {}
      return `status=${write.status} errorCode=${write.errorCode} taskCreated=${write.taskCreated} ` +
        `writeRequests=${out.writeRequests}`
    },
  },
  {
    id: 'evidence_carries_no_secrets',
    description: 'The evidence file contains no session cookie, CSRF token, or password',
    check: run => {
      const secrets = run.secretsCheck || {}
      return secrets.checked === true && Array.isArray(secrets.leaked) && secrets.leaked.length === 0
    },
    detail: run => {
      const secrets = run.secretsCheck || {}
      const leaked = Array.isArray(secrets.leaked) ? secrets.leaked : []
      return `checked=${secrets.checked === true} leaked=${leaked.length === 0 ? 'none' : leaked.join(', ')}`
    },
  },
])

/** Every check, evaluated in order, with its one-line detail. */
function evaluateLiveRun(run) {
  return EXPECTATIONS.map(expectation => ({
    id: expectation.id,
    description: expectation.description,
    pass: Boolean(expectation.check(run || {})),
    detail: expectation.detail(run || {}),
  }))
}

function allPassed(results) {
  return Array.isArray(results) && results.length > 0 && results.every(result => result.pass === true)
}

module.exports = {
  EXPECTATIONS,
  allPassed,
  evaluateLiveRun,
}
