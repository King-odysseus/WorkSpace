# WorkSpace reporting, automation, integrity and migration service

Single source of truth for every workspace / operations / project report, the
scheduled reminders, the data-integrity checks, and the Excel import. The
module layer (`tasks/reporting.py`, `tasks/automation.py`, `tasks/integrity.py`,
`tasks/importer.py`) is free of HTTP concerns; views translate the results to
JSON. This document is the calculation and payload contract for the frontend
agent, and lists the wiring that is intentionally deferred because it touches
files owned by the concurrent execution-foundation work.

---

## 1. Reporting

### 1.1 Scope

| scope | meaning |
| --- | --- |
| `all` | entire workspace |
| `operations` | tasks with no `project_ref` (project_id is null) |
| `project` | tasks under one `project_id` |

`build_report(workspace_id, scope='all', project_id=None, period='all', period_start=None, period_end=None, task_filter=None, today=None)` returns the payload below.

### 1.2 Report payload

```json
{
  "scope": {"type": "all", "project_id": null, "label": "Entire workspace"},
  "period": {"type": "all", "start": null, "end": null, "today": "2026-01-15"},
  "settings": {"due_soon_days": 7, "stale_days": 14},
  "generated_at": "2026-01-15T12:00:00+00:00",
  "totals": {
    "total_tasks": 7,
    "applicable_tasks": 6,
    "cancelled_tasks": 1,
    "archived_tasks": 0,
    "completed_tasks": 1,
    "completion_rate": 17,
    "average_progress": 42
  },
  "status_counts": {"todo": {"count": 2, "filter": {"status": "todo"}}, "": {}},
  "overdue": {"count": 1, "filter": {"due": "overdue"}},
  "due_soon": {"count": 1, "threshold_days": 7, "filter": {"due": "soon"}},
  "blocked": {"count": 1, "filter": {"status": "blocked"}},
  "on_hold": {"count": 1, "filter": {"status": "on_hold"}},
  "cancelled": {"count": 1, "filter": {"status": "cancelled"}},
  "unassigned": {"count": 2, "filter": {"assignee_id": null}},
  "stale": {"count": 1, "threshold_days": 14, "filter": {"stale": true}},
  "workload": [],
  "progress_by_workstream": [],
  "progress_by_phase": [],
  "progress_by_project": [],
  "progress_by_priority": [],
  "kpis": {}
}
```

### 1.3 Calculation definitions

`applicable` = tasks excluding `cancelled` and `state == 'archived'`.

| metric | definition |
| --- | --- |
| `total_tasks` | all tasks in scope/period (including cancelled/archived) |
| `applicable_tasks` | `total_tasks` minus cancelled and archived |
| `completed_tasks` | applicable tasks with `status == 'done'` |
| `completion_rate` | `round(completed / applicable * 100)`, `0` when applicable is empty |
| `average_progress` | `round(sum(task_progress) / applicable)`, `0` when applicable is empty |
| `overdue` | progressable tasks with `due_date < today` |
| `due_soon` | progressable tasks with `today <= due_date <= today + due_soon_days` |
| `blocked` | applicable tasks with `status == 'blocked'` |
| `on_hold` | applicable tasks with `status == 'on_hold'` |
| `cancelled` | all tasks with `status == 'cancelled'` |
| `unassigned` | applicable non-completed tasks with `assignee_id IS NULL` |
| `stale` | applicable non-completed tasks with `updated_at < now - stale_days` |

`progressable` statuses: `todo`, `in_progress`, `blocked`, `review`. `on_hold` is
excluded from overdue/due-soon because a parked task is not expected to move.

### 1.4 Task progress precedence

`task_progress(task)` returns 0–100 in this order:

1. `status == 'done'` → `100`.
2. an explicit `progress_percent` (canonical field) when non-zero → that value.
3. subtask completion ratio (`completed / total * 100`) when the task has subtasks.
4. the status mapping: `todo`/`blocked`/`on_hold`/`cancelled` → `0`, `in_progress` → `50`, `review` → `75`.

### 1.5 Workload and progress groups

`workload` is one entry per distinct `assignee_id` (including `null`), with
`total`, `open`, `blocked`, `on_hold`, `completed`, `overdue`, `due_soon`,
`stale`, and a replayable `filter`.

`progress_by_*` groups carry `name`, `total`, `completed`, `completion_rate`,
`average_progress`, `blocked`, `overdue`, and a replayable `filter`:

| group | filter key |
| --- | --- |
| workstream | `{"workstream": "<name>"}` (matches `workstream` or `workstream_ref__name`) |
| phase | `{"phase": "<name>"}` |
| project | `{"project_id": <id>}` (`null` = operations) |
| priority | `{"priority": "<value>"}` |

### 1.6 Drill-down filter vocabulary

`apply_task_filter(queryset, task_filter, today, due_soon_days, stale_days, now)`
accepts any subset of:

| key | value | effect |
| --- | --- | --- |
| `status` | a status value | exact status |
| `priority` | `urgent`/`high`/`normal`/`low` | exact priority |
| `assignee_id` | int, or `null` | `null` means unassigned |
| `bucket` | string | exact bucket |
| `project_id` | int | exact project (operations is expressed via `scope`, not this key) |
| `workstream` | string | `workstream` OR `workstream_ref__name` |
| `phase` | string | `phase` OR `phase_ref__name` |
| `state` | `draft`/`active`/`archived` | exact state |
| `due` | `overdue`/`today`/`soon`/`none` | due-date bucket over progressable tasks |
| `stale` | `true` | non-completed and `updated_at < now - stale_days` |
| `search` | string | title, code, description, assignee name, project, workstream, phase (icontains) |

### 1.7 Reporting periods (delivery/completion based)

`apply_report_period(queryset, period, today, start, end)`:

* `all` — no constraint.
* `week` — last 7 days (today-6 … today).
* `month` — current calendar month (day 1 … today).
* `custom` — explicit `start`/`end`.

A task belongs to a period by **delivery/completion date, never creation date**:

* completed task → its `completed_at` date falls in the period;
* uncompleted progressable task → its `due_date` falls in the period.

Cancelled and `on_hold` tasks are not matched by any period (no delivery signal).

### 1.8 KPI support with zero-target protection

`compute_kpis(applicable, completed, overdue, blocked, stale, targets)` returns
one entry per KPI: `{target, actual, met, score}`.

| KPI | direction | default target |
| --- | --- | --- |
| `completion_rate` | ≥ (gte) | 80 |
| `overdue` | ≤ (lte) | 0 |
| `blocked` | ≤ (lte) | 0 |
| `stale` | ≤ (lte) | 0 |

`score` is a 0–100 attainment figure that never divides by zero:

* a zero target with zero actual → `met = true`, `score = 100`;
* a zero target with non-zero actual (an lte KPI) → `met = false`, `score = 0`;
* a zero gte target is treated as "any actual satisfies", `score = 100`.

Targets are stored on `WorkspaceSetting.kpi_targets` and defaulted by
`get_workspace_setting`, which never writes a row on read.

### 1.9 Project health

`project_health(workspace_id, project, today)` returns `{project_id, name,
status, due_date, health, metrics}`. `health` is one of:

* `completed` — project `status == 'completed'`;
* `off-track` — project past due, or any applicable task overdue;
* `at-risk` — any blocked/on-hold task, or project due within `due_soon_days`;
* `on-track` — otherwise.

`metrics` carries `total_tasks`, `applicable_tasks`, `completed_tasks`,
`completion_rate`, `blocked_tasks`, `overdue_tasks`, `on_hold_tasks`.

---

## 2. Data-integrity checks

`run_integrity_checks(workspace_id)` returns an ordered list of results, each
`{key, label, severity, count, detail, filter, items[]}`. `severity` is `error`
(structurally invalid) or `warning` (advisory). `items` is capped at 50.

| key | severity | rule |
| --- | --- | --- |
| `duplicate_task_codes` | error | non-empty `code` appears more than once (case-insensitive) |
| `active_tasks_without_owners` | error | active task with no `assignee` |
| `multiple_active_owners` | warning | active task with an assignee plus a distinct supporter |
| `invalid_date_ranges` | error | due < created, completed < created, due < start, or actual completion < start |
| `completed_progress_inconsistencies` | error | done without completion timestamp/100%, or non-done with a completion timestamp/100% |
| `orphan_project_relationships` | error | task references a project in another workspace |
| `incorrect_supporter_owner_relationships` | error | supporter is not a member, or supporter == assignee |

`active` means `state == 'active'` and `status` not in `{done, cancelled}`.

---

## 3. Scheduled automation

`run_workspace_automation(workspace_id)` runs every reminder and digest for one
workspace; `python manage.py run_automation` runs them for all workspaces
(`--workspace-id N` for a single one).

| kind | recipient | trigger |
| --- | --- | --- |
| `due_soon_reminder` | assignee | progressable, `due_date` within `due_soon_days` |
| `overdue_reminder` | assignee | progressable, `due_date < today` |
| `blocked_alert` | assignee + all owners/managers | `status == 'blocked'` |
| `stale_update_reminder` | assignee | active, `updated_at < now - stale_days` |
| `workspace_digest` | owners/managers | operations and per-project digests |

### Idempotency

Every delivery is recorded in `NotificationDelivery` under a deterministic
dedup key **before** the notification is created, via `get_or_create` on
`(workspace, kind, dedup_key)`. Re-running never duplicates. The dedup key
embeds the recipient id, so one event can still notify several people once
each. Keys take the form:

* task reminder: `{kind}:{task_id}:{suffix}:{assignee_id}`
* blocked alert: `blocked:{task_id}:{recipient_id}`
* digest: `digest:{scope}:{leader_id}:{date}`

---

## 4. Excel migration

`tasks/importer.py` + `python manage.py import_excel WORKSPACE_ID path.xlsx {--preview | --commit}`.

### Sheet roles

| sheet | role |
| --- | --- |
| `General` | **authoritative** task source; upsert keyed by `code` (create when absent, update when present) |
| `Lists` | configuration (header row of kinds, a column of values each) |
| every other sheet | **owner sheets** — execution enrichment keyed by `code`; never create tasks |

### Guarantees

* **Preview before commit** — `build_import_plan` validates and matches users
  without writing; `commit_import_plan` applies in one `transaction.atomic()`.
* **User matching** — owner/supporter matched by email (case-insensitive) then
  unique full name. Unmatched emails become pending `WorkspaceInvitation`s;
  unmatched names become row exceptions.
* **Exception reporting** — every row problem carries `{row, field, message}`.
* **Transactional** — any unexpected error rolls the whole import back; per-row
  problems are reported and skipped, not rolled back.

### Workbook-required (cannot be verified without the original file)

* the exact General-sheet column headers (override via `column_map`, defaulting
  to `DEFAULT_GENERAL_COLUMNS` in `importer.py`);
* the exact Lists-sheet layout;
* the owner-sheet enrichment column names (`Progress %`, `Status`,
  `Blocker details`, `Actual completion`).

---

## 5. HTTP API contract

All endpoints require an authenticated workspace member. Integrity, automation,
preview, and commit additionally require an owner or manager.

* `GET /api/workspaces/{id}/reports/?scope=&period=&project_id=&start=&end=&filter=` → `{"report": ...}`. Scope is `all`, `operations`, or `project`; period is `all`, `week`, `month`, or `custom`. Custom periods require ISO `start` and `end`. `filter` is a JSON-encoded drill-down filter using the vocabulary in §1.
* `GET /api/workspaces/{id}/reports/project-health/?project_id=` → `{"health": ...}`.
* `GET /api/workspaces/{id}/integrity/` → `{"checks": [...]}`; leader only.
* `POST /api/workspaces/{id}/automation/run/` → `{"deliveries": ...}`; leader only and audited.
* `POST /api/workspaces/{id}/imports/preview/` accepts multipart `workbook` (`.xlsx`, maximum 20 MB) and optional JSON `column_map`. It returns a safe, serializable preview plus `preview_id` and SHA-256 `checksum`.
* `POST /api/workspaces/{id}/imports/commit/` requires the same multipart workbook, the same optional `column_map`, `preview_id`, and `preview_checksum`. The server requires a matching workspace preview from the prior hour, locks and consumes it once, rebuilds the plan, rejects workspace drift, then commits transactionally and audits the result.

The legacy `GET /api/workspaces/{id}/reports/summary/?range=` now uses the same delivery/completion-based period and excludes cancelled tasks from the completion-rate denominator.

The five automation kinds (`due_soon_reminder`, `overdue_reminder`,
`blocked_alert`, `stale_update_reminder`, and `workspace_digest`) map to the
user's `task_updates` notification preference.
