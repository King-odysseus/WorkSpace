# WorkSpace Design System

Last updated: 19 September 2026

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

#### Tailwind Layers And Global Element Rules

Tailwind puts all of its utilities in `@layer utilities`. Almost everything in
`workspace.css` is unlayered, and an unlayered rule beats a layered one no
matter how low its specificity is. A bare element or `:where()` rule written
here therefore outranks every Tailwind utility on the same element, and no
amount of class or specificity on the element can win against it.

Two rules were doing that, and both now sit in `@layer base`:

- `button { border-radius: 999px }` is the pill fallback. Its comment claimed it
  "loses to every class rule above it", which was false while it was unlayered.
  In `@layer base` it still beats preflight and now genuinely loses to
  `.rounded-*`, which is what the comment always said.
- `:where(button, input, textarea) { font: inherit }` duplicated the same
  normalisation that already ships in preflight. Unlayered, it reset `font-size`
  on every button and input, so no `text-*` utility could size a control.
- `h1`-`h6 { font-family: 'Montserrat' !important; letter-spacing: 0 !important }`
  was the third, and the one that proves layers alone are not enough. An
  `!important` declaration outranks every utility whichever layer it sits in, so
  moving this rule into `@layer base` would not have helped. The
  `letter-spacing: 0` was flattening the tracking each heading size declares.
  Both declarations are now plain, in `@layer base`.

Put any new global element fallback in `@layer base` for the same reason. When
one existing primitive still loses to an unlayered rule, scope an opt-out to its
attribute (`[data-slot='search-input'] input { ... }`) instead of escalating
with `!important`; `!important` on a `:where()` selector will beat class
utilities, which is worse than the problem it solves.

The soft-field rule is the fourth, and it is the widest:

```css
:where(input:not([type='checkbox']):not([type='radio']):not([type='file']),
       textarea, select) {
  border-color: transparent !important;
  background-color: #f2f4f7 !important;
}
```

It repaints every field in the app, so any `bg-*` or `border-*` class on an
`<input>` is decoration. A field that carries its own surface must put it on a
**wrapper** and register the inner input in the `.shell-search`-style opt-out
list below the rule, which already existed for `.top-search`, `.planner-search`
and `.ai-chat-input`. The shell's top-bar search does exactly this. Note also
that the rule's `:focus` sibling adds a 3px `box-shadow`, so the opt-out has to
clear the ring as well as the fill, or the ring draws around the bare input
inside its wrapper instead of around the wrapper.
#### tailwind-merge And Custom Type-Scale Names

`cn()` runs `tailwind-merge`, which reads a `text-*` class as either a font size
or a text colour. It knows only the font sizes Tailwind ships with, so every
name this project added to the type scale reached `cn()` classified as a colour.
The failure is silent and does not look like a class-name problem: given
`text-overline text-primary`, tailwind-merge saw two competing colours, kept the
last, and deleted the font size. Nothing errored and nothing logged; the element
simply inherited its parent's size and padding looked inexplicably wrong.

`src/lib/utils.js` now declares the scale's names in the `font-size` group via
`extendTailwindMerge`. A new `--text-*` name must be added to that list in the
same commit that declares the token, or it will be dropped the first time it
shares an element with a colour.

Radius has the same shape of problem. tailwind-merge does not recognise
`rounded-control` or `rounded-badge` as `border-radius` values, so it never sees
them conflict with `rounded-full` and cannot be trusted to arbitrate. This is
why `buttonVariants` keeps one radius per size variant instead of a
`rounded-full` base that a size has to out-merge.

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

`workspace.css` stacks six token families. Before adding or changing a colour,
identify which family owns it.

| Family | Declared in | Owns | Dark remap |
| --- | --- | --- | --- |
| Foundation (`--brand-*`, `--neutral-*`, `--semantic-*`, `--chart-*`, `--status-*`, `--priority-*`) | The `:root` block immediately before the `--sc-*` light set | The values themselves. Both layers below alias into it, so this is the only place a colour is defined. | Yes, `html[data-theme='dark']` directly after the `--sc-*` dark set |
| `--sc-*` | `:root` and `html[data-theme='dark']` just before the `Workspace utility tokens` layer | Every `src/components/ui/` primitive, through the `@theme inline` block | Yes, a full second `:root` set |
| `--color-*` | The `@theme` block in `Workspace utility tokens` | The WorkSpace Tailwind class names (`bg-navy`, `text-accent`, `bg-surface`, `text-text-primary`, and the rest) | Yes, `html[data-theme='dark']` immediately after the block |
| Legacy aliases | The `:root` block near line 191 | Older rules still in the legacy base layer | Mostly, because most of them alias `--color-*` |
| shadcn-name aliases | The `:root` block after the dark remap, around line 4506 | Late-written surfaces (screen share, import, chat, AI provider) that were authored against short shadcn names | Yes, because they alias `--color-*` |
| Page-local aliases | `.workspace-view, .today-dashboard` | The dashboard and workspace layers | Yes, a second selector block for dark |

Two traps live in this stack:

- The `@theme inline` block declares shadcn names that share the `--color-*`
  prefix with the utility tokens (`--color-background`, `--color-card`,
  `--color-primary`, `--color-border`, `--color-accent`, and so on). They map to
  `--sc-*` and are a different set from the utility tokens. `--color-background`,
  `--color-accent` and `--color-border` are owned there, and the utility
  `@theme` block deliberately does not restate them, so each name has exactly
  one owner. Add a new token to the utility block, but extend one of these three
  in the `@theme inline` block instead.
- `--workspace-*` and `--dashboard-*` are the same values under two names. The
  `.workspace-view` block defines `--dashboard-*` and then mirrors them into
  `--workspace-*`; older components read the mirror.

### Foundation Layer

The values live here and nowhere else. To change what the product looks like,
change one of these; do not restate the value in `--sc-*` or `--color-*`, and
never paste a hex into a component.

| Token | Light | Dark |
| --- | --- | --- |
| `--brand-navy` | `#0B0B45` | `#0B0B45` (not remapped) |
| `--brand-navy-hover` | `#101065` | `#1E1E4C` |
| `--brand-navy-dark` | `#080831` | `#080820` |
| `--brand-navy-active` | `#090939` | `#12123A` |
| `--brand-navy-tint` | `#EAEAF6` | `#1E1E4C` |
| `--brand-navy-focus` | `#2E2EB8` | `#2E2EB8` |
| `--brand-navy-disabled` | `#A9A9C6` | `#4A4A72` |
| `--brand-bronze` | `#C49A6C` | `#C49A6C` |
| `--brand-bronze-hover` | `#7C5831` | `#7C5831` |
| `--brand-bronze-soft` | `#F1E6DA` | `#F1E6DA` |
| `--brand-bronze-text` | `#593E22` | `#593E22` |
| `--neutral-background` | `#F9FAFB` | `#0C0C28` |
| `--neutral-surface` | `#FFFFFF` | `#15153A` |
| `--neutral-surface-hover` | `#F3F4F6` | `#20204A` |
| `--neutral-border` | `#E5E7EB` | `#2A2A5C` |
| `--neutral-border-strong` | `#D1D5DC` | `#3A3A6E` |
| `--neutral-border-light` | `#F0F1F3` | `#20204A` |
| `--neutral-text-primary` | `#101828` | `#ECECF7` |
| `--neutral-text-secondary` | `#4A5565` | `#C2C2DC` |
| `--neutral-text-muted` | `#6A7282` | `#8C8CAE` |
| `--semantic-success` | `#007A55` | `#4ADE80` |
| `--semantic-warning` | `#FF6900` | `#FF6900` |
| `--semantic-warning-text` | `#B45309` | `#FBBF24` |
| `--semantic-error` | `#C70036` | `#FB7185` |
| `--semantic-info` | `#2563EB` | `#93C5FD` |

The status and priority pairs (`--status-*-fg` / `--status-*-bg`,
`--priority-*-fg` / `--priority-*-bg`) and the `--chart-*` sequence follow the
same pattern. Always render a pair together, and always with the status word
next to it.

Two entries carry a deliberate second name because one value does not serve
both roles. `--semantic-warning` is the design's orange, which measures about
2.6:1 on white and is only safe as a fill on `--semantic-warning-bg`;
`--semantic-warning-text` is the darker amber used for text, icons and accents.
`--neutral-border-light` exists because the design lists only `border` and
`border-strong`, while the app already drew quieter in-card dividers.

Brand values are fixed by the design source, which marks its own navy
(`#0E2A47`) and bronze (`#B7791F`) as provisional. WorkSpace ships `#0B0B45`
and `#C49A6C`, so the navy and bronze ramps are derived on those hues using the
design's lightness ladder rather than copied from its different hues.

The design source specifies no dark theme. The dark column above is derived
against the existing navy-black surfaces: neutrals lift as they come forward,
and the semantic foregrounds lighten because the light values fall under 4.5:1
on a dark surface. `--brand-navy` is intentionally not remapped, because the
dark `@theme` block already repoints `--color-navy` at the page background and
`--sc-primary` at a blue; overriding the brand token itself would drag the dark
primary buttons with it.

### Primitives Layer (`--sc-*`)

This is the layer to edit when a `Button`, `Dialog`, `Select`, `Card`, `Badge`,
`Tabs`, `Popover`, `DropdownMenu`, `Separator`, `Alert`, `Calendar`, or
`Skeleton` primitive needs new colours, because `@theme inline` resolves each
`--color-*` utility to the matching `--sc-*` value. Every entry now aliases a
foundation token, so the table shows the resolved light value rather than an
independent one.

| Token | Resolves to |
| --- | --- |
| `--sc-background` | `--neutral-background` (`#F9FAFB`) |
| `--sc-foreground` | `--neutral-text-primary` (`#101828`) |
| `--sc-card` | `--neutral-surface` (`#FFFFFF`) |
| `--sc-card-foreground` | `--neutral-text-primary` |
| `--sc-popover` | `--neutral-surface` |
| `--sc-popover-foreground` | `--neutral-text-primary` |
| `--sc-primary` | `--brand-navy` (`#0B0B45`) |
| `--sc-primary-foreground` | `--brand-navy-foreground` |
| `--sc-secondary` | `--neutral-surface-hover` (`#F3F4F6`) |
| `--sc-secondary-foreground` | `--neutral-text-primary` |
| `--sc-muted` | `--neutral-surface-hover` |
| `--sc-muted-foreground` | `--neutral-text-muted` (`#6A7282`) |
| `--sc-accent` | `--brand-bronze` (`#C49A6C`) |
| `--sc-accent-foreground` | `--brand-navy` (`#0B0B45`, 7.1:1 on bronze) |
| `--sc-destructive` | `--semantic-error` (`#C70036`) |
| `--sc-destructive-foreground` | `#FFFFFF` |
| `--sc-border` | `--neutral-border` (`#E5E7EB`) |
| `--sc-input` | `--neutral-border` |
| `--sc-ring` | `--brand-navy-focus` (`#2E2EB8`) |
| `--sc-radius` | `0.75rem` |

Dark remaps `--sc-background`, `--sc-primary`, `--sc-secondary`, `--sc-muted`,
`--sc-muted-foreground`, `--sc-destructive`, `--sc-border`, `--sc-input` and
`--sc-ring` directly. The rest follow their foundation token into the dark set.

`--radius-sm`, `--radius-md`, `--radius-lg`, and `--radius-xl` derive from
`--sc-radius`.

### Utility Tokens (`--color-*`)

These drive the WorkSpace Tailwind class names and are the right choice for new
app CSS.

#### Brand And Surfaces

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--color-navy` | `#0B0B45` | `#0c0c28` | App shell and strong brand surface |
| `--color-navy-hover` | `#101065` | `#1E1E4C` | Navy hover |
| `--color-navy-active` | `#090939` | `#12123A` | Navy pressed |
| `--color-navy-dark` | `#080831` | `#080820` | Recessed navy |
| `--color-navy-tint` | `#EAEAF6` | `#1E1E4C` | Faint navy wash |
| `--color-navy-focus` | `#2E2EB8` | `#2E2EB8` | Navy focus ring |
| `--color-navy-disabled` | `#A9A9C6` | `#4A4A72` | Disabled navy control |
| `--color-navy-soft` | `#101065` | `#1E1E4C` | Legacy name for navy hover |
| `--color-navy-light` | `#080831` | `#080820` | Legacy name for recessed navy |
| `--color-text-on-navy` | `#FFFFFF` | `#FFFFFF` | Text on navy |
| `--color-accent` | `#C49A6C` | `#C49A6C` | Gold brand accent, used sparingly |
| `--color-accent-hover` | `#7C5831` | `#7C5831` | Gold hover |
| `--color-accent-soft` | `#F1E6DA` | `#F1E6DA` | Soft gold background |
| `--color-surface` | `#FFFFFF` | `#15153a` | Primary card and panel surface |
| `--color-surface-secondary` | `#F3F4F6` | `#0c0c28` | Secondary and recessed surface |
| `--color-surface-hover` | `#F3F4F6` | `#20204A` | Row and menu hover surface |
| `--color-surface-elevated` | `#FFFFFF` | `#1e1e4c` | Raised menus and popovers |
| `--color-text-primary` | `#101828` | `#ECECF7` | Primary text |
| `--color-text-secondary` | `#4A5565` | `#C2C2DC` | Supporting text |
| `--color-text-muted` | `#6A7282` | `#8C8CAE` | Metadata and quiet labels |
| `--color-border` | `#E5E7EB` | `#2a2a5c` | Standard border |
| `--color-border-strong` | `#D1D5DC` | `#3A3A6E` | Emphasis border, selected field |
| `--color-border-light` | `#F0F1F3` | `#20204a` | Subtle divider |
| `--color-selected` | `#E7EEF6` | `#23234F` | Fill behind the active navigation item |

#### Alert Ramp

The `--alert-*` tokens are the C1 alert ramp, not a restatement of the
`--semantic-*` pairs above them. Values and the reason for the split are in
Alerts, Skeletons, And Empty States.

| Tone | Fill | Stroke | Text |
| --- | --- | --- | --- |
| `--alert-info-*` | `#EFF6FF` / `#131C3A` | `#DBEAFE` / `#21356B` | `#1C398E` / `#93C5FD` |
| `--alert-success-*` | `#ECFDF5` / `#0F2A22` | `#A4F4CF` / `#1B5140` | `#006045` / `#4ADE80` |
| `--alert-warning-*` | `#FEF9C3` / `#2E2711` | `#FDE68A` / `#5C4A18` | `#854D0E` / `#FBBF24` |
| `--alert-danger-*` | `#FFF1F2` / `#2E1620` | `#FFCCD3` / `#5C2436` | `#A50036` / `#FB7185` |

Light value first, then the dark derivation.

#### Status And Priority

Each status and priority ships a fixed foreground and background pair. Use
`text-status-<name>` on `bg-status-<name>-bg`, render the pair with its status
word, and add the icon for Done, Blocked and Review. Never reuse `--color-navy`
as a status, and never swap on-hold yellow for review orange.

| Pair | Light fg / bg | Dark fg / bg |
| --- | --- | --- |
| `--color-status-todo` | `#4A5565` / `#F3F4F6` | `#C2C2DC` / `#26263F` |
| `--color-status-progress` | `#1C398E` / `#DBEAFE` | `#93C5FD` / `#182A4D` |
| `--color-status-review` | `#7E2A0C` / `#FFF7ED` | `#FDBA74` / `#3A2415` |
| `--color-status-blocked` | `#A50036` / `#FFF1F2` | `#FDA4AF` / `#3D1620` |
| `--color-status-hold` | `#854D0E` / `#FEF9C3` | `#FDE68A` / `#3A3413` |
| `--color-status-cancelled` | `#6A7282` / `#F3F4F6` | `#8C8CAE` / `#23233F` |
| `--color-status-done` | `#006045` / `#ECFDF5` | `#6EE7B7` / `#0E3830` |

The four priority pairs reuse the same foreground and background values under
`--color-priority-low`, `-medium`, `-high` and `-urgent`.

#### Data Visualisation

`--color-chart-series-1` through `-series-3` are an ordered sequence, with
`--color-chart-comparison`, `--color-chart-completed`, `--color-chart-in-progress`
and `--color-chart-delayed` for the fixed-meaning series. Never signal a value
with colour alone; every series needs a label or a legend.

#### Semantic Colours

| Token | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `--color-info` | `#2563EB` | `#93C5FD` | Primary action, focus, links, selection |
| `--color-info-hover` | `#1D4ED8` | `#1D4ED8` | Info hover |
| `--color-info-soft` | `#EAEAF6` | `#132C52` | Informational background |
| `--color-success` | `#007A55` | `#4ADE80` | Complete, active, healthy |
| `--color-success-soft` | `#ECFDF5` | `#153A31` | Successful background |
| `--color-warning` | `#B45309` | `#FBBF24` | Due soon and warning states, as text |
| `--color-warning-fill` | `#FF6900` | `#FF6900` | Warning as a fill on `--color-warning-soft` |
| `--color-warning-soft` | `#FFF7ED` | `#3D2A12` | Warning background |
| `--color-danger` | `#C70036` | `#FB7185` | Destructive and blocked states |
| `--color-danger-soft` | `#FFF1F2` | `#3D1C23` | Destructive background |
| `--color-danger-bg` | `#FFF1F2` | `#3A1A1A` | Destructive page background |
| `--shadow-elevated` | `0 12px 40px -12px rgb(0 0 0 / 0.18)` | `0 12px 40px -12px rgb(0 0 0 / 0.6)` | Raised surface shadow |
| `--shadow-card` | `0 1 2 0 rgb(0 0 0 / 0.03)` | `0 1 2 0 rgb(0 0 0 / 0.03)` | The only shadow allowed on a surface |

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

> Migration note. The design system now ships a full type, spacing and radius
> scale in the foundation layer (`--font-*`, `--text-*`, `--spacing-*`,
> `--radius-*`, all declared `@theme static` so they survive Tailwind's
> tree-shaking). The sections
> below still describe what the app actually renders, because the legacy rules
> hardcode the older values and no view has been migrated yet. Expect the two to
> disagree until the page-by-page migration finishes. The scale is also a real
> size change, not a rename: the design's body is `16px` against the app's
> current `12px` to `13px`, and its page heading is `30px` against `22px`.

- UI text: `Roboto`, with weights `400`, `500`, `600`, `700`, and `800`.
- Headings and metrics: `Montserrat`, with weights `400`, `600`, `700`, and `800`.
- These two are the WorkSpace families, settled. The design document leaves the
  family as an alias slot and sketches `Inter` and `JetBrains Mono` in it; those
  are placeholders and are not adopted. The foundation layer declares the real
  pair as `--font-display` (`Montserrat`) and `--font-sans` (`Roboto`), with
  `--font-mono` for the spreadsheet and code surfaces. Use the `font-display`
  and `font-sans` utilities in migrated views instead of writing family names,
  so a future licensed font is a one-line change here. `--font-sans` is
  overridden globally and deliberately: Tailwind's stock value is `Inter`, which
  WorkSpace never loaded.
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

> Migration note. The design specifies a `4px` base unit with a named ladder
> (`--spacing-icon-gap` `4`, `chip-pad` `8`, `label-gap` `12`, `header-gap` `16`,
> `card-pad` `24`, `page-pad` `32`, `section` `48`, `hero` `64`) and a radius
> ladder (`--radius-chip` `4`, `badge` `6`, `icon` `8`, `control` `12`,
> `container` `16`, pill). The values below are still what renders today. One
> design rule to carry into the migration: inner radius is outer radius minus
> the inset, so a `12px` card with a `16px` inset takes an `8px` inner radius.

- Page sections use a `20px` gap through `.workspace-view`.
- Standard card padding is `18px` to `20px`.
- Compact row padding is generally `10px` to `14px`.
- Standard card radius is `18px` to `20px`.
- List rows and contained controls generally use `10px` to `14px` radius.
- Pills, avatars, status dots, and compact filters use fully rounded shapes.
- Standard card depth comes from `--dashboard-shadow`.
- Hover depth comes from `--dashboard-shadow-hover` and a small vertical lift.

Every `[data-slot='card']` is pinned to `var(--radius-control)` (`12px`), the
`--workspace-border` colour, and a `0 1px 2px` plus `0 12px 28px` shadow by a
rule in the dashboard layer. Changing card depth means editing that rule, not an
individual card. Two separate sections pin the same slot; both now read the
radius token, so the ladder keeps a single owner even though the rule is
duplicated. Collapsing them into one is worthwhile but not yet done.

The elevation tokens were declared without units on their offsets -
`--elevation-card: 0 1 2 0 rgb(...)`, `--elevation-modal: 0 12 40px -12px
rgb(...)`. A length without a unit is invalid, so every one of those
declarations was dropped, and `shadow-card` (every Card) and `shadow-elevated`
(five popovers and dropdowns) silently drew no shadow at all. They now carry
`px`, which is what makes the design's level 1 and level 3 shadows visible. If a
shadow utility ever looks like it is doing nothing, check the token for units
before checking the element.

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
  `data-tone` of `info`, `success`, `warning`, or `danger`. There is no
  `WorkspaceAlert` component; use the class, or `alert.jsx` for the primitive
  version.
- The alert carries a three-part ramp, taken from the C1 Feedback frame: a
  fill, a 1px stroke, and a text colour. Each tone is one block of `--alert-*`
  tokens, and the box reads all three through `--alert-fill`, `--alert-stroke`
  and `--alert-text`, so a new tone is three token lines plus a `data-tone`
  block. The values are:

  | Tone | Fill | Stroke | Text |
  | --- | --- | --- | --- |
  | info | `#EFF6FF` | `#DBEAFE` | `#1C398E` |
  | success | `#ECFDF5` | `#A4F4CF` | `#006045` |
  | warning | `#FEF9C3` | `#FDE68A` | `#854D0E` |
  | danger | `#FFF1F2` | `#FFCCD3` | `#A50036` |

  Note that this ramp is **not** the same as the `--semantic-*` pairs.
  Foundations 03 declares one flat pair per tone (`success` `#007A55` on
  `success-bg` `#ECFDF5`, `warning` `#FF6900` on `warning-bg` `#FFF7ED`,
  `error` `#C70036` on `error-bg` `#FFF1F2`, plus a lone `info-bg` `#E7EEF6`),
  and C1 disagrees with it on two of the four. Both layers are kept: the
  `--semantic-*` block stays a faithful copy of what foundations lists, and the
  alert ramp lives under its own `--alert-*` names. The status and priority
  pairs already used the C1 values, so the ramp is what the app was rendering;
  what was missing was names for its stroke and text parts. A tone is never
  signalled by colour alone, so the primitive keeps four distinct icons rather
  than C1's reuse of one flag glyph for both info and danger.
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

### App Shell

The shell is the sidebar plus the top bar, both in `src/main.jsx`. Values come
from the design's shell frame; the numbers below are what renders, measured
from computed style rather than read off the frame.

- The rail is `264px` expanded and `72px` collapsed, `bg-surface` with a `1px`
  `border-border` right edge. The collapsed width and the flyout behaviour are
  the two things kept from the previous shell: the collapsed state persists in
  `localStorage` under `workspace-sidebar-collapsed`, the edge pill toggles it,
  and the mobile drawer slides the same rail in over a scrim.
- The brand block stacks two rows: a `32px` logo tile with the product wordmark
  (`15/700`, `-0.2px` tracking), then the workspace switcher. They do not share a
  row - side by side the switcher lost half the rail and the workspace name was
  the only thing naming the product.
- The switcher is a `bg-background` control on the `--radius-control` corner
  with a `1px` border: the workspace name at `13/600` over a `10px` uppercase
  role overline at `1.6px` tracking, and a chevron. It opens the workspace menu.
- Group labels are `text-overline` (`11/600`, `1.6px` tracking, uppercase) in
  `text-text-muted`, one per group, with `24px` between groups and `4px`
  between items.
- A nav item is `34px` tall on an `8px` radius with a `20px` icon, a `12px`
  icon-to-label gap and `16px` side padding, so a row fills the rail's full
  `232px` inset. The open item takes `bg-selected` (`#E7EEF6` light) with a
  `600` label in `text-text-primary`; every other item is `text-text-secondary`
  at `400` and hovers to `bg-surface-secondary`.
- The open item also carries a `3x20` bar at its left edge in `bg-primary`.
  Navy in light, the theme's accent in dark, where brand navy would disappear
  into the selected fill. The bar is `aria-hidden`; `aria-current="page"` on the
  button is what actually announces the state, so the second marker is for
  sighted users who cannot separate the two greys.
- An unread badge is `24x18` on a `9px` radius, `bg-primary` with
  `text-primary-foreground` at `11/700`. The `danger` tone is the same shape in
  `bg-danger`.
- The top bar is `64px` of `bg-surface` with a `1px` bottom edge, and carries no
  page title: every view titles itself through `PageHeader`, so a second copy
  here only competed with it. Below `lg` it shows the app mark instead, because
  the sidebar is off-canvas at that width.
- The search field is `280x40` on a `10px` radius, `bg-background` with a `1px`
  border, a `20px` leading glyph and a `14px` placeholder. Its surface is on a
  wrapper, not the input - see the soft-field rule above.
- The utility cluster is `40px` icon buttons on the `8px` radius in
  `text-text-secondary`, and a `32px` avatar.

The design frames disagree on the rail's width: the foundations preview draws
`240px`, the shell frame draws `264px`. The shell frame wins, because it is the
one that lays out the nav items at their real `232px` inset.

### Page Header

- Every view opens with `PageHeader` (`src/components/ui/page-header.jsx`), which
  the app reaches through `WorkspaceViewHeading` in `workspace-ui.jsx`.
- Three stacked slots, left aligned: an uppercase overline eyebrow (11/600,
  1.6px tracking, brand navy), the page title (30/700/36, -0.4px tracking,
  Montserrat), and a one-line support sentence (14/400/20, muted). The eyebrow
  and the support line are optional; the title is not.
- The page's primary action sits at the right, bottom aligned with the support
  line, as a 42px control with a 12px radius and a 14px/500 label
  (`Button size="page"`). Secondary actions use the same height and a quieter
  variant, so the header still reads as one primary plus support.
- A hairline rule in the border colour closes the header. Pass `divider={false}`
  when the page draws its own separation.
- Below 640px the action drops beneath the text rather than squeezing the title.

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
