# Phase 1: desktop build and validated message contracts

The phase-level section 22 report is `desktop/reports/phase-1-acceptance.md`.
This file is the per-board-item evidence annex that it refers to.

Status: **in progress**. This file records the baseline first, then the work and
its evidence, so the phase-start state cannot be reconstructed from memory after
the fact.

Scope of this slice (one board task, not all of Phase 1): the desktop build
(TypeScript plus a local React renderer bundle), the zod message contract, the
narrow preload surface, one production IPC registration point, and the
`safeStorage` round trip. Window modes, the tray, the workspace list screen and
the `use_copilot` server change belong to their own board items.

## 1. Baseline, recorded before any change

Measured on 2026-11-15 before the first edit of this task.

| Fact | Value |
| --- | --- |
| Repo commit at task start | `d3dd143` (2026-11-15 10:02:48 +0000) |
| Node | v20.17.0 |
| npm | 10.8.3 |
| Electron | 45.3.2 |
| electron-builder | 26.18.0 |
| Desktop test suite, before | `npm run check` -> 86 tests, 86 pass, 0 fail |
| Desktop build step, before | none. `main` is `electron/main.js`, run unbundled |
| TypeScript, before | not present in `desktop/` or the repo root |
| Renderer bundle, before | none. The only renderer is `electron/debug.html`, hand-written DOM |
| Message validation, before | `shared/probe-contract.js`, hand-written checks for one channel |
| IPC registration points, before | one, `main/ipc/probe-ipc.js`, called from two `main.js` sites |

What the spike already proved and this slice must not break:

- `window.copilot` exposes exactly `probe.read` and `probe.write`, with no
  channel parameter and no `ipcRenderer` reachable from a page
  (`main/ipc/preload-bridge.test.js`).
- The web view is created without a preload and never receives the bridge
  (`electron/windows.js`, `electron/windows.test.js`).
- The probe channel refuses untrusted senders, unconfirmed writes and extra
  fields (`main/ipc/probe-ipc.test.js`, `shared/probe-contract.test.js`).

Working tree note: at task start the tree also held unrelated in-progress work
(`DesignSystem.md`, `src/pencil.css`, `desktop/scripts/install-local.ps1`, the
copilot mockups, the plan document). Those files were not touched or staged by
this task. Later decision: the `src/pencil.css` entry has since been reverted at
the owner's instruction, so that file is now byte-identical to `d3dd143` and is
no longer part of the phase's change set.

## 2. Decisions this slice implements

Approved before this task started:

1. TypeScript and the desktop renderer build dependencies may be added to
   `desktop/package.json` only. Root `package.json` and the Vite web build stay
   untouched.
2. `zod` is the validator at the IPC boundary.
3. The existing mockup CSS verification failure (check `m5` in
   `desktop/scripts/verify-web-unchanged.mjs`) is accepted as a known,
   pre-existing failure of that proof run, not a regression caused by desktop
   work. It is reported as a warning with `--allow-mockup-css`.
4. The web manager-permissions display correction is a separate, approved change
   outside `desktop/`. It never rides in a desktop commit: the "Add explicit
   access for managers" board item delivers it in its own commit. Report section
   6 records it, because that item, not the desktop build, is what made the
   correction necessary.

## 3. Work and evidence

### 3.1 What was added

Desktop only. Root `package.json`, root `package-lock.json`, `vite.config.js` and
`src/` are untouched.

| File | Why |
| --- | --- |
| `desktop/package.json` | own build, typecheck and check scripts; `react`, `react-dom`, `zod`; `typescript`, `vite`, `esbuild`, `@types/*`, `@types/node` |
| `desktop/tsconfig.json` | strict typecheck of the main-process sources; `electron` is never imported at runtime |
| `desktop/tsconfig.renderer.json` | strict typecheck of the renderer (DOM libs, `react-jsx`) |
| `desktop/vite.config.ts` | separate renderer build: IIFE output, `base: './'`, `cssCodeSplit: false`, tag rewrite for `file://` |
| `desktop/scripts/build-main.mjs` | esbuild bundle of the IPC entry to `build/main/ipc.cjs` |
| `desktop/features/copilot/shared/ipc-contract.ts` | the channel table and a strict zod schema per request and reply |
| `desktop/features/copilot/main/ipc/handlers.ts` | the single registration point; trust and reply validation |
| `desktop/features/copilot/main/ipc/index.ts` | the published main-process entry that `main.js` and the tests both load |
| `desktop/features/copilot/main/security/keychain.ts` | `safeStorage` wrapper: ciphertext only, no plaintext fallback |
| `desktop/renderer/` | local React status screen, strict CSP, no network |
| `desktop/electron/preload/copilot.js` | one more named method (`contract`), still fixed channels and no arguments |
| `desktop/electron/main.js` | registers through `registerCopilotIpc` at both call sites; one registration point |
| `.gitignore` | ignores `/desktop/build/`, produced by the desktop build |

### 3.2 Test suite

`desktop`: 86 tests before, 116 after. New cases: 9 contract schema tests, 10
handler tests, 10 keychain tests, and 1 added to the preload test for the status
method.

### 3.3 Commands run and what they showed

| Command | Result |
| --- | --- |
| `npm run check` (desktop) | typecheck clean, main bundle built, 116 tests, 116 pass, 0 fail |
| `npm run build` (desktop, `build/` deleted first) | 4 artifacts: `build/main/ipc.cjs` 759.5 kB, `build/renderer/index.html`, `assets/index-*.js` 228.8 kB, `assets/style-*.css` 2.0 kB |
| built page loaded in Electron 45.3.2, real preload, channels registered | React mounted, page text "ZuriCopilot / Bridge ready", `window.copilot.contract()` returned `{ ok: true, value: { contractVersion: 1, channels: [two channels] } }`, `probe.read()` returned a sanitized result, zero console messages, so no CSP violation |
| same page, bridge present, sender never trusted | `contract()` returned `{ ok: false, reason: 'untrusted_sender' }`, `probe.read()` returned null, and the log lines were fixed tokens only |
| same page with no preload | `typeof window.copilot` was `undefined`, the page said "No bridge", every button disabled |
| `safeStorage` on this Windows machine | encryption available (DPAPI), dummy secret stored and read back correctly, absent from every log line |
| `electron . --probe-view-smoke` | all 12 Phase 0 checks still true: bridge, no node access, read, write, clean result, view shows outcome and cleanup, inline script blocked, network blocked, navigation blocked, real probe fits contract |
| root `npm run test` | 101 files, 813 tests, all pass |
| root `npm run build` | built successfully |

### 3.4 Acceptance criteria

1. **Desktop builds independently.** `desktop/` has its own dependencies, configs
   and scripts; a clean `npm run build` produces both bundles with nothing from
   the repository root. No root package file, lock file, Vite config or `src/`
   file changed, and the root suite and build still pass. The web Vite config
   has `index.html` as its only input, so it cannot read this folder.
2. **Typed schemas, and rejection.** Requests and replies are zod schemas with
   derived types. An unknown key, a wrong type, an oversized payload, an
   unconfirmed write and a non-empty status request are all rejected, and a
   reply is parsed again before it leaves. The sender must be a trusted top
   frame of a `file:` page, checked before the request is even inspected.
3. **No bridge in the web view, no arbitrary target.** The web view is still
   created with no preload (its existing test still passes, and a page without
   the preload has no `window.copilot`). The bridge exposes three named methods
   with fixed channels and no arguments; there is no generic invoke, no channel
   parameter and no URL parameter, at runtime and in source.
4. **`safeStorage`.** A dummy secret round trips on this Windows machine through
   DPAPI. When encryption is unavailable the store refuses and keeps nothing, and
   the secret never reaches a log line, a reply or a thrown message.
5. **Tests.** 116 of 116 pass, the Phase 0 probe suite included, and the Electron
   probe-view smoke is unchanged.

## 4. Known gaps, stated plainly

- **The built renderer has no window yet.** The Copilot window and the dock modes
  are their own board item. The page was proven by loading it in Electron with
  the real preload and the real registration, not by the app opening it.
- **`safeStorage` is used synchronously.** Electron 45 deprecates
  `isEncryptionAvailable`, `encryptString` and `decryptString` in favour of async
  forms. They still work; moving over changes the keychain API and its tests, so
  it belongs with the task that first persists a secret to disk.
- **The full `verify-web-unchanged` proof was not re-run.** Its mockup CSS check
  is a known, pre-existing failure, accepted before this slice. The claim it was
  meant to support is covered directly instead: no root build input changed, the
  root suite passes, and the root build succeeds.
- **Node version.** `desktop/package.json` still declares `node >= 22.12`, which
  installing Electron requires. The build, typecheck and tests added here all run
  on the Node 20.17 on this machine.

## 5. Decisions implemented

The four approved decisions are recorded in section 2. The desktop slice is
unchanged by section 6: that section reports the section 17 server change and
the approved web-display correction, which live in the web app and have their
own commits.

## 6. Section 17: the explicit grant for managers to use the desktop assistant

Board item: "Add explicit access for managers". Server change first, then the one
approved web-display correction, each with its own prepared commit message.

### 6.1 What the permission does

`use_copilot` is an ordinary key in `PERMISSION_KEYS` with one deliberate
difference: it is the only key in `MANAGER_DEFAULT_PERMISSION_EXCLUSIONS`, so a
manager does not receive it with the manager role.

| Role | Holds `use_copilot` | Where that comes from |
| --- | --- | --- |
| owner | always, automatically | `effective_permissions()` returns every key for the owner role and stores nothing on the row, so a later key reaches owners without a data change |
| manager, no override | no | `MANAGER_DEFAULT_PERMISSIONS` is every key except this one |
| manager, granted | yes | an explicit list in `Membership.permissions`, written by an owner through the existing `member_detail` endpoint |
| member | never | `MEMBER_DEFAULT_PERMISSIONS` is fixed and does not contain it |

Server files:

| File | Change |
| --- | --- |
| `tasks/models.py` | `'use_copilot'` added to `PERMISSION_KEYS` (line 106) and `MANAGER_DEFAULT_PERMISSION_EXCLUSIONS = frozenset({'use_copilot'})` (line 112) |
| `tasks/views.py` | unchanged. `member_detail` already validates a `permissions` list against `PERMISSION_KEYS`, so the new key is accepted with no new route and no new rule |
| `tasks/migrations/` | unchanged. `permissions` is an existing JSON field; `makemigrations --check` reports no changes |

Commit state: the two model lines are uncommitted. `git diff HEAD -- tasks/models.py`
shows them (7 insertions, 1 deletion), and `main` still ends at `d3dd143`. Two
older commits that once carried the lines, `ae4ee1e` and `b3de2e5`, still exist
as dangling objects but are on no branch, so nothing in `HEAD` provides this
permission. Both model lines and the dedicated test module below have to be
staged together: see 6.6.

Who can grant, unchanged: the endpoint needs an owner or manager actor, then
refuses a manager actor any target that is not a regular member, and refuses a
role or permission change on the owner row. Only an owner can therefore write a
manager's permission list, and the web panel keeps the same owner-only guard.

### 6.2 Tests for the permission

`tasks/test_assistant_access.py`, 12 tests, all passing.

| Acceptance | Test |
| --- | --- |
| Owner qualifies automatically, nothing stored | `test_owner_always_has_assistant_without_a_stored_grant` |
| Manager does not, and every other default is intact | `test_manager_defaults_exclude_assistant_and_keep_every_other_key` |
| Member does not | `test_member_never_has_assistant` |
| Grant through the endpoint | `test_owner_can_grant_assistant_to_a_manager` |
| Revoke | `test_owner_can_revoke_assistant_again` |
| Reset to manager defaults | `test_reset_to_defaults_drops_assistant_and_restores_the_default_set` |
| A grant survives an unrelated update | `test_explicit_grant_survives_an_unrelated_update` |
| Unauthorized update by a manager (peer and self) | `test_manager_cannot_grant_assistant` |
| Unauthorized update by a regular member | `test_member_actor_cannot_change_permissions` |
| A member target is refused | `test_member_target_cannot_be_given_assistant` |
| An unknown key is refused | `test_unknown_permission_key_is_rejected` |
| An explicit list replaces the defaults instead of extending them | `test_granting_only_assistant_narrows_the_override_to_that_key` |

### 6.3 The approved web-display exception

Approved as a narrow correction, because the server key is newer than the
hardcoded list on the owner-only Manager permissions panel.

| File | Change |
| --- | --- |
| `src/components/SettingsView.jsx` | one row `["use_copilot", "Use desktop assistant"]`, plus `countGrantedPermissions`, so the tally counts only keys the panel renders and a held key never reads "17 of 16" |
| `src/components/SettingsView.test.jsx` | four tests: a granted key is shown and counted, a default manager shows it unchecked, an unknown key is not counted, and the panel stays owner-only |

Deliberately not changed: the save path still sends the whole draft list, so an
already-held unknown key is never dropped; the panel markup and its `isOwner`
guard are untouched; no styling and no new dependency. Without this correction
an owner could grant the key from the desktop but neither see nor revoke it on
the web, and the tally was wrong.

### 6.4 The exact web-unchanged exceptions

`desktop/scripts/verify-web-unchanged.mjs` protects `src`, `tasks`, `backend`,
`package.json`, `package-lock.json` and `vite.config.js`, and has no allowance
list: an approved change is reported by that check and named here instead of
being hidden behind a flag. This board item changes exactly these five paths:

| Path | Why it is an approved exception |
| --- | --- |
| `tasks/models.py` | the two `use_copilot` lines. Uncommitted: `git diff HEAD` shows 7 insertions and 1 deletion |
| `tasks/test_assistant_access.py` (new) | the section 17 tests |
| `src/components/SettingsView.jsx` | the approved display correction, 15 lines |
| `src/components/SettingsView.test.jsx` | the four display tests, 117 lines |
| `src/App.settings-access.test.jsx` | one assertion and one comment, 2 additions and 1 deletion: the permission total in the access panel test was "2 of 16" and is now "2 of 17", which the new key makes necessary |

`git diff --numstat -- src tasks backend` lists four modified files, not two:
`src/App.settings-access.test.jsx` (2 additions, 1 deletion),
`src/components/SettingsView.jsx` (13 additions, 2 deletions),
`src/components/SettingsView.test.jsx` (117 additions) and `tasks/models.py`
(7 additions, 1 deletion). Two untracked paths also sit under those roots:
`tasks/test_assistant_access.py` and `src/mockups/copilot/`, which arrives with
the plan's design reference and is pinned by the proof.

`src/pencil.css` is not in that list. The header-spacing change that once sat in
it was put to the owner, who declined to approve it, so it has been reverted:
`git diff -- src/pencil.css` is empty and the file matches `d3dd143`. The
remaining paths the proof covers (build output, the known pre-existing `m5`
mockup-CSS failure) are untouched here, and no check in
`desktop/scripts/verify-web-unchanged.mjs` was amended: the owner declined both
amending the checks and accepting other evidence in their place, so the proof
keeps failing on the approved display change and this report says so rather than
relabelling it.

### 6.5 Commands run

| Command | Result |
| --- | --- |
| `python manage.py test tasks.test_assistant_access` | 12 tests, 12 pass |
| `python manage.py test` | 850 tests, 850 pass, `OK` (1419.7s) |
| `npx vitest run src/components/SettingsView.test.jsx --maxWorkers=2` | 72 tests, 72 pass (68 before, 4 added) |
| `python manage.py makemigrations --check --dry-run` | `No changes detected` |
| `npm run build` | built in 49.10s, only the existing chunk-size warning |

### 6.6 Commits prepared for this board item

The builder leaves the tree uncommitted for review, so these are the exact
messages and path lists for the person committing. Neither message contains the
word the repository hook rejects, an agent or vendor name, or a `Co-Authored-By`
line.

One unrelated artifact: `tasks/migrations/__pycache__/*.pyc` is tracked in this
repository and every Django test run rewrites it. Those files are restored after
the run and are not part of either commit.

| # | Files to stage, explicitly | Message |
| --- | --- | --- |
| 1 | `tasks/models.py`, `tasks/test_assistant_access.py` | `Require an explicit grant for managers to use the desktop assistant` |
| 2 | `src/components/SettingsView.jsx`, `src/components/SettingsView.test.jsx`, `src/App.settings-access.test.jsx` | `Show and count the desktop assistant permission correctly in manager settings` |

Commit 1 must stage `tasks/models.py` next to the test module. `main` does not
contain the permission, so staging only `tasks/test_assistant_access.py` would
commit tests for a permission the server does not have and leave the real server
change out of the history. Check with `git diff --cached --name-only` before
committing that both files are staged. Neither message needs editing for the
hook: no message above contains the word it rejects.

### 6.7 Final gate pass

Reruns after the owner's two decisions (decline the `src/pencil.css` change,
decline amending the proof), with the stylesheet change reverted:

| Command | Result |
| --- | --- |
| `cd desktop && npm run check` | typecheck clean, main bundle built, 247 tests, 0 failed |
| `npm run test -- --maxWorkers=2` | 101 files, 817 tests, 0 failed (419.83 s) |
| `cd desktop && node --test scripts/verify-web-unchanged.test.mjs` | 64 tests, 64 pass |
| `node desktop/scripts/verify-web-unchanged.mjs --phase-start d3dd143 --baseline .tmp-phase1/phase1-baseline.txt` | `RESULT: FAIL - 5 of 14 checks failed: p3, p4, b2, d1, m5` |
| the same, `--allow-mockup-css --skip-build` | `RESULT: FAIL - 4 of 13 checks failed: p3, p4, b2, d1` |

`git diff -- src/pencil.css` is empty after the revert. The builds are reproducible:
today's `dist/assets` list is identical to `.tmp-phase1/assets-no-pencil.txt`.

The run's `cause:` line attributes the asset drift to the mockup files. That is a
false attribution from the script and is recorded here rather than trusted: it
compares the hash of the seven pinned mockup files (`639650acd9138e5d`) with a hash
over those same seven plus `copilot-mockup.html` (`60c9755a16372aff`). Hashing the
mockups directly on both sides of `npm run build` gives `639650acd9138e5d` both
times, and check p6 passes in the same run. No script was changed, because the owner
declined amending the checks.
