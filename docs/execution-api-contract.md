# WorkSpace execution API contract

All endpoints require the existing authenticated Django session and CSRF token on mutating requests. Workspace-scoped endpoints verify membership. The legacy `X-Workspace-Id` header remains supported by `/api/tasks/`; new consumers should prefer the explicit workspace task URL.

Dates are ISO `YYYY-MM-DD`. Datetimes are ISO 8601. Validation errors use `400 {"error": "...", "errors": {"field": ["..."]}}` where field details are available. Permission failures use 403 and missing scoped resources use 404.

## Projects

`GET|POST /api/workspaces/{workspace_id}/projects/`

`PATCH|DELETE /api/workspaces/{workspace_id}/projects/{project_id}/`

Project writes require an owner or manager. In addition to the existing fields, project objects accept and return:

```json
{
  "start_date": "2026-10-01",
  "end_date": "2026-12-15",
  "timezone": "Europe/London",
  "week_anchor_date": "2026-09-28",
  "due_soon_days": 7,
  "configuration": {"reporting_currency": "GBP"}
}
```

`timezone` must be an IANA name, `configuration` must be an object, and `due_soon_days` is 0–365.

## Tasks

`GET|POST /api/workspaces/{workspace_id}/tasks/` is the preferred scoped collection.

`GET|POST /api/tasks/` remains compatible and resolves the workspace from `X-Workspace-Id` (or the user's first workspace).

`GET|PATCH|DELETE /api/tasks/{task_id}/`

`GET /api/tasks/{task_id}/history/`

New task fields:

```json
{
  "task_code": "DELIVERY-000001",
  "code": "DELIVERY-000001",
  "start_date": "2026-09-01",
  "due_date": "2026-09-30",
  "actual_completion_date": null,
  "progress_percent": 40,
  "workstream_id": 12,
  "phase_id": 19,
  "blocker_details": "",
  "state": "active",
  "supporter_ids": [4, 8],
  "project_id": null
}
```

`project_id: null` is Operations; a project ID is project work. `state` is `draft`, `active`, or `archived`. Codes are generated server-side, unique per workspace, permanently reserved, and cannot be supplied or changed by clients. Existing `code`, `workstream`, `phase`, `supporter_id`, and `project` response fields remain as compatibility aliases.

Owners/managers can change ownership, project assignment, supporters, normalized lookups, and lifecycle state. The assigned task owner can change execution fields. A supporter or other member has read-only task access. `DELETE` archives by default. Only workspace owners may permanently remove a task with `DELETE /api/tasks/{id}/?permanent=true`; its code reservation and history remain.

Validation rules:

- Due date cannot precede start date.
- Progress is an integer from 0 to 100.
- `done` requires 100%; setting status to `done` supplies 100% and an actual completion date when omitted.
- `blocked` requires non-empty `blocker_details`.

### Filters, pagination, and sorting

Collection query parameters can be combined:

- `scope=all|operations|{project_id}` (or `project_id={id}` / `project={id}`)
- `owner={user_id}`, `supporter={user_id}`
- `workstream={lookup_id}`, `phase={lookup_id}`
- `status={value}`, `priority={value}`
- `date_from=YYYY-MM-DD`, `date_to=YYYY-MM-DD` (due-date range)
- `overdue=true`, `due_soon=true`
- `archived=false|true|all` (default false)
- `search={text}`
- `page={n}`, `page_size={1..200}` (default 100)
- `sort=due_date|-due_date|created_at|-created_at|updated_at|-updated_at|priority|-priority|title|-title|task_code|-task_code|default`

The compatibility `tasks` array remains at the top level:

```json
{
  "tasks": [],
  "pagination": {
    "page": 1,
    "page_size": 100,
    "total_items": 0,
    "total_pages": 1,
    "has_next": false,
    "has_previous": false
  }
}
```

History entries contain `field`, `previous_value`, `new_value`, `actor_id`, `actor_name`, `task_code`, and `created_at`. They are append-only and survive permanent task deletion.

## Configurable workstreams and phases

`GET|POST /api/workspaces/{workspace_id}/lookup-values/`

`PATCH|DELETE /api/workspaces/{workspace_id}/lookup-values/{value_id}/`

Values use `kind: "workstream"|"phase"`, `name`, optional `project_id`, `position`, and `is_active`. GET accepts `kind`, `project_id`, and `active=true|false|all`. Project-scoped results include workspace-wide values. Writes require a leader; DELETE deactivates a value.

## Risks and issues

`GET|POST /api/workspaces/{workspace_id}/risks-issues/`

`PATCH|DELETE /api/workspaces/{workspace_id}/risks-issues/{record_id}/`

Records can be workspace-wide (`project_id: null`) or project-specific. GET accepts `project_id`, `scope=workspace`, `kind=risk|issue`, and `archived=true|false`. Fields are `kind`, `title`, `detail`, `severity` (`low|medium|high|critical`), `status`, `owner_id` or compatibility `owner`, and `due_date` or compatibility `due`.

Risk statuses are `open`, `mitigated`, `closed`; issue statuses are `open`, `in_progress` (legacy `in progress` is accepted), and `resolved`. Members may read records. Leaders create/archive records; a named owner may update their record. DELETE archives.

