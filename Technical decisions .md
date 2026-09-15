# Technical Decisions

Status: Current as of 14 September 2026

This document preserves the product, design, frontend, backend, data, and
delivery decisions that made WorkSpace look and work the way it does. It is
written as a reusable decision register for future applications. It records
current decisions, replaced approaches that should not be revived by accident,
exact brand tokens, UI rules, and the path data takes through the system.

The detailed visual contract remains `DesignSystem.md`. This document explains
why that contract exists, how it evolved, and how the implementation supports
it.

## 1. Decision Summary

| Area | Decision |
| --- | --- |
| Product feel | Calm, focused, operational, dense enough for repeated work, and free of marketing-page composition. |
| Brand identity | A navy shell with restrained gold identity accents. Gold is not a general action or status color. |
| Interaction color | Blue is the primary action, link, selection, focus, and information color. |
| Status color | Green is healthy or complete, amber is warning, and red is danger, blocked, or destructive. |
| Typography | Montserrat for headings and metrics; Roboto for UI and body text. |
| Design-system ownership | `src/workspace.css` is the only application stylesheet and the authoritative visual system. |
| Component behavior | Radix-based React primitives own interaction behavior. Flowbite is used selectively as a structural and visual reference, never as a second component runtime. |
| Theme model | Light, dark, and system preference are supported through `data-theme`, with one token source and token-driven dark remapping. |
| Frontend architecture | React 19 and Vite. The app shell owns session and cross-view state; views compose shared primitives and fetch the same-origin `/api/` backend. |
| Backend architecture | Django 5.2+, Django ORM, SQLite locally, PostgreSQL in production, and same-origin JSON endpoints. |
| Tenant model | Every workspace-owned record is scoped by workspace. Membership and permissions are checked on the server, not trusted from the UI. |
| Data freshness | A cheap server fingerprint is polled every 15 seconds while the tab is visible; a full refresh runs only when the fingerprint changes. Notifications use SSE with a polling fallback. |
| File handling | Public media and private screen-capture or protected media are separated. Downloads go through authenticated endpoints where required. |
| Deployment | Split Docker plus Nginx for the general container setup, or one Railway service where Django and WhiteNoise serve the built React app and `/api/`. |
| Dependency policy | Do not add a dependency without asking. Prefer project-owned, agent-neutral solutions and reuse existing primitives. |
| Change discipline | One logical change per commit, test the change, check the diff for secrets, and keep work small and reversible. |

## 2. Product And Experience Principles

WorkSpace is a team operations product, not a landing page or an editorial
dashboard. The design decisions follow from that audience.

### 2.1 Work First

- Open on a working surface such as Today, not on marketing copy.
- Give the working surface most of the viewport.
- Keep toolbars predictable and rows scannable.
- Preserve horizontal scrolling inside wide tables, planners, and timelines
  rather than making the entire page scroll sideways.
- Keep side panels collapsible when they compete with the primary work area.
- Use the full content width for working pages. Do not impose a narrow
  marketing maximum width.

### 2.2 Calm Hierarchy

- Use quiet neutral surfaces for pages, panels, and repeated records.
- Reserve strong color for meaning or identity, not decoration.
- Prefer restrained shadows, clear typography, spacing, and borders over busy
  ornamentation.
- Keep dense information breathing through consistent gaps rather than adding
  decorative containers.
- Avoid cards inside cards. Cards are for repeated records, panels, dialogs,
  and genuinely framed tools.

### 2.3 Operational Language

- Labels name work: Today, My tasks, Planner, Team, Projects, Calendar,
  Reports, Activity, Settings, Channels, Chats, Follow-up, Check-ins.
- Empty states explain the next useful action without becoming feature
  marketing.
- Status is always expressed with text as well as color.
- Confirmation dialogs are app-owned. Destructive actions are clearly labeled.

### 2.4 Primary And Secondary Action Discipline

- A page heading should usually contain one clear primary action.
- Familiar tool actions use icons, with accessible labels and tooltips where
  meaning is not universal.
- Primary actions use blue or the product's primary surface treatment.
- Secondary, outline, and ghost actions stay neutral.
- Gold is reserved for rare brand moments. It must not become the default
  confirm, submit, link, focus, selected, progress, or reminder color.

## 3. Brand System

### 3.1 Brand Character

The identity is a navy operations shell with a restrained gold accent. The
primary product identity is the navy frame around the work. Gold provides
recognition and warmth, not general interaction semantics.

This distinction was made deliberately after gold had appeared on focus rings,
selected tabs, checkboxes, progress bars, links, reminders, and destructive
states. That made unrelated UI states look like brand moments. The corrected
system separates brand identity from system state.

### 3.2 Exact Brand And Surface Tokens

These are the current utility tokens under `@theme` in `src/workspace.css`.
They drive WorkSpace Tailwind names such as `bg-navy`, `text-accent`,
`bg-surface`, and `text-text-primary`.

| Token | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `--color-navy` | `#0B0B45` | `#0c0c28` | Primary product shell and strongest brand surface |
| `--color-navy-soft` | `#1c1c6e` | `#1c1c6e` | Secondary navy surface, hovered or active navigation |
| `--color-navy-light` | `#07072e` | `#07072e` | Recessed navy surface |
| `--color-text-on-navy` | `#FFFFFF` | `#FFFFFF` | Text and icons on navy |
| `--color-accent` | `#C49A6C` | `#C49A6C` | Gold brand accent |
| `--color-accent-hover` | `#b0895a` | `#b0895a` | Gold hover |
| `--color-accent-soft` | `#F1E4D0` | `#F1E4D0` | Soft gold identity surface |
| `--color-surface` | `#FFFFFF` | `#15153a` | Main card and panel surface |
| `--color-surface-secondary` | `#F8F9FA` | `#0c0c28` | Secondary or recessed surface |
| `--color-surface-elevated` | `#FFFFFF` | `#1e1e4c` | Popovers and raised menus |
| `--color-text-primary` | `#1F2937` | `#ECECF7` | Primary text |
| `--color-text-secondary` | `#4B5563` | `#C2C2DC` | Supporting text |
| `--color-text-muted` | `#6B7280` | `#8C8CAE` | Metadata and quiet labels |
| `--color-border` | `#E2E2E6` | `#2a2a5c` | Standard border |
| `--color-border-light` | `#EFEFF2` | `#20204a` | Subtle divider |

Additional legacy aliases exist for older rules. The important aliases are:

| Alias | Resolves to |
| --- | --- |
| `--navy` | `var(--color-navy)` |
| `--brand-accent` | `var(--color-accent)` |
| `--blue` | `var(--color-info)` |
| `--teal` | `var(--color-success)` |
| `--warning` | `var(--color-warning)` |
| `--danger` | `var(--color-danger)` |
| `--focus-ring` | `var(--color-info)` |

Older literal values still exist in compatibility layers, including `--navy2:
#15155C` and `--brand-navy-soft: #1C1C6E`. New work should not add more literal
copies. Extend the token that owns the value.

### 3.3 Exact Semantic Tokens

Semantic colors are intentionally separate from the gold brand token.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-info` | `#2563EB` | `#2563EB` | Primary action, links, focus, selection, information |
| `--color-info-hover` | `#1D4ED8` | `#1D4ED8` | Info hover |
| `--color-info-soft` | `#EAF2FF` | `#132C52` | Informational tint |
| `--color-success` | `#3D8B6E` | `#3D8B6E` | Complete, active, healthy |
| `--color-success-soft` | `#E8F5EF` | `#153A31` | Success tint |
| `--color-warning` | `#B45309` | `#B45309` | Due soon, attention, warning |
| `--color-warning-soft` | `#FFF4E5` | `#3D2A12` | Warning tint |
| `--color-danger` | `#C43D4B` | `#C43D4B` | Destructive, blocked, failed |
| `--color-danger-soft` | `#FDECEE` | `#3D1C23` | Danger tint |
| `--color-danger-bg` | `#FEF2F2` | `#3A1A1A` | Destructive page or panel background |
| `--shadow-elevated` | `0 12px 40px -12px rgb(38 34 98 / 0.16)` | `0 12px 40px -12px rgb(0 0 0 / 0.6)` | Raised menus and popovers |

### 3.4 Primitive Tokens

The `--sc-*` family supplies the shared `src/components/ui/` primitives through
Tailwind's `@theme inline` block. Important values are:

| Primitive token | Light | Dark |
| --- | --- | --- |
| `--sc-background` | `#FFFFFF` | `#0C0C28` |
| `--sc-foreground` | `#1F2937` | `#ECECF7` |
| `--sc-card` | `#FFFFFF` | `#15153A` |
| `--sc-popover` | `#FFFFFF` | `#15153A` |
| `--sc-primary` | `#0B0B45` | `#2563EB` |
| `--sc-secondary` | `#EEF2F7` | `#1E1E4C` |
| `--sc-muted` | `#F1F3F5` | `#0C0C28` |
| `--sc-muted-foreground` | `#6B7280` | `#C2C2DC` |
| `--sc-accent` | `#C49A6C` | `#C49A6C` |
| `--sc-accent-foreground` | `#071A2E` | `#071A2E` |
| `--sc-destructive` | `#C43D4B` | `#E15A67` |
| `--sc-border` | `#E2E2E6` | `#2A2A5C` |
| `--sc-input` | `#E2E2E6` | `#2A2A5C` |
| `--sc-ring` | `#2563EB` | `#60A5FA` |
| `--sc-radius` | `0.75rem` | `0.75rem` |

`--radius-sm`, `--radius-md`, `--radius-lg`, and `--radius-xl` derive from
`--sc-radius`.

### 3.5 Browser And Install Branding

The PWA and browser chrome use a darker navy than the main CSS shell:

| Surface | Value |
| --- | --- |
| Browser `theme-color` | `#071A2E` |
| PWA `theme_color` | `#071A2E` |
| PWA `background_color` | `#071A2E` |
| PWA display | `standalone` |

The auth screens use `public/auth-background.png` and
`public/auth-background-light.png`. The current logo asset is
`public/tijha-logo.png`, while the product wordmark is `WorkSpace`. That asset
relationship is part of the current implementation and should be reviewed
deliberately if the brand is separated later.

### 3.6 Color Rules

1. Navy is the shell and primary brand surface.
2. Gold is identity-only. Use it for brand marks, active navigation details,
   and rare branded moments.
3. Blue is interaction and information. Use it for primary actions, selection,
   focus, links, and progress information.
4. Green means success or healthy state.
5. Amber means warning, due soon, or attention.
6. Red means danger, blocked, or destructive state.
7. Never rely on color alone. Pair state color with text, iconography, or both.
8. New app CSS reads `--color-*` tokens or uses generated Tailwind classes.
9. Do not add raw hex values when a token already expresses the meaning.
10. Inspect both light and dark rules before changing a shared selector.

## 4. FlowByte, Flowbite, And Component Adoption

### 4.1 Naming Clarification

There is no product component named `FlowByte` in this repository. The relevant
third-party system is **Flowbite**, the `flowbite` npm package and its CSS and
component patterns. If the intended internal name is FlowByte, it should be
documented as an alias, but the implementation currently refers only to
Flowbite.

### 4.2 The Decision

Flowbite was adopted as an information-structure and component-pattern
reference, not as a replacement design system.

Keep:

- WorkSpace's existing React and Radix behavior.
- WorkSpace's navy, gold, semantic, surface, radius, and typography tokens.
- Existing Button, Dialog, Select, Tabs, Dropdown, Popover, Calendar, and Card
  primitives.
- Existing data loading, validation, permissions, and accessibility behavior.

Adopt selectively:

- Skeletons for loading states.
- Alerts for inline status and errors.
- Activity timelines with connected rails.
- Real multi-step steppers.
- Responsive table shells.
- Avatar and status indicators.
- Badges.
- Progress treatments.
- List-group navigation.
- Card, form, dialog, and banner structure where it improves the existing UI.

Do not adopt:

- Flowbite JavaScript or data-attribute behavior.
- Flowbite's default color palette.
- Large marketing-card spacing.
- Floating labels in dense operational forms.
- A second Button, Dialog, Select, Tabs, or Dropdown implementation.
- A wholesale Flowbite restyle that would create a competing visual language.

### 4.3 Runtime And Cascade Decision

`src/main.jsx` imports the third-party Flowbite stylesheet before
`src/workspace.css`. This is deliberate: WorkSpace must remain the final owner
of its own skin and interaction states.

The former `flowbite-adopted.css` was consolidated into `workspace.css`. There
must not be a second adopted-component stylesheet today. New adopted patterns
extend the relevant layer in the single application stylesheet.

### 4.4 Translation Rule

When learning from a Flowbite component:

1. Read the structural and interaction idea first.
2. Keep the work in the existing WorkSpace React primitive wherever possible.
3. Translate color, spacing, border, and radius into WorkSpace tokens.
4. Preserve current behavior and permissions.
5. Verify the result in light and dark themes.
6. Test at desktop and mobile widths and run the production build.

## 5. Design System Architecture

### 5.1 One Authoritative Stylesheet

`src/workspace.css` is the only CSS file under `src/`. It owns the shell,
dashboard, workspace pages, dialogs, forms, tables, components, and user-facing
surfaces.

The file is assembled in cascade order:

1. Legacy base layer, formerly `styles.css`.
2. Workspace utility tokens.
3. Dashboard design system.
4. Shared workspace views.

The later Dashboard and Shared Workspace layers are the current visual
authority. Legacy rules remain only where real elements still depend on them.
When two rules conflict, update the newer owning layer instead of reviving the
older treatment.

The removed standalone mockup page and retired stylesheets are not a source of
truth. They once carried a conflicting token set, including `--gold: #b98145`
and `--navy: #071a2e`. Do not reintroduce a second stylesheet or token
vocabulary for a mockup.

### 5.2 Token Families

Before changing a color, identify which family owns it.

| Family | Owner | Purpose |
| --- | --- | --- |
| `--sc-*` | `:root` and dark `:root` before the utility layer | Shared UI primitives resolved through `@theme inline` |
| `--color-*` | `@theme` in the utility layer | WorkSpace class names and normal app CSS |
| Legacy aliases | Early `:root` | Compatibility for older selectors |
| shadcn-name aliases | Late `:root` after the dark remap | Compatibility for late-written surfaces |
| Page-local tokens | `.workspace-view, .today-dashboard` | Dashboard and workspace aliases |

Two traps are important:

- `--color-accent`, `--color-border`, `--color-primary`, and similar names can
  exist in both the inline primitive mapping and the utility `@theme` block.
  Read both before changing either.
- `--workspace-*` and `--dashboard-*` are often the same values under two
  names. Older components read the mirror.

Do not redeclare a token inside a per-surface rule to nudge one screen. Change
the value in the layer that owns it.

### 5.3 Typography

- UI and body text: Roboto.
- Headings and metrics: Montserrat.
- Heading letter spacing: `0`.
- Page title: Montserrat 400, `22px`, line-height `1.2`.
- Page subtitle: Roboto `13px`, line-height `1.5`.
- Standard body copy: `12px` to `13px`.
- Metadata and compact labels: `9px` to `11px`.
- Metric values: Montserrat 800, usually `24px` to `28px`, with tabular
  numerals.
- Do not use negative letter spacing.
- Uppercase labels may use small positive letter spacing only when the text is
  genuinely a compact label.

The repeated page eyebrow was removed and headings were reduced in an earlier
refinement. The current style favors direct page titles and subtitles rather
than stacked, oversized header layers.

### 5.4 Spacing, Radius, And Depth

- Page section gap: `20px` through `.workspace-view`.
- Standard card padding: `18px` to `20px`.
- Compact row padding: generally `10px` to `14px`.
- Standard card radius: `18px` to `20px`.
- Shared Card component baseline: `18px`, with page rules using `16px` in some
  denser surfaces.
- Rows and contained controls: generally `10px` to `14px`.
- Pills, avatars, status dots, and compact filters: fully rounded.
- Combo controls and buttons: pill treatment where the compact toolbar context
  supports it.
- Popup content: card-like surface, border, radius, and elevated shadow.
- Hover depth: small shadow increase and a maximum `1px` vertical lift.

Every `[data-slot='card']` receives a shared radius, border color, and depth
treatment. Changing card depth means changing that shared rule, not patching
individual cards.

Avoid viewport-scaled font sizes. Use stable dimensions, `minmax()`,
`aspect-ratio`, wrapping, and overflow constraints so layouts do not shift.

### 5.5 Iconography

- Use Lucide React icons.
- Use an icon, not a text label inside a rounded control, when a familiar
  symbol exists.
- Every icon-only control needs an accessible label.
- Add a tooltip or title when meaning is not universally obvious.
- Decorative icons use `aria-hidden`.
- Action icons should not change the size of the control on hover or loading.

### 5.6 Shared Primitives

The shared UI layer lives under `src/components/ui/`:

- Alert
- Badge
- Button
- Calendar
- Card
- Dialog
- Dropdown Menu
- Popover
- Select and AppSelect
- Separator
- Skeleton
- Tabs

Shared application building blocks live in `src/components/workspace-ui.jsx`:

- `WorkspaceViewHeading`
- `SelectField`
- `DateTimeField`
- `DateField`
- `EmptyState`
- `ConfirmDialog`

The date controls deliberately use the app calendar and app select menus
instead of native date, time, and select popups. The goal is one visual and
interaction language across browsers and operating systems.

### 5.7 Buttons

- Default: primary action using the product's primary surface.
- Gold: rare brand action only.
- Secondary: neutral action with a visible border.
- Outline: quiet action on a card or toolbar.
- Ghost: icon or low-emphasis action.
- Destructive: delete, revoke, or permanent action.
- Link: text-link treatment, not a competing primary button style.

The shared Button handles disabled state, loading state, icon sizing, focus
ring, and common sizing. New work should use it rather than recreating button
CSS.

### 5.8 Forms And Pickers

- Use `AppSelect` or the shared input primitives.
- Text, date, number, and select controls use the soft form surface.
- Focus uses the information blue border and soft ring.
- Primary touch fields should remain at least `44px` high where possible.
- Do not use a native select for an in-row status control.
- Keep shared corner behavior in one rule. Do not add a blanket button radius
  rule that accidentally pills segmented controls, spreadsheet tabs, color
  swatches, or tile overlays.

### 5.9 Status, Priority, And Progress

- Status and priority always combine color and text.
- Progress tracks use a neutral border token and an information-to-success
  fill.
- Presence dots use a semantic color and one surface-colored ring drawn as a
  shadow so the dot's box does not grow.
- Warning, danger, and success backgrounds use the soft semantic tokens.
- Task state chips cover in progress, review, blocked, on hold, cancelled, and
  done.

### 5.10 Alerts, Skeletons, And Empty States

- Inline errors and status messages use `.workspace-alert` with a `data-tone`
  of `success`, `warning`, or `danger`, or the reusable `Alert` primitive.
- Skeletons are used while a panel loads.
- Skeleton groups expose a status role and accessible label.
- Empty states use `EmptyState` and explain the next useful action.

### 5.11 Surface Families

Shared surfaces include:

- App shell and navigation.
- Notifications.
- Today dashboard.
- My Tasks.
- Planner and daily operations.
- Calendar.
- Team and People.
- Projects and operational records.
- Reports and Activity.
- Check-ins and Time clock.
- Follow-ups.
- Channels, Chats, and direct messages.
- Files and Documents.
- Presentations and spreadsheets.
- Settings.
- Help and Legal.
- Import.
- Screen sharing.
- Zuri AI assistant.
- App update and install surfaces.
- Branded loading and error screens.
- Drawers and modals.

Each surface owns a class family. New styles extend that family in the shared
workspace layer rather than creating a parallel vocabulary.

## 6. Shell, Navigation, And Responsive Design

### 6.1 App Shell

- Desktop uses a navy rail, persistent header, and full-width working content.
- The workspace switcher lives in the sidebar rather than the header.
- The header carries the active page, global search, notifications, messages,
  theme control, help, and profile access.
- The layout uses a stable sidebar state so navigation does not shift the page.
- The shell is not a card. It is the frame around working surfaces.

### 6.2 Mobile Navigation

- Below `750px`, the sidebar hides and a fixed bottom pill navigation appears.
- The mobile bar keeps primary destinations visible and includes More for the
  full navigation set.
- The selected state uses the soft navy surface with the gold identity detail,
  matching desktop active navigation.
- `.page-content` reserves bottom padding so the mobile bar does not cover
  content.
- Zuri and account controls must remain reachable without overlapping the bar.

### 6.3 Responsive Rules

- Use fluid grids with `minmax()` instead of fixed card widths.
- Collapse two-column working layouts around `900px`.
- Stack toolbars at tablet widths and keep filter groups internally
  scrollable.
- Stack page headings at mobile widths while keeping the primary action
  visible.
- Check `1440`, `1200`, `1024`, `900`, `768`, `640`, `480`, and `390` widths
  when changing a shared layout.
- Do not allow text to overlap controls, cards, or adjacent content.
- Do not scale typography with viewport width.

### 6.4 Accessibility

- Prefer semantic HTML before ARIA.
- Keep visible keyboard focus on every interactive control.
- Use the global blue focus ring unless a component has a stronger local
  treatment.
- Provide a skip link to main content.
- Keep dialog titles and descriptions tied to the dialog with semantic Radix
  primitives.
- Do not rely on hover-only actions.
- Respect `prefers-reduced-motion`.
- Maintain readable contrast in both themes.
- Keep touch targets usable on mobile, normally at least `44px` for primary
  actions.
- Use `aria-current` for active navigation, `aria-pressed` for toggle state,
  and real tab semantics only for real tab panels.

### 6.5 Theme Decision

- Theme is stored under `workspace-theme`.
- The selected value is light, dark, or system.
- `data-theme` on the document root drives dark styles.
- Tailwind's dark variant is adapted to the same `data-theme` attribute.
- Components read theme-aware tokens instead of branching on a theme class.
- Both themes must be reviewed whenever a shared surface changes.

## 7. Date And Formatting Decisions

User-facing dates use one numeric order everywhere: `DD-MM-YY`.

Examples:

- Date only: `13-09-26`.
- Date and time: `13-09-26 14:05`.
- Narrow day and month: `13-09`.
- Today headline: `Sunday September 13 2026`.

ISO values stay in API payloads, date keys, comparisons, and `datetime`
attributes. The UI formats only the displayed value.

Use:

- `formatDay`
- `formatDate`
- `formatDateTime`
- `formatDayMonth`
- `formatLongDate`

from `src/lib/workspace-format.js` on the frontend, and `display_date()` in
`tasks/views.py` for server text.

Do not use `toLocaleDateString` for product dates. The browser or operating
system locale must not change WorkSpace's date order.

## 8. Frontend Architecture And Data Connection

### 8.1 Technology Layer

- React 19.
- Vite 6.
- Tailwind CSS 4.
- Radix UI primitives for complex interaction behavior.
- Lucide React for icons.
- `class-variance-authority` and `tailwind-merge` for shared component
  variants and class composition.
- React Hot Toast for transient app feedback.
- date-fns and a custom Calendar component for calendar behavior.
- DOMPurify for client-side rich-content sanitization.
- Sentry React integration when a DSN is configured.

### 8.2 State Ownership

The application shell in `src/main.jsx` owns:

- Session state.
- Active workspace.
- Workspace data collections.
- The selected task.
- Theme and sidebar state.
- Global search.
- Cross-view navigation state.
- Shared overlays, notices, confirmations, and the Zuri assistant.

View components receive values and callbacks from the shell. If two sibling
views must react to one state value, declare that state in their common parent
and pass a value/onChange pair down. Do not infer ownership from the visual
nesting of JSX.

Workspace switching clears workspace-scoped state before loading the next
workspace. This prevents records from one tenant from briefly appearing in
another tenant's UI.

### 8.3 Navigation State

The active page is currently React state. Persistent UI choices use
`localStorage`:

- Theme.
- Sidebar collapsed state.
- Last page.
- Calendar panel preference.
- Project filter.
- AI panel preference.
- Release-note seen marker.
- Install prompt state.

Ephemeral navigation state uses `sessionStorage`, including a requested task
bucket and reminder deduplication.

The existing implementation does not use `pushState` for normal page
navigation. The URL remains stable after the initial `?view=` read, so browser
Back does not return to the previous internal view. Any future routing or
deep-link work must add `pushState` plus a `popstate` listener rather than
expanding the one-time initializer.

### 8.4 API Access

In local development:

- Vite serves the frontend on port `5175` by default.
- Django runs on port `8000`.
- Vite proxies `/api` to `http://127.0.0.1:8000`.

In production:

- The split deployment serves the static frontend and proxies `/api/` through
  Nginx.
- The Railway single-service deployment builds `dist/` and serves it from
  Django through WhiteNoise.

The frontend uses native `fetch`, not TanStack Query or another data client.
Every authenticated request includes:

```js
credentials: 'include'
```

Mutating requests use the CSRF cookie through `getCsrfToken()` and send:

```js
'X-CSRFToken': token
```

JSON responses are read through `readJsonResponse()` so an HTML error page
cannot be mistaken for a valid JSON payload. Workspace-scoped requests either
use an explicit `/api/workspaces/{id}/...` route or the legacy `X-Workspace-Id`
header where that contract still exists.

### 8.5 Initial Session And Workspace Load

The client data flow is:

```text
Browser
  -> GET /api/auth/me/
  -> session.user and workspace memberships
  -> choose active workspace
  -> reset workspace-scoped state
  -> Promise.all /api/workspaces/{id}/...
  -> mapTaskFromApi at the task boundary
  -> store normalized collections in App state
  -> render views from server-authoritative data
```

The workspace load fetches around twenty collections in parallel, including
tasks, members, projects, lookups, templates, channels, direct conversations,
follow-ups, events, check-ins, shifts, notifications, activity, buckets,
invitations, saved views, report summary, and audit data when permitted.

Tasks are paginated at 200 per page and loaded until pagination ends, with a
safety cap. The Team page owns a separate paginated task query so it does not
download the entire task table and then render only one page.

`mapTaskFromApi()` is the single adaptation boundary from API shape to UI shape.
Every code path that receives a task must use it, or newly added fields will
silently disappear on whichever path was not updated.

### 8.6 Mutation Cycle

The standard mutation path is:

```text
User action
  -> POST, PATCH, or DELETE
  -> credentials and CSRF token
  -> server validates workspace membership and permission
  -> server performs the mutation
  -> server records activity, notification, audit, or history where relevant
  -> client updates local UI or requests a scoped refresh
  -> toast or inline error communicates the result
```

The server remains authoritative. The client may update optimistically for
immediate feedback, but it must reconcile against the returned payload or a
refresh. Do not maintain a second permanent copy of business rules in the UI.

### 8.7 Change Detection And Refresh

Running a full workspace refresh every 15 seconds was rejected because it
re-downloaded around twenty collections per open tab even when nothing changed.

The current design uses a cheap fingerprint endpoint:

```text
GET /api/workspaces/{id}/pulse/
```

The fingerprint combines row counts and newest timestamps across workspace
collections. It includes edit and delete stamps for mutable records, unread
notification state, direct-message state, and member presence or last-seen
changes.

The client:

1. Reads the initial fingerprint.
2. Runs one full workspace refresh.
3. Polls the fingerprint every 15 seconds only while the tab is visible.
4. Runs the full refresh only when the fingerprint changes.
5. Refreshes immediately when the tab becomes visible again.
6. Prevents overlapping full refreshes.

This preserves one well-tested full-refresh path while avoiding needless
network and database work.

### 8.8 Notification Stream

Notifications use:

```text
GET /api/notifications/summary/
GET /api/notifications/stream/?since={id}
```

The stream is an SSE response with keep-alive comments and a finite connection
window. The client reconnects with the latest notification id. If SSE is not
available, the notification alert helper falls back to a 15-second poll.

Installed-app badges and in-app unread counts use the same summary contract.
Chat alerts are separated from general workspace notifications in the UI.

## 9. Backend And Data Architecture

### 9.1 Backend Stack

- Django 5.2 or newer within the 5.x line.
- Django ORM and migrations.
- SQLite for local development.
- PostgreSQL 16 for containerized and production deployments.
- Gunicorn with threaded workers.
- WhiteNoise for static assets.
- Django session authentication.
- django-axes for login throttling.
- Requests to external services where an integration is configured.
- Sentry when a backend DSN is configured.
- Management commands for reminders, webhooks, automation, and retention.

The backend deliberately avoids introducing a separate single-page API
framework or a second authentication system. It uses Django views, JSON
responses, sessions, CSRF, and explicit serializers/dictionaries.

### 9.2 Tenant Model

The core tenancy model is:

```text
Workspace
  -> Membership -> User
  -> Projects
  -> PlanBucket
  -> Task
  -> CalendarEvent
  -> CheckIn
  -> ChatMessage, ChatChannel, DirectConversation
  -> FollowUp
  -> ActivityEvent, AuditLog, WorkspaceNotification
  -> WorkspaceDocument, WorkspaceFile
  -> WorkspaceSetting
```

Important ownership decisions:

- `Membership` is the join between a user and a workspace.
- A workspace membership is unique per workspace and user.
- Roles are owner, manager, and member.
- Granular permissions sit on top of the role.
- Owners always receive all permission keys.
- Managers receive the manager default or their explicit override.
- Members receive a fixed minimal default unless a feature has its own rule.
- Owners can create additional top-level workspaces.
- Managers and members cannot create top-level workspaces.
- A user can belong to multiple workspaces.
- A profile stores a default workspace, but switching workspaces remains the
  user's choice.

### 9.3 Workspace Isolation

Workspace isolation is enforced repeatedly:

- URL-scoped endpoints validate the workspace id against membership.
- Legacy task endpoints resolve `X-Workspace-Id` or the user's first workspace.
- Related users are queried through membership in the same workspace.
- Resource lookups include the workspace in the database filter.
- Archived or missing scoped resources return 404 rather than leaking their
  existence.
- `UserProfile.default_workspace` is only accepted when the user actually has
  an active membership in that workspace.

The UI may hide unavailable actions, but UI hiding is not authorization. Every
permission-bearing endpoint must enforce the rule on the server.

### 9.4 Permission Helpers

The backend centralizes common gates:

- `require_authenticated`
- `require_workspace_member`
- `require_workspace_leader`
- `require_permission`
- `require_task_editor`
- `require_follow_up_editor`

Use the narrowest existing helper that expresses the rule. When adding a new
permission, add it to the permission registry, apply it server-side, expose the
effective permission to the client, and hide or disable the UI action only as a
secondary convenience.

### 9.5 API Contract

- All business endpoints live under `/api/`.
- Mutating requests require the authenticated session and CSRF token.
- Workspace-scoped endpoints require membership.
- Validation errors use `400` with `{ "error": "...", "errors": {...} }` where
  field errors are available.
- Permission failures use `403`.
- Missing scoped resources use `404`.
- Dates in payloads use ISO `YYYY-MM-DD`.
- Datetimes use ISO 8601.
- Server-generated identifiers such as task codes cannot be supplied or
  changed by clients.
- Compatibility aliases may remain during a migration, but new consumers use
  the explicit workspace route and canonical field names.

### 9.6 Domain Rules

The backend, not the client, owns rules such as:

- A task due date cannot precede its start date.
- Progress is an integer from `0` to `100`.
- A done task has `100%` progress and a completion date.
- A blocked task requires blocker details.
- A task code is unique and permanently reserved within a workspace.
- Deleting a task archives it by default.
- Permanent deletion is owner-only and preserves history.
- Follow-up editing depends on creator, assignee, or leader role.
- Project writes require the appropriate project permission.
- Workspace deletion is archive-first and confirmed.
- Invitations have a seven-day default lifetime, a resend cooldown, and one
  pending invitation per workspace and email.

### 9.7 Notifications, Activity, And Audit

These are separate concepts:

- `WorkspaceNotification`: a user-facing alert with a target and read state.
- `ActivityEvent`: a human-readable workspace history entry.
- `AuditLog`: a permission-sensitive record of administrative or security
  actions.
- `TaskChangeHistory`: append-only task field history.
- `NotificationDelivery`: an idempotency record for scheduled reminders and
  digests.

When a mutation matters to another person, create the appropriate activity and
notification records in the same server operation. Use deterministic dedup
keys for scheduled delivery. Notification preferences are enforced before
delivery.

### 9.8 Authentication And Security Decisions

- The session lasts seven days by default.
- Session expiry is measured from sign-in and is not rolled forward on every
  request.
- Rolling expiry was rejected because the pulse endpoint is polled by every
  open tab, which would turn a read probe into a database write.
- Failed logins are rate-limited on the combination of IP address and
  username.
- The default is five failures followed by a 15-minute cooloff.
- A successful sign-in clears the failure counter.
- HTTPS deployment enables secure session and CSRF cookies, SSL redirect,
  HSTS controls, content-type sniffing protection, and a same-origin referrer
  policy.
- Google Sign-In verifies the ID token audience server-side.
- Rich HTML is sanitized on both client and server.
- Allowed link schemes are limited to safe web, mail, tel, relative, and
  approved inline-image use.
- External links receive `noopener noreferrer`.
- Screen captures use private storage and authenticated streaming endpoints.
- Uploads are bounded at the proxy, Django request, and feature levels.

### 9.9 File Storage

- General media uses `MEDIA_ROOT`.
- Private media uses `PRIVATE_MEDIA_ROOT`.
- Public media may be served by Django in development and by the production
  reverse proxy or storage layer in a split deployment.
- Private screen captures are never exposed through a public media URL.
- Authorized attachment downloads go through Django.
- Deleting records that own files must clean up those files safely and log
  failures rather than silently swallowing them.

### 9.10 Optional Integrations

Integration decisions follow a configured-or-no-op pattern:

- Brevo transactional email is disabled without an API key and falls back to
  the console email backend in development.
- Google Sign-In renders only when both backend and frontend client ids are
  configured.
- Web push is disabled unless VAPID keys are present.
- Sentry is disabled without a DSN.
- Webhooks and automation run as explicit management commands or a worker.

This keeps local development and CI offline by default and makes optional
services safe to omit.

### 9.11 Background Work

The reminder worker runs every 60 seconds in Docker Compose and:

- Delivers calendar reminders.
- Delivers outbound webhooks.
- Runs workspace automation.
- Purges expired screen captures.

Railway uses the same commands as a cron job. Commands must be idempotent so a
retry or overlapping run does not duplicate a reminder, webhook, or digest.

### 9.12 Reporting And Imports

- Reporting lives in `tasks/reporting.py`, independent of HTTP concerns.
- Reports support workspace, operations, and project scope.
- Periods are delivery/completion based, not creation-date based.
- Drill-down filters are replayable.
- KPI calculations protect against zero targets.
- Data-integrity checks are explicit and severity-ranked.
- Excel import previews before commit.
- Preview and commit require matching workspace, checksum, and preview id.
- Commit is transactional.
- Row exceptions are reported without rolling back valid rows.
- Unmatched users may become invitations or row exceptions depending on the
  import mode.

## 10. Deployment Decisions

### 10.1 Local

```text
Django API: http://localhost:8000
Vite frontend: http://localhost:5175
Database: db.sqlite3 by default
```

### 10.2 Split Container

`docker-compose.yml`, `Dockerfile.api`, and `Dockerfile.web` provide:

- PostgreSQL 16.
- Django API.
- Nginx-served React build.
- Reminder worker.
- Persistent database and media volumes.
- Health checks.
- Upload limit aligned across Nginx and Django.

### 10.3 Railway Single Service

`Dockerfile.railway`:

- Builds the React app with Node 22.
- Installs Python dependencies and tesseract.
- Copies `dist/` into the Django image.
- Runs migrations and collectstatic at startup.
- Serves `/api/` and the built SPA from one Gunicorn process.

This favors simple deployment and same-origin requests. PostgreSQL is supplied
through `DATABASE_URL`.

## 11. Coding And Engineering Principles

These principles are reusable beyond WorkSpace.

1. Make the server authoritative for identity, permissions, validation, and
   domain rules.
2. Treat workspace or tenant scoping as a database and authorization concern,
   not a frontend filter.
3. Keep one clear adaptation boundary when API models differ from UI models.
4. Prefer existing primitives and helpers over inventing parallel ones.
5. Add an abstraction only when it removes real duplication or matches an
   established local pattern.
6. Do not add a dependency without asking. Dependencies are maintenance and
   security burdens.
7. Keep changes small and logical. A small shipped fix beats a broad uncertain
   refactor.
8. Make one logical change per commit.
9. Never commit secrets, API keys, tokens, credentials, or `.env` files.
10. Never commit agent-specific folders or files.
11. Keep implementations agent-neutral. A feature must not depend on which AI
    agent wrote it.
12. Do not self-tag commits with an agent or model name.
13. Inspect `git diff` and `git status` before committing.
14. Before deleting code, search the project and related references.
15. Remove dead code instead of commenting it out. Git history preserves it.
16. Test the behavior changed, then run the broader build or check when shared
    behavior is touched.
17. Verify both themes, relevant breakpoints, and accessibility states for UI
    changes.
18. Use semantic HTML before ARIA.
19. Keep focus visible and keyboard paths complete.
20. Respect reduced motion.
21. Avoid hover-only actions.
22. Keep text inside its container and prevent overlap at every supported
    viewport.
23. Use stable dimensions and responsive constraints instead of
    viewport-scaled typography.
24. Use tokens instead of raw color values in new CSS.
25. Change a token in the layer that owns it. Never redeclare a shared token in
    one surface to nudge it.
26. Delete duplicate rules rather than stacking another override.
27. Preserve ISO dates in data and format only what the user sees.
28. Do not rely on the browser locale for product-defined formats.
29. Keep destructive actions explicit and confirmed.
30. Treat activity, notification, audit, and history as distinct records with
    distinct audiences.
31. Make scheduled or retryable operations idempotent.
32. Log operational failures instead of swallowing them silently.
33. Keep optional integrations off by default and safe when unconfigured.
34. Keep public and private file storage separate.
35. Do not trust client-supplied workspace ids, owner ids, role values, task
    codes, or progress values without server validation.
36. Keep state in the common parent when sibling views must share it.
37. Keep session and tenant state reset when switching accounts or workspaces.
38. Prefer same-origin API calls and ordinary cookies over a second
    cross-origin auth mechanism.
39. Use cheap change detection before triggering expensive refresh work.
40. Keep one full data-refresh path rather than many inconsistent merge paths.

## 12. Important Historical Decisions And Replaced Approaches

### 12.1 Initial Navy MVP

The first commit established a dark navy team operations MVP. Light and dark
theme persistence followed immediately. The initial identity was dark-shell
first, with the working content later becoming the quiet light surface users
see today.

### 12.2 Flowbite And TijhaBooks Influence

Flowbite visual styling was integrated, then the shell was aligned with the
TijhaBooks navigation theme. That influence survives in the navy shell,
spacing, and selected component patterns, but WorkSpace later established its
own token system and component vocabulary.

The logo asset is still `tijha-logo.png`, even though the product name is
WorkSpace.

### 12.3 Radix And shadcn-Style Primitives

A Radix and shadcn-style UI layer was introduced for execution features, chat,
reporting, and shared primitives. This became the interaction layer. The
current Button, Dialog, Select, Popover, Dropdown, Tabs, Calendar, and related
components are descendants of that decision.

### 12.4 Modern Dashboard And Reverted Penpot Pass

A modern dashboard design was added and extended across product views. A
separate Penpot interface pass was then reverted. The surviving lesson is to
keep the WorkSpace token system and primitives as the authoritative design
language rather than importing a full alternate interface.

### 12.5 Selective Flowbite Adoption

The project later adopted Flowbite's structural ideas without adopting its
runtime, palette, or component replacements. Alerts and Skeletons were added
as local primitives, and adopted CSS was kept under WorkSpace ownership.

### 12.6 Gold Split From Semantic UI

Gold had been used as a universal accent. A dedicated decision separated it
from semantic colors:

- Gold: brand identity.
- Blue: interaction and information.
- Green: success.
- Amber: warning.
- Red: danger.

This is one of the most important decisions to preserve in future apps.

### 12.7 Typography And Header Simplification

The repeated page eyebrow was removed, headings were reduced, and fonts were
unified. Montserrat became the heading and metric face; Roboto became the body
and UI face.

### 12.8 Pill Controls

Buttons, dropdowns, search fields, combo controls, and compact filters moved
to a pill language. The radius belongs to shared controls, not to a global
button selector, so segmented controls and specialized tiles keep their own
shape.

### 12.9 Single Stylesheet

`styles.css`, `tijhabooks-theme.css`, `index.css`, and `flowbite-adopted.css`
were consolidated into `workspace.css`. `DesignSystem.md` now documents the
layer stack, tokens, component rules, surface families, responsive behavior,
and change rules.

The standalone UI mockup page was removed because it carried a conflicting
token set. Future mockups must be React pages built on the shared primitives
and tokens.

### 12.10 Date Standardization

Dates moved from locale-dependent output to a fixed `DD-MM-YY` display
format, with ISO retained in data and local day arithmetic. This prevents a
date from moving around the world because of timezone or browser settings.

### 12.11 Data Refresh Efficiency

The workspace refresh loop moved from unconditional full refreshes to a
fingerprint-driven refresh, and notifications gained SSE. The client still
keeps one full-refresh path, which reduces merge complexity while avoiding
unnecessary repeated downloads.

## 13. Guardrails And Known Traps

- Do not add another application stylesheet.
- Do not edit a retired stylesheet.
- Do not add a second token vocabulary for a mockup or new page.
- Do not use gold for focus, generic selection, links, success, warning,
  danger, or default buttons.
- Do not add raw colors in new shared CSS when an existing token expresses the
  meaning.
- Do not choose a token family by name alone. Several families share prefixes.
- Do not redeclare a shared token in a per-surface rule.
- Do not add a blanket button radius rule.
- Do not put cards inside cards.
- Do not rely on `toLocaleDateString` for product dates.
- Do not trust `X-Workspace-Id` without a membership check.
- Do not trust a client-supplied role, permission, owner id, task code, or
  progress value.
- Do not assume a task field is present in the UI unless it passes through
  `mapTaskFromApi()`.
- Do not add normal navigation deep links without first adding `pushState` and
  a `popstate` listener.
- Do not poll every collection every 15 seconds. Use the fingerprint then run
  the full refresh only when it changes.
- Do not make a reminder, webhook, or digest operation non-idempotent.
- Do not expose private captures through public media URLs.
- Do not revert unrelated changes in a dirty working tree.

## 14. Reuse Blueprint For A New App

1. Define the product's operational feel and audience before choosing colors.
2. Choose one brand color and reserve it for identity.
3. Define separate info, success, warning, and danger tokens.
4. Define light and dark values for every surface, border, and text token.
5. Choose one heading face and one UI or body face. Keep heading letter
   spacing at zero.
6. Create one application stylesheet and one design-system document.
7. Build Radix or equivalent accessible primitives before feature-specific
   controls.
8. Add a small set of shared layout, card, row, form, status, empty-state, and
   confirmation primitives.
9. Set page, card, row, and control spacing and radius once.
10. Define icon usage and accessible icon-button rules.
11. Define responsive breakpoints and verify them with real content.
12. Define date, time, number, and table formatting centrally.
13. Use same-origin API calls with session authentication or an equally clear
    token boundary.
14. Scope every tenant-owned record by tenant at the database and permission
    layers.
15. Centralize permission and membership helpers.
16. Keep one API-to-UI mapping boundary.
17. Use a cheap change fingerprint before expensive refresh work.
18. Separate notifications, activity, audit logs, and history.
19. Make file storage public or private by explicit policy.
20. Make optional services safe to disable.
21. Make background work idempotent.
22. Add focused tests for the changed behavior and broader checks for shared
    contracts.
23. Check both themes, mobile widths, keyboard access, and reduced motion.
24. Keep commits logical, secrets out, agent metadata out, and the worktree
    clean of unrelated edits.

## 15. Source Of Truth Map

| Concern | Source |
| --- | --- |
| Visual rules and token tables | `DesignSystem.md` |
| Application CSS and design tokens | `src/workspace.css` |
| App shell, state, data loading, navigation | `src/main.jsx` |
| Shared components | `src/components/ui/` and `src/components/workspace-ui.jsx` |
| Formatting and API helpers | `src/lib/workspace-format.js` |
| Django runtime configuration | `backend/settings.py` |
| Domain models and permissions | `tasks/models.py` |
| API routes | `tasks/urls.py` |
| API behavior and permission helpers | `tasks/views.py` and feature view modules |
| Change detection | `tasks/pulse.py` |
| Notification summary and SSE | `tasks/notification_status.py` |
| Runtime deployment | `docker-compose.yml`, `Dockerfile.api`, `Dockerfile.web`, `Dockerfile.railway` |
| API contracts | `docs/` |
| User-facing workflow guide | `docs/user-guide.md` |

This document and `DesignSystem.md` should change together when a durable
design or architecture decision changes. A future agent should be able to read
these two files first and avoid reviving an already-rejected direction.
