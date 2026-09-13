// What's new entries live here and ship with the deploy, so the page describes
// the build it is running with. Nothing is fetched: there is no table, no editor
// and no endpoint, which also means the page cannot be wrong about a feature it
// claims to have.
//
// Newest first. The page renders the array in order, and the unread marker
// compares the first entry's date against the newest date this browser has seen,
// so shipping an entry is all it takes to raise the marker again.

const SEEN_KEY = 'workspace-whats-new-seen-v1'

const RELEASE_NOTES = [
  {
    date: '2026-09-13',
    title: 'Zuri can read your documents',
    items: [
      'Attach a PDF, Word file, spreadsheet, text file or image in the Zuri composer with the paperclip, then ask about it.',
      'Personal details in a document are replaced with placeholders before anything is sent.',
      'Zuri says so when a file was too long to read in full, or when it could not be read at all.',
    ],
  },
  {
    date: '2026-09-13',
    title: 'Plan your own day',
    items: [
      'My planner is a private list of your own, separate from team tasks.',
      'Nobody else in the workspace can see it, including owners and managers.',
      'Tick an item to finish it, and keep as many planners as you need.',
    ],
  },
  {
    date: '2026-09-13',
    title: 'Share a task between several people',
    items: [
      'A task can have more than one assignee. Everyone on it sees it in My tasks, gets the reminders, and can edit it.',
      'The first person you tick stays the primary owner, so workload reports and blocked-task alerts keep a single name to report.',
    ],
  },
  {
    date: '2026-09-13',
    title: 'A calmer calendar',
    items: [
      'The Upcoming panel can be collapsed when you are working in the grid.',
      'Upcoming tasks and events now read as a timeline with their deadlines attached.',
    ],
  },
]

/** The newest entry's date, used as the whole-page "as of" marker. */
export function latestReleaseDate() {
  return RELEASE_NOTES.length ? RELEASE_NOTES[0].date : ''
}

/**
 * Whether anything has been published since this browser last opened the page.
 *
 * ISO day strings compare correctly as plain strings, so no date parsing is
 * needed here. An empty stored value means the page has never been opened, which
 * counts as unread.
 */
export function releaseNotesUnread() {
  if (!RELEASE_NOTES.length) return false
  try {
    return RELEASE_NOTES[0].date > (window.localStorage.getItem(SEEN_KEY) || '')
  } catch {
    // Storage can be unavailable; fall back to showing nothing unread rather
    // than badging a page the user cannot clear.
    return false
  }
}

export function markReleaseNotesSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, latestReleaseDate())
  } catch {
    // Optional: the marker simply stays until storage works again.
  }
}

export { RELEASE_NOTES }
