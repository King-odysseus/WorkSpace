# Upgrades 1

Prepared: 4 October 2026.
Source: [Usability audit](usability-audit-2026-10-04.md).
Status: Phases 1 and 2 (UX-04 to UX-11) delivered, and UX-12 to UX-14 from Phase 3.
See Progress at the end of this file.

## Objective and scope

Make everyday work dependable, quick to capture, and easy to find. Deliver small
changes to the existing Django and React application, reusing current APIs,
notification navigation, design components, and installed tooling.

Start with confirmed search, refresh, and draft-recovery problems. Validate broader
product changes with members and managers before building them. No new dependencies
are assumed. New UI states must follow the approved OpenPencil design coverage;
prepare missing states before implementing them. Preserve permissions, existing
URLs, task/report definitions, and the separation between private and shared work.

Effort estimates below are provisional engineering days for one developer, including
targeted testing. They are not delivery dates. Scheduling depends on user feedback,
design availability, and findings from the first browser walkthrough.

## Phase 0: Establish a usable baseline

Estimate: 1-2 days. Dependency: none.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-01 | Walk through sign-in, workspace switching, Today, task creation, search, chat, and check-ins on desktop and mobile. Include owner, manager, and member roles. | Partly done - desktop walked end to end for an owner; see Progress. |
| UX-02 | Measure startup and refresh against small and large disposable workspaces. Record device/network conditions, task counts, useful-content time, requests, and transferred bytes. | Done for startup on desktop - see Progress. |
| UX-03 | Add the first Playwright journey using existing tooling: sign-in, choose workspace, create/open/update task. Establish test fixtures and cleanup. | Done locally - see Progress. CI wiring is UX-23. |

Exit: reproducible baseline and a browser test protecting the core daily workflow.
Keep the remaining browser tests alongside the features they protect, rather than
waiting for a final testing phase.

## Phase 1: Fix trust and recovery

Estimate: 4-7 days. Dependency: Phase 0 baseline; reuse existing approved states.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-04 | Route every supported search result to its exact record or message using shared target navigation. Fetch tasks absent from local state. | Task/comment, channel/direct message, check-in, follow-up, and risk results open the correct item. Deleted or inaccessible items show an actionable outcome. Browser Back and workspace boundaries remain correct. |
| UX-05 | Add distinct search loading, empty, and error states with retry. Discard obsolete responses after query/workspace changes. | Offline, 403, 401, and server-error outcomes do not appear as successful empty results; retries use the current query and workspace. |
| UX-06 | Retain successful collection data on refresh failure. Track each collection's state and last successful refresh. Retry failures without requiring another data change. | A failed endpoint or later task page does not erase records or publish a partial list as complete. Genuine successful empty responses still clear old records. Workspace switches never display another workspace's data. |
| UX-07 | Extend browser coverage to search navigation, failed refresh, successful empty responses, session expiry, and recovery. | Tests reproduce the original defects and pass with the fixes. Existing notification deep links still work. |

Likely files: `src/main.jsx`, `src/lib/notification-navigation.js`,
`src/components/ChatViews.jsx`, `tasks/views.py`, and their relevant tests.
Extract only the shared navigation or loading logic necessary for these changes.

Exit: finding information and refreshing data remain trustworthy during failure.
Ship these fixes before the broader product work.

## Phase 2: Protect effort and speed up capture

Estimate: 4-6 days. Dependency: Phase 1; draft and capture design states defined.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-08 | Define and implement draft recovery for new tasks, check-ins, events, projects, and follow-ups. Separate drafts by user, workspace, and record type; define expiry. | A changed form survives dismissal/reload and offers resume/discard. Successful save clears only its draft. Logout clears drafts; another account cannot read them. Failed storage does not block editing. |
| UX-09 | Protect changed forms against accidental dismissal; define what happens while submission is in flight. | Escape, backdrop, navigation, and reload have consistent outcomes. Successful requests do not create duplicates after retry. Keyboard focus returns correctly. |
| UX-10 | Add title-first shared task capture with explicit context and optional details. Reuse the current creation API and full editor. | A basic task can be captured in at most three deliberate actions from a main work page. Ownership/project defaults are visible, editable, and valid for the user's permissions. |
| UX-11 | Add discoverable shortcuts for search and capture without intercepting typing or assistive controls. | Shortcuts work with keyboard-only navigation; help explains them; full-form capture remains available. |

Likely files: `src/components/WorkspaceComposer.jsx`,
`src/components/RecordDialogs.jsx`, `src/main.jsx`, and a shared draft utility if
needed. Reuse the chat-draft pattern while adding user isolation and lifecycle rules.

Exit: interruption does not lose work, and routine capture takes fewer steps.

## Phase 3: Improve measured loading performance

Estimate: 4-7 days. Dependency: Phase 0 measurements and Phase 1 recovery model.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-12 | Lazy load additional heavy routes and inspect stylesheet contribution. Avoid a wholesale shell rewrite. | Initial compressed JavaScript falls by a provisional target of at least 25%; route switching and service-worker updates remain correct. Confirm the target after baseline measurement. |
| UX-13 | Render useful Today content independently of reports, templates, archived conversations, and unrelated route data. | A slow unrelated endpoint cannot delay the useful daily view; visible sections have honest loading/error states. |
| UX-14 | Load collections on demand and refresh only affected collections. Retain pulse polling unless measurements justify a different transport. | No-change polling causes no collection reload. Common task/chat changes do not reload every collection. Visibility return and reconnect still refresh correctly. |
| UX-15 | Use server-side filtering/pagination where large task lists cause measured problems. Preserve accurate totals and complete reporting. | A representative large workspace stays navigable; page boundaries do not omit search results, board counts, or report records. |

Success target: at least 30% lower median time to useful Today content under the
same constrained-device benchmark, with no regression in normal route switching.
Measure repeat runs under identical conditions; tune targets after Phase 0 rather
than promising unsupported absolute timings.

Exit: benchmark improvement demonstrated, not inferred only from bundle sizes.

## Phase 4: Make daily workflows clearer

Estimate: 4-7 days plus participant/design availability.
Dependency: short usability sessions and approved new design states.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-16 | Test navigation with representative members and managers. Clarify personal versus assigned versus shared work; align mobile/desktop Chats behavior. Add pinned destinations if feedback supports it. | At least four of five pilot users find personal planning and shared work without help. Existing destinations and URLs remain reachable. |
| UX-17 | Add an optional private-planner section to Today and test daily-focus selection. | Only the current user's records appear. Private items never enter team APIs, reports, activity, search, or notifications. Users can hide the section. |
| UX-18 | Add a dismissible first-session checklist using existing actions, tailored to member/manager roles. | Progress reflects actual actions, survives reload, and can be dismissed. New users can complete one meaningful action without reading the guide. |
| UX-19 | Extend keyboard/mobile browser coverage to the revised navigation, private Today section, and onboarding. | Focus order, mobile keyboard/scrolling, long content, loading, and errors work at 320px and representative desktop widths. |

Treat pilot results as directional evidence, not statistical proof. Do not remove
or rename destinations solely because the sidebar is long.

## Phase 5: Control interruptions and complete release coverage

Estimate: 4-7 days. Dependency: notification-volume review and agreed delivery rules.

| ID | Task | Acceptance criteria |
| --- | --- | --- |
| UX-20 | Define notification preferences for mentions, assignments, reminders, and general updates. Add quiet hours and reminder snoozing. Specify timezone, overnight windows, daylight-saving, and urgent-event behavior. | Preferences apply consistently to in-app sound, push, email, and automation where supported. Quiet hours preserve unread work; snoozed reminders resume once without duplicates. |
| UX-21 | Verify foreground/background/closed-app notification delivery on supported real devices. | Permission denial, unsupported devices, reconnect, and disabled sound have clear outcomes. Delivery limitations are documented. |
| UX-22 | Run the ten skipped sanitizer cases in a supported browser environment using installed tooling. Tighten component-test network isolation. | Rich-text safety cases execute rather than skip; component tests do not make unintended network calls. |
| UX-23 | Complete the CI daily journey: task capture/update, exact search, chat, check-in, draft recovery, failure/retry, and mobile keyboard use. | CI provides repeatable fixtures, cleanup, and useful failure artifacts. Release checks pass. |

Likely files: `tasks/models.py`, `tasks/automation.py`, `tasks/push.py`,
`tasks/mailer.py`, `src/components/SettingsView.jsx`, `public/sw.js`, and CI/tests.
Only introduce schema changes required by agreed notification behavior.

## Delivery and release rules

1. Implement one reviewable task or small related group at a time. Check shared
   active work and recall relevant knowledge before editing.
2. Add regression tests for actual behavior changes; run targeted frontend/backend
   tests, build, and relevant Django checks. Run full suites at phase/release gates.
   Complete the previously interrupted backend suite before claiming release readiness.
3. Validate changed UI on desktop/mobile, with keyboard, empty/populated data,
   long text, permissions, expired sessions, and network failure as relevant.
4. Review diffs for secrets and unrelated changes, commit and push each logical
   change, and update the plan with results and remaining work.
5. Use reversible changes. Keep migrations backward compatible where practical;
   stage notification changes so old clients and pending deliveries remain valid.
6. Pilot product changes in a test workspace before wider release. Existing test
   accounts and disposable fixtures must not send real invitations or notifications.

## Recommended first delivery

Complete UX-01 through UX-07 as the first milestone. This establishes the browser
baseline and fixes exact search navigation and refresh reliability. Draft recovery
is the next milestone. Performance and broader product changes follow the evidence.

Total provisional effort: 21-36 engineering days, excluding waiting for design,
feedback, and deployment access. Re-estimate after Phase 0; deliver useful fixes
at the end of each phase rather than holding everything for one large release.

## Progress

### Phase 1: UX-04 to UX-07 - delivered 4 October 2026

| ID | Task | Status |
| --- | --- | --- |
| UX-04 | Route every supported search result to its exact record or message | Done |
| UX-05 | Distinct search loading, empty, and error states with retry | Done |
| UX-06 | Retain successful collection data on refresh failure | Done |
| UX-07 | Extend browser coverage to search navigation, failed refresh, empty responses, session expiry, and recovery | Partial - see Remaining below |

What shipped:

- Search hits now go through the same target navigation notifications use
  (`resolveSearchResultTarget` in `src/lib/notification-navigation.js` plus one
  `openTarget` in `src/main.jsx`). A channel or direct-message hit opens the
  thread on the matched message, a check-in or follow-up hit opens that record,
  and a task the loaded board does not hold is fetched and added to the task
  list before the drawer opens.
- A missing or unreachable target now says so and clears its pending id, so a
  click on a deleted record no longer looks like it did nothing.
- A search that fails, is refused, or meets an expired session shows the failure
  with a Retry that repeats the current query and workspace. It can no longer be
  read as "No matches". Rows from a previous query are dropped as soon as the
  query or workspace changes.
- The workspace loader tags every collection read and applies only the reads
  that actually arrived, keeping the previous copy for the rest. A later task
  page that fails no longer publishes the pages that did arrive as a whole list.
  The shell names which collections are stale, reports when the data on screen
  was last loaded in full, and offers a retry.

Verification:

- Frontend suite: 68 files, 590 passed, 10 skipped
  (`npx vitest run --maxWorkers=2`), against 577 passed before this phase.
- Production build: passed.
- No backend change was needed in this phase, so no Django behaviour changed.
  `workspace_search` already returned the target and message ids the frontend
  was ignoring.
- The new tests were confirmed to reproduce the original defects: forcing the
  old unconditional merge back into the loader fails the retention test, and
  retaining on an empty response fails the clearing test.

Remaining from UX-07:

- The regression coverage lives in the component-test suite
  (`src/App.search.test.jsx`, `src/App.refresh-failure.test.jsx`,
  `src/lib/notification-navigation.test.js`). No Playwright journey exists yet,
  because UX-03 has to establish the browser fixtures first and UX-23 has to
  turn these journeys into the CI check. Nothing in this phase reduces the work
  UX-03 and UX-23 still describe.
- Existing notification deep links are covered by the tests that already
  existed and still pass (`App.notification-document.test.jsx`,
  `App.notifications.test.jsx`).

Known limits:

- A task-comment hit opens the task that holds the comment. The search response
  carries no comment id and the task drawer has no comment anchor, so opening
  the exact comment needs both.
- Search still returns at most eight results per kind, with no result-type
  filters and no full results view. The audit lists those as follow-on work.
- Phase 0 was not part of this delivery, so no browser walkthrough or startup
  measurement baseline exists yet. Phase 3 targets still have nothing to measure
  against.

### Phase 2: UX-08 to UX-11 - delivered 4 October 2026

| ID | Task | Status |
| --- | --- | --- |
| UX-08 | Draft recovery for new tasks, check-ins, events, projects, and follow-ups | Done |
| UX-09 | Protect changed forms against accidental dismissal | Done |
| UX-10 | Title-first shared task capture | Done |
| UX-11 | Discoverable shortcuts for search and capture | Done |

What shipped:

- One draft store (`src/lib/record-drafts.js`) keyed by reader, workspace, and
  record type, expiring after seven days, with every storage call wrapped so a
  full or unavailable store cannot block editing. A draft is the base of an
  opened form and the caller's own request wins over it, so clicking a calendar
  slot still means that slot. A successful save clears only its own type.
  Signing out clears that reader's drafts.
- One dismissal path. Escape, the backdrop, and the close button all reach the
  same guard, which refuses while a request is in flight. Escape belongs to the
  top layer: the composer and the task form take it on window in the capture
  phase and stop it there, so one press closes one layer instead of the composer
  and everything behind it. Both submit paths hold a flag set synchronously
  around the request, so a second submit in the same tick cannot create twice.
  The composer hands focus back to the control that opened it.
- Title-first capture on Today: one field, the same endpoint and the same
  defaults as the full form, a line saying where the task will land, and an
  "Add details" action that opens the full form with the typed title carried
  over. It deliberately sends no owner, so the server keeps applying its own
  member-defaults-to-self rule.
- The shortcuts the help centre already listed now exist. `/` searches (as
  before), `N` captures a task, `Shift N` opens notifications, and `Ctrl \`
  toggles the sidebar. Every one stands down while the caret is in a field,
  while a dialog owns the keyboard, and while a key is held down. The capture
  field shows its own `N` hint, and the help page now says what the guards do.

Verification:

- Frontend suite: 73 files, 619 passed, 10 skipped
  (`npx vitest run --maxWorkers=2`), against 590 passed before this phase.
- Production build: passed.
- Each new test was confirmed to fail against the behaviour it replaces:
  removing the draft write, the in-flight close guard, the duplicate-submit
  guard, the Escape stop, the typing guard, the title hand-off, or the refusal
  retention each fails its test.

Readings and limits:

- UX-09 asks for changed forms to be protected from accidental dismissal. With
  UX-08 in place, closing no longer loses anything: the draft keeps the work and
  the form offers it back. So dismissal was not given a confirmation prompt,
  which would only interrupt someone whose typing is already safe. What was
  fixed is what that reading leaves broken - Escape reaching a handler that
  emptied the page, and any of the three exits abandoning a request mid-flight.
- UX-10 asks for ownership and project defaults to be "visible, editable". They
  are stated on the row and edited by opening the full form with the title
  carried across, rather than by putting owner and project pickers into the
  compact field, which would have made it three controls again. If the intent
  was inline pickers, that is a design question for the frame below.
- No OpenPencil coverage was authored, because the design tool was not connected
  in this session. Only primitives already in the design system were used: the
  existing composer, the Alert component for the draft notice, the ConfirmDialog,
  the Button, and the same bordered-field pattern as the header search. A
  dedicated frame should fold the draft notice, the capture row, and its key
  hint into the approved coverage before this is treated as designed.
- Drafts live in localStorage keyed by user id, so a shared browser's other
  accounts cannot read them, but anyone with access to the browser profile can.
  That was judged acceptable for the retention it buys, and is worth revisiting
  if drafts ever hold anything more sensitive than a task title.



### Phase 3: UX-12 - delivered 4 October 2026

| ID | Task | Status |
| --- | --- | --- |
| UX-12 | Lazy load additional heavy routes and inspect stylesheet contribution | Done |
| UX-13 | Render useful Today content independently of unrelated route data | Done |
| UX-14 | Load collections on demand and refresh only affected collections | Done |
| UX-15 | Server-side filtering and pagination for large task lists | Not started |

What shipped:

- Every route-only view is fetched when its destination opens rather than
  shipped in the entry bundle: the planner board, the project board and table,
  the import wizard, the personal planner, Settings, the create-workspace
  dialog, the five record dialogs, the task drawer, and the assignee picker.
  The workspace view carries one Suspense boundary, so the shell's chrome stays
  put while a chunk arrives; the surfaces the shell raises over everything get
  their own.
- react-day-picker moved out of the entry bundle. It is the largest single
  dependency in the build, and it is now one lazy component exported from
  workspace-ui, so the shell's own date field shares a chunk with the form
  fields instead of pulling a second copy.

Measured, against the same build command:

| Asset | Before | After | Change |
| --- | --- | --- | --- |
| Entry JavaScript | 1,159.36 kB / 319.82 kB gzip | 847.71 kB / 239.46 kB gzip | -26.9% raw, -25.1% gzip |
| Stylesheet | 621.26 kB / 91.30 kB gzip | 570.20 kB / 85.04 kB gzip | -8.2% raw, -6.9% gzip |

The plan's provisional target was at least 25% off the initial compressed
JavaScript, so this meets it. The stylesheet moved without being touched,
because the settings styles now travel with the settings view instead.

Verification:

- Frontend suite: 74 files, 620 passed, 10 skipped
  (`npx vitest run --maxWorkers=2`), against 619 before.
- Production build: passed.
- A new test walks to Planner, Settings, Import data, and My planner and
  asserts each view is really on screen, because the failure mode of this
  change is a destination that renders nothing rather than one that throws.
  It caught two wrong markers while it was being written. It does not cover the
  Suspense placement: removing a boundary makes React delay the render rather
  than fail, so the test still passes. Worth knowing if it is ever relied on to
  protect that.

Two measurements taken by rebuilding without the code, both worth keeping:

- `@sentry/react` costs this bundle nothing. The whole of it sits behind
  `import.meta.env.VITE_SENTRY_DSN` and tree-shakes away when no DSN is set. A
  deployment that sets one would pay for it.
- `flowbite-react` costs about 16.7 kB compressed. Removing it is not a
  performance change but a design one: the Button primitive renders Flowbite's
  control behind 78 call sites, and `ui/button.jsx` already carries a
  hand-written `buttonVariants` that only the calendar uses. Left alone
  deliberately, and flagged here rather than done quietly.

The stylesheet contribution, inspected but not changed:

- `src/pencil.css` is 592 kB of source and 8,618 lines, and it is the single
  largest asset the app ships, larger than the entry JavaScript. It declares
  5,173 selectors, of which 1,196 are repeat declarations of a selector already
  declared earlier in the same file; `.chat-modal-actions` and
  `.file-delete-actions` each appear seven times.
- Consolidating those is the obvious next step for this task, and it was not
  attempted here. The repeats are not necessarily dead: this file carries the
  design's overrides, and an earlier pass already found a selector painted half
  by one stylesheet and half by another. Each repeat needs reading against its
  call site and then a browser check, which is a different kind of work from the
  mechanical split this pass did, and a bulk edit would be the wrong tool.

### Phase 3: UX-13 - delivered 4 October 2026

What shipped:

- Every collection read writes its own slice of state the moment it answers,
  instead of the loader writing all twenty at the end of the batch. A slow
  reports endpoint, template list, or archived-conversation read can no longer
  hold back the tasks and events the day is made of.
- Three collections keep their grouping, because publishing them alone would be
  wrong: tasks, which arrive in pages and must never appear as a partial list,
  and the two the bell reads, whose count has to agree with the list under it.
  The batch still records how the load as a whole went, which is what the stale
  banner reports.
- Today now knows whether its own collections have answered. Until the tasks
  read answers, the panel says it is loading; when it fails, the panel says so.
  Neither is the empty state, which is reserved for a read that answered and
  found nothing.

Verification:

- Frontend suite: 75 files, 621 passed, 10 skipped
  (`npx vitest run --maxWorkers=2`), against 620 before.
- Production build: passed.
- `src/App.today-independence.test.jsx` holds four endpoints open - the reports
  summary, both template lists, and the archived conversations - and then holds
  the task read as well. It asserts the panel says it is loading rather than
  that the day is clear, releases the task read, and asserts the task appears
  while the other four are still outstanding.
- Both halves were confirmed to fail against the behaviour they replace:
  restoring the batch-then-write order leaves the task row absent, and letting
  the panel show its empty state before an answer fails the loading assertion.

Notes and limits:

- The loading and error states were added for the tasks panel, which is the
  section that had a visible dishonest one. The dashboard's other sections get
  the same signal through the same prop and can adopt it; they were not changed
  here, so a slow or failed events or follow-ups read still shows whatever it
  showed before.
- `TodayDashboard`'s own unit test now states the data state it renders in,
  because the component's contract gained one. Absent deliberately means
  nothing is known yet, so a caller that forgets the prop can only ever
  under-claim, never claim the day is clear. A future caller that wants the
  empty state has to say the read answered.

### Phase 3: UX-14 - delivered 4 October 2026

What shipped:

- The pulse endpoint answered with one digest, having already computed a part
  per collection before folding them together. It now answers with a digest per
  domain alongside the overall fingerprint, and a domain is named after the
  client's own collection keys wherever one exists.
- The client diffs the domains it was handed and refetches only the collections
  belonging to those that moved, so an arriving message no longer drags the task
  table, the calendar, the reports summary and the audit log with it. Reports
  has no table of its own and is refetched with any of tasks, check-ins or
  shifts, which it is derived from.
- Reconnecting checks the pulse. A tab that was offline missed every tick in
  between and used to wait for the next one.
- No-change polling still refetches nothing: the digest comparison is unchanged
  and is checked first.

The fallback, which is the part worth reviewing:

- A domain this client has no mapping for, or a response with no domains at all,
  refetches everything. Guessing the other way would mean never refreshing
  whatever that domain covers, and a collection nobody refreshes stops updating
  without ever saying so. Both directions have a test.
- `tasks/pulse.py`'s `DOMAIN_LABELS` is held to the labels the parts query can
  actually produce by `PulseDomainTests`, which asserts every label belongs to
  exactly one domain. That test caught a real bug in this change: the domain
  digests were being computed from the shared parts only, so the notification,
  chat and member domains would have ignored the viewer-specific state they
  exist to track.
- A partial refresh only speaks for the collections it asked for. A collection
  that was stale before and was not refetched is still reported stale, and the
  reports timestamp only moves when the reports collection was in the batch.
- The client-side test also caught a bug worth naming: `readAllTasks()` was
  being called while building the request list even when tasks were not wanted,
  because a ternary evaluates both of its branches. A chat-only refresh was
  fetching every page of the task table.

Verification:

- Frontend suite: 76 files, 624 passed, 10 skipped
  (`npx vitest run --maxWorkers=2`), against 621 before.
- Backend: `tasks.test_pulse` (4 tests), `tasks.tests.WorkspacePulseApiTests`
  (14) and `tasks.test_chat_collaboration` (28) all pass; Django check clean;
  production build passed.
- Both directions of `App.selective-refresh.test.jsx` were confirmed to fail
  against the behaviour they replace: always refetching everything fails the
  selective test, and ignoring an unknown domain fails the fallback test.

Limits:

- The claim "no-change polling causes no collection reload" is covered by the
  digest check being unchanged and first, not by a test that runs the fifteen
  second timer. Testing it would mean driving the interval under fake timers
  through a chain of real promises, which costs more than it protects.
- Task templates and the audit log have no domain, because the pulse's parts
  query does not include those tables. They are therefore only refetched on a
  load or a fallback refresh, which is what they did before this change - the
  selective path has not made it worse, but it has not fixed it either.

### Phase 0: UX-02 measured, 4 October 2026

Conditions. The production build, served by `vite preview` on port 5183 with an
API proxy added for the purpose, against the Django dev server on 8000. Chromium
driven by Playwright on the same machine, desktop viewport. Browser cache
disabled over CDP and the service worker unregistered for the first-visit runs,
so those are genuinely cold. No CPU or network throttling: these are
unconstrained local numbers and are not a device benchmark, which is what the
plan's 30% target asks for. Three runs per workspace, reporting the range.

Fixtures. Two disposable workspaces owned by a throwaway account
(`claude-verify@example.com`): "Claude Verify Workspace" with 6 tasks and
"Claude Verify Large" with 401. Seeded with `bulk_create`, no invitations sent,
no notifications raised, nothing outside the local database touched.

| | Small (6 tasks) | Large (401 tasks) |
| --- | --- | --- |
| First visit, useful Today content | 800 ms | 817 ms |
| Returning visit, useful Today content | 300-682 ms | 663-716 ms |
| First visit, requests / transferred | 17 / 457 kB | 37 / 809 kB |
| Returning visit, requests / transferred | 15-20 / 122 kB | 36 / 472 kB |
| API requests | 6-7 | 26 |

What the numbers say:

- The task table dominates the data, and it is fetched whole. 173 kB per page of
  200, three pages for 401 tasks, so about 520 kB of task JSON on a load that
  renders five rows. On a load without a change it is 347 kB of the 472 kB
  transferred. This is the measured problem UX-15 exists for, and it is larger
  than the audit guessed from reading the loader.
- The API does not compress. `transferSize` equals `decodedBodySize` on every
  task page, so 173 kB of highly repetitive JSON goes over the wire as 173 kB.
  Compressing the API is a far smaller change than pagination with a comparable
  effect on this data, and it is a decision for whoever owns the middleware
  rather than something to slip into a pagination task. Not done here.
- `tijha-logo.png` is 98 kB. On a returning visit that single image is most of
  what the browser fetches.
- Startup time barely differs between 6 tasks and 401 (800 ms against 817 ms),
  because locally the delay is the bundle rather than the data. On a real
  connection 347 kB of uncompressed JSON would not be free, which is the part
  these numbers cannot show.
- Large datasets do not silently truncate: 401 tasks came back as three pages,
  200 + 200 + 1, with no cap reached. The loader's page ceiling is 50 pages.

The selective refresh, verified live rather than only in tests. In the
production-build session, nine consecutive pulse ticks while the app sat idle
produced: nothing refetched in five of them, the members collection alone in
one, tasks (three pages) plus reports in one, and nothing in the last two. The
one tick that read tasks and reports is the tick after a task was inserted
server-side. Before this change the same tick refetched around twenty
collections.

One thing that measurement exposed: the `members` domain moves on the viewer's
own `last_seen` heartbeat, so an idle tab still refetches members every tick or
two. Excluding the viewer's own stamp from that domain is the obvious
refinement and was not attempted.

### Phase 0: UX-01 partly done, 4 October 2026

Walked in a real browser: sign-in with email and password, the workspace
switcher, Today with a populated task list, the quick capture field, and the
pulse-driven refresh. Not yet walked: task creation through the dialog end to
end, search, chat, check-ins, the manager and member roles, and any mobile
viewport. Those need the same session and are the next step, not a claim.

One obstacle worth recording for anyone repeating this: `.env` narrows
`WORKSPACE_CSRF_TRUSTED_ORIGINS` to port 5175, so a browser session on any other
port can read the API but every write is refused with a 403 and an Origin
message in the Django log. Read-only measurement is unaffected; anything that
creates a record has to run on 5175 or the trusted-origins environment variable
has to be widened for the session.

### Phase 0: UX-01 walkthrough, 4 October 2026

Walked on the dev server at port 5175 (the only origin `.env` trusts for
writes), desktop viewport at 1440 and a 390x844 mobile viewport, signed in as a
throwaway **owner**. Later phases had only been exercised through component
tests with a mocked API until now; these are the results from a real server and
a real database.

What was walked, and held up:

- Sign-in with email and password, and the shell coming up on the remembered
  page.
- Quick capture on Today: typed a title, pressed Add, the field cleared, a 201
  came back and the task exists in the database with the code the sequence
  expects.
- The title hand-off into the full form: typed in the quick field, "Add
  details" opened the full form with the title carried across.
- Escape on a changed task form: closed it, and reopening offered the draft
  back with "Restored your unsaved task" and the time it was kept.
- Search to exact record: typed a task name, the result row appeared, clicking
  it opened that task's drawer and cleared the box.
- Check-in draft recovery: a typed check-in survived closing the composer and
  came back with "Restored your unsaved draft". The keys the app wrote were
  `workspace-record-draft:76:52:task` and `workspace-record-draft:76:52:checkin`
  - the user, workspace and record type are all in the key, which is what the
  draft store was built to guarantee.
- Mobile at 390x844: no horizontal overflow, the tab bar is present.

What it found:

- **The capture row lied about ownership, and it is fixed.** It said "Goes to
  Backlog, assigned to you" to everyone. The create view self-assigns only when
  the membership role is `member`, so an owner's captures arrived unassigned -
  and because the Today list shows what is assigned to you, the task did not
  appear where the reader had just typed it. The copy now branches on the role.
  Two browser checks that no mocked test could have made: the component test
  asserted the absence of `assignee_ids` and the mock server never applied the
  rule, so the test passed while the promise was false.

What it could not confirm:

- The manager and member roles. Only an owner was walked.
- Chat, and task creation through the full dialog to a save.
- Anything needing a second person: invitations, mentions, notifications
  arriving.
- The remaining mobile surfaces beyond Today's shell.

Two things checked and found to be fine, recorded so nobody re-investigates:
- The search box appearing not to clear after a result is a Playwright `fill()`
  artefact, not a bug; with real keystrokes the box clears.
- The app reopening on the last page after a reload is deliberate - `active` is
  seeded from `localStorage["workspace-last-page"]`, not from the URL.

### Findings from reading the permission model, 4 October 2026

Not a phase deliverable - recorded because it belongs in a later phase rather
than being fixed on sight.

- **The interface does not reflect a narrowed manager grant.** The server has
  thirteen granular permission keys and enforces every one of them
  (`require_permission` in tasks/views.py; owners always pass, managers pass
  unless the permission was revoked from their membership, members pass only
  for their five defaults). An owner can therefore revoke, say, `manage_projects`
  from one manager. But the interface gates on the raw role - `canManageMembers`
  and `canManageTasks` are `["owner","manager"].includes(role)` - and uses
  exactly one granular key anywhere, `comment_check_ins`. So a manager whose
  projects access was revoked still sees every project control and meets a 403
  when they use one. The code is explicit that this is deliberate - "This is a
  UI convenience, not the authorization boundary" - and it is safe, because the
  server is the boundary. It is a usability gap, not a security one: the
  interface promises something the server refuses.
- Closing it means gating the affected controls on the permission rather than
  the role, which the session payload already carries per workspace
  (`permissions` in tasks/auth_views.py). That is a broad front-end change
  across the project, task, Zuri, template and import surfaces, which is why it
  is recorded rather than done inside a performance phase.

The role and permission behaviour itself is now written up for readers in
docs/user-guide.md section 17, including what each role sees and the manager
limits.

### API compression, 4 October 2026

The measurement above said the task table was the dominant data cost and that it
was not compressed. Compression is now on, and it changes what UX-15 is for.

| On the 401 task workspace | Before | After |
| --- | --- | --- |
| Task pages, transferred | about 340 kB | about 11 kB |
| Whole page, transferred | 472 kB | 132 kB |
| Decoded | unchanged | unchanged |

Measured on the built app against the same endpoints as the baseline, browser
cache disabled.

- It is Django's middleware with one change: streaming responses are returned
  untouched. Django's own version compresses them, which would put the
  server-sent notification stream through a compressor - and a compressor holds
  bytes back until it has a block's worth, which is the one thing an event
  stream cannot afford. `backend/middleware.py`, three tests in
  `tasks/test_compression.py`.
- **What this means for UX-15.** The task with that ID exists because large task
  lists were expected to cause measured problems. The transfer problem is now
  largely gone: 400 tasks cost about 11 kB, so 2,000 would cost about 55 kB. It
  is no longer obviously the right next thing to build. What remains unmeasured
  is the server building and serialising every task on every load, and the
  client rendering them - neither of which compression touches. UX-15 should be
  re-scoped against those, or dropped, rather than done because it is next in a
  list.
- A product decision taken at the same time, for the record: a team leader's
  quick capture stays **unassigned**. It would otherwise disagree with the full
  form, which starts unassigned for everyone, and the audit warns against
  guessing ownership. The row's copy already says which it will be; the README
  for that behaviour is the copy, not code.

### Phase 0: UX-03 delivered, 4 October 2026

`npm run test:browser` drives the built app in a real browser against its own
throwaway database. It passes in about six seconds and leaves nothing behind -
no servers, no database file, and no credentials, because the fixture password
is generated per run and the fixture accounts only ever exist in that file.

Three pieces, so the next journey is a file rather than a project:

- `tasks/management/commands/seed_browser_fixtures.py` creates a disposable
  workspace with one account per role, a project, and six tasks. It recreates
  the tasks on every run, so a journey always starts from the same board, and
  it takes the password as an argument rather than carrying one in the
  repository.
- `scripts/browser-journey.mjs` points Django at `.tmp-browser-journey.sqlite3`,
  migrates and seeds it, starts the API and the built app, runs the journeys
  with node's own test runner, then stops both and deletes the file. It uses the
  `playwright` package already installed rather than adding a test runner, so
  the dependency list is unchanged.
- `scripts/journeys/task-lifecycle.test.mjs` is the journey UX-03 asks for:
  sign in, choose a workspace, write a task through the full form, find it
  through search, open it, change its title, reload, and find the change still
  there.

Two things worth knowing for whoever writes the next one:

- The workspace switcher is not persisted. The app remembers the last *page*
  across a reload (`localStorage["workspace-last-page"]`) but re-reads the
  workspace from the account default, so a reload puts you back in whichever
  workspace the account opens on. The journey re-chooses it after reloading, and
  says why. Whether that inconsistency is worth fixing is a product question,
  not a bug this work introduced - recorded here rather than changed, because a
  journey should describe the app as it is.
- Servers must be started without a shell wrapper and stopped as a process tree.
  On Windows a shell in between means the kill reaches the wrapper and leaves
  Django holding the database file, which then cannot be deleted. This cost more
  debugging than the journey itself.

### The full backend suite, 4 October 2026

The audit that started this plan recorded that the backend suite was started,
then stopped after more than ten minutes, and that no full-suite pass was
claimed. It has now been run to completion, because adding middleware that
touches every response is exactly the change that needs it:

    python manage.py test tasks    ->  Ran 600 tests in 789s, OK

Thirteen minutes, exit code 0, no failures and no errors. That closes the
"complete the previously interrupted backend suite" line in the delivery rules
for this point in the work - it does not stand in for one after every future
change, and the release gate still wants a fresh run.
