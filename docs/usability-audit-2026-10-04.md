# WorkSpace usability audit

Date: 4 October 2026. Scope: current source, workflow contracts, project design
coverage, frontend tests, production build, and Django checks. No application code
was changed. This is a code-based audit, not an authenticated browser walkthrough
or a usability study. Visual layout, device behavior, and production latency need
separate validation. Product opportunities below are hypotheses to test with users.

The highest-value work is making existing features dependable and easier to reach.
The app already provides task filters, templates, bulk actions, notification deep
links, chat drafts, a personal planner, responsive navigation, and error surfaces.
Recommendations should extend those mechanisms rather than duplicate them.

## Prioritized findings

### 1. Search should open the exact result - high priority

Observed: `src/main.jsx` `openSearchResult` opens tasks from the loaded task array,
but other kinds only select a destination page. It does not pass the channel,
conversation, message, check-in, follow-up, or risk ID to that page. The backend
search response supplies target IDs and message result IDs, but the navigation
does not consume them. Search failures only log to the console. `tasks/views.py`
`workspace_search` returns up to eight results per kind without pagination and
does not search project names, calendar events, or documents.

Improve: reuse notification navigation to open and highlight the exact object;
pass message result IDs; fetch a task if it is absent from local state; show a retryable
search error. Then add result-type filters and a full results view.

Success: a match opens the matching record or message in one action; failed search
never looks like a successful empty search. Effort: medium.

### 2. Preserve data when refresh requests fail - high priority

Observed: the workspace loader in `src/main.jsx` catches individual collection
failures and returns empty fallbacks. The refresh then writes those values into
state and clears loading. A failed task page can also leave a partial task list.
This can make existing work appear to disappear without a user-facing explanation.

Improve: retain the last successful collection, track errors per collection, show
stale-data status with last successful sync time, and retry only failed requests.
Do not present incomplete pagination as a complete dataset.

Success: interrupting one endpoint preserves existing records and offers a clear
recovery action. Effort: medium.

### 3. Extend draft recovery beyond chat - high priority

Observed: chat stores drafts by workspace and conversation/channel. The shared
record composer closes on backdrop click, and `openComposer` resets form fields
when reopened. There is no equivalent persisted draft mechanism in that composer
or the task creation flow.

Improve: preserve drafts for tasks, check-ins, events, projects, and follow-ups;
offer resume/discard; protect changed forms from accidental dismissal. Scope
storage by user, workspace, and record type, clear on logout/success, and define
retention before persisting private text.

Success: accidental dismissal, reload, or session interruption does not lose a
long check-in. Effort: medium.

### 4. Reduce startup and refresh work - high priority

Observed: the production main JavaScript chunk is 1,148.22 kB minified,
316.36 kB gzip; the main stylesheet is 621.18 kB, 91.29 kB gzip. Chat, workspace
tools, and screen sharing are already lazy loaded. The workspace loader requests
about 20 collections and waits for all of them. Outside Team, it loads task pages
sequentially, up to 50 pages of 200. A 15-second pulse already avoids unnecessary
full refreshes, but any changed fingerprint still triggers the broad refresh.

Improve: measure startup on a constrained phone; lazy load more route content;
load Today data first; fetch route-specific collections on demand; refresh only
changed collections. Use server-side filters/pagination for large task datasets.

Success: useful Today content appears before reports, templates, and archived
conversations finish loading; benchmark small and large workspaces. Effort: large
overall, deliverable in small steps. These sizes indicate a measurement target,
not proof of observed production slowness.

### 5. Make the work destinations easier to understand - medium priority

Observed: the sidebar has 16 destinations, including My tasks, My planner,
Daily operations, Team, and Planner. These have distinct data and purposes, but
their relationship requires learning. Mobile Chats opens a panel while the
sidebar Chats destination opens a page.

Improve: explain personal versus assigned versus shared work beside page headings;
allow pinned destinations; make the same navigation label behave consistently;
consider a compact default navigation after testing with members and managers.
Preserve existing URLs and approved design references.

Success: a new member can identify where to plan their own day and where to
update shared work without assistance. Effort: small to medium; needs user testing.

### 6. Bring private planning into the daily overview - medium priority

Observed: Today already has assigned tasks, events, follow-ups, and exceptions.
`TodayDashboard` receives no personal-planner data. PersonalPlanner uses separate
private records and explicitly stays outside team boards and reports.

Improve: optionally show the current user's private plan alongside assigned work
on Today, clearly labelled private. Add one deliberate daily focus selection.
Keep private records out of shared reports and notifications.

Success: a person can review their day in one place without exposing private work.
Effort: medium; a product opportunity rather than a broken feature.

### 7. Make capture lighter - medium priority

Observed: task creation presents description, ownership, timing, and placement in
one form. PersonalPlanner already offers a simple inline capture field.

Improve: offer a title-first shared task capture with sensible context defaults,
then expand details. Add a discoverable shortcut menu using the existing search
shortcut as a starting point. Do not guess assignment or silently publish private
items into shared work.

Success: capture a basic task from any main page in a few seconds, then enrich it
later. Effort: small to medium; confirm current capture pain with users.

### 8. Give users more control over interruptions - medium priority

Observed: notification preferences, sound, push, and automation digests already
exist. No quiet-hours or snooze mechanism was found in the reviewed notification
models, automation, or settings implementation.

Improve: add quiet hours and granular preferences for mentions, assignments,
reminders, and general updates; allow snoozing actionable reminders. Retain
unread items and define urgent-event behavior explicitly.

Success: users can reduce interruptions while still finding work requiring their
response. Effort: medium to large; validate notification volume first.

### 9. Guide the first useful session - medium priority

Observed: authentication, invitations, and empty-workspace creation exist, but no
guided first-use checklist was found in the reviewed shell/authentication flows.

Improve: add a dismissible role-aware checklist using existing actions: choose a
workspace, create or accept a task, plan the day, and configure notifications.
Managers can additionally invite a teammate and choose a project template.

Success: a new user reaches one meaningful completed action without reading a
long guide. Effort: small to medium; measure onboarding completion first.

### 10. Add automated browser coverage for the daily journey - supporting priority

Observed: CI runs component tests, backend checks/tests, builds, and container
smoke checks. It does not run a browser journey. Ten HTML sanitizer tests are
skipped because the configured happy-dom environment is unsuitable. This is a
coverage gap, not evidence of an exploitable sanitizer bug.

Improve: use the already installed Playwright for login, workspace selection,
task creation/update, search-to-record, chat, and network-failure recovery. Exercise
keyboard navigation and narrow mobile widths. Run sanitizer cases in a supported
browser environment rather than treating skipped tests as verified behavior.

Success: CI catches broken everyday journeys and unsafe rich-text regressions.
Effort: medium.

## Suggested delivery order

1. Exact search navigation, explicit search errors, and retained data on refresh
   failure. These resolve observed behavior with immediate user impact.
2. Draft recovery and lighter capture. These protect effort and shorten daily work.
3. Profile startup and deliver incremental route/data loading improvements.
4. Validate navigation, the private Today panel, onboarding, and interruption
   controls with representative members and managers before redesigning them.

New surfaces should be added to the project's approved OpenPencil design coverage
before UI implementation. Existing API permissions and private-data boundaries
remain authoritative.

## Verification

- Frontend: 66 test files passed; 577 tests passed, 10 skipped. Exit code 0.
  The run also emitted network-refusal and teardown-abort noise, so test isolation
  should be tightened even though assertions passed.
- Production build: passed, with the main-chunk size warning described above.
- Django system check: passed with no issues.
- Full backend suite: started, then stopped after more than ten minutes because
  it exceeded the useful verification scope of this documentation-only audit.
  No full-suite pass is claimed. The run emitted local missing-staticfiles
  warnings and expected login-lockout logs before cancellation.
- No authenticated browser, production load test, or real-device notification
  delivery verification was performed in this audit.
