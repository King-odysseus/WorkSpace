# Accessibility and responsive review

Scope: the React/Vite frontend under `src/` (shell in `src/main.jsx`, planner
in `src/components/PlannerBoard.jsx`, shared UI in `src/components/ui/`, and
theme tokens in `src/pencil.css`, `src/settings.css`, and `src/chat-mobile.css`).
Items marked "verify" still need a manual screen-reader, axe-core, or
Lighthouse pass and are not asserted as defects.

## Passes (verified in source)

| Area | Evidence |
| --- | --- |
| Skip link | `skip-link` anchor -> `#main-content`; `<main id="main-content" tabIndex="-1">` (main.jsx:666, 982) |
| Visible focus | global `:focus-visible` outline (`pencil.css`), plus per-control focus styles |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` collapses transitions/animations (line 970) |
| Dialogs | `role="dialog" aria-modal="true" aria-labelledby` on the quick-capture modal, plus Escape close, Tab containment, and focus return (main.jsx:390-420) |
| Live regions | errors use `role="alert"`, loading uses `role="status"` (main.jsx:985-986, 992) |
| Icon-only buttons | aria-labels on drag/archive/move/pagination/close buttons (PlannerBoard.jsx:34-51, 188) |
| Current page | `aria-current="page"` on active nav items (main.jsx:720, 758) |
| Toggle state | `aria-pressed` on sidebar/notification/theme switches (main.jsx:784, 906, 1103-1104) |
| Decorative images | empty `alt=""` on avatars/icons; logos carry `alt="TijhaBooks"` (main.jsx:35, 691, 931) |
| Keyboard drag fallback | planner cards expose Move up/down/left/right controls, project lanes expose left/right controls, and board moves announce completion through polite live regions. |
| Semantic structure | `<table>` for planner table view, `<nav aria-label>` for settings/legal sections |
| File uploads | Chat attachment, profile photo, and workspace logo inputs carry names on the file control itself; a live audit across 23 routes reports no unnamed interactive controls. |
| Route containment | Automated Playwright audit across 23 top-level routes, 8 Settings panels, and 8 project tabs at 320, 390, 768, 1024, and 1440 widths reports 190 checks and 0 width, crash, page-error, or uncontained-overflow failures. |
| Named visible controls | Automated visible-control audit across 23 routes reports 0 unnamed inputs, textareas, selects, or buttons. |
| Native control theming | `color-scheme: light` and `color-scheme: dark` are declared with their matching theme tokens (pencil.css:89-96). |

## Responsive coverage (verified)

| Breakpoint | Behavior |
| --- | --- |
| <= 1050px | shell layout adjustments |
| <= 980px | planner command-bar filters wrap |
| <= 900px | planner board becomes a fixed-width column scroller |
| <= 850px | calendar/chat two-pane collapses to single column |
| <= 800px | report/project grids collapse to 2-col, then 1-col at 520px |
| <= 750px | sidebar hides and a `mobile-pill-nav` bottom bar appears (line 777); planner board uses horizontal scroll-snap (line 1623) |
| <= 700px | settings/team/help/legal collapse to single column |
| <= 620px | planner filters go 2-per-row |
| <= 520px | single-column metric/report grids, stacked controls |

Dark/light theming is driven by `data-theme` and CSS custom properties, so
responsive and color changes share one token source.

## Gaps and recommendations

| Severity | Finding | Recommendation |
| --- | --- | --- |
| verify | Color contrast for `mobile-pill-nav` text `#B9CCDD` on `#0B223AEE`, and priority/scope badge colors, is not computed here. | Run axe-core / Lighthouse contrast checks; adjust tokens if below 4.5:1 (normal text). |
| verify | Drag-and-drop only works by pointer; keyboard users rely on the Move controls. | Keep regression coverage for board move announcements and lane counts; run a screen-reader pass on the desktop and 390px layouts. |
| verify | No implemented Gantt view was found in the current source; only a help-reference string remains. | If a Gantt view is added later, expose it as a labelled region with explicit column/date headers. |
