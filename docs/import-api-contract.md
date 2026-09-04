# Workspace import API

The Import page supports task, project, and project-stakeholder imports from `.xlsx` or UTF-8 `.csv` files. All endpoints require an authenticated workspace member; only owners and managers can commit data. Files are limited to 20 MB.

## Templates

`GET /api/workspaces/{workspace_id}/imports/templates/{kind}.{format}`

`kind` is `tasks`, `projects`, or `stakeholders`; `format` is `xlsx` or `csv`. The response is an attachment with headers, an example row, and Excel instructions where applicable. Templates are workspace-authenticated and contain no private workspace data.

## Preview

`POST /api/workspaces/{workspace_id}/imports/preview/`

Multipart fields:

- `workbook`: `.xlsx` or `.csv` file
- `import_type`: `tasks`, `projects`, or `stakeholders` (default `tasks`)
- `column_map`: optional JSON object mapping canonical names to custom headers, for example `{"name":"Project name"}`

Members can preview; the response is read-only and includes:

```json
{
  "preview": {
    "preview_id": 12,
    "checksum": "sha256...",
    "kind": "projects",
    "summary": {"total_rows": 4, "creates": 2, "updates": 1, "exceptions": 1},
    "rows": [],
    "exceptions": []
  }
}
```

Preview rows are serializable and do not expose model objects. Exceptions include row, field, and message. A server-side preview record is retained for one hour so a client cannot bypass preview by calculating a checksum itself.

## Commit

`POST /api/workspaces/{workspace_id}/imports/commit/` — owner/manager only

Send the exact same file and `import_type`, plus `preview_id` and `preview_checksum`. The optional `column_map` must also be identical. The server locks and consumes the preview once, rebuilds the plan, rejects workspace data drift, then applies the import transactionally. It returns `{ "result": {"created", "updated", "exceptions": []} }` and writes an audit event.

Task imports preserve the existing workbook semantics: `General` is authoritative, `Lists` carries configuration, and other sheets enrich existing tasks by code. CSV task files are converted to the same internal plan. Imported task codes are registered permanently and cannot be reused; task changes create immutable history.

Project imports use case-insensitive project name matching for updates and support dates, timezone, due-soon settings, status, and configuration JSON. Stakeholder imports use project plus email (or project plus name where email is blank) as the update key and support role, influence, interest, email, and notes. Project and stakeholder records must remain in the selected workspace.

Rows with validation errors are skipped and reported. The frontend offers a local CSV error-report download from the preview; no failed row is silently discarded.
