# Phase 0: baseline and test boundaries

Status: complete. This records the starting state, the verification baseline and the
isolation rules the write probe must obey. No probe code, desktop package or app change
exists yet; later phases build on these numbers and boundaries.

Date: 2026-11-14
Task: Record the Phase 0 baseline and test boundaries
Plan: docs/zuricopilot-plan.md

## 1. Phase-start state

- Branch: `main`
- Phase-start commit: `1e67a947e2de1f19fec0f8b524e382a6c1f638c5`
  ("Add board milestone creation and clear timeline markers")
- Working tree at phase start, untracked and deliberately left as it was:
  - `.kai/`
  - `copilot-mockup.html`
  - `docs/zuricopilot-plan.md`
  - `src/mockups/copilot/`
- During this phase a concurrent session rewrote the tracked `DesignSystem.md`. That edit is
  not part of this phase and was left unstaged, alongside the untracked work above.
- Files written by this phase: `desktop/reports/phase-0.md` only.
- No change to `src/`, `tasks/`, `backend/`, `package.json`, `vite.config.*` or any dependency.

Toolchain measured on this machine:

| Tool | Version |
| --- | --- |
| Node | v20.17.0 |
| npm | 10.8.3 |
| Python | 3.13.14 |
| Django | 5.2.17 |
| Vite | 6.4.3 |
| Vitest | 4.1.11 |

## 2. Root production build baseline

Command: `npm run build` (vite build)

- Result: pass, exit status 0, 3172 modules transformed, built in 14.87s.
- One pre-existing warning: `dist/assets/index-Dm5df2KP.js` is 972.29 kB, over the 500 kB
  chunk warning limit. It is not a failure and this phase does not change it.
- Output is `dist/index.html` plus 27 files in `dist/assets/`:

```
dist/index.html

dist/assets/BulkActionBar-C_evxT_J.js
dist/assets/ChatViews-BQ6Pq3Fi.js
dist/assets/ChatViews-C6ZEh_QS.css
dist/assets/CreateWorkspaceDialog-kQwST5oy.js
dist/assets/FilePreview-CsHSA_7x.js
dist/assets/ImportView-BiEoLzEp.js
dist/assets/LinkedText-hzMoT70L.js
dist/assets/MentionPicker-B-d6wkym.js
dist/assets/PersonalPlanner-Dp0j3dD6.js
dist/assets/PlannerBoard-DfYhY5oe.js
dist/assets/ProjectKanbanBoard-BWJ8cII0.js
dist/assets/ProjectTaskTable-Bkb0bUQl.js
dist/assets/RecordDialogs-Dc-q2oDJ.js
dist/assets/ScreenSharing-HDYw9gW-.js
dist/assets/SettingsView-C4Nv6Jn3.js
dist/assets/SettingsView-CWvdQrQt.css
dist/assets/TaskViews-QqjOlE2_.js
dist/assets/WorkspaceTools-ClfZj9Tt.js
dist/assets/arrow-down-7Fe4AmxK.js
dist/assets/arrow-right-DGGxZJ6n.js
dist/assets/calendar-CyJ9nK1S.js
dist/assets/dropdown-menu-XDv5a7Xh.js
dist/assets/index-Dm5df2KP.js
dist/assets/index-kVpbCjeQ.css
dist/assets/monitor-up-DOBDUjQs.js
dist/assets/paperclip-DKqHIGm9.js
dist/assets/skeleton-DYvqD5Nd.js
```

The same list, sorted, is saved at `.tmp-phase0/dist-assets-baseline.txt` (ignored).
These names are content hashes, so they are evidence and not a contract: the unchanged-web
proof is that this exact set comes back after implementation. It only holds while no
`src/` file that feeds the build changes. If one has to change, the phase report must say
which file and why instead of claiming the set is stable.

## 3. Test baseline

All three commands were run from the repository root on the phase-start commit, before any
implementation work.

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | pass, exit 0, 14.87s |
| Frontend unit and component tests | `npx vitest run --maxWorkers=2` | 101 files, 813 tests, all passed, exit 0, 215.76s (repeat run 225.78s) |
| Backend tests | `python manage.py test` | 838 tests, OK, exit 0, 932.14s |

Notes on the numbers:

- The vitest summary is `Test Files 101 passed (101)` and `Tests 813 passed (813)`. The run
  also prints happy-dom teardown noise for aborted fetches; it does not fail the run. A
  second identical run confirmed the result and reported `VITEST_EXIT=0`
  (`.tmp-phase0/vitest-confirm.log`).
- `python manage.py test` created and destroyed its own test database on the server named by
  `.env`, then reported `OK`. The development database itself was not migrated or written.
- Use these runtimes when planning: about 4 minutes for the frontend suite and about 16
  minutes for the backend suite, single run, no other load.

## 4. Isolated test workspace for the write probe

### Why isolation is mandatory

`.env` sets `WORKSPACE_DB_NAME` (and the `WORKSPACE_DB_*` connection values), so a plain
`python manage.py runserver` talks to the development Postgres database, which cannot be
shown to be free of real business rows. `backend/settings.py` loads `.env` with
`os.environ.setdefault`, so a real environment variable always wins; overriding from the
shell is enough to redirect the app.

`DATABASE_URL` takes precedence over `WORKSPACE_DB_NAME`, and `WORKSPACE_DB_ENGINE`
defaults to Postgres once `WORKSPACE_DB_NAME` is set. Both facts can send a probe to the
wrong database, so the runner sets and checks both.

### Throwaway database (verified in this phase)

```bash
export WORKSPACE_DB_ENGINE=django.db.backends.sqlite3
export WORKSPACE_DB_NAME="$PWD/.tmp-phase0/probe.sqlite3"
export WORKSPACE_CSRF_TRUSTED_ORIGINS="http://localhost:5183,http://127.0.0.1:5183"
export WORKSPACE_ALLOWED_HOSTS="127.0.0.1,localhost"
unset DATABASE_URL

python manage.py migrate --noinput
python manage.py runserver 8099 --noreload
```

Verified on 2026-11-14: `migrate` with those overrides created a 1.6 MB
`.tmp-phase0/probe.sqlite3`, the connection reported `ENGINE=django.db.backends.sqlite3`
with that exact file as `NAME`, and task, user and workspace tables held 0 rows. The file
was deleted afterwards.

Rules the probe runner must enforce:

- Refuse to start when `DATABASE_URL` is set, or when the resolved database is not the
  approved file under `.tmp-*`. Never fall back to the development Postgres database.
- Do not use the repository `db.sqlite3` either: it is ignored, but it is a shared file that
  outlives a run.
- Do not run `migrate`, `seed_browser_fixtures` or `runserver` without the overrides.

### Throwaway users

Preferred (no fixture to keep in sync, nothing shared): sign up through the API in the
throwaway database.

```
POST /api/auth/me/
{"email": "phase0-probe-<run-id>@example.invalid", "password": "<random-uuid>",
 "first_name": "Probe"}
```

`tasks/auth_views.py` creates the user, creates the `My Workspace` workspace with an owner
membership, logs the caller in and returns 201. The call needs the `csrftoken` cookie and
`X-CSRFToken` header first (see below), because signup is a write. The address is on
`example.invalid`, a reserved domain that cannot receive mail, and the password is generated
per run and never written into the repository or a tracked file.

Alternative, already proven by the browser journey: `python manage.py
seed_browser_fixtures --password <generated>` against the same throwaway database. It
creates the `Browser Fixtures` workspace with `browser-owner@example.invalid`,
`browser-manager@example.invalid` and `browser-member@example.invalid`. Its own docstring
says it deletes and recreates that workspace's tasks, so it is only ever safe against the
throwaway database.

The probe signs in as the owner only. It creates no other accounts and invites nobody.

### Session and CSRF

- `GET /api/auth/csrf/` mints the `csrftoken` cookie (`ensure_csrf_cookie`).
- `POST /api/auth/login/` with email and password sets the `sessionid` cookie.
- Writes need header `X-CSRFToken` (Django's default header name; the frontend sends the
  same one) and an `Origin` or `Referer` inside `CSRF_TRUSTED_ORIGINS`, otherwise 403.
- No endpoint under `tasks/` is `csrf_exempt`.
- Cookie names are the Django defaults and `SESSION_COOKIE_SECURE` is only enabled when
  `WORKSPACE_DEBUG=false`, so a local `http://` probe keeps `WORKSPACE_DEBUG=true`
  (the default).

### What the probe writes

- Exactly one task, in the throwaway workspace: `POST /api/tasks/` with header
  `X-Workspace-Id` set to the signed-in workspace, body
  `{"title": "Probe task <run-id>"}`.
- Then `DELETE /api/tasks/<id>/?permanent=1`, which hard-deletes the row (owner only) so no
  archived probe row is left behind.
- Nothing else. No invites, no comments, no messages, no file uploads.
  `WORKSPACE_CLOUD_STORAGE_ENABLED` is only forced off when `test` is in `sys.argv`, so a
  `runserver` probe would reach a configured Cloudinary account on upload; the probe must
  never upload a file.

### Teardown

Stop the server, delete the throwaway database file, remove the minted session file, and
confirm the run left no probe rows in any database that is not the throwaway one.

## 5. Boundaries for the later phases

- Root build graph stays untouched: no edit to `src/`, `package.json`, `package-lock.json`
  or the vite config at the repository root. The desktop package is self-contained and
  installed separately.
- Baseline counts are floors, not targets to re-baseline: the frontend suite must still show
  at least 101 files and 813 passing tests, and the backend suite at least 838 passing
  tests. New desktop tests are additions.
- The root production build must keep producing the asset filenames in section 2, or the
  phase report must name the source change that moved them.
- The probe result shown in the desktop window must be sanitized (status codes, timing,
  workspace id/task id and count only). No cookies, CSRF tokens, passwords or email
  addresses in the UI, the logs or the report.
- The probe never writes to the development database, never signs in as a real person, and
  never runs against a workspace it did not create.

## 6. Artifacts and locations

Raw output stays in already-ignored paths, confirmed with `git check-ignore`:

- `.tmp-phase0/npm-build.log`: build output (`.gitignore` rule `.tmp-*`)
- `.tmp-phase0/vitest.log`: frontend suite output (`.tmp-*`)
- `.tmp-phase0/vitest-confirm.log`: repeat run with its exit status (`.tmp-*`)
- `.tmp-phase0/django-test.log`: backend suite output including `DJANGO_EXIT=0` (`.tmp-*`)
- `.tmp-phase0/isolated-migrate.log`: isolation check output (`.tmp-*`)
- `.tmp-phase0/dist-assets-baseline.txt`: sorted asset list (`.tmp-*`)
- `dist/`: build output (`dist/`)

The only tracked file from this phase is this report. No log, screenshot, database file or
build artifact is staged.

## 7. Acceptance checklist

- [x] Phase-start commit `1e67a94` and the 27 root production asset filenames recorded.
- [x] Baseline recorded for `npm run build`, `npx vitest run --maxWorkers=2` and
      `python manage.py test`.
- [x] Isolated workspace defined with per-run throwaway users; the database redirect was
      verified; live business data is out of bounds.
- [x] Raw logs and build output kept in existing ignored locations; pre-existing untracked
      work left in place.
