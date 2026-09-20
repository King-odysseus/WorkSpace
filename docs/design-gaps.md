# WorkSpace Design Coverage Gaps

This report tracks production screens and states that do not have an approved
OpenPencil frame. They remain functional with their existing backend behavior,
but they are not 1:1 fidelity targets until a design is reviewed and approved.

## Settings

The P4 frame (`0:4498`) defines the Settings shell, navigation, and AI Settings
panel (`0:4554`). It does not define separate desktop or mobile frames for the
other Settings detail panels.

| Settings panel | Current behavior that must be preserved | Missing design scope |
| --- | --- | --- |
| Profile | Avatar upload/removal, first and last name, email, company, job role, presence, role display | Desktop and mobile default, loading, saving, validation, upload error, and long-content states |
| Appearance | Light, dark, and system themes plus expanded or collapsed sidebar | Desktop and mobile default, selected, focus, and reduced-motion states |
| Notifications | Notification categories, sound style, volume, check-in reminder, and browser push | Desktop and mobile default, enabled/disabled, permission denied, unsupported, loading, and error states |
| Workspaces | Switch workspace, set default, create, leave, archived workspace, and empty state | Desktop and mobile card, action, confirmation, busy, error, and empty states |
| Workspace access | Members, roles, permission controls, invitations, and owner/manager restrictions | Desktop and mobile member list, editing, permission denied, invite, removal, loading, and empty states |
| Integrations | Calendar subscription and team webhooks | Desktop and mobile connected, disconnected, credential, validation, loading, and error states |
| Templates | Task and project templates plus apply-from-template actions | Desktop and mobile list, create/edit, empty, loading, validation, and destructive-action states |

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

## Rules For Unresolved Surfaces

- Do not invent layouts for these screens or states.
- Keep existing APIs, permissions, authentication, and data flows unchanged.
- When a design is added, build it from the shared OpenPencil Foundations,
  Components, and tokens rather than from a one-off visual treatment.
- Remove an item from this report only after its approved frames and state
  coverage have been implemented and verified.
