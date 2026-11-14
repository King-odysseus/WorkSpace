# Phase 0: baseline, spike, and the acceptance gate

Status: the Phase 0 evidence is complete on all three review tracks. **Phase 1 is blocked
pending owner acceptance of this report** (see section 5, Open questions).

Date: 2026-11-14
Plan: `docs/zuricopilot-plan.md`
Phase-start commit: `1e67a947e2de1f19fec0f8b524e382a6c1f638c5`
("Add board milestone creation and clear timeline markers")

This report uses the five headings the plan requires in section 22. Where a reader would
expect a sixth topic, it is filed under the heading that owns it:

1. What was built
2. How it was tested
3. Web app unchanged: the five section 5 outputs
4. Deviations from this plan
5. Open questions and decisions needed from the owner

Every number below was produced by a command recorded in section 2 or 3 of this report, run
on this machine on 2026-11-14. Nothing here is estimated except where it says "estimate".

---

## 1. What was built

Phase 0 produced no feature. It produced the ability to check the later phases without
touching the product, in three review tracks that were worked separately and are combined
here.

### Track A: the baseline and the boundaries

The starting state, the toolchain, the untouched build output, the test baseline and the
isolation rules the write probe must obey. Recorded in this report; it has no code.

Toolchain measured on this machine:

| Tool | Version |
| --- | --- |
| Node | v20.17.0 |
| npm | 10.8.3 |
| Python | 3.13.14 |
| Django | 5.2.17 |
| Vite | 6.4.3 |
| Vitest | 4.1.11 |
| Electron | 45.3.2 |

### Track B: the desktop spike and its live harness

`desktop/` is a self-contained package: the root app's build never reads it, and it installs
its own dependency tree (`desktop/node_modules`, `electron` only).

| File | What it does |
| --- | --- |
| `desktop/electron/main.js` | App entry: window lifecycle, smoke-test modes |
| `desktop/electron/windows.js` | Builds the `BrowserWindow` and its hardened session and Content Security Policy |
| `desktop/electron/debug-window.js` | The debug view and its IPC surface |
| `desktop/electron/preload/copilot.js` | The narrow bridge the renderer gets; no Node access |
| `desktop/features/copilot/main/workspace-api/client.js` | HTTP client that runs a request on a named session partition and records what was sent |
| `desktop/features/copilot/main/workspace-api/probe.js` | The read probe and the marked-task write plus permanent cleanup |
| `desktop/features/copilot/main/ipc/probe-ipc.js` | IPC handlers for the probe, allowlisted channels only |
| `desktop/features/copilot/shared/probe-contract.js` | The result shape both sides validate against |
| `desktop/tests/spike/live-verify/` | The isolated live run: throwaway servers, throwaway database, real Electron window, real sign-in |

### Track C: the security review of the evidence path

The live run writes request headers, bodies and outcomes to a file on disk. Track C covers
what may be written there.

| File | What it does |
| --- | --- |
| `desktop/tests/spike/live-verify/sanitize.js` | Redaction rules for headers, query strings, bodies and cookies |
| `desktop/tests/spike/live-verify/sanitize.test.js` | Regression tests for those rules |
| `desktop/tests/spike/live-verify/summarize.mjs` | Renders a run as the readable report |

### What this round added

| File | What it does |
| --- | --- |
| `desktop/scripts/verify-web-unchanged.mjs` | The section 5 proof as a script: protected-path diff, build, asset comparison, dist scan, mockup-input check |
| `desktop/scripts/verify-web-unchanged.test.mjs` | 43 tests for the decisions that proof rests on |
| `desktop/reports/phase-0.md` | This report, restructured to the section 22 headings |

The proof is a script rather than a set of remembered commands because a proof that is
re-typed from memory each phase is a proof that eventually gets re-typed wrong.

### The isolated test workspace these runs use

Isolation is mandatory because `.env` points the app at the development Postgres database,
which cannot be shown to be free of real business rows. `backend/settings.py` loads `.env`
with `os.environ.setdefault`, so a real environment variable wins and the app can be
redirected from the shell. `DATABASE_URL` takes precedence over `WORKSPACE_DB_NAME`, so the
runner sets and checks both.

```bash
export WORKSPACE_DB_ENGINE=django.db.backends.sqlite3
export WORKSPACE_DB_NAME="$PWD/.tmp-phase0/probe.sqlite3"
export WORKSPACE_CSRF_TRUSTED_ORIGINS="http://localhost:5183,http://127.0.0.1:5183"
export WORKSPACE_ALLOWED_HOSTS="127.0.0.1,localhost"
unset DATABASE_URL

python manage.py migrate --noinput
python manage.py runserver 8099 --noreload
```

Rules the harness enforces, all verified live in the run below:

- Refuse to start if `DATABASE_URL` is set, or if the resolved database is not the approved
  file under `.tmp-*`. Never fall back to the development Postgres database, and never use
  the shared `db.sqlite3`.
- Create the account through the app's own sign-up endpoint on an `example.invalid` address
  with a per-run generated password. The probe signs in as the owner only.
- Write exactly one task and hard-delete it, and touch nothing else: no invites, comments,
  messages or uploads.
- On teardown, stop the server, delete the throwaway database and the minted session file.

### Where the raw output lives

Raw output stays in already-ignored paths, confirmed with `git check-ignore` (`.tmp-*`,
`dist/`; `node_modules/` is ignored globally, so the desktop package's install tree is never
staged):

| Path | Contents |
| --- | --- |
| `.tmp-phase0/live-verify/<stamp>/` | One live run: `evidence.json`, `summary.md`, screenshot, server and Electron logs |
| `.tmp-phase0/verify-web-unchanged.log` | The section 3 proof output |
| `.tmp-phase0/final-vitest.log`, `.tmp-phase0/final-django.log` | This round's suite output with exit status |
| `.tmp-phase0/dist-assets-baseline.txt` | The current baseline, with its comment header |
| `.tmp-phase0/dist-assets-baseline-original-2026-11-14T1525.txt` | The original baseline, unchanged |
| `dist/` | Build output |

The tracked files from Phase 0 are the report, the desktop package, and this round's verifier
and its tests. No log, screenshot, database file or build artifact is staged.

---

## 2. How it was tested

### 2.1 Commands and results

| Check | Command | Result |
| --- | --- | --- |
| Production build | `npm run build` | pass, exit 0, 3172 modules, 32.1s (15.6s on an idle machine) |
| Frontend unit and component tests | `npx vitest run --maxWorkers=2` | 101 files, 813 tests, all passed, exit 0 |
| Backend tests | `python manage.py test` | 838 tests, OK, exit 0, 1917.29s |
| Desktop spike, mocked | `cd desktop && node --test features/copilot` | 86 tests, 86 passed, exit 0 |
| Live-run helpers | `node --test desktop/tests/spike/live-verify/` | 65 tests, 65 passed, exit 0 |
| Unchanged-web proof, helpers | `node --test desktop/scripts/` | 43 tests, 43 passed, exit 0 |
| Unchanged-web proof, full | `node desktop/scripts/verify-web-unchanged.mjs` | 13 checks, 12 pass, 1 warning, exit 0 |
| Live verification, end to end | `node desktop/tests/spike/live-verify/run.mjs --serve=preview --sign-in=manual` | 6 of 6 checks pass, exit 0 |

No model inference is involved anywhere in Phase 0: this is a Django server, a Vite build and
an Electron window. "Which real models were used" therefore has a short answer: none, and
nothing in these results depends on one.

Two notes on the numbers. Every suite reports the same count as the Phase 0 baseline, so there
is no baseline failure to distinguish in this round. The backend suite took 1917s this time
against 932s when the baseline was recorded, with the same 838 tests and the same `OK`: the
machine was carrying other work, and the result did not change with the clock.

### 2.2 The live run: read, write and cleanup

Run folder: `.tmp-phase0/live-verify/20261114-193956` (ignored). Servers: Django on
`127.0.0.1:8099` against a throwaway SQLite file, the built app on `http://localhost:5183`,
one Electron window on the `persist:ws` partition.

| What was proven | Evidence |
| --- | --- |
| The main process reads the signed-in user's workspaces using the web view's session | `read.status=ok`, `workspaceCount=1`, `workspaceId=1`, `signIn.sameSessionAsWebView=true`; the jar held `csrftoken, sessionid` at request time |
| A uniquely marked task is created | `POST /api/workspaces/1/tasks/` returned 201 for title `Probe task mwgt9s92-b7dfba28` |
| It is permanently deleted, not archived | `DELETE /api/tasks/1/?permanent=true` returned 200; a Django ORM check after Electron exited found 0 tasks in the workspace and no row carrying the exact marker |
| Signed-out access fails safely | With an empty jar (0 cookies), read and write both returned `not_signed_in`; the recorder counted 0 task-create requests, so nothing was attempted |
| No cleanup was left incomplete | `tasksBefore=0`, `tasksAfter=0`, `markersRemaining=0`, `markerFound=false` |

Sanitized request headers as recorded on the write and the delete:

| Header | Recorded value | Why this is the evidence |
| --- | --- | --- |
| `X-CSRFToken` | `<redacted>; 32 chars` | Proves the token was sent, without keeping it |
| `Origin` | `http://localhost:5183` | Proves the request came from the trusted app origin |
| `Referer` | `http://localhost:5183/` | Second half of Django's origin check |
| `Accept` | `application/json` | Ordinary request shape |
| `Content-Type` | `application/json` | Ordinary request shape |
| `Cookie` | not present as a call-site header | Chromium attaches the jar itself, so the recorder never sees it |

Query strings are recorded with their parameter names and redacted values, so the delete
reads `?permanent=true` and nothing else.

### 2.3 Security findings

1. **The review in round 1 found a real leak in the evidence path, and it is fixed.** The
   sanitiser kept any header value it did not recognise and wrote whole query strings, so an
   `X-API-Key` header or `?access_token=...` would have been written verbatim while
   `findLeakedSecrets` could only look for the password and cookie values it knew about. It
   now fails closed in two places: a header allowlist (only known request-describing headers
   keep their value; everything else becomes `<redacted>` with the name kept), and query
   redaction (values kept only for `permanent` and numeric pagination; credential-shaped
   names always redacted; fragments dropped). Fourteen regression tests cover it, including a
   full request row carrying both an `X-API-Key` header and an `access_token` query value and
   asserting neither reaches the record. 65 helper tests pass.
2. **No secret reached the evidence file.** Before writing, the run checks the serialised
   record for the session cookie values, the CSRF token and the throwaway password. None were
   present. That scan is a second line of defence only; the allowlist is what keeps an
   unanticipated value out.
3. **No server authentication, authorisation or CSRF setting was changed.** Every request was
   a normal one against an unmodified server. `tasks/`, `backend/` and `src/` are unchanged
   (section 3, output 1).
4. **The signed-out probe refuses before it can write.** It establishes `not_signed_in` from
   `/api/auth/me/` and returns, so an unauthenticated write is never attempted. That is the
   intended safe path; it also means the server's own rejection of an unauthenticated write
   was not exercised (see 2.5).
5. **New finding, not a hole: the production stylesheet depends on the mockups.** Tailwind v4
   finds its sources by scanning the project, so the untracked mockups under
   `src/mockups/copilot/` contribute selectors to the app's CSS: 121 classes used only by the
   mockups ship in `dist/assets/index-*.css` (for example `max-w-[1240px]`, which appears in
   `CopilotMockup.jsx` and nowhere else). Measured, that is about 6 kB of the 687 kB stylesheet
   across 111 of the 121 selectors; the remaining ten are variant rules shaped differently. No
   mockup code runs, no file name or text in `dist` mentions Copilot, and the build still has
   `index.html` as its only input. The consequences are that the app's stylesheet changes
   whenever the mockups change, and that the asset baseline in section 3 slid three times
   during the phase for exactly this reason. It is reported, not fixed, because the fix is the
   first change to `src/` and needs the owner's decision.

### 2.4 The decision tree in section 4.2

Section 4.2 branch 1 held. `session.fetch` with `X-CSRFToken` read from the `csrftoken`
cookie in the shared session was accepted for both the read and the write (201 and 200), so
branches 2 and 3 were never entered. No fallback was needed and nothing on the server was
changed. There is no failing branch to document.

### 2.5 What was not tested

Stated plainly, because a passing report that hides these would be worth less than this one:

- **A person physically typing the credentials.** The window, the login form and the session
  were the app's own, but no one was at the keyboard: Windows UI automation clicked the two
  fields and typed. The harness cannot tell who typed, so it reports "credentials entered in
  the app window", never "human".
- **The Vite dev-server rendering path.** It cannot render under the current Content Security
  Policy (a hash and `'unsafe-inline'` in one `script-src` cancel each other, blocking Vite's
  React-refresh preamble). The live run used the built app on the same origin, port, session
  and API instead. See section 4, deviation 1.
- **The server's rejection of an unauthenticated write.** The probe refuses before sending,
  which is the intended path, so Django's own rejection was not exercised.
- **Anything from Phase 1 onwards**: the packaged desktop build, code signing, auto-update,
  crash reporting, and every Copilot feature.
- **Real business data.** No development database was written, no real person was signed in,
  and no workspace the probe did not create was touched.

### 2.6 Floors for later phases

- The frontend suite must still show at least 101 files and 813 passing tests; the backend
  suite at least the count in 2.1. New desktop tests are additions, not replacements.
- The root build must keep producing the asset names in section 3, or the phase report must
  name the source change that moved them and why.
- The probe's result in the desktop window stays sanitized: status codes, timing, workspace
  and task ids, counts. No cookies, CSRF tokens, passwords or email addresses in the UI, the
  logs or a report.

---

## 3. Web app unchanged: the five section 5 outputs pasted

The whole set is reproducible with one command:

```bash
node desktop/scripts/verify-web-unchanged.mjs
```

Exit codes: `0` every check passed, `1` a check failed, `2` the proof could not run (no
baseline, build failed, git or npm unavailable). `--phase-start <commit>` points it at a later
phase, `--skip-build` compares the existing `dist/`, `--record-baseline` writes a new baseline
with the commit and the mockup fingerprint in its header, and `--strict` turns the warning in
output 6 into a failure.

### Output 1: the protected-path diff is empty

Section 5 asks for `src`, `tasks`, `backend`, root `package.json`, `package-lock.json` and
`vite.config.js`. The script checks all four states a file can be in, because a plain diff
cannot see the last two.

```
1. Protected paths
  PASS  committed diff 1e67a94..HEAD is empty for src, tasks, backend, package.json, package-lock.json, vite.config.js
  PASS  staged changes are empty for the same paths
  PASS  unstaged changes are empty for the same paths
  PASS  untracked files under those paths: only the recorded mockups (7)
        recorded at phase start and left in place: src/mockups/copilot/Chat.jsx
        recorded at phase start and left in place: src/mockups/copilot/CopilotMockup.jsx
        recorded at phase start and left in place: src/mockups/copilot/Dashboard.jsx
        recorded at phase start and left in place: src/mockups/copilot/WeeklyPlan.jsx
        recorded at phase start and left in place: src/mockups/copilot/WorkspaceMode.jsx
        recorded at phase start and left in place: src/mockups/copilot/main.jsx
        recorded at phase start and left in place: src/mockups/copilot/parts.jsx
  PASS  no extra vite.config.* variant redirects the build
```

Two honest notes on that output:

- The seven untracked mockup files were already untracked at phase start, are recorded in this
  report, and were left exactly as they were. They are allowed by name, not by a broad rule;
  any other untracked file under a protected path fails the check.
- The only modified tracked file in the repository is `DesignSystem.md`, which a concurrent
  session rewrote. It is outside the protected paths, is not part of this phase, and was left
  unstaged.

### Output 2: the build, and the asset filenames against the baseline

```
2. Production build
  PASS  npm run build passed in 32.1s, 3172 modules transformed
  PASS  dist/assets holds the same 27 hashed names as the baseline
```

**This check failed at first, and the reason matters.** The baseline recorded at 15:25 on the
phase-start commit did not come back: 27 of 27 names differed. Three builds from a provably
unchanged tree produced three different main stylesheets:

| Build | `index-*.css` | Size | Note |
| --- | --- | --- | --- |
| 15:25, phase-start baseline | `index-kVpbCjeQ.css` | 687.07 kB | the old baseline list |
| 16:02, mid-phase check | `index-D5wnxzYc.css` | not recorded | `.tmp-phase0/dist-assets-run2.txt` |
| 19:55 to now | `index-ChLoH_eu.css` | 686.72 kB | reproducible |

The diagnosis, from evidence and not from guessing:

- The two smaller stylesheets (`ChatViews-*.css`, `SettingsView-*.css`) were byte-identical in
  all three builds, and every JS file kept exactly the same size while its hash moved. A size
  that does not move alongside a hash that does is a rename, not a code change: each lazy
  chunk references the stylesheet's filename, so one CSS rename carries every JS hash with it.
- The main stylesheet genuinely changed content, and its input is Tailwind v4 scanning the
  project. `max-w-[1240px]` occurs in `src/mockups/copilot/CopilotMockup.jsx` and nowhere else,
  and it is in the built CSS. The mockups are untracked and were being edited between those
  three builds, so the production stylesheet followed them.
- The build is now reproducible: two consecutive builds produced identical names
  (`assets-a.txt` and `assets-b.txt` are identical), and every run since matches.

So the plan's premise still holds (identical names mean identical output), and the old baseline
was not wrong so much as recorded from a tree whose untracked mockups have since changed. The
baseline has been re-recorded from the clean tree, and the file now carries a header with the
commit and a fingerprint of the mockup files, so a future drift is attributed instead of
mysterious:

```
# ZuriCopilot section 5 asset baseline
# recorded: 2026-11-14T19:54:59.788Z
# commit: 75b3b61b5de132b148136d7aaa94e9a815b0f26d
# mockups: 60c9755a16372aff
```

The original list is kept unchanged at
`.tmp-phase0/dist-assets-baseline-original-2026-11-14T1525.txt`; the current 27 names are:

```
dist/assets/BulkActionBar-DGNQHDK8.js
dist/assets/ChatViews-C6ZEh_QS.css
dist/assets/ChatViews-sHHUtA5H.js
dist/assets/CreateWorkspaceDialog-BjxCjHaO.js
dist/assets/FilePreview-BVYgbYVq.js
dist/assets/ImportView-Bl-W6jyp.js
dist/assets/LinkedText-cUhKg2YF.js
dist/assets/MentionPicker-CIrTe2O4.js
dist/assets/PersonalPlanner-BANBW1Yi.js
dist/assets/PlannerBoard-DojxRIPS.js
dist/assets/ProjectKanbanBoard-CAjMBQbb.js
dist/assets/ProjectTaskTable-BMSM8Kmx.js
dist/assets/RecordDialogs-DGhDpYFs.js
dist/assets/ScreenSharing-D6YTUjo7.js
dist/assets/SettingsView-BtEtMa58.js
dist/assets/SettingsView-CWvdQrQt.css
dist/assets/TaskViews-CoexeFXl.js
dist/assets/WorkspaceTools-DzrQk2tG.js
dist/assets/arrow-down-LDEcOXuz.js
dist/assets/arrow-right-oPUV2oCF.js
dist/assets/calendar-RJB6-Td9.js
dist/assets/dropdown-menu-CIbY7Gwr.js
dist/assets/index-BrkqrDHT.js
dist/assets/index-ChLoH_eu.css
dist/assets/monitor-up-Ds_ElTo9.js
dist/assets/paperclip-DSHLrl_j.js
dist/assets/skeleton-C7ltL1DL.js
```

One pre-existing warning stands: `index-*.js` is 972.29 kB, over the 500 kB chunk warning
limit. It is not a failure and this phase does not change it.

### Output 3: no Copilot content in `dist/`

```
3. No Copilot content in dist/
  PASS  scanned 42 files in dist/; none mention copilot in name or text
```

This scans every emitted file for `copilot` in its name and, for text output, in its content,
including under a content-hashed name where a file name would reveal nothing.

### Output 4: the frontend suite

```
Command: npx vitest run --maxWorkers=2
Result:  Test Files  101 passed (101)
         Tests       813 passed (813)
Exit:    0
```

That is exactly the Phase 0 baseline (101 files, 813 tests), so no baseline failure needed to
be distinguished: there is none in this run.

### Output 5: the backend suite

```
Command: python manage.py test
Creating test database for alias 'default'...
Ran 838 tests in 1917.291s

OK
Destroying test database for alias 'default'...
Exit:    0
```

The suite creates and destroys its own test database on the server named by `.env`; the
development database itself is not migrated or written.

### Output 6: the mockups stay outside the build inputs

```
4. Mockups stay outside the build
  PASS  vite.config.js has no rollupOptions/input override, so the build takes the default index.html entry
  PASS  index.html has exactly one module script, /src/main.jsx
  PASS  no file in dist/ carries the mockup-only marker text
  PASS  no mockup page is emitted (copilot-mockup.html, mockup.html)
  WARN  121 mockup-only classes reach the production stylesheet: -mx-2, -right-1, -right-12, ...
        the mockups are not build inputs, but Tailwind scans them and their selectors ship
```

Read this as two statements. The plan's literal requirement holds: the build has one input, no
mockup page is emitted, no mockup marker or Copilot text reaches `dist/`. The stronger property
the plan assumes does not hold: the mockups do influence the app's stylesheet, through
Tailwind's project scan (security finding 5 in 2.3). All 121 flagged classes were checked
against the app's source: each one appears verbatim in the mockup files and in no app file, and
the app side of the comparison is deliberately generous (any token anywhere in `src` outside
the mockups counts as app-owned), so the warning understates rather than overstates.

`RESULT: PASS - 13 checks, npm run build passed in 32.1s, 3172 modules transformed; 1 warning (m5)`.
Twelve checks pass and one warns; the warning is the coupling described above, not a build
problem.

---

## 4. Deviations from this plan, with reasons

1. **The live proof ran against the built app, not the Vite dev server.** The dev server cannot
   render inside the hardened window: `desktop/electron/windows.js` builds a development
   `script-src` that lists an inline-script hash and `'unsafe-inline'` together, and the hash
   disables `'unsafe-inline'`, so Vite's inline React-refresh preamble is blocked and the page
   stays blank. Proposed minimal fix, not applied: in the development branch of that file,
   build `script-src` from `'self'` and `'unsafe-inline'` only, with no inline-script hashes.
   Consequence: the dev-server rendering path stays unproven until that line changes. The built
   app exercises the same origin, session, API and CSRF paths.
2. **The manual sign-in was typed by UI automation, not by a person.** The app's own window,
   form and validation were used; only the keystrokes were scripted. A person at the keyboard
   remains unrun (2.5).
3. **The evidence sanitiser was rewritten after the review.** It now fails closed with a header
   allowlist and query redaction, where it previously kept unrecognised headers and whole query
   strings. This is a correction to a Phase 0 deliverable, not a change to the product.
4. **`summarize.mjs` no longer claims a human typed the credentials.** The harness cannot know
   who typed, so the row reads "credentials entered in the app window".
5. **The asset baseline was re-recorded.** Reason in output 2: the untracked mockups feed the
   production stylesheet, so the old list could not be reproduced from any git state. The old
   list is preserved, the new one carries the commit and a mockup fingerprint, and the drift is
   attributed rather than hidden.
6. **This report was restructured** from seven sections to the five section 22 headings, and the
   three review tracks were merged into it. No fact from the earlier version was dropped; the
   isolation rules moved into section 1 and the numbers into sections 2 and 3.

Nothing in this round changed `src/`, `tasks/`, `backend/`, `package.json`,
`package-lock.json` or `vite.config.js`. The one product-adjacent item that would need to
change to fix finding 5 is named in section 5.

---

## 5. Open questions and decisions needed from the owner

**The gate.** Phase 1 is blocked until the owner accepts this report. Everything the plan asks
Phase 0 to prove is proven, with the two open items below carried as known limitations.

1. **Do you accept Phase 0 and unblock Phase 1?**
2. **The first change to `src/` needs your approval.** To stop the mockups feeding the production
   stylesheet, one of these is needed, and each touches something Phase 0 was told not to touch:
   - add an exclusion for the mockup folder to the Tailwind sources in `src/pencil.css`
     (`@source not "../src/mockups/**"`), the smallest change, or
   - move the mockups out of `src/` so the scan cannot reach them, or
   - accept the coupling and keep re-recording the asset baseline whenever the mockups change.

   Recommendation: the first. It is one line in one file, it removes 121 selectors from the
   shipped CSS, and it makes the section 3 proof hold again while mockups are being edited.
3. **Should Phase 1 apply the dev-server CSP fix** in `desktop/electron/windows.js` (deviation 1)?
   It is inside `desktop/`, so it needs no product approval, but it changes what the window
   permits and should be a deliberate decision rather than a side effect.
4. **Is UI-automation sign-in acceptable as the "manual web-view sign-in" evidence?** If a person
   must physically type, that single check has to be repeated; the command is
   `node desktop/tests/spike/live-verify/run.mjs --serve=preview --sign-in=manual`.
5. **Confirm the Phase 1 scope** before it starts, so the first feature work does not drift into
   the decisions above.

### What the gate is being asked to accept

The evidence behind each criterion of this task, so acceptance can be checked without reading
the whole report:

| Criterion | Where it is met |
| --- | --- |
| The protected-path diff is empty for `src`, `tasks`, `backend`, root `package.json`, `package-lock.json` and `vite.config.js`, with uncommitted changes inspected too | Section 3, output 1: committed, staged, unstaged and untracked, plus the `vite.config.*` variant check |
| `npm run build` run, asset filenames compared with the baseline, no Copilot content in `dist`, mockups outside the production build inputs | Section 3, outputs 2, 3 and 6, including the drift diagnosis and the re-recorded baseline |
| `npx vitest run --maxWorkers=2` and `python manage.py test` run, actual results recorded, baseline failures distinguished | Section 2.1 and section 3, outputs 4 and 5 |
| The five section 22 headings, carrying sanitized headers, read/write/cleanup results, security findings, the decision-tree outcome and untested items | This report; the named content is in 2.2 to 2.5 |
| Only relevant source and report files committed and pushed, with Phase 1 explicitly blocked pending owner acceptance | The first paragraph of this section, and the commits for this round |
