// Draft recovery for the create-record forms.
//
// Every create form in this app lived only in React state, so a stray backdrop
// click, a reopen, or a reload threw the typing away - which for a long check-in
// or a partly written task is real work. Chat already kept drafts (see
// ChatViews.jsx) keyed by workspace and thread; this is the same idea with the
// two things that pattern was missing: the reader's own id, so one account can
// never be shown another's private text on a shared browser, and an expiry, so
// private text does not sit in localStorage forever.
//
// Two rules the callers depend on: a read never throws, and a failed write is
// reported but never blocks the form.

const DRAFT_PREFIX = 'workspace-record-draft'
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// What each type persists. These are the form's own field names, so a caller can
// hand its whole form state straight in.
const DRAFT_FIELDS = {
  task: [
    'newTask',
    'newDescription',
    'newAssigneeIds',
    'newProjectId',
    'newWorkstreamId',
    'newBucket',
    'newDueDate',
    'newRecurrence',
    'newPriority',
    'newTaskStatus',
    'newTaskTemplate',
  ],
  calendar: ['title', 'description', 'start_at', 'end_at', 'event_type', 'reminder_minutes'],
  project: ['name', 'description', 'due_date'],
  checkin: ['date', 'completed', 'next_steps', 'blockers'],
  followup: ['note', 'due_date', 'assigned_to', 'task_id'],
  chat: ['channel', 'message'],
}

// The one field a form cannot be saved without. Everything else in a draft is
// context around it, so without this there is nothing worth resuming and the
// composer must not offer to restore a form that was never really started.
const DRAFT_REQUIRED_FIELD = {
  task: 'newTask',
  calendar: 'title',
  project: 'name',
  checkin: 'completed',
  followup: 'note',
  chat: 'message',
}

export const RECORD_DRAFT_TYPES = Object.keys(DRAFT_FIELDS)

export function recordDraftKey(userId, workspaceId, type) {
  return `${DRAFT_PREFIX}:${userId}:${workspaceId}:${type}`
}

export function hasDraftContent(type, fields) {
  const required = DRAFT_REQUIRED_FIELD[type]
  if (!required) return false
  return String(fields?.[required] ?? '').trim() !== ''
}

export function pickDraftFields(type, fields) {
  const picked = {}
  for (const name of DRAFT_FIELDS[type] || []) picked[name] = fields?.[name]
  return picked
}

const remove = (key) => {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // No store, nothing to remove.
  }
}

/**
 * The draft for one user, workspace, and record type, or null.
 *
 * Returns null for a draft that has expired or that holds no more than the
 * form's defaults, and removes it on the way past so it is not offered again.
 *
 * @returns {{ fields: Record<string, unknown>, savedAt: Date } | null}
 */
export function readRecordDraft(userId, workspaceId, type, now = Date.now()) {
  if (!userId || !workspaceId || !DRAFT_FIELDS[type]) return null
  const key = recordDraftKey(userId, workspaceId, type)
  let raw = null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Unreadable is indistinguishable from absent, but it must not be kept.
    remove(key)
    return null
  }
  const savedAt = Number(parsed?.savedAt) || 0
  const expired = !savedAt || now - savedAt > DRAFT_MAX_AGE_MS
  if (expired || !hasDraftContent(type, parsed?.fields)) {
    remove(key)
    return null
  }
  return { fields: parsed.fields, savedAt: new Date(savedAt) }
}

/**
 * Store a draft. Clears it instead when the form holds nothing worth keeping.
 * @returns {boolean} whether a draft is on disk afterwards.
 */
export function writeRecordDraft(userId, workspaceId, type, fields, now = Date.now()) {
  if (!userId || !workspaceId || !DRAFT_FIELDS[type]) return false
  if (!hasDraftContent(type, fields)) {
    clearRecordDraft(userId, workspaceId, type)
    return false
  }
  try {
    window.localStorage.setItem(
      recordDraftKey(userId, workspaceId, type),
      JSON.stringify({ savedAt: now, fields: pickDraftFields(type, fields) }),
    )
    return true
  } catch {
    // A full or unavailable store must never stand between someone and typing.
    return false
  }
}

export function clearRecordDraft(userId, workspaceId, type) {
  if (!userId || !workspaceId || !DRAFT_FIELDS[type]) return
  remove(recordDraftKey(userId, workspaceId, type))
}

// Signing out must not leave one person's half-written check-in on the browser
// for the next person to find, whichever workspace it belonged to.
export function clearUserRecordDrafts(userId) {
  if (!userId) return
  const prefix = `${DRAFT_PREFIX}:${userId}:`
  const doomed = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key && key.startsWith(prefix)) doomed.push(key)
    }
  } catch {
    return
  }
  doomed.forEach(remove)
}
