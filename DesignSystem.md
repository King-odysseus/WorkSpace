# WorkSpace Design System

Last updated: 14 September 2026

## Source Of Truth

`src/workspace.css` is the single WorkSpace application stylesheet and the only
`.css` file under `src/`. It owns the visual system for the shell, Today
dashboard, workspace pages, dialogs, forms, tables, and adopted component
patterns.

`src/main.jsx` loads the third-party Flowbite stylesheet first, then
`workspace.css`. This deliberately keeps WorkSpace as the final owner of its own
skin and interaction states. `index.html` carries no inline `<style>` block and
`vite.config.js` declares no separate CSS entry.

`workspace.css` itself opens with four imports, in this order:

1. Google Fonts (Montserrat and Roboto).
2. `tailwindcss`.
3. `tw-animate-css`.
4. The WorkSpace layer stack below.

### Layer Stack

The file is assembled in cascade order. Each layer is later than the one above
it, so it wins any tie it does not lose on specificity:

| Order | Layer | Section comment |
| --- | --- | --- |
| 1 | Legacy base layer (formerly `styles.css`) | `Legacy base layer (formerly styles.css)` |
| 2 | Workspace utility tokens | `Workspace utility tokens` |
| 3 | Dashboard design system | `Dashboard design system` |
| 4 | Shared workspace views | `Shared workspace views` |

The current visual authority is the later `Dashboard design system` and
`Shared workspace views` layers. Earlier rules remain only as compatibility
layers for elements still used by the app. When two rules conflict, prefer the
later, more recent section and update that section rather than reviving an older
treatment.

Do not add another application stylesheet. Extend the relevant current layer in
`workspace.css` and reuse the React primitives in `src/components/ui/` where one
already exists.

### Mockups And Retired Stylesheets

Build a mockup as a React page that uses the shared primitives and the tokens in
this document. Do not give a mockup its own stylesheet or its own token set. The
former standalone mockup page (`ui-mockup.html` plus `src/mockups/`) carried a
second, conflicting token set (`--gold: #b98145`, `--navy: #071a2e`) and has been
removed. Do not reintroduce a parallel design vocabulary for a design
exploration.

`styles.css`, `tijhabooks-theme.css`, `index.css`, and `flowbite-adopted.css`
were consolidated into `workspace.css`. Stale copies of `styles.css` and
`tijhabooks-theme.css` still sit inside the gitignored
`.claude/worktrees/agent-a8006e48894b89905/`, and `.tmp-mockup-build/` holds an
old compiled mockup bundle. Nothing loads any of them. Never edit CSS outside
`src/workspace.css`.

### Date Formatting

Use one numeric format for dates everywhere: `DD-MM-YY` (`13-09-26`). Date
and time values keep a 24-hour clock after the date (`13-09-26 14:05`).

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

## Token Layers

`workspace.css` stacks five token families. Before adding or changing a colour,
identify which family owns it.

| Family | Declared in | Owns | Dark remap |
| --- | --- | --- | --- |
| `--sc-*` | `:root` and `html[data-theme='dark']` just before the `Workspace utility tokens` layer | Every `src/components/ui/` primitive, through the `@theme inline` block | Yes, a full second `:root` set |
| `--color-*` | The `@theme` block in `Workspace utility tokens` | The WorkSpace Tailwind class names (`bg-navy`, `text-accent`, `bg-surface`, `text-text-primary`, and the rest) | Yes, `html[data-theme='dark']` immediately after the block |
| Legacy aliases | The `:root` block near line 191 | Older rules still in the legacy base layer | Mostly, because most of them alias `--color-*` |
| shadcn-name aliases | The `:root` block after the dark remap, around line 4506 | Late-written surfaces (screen share, import, chat, AI provider) that were authored against short shadcn names | Yes, because they alias `--color-*` |
| Page-local aliases | `.workspace-view, .today-dashboard` | The dashboard and workspace layers | Yes, a second selector block for dark |

Two traps live in this stack:

- The `@theme inline` block near line 4293 declares shadcn names that share the
  `--color-*` prefix with the utility tokens (`--color-background`, `--color-card`,
  `--color-primary`, `--color-border`, `--color-accent`, and so on). They map to
  `--sc-*` and are a different set from the utility tokens. `--color-accent` and
  `--color-border` appear in both blocks, so read both before changing either.
- `--workspace-*` and `--dashboard-*` are the same values under two names. The
  `.workspace-view` block defines `--dashboard-*` and then mirrors them into
  `--workspace-*`; older components read the mirror.

### Primitives Layer (`--sc-*`)

This is the layer to edit when a `Button`, `Dialog`, `Select`, `Card`, `Badge`,
`Tabs`, `Popover`, `DropdownMenu`, `Separator`, `Alert`, `Calendar`, or
`Skeleton` primitive needs new colours, because `@theme inline` resolves each
`--color-*` utility to the matching `--sc-*` value.

| Token | Light | Dark |
| --- | --- | --- |
| `--sc-background` | `#FFFFFF` | `#0C0C28` |
| `--sc-foreground` | `#1F2937` | `#ECECF7` |
| `--sc-card` | `#FFFFFF` | `#15153A` |
| `--sc-card-foreground` | `#1F2937` | `#ECECF7` |
| `--sc-popover` | `#FFFFFF` | `#15153A` |
| `--sc-popover-foreground` | `#1F2937` | `#ECECF7` |
| `--sc-primary` | `#0B0B45` | `#2563EB` |
| `--sc-primary-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--sc-secondary` | `#EEF2F7` | `#1E1E4C` |
| `--sc-secondary-foreground` | `#1F2937` | `#ECECF7` |
| `--sc-muted` | `#F1F3F5` | `#0C0C28` |
| `--sc-muted-foreground` | `#6B7280` | `#C2C2DC` |
| `--sc-accent` | `#C49A6C` | `#C49A6C` |
| `--sc-accent-foreground` | `#071A2E` | `#071A2E` |
| `--sc-destructive` | `#C43D4B` | `#E15A67` |
| `--sc-destructive-foreground` | `#FFFFFF` | `#FFFFFF` |
| `--sc-border` | `#E2E2E6` | `#2A2A5C` |
| `--sc-input` | `#E2E2E6` | `#2A2A5C` |
| `--sc-ring` | `#2563EB` | `#60A5FA` |
| `--sc-radius` | `0.75rem` | `0.75rem` |

`--radius-sm`, `--radius-md`, `--radius-lg`, and `--radius-xl` derive from
`--sc-radius`.

### Utility Tokens (`--color-*`)

These drive the WorkSpace Tailwind class names and are the right choice for new
app CSS.

#### Brand And Surfaces

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--color-navy` | `#0B0B45` | `#0c0c28` | App shell and strong brand surface |
| `--color-navy-soft` | `#1c1c6e` | `#1c1c6e` | Secondary navy surface |
| `--color-navy-light` | `#07072e` | `#07072e` | Recessed navy |
| `--color-text-on-navy` | `#FFFFFF` | `#FFFFFF` | Text on navy |
| `--color-accent` | `#C49A6C` | `#C49A6C` | Gold brand accent, used sparingly |
| `--color-accent-hover` | `#b0895a` | `#b0895a` | Gold hover |
| `--color-accent-soft` | `#F1E4D0` | `#F1E4D0` | Soft gold background |
| `--color-surface` | `#FFFFFF` | `#15153a` | Primary card and panel surface |
| `--color-surface-secondary` | `#F8F9FA` | `#0c0c28` | Secondary and recessed surface |
| `--color-surface-elevated` | `#FFFFFF` | `#1e1e4c` | Raised menus and popovers |
| `--color-text-primary` | `#1F2937` | `#ECECF7` | Primary text |
| `--color-text-secondary` | `#4B5563` | `#C2C2DC` | Supporting text |
| `--color-text-muted` | `#6B7280` | `#8C8CAE` | Metadata and quiet labels |
| `--color-border` | `#E2E2E6` | `#2a2a5c` | Standard border |
| `--color-border-light` | `#EFEFF2` | `#20204a` | Subtle divider |

#### Semantic Colours

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--color-info` | `#2563EB` | `#2563EB` | Primary action, focus, links, selection |
| `--color-info-hover` | `#1D4ED8` | `#1D4ED8` | Info hover |
| `--color-info-soft` | `#EAF2FF` | `#132C52` | Informational background |
| `--color-success` | `#3D8B6E` | `#3D8B6E` | Complete, active, healthy |
| `--color-success-soft` | `#E8F5EF` | `#153A31` | Successful background |
| `--color-warning` | `#B45309` | `#B45309` | Due soon and warning states |
| `--color-warning-soft` | `#FFF4E5` | `#3D2A12` | Warning background |
| `--color-danger` | `#C43D4B` | `#C43D4B` | Destructive and blocked states |
| `--color-danger-soft` | `#FDECEE` | `#3D1C23` | Destructive background |
| `--color-danger-bg` | `#FEF2F2` | `#3A1A1A` | Destructive page background |
| `--shadow-elevated` | `0 12px 40px -12px rgb(38 34 98 / 0.16)` | `0 12px 40px -12px rgb(0 0 0 / 0.6)` | Raised surface shadow |

The dark theme remaps these tokens through `html[data-theme='dark']`. Components
should read the token rather than branching on a theme class.

### Legacy Aliases

Older rules in the legacy base layer use short names. Most alias the utility
tokens; a few keep literal values because no token matches exactly.

| Token | Value |
| --- | --- |
| `--navy` | `var(--color-navy)` |
| `--brand-accent` | `var(--color-accent)` |
| `--blue` | `var(--color-info)` |
| `--teal` | `var(--color-success)` |
| `--warning` | `var(--color-warning)` |
| `--danger` | `var(--color-danger)` |
| `--focus-ring` | `var(--color-info)` |
| `--navy2` | `#15155C` |
| `--brand-navy-soft` | `#1C1C6E` |
| `--muted` | `#6B7280` |

### shadcn-Name Aliases

Screen share, import, chat, and AI-provider rules were written against short
shadcn names. These aliases point them at the theme-aware `--color-*` set:
`--primary`, `--accent`, `--border`, `--surface`, `--surface-secondary`,
`--text-primary`, `--text-secondary`, `--text-muted`.

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

`--workspace-surface`, `--workspace-surface-soft`, `--workspace-text`,
`--workspace-text-soft`, and `--workspace-border` mirror these for older
workspace components.

The dashboard block also sets the shared control metrics:
`--workspace-control-height` (`38px`, dropping to `34px` for
`.workspace-view.planner-view` under `800px`) and `--workspace-control-radius`
(`999px`).

### Rules For Colour Work

1. Prefer the `--color-*` utility tokens for new app CSS and the Tailwind class
   names they generate for JSX.
2. Change a value in the layer that owns it. Never redeclare a token in a
   per-surface rule to nudge one screen.
3. The legacy and dashboard layers still hold 1,018 raw colour declarations
   across 279 distinct values. Do not add more. When you touch a rule, move its
   literal to the nearest token if an equivalent exists.
4. When a property is set in two layers for the same selector, delete the loser
   rather than layering another override. Two layers painting one selector each
   contribute half of the final look, which is how a presence dot once rendered
   as a 19px donut.

## Typography

- UI text: `Roboto`, with weights `400`, `500`, `600`, `700`, and `800`.
- Headings and metrics: `Montserrat`, with weights `400`, `600`, `700`, and `800`.
- `h1` to `h6` are forced to `Montserrat` with `letter-spacing: 0` by a global
  rule in the dashboard layer. Do not add letter spacing to a heading.
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

Every `[data-slot='card']` is pinned to `18px` radius, the
`--workspace-border` colour, and a `0 1px 2px` plus `0 12px 28px` shadow by one
rule in the dashboard layer. Changing card depth means editing that rule, not an
individual card.

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

The shared primitives live in `src/components/ui/`: `alert`, `badge`, `button`,
`calendar`, `card`, `dialog`, `dropdown-menu`, `popover`, `select`, `separator`,
`skeleton`, and `tabs`. `src/components/workspace-ui.jsx` exports the shared app
building blocks: `WorkspaceViewHeading`, `SelectField`, `DateTimeField`,
`DateField`, `EmptyState`, and `ConfirmDialog`.

### Buttons

Use `Button` from `src/components/ui/button.jsx`.

- Default: primary navy action with a subtle shadow.
- Gold: a rare brand action that needs the accent treatment.
- Secondary: neutral action with a visible border.
- Outline: quiet action on a card or toolbar.
- Ghost: icon or low-emphasis action.
- Destructive: delete, revoke, or permanent action.

`.primary-button`, `.secondary-button`, and `.text-button` are the legacy
equivalents inside the base layer. Prefer the `Button` primitive for new work.

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

The pill corner (`border-radius: 999px`) on every combo control lives in one
place: the default skin `[data-slot='select-trigger'].app-select-trigger` at the
top of the base layer. That skin must stay above every per-surface trigger rule,
because they all tie with it on specificity and the later declaration wins. A
surface that wants its own height, padding, or type sets them in its own rule; a
1-class chip rule must also carry the `app-select-trigger` marker to reach the
same specificity. Do not redeclare a corner radius in a per-surface rule, and do
not add a blanket `button { border-radius: 999px }` layer, which would also pill
segmented controls, spreadsheet tabs, colour swatches, and tile overlays.

### Dialogs, Drawers, And Popovers

- Use the Radix-based dialog and popover primitives already in the project.
- Standard dialogs are centered, bordered, rounded, and use the elevated
  shadow. They must float above the header, sidebar, and popovers.
- Drawers are for task and record detail where context should remain visible.
- Menus and popovers use the same border, radius, surface, and shadow language
  as cards.
- `.modal` classes in the base layer are the legacy dialog shell; the modern
  modal treatment lives in the dashboard layer.

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
- Presence dots use a solid semantic colour and a surface-coloured ring, drawn
  as a single shadow so the dot's box never grows.
- Warning, danger, and success backgrounds use the soft semantic tokens.
- Task state chips (`--status-color`, `--status-bg`) cover `in progress`,
  `review`, `blocked`, `on_hold`, `cancelled`, and `done`.

### Alerts, Skeletons, And Empty States

- Inline errors and status messages use the `.workspace-alert` class with a
  `data-tone` of `success`, `warning`, or `danger`. There is no `WorkspaceAlert`
  component; use the class, or `alert.jsx` for the primitive version.
- Use skeleton primitives while a panel is loading.
- Empty states use `EmptyState` and explain the next useful action without
  turning into feature marketing.

### Activity And Tables

- Activity uses a vertical timeline with a connected neutral rail.
- Table headers are compact, uppercase, and sticky where the data is long.
- Tables keep the header surface distinct and use a restrained blue row hover.

## Styled Surfaces

Each surface owns a class family. Match the existing prefix before inventing a
new class, and extend the surface's own rules in `Shared workspace views`.

| Surface | Class family | Notes |
| --- | --- | --- |
| App shell | `nav-item`, `nav-label`, `nav-badge`, `sidebar-collapsed`, `sidebar-toggle`, `sidebar-upgrade-card` | Navy rail, Tailwind-built in `main.jsx` |
| Sidebar edge toggle | `sidebar-edge-toggle` | One class owns size, border, depth, hover, focus, and reduced motion. Feed the rail position through `--sidebar-edge-left` and keep `aria-expanded` in sync |
| Mobile navigation | `mobile-pill-nav`, `mobile-nav-item`, `mobile-nav-zuri` | Fixed bottom pill bar under `750px`. The selected state uses `--brand-navy-soft` with a gold icon, matching `.nav-item.active` |
| Top search | `top-search` | Shell-level search |
| Notifications | `notification-panel`, `notification-wrap`, `notification-row`, `notification-item` | Bell panel and rows |
| Today dashboard | `today-hero`, `today-actions`, `today-grid`, `today-metrics`, `today-panel-heading`, `today-agenda-*`, `today-exception-list` | Root is `.today-dashboard` |
| My Tasks | `my-task-summary`, `my-task-filters`, `my-task-row`, `my-task-group`, `my-task-results`, `my-task-empty` | Collapses to a 3-column row under `520px` |
| Planner | `planner-view`, `planner-commandbar`, `planner-board`, `planner-column`, `planner-task-table`, `planner-view-toggle`, `planner-add-bucket`, `planner-archive-*` | Horizontal board scrolls inside the page, never the page itself |
| Calendar | `calendar-view`, `calendar-view-switcher`, `calendar-day`, `calendar-agenda`, `event-pill`, `calendar-export` | |
| Team board | `team-board-toolbar`, `team-board-tabs`, `team-board-metrics`, `team-member-grid`, `team-task-row`, `team-availability-*`, `team-workload-*`, `member-profile-*` | |
| Reports | `report-card`, `report-grid`, `report-metrics`, `report-stat`, `report-toolbar`, `report-member-row`, `report-breakdown-grid`, `report-bar-*` | |
| Activity | `activity-toolbar`, `activity-card`, `activity-day`, `activity-row`, `activity-history`, `activity-pagination`, `activity-kind` | Vertical timeline on a neutral rail |
| Projects | `project-card`, `project-grid`, `project-toolbar`, `project-summary`, `project-register-table`, `project-record-row`, `project-risk-issues-*`, `project-detail-links`, `project-back-button` | Record registers share `record-form-grid` |
| Check-ins | `checkin-toolbar`, `checkin-card`, `checkin-grid`, `checkin-range`, `checkin-detail-*`, `checkin-blocker-*`, `checkin-comments` | |
| Time clock | `time-clock-panel`, `time-clock-row`, `time-clock-log`, `time-clock-members`, `time-clock-totals` | |
| Follow-ups | `follow-up-toolbar`, `follow-up-row`, `follow-up-list`, `follow-up-panel`, `follow-up-status`, `follow-up-actions` | |
| Chat | `chat-workspace-view`, `chat-conversation-list`, `chat-message`, `chat-feed`, `chat-compose-*`, `chat-toolbar`, `channel-row`, `direct-row`, `chat-emoji-*`, `chat-about-*` | Owns its own grid and card treatment |
| Files | `files-browser-view`, `files-table`, `files-row`, `files-thumbnail-grid`, `files-categories`, `files-empty`, `files-search` | |
| Documents | `document-canvas`, `document-page-wrap`, `document-ruler`, `document-review-panel`, `document-comment-list`, `document-conflict-banner`, `document-share`, `rich-editor-surface` | Simulated page canvas, A4 padding |
| Presentations | `presentation-canvas`, `presentation-slide`, `slide-rail`, `presentation-player*` | |
| Settings | `settings-shell`, `settings-nav`, `settings-grid`, `settings-row`, `settings-stat-grid`, `settings-control-row`, `settings-danger-actions`, `settings-webhook-form` | |
| Help and legal | `help-grid`, `help-topic`, `help-contact`, `help-chevron`, `legal-layout`, `legal-document`, `legal-acceptance`, `cookie-consent`, `cookie-actions` | |
| Import | `import-panel`, `import-type-grid`, `import-upload-form`, `import-summary`, `import-errors`, `import-preview-*` | Blue-print file import flow |
| Screen sharing | `screen-share-consent-card`, `screen-share-active`, `screen-share-assurances`, `screen-sharing-*`, `screen-capture-grid` | Consent-bound, admin-gated |
| AI assistant | `ai-desktop-launcher`, `ai-chat-*`, `ai-action-card`, `ai-provider-switch`, `ai-minimized-toast`, `ai-restore-tab` | Enters white in both themes; only the ring pulses |
| App update banner | `app-update-banner`, `app-update-banner-copy`, `app-update-banner-actions`, `app-update-banner-mark` | Reveal animation disabled under reduced motion |
| Branded status screens | `branded-status-screen`, `branded-status-sidebar`, `branded-status-card` | Auth and error shells |
| Drawers and modals | `drawer-*`, `modal-*` | Shared shell language |

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
- The sidebar hides below `750px` and the `mobile-pill-nav` replaces it. Add
  `padding-bottom` to `.page-content` so the bar never covers content.
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

1. Edit `src/workspace.css`, not a retired stylesheet. It is the only
   application stylesheet.
2. Add new design work to the `Dashboard design system` or
   `Shared workspace views` layer. Do not revive a legacy base-layer treatment.
3. Change a token in the layer that owns it. Read the token layer table first;
   `--color-*`, `--sc-*`, the legacy aliases, and the page aliases are not
   interchangeable.
4. Search for an existing selector before adding a new one. Check both the light
   and the `html[data-theme='dark']` rule for a selector before styling it, and
   delete a duplicate rather than layering on top.
5. Use tokens and shared component primitives before raw colours or one-off
   classes. Do not add new raw hex values.
6. Build mockups as React pages on these primitives and tokens. Never add a
   second stylesheet or a second token vocabulary.
7. Verify both light and dark themes.
8. Run the production build and the focused component tests after changing
   shared layout or component styles.
