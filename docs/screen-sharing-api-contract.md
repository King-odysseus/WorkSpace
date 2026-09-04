# Screen-sharing API contract

Screen sharing is disabled by default. Every endpoint requires the normal authenticated Django session and workspace membership. Mutation requests require the normal CSRF token. The browser is the only component that can start capture: the employee must click **Choose what to share**, then approve a source in the browser-provided `getDisplayMedia` picker.

No endpoint provides webcam, microphone, remote-control, or hidden-capture capability. The frontend requests `{video: ..., audio: false}` and uploads still images only while its consented session is active.

## Roles

| Capability | Owner | Manager | Member/employee |
|---|---:|---:|---:|
| Read published policy | Yes | Yes | Yes |
| Edit/enable policy | Yes | No | No |
| Request a session | Yes | Yes | No |
| Accept/decline/stop own request | No* | No* | Yes |
| Upload capture for own active session | No* | No* | Yes |
| List/view/download captures for any session | Yes | Yes | No |
| List/view/download captures of own session | No* | No* | Yes |
| Delete captures | Yes | Yes | No |

`*` A leader who is the requested employee is treated as the employee for consent and stopping, although the request API prevents requesting oneself.

## Policy

`GET /api/workspaces/{workspace_id}/screen-sharing/policy/`

Returns `{"policy": {"enabled", "capture_interval_seconds", "capture_retention_days", "text", "version", "can_manage"}}`.

`PATCH /api/workspaces/{workspace_id}/screen-sharing/policy/` - owner only

Accepts any of `enabled` (boolean), `capture_interval_seconds` (30-300), `capture_retention_days` (1-30), and `text` (100-5000 characters). Changing policy text increments its version. Every update is audited.

## Sessions

`GET /api/workspaces/{workspace_id}/screen-sharing/sessions/`

Owners/managers receive workspace sessions; members receive only sessions addressed to them. Returns up to the newest 100, each with a `capture_count`. A session includes the immutable policy text/version and capture settings shown when it was requested.

Add `?scope=mine` to receive only sessions addressed to the caller, without `capture_count`. The always-mounted consent control in the frontend polls this cheaper variant; the leader-facing page uses the full listing, whose counts are annotated in a single query.

`POST /api/workspaces/{workspace_id}/screen-sharing/sessions/` - owner/manager

Body: `{"employee_id": 123, "message": "Optional reason"}`. The policy must be enabled. Creates a ten-minute `pending` request and an employee notification. Only one pending/active request may exist per employee and workspace.

`PATCH /api/workspaces/{workspace_id}/screen-sharing/sessions/{session_uuid}/`

Body actions:

- `accept`: requested employee only, pending to active. The browser picker must already have returned a stream.
- `decline`: requested employee only.
- `stop`: sharing employee only; ends an active session immediately.

`accept`, `decline`, and `stop` notify the leader who made the request.
- `cancel`: owner/manager only; pending requests only.

Active sessions have a four-hour hard limit. The employee frontend calls `POST .../{session_uuid}/heartbeat/` every 20 seconds; a heartbeat gap over 180 seconds expires the session. The window is deliberately wider than the interval because browsers throttle timers in background tabs.

## Captures

`POST /api/workspaces/{workspace_id}/screen-sharing/sessions/{session_uuid}/captures/` - sharing employee only

Multipart field `capture`; JPEG, PNG, or WebP; maximum 5 MB and 10,000×10,000 pixels. The session must be active and uploads are rate-limited to its snapshotted interval. The first capture is taken immediately on accept, then at the configured interval. The response contains an authenticated `view_url` and `download_url`.

`GET /api/workspaces/{workspace_id}/screen-sharing/sessions/{session_uuid}/captures/` - owner/manager, or the session's own employee

Lists up to 200 unexpired captures. Listing the collection is audited.

`GET /api/screen-captures/{capture_uuid}/` - owner/manager, or the employee the capture is of

Streams inline with `Cache-Control: private, no-store`. Add `?download=true` for an attachment. Viewing and downloading are separate audit actions. Employees have read access to their own captures so they can exercise subject-access rights; the audit log records their access the same way.

`DELETE /api/screen-captures/{capture_uuid}/` - owner/manager only

Permanently deletes the database row and private image file. The deletion is audited first.

## Expiry and operations

Run `python manage.py purge_screen_captures` at least daily (hourly is recommended). It expires abandoned sessions and permanently deletes captures whose configured retention has elapsed. API traffic also opportunistically performs the same cleanup. Automated expiry is written to the audit log with a null/system actor.

Deleting a `ScreenCapture` row removes its image file through a `post_delete` signal, so cascade deletes (removing a workspace or a session) and admin deletions cannot leave orphaned screenshots behind.

Capture files live below `PRIVATE_MEDIA_ROOT`; production must mount durable protected storage at `/app/private_media` or set `WORKSPACE_PRIVATE_MEDIA_ROOT`. This directory has no public URL in development or production. Do not move captures to a public CDN URL. Backups must use retention settings compatible with company policy.

The `docker-compose.yml` worker runs the purge alongside the reminder and webhook commands every 60 seconds.

Audit actions are: `screen_sharing_policy_updated`, `screen_share_requested`, `screen_share_accepted`, `screen_share_declined`, `screen_share_cancelled`, `screen_share_stopped`, `screen_share_expired`, `screen_capture_created`, `screen_captures_viewed`, `screen_capture_viewed`, `screen_capture_downloaded`, `screen_capture_deleted`, and `screen_capture_expired`.
