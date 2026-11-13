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
    date: '2026-11-13',
    title: 'Timeline, milestones and linked tasks',
    items: [
      'The Planner has a new Timeline view next to Board: every task with dates is a bar from its start to its due date, with today marked.',
      'Drag a bar to move it, or pull either end to change a date. Tasks without dates are listed under the chart, where you can give them one.',
      'Select the link button on a bar, then another task, to say it must wait. The arrow turns red when the later task is planned to start too early. Select an arrow to remove the link.',
      'Owners and managers can add milestones with a date. Attach tasks to one from the task or from the timeline, and it is reached when all its tasks are done or when you mark it reached.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'The team day at a glance',
    items: [
      'For owners and managers, Team now opens with a Daily picture: planned hours for each person against their day, tasks done today, time logged, and whether they have checked in.',
      'A strip across the top counts who has checked in, who is clocked in, what is done, blocked, overdue, on leave and at home. Select a number to filter the list.',
      'Open a person to see their day: tasks done, under way, blocked and overdue, their check-in, the last thing they finished and a four-week trend. Reassign a task from there.',
      'This week shows a grid of planned hours against capacity for each person and day, with suggested moves from overbooked days to people with room, and a list of work nobody owns yet.',
      'A warning says when open tasks have no estimate, because workload is understated until they do. Owners and managers also get an end-of-day summary notification at 6pm.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Follow-ups you can open, and a banner that steps through memos',
    items: [
      'Select a follow-up to open it: read the whole note, see who it is for, comment, and mark it complete or reopen it.',
      'When several memos are showing in the banner, arrows and an "n of N" counter step through them. Memos also show in the notification bell with a megaphone icon.',
      'Sticky notes have more room inside, left and right.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Filter boards by date',
    items: [
      'Planner and Daily operations have a Due date filter: today, tomorrow, this week, next week, this month, overdue, no due date, or two dates you pick.',
      'Day plan blocks can now be dragged anywhere on the board and ticked off as done, from My planner or from Today.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Sticky notes',
    items: [
      'Your day plan is now a board of sticky notes, one per block with its time and length, or a list. Add your own note to any block.',
      'My planner can show your items as sticky notes on a board. Drag a note anywhere and it stays there. Edit its title and text in place, change its colour, tick it to finish it, or remove it: archive it to restore it later, or delete it for good.',
      'Today has a Quick note, one sticky note for jotting things down that saves as you type, and a Sticky notes board with your plan and open planner items. The board is closed until you open it, and Today remembers your choice and whether you prefer the board or a list.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Time off, requests and where we work',
    items: [
      'Time off: request annual leave, sick leave or another absence, with half days. Managers approve leave for members, and owners approve leave for managers. Everyone can see who is away.',
      'Approved leave comes out of capacity on the Team page, and people on leave show as On leave. Zuri plans your day around it.',
      'Requests: ask your managers for something from Memos/Requests > Requests, and see the answer. Managers can approve, decline or reply.',
      'Request memos: a manager can ask the whole team for a response by a date, and see who has answered and who has not.',
      'Where we work: see who is in the office, at home or elsewhere each day. Set your usual week, change single days, and owners can choose optional office days.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Company memos',
    items: [
      'Owners and managers can post memos. The newest one shows as a banner you can open, read, and close for yourself, and it also arrives as a notification.',
      'Zuri can draft a memo for you. It shows what it will post and waits for your confirmation.',
      'Owners and managers who do not need to check in can turn on Skip my daily check-ins in Settings.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Zuri improvements',
    items: [
      'Plan my day: Zuri suggests a schedule that fits your working hours, with times for each task and short 5-minute breaks. It is saved as a note under My planner that you can edit or delete, and it never counts in your progress ring.',
      'New chat is a plus icon in the Zuri header, and the other actions sit in a menu. The message box is rounder and grows as you type.',
      'Minimised Zuri is a small round icon with its own close button, above the bottom bar on a phone.',
      'Scrolling inside Zuri on a phone no longer scrolls the page behind it.',
    ],
  },
  {
    date: '2026-11-13',
    title: 'Today and Team',
    items: [
      'The progress ring on Today now counts your own planner items and the tasks assigned to you in other planners and workstreams.',
      'Team availability no longer shows people who are offline or busy as Available.',
      'Planner columns are about one screen tall and scroll inside, so the Done bar sits at the bottom of the screen. Tasks finished more than 60 days ago move to Archived, where they can still be viewed and restored.',
    ],
  },
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
