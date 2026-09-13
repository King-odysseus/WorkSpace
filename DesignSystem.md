# WorkSpace Design System

Last updated: 13 September 2026

## Source Of Truth

`src/workspace.css` is the single WorkSpace application stylesheet. It owns the
visual system for the shell, Today dashboard, workspace pages, dialogs, forms,
tables, and adopted component patterns.

`src/main.jsx` loads the third-party Flowbite stylesheet first, then
`workspace.css`. This deliberately keeps WorkSpace as the final owner of its own
skin and interaction states.

The current visual authority is the later `Dashboard design system` and
`Shared workspace views` layers in `workspace.css`. Earlier rules remain in the
file only as compatibility layers for elements still used by the app. When two
rules conflict, prefer the later, more recent section and update that section
rather than reviving an older treatment.

Do not add another application stylesheet. Extend the relevant current layer in
`workspace.css` and reuse the React primitives in `src/components/ui/` where one
already exists.

### Date Formatting

Use one numeric format for dates everywhere: `DD-MM-YYYY` (`13-09-2026`). Date
and time values keep a 24-hour clock after the date (`13-09-2026 14:05`).

Keep ISO values such as `YYYY-MM-DD` inside API payloads, date keys, comparisons,
and `datetime` attributes. Format only the value shown to the reader, using the
shared helpers in `src/lib/workspace-format.js` on the frontend and
`display_date()` in `tasks/views.py` on the server.

## Visual Direction

WorkSpace should feel calm, focused, and operational:

- Use quiet neutral surfaces for the page and cards.
- Reserve blue for primary actions, selection, focus, and information.
- Use green for healthy or completed work, amber for warnings, and red for
  destructive or blocked states.
- Use the gold brand accent sparingly. The primary product identity remains the
  navy WorkSpace shell, not a decorative accent colour.
- Prefer clear hierarchy, restrained shadows, and dense but breathing room over
  decorative compositions.
- Keep cards for repeated records, panels, dialogs, and framed tools. Do not
  put cards inside cards.

## Core Tokens

The names below are the shared WorkSpace tokens. New UI should use these instead
of introducing one-off values.

### Brand And Surfaces

| Token | Light | Purpose |
| --- | --- | --- |
| `--color-navy` | `#0B0B45` | App shell and strong brand surface |
| `--color-accent` | `#C49A6C` | Gold brand accent, used sparingly |
| `--color-surface` | `#FFFFFF` | Primary card and panel surface |
| `--color-surface-secondary` | `#F8F9FA` | Secondary and recessed surface |
| `--color-surface-elevated` | `#FFFFFF` | Raised menus and popovers |
| `--color-text-primary` | `#1F2937` | Primary text |
| `--color-text-secondary` | `#4B5563` | Supporting text |
| `--color-text-muted` | `#6B7280` | Metadata and quiet labels |
| `--color-border` | `#E2E2E6` | Standard border |
| `--color-border-light` | `#EFEFF2` | Subtle divider |

### Semantic Colours

| Token | Light | Purpose |
| --- | --- | --- |
| `--color-info` | `#2563EB` | Primary action, focus, links, selection |
| `--color-info-soft` | `#EAF2FF` | Informational background |
| `--color-success` | `#3D8B6E` | Complete, active, healthy |
| `--color-success-soft` | `#E8F5EF` | Successful background |
| `--color-warning` | `#B45309` | Due soon and warning states |
| `--color-warning-soft` | `#FFF4E5` | Warning background |
| `--color-danger` | `#C43D4B` | Destructive and blocked states |
| `--color-danger-soft` | `#FDECEE` | Destructive background |

The dark theme remaps these tokens through `html[data-theme='dark']`. Components
should read the token rather than branching on a theme class.

### Page Tokens

`.workspace-view` and `.today-dashboard` expose a smaller set of page-local
aliases:

- `--dashboard-surface`
- `--dashboard-surface-soft`
- `--dashboard-surface-tint`
- `--dashboard-border`
- `--dashboard-text`
- `--dashboard-muted`
- `--dashboard-shadow`
- `--dashboard-shadow-hover`

These aliases make light and dark modes use the same layout and component rules.
They also map back to the general `--workspace-*` names used by older workspace
components.

## Typography

- UI text: `Roboto`, with weights `400`, `500`, `600`, `700`, and `800`.
- Headings and metrics: `Montserrat`, with weights `600`, `700`, and `800`.
- Page title: `Montserrat 400`, `22px`, line-height `1.2`.
- Page subtitle: `Roboto`, `13px`, line-height `1.5`.
- Standard body copy: `12px` to `13px`.
- Metadata and compact labels: `9px` to `11px`.
- Metric values: `Montserrat 800`, usually `24px` to `28px`, with tabular
  numerals.

Do not use negative letter spacing. Uppercase labels may use a small positive
letter spacing when the label is genuinely a label, not body copy.

## Spacing, Radius, And Depth

- Page sections use a `20px` gap through `.workspace-view`.
- Standard card padding is `18px` to `20px`.
- Compact row padding is generally `10px` to `14px`.
- Standard card radius is `18px` to `20px`.
- List rows and contained controls generally use `10px` to `14px` radius.
- Pills, avatars, status dots, and compact filters use fully rounded shapes.
- Standard card depth comes from `--dashboard-shadow`.
- Hover depth comes from `--dashboard-shadow-hover` and a small vertical lift.

Avoid hard-coded viewport-scaled font sizes. Use stable dimensions, `minmax()`,
`aspect-ratio`, and wrapping constraints so controls do not resize unexpectedly.

## Layout Rules

### Workspace Pages

- Use `.workspace-view` as the page root.
- Use `WorkspaceViewHeading` for the title and subtitle.
- Keep the page full width inside the content area. Do not add a narrow
  marketing-style maximum width to a working page.
- Use a single clear primary action in the heading when the page has one.
- Put toolbars in the shared toolbar shell rather than stacking isolated
  bordered controls.

### Cards And Rows

- Use `Card` from `src/components/ui/card.jsx` for standard panels.
- Use the shared list-row treatment for repeated records.
- Rows use a soft surface, transparent or subtle border, and hover feedback.
- Keep repeated content bounded with `min-width: 0`, wrapping controls, and
  `overflow-wrap` where labels can be long.
- Metrics use the shared bordered metric-card treatment: bordered surface,
  tabular value, muted label, and blue hover edge.

### Dense Working Views

Planner, Calendar, Team, Reports, and similar pages are working surfaces rather
than editorial pages:

- Give the working surface most of the viewport.
- Prefer predictable toolbars and scannable rows.
- Keep side panels collapsible when they compete with the main working area.
- Preserve horizontal scrolling inside table and planning surfaces where the
  data needs it; do not make the whole page scroll sideways.

## Components

### Buttons

Use `Button` from `src/components/ui/button.jsx`.

- Default: primary navy action with a subtle shadow.
- Gold: a rare brand action that needs the accent treatment.
- Secondary: neutral action with a visible border.
- Outline: quiet action on a card or toolbar.
- Ghost: icon or low-emphasis action.
- Destructive: delete, revoke, or permanent action.

Use icon buttons for familiar tool actions. Every icon-only control needs an
accessible label and a tooltip or title when the meaning is not universally
clear.

### Forms And Selects

- Use the shared `AppSelect` or the existing input primitives.
- Text, date, number, and select controls use the soft form surface.
- Focus uses a blue border/ring treatment with clear contrast.
- Fields should remain at least `44px` high where they are primary touch
  targets.
- Do not use a native select for an in-row status control; use the app select
  treatment so popup menus match the rest of WorkSpace.

### Dialogs, Drawers, And Popovers

- Use the Radix-based dialog and popover primitives already in the project.
- Standard dialogs are centered, bordered, rounded, and use the elevated
  shadow.
- Drawers are for task and record detail where context should remain visible.
- Menus and popovers use the same border, radius, surface, and shadow language
  as cards.

### Tabs And Segmented Controls

- Use the shared pill-shaped segmented treatment for view switches.
- Active state uses the blue information token.
- Keep tabs on one horizontal line and allow internal scrolling rather than
  wrapping into an unstable layout.
- Use real tab semantics only when the content is a tab panel; otherwise use
  toggle buttons with `aria-pressed`.

### Status, Priority, And Progress

- Status and priority use semantic colour plus text. Never rely on colour alone.
- Progress tracks use a neutral border token and an information-to-success
  fill.
- Presence dots use a solid semantic colour and a surface-coloured ring.
- Warning, danger, and success backgrounds use the soft semantic tokens.

### Alerts, Skeletons, And Empty States

- Use `WorkspaceAlert` patterns for inline errors and status messages.
- Use skeleton primitives while a panel is loading.
- Empty states use `EmptyState` and explain the next useful action without
  turning into feature marketing.

### Activity And Tables

- Activity uses a vertical timeline with a connected neutral rail.
- Table headers are compact, uppercase, and sticky where the data is long.
- Tables keep the header surface distinct and use a restrained blue row hover.

## Page Patterns

### What's New

- The page uses the full available workspace width.
- Release notes are compact collapsible `details` sections.
- Each section shows the icon, title, date, and disclosure affordance.
- Opening a section reveals the release items beneath a separating border.

### My Planner

- The page uses a two-column working layout: planner list and active planner.
- The active planner list item is identified by surface and border, without a
  left accent stripe.
- The main planner card owns the composer and task list.
- Planner items remain private to the current user.

## Responsive Behaviour

- Use fluid grids with `minmax()` rather than fixed card widths.
- Collapse two-column working layouts to one column around `900px`.
- At tablet widths, stack toolbars and keep filter groups internally scrollable.
- At mobile widths, make page headings stack vertically, keep primary actions
  visible, and move secondary actions into the existing overflow treatment.
- Check `1440`, `1200`, `1024`, `900`, `768`, `640`, `480`, and `390` widths
  when changing a shared layout.

## Accessibility

- Use semantic HTML before adding ARIA.
- Keep visible keyboard focus on every interactive control.
- Use `data-theme` for dark mode and preserve readable contrast in both themes.
- Do not use hover-only interactions for actions that cannot be reached by
  keyboard.
- Keep touch targets usable on mobile, normally at least `44px` for primary
  actions.
- Respect `prefers-reduced-motion` for nonessential transitions.
- Avoid text overlapping controls, cards, or adjacent content at any supported
  viewport.

## Change Rules

1. Edit `src/workspace.css`, not a retired stylesheet.
2. Prefer the current dashboard/workspace layers over older compatibility rules.
3. Search for an existing selector before adding a new one.
4. Use tokens and shared component primitives before raw colours or one-off
   classes.
5. Verify both light and dark themes.
6. Run the production build and the focused component tests after changing
   shared layout or component styles.
