# WorkSpace Design Coverage Gaps

This report tracks production screens and states that do not have an approved
OpenPencil frame. They remain functional with their existing backend behavior,
but they are not 1:1 fidelity targets until a design is reviewed and approved.

## Settings

The P4 frame (`0:4498`) defines the Settings shell and navigation. The AI panel
(`0:4554`) and the P39-P45 desktop panels now define the default content layout
for Profile, Appearance, Notifications, Workspaces, Workspace access,
Integrations, and Templates. Their mobile counterparts are M23-M30 on the
`04 Mobile` page.

The implemented default screens do not yet cover every operational state.

| Settings surface | Missing design scope |
| --- | --- |
| Profile | Loading, saving, validation, avatar upload error, and long-content states |
| Appearance | Selected focus, reduced-motion, and persisted/error states |
| Notifications | Loading, unsupported browser, permission denied, save failure, and disabled-sound states |
| Workspaces | Busy, lifecycle error, confirmation, archived action, and empty states |
| Workspace access | Loading, permission denied, role-save failure, invite, removal, and empty states |
| Integrations | Loading, disconnected, credential error, URL validation, save failure, and reconnect states |
| Templates | Loading, empty, create/edit validation, apply failure, and destructive-action states |

Help and Legal are covered by the standalone P22 and P23 frames, so they are not
Settings design gaps.

## Planner

`My planner` currently has no approved product design. A P14 frame exists in the
OpenPencil file, but the product owner has stated that the screen is not
designed yet, so the existing P14 frame must not be treated as approval.

The production route must keep its current planner, task, and backend behavior.
It needs a reviewed desktop and mobile design covering empty, populated, add,
rename, delete, loading, error, and long-name states before it can be treated
as a 1:1 rebuild target.

## Task Create And Edit Popup Modal

The task create/edit popup currently reads as visually attached to the right
edge instead of appearing as a centered, self-contained dialog. It must not be
anchored to a side panel or the right-hand side of the viewport. The create and
edit variants need one responsive OpenPencil dialog contract with a centered
shell, backdrop, defined sizing, and internal scrolling where required.

The form behavior and API contract are functional, but the popup layout and its
desktop/mobile states still need a reviewed OpenPencil design before they can
be treated as a 1:1 target. Missing states include default create, edit,
validation, long content, loading, submission error, mobile keyboard, fields
locked by permissions, and destructive confirmation where the existing flow
supports it.

## Rules For Unresolved Surfaces

- Do not invent layouts for these screens or states.
- Keep existing APIs, permissions, authentication, and data flows unchanged.
- When a design is added, build it from the shared OpenPencil Foundations,
  Components, and tokens rather than from a one-off visual treatment.
- Remove an item from this report only after its approved frames and state
  coverage have been implemented and verified.
