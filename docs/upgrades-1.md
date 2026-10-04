# Upgrades 1

Prepared: 4 October 2026.
Source: [Usability audit](usability-audit-2026-10-04.md).
Status: Phases 1 and 2 (UX-04 to UX-11) delivered, and UX-12 from Phase 3.
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
| UX-01 | Walk through sign-in, workspace switching, Today, task creation, search, chat, and check-ins on desktop and mobile. Include owner, manager, and member roles. | Each issue has steps, expected/actual behavior, role, and screen size. Audit assumptions are confirmed or corrected. |
| UX-02 | Measure startup and refresh against small and large disposable workspaces. Record device/network conditions, task counts, useful-content time, requests, and transferred bytes. | Repeatable baseline exists; large datasets do not silently truncate. No production data is changed. |
| UX-03 | Add the first Playwright journey using existing tooling: sign-in, choose workspace, create/open/update task. Establish test fixtures and cleanup. | Journey runs reproducibly in CI and locally, without production credentials or data. |

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
| UX-13 | Render useful Today content independently of unrelated route data | Not started |
| UX-14 | Load collections on demand and refresh only affected collections | Not started |
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
