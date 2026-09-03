# Release-readiness report

Prepared by the reporting / automation / migration / quality workstream. Assessed
against the current `main` checkout, including the concurrent execution-foundation
work in `.claude/worktrees` whose migrations (`0029_execution_foundation`,
`0030_execution_indexes`, `0031_savedview_project_scope`) depend on this
workstream's `0028`.

## Verification results

| Check | Result |
| --- | --- |
| `python manage.py check` | ✅ no issues |
| `python manage.py test` | ✅ 104/104 passing (79 existing + 25 new quality tests) |
| New test module `tasks/test_quality.py` | ✅ covers calculations, drill-down replay, permission scoping, reminder dedup, integrity checks, and import preview/commit |

## Delivered in this workstream

1. **Shared reporting service** — `tasks/reporting.py`: workspace / operations /
   project scopes, delivery-based periods, full metric set, replayable drill-down
   filters, workload, progress groups, KPI zero-target protection, project health.
2. **Data-integrity checks** — `tasks/integrity.py`: seven checks with severity and
   drill-down filters.
3. **Scheduled automation** — `tasks/automation.py` + management command
   `run_automation`: due-soon, overdue, blocked, stale, and digest reminders,
   idempotent via `NotificationDelivery`.
4. **Excel migration** — `tasks/importer.py` + management command `import_excel`:
   preview-before-commit, authoritative General sheet, Lists configuration, owner
   sheets for enrichment only, user matching with invitations, exception reporting,
   transactional commit. `openpyxl` added to `requirements.txt`.
5. **Documentation** — `docs/reporting-service.md`,
   `docs/accessibility-responsive-review.md`, this report.

## Not yet released (blockers / follow-ups)

| Item | Why | Action owner |
| --- | --- | --- |
| `report_summary` period basis uses `created_at`, and its `completion_rate` denominator includes cancelled tasks | lives in `tasks/views.py`, owned by the concurrent execution work | switch to `apply_report_period` + `applicable` denominator |
| Endpoint wiring for `build_report`, `project_health`, `run_integrity_checks`, `run_workspace_automation`, and import preview/commit | new URLs/views touch contested `views.py`/`urls.py` | expose the recommended paths from `docs/reporting-service.md` §5 |
| `NOTIFICATION_KIND_PREFERENCE` lacks the five new automation kinds | in `tasks/views.py`; until added, those kinds deliver unconditionally (safe default) | add `due_soon_reminder`, `overdue_reminder`, `blocked_alert`, `stale_update_reminder`, `workspace_digest` |
| Excel column assumptions | exact General/Lists/owner-sheet headers must be confirmed against the real workbook | provide the workbook; adjust `DEFAULT_GENERAL_COLUMNS` / `column_map` |
| Accessibility follow-ups | focus trap, `aria-pressed` on view toggle, contrast audit | see `docs/accessibility-responsive-review.md` |

## Risk notes

- **Concurrent model changes.** The execution-foundation work is still active in
  `.claude/worktrees`; its migrations depend on `0028` and it owns `views.py`,
  `urls.py`, and `models.py`. Merging either side in isolation will break the
  other. Coordinate merge order and re-run `manage.py makemigrations --check`
  after integration.
- **No original workbook.** Import behavior is deliberately defensive and its
  column map configurable, but the exact sheet layouts remain unverified.
- **`report_summary` drift.** Until the deferred fix is applied, the legacy
  `/reports/summary/` endpoint continues to report creation-based periods and a
  cancelled-inclusive completion rate, which will disagree with the new service.
  Do not ship the new service alongside the old endpoint without reconciling them.

## Recommendation

**Not ready to release** until the two `views.py`/`urls.py` items (period basis and
endpoint wiring) are applied and the concurrent execution work is merged and
re-tested. The service layer and its tests are green and are a safe checkpoint to
build the frontend integration against via the documented payloads.
