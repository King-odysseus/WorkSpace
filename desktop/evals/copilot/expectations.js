'use strict'

/*
 * How an evaluation case is judged.
 *
 * Two rules shape everything here.
 *
 * 1. A turn that did not happen is never a pass. The run says `timeout`, `error`,
 *    `invalid_shape` or `blocked_by_privacy` and the case is counted in that
 *    bucket. Only an answer that actually arrived and actually parsed is judged on
 *    its content. The earlier evaluation let a failed call read as "the model
 *    correctly said nothing", which made the negative cases look perfect and hid
 *    the failures, so the verdict is decided by the caller before this module is
 *    asked anything.
 *
 * 2. An expectation is a set of clauses with tokens, not a golden string. The
 *    prompt asks for "one short sentence", so demanding exact wording would fail
 *    a correct answer that used different words. A clause names what must be
 *    true (`kind` and the words that carry the meaning) and what must not be
 *    smuggled in alongside it (`none`).
 *
 * Matching is a case-insensitive substring test over normalised text, so "The
 * Tilley invoice is on hold until Friday" satisfies `all: ['tilley', 'friday']`.
 * That is deliberately coarse: a token is chosen because it is the part of the
 * meaning that cannot be paraphrased away, and a case that needs finer judgement
 * than that is a case that needs a person reading it, not a matcher pretending.
 */

const DASHES = /[\u2010-\u2015]/gu

/** The comparison form: case, spacing, dashes and trailing punctuation dropped. */
function normalise (text) {
  return String(text)
    .replace(DASHES, '-')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/[.!?,;:]+$/u, '')
    .toLowerCase()
}

/** Every token appears in the text. An empty token list is always true. */
function hasAll (text, tokens) {
  const haystack = normalise(text)
  return tokens.every((token) => haystack.includes(normalise(token)))
}

/** No token appears in the text. */
function hasNone (text, tokens) {
  const haystack = normalise(text)
  return tokens.every((token) => !haystack.includes(normalise(token)))
}

/**
 * Match clauses against a list of rows, greedily and one row per clause.
 *
 * `distinct` is what makes "split the way they described it" checkable: a two
 * task request answered with one task that mentions both halves matches both
 * clauses against the same row, and the request was still not split. With
 * distinct on, a row can satisfy one clause only.
 */
function matchClauses (rows, clauses, options = {}) {
  const distinct = options.distinct !== false
  const used = new Set()
  const results = []

  for (const clause of clauses) {
    let matchedIndex = -1

    for (let index = 0; index < rows.length; index += 1) {
      if (distinct && used.has(index)) continue
      const row = rows[index]
      if (clause.kind !== undefined && row.kind !== clause.kind) continue

      const text = row.text
      if (!hasAll(text, clause.all ?? [])) continue
      if (clause.none !== undefined && !hasNone(text, clause.none)) continue

      matchedIndex = index
      break
    }

    if (matchedIndex >= 0) {
      const row = rows[matchedIndex]
      used.add(matchedIndex)
      results.push({
        label: clause.label,
        ok: true,
        matched: row.text,
        matchedKind: row.kind ?? null,
      })
    } else {
      results.push({
        label: clause.label,
        ok: false,
        matched: null,
        matchedKind: null,
        wanted: {
          kind: clause.kind ?? null,
          all: clause.all ?? [],
          none: clause.none ?? [],
        },
      })
    }
  }

  return results
}

/** Rows whose text contains every token of a forbidden phrase, with the text. */
function findForbidden (rows, phrases) {
  const found = []
  for (const phrase of phrases) {
    for (const row of rows) {
      if (hasAll(row.text, phrase.all ?? [])) {
        found.push({ label: phrase.label, text: row.text })
        break
      }
    }
  }
  return found
}

/*
 * Memory extraction.
 *
 * `rows` are the items the repository actually stored, not the items the model
 * returned. A model that answered but whose answer was then refused by the
 * apply rules has taught the app nothing, and that is the outcome the panel
 * shows, so that is the outcome judged here. The model's own answer rides along
 * in the run record so a reader can tell the two apart.
 */
function judgeMemory (expect, rows, options = {}) {
  const checks = []

  if (expect.preSendBlocked !== undefined) {
    return {
      verdict: 'pass',
      evidence: 'blocked_before_send',
      checks: [{
        label: `the privacy rule stops this before it is sent (${expect.preSendBlocked})`,
        ok: true,
        detail: 'no model call was made for this case',
      }],
      storedCount: 0,
    }
  }

  if (expect.silent === true) {
    checks.push({
      label: 'nothing is stored',
      ok: rows.length === 0,
      detail: rows.length === 0 ? 'no items' : rows.map((row) => row.text).join(' | '),
    })
    return finish(checks, rows)
  }

  const clauses = expect.items ?? []
  checks.push(...matchClauses(rows, clauses, { distinct: expect.distinct }))

  if (expect.forbidden !== undefined) {
    // One check per phrase, carrying the phrase's own label, so a failure in the
    // report names the thing that was stored when it should not have been.
    const found = findForbidden(rows, expect.forbidden)
    for (const phrase of expect.forbidden) {
      const hit = found.find((entry) => entry.label === phrase.label)
      checks.push({
        label: phrase.label,
        ok: hit === undefined,
        detail: hit === undefined ? 'not stored' : hit.text,
      })
    }
  }

  if (expect.minItems !== undefined) {
    checks.push({
      label: `at least ${expect.minItems} item(s) stored`,
      ok: rows.length >= expect.minItems,
      detail: `stored ${rows.length}`,
    })
  }

  if (expect.maxItems !== undefined) {
    checks.push({
      label: `at most ${expect.maxItems} item(s) stored`,
      ok: rows.length <= expect.maxItems,
      detail: `stored ${rows.length}`,
    })
  }

  if (options.applyResult !== undefined) {
    // Recorded, not judged: the reason a stored item is missing is the useful
    // part of a failure, and `dropped` is where the apply rules name it.
    checks.push({
      label: 'apply result recorded',
      ok: true,
      detail: JSON.stringify(options.applyResult),
    })
  }

  return finish(checks, rows)
}

/*
 * Task drafting.
 *
 * `rows` are the proposal rows the repository accepted. `text` is title, notes
 * and due hint together, because "do not invent an owner" is broken just as
 * badly by a note as by a title.
 */
function judgeDrafting (expect, rows) {
  const checks = []

  if (expect.preSendBlocked !== undefined) {
    return {
      verdict: 'pass',
      evidence: 'blocked_before_send',
      checks: [{
        label: `the privacy rule stops this before it is sent (${expect.preSendBlocked})`,
        ok: true,
        detail: 'no model call was made for this case',
      }],
      storedCount: 0,
    }
  }

  if (expect.silent === true) {
    checks.push({
      label: 'no card is drafted',
      ok: rows.length === 0,
      detail: rows.length === 0 ? 'no tasks' : rows.map((row) => row.title).join(' | '),
    })
    return finish(checks, rows)
  }

  const clauses = expect.tasks ?? []
  checks.push(...matchClauses(rows, clauses, { distinct: expect.distinct }))

  if (expect.exactCount !== undefined) {
    checks.push({
      label: `exactly ${expect.exactCount} card(s)`,
      ok: rows.length === expect.exactCount,
      detail: `drafted ${rows.length}`,
    })
  }

  if (expect.minTasks !== undefined) {
    checks.push({
      label: `at least ${expect.minTasks} card(s)`,
      ok: rows.length >= expect.minTasks,
      detail: `drafted ${rows.length}`,
    })
  }

  if (expect.maxTasks !== undefined) {
    checks.push({
      label: `at most ${expect.maxTasks} card(s)`,
      ok: rows.length <= expect.maxTasks,
      detail: `drafted ${rows.length}`,
    })
  }

  if (expect.forbidInText !== undefined) {
    const found = findForbidden(rows, expect.forbidInText)
    for (const phrase of expect.forbidInText) {
      const hit = found.find((entry) => entry.label === phrase.label)
      checks.push({
        label: phrase.label,
        ok: hit === undefined,
        detail: hit === undefined ? 'no forbidden words' : hit.text,
      })
    }
  }

  if (expect.dueHint !== undefined) {
    const withHint = rows.filter((row) => typeof row.dueHint === 'string' && row.dueHint.length > 0)
    if (expect.dueHint === 'absent') {
      checks.push({
        label: 'no due hint when no deadline was given',
        ok: withHint.length === 0,
        detail: withHint.length === 0 ? 'no due hint' : withHint.map((row) => row.dueHint).join(' | '),
      })
    } else {
      checks.push({
        label: 'the deadline the person gave is carried',
        ok: withHint.length > 0,
        detail: withHint.length === 0 ? 'no due hint on any card' : withHint.map((row) => row.dueHint).join(' | '),
      })
    }
  }

  return finish(checks, rows)
}

function finish (checks, rows) {
  const failed = checks.filter((check) => !check.ok)
  return {
    verdict: failed.length === 0 ? 'pass' : 'fail',
    evidence: failed.length === 0 ? 'content' : 'content',
    checks,
    failed: failed.map((check) => check.label),
    storedCount: rows.length,
  }
}

module.exports = {
  normalise,
  hasAll,
  matchClauses,
  findForbidden,
  judgeMemory,
  judgeDrafting,
}
