# WorkSpace Design System

Last updated: 14-11-26
Verified against the code on 14-11-26 (`src/pencil.css`, `src/main.jsx`, `src/components/ui/*`, `src/lib/flowbite-theme.js`, `src/lib/utils.js`).

This file was rewritten on 14-11-26. The previous version described `src/workspace.css`, which the app no longer loads, and listed fonts, colours and a shell that are no longer what renders. Earlier versions are in git history if you need them.

**Code wins.** If this document and the running app disagree, the app is right. Fix this document in the same change that changes the look. Anything marked UNVERIFIED below was not checked against the code during this rewrite.

## 1. Source of truth

- `src/pencil.css` is the active application stylesheet. `src/main.jsx` imports it once (`import "./pencil.css"`). Its header says it is authored from `Workspace.fig` (the Open Pencil design, frames P1 to P67 and C1 to C7) and that `workspace.css` is deliberately no longer loaded.
- `src/settings.css` and `src/chat-mobile.css` also exist. Check where they are imported before editing them (UNVERIFIED).
- The stack is Tailwind CSS 4 plus Flowbite React. `pencil.css` imports `tailwindcss` and `flowbite-react/plugin/tailwindcss`, then declares the tokens.
- Tokens come in two layers inside `pencil.css`:
  1. `--pencil-*` custom properties on `:root`, with dark-theme overrides on `:root[data-theme="dark"]` and `:root.dark`. These hold the raw values and are authoritative (the file states a 1:1 match to the design Foundations).
  2. A Tailwind `@theme` block that maps them to utility names: `--color-navy`, `--color-surface`, `--color-text-primary`, `--color-danger`, `--radius-control`, `--text-label`, and so on. Components use these through classes such as `bg-surface`, `text-text-muted`, `rounded-control`, `text-label`.
- Dark mode is switched by `data-theme="dark"` on the root, with a matching `.dark` class (for Tailwind's `dark:` variant and Flowbite). `src/lib/theme.js` owns the logic: stored values are `light`, `dark` or `system`.
- Do not add another application stylesheet. Extend `pencil.css`, reuse the primitives in `src/components/ui/`, and never edit CSS in a retired file.

## 2. Brand and colour tokens

Values below are the `:root` (light) values, with the dark value in brackets where it differs. Always use the token, never the hex.

### Brand

| Token | Value | Use |
| --- | --- | --- |
| `--pencil-navy` (`bg-navy`) | `#001666` | App shell, strong brand surface, primary action |
| `--pencil-navy-hover` | `#001E88` | Hover on navy surfaces, hero gradient end |
| `--pencil-navy-active` | `#00124D` | Pressed |
| `--pencil-navy-dark` | `#000D3D` | Deepest navy (use for title bars and chrome around the app) |
| `--pencil-navy-tint` (`bg-selected`) | `#E8EAF6` (`#041234`) | Selected rows and chips |
| `--pencil-navy-focus` | `#2E6FB7` | Focus accent |
| `--pencil-bronze` (`bg-accent`, `bg-bronze`) | `#C49A6C` | Brand accent, used sparingly |
| `--pencil-bronze-hover` / `-active` | `#B18455` / `#9A6D40` | |
| `--pencil-bronze-soft` | `#F6EFE7` (`#2D2117`) | Soft accent fill |
| `--pencil-bronze-text` | `#63472D` (`#E8C69E`) | Text on bronze-soft |

Note on `#0B0B45`: earlier versions of this document and some older code name the brand navy as `#0B0B45`. The token is `#001666` (set by the "apply navy and bronze brand palette" commit, 21-09-26). `#0B0B45` survives only as a literal in a few places (the soft-shadow tint `rgb(11 11 69 / ...)`, the Today hero's bronze button label). Do not add new raw hex values; use `--pencil-navy` and the tokens.

### Surfaces, borders, text

| Token | Light | Dark |
| --- | --- | --- |
| `--pencil-canvas` (`bg-background`) | `#F9FAFB` | `#000A2A` |
| `--pencil-surface` (`bg-surface`) | `#FFFFFF` | `#000721` |
| `--pencil-surface-muted` (`bg-surface-secondary`) | `#F3F4F6` | `#000C2E` |
| `--pencil-surface-hover` | `#F3F4F6` | `#001036` |
| `--pencil-surface-elevated` | `#FFFFFF` | `#000926` |
| `--pencil-sidebar` | navy | `#000A2A` |
| `--pencil-border` / `-strong` / `-light` | `#E5E7EB` / `#D1D5DC` / `#F0F1F3` | `#112D6B` / `#1E3C7A` / `#092356` |
| `--pencil-text` (`text-text-primary`) | `#101828` | `#F8FAFC` |
| `--pencil-text-secondary` | `#4A5565` | `#CBD5E1` |
| `--pencil-text-muted` | `#667085` | `#94A3B8` |

### Semantic colours

| Role | Token | Light | Soft fill |
| --- | --- | --- | --- |
| Information / focus / links | `--pencil-blue` (`text-info`) | `#2563EB` | `#E7EEF6` |
| Success | `--pencil-success` | `#007A55` | `#ECFDF5` |
| Warning | `--pencil-warning` (text) and `--pencil-warning-fill` | `#7E2A0C`, `#FF6900` | `#FFF7ED` |
| Danger | `--pencil-danger` | `#C70036` | `#FFF1F2` |

### Alerts (three-part ramp: fill, stroke, text)

| Tone | Fill | Stroke | Text |
| --- | --- | --- | --- |
| info | `#EFF6FF` | `#DBEAFE` | `#1C398E` |
| success | `#ECFDF5` | `#A4F4CF` | `#006045` |
| warning | `#FEF9C3` | `#FDE68A` | `#854D0E` |
| danger | `#FFF1F2` | `#FFCCD3` | `#A50036` |

Utilities: `bg-alert-info-fill`, `border-alert-info-stroke`, `text-alert-info-text`, and the same for success, warning and danger. Each has its own dark values. A tone is never carried by colour alone: pair it with an icon and a label.

### Status, priority, charts

- Task status tokens (each with `-bg` and `-mark`): `todo`, `progress`, `review`, `blocked`, `hold`, `cancelled`, `done` (`bg-status-done-bg text-status-done`).
- Priority: `low`, `medium`, `high`, `urgent` (`--color-priority-*`, mapped onto the status pairs).
- Chart tokens: `--color-chart-series-1` (navy), `-series-2` (`#2E6FB7`), `-series-3` (`#7FB2DE`), `-comparison`, `-completed`, `-in-progress`, `-delayed`. Chat outgoing bubble: `--color-chat-outgoing`.
- Charts use one hue per series, direct or legend labelling, and never rely on colour alone for state.

## 3. Typography

- Font: **Inter** for everything (`--font-sans` and `--font-display` are both Inter), loaded from Google Fonts at weights 400, 500, 600 and 700. The previous Montserrat plus Roboto pairing is retired. Do not reintroduce it.
- Type scale (declared as `--text-*`, used as `text-*` classes):

| Class | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| `text-display` | 40 / 44 | 700 | -0.8px |
| `text-page-heading` | 30 / 36 | 700 | -0.4px |
| `text-section-heading` | 24 / 32 | 600 | -0.4px |
| `text-card-heading` | 20 / 28 | 600 | |
| `text-subheading` | 16 / 24 | 600 | |
| `text-body` | 16 / 24 | | |
| `text-metric` | 32 / 36 | 700 | -0.6px |
| `text-label` | 14 / 20 | 500 | |
| `text-body-small` | 14 / 20 | | |
| `text-body-compact` | 13 / 18 | | |
| `text-caption` | 12 / 16 | | |
| `text-overline` | 11 / 16 | 600 | +1.6px, uppercase |

- Mobile text inputs are forced to 16px so iOS Safari does not zoom on focus.
- Use tabular numerals for metrics and tables. Uppercase labels may use positive tracking when they are genuine labels, never body copy.

## 4. Radius, depth and spacing

- Radius tokens: `--radius-chip` 4, `--radius-badge` 6, `--radius-icon` 8, `--radius-card` 12, `--radius-control` 12, `--radius-container` 16. Buttons and many controls are pills (`rounded-full`); icon-only buttons are circles.
- Soft surface tokens (section 6): `--radius-soft-card` 24px (20px under 640px), `--radius-soft-row` 18px (16px under 640px).
- Elevation: `--shadow-level-1` (`0 1px 2px rgb(0 0 0 / 2%)`) and `--shadow-level-2` (`0 4px 10px rgb(0 0 0 / 5%)`) from the design Foundations. The soft system adds `--shadow-soft` and `--shadow-lift` (section 6), which is what cards and floating controls actually use now.
- Page padding: `.page-content` is `32px 32px 64px`. Section gaps are generally 16 to 24px. Card padding is generally 20 to 24px.
- Inner radius is outer radius minus the inset.
- If a shadow looks like it does nothing, check that its token has units (a length without a unit is invalid and the whole declaration is dropped).

## 5. App shell (desktop and phone)

The shell lives in `src/main.jsx` (Tailwind classes) and `src/pencil.css` (overrides targeting `aside[class*='bg-navy']`, `header.shell-header` and friends).

- **Rail:** a navy surface (`--pencil-sidebar`), `264px` expanded, `4.5rem` (72px) collapsed, from the `lg` breakpoint (1024px) up. The collapsed state persists between visits.
- **Brand block:** a 32px white logo tile and the product wordmark (15/700), then the workspace switcher (a pill).
- **Nav items:** pills, 44px tall (expanded), 16px left padding, 20px icons; collapsed they are 46px circles centred in the rail with 8px between them. Group labels are 11px, uppercase, tracked (`0.14em`), in a muted blue-white. The **active page is a white pill** with a navy label and the soft shadow (light theme; dark keeps its own colours). A count badge (for example Follow-up) sits at the right; collapsed it becomes a dot.
- **Collapse toggle:** a 30px circle on the rail's right edge (`.sidebar-expand-flyout`), vertically centred in the gap between the brand block and the first item (top 164px). It covers neither the logo nor Today. Hidden below 1024px.
- **Top bar:** `header.shell-header`, 84px tall, transparent on the canvas (no ruled white strip), 32px side padding. It holds the workspace context, a 46px pill search (the wrapper owns the surface), and floating 44px round icon buttons with the soft shadow, plus a pill account control. The Zuri assistant button is a 44px pill; on mid-width desktops (1024 to 1599px) it keeps its icon and drops its label. `--shell-header-h` is `84px` on desktop so full-height pages can fill the space beneath it.
- **Canvas:** `.main-content` on `--pencil-canvas`; the app shell is `100dvh` and the main element owns scrolling.
- **Phones (below 1024px):** the rail becomes an off-canvas drawer, and a floating bottom tab bar (`.mobile-tabbar`, navy, 64px tall, 32px radius, fixed 16px above the bottom edge, up to 360px wide) replaces it. The phone app bar uses 38px round shadowed icon buttons.

## 6. Soft surfaces (applied)

The app separates surfaces with depth, not lines. This is live in `pencil.css` (the block titled "Soft surfaces", plus later blocks for Today and the top bar), and it supersedes the earlier flat card rule.

- **Tokens:** `--shadow-soft: 0 1px 2px rgb(11 11 69 / .04), 0 8px 24px -6px rgb(11 11 69 / .10)`; `--shadow-lift: 0 2px 4px rgb(11 11 69 / .05), 0 16px 36px -8px rgb(11 11 69 / .18)`; `--soft-edge` is `transparent` in light and `rgb(255 255 255 / .07)` in dark, so dark mode keeps a faint edge; `--soft-divider` is a faint rule for rows inside a grouped card.
- **Cards and panels** (`[data-slot='card']`, the long list of named panels, and any block-level element with `border border-border` plus a `rounded-*` class) drop their hairline colour, take `--radius-soft-card`, and float on `--shadow-soft`. The border width is left unchanged so nothing shifts.
- **List rows** use `--radius-soft-row` and the soft shadow. Rows inside one grouped card stay flat with `--soft-divider` instead, so a list reads as one card.
- **Buttons** are pills; **icon-only buttons are circles**. Outline buttons and filter selects float on the soft shadow.
- **Search and filters:** one surface. The wrapper owns the fill, pill shape and soft shadow, and the inner input has no border. The blue focus ring stays: `0 0 0 3px rgb(37 99 235 / 18%)` beside the shadow.
- **Today hero:** the page header becomes one navy card (`header[data-hero]`): 32px radius, `135deg` gradient from navy to navy-hover, a blurred bronze glow at the top right, `--shadow-lift`. Its primary action is a bronze button; other actions are translucent white. The Check-ins page header can use the same hero treatment.
- **Metric tiles** (`[data-metric]`): a 48px tinted icon circle (`.metric-icon[data-tone]` with info, success, danger or warning) beside the number. On phones they show two to a row.
- **Chat:** no rule lines between panes (a soft shadow separates them), 20px message bubbles, a 28px-radius pill composer.
- **Kept as they were:** document, spreadsheet and slide canvases, floating menus and dialogs (they already carry a shadow), fields inside forms, and anything whose behaviour depends on a border (focus rings, drag targets).
- **Dark theme** also has a glass treatment (`--pencil-glass-*` tokens and a block titled "Dark-mode glass and restrained neomorphism"). The light palette stays flat and soft.

Because many older rules pin border, radius or shadow with `!important`, the soft block has a second group of `!important` overrides for exactly those surfaces. When a new card does not soften, look for an `!important` in its original rule before anything else. A selector list that contains one malformed selector is dropped whole by the browser, so validate generated selector lists. Do not put cards inside cards.

## 7. Components and primitives

Shared primitives in `src/components/ui/`: `alert`, `avatar-group`, `badge`, `button`, `calendar`, `card`, `circular-progress`, `collapsible-section`, `dialog`, `drawer`, `dropdown-menu`, `page-header`, `popover`, `search-input`, `select`, `separator`, `skeleton`, `tabs`, `tooltip`. App-level building blocks are in `src/components/workspace-ui.jsx` (check its exports before use; UNVERIFIED which names are current). Use a primitive when one exists and build new pieces in the feature's own folder, not in `ui/`, unless the whole app should adopt them.

- **Button:** the `Button` primitive wraps Flowbite React's button, themed in `src/lib/flowbite-theme.js` from the app tokens. Variants: `default` (navy), `secondary`, `outline`, `ghost`, `destructive`, `gold` (the bronze brand action, use rarely), `link`. Sizes: default and `page` are 42px tall with a 14px/500 label; `sm` 36px; `lg` 48px; `icon` 42px circle; `icon-sm` 36px circle. Focus shows a 3px info ring. Every icon-only control needs an accessible label.
- **Card:** `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`, `CardProgress`. The soft-surface block restyles `[data-slot='card']`.
- **Badge:** variants `default`, `secondary`, `info`, `accent`, `outline`, `destructive`; a small pill (`text-[10px]`, bold).
- **Tabs:** the pill segmented control; the active tab is navy with white text. Use real tab semantics only for tab panels; otherwise use toggle buttons with `aria-pressed`.
- **Forms:** fields have a global soft style (a transparent border and a light fill). A field that carries its own surface puts it on a wrapper and opts the inner input out (see the single-surface search pattern and the existing opt-out lists in `pencil.css`). Primary touch targets are at least 44px. Use the app select, not a native select, for in-row status controls.
- **Dialogs, drawers, popovers:** the Radix-based primitives. They carry their own shadow and float above the header, sidebar and popovers. Drawers are for record detail where context stays visible.
- **Alerts and empty states:** the alert ramp in section 2; skeletons while loading; empty states explain the next useful action without marketing copy.
- **Status, priority, progress:** semantic colour plus text, never colour alone. Presence dots use a solid colour with a surface-coloured ring drawn as a single shadow.
- **Tables and activity:** compact uppercase headers, sticky where the data is long; activity uses a vertical timeline on a neutral rail.

## 8. Page patterns

- **Page header** (`PageHeader`, `src/components/ui/page-header.jsx`): an optional overline eyebrow (11/600, tracked, brand navy), the title (30/700/36), and an optional one-line support sentence (14, muted). The primary action sits at the right as a 42px control. The header's closing hairline is hidden by the soft-surface pass. Below 640px the action drops beneath the text.
- **Today:** the navy hero card with the greeting, actions and a progress ring (hidden on phones), then metric tiles and panels.
- **Planner:** a horizontal board of 304px lanes inside its own scroll strip, with a Timeline (Gantt) view that has time ranges, milestones, task links and filters (`TimelineView.jsx`). The page never scrolls sideways; the board does.
- **My tasks, Team, Check-ins, Reports, Calendar, Files, Projects, Settings:** each has its own class family (section 9). The Team page uses gauges and rings, a needs-attention card, and a people list with a side panel for one person's day.
- **Zuri (the web assistant):** a docked chat window and a full page; the model and provider are deliberately not shown to users.
- **Dense working views:** give the working surface most of the viewport, keep toolbars predictable and rows scannable, keep side panels collapsible, and scroll tables inside their own container.

## 9. Surface class families

Match the existing prefix before inventing a class, and extend the surface's own rules in `pencil.css`. Prefixes verified in the stylesheet: `pencil-activity-view`, `pencil-checkins-view`, `pencil-reports-view`, `pencil-team-*`, `pencil-followup-*`, `my-task-*`, `planner-*`, `personal-planner-*`, `project-*` and `projects-view`, `settings-*`, `chat-workspace-view` and `chat-*`, `files-*`, `help-*`, `import-*`, `document-*`, `screen-share-*` and `screen-sharing-*`, `ai-*` (Zuri), `shell-*` (header and app bar), `sidebar-*`, `workspace-popup-*`, `branded-status-*`. A complete table of every class family is not maintained here; search `pencil.css` for the prefix.

## 10. CSS authoring rules

1. Edit `src/pencil.css`. Do not create a second stylesheet.
2. Search for an existing selector before adding one. Check both the light rule and the dark-theme rule (`:root[data-theme='dark']`, `.dark`) for a selector before styling it, and remove a duplicate rather than layering on top.
3. Use tokens and primitives before raw colours. Do not add new raw hex values.
4. `pencil.css` is mostly unlayered and uses `!important` heavily. An unlayered rule beats any Tailwind utility regardless of specificity, and an `!important` beats everything. So a `bg-*` class on an element may be ignored. When styling does not apply, look for an unlayered or `!important` rule first.
5. Put any new global element fallback in `@layer base`, not unlayered.
6. **tailwind-merge:** `cn()` uses `tailwind-merge` extended in `src/lib/utils.js`. It only knows Tailwind's stock font sizes, so every custom `text-*` name (the type scale above) must be listed in that file's `font-size` group in the same commit that declares the token. Otherwise `text-overline text-primary` is read as two colours and the size is silently dropped. Radius has the same issue: tailwind-merge does not recognise `rounded-control` or `rounded-badge` as border radii, so it will not arbitrate them against `rounded-full`.
7. A field painted by a wrapper must opt its inner input out of the global field rule, and also clear the focus ring so it draws around the wrapper, not the bare input.
8. Verify light and dark themes and the phone layout for any shared change.

## 11. Responsive behaviour

- The shell switches at `lg` (1024px): below it the rail is a drawer with a floating tab bar; at and above it the rail is fixed. Many pages also have 640px, 760px and 900px adjustments.
- Use fluid grids (`minmax()`), not fixed card widths. Collapse two-column working layouts to one around 900px, stack toolbars at tablet width, and keep filter groups internally scrollable.
- On phones: headings stack, primary actions stay visible, metric tiles are two per row, text fields are 16px or larger, and fixed bottom UI uses the safe-area inset.
- Check 1440, 1200, 1024, 900, 768, 640, 480 and 390px widths when changing a shared layout.

## 12. Accessibility

- Semantic HTML before ARIA. Visible keyboard focus on every interactive control.
- Status and tone are never conveyed by colour alone.
- Keep touch targets at least 44px for primary actions.
- Respect `prefers-reduced-motion` for nonessential motion.
- No hover-only actions. Avoid text overlapping controls at any supported width.
- Preserve contrast in both themes (check text on the soft fills and on the navy rail).

## 13. Dates and numbers

Show dates as `DD-MM-YY` (`13-09-26`) and date plus time with a 24-hour clock (`13-09-26 14:05`). Keep ISO values (`YYYY-MM-DD`) in API payloads, keys and `datetime` attributes, and format only the value the reader sees, using the helpers in `src/lib/workspace-format.js` on the frontend and `display_date()` in `tasks/views.py` on the server. Applies to every surface including new ones.

## 14. Mockups

Build a mockup as a React page that uses the shared primitives and the tokens above. Do not give a mockup its own stylesheet or token set. An earlier standalone mockup page with a conflicting palette was deleted for exactly this reason. Do not reintroduce a parallel design vocabulary. Current mockup entry points: `mockup.html` (soft-surface proposal, `src/mockups/`) and `copilot-mockup.html` (ZuriCopilot, `src/mockups/copilot/`). Mockups are served only by the Vite dev server and are not part of the production build (the build input is `index.html`).

## 15. ZuriCopilot (desktop app) design rules

ZuriCopilot is a separate desktop-only product that sits beside the web app. It must look like the same product. The full plan is in `docs/zuricopilot-plan.md`; these are the visual rules.

- Use the same tokens, Inter, the type scale, the `ui/` primitives and the soft-surface treatment. Import them read-only; never edit `src/components/ui/*` or `src/pencil.css` for the Copilot.
- The Copilot's sidebar uses the same navy rail language as the web shell (navy surface, pill items, white active pill). The desktop shell adds a thin rail on the far left that switches between **Workspace** (the web app, unchanged), **ZuriCopilot** and a **Dock** toggle for a 360px Copilot panel beside the web app, and a custom title bar in `--pencil-navy-dark`.
- Always show which model produced an answer and whether it ran on this device (Local) or in the cloud (Cloud). Show cited sources (document and page) under answers. Show a "Local-only" indicator on businesses where cloud use is off.
- Anything that sends, creates for others or leaves the app is a proposal card with Approve, Edit and Reject. Never auto-act.
- Workload views show capacity with text labels as well as colour (navy within capacity, the warning token over capacity). The permanent notice that the Copilot analyses workspace activity, not individual performance, must stay visible on team views.
- Dates follow section 13 (`DD-MM-YY`).
- The mockup in `src/mockups/copilot/` is a proposal and still contains some dates in a long form (for example "Fri 20 Nov"). Follow this document, not the mockup, for date text.

## 16. Change rules

1. Edit `src/pencil.css`, not a retired stylesheet.
2. Change a token where it is declared (the `--pencil-*` values, then the `@theme` mapping). Do not hard-code a value that a token already provides.
3. Use tokens and shared primitives before raw colours or one-off classes.
4. Check light and dark for any selector you touch.
5. Build mockups as React pages on these primitives and tokens (section 14).
6. Run the production build and the focused component tests after changing shared layout or component styles (`npx vitest run --maxWorkers=2`; a few tests time out at full parallelism).
7. Update this document in the same change when the look changes, and bump the "Last updated" line.

## 17. Known gaps in this document

- Not verified page by page. Newer pages (Planner Timeline, the Team page redesign, Daily operations timeline) are described only at the level of their patterns.
- `src/settings.css` and `src/chat-mobile.css` import locations, and the exact exports of `src/components/workspace-ui.jsx`, were not re-checked.
- The class-family list in section 9 is a list of prefixes, not a complete table.
- The dark theme's glass treatment is summarised, not specified.
