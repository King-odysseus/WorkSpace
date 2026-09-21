# WorkSpace Design Coverage Gaps

This is the consolidated list of production surfaces that still need an
approved OpenPencil design. Existing APIs, authentication, permissions, data
flows, and feature behavior remain authoritative. A surface listed here is not
a license to invent a layout.

## Design Authority

The approved sources are:

- `01 Foundations`: `0:3`
- `02 Components`: `0:946`
- `03 Pages`: `0:3994`
- `04 Mobile`: `0:9758`
- `05 Project States`: `0:11925`
- `06 Feature Coverage`: `0:1346436` (F1-F13)

The F1-F12 Feature Coverage boards close the previously undocumented gaps for
the global shell, notification panels, presence and identity, account menus,
mobile app bar, mobile operational routes, mobile work routes, mobile insight
and resource routes, AI settings, task create/edit dialogs, authentication and
workspace gates, and loading/empty/error/offline/session/permission states.

Those are implementation references, not permission to add unsupported
production behavior. The backend contract remains unchanged.

## Settings State Coverage

The default Settings shell and panel layouts are covered by P4 and P39-P45,
with M23-M30 for mobile. F13 supplies the shared loading, validation,
permission, lifecycle, conflict, and recovery patterns for those panels. A
panel still needs a dedicated frame only where its content, permission rule, or
recovery path differs from F13; the following cases remain in that category.

| Settings surface | Missing design scope |
| --- | --- |
| Profile | Long identity content, field-level validation, and panel-level loading state |
| Workspace access | Loading, permission denied, role-save failure, invite failure, removal, accepted or expired invite, and empty state |
| AI settings | Credential rotation, provider removal confirmation, concurrent-update conflict, and desktop/mobile error parity |
| Integrations | Loading, disconnected, invalid credentials, URL validation, save failure, reconnect, and revoked-access states |
| Templates | Loading, empty, create/edit validation, apply failure, duplicate name, and destructive-action states |

The shared loading, empty, offline, expired-session, permission, and recoverable
error compositions on F12 define the shell-level treatment. A Settings panel
still needs its own composition when its content, permission rule, or recovery
action differs from those generic states.

## Backend-Blocked Design States

These frames contain elements the current production contracts cannot support
without new backend behavior. They are intentionally not simulated in the UI.

| Surface | Unavailable design scope | Production contract |
| --- | --- | --- |
| Import data (P18) | Background preview progress such as `240 of 528 rows`, a cancel action, and resumable processing | Preview and commit are synchronous requests. The UI reports completed counts and validation results only after the server responds. |
| Screen sharing (P19) | Live video preview, viewer counts, live participant presence, source switching from the leader console, audio controls, stream-quality telemetry, recording controls, and annotation tools | The API stores consent sessions and periodic JPEG/PNG/WebP captures. It never receives a live video stream and has no viewer, audio, quality, recording, or annotation contract. |

The screen-sharing page therefore presents the approved console hierarchy using
real session state, the employee and requester, consent status, capture cadence,
policy version, retention, audit history, and consented captures. A future live
console frame must be paired with an explicit streaming, presence, and control
contract before those controls can be implemented.

## Resolved Gaps

The following are no longer unresolved design gaps:

- My planner: P52-P61 define the populated, empty, management, task-editing, loading, error, long-content, and mobile planner states.
- Reports: P5 and P63 define the overview, filters, charts, report tables, empty states, and responsive behavior.
- Check-in detail: P62 defines desktop and mobile detail treatment.
- Settings operational states: F13 defines the shared loading, validation, permission, lifecycle, conflict, and recovery states.
- Appearance operational states: P40 and F13 cover retained-theme persistence failure, retry, unsupported-theme fallback, and reduced-motion behavior.
- Notification operational states: P41 and F13 cover denied browser permission, unsupported browsers, push configuration and subscription recovery, disabled sound, and notification-preference load/save recovery.
- Profile media recovery: F13 covers upload and removal failures with retained-photo rollback, operation-specific retry, and the file picker fallback for uploads.
- Workspace lifecycle recovery: P42 and F13 cover busy actions, archived workspace display, owner-only restore and permanent deletion, permission and conflict separation, destructive confirmation, retryable failures, and the workspace empty/create state.
- Global crash fallback: P65 defines the branded recoverable error screen.
- Message reactions: P66 defines the reaction picker and overflow behavior.
- Project index and project controls: P28 defines the Projects index without the duplicated controls panel. Risk register and issue log live in the project detail Risks and Issues tabs, covered by P32 and P33.
- Project Kanban: P30 defines the filterable status board, lane counts and estimates, task metadata, add-task affordances, and responsive horizontal board behavior.
- Screen sharing: P19 defines the session-first console hierarchy, policy, consent status, participants, session states, history, and capture surfaces now implemented against the existing consent/capture contract.
- Global header, search, notification indicators, account chooser, and avatar fallback: F1.
- Notification panel states: F2.
- Presence, identity, account, and workspace menus: F3 and F4.
- Mobile app bar and tab bar states: F5.
- Missing mobile operational, work, insight, and resource routes: F6-F8.
- AI settings mobile coverage: F9.
- Task create and edit dialogs, including desktop, tablet, mobile, focus, scroll ownership, and validation presentation: F10.
- Authentication, invitation review, no-workspace, and session-expired gates: F11.
- Loading, empty, offline, permission, expired-session, search, and recoverable-error states: F12.

The task dialog no longer needs to be treated as a side-attached surface. It is
a centered, self-contained dialog with a fixed header and footer, one scrollable
body, Escape close, focus containment, and a preserved form/API contract.

## Rules For Unresolved Surfaces

- Do not invent layouts, states, or behavior that an approved frame does not define.
- Keep existing APIs, permissions, authentication, and data flows unchanged.
- When a design is added, build it from Foundations, Components, and the shared tokens.
- Remove an item from this report only after its approved frames have been implemented and verified.
