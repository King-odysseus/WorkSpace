'use strict'

/*
 * Behaviour of the acceptance checks for a live verification run.
 *
 * A run is only allowed to be called successful when every check passes, so
 * these tests do two jobs: prove a complete good run passes, and prove that
 * breaking any single fact turns exactly that check red. The empty-run cases
 * matter too: a run that recorded nothing must never look like a pass.
 */

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')

const { EXPECTATIONS, allPassed, evaluateLiveRun } = require('./expectations')

// The ids are quoted in the evidence file and in the summary a reviewer reads,
// so they are part of the contract, not an implementation detail.
const EXPECTED_IDS = [
  'read_loaded_from_web_view_session',
  'write_created_task',
  'write_removed_task_permanently',
  'signed_out_read_refused',
  'signed_out_write_refused_without_task',
  'evidence_carries_no_secrets',
]

// A complete run where every acceptance fact holds. Each test gets a fresh copy
// so a mutation in one case cannot leak into the next.
function goodRun() {
  return {
    signIn: {
      sessionCookieObserved: true,
      sameSessionAsWebView: true,
    },
    signedOut: {
      cookiesBefore: 0,
      read: { status: 'failed', errorCode: 'not_signed_in', workspaceCount: null },
      write: { status: 'failed', errorCode: 'not_signed_in', taskCreated: null },
      writeRequests: 0,
    },
    read: { status: 'ok', workspaceCount: 1, workspaceId: 7 },
    write: {
      status: 'ok',
      httpStatus: 201,
      cleanupHttpStatus: 200,
      taskCreated: true,
      taskDeleted: true,
    },
    cleanup: {
      checked: true,
      markersRemaining: 0,
      tasksBefore: 0,
      tasksAfter: 0,
    },
    secretsCheck: { checked: true, leaked: [] },
  }
}

function failedIds(run) {
  return evaluateLiveRun(run)
    .filter(result => result.pass !== true)
    .map(result => result.id)
}

// One broken fact per row, each naming the single check that must notice it.
const BREAKAGES = [
  {
    name: 'the read never reached the signed-in session',
    fails: 'read_loaded_from_web_view_session',
    mutate: run => {
      run.read = { status: 'failed', errorCode: 'not_signed_in', workspaceCount: null, workspaceId: null }
    },
  },
  {
    name: 'the session cookie was never observed',
    fails: 'read_loaded_from_web_view_session',
    mutate: run => {
      run.signIn.sessionCookieObserved = false
    },
  },
  {
    name: 'the main process did not prove it used the web view session',
    fails: 'read_loaded_from_web_view_session',
    mutate: run => {
      run.signIn.sameSessionAsWebView = false
    },
  },
  {
    name: 'the task create did not answer 201',
    fails: 'write_created_task',
    mutate: run => {
      run.write.httpStatus = 403
    },
  },
  {
    name: 'the task was never created',
    fails: 'write_created_task',
    mutate: run => {
      run.write.taskCreated = false
    },
  },
  {
    name: 'the delete did not answer 200',
    fails: 'write_removed_task_permanently',
    mutate: run => {
      run.write.cleanupHttpStatus = 404
    },
  },
  {
    name: 'the marked task is still in the database',
    fails: 'write_removed_task_permanently',
    mutate: run => {
      run.cleanup.markersRemaining = 1
    },
  },
  {
    name: 'the database was never checked after the delete',
    fails: 'write_removed_task_permanently',
    mutate: run => {
      run.cleanup.checked = false
    },
  },
  {
    name: 'the signed-out read returned workspace data',
    fails: 'signed_out_read_refused',
    mutate: run => {
      run.signedOut.read.workspaceCount = 1
    },
  },
  {
    name: 'the signed-out write created a task',
    fails: 'signed_out_write_refused_without_task',
    mutate: run => {
      run.signedOut.write.taskCreated = true
    },
  },
  {
    name: 'the signed-out probe still sent task create requests',
    fails: 'signed_out_write_refused_without_task',
    mutate: run => {
      run.signedOut.writeRequests = 1
    },
  },
  {
    name: 'a secret label was found in the evidence',
    fails: 'evidence_carries_no_secrets',
    mutate: run => {
      run.secretsCheck.leaked = ['session cookie']
    },
  },
  {
    name: 'the secrets check never ran',
    fails: 'evidence_carries_no_secrets',
    mutate: run => {
      run.secretsCheck.checked = false
    },
  },
]

describe('EXPECTATIONS', () => {
  it('lists the acceptance checks under stable ids', () => {
    assert.deepEqual(
      EXPECTATIONS.map(expectation => expectation.id),
      EXPECTED_IDS,
      'renaming or reordering a check changes the evidence contract, so it must be deliberate',
    )
  })

  it('gives every check a unique lowercase id and a description a reviewer can read', () => {
    const ids = EXPECTATIONS.map(expectation => expectation.id)

    assert.equal(new Set(ids).size, ids.length, `duplicate check id in: ${ids.join(', ')}`)
    for (const expectation of EXPECTATIONS) {
      assert.match(expectation.id, /^[a-z0-9_]+$/, `${expectation.id} should be a plain snake_case id`)
      assert.equal(typeof expectation.description, 'string', `${expectation.id} needs a description`)
      assert.ok(
        expectation.description.trim().length > 0,
        `${expectation.id} has an empty description, so a FAIL row would not say what failed`,
      )
    }
  })
})

describe('a complete good run', () => {
  it('passes every expectation', () => {
    const run = goodRun()
    const results = evaluateLiveRun(run)
    const failures = results.filter(result => result.pass !== true)

    assert.deepEqual(
      failures.map(result => `${result.id}: ${result.detail}`),
      [],
      'a run that records every required fact should have no failing check',
    )
    assert.equal(results.length, EXPECTATIONS.length, 'every check should be evaluated')
    assert.equal(allPassed(results), true, 'allPassed should accept a run where every check passed')
  })

  it('reports the id, description, verdict and detail for every check', () => {
    const results = evaluateLiveRun(goodRun())

    for (const result of results) {
      assert.equal(typeof result.id, 'string')
      assert.equal(typeof result.description, 'string')
      assert.equal(typeof result.detail, 'string', `${result.id} must print a detail line in the summary`)
      assert.ok(result.detail.length > 0, `${result.id} must print a detail line in the summary`)
      assert.equal(result.pass, true, `${result.id} should pass on the good run`)
    }
  })
})

describe('one broken fact fails the run', () => {
  it('has a breakage case for every acceptance check', () => {
    const covered = new Set(BREAKAGES.map(breakage => breakage.fails))

    assert.deepEqual(
      EXPECTED_IDS.filter(id => !covered.has(id)),
      [],
      'every check needs at least one case proving it can fail',
    )
  })

  for (const breakage of BREAKAGES) {
    it(`fails ${breakage.fails} when ${breakage.name}`, () => {
      const run = goodRun()
      breakage.mutate(run)

      const failures = failedIds(run)

      assert.deepEqual(
        failures,
        [breakage.fails],
        `only ${breakage.fails} should fail when ${breakage.name}, but these failed: ${failures.join(', ') || 'none'}`,
      )
      assert.equal(
        allPassed(evaluateLiveRun(run)),
        false,
        `allPassed must reject a run where ${breakage.name}`,
      )
    })
  }

  it('explains the broken fact in the detail text', () => {
    const statusRun = goodRun()
    statusRun.write.httpStatus = 403
    const statusResult = evaluateLiveRun(statusRun).find(result => result.id === 'write_created_task')

    assert.match(statusResult.detail, /httpStatus=403/, 'the detail should name the status that was actually seen')

    const secretRun = goodRun()
    secretRun.secretsCheck.leaked = ['session cookie']
    const secretResult = evaluateLiveRun(secretRun).find(result => result.id === 'evidence_carries_no_secrets')

    assert.match(secretResult.detail, /leaked=session cookie/, 'the detail should name the leaked secret')
  })
})

describe('an empty or malformed run', () => {
  it('reports one failed result per expectation with a detail line', () => {
    const results = evaluateLiveRun({})

    assert.equal(results.length, EXPECTATIONS.length, 'an empty run still has to report every check')
    assert.deepEqual(results.map(result => result.id), EXPECTED_IDS)
    for (const result of results) {
      assert.equal(result.pass, false, `${result.id} must not pass when the run recorded nothing`)
      assert.equal(typeof result.detail, 'string', `${result.id} must still print a detail line`)
      assert.ok(result.detail.length > 0, `${result.id} must still print a detail line`)
    }
    assert.equal(allPassed(results), false, 'a run with no evidence is not a pass')
  })

  it('does not throw on missing or wrongly typed input', () => {
    const garbage = [
      null,
      undefined,
      {},
      [],
      { read: 'nope' },
      { read: null, write: 7, cleanup: [], signedOut: 'no', signIn: 1, secretsCheck: true },
      { read: {}, write: {}, cleanup: {}, signedOut: {}, signIn: {}, secretsCheck: {} },
    ]

    for (const run of garbage) {
      assert.doesNotThrow(
        () => evaluateLiveRun(run),
        `evaluateLiveRun must not throw for ${JSON.stringify(run)}`,
      )
      assert.equal(
        evaluateLiveRun(run).filter(result => result.pass === true).length,
        0,
        `nothing should pass for ${JSON.stringify(run)}`,
      )
    }
  })
})

describe('allPassed', () => {
  it('is true only when every result passed', () => {
    assert.equal(allPassed([{ pass: true }, { pass: true }]), true)
    assert.equal(allPassed([{ pass: true }, { pass: false }]), false, 'one failure is a failed run')
    assert.equal(allPassed([{ pass: true }, { pass: 'yes' }]), false, 'a verdict must be a real boolean true')
  })

  it('does not call an empty or missing result list a pass', () => {
    assert.equal(allPassed([]), false, 'no results means nothing was verified')
    assert.equal(allPassed(null), false)
    assert.equal(allPassed(undefined), false)
  })
})
