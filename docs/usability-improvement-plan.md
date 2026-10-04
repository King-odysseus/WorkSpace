# WorkSpace usability improvement plan

Prepared: 4 October 2026.
Source: [Usability audit](usability-audit-2026-10-04.md).
Status: planned, implementation has not started.

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
