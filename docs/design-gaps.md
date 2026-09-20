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
- `06 Feature Coverage`: `0:1346436`

The F1-F12 Feature Coverage boards close the previously undocumented gaps for
the global shell, notification panels, presence and identity, account menus,
mobile app bar, mobile operational routes, mobile work routes, mobile insight
and resource routes, AI settings, task create/edit dialogs, authentication and
workspace gates, and loading/empty/error/offline/session/permission states.

Those are implementation references, not permission to add unsupported
production behavior. The backend contract remains unchanged.

## Remaining Whole-Screen Gap

### My planner

`My planner` has no approved OpenPencil frame at any breakpoint. The current
screen is a production feature, but it is not a 1:1 fidelity target.

A future design needs to cover:

| Area | Missing design scope |
| --- | --- |
| Desktop | Page hierarchy, plan list or board, note area, filtering, empty and loading states |
| Tablet | Column collapse, sticky controls, task and note navigation |
| Mobile | Screen structure, section switching, scrolling ownership, fixed actions, and safe-area behavior |
| Create and edit | Plan item form, validation, long text, due-date states, recurrence, save failure, and cancellation |
| Notes | View, create, edit, delete, empty, loading, error, and permission-denied states |
| Schedule | Overdue, due today, upcoming, undated, completed, and conflict states |
| Permissions | Read-only, member change, and unsupported-action states |
| Destructive flows | Delete confirmation, archive or restore behavior where a backend action already exists |

## Settings State Coverage

The default Settings shell and panel layouts are covered by P4 and P39-P45,
with M23-M30 for mobile. The following operational states still need approved
OpenPencil frames.

| Settings surface | Missing design scope |
| --- | --- |
| Profile | Avatar replacement and removal errors, retry, long identity content, validation failure, and loading state |
| Appearance | Persisted-error state, reduced-motion behavior, and unsupported-theme fallback |
| Notifications | Push-permission denied, unsupported browser, subscription failure, disabled-sound state, and save failure |
| Workspaces | Busy, lifecycle error, confirmation, archived action, archived workspace, and empty state |
| Workspace access | Loading, permission denied, role-save failure, invite failure, removal, accepted or expired invite, and empty state |
| AI settings | Credential rotation, provider removal confirmation, concurrent-update conflict, and desktop/mobile error parity |
| Integrations | Loading, disconnected, invalid credentials, URL validation, save failure, reconnect, and revoked-access states |
| Templates | Loading, empty, create/edit validation, apply failure, duplicate name, and destructive-action states |

The shared loading, empty, offline, expired-session, permission, and recoverable
error compositions on F12 define the shell-level treatment. A Settings panel
still needs its own composition when its content, permission rule, or recovery
action differs from those generic states.

## Resolved Gaps

The following are no longer unresolved design gaps:

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
