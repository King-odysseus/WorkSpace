# Accessibility and responsive review

Scope: the React/Vite frontend under `src/` (shell in `src/main.jsx`, planner
in `src/components/PlannerBoard.jsx`, shared UI in `src/components/ui/`, theme
tokens in `src/tijhabooks-theme.css`). This is a static review; items marked
"verify" need an automated audit (e.g. axe-core / Lighthouse) or a manual
screen-reader pass to confirm, and are not asserted as defects.

## Passes (verified in source)

| Area | Evidence |
| --- | --- |
| Skip link | `skip-link` anchor → `#main-content`; `<main id="main-content" tabIndex="-1">` (main.jsx:666, 982) |
| Visible focus | global `:focus-visible` outline (tijhabooks-theme.css:946), plus per-control focus styles |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` collapses transitions/animations (line 970) |
| Dialogs | `role="dialog" aria-modal="true" aria-labelledby` on the quick-capture modal (main.jsx:992) |
| Live regions | errors use `role="alert"`, loading uses `role="status"` (main.jsx:985–986, 992) |
| Icon-only buttons | aria-labels on drag/archive/move/pagination/close buttons (PlannerBoard.jsx:34–51, 188) |
| Current page | `aria-current="page"` on active nav items (main.jsx:720, 758) |
| Toggle state | `aria-pressed` on sidebar/notification/theme switches (main.jsx:784, 906, 1103–1104) |
| Decorative images | empty `alt=""` on avatars/icons; logos carry `alt="TijhaBooks"` (main.jsx:35, 691, 931) |
| Keyboard drag fallback | planner cards expose Move up/down/left/right buttons (PlannerBoard.jsx:47–51) |
| Semantic structure | `<table>` for planner table view, `<nav aria-label>` for settings/legal sections |

## Responsive coverage (verified)

| Breakpoint | Behavior |
| --- | --- |
| ≤ 1050px | shell layout adjustments |
| ≤ 980px | planner command-bar filters wrap |
| ≤ 900px | planner board becomes a fixed-width column scroller |
| ≤ 850px | calendar/chat two-pane collapses to single column |
| ≤ 800px | report/project grids collapse to 2-col, then 1-col at 520px |
| ≤ 750px | sidebar hides and a `mobile-pill-nav` bottom bar appears (line 777); planner board uses horizontal scroll-snap (line 1623) |
| ≤ 700px | settings/team/help/legal collapse to single column |
| ≤ 620px | planner filters go 2-per-row |
| ≤ 520px | single-column metric/report grids, stacked controls |

Dark/light theming is driven by `data-theme` and CSS custom properties, so
responsive and color changes share one token source.

## Gaps and recommendations

| Severity | Finding | Recommendation |
| --- | --- | --- |
| minor | Planner search input relies on a wrapping `<label>` with only an icon and no text (PlannerBoard.jsx:195); its accessible name may be empty. | Add `aria-label="Search tasks"` to the input. |
| minor | Planner view toggle uses `role="group"` but buttons signal state only via `.active` class, not `aria-pressed`/`aria-checked` (PlannerBoard.jsx:194). | Use `role="radiogroup"` with `role="radio"` + `aria-checked`, mirroring the theme switcher pattern. |
| minor | Quick-capture modal has no focus trap, Escape-to-close, or focus return to the trigger. | Add a focus trap and `onKeyDown` Escape handling; restore focus on close. |
| verify | Color contrast for `mobile-pill-nav` text `#B9CCDD` on `#0B223AEE`, and priority/scope badge colors, is not computed here. | Run axe-core / Lighthouse contrast checks; adjust tokens if below 4.5:1 (normal text). |
| verify | Dark theme should set `color-scheme` so native controls (date/select scrollbars) render correctly. | Confirm `color-scheme: light dark` (or per-theme) is declared; add if missing. |
| verify | Drag-and-drop only works by pointer; keyboard users rely on the Move buttons, which is acceptable but confirm each move is announced to screen readers. | Add `aria-live="polite"` to the bulk-action bar / column counts if not present. |
| verify | Gantt and board views have no obvious table/region semantics for screen readers. | Confirm Gantt content exposes a labelled region (`aria-label`) and column headers. |
