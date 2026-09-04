# Release-readiness report

Prepared by the reporting / automation / migration / quality workstream and
assessed against the integrated working tree.

## Verification results

| Check | Result |
| --- | --- |
| `python manage.py check` | ✅ no issues |
| `python manage.py test tasks` | ✅ 191/191 passing |
| `tasks/test_quality.py` | ✅ 30 tests covering calculations, drill-down replay, HTTP permissions, reminder dedup, integrity checks, and import preview/commit |

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

## Release status and follow-ups

| Item | Why | Action owner |
| --- | --- | --- |
| Legacy `report_summary` calculation | ✅ delivery-based periods and cancelled-exclusive denominator | no action |
| Reporting, project health, integrity, automation, and import HTTP endpoints | ✅ exposed with workspace permissions and validation | frontend may integrate against `docs/reporting-service.md` §5 |
| Automation notification preferences | ✅ all five kinds respect `task_updates` | no action |
| Excel column assumptions | exact General/Lists/owner-sheet headers must be confirmed against the real workbook | provide the workbook; adjust `DEFAULT_GENERAL_COLUMNS` / `column_map` |
| Accessibility follow-ups | focus trap, `aria-pressed` on view toggle, contrast audit | see `docs/accessibility-responsive-review.md` |

## Risk notes

- **Integrated foundation.** Reporting, automation, imports, execution-foundation,
  and screen-sharing changes now coexist in the main working tree. Full checks
  and migration-drift validation must remain part of the release build.
- **No original workbook.** Import behavior is deliberately defensive and its
  column map configurable, but the exact sheet layouts remain unverified.
- **Excel layout confirmation.** The importer is defensive and accepts an
  explicit `column_map`, but the defaults still need comparison with the original
  workbook before a production import.

## Recommendation

The backend release gates described here are resolved. Production Excel migration
remains conditional on previewing the real workbook and confirming its columns;
all other service endpoints are ready for frontend integration.
