# Phase 1 acceptance report

Section 22 report for Phase 1: shell, gating, access.

- Phase start commit: `d3dd143` (main). Nothing from Phase 1 is committed yet: the
  crew leaves changes uncommitted for the owner to review.
- Evidence annex: `desktop/reports/phase-1.md` holds the per-board-item record.
  This file is the phase-level report.
- Raw output for every command below lives in `.tmp-phase1/` (ignored by git).
- This final board item changed no product code. It reverted the declined
  `src/pencil.css` change, corrected this report and the evidence annex, and reran
  the checks those two things affected.

Status in one line: **Phase 1 is not cleared.** Every code check passes, but the
section 5 "web app is unchanged" proof does not, and the owner has now declined
both ways of closing it, so the proof is left exactly as the plan wrote it. The two
decisions that were open are recorded: the unapproved header-spacing change in
`src/pencil.css` was declined and has been reverted, and no check in
`desktop/scripts/verify-web-unchanged.mjs` was amended. Strictly, five of its
fourteen checks fail: p3, p4, b2, d1 and m5. Under the owner's approved decision on
the mockup stylesheet, m5 is recorded as a warning instead of relabelled, leaving
four: p3, p4, b2 and d1. Sections 3, 4 and 5 give the exact output and the one
decision that would unblock the rest.

## 1. What was built (files and behaviour)

Desktop shell, in `desktop/electron/`:

- `main.js` - the entry point. Single-instance lock (a second launch focuses the
  first window), app lifecycle, and the smoke-test switches.
- `shell-window.js` - one frameless `BaseWindow` holding three views: local
  chrome, the unchanged WorkSpace web app, and the assistant. Applies
  `computeShellLayout` on every resize. Close hides to the tray; explicit quit
  ends the app; with no tray icon close ends the app.
- `windows.js` - the web view. Its own `persist:ws` session, no preload, and the
  navigation and popup rules from Phase 0, including the Google sign-in popup.
- `dev-flags.js` - debug and smoke switches are refused when the app is packaged.
- `preload/shell.js` - the only bridge. Two named, frozen bridges
  (`zuriShell`, `zuriAccess`) with fixed methods and fixed channels; no generic
  invoke; one shared transport so the drift guard has one call site.
- `preload/copilot.js`, `debug-window.js` - the Phase 0 probe surfaces, unchanged.
- `shell-smoke.js` - 40 assertions against a real Electron window.

Shared contracts, in `desktop/features/copilot/shared/`:

- `shell-contract.ts` - modes, dock, window actions, channels.
- `ipc-contract.ts` - zod schemas for every probe request and reply; unknown
  fields are refused.
- `access-contract.ts` - zod schemas for access state, workspaces, managers,
  failures and lock reasons.
- `access-screen.ts` - one pure function that decides which screen to draw
  (unverified, pending, gate, panel, content), so the decision is testable
  without a browser.

Main process, in `desktop/features/copilot/main/`:

- `shell/session.ts`, `shell/layout.ts`, `shell/menu.ts`, `shell/tray.ts`,
  `shell/ipc.ts` - mode state, geometry, native menu, tray menu, and the trusted
  sender registry that both bridges share.
- `ipc/handlers.ts`, `ipc/index.ts` - probe IPC with zod validation on the way in
  and on the way out.
- `security/keychain.ts` - secrets held only as `safeStorage` ciphertext, no
  plain-text fallback, refuses when encryption is unavailable, logs only the
  checked name.
- `workspace-api/client.js`, `index.js` - fixed endpoint wrappers over the web
  app's own session: CSRF handling, 1 MB response cap, timeout, redirect refusal,
  fixed error codes.
- `access/store.ts`, `access/service.ts`, `access/controller.ts`, `access/ipc.ts` -
  eligibility, read-edit-write permission changes, locking, and the access IPC
  surface.

Renderer, in `desktop/renderer/src/`:

- `App.tsx` - draws nothing without a shell bridge.
- `ShellChrome.tsx` - title bar and rail, mode switching, dock toggle.
- `CopilotView.tsx` - the assistant frame in full and dock shape, now driven by
  `access-screen.ts`.
- `AccessGate.tsx` - the ask-an-owner and sign-in screens, plus "check again".
- `WorkspaceAccessPanel.tsx` - workspace list, owner grant and revoke, sign out.
- `ProbeView.tsx` - the Phase 0 probe screen.

Behaviour a person can use now:

- Switch between Workspace mode, full ZuriCopilot mode, and the 360px dock; the
  web session survives every switch because the web view is hidden, not rebuilt.
- Tray icon, native menu, accelerator to toggle the dock, restore from the tray.
- Sign out of the assistant, or have access withdrawn, and the assistant locks.
- See only owned workspaces and manager workspaces an owner has granted; an
  owner can grant or revoke the assistant for each manager, keeping that
  manager's other permissions.
- No assistant chat, approvals, runs or data exist yet. The screens behind the
  access gate are honest empty states, by design.

Server change (section 17), in `tasks/models.py`:

- `use_copilot` is a workspace permission. Owners qualify without holding the key,
  managers qualify only when granted it, members never do, and it is excluded
  from the manager default set.

Web display change, in `src/components/SettingsView.jsx`:

- The manager permission list shows and counts the new key.

## 2. How it was tested

Commands and results, all run on Windows, Node 20.17.0, npm 10.8.3,
Python 3.13.14.

| Command | Result |
| --- | --- |
| `cd desktop && npm run check` | typecheck clean, main bundle built, **247 tests passed, 0 failed**, exit 0 |
| `cd desktop && npm run shell:smoke` | real Electron window, **40 of 40 checks passed**, `ok: true`, `failed: []` |
| safeStorage round trip (scratch script, `.tmp-phase1/keychain-smoke.cjs`, run with `npx electron`) | **11 of 11 checks passed**, `encryptionAvailable: true`, secret never in a log line |
| `cd desktop && node --test scripts/verify-web-unchanged.test.mjs` | 64 passed, 0 failed |
| `cd desktop && node --test tests/spike/live-verify/*.test.js` | 65 passed, 0 failed |
| `npm run test -- --maxWorkers=2` (root) | **101 files, 817 tests passed**, 419.83 s, exit 0 (rerun for the final state) |
| `python manage.py test` | **Ran 850 tests in 1431.718 s, OK**, exit 0 |
| `python manage.py test tasks.test_assistant_access` | Found 12 tests, OK |
| `node desktop/scripts/verify-web-unchanged.mjs ...` | **FAIL**, 5 of 14 checks (section 3) |

Three rows are retained rather than rerun: the backend suite, the Electron shell
smoke test and the `safeStorage` round trip. None of them reads a file this task
touched, and no backend or desktop source file changed after them. The desktop
check, the frontend suite and the proof script's own tests were all rerun after the
stylesheet revert described in section 4.

The 247 desktop tests break down as 213 in `desktop/features/copilot` and 34 in
`desktop/electron`. The Electron smoke test covers: startup, chrome and assistant
pages loaded, web view on `persist:ws`, web view has no preload and no bridge,
layouts in all three modes, resize, theme propagation, menu accelerators, tray
created, close hides to tray, restore from tray, single-instance handover.

Real models used: **none**. Phase 1 makes no provider calls, so no cloud or local
model was contacted.

Not tested, stated plainly:

- No desktop test contacted a real WorkSpace server. The access layer is tested
  against stubs. The Phase 0 live probe against a running server was not repeated.
- The Electron smoke test loads a local placeholder in the web view, so the real
  WorkSpace web app inside the shipped shell was not exercised.
- The packaged build and the installer (`scripts/install-local.ps1`) were not run
  against a real install; only the script's own tests ran.
- Windows only. Nothing was run on macOS or Linux.
- The first full frontend run before the fix in section 4 reported 1 failed
  (816 passed) out of 817: `src/App.settings-access.test.jsx` expected the old
  permission total. After that fix, the clean run above passed.

## 3. Web app unchanged: the section 5 outputs

The plan lists six outputs in section 5 (it calls them five). All six are pasted.

### Output 1: the protected-path diff is empty, except the approved change

Committed diff at this state (nothing is committed, by instruction):

```
$ git diff --stat d3dd143..HEAD -- src tasks backend package.json package-lock.json vite.config.js
(no output)
```

Working tree, which is where the phase's changes actually are:

```
$ git diff --stat -- src tasks backend package.json package-lock.json vite.config.js
 src/App.settings-access.test.jsx     |   3 +-
 src/components/SettingsView.jsx      |  15 ++++-
 src/components/SettingsView.test.jsx | 117 +++++++++++++++++++++++++++++++++++
 tasks/models.py                      |   8 ++-
 4 files changed, 139 insertions(+), 4 deletions(-)

$ git status --porcelain --untracked-files=all -- src tasks backend | grep '^??'
?? src/mockups/copilot/Chat.jsx        (and 6 more pinned mockup files)
?? tasks/test_assistant_access.py
```

Read honestly: the committed diff is empty only because nothing is committed. The
real change set is the four files above plus one new test module, and it is four
rather than five because the header-spacing change that used to sit in
`src/pencil.css` was declined by the owner and has been reverted:
`git diff -- src/pencil.css` is now empty. Three of the four paths are covered by an
owner approval (section 4), the server change and the display correction. The
fourth, `src/App.settings-access.test.jsx`, is the one-assertion edit that keeps the
access panel's permission total honest; without it the frontend suite is red.

### Output 2: the build output has the same hashed names

It does not. It cannot, once a web file changes.

The Phase 1 baseline is a build of the `d3dd143` tree, taken before this phase's web
change and saved as `.tmp-phase1/phase1-baseline.txt` (27 names). It had to be
re-recorded because the committed Phase 0 baseline is stale: it was taken eight
commits before this phase started.

```
2. Production build
  PASS  npm run build passed in 25.8s, 3172 modules transformed
  FAIL  asset list changed: 24 missing, 24 added
        missing from the build: BulkActionBar-C4WuXxPu.js
        missing from the build: ChatViews-CQT4NRL8.js
        ... (24 lines; full list in .tmp-phase1/verify-strict.log)
        added by the build: SettingsView-W7gVL-am.js
        added by the build: TaskViews-DDV4pVLZ.js
        ... (24 lines)
```

Twenty-four of 27 names moved. The three that held are `ChatViews-C6ZEh_QS.css`,
`index-D6NMtPCh.css` and `SettingsView-CWvdQrQt.css`, so every JS chunk renamed and
none of the CSS chunks did.

The comparison is reproducible, and today's build is the same set that was recorded
earlier as "the stylesheet change reverted", byte for byte:

```
$ ls dist/assets | sort | diff - .tmp-phase1/assets-no-pencil.txt
(no output)

set A  phase-start tree (d3dd143, before the web change)   27 names, arrow-down-C8IP0ixm.js
set C  this working tree (SettingsView changed)            27 names, arrow-down-CC8CheUL.js

A vs C: 3 names identical, 24 different
```

One changed build input renames the chunk set, so the check is all-or-nothing, and
the change responsible is the approved `SettingsView.jsx` correction. The mockup
sources are not the cause: check p6 passes in the same run with the phase-start
fingerprint. The `cause:` line the run prints below the list is a false attribution
and is recorded here rather than trusted: it compares the fingerprint of the seven
pinned mockup files (`639650acd9138e5d`) with a fingerprint over those seven plus
`copilot-mockup.html` (`60c9755a16372aff`). Two different file sets, so the note
reads as drift when no file has moved. Hashing the mockups directly, on both sides
of a build, gives `639650acd9138e5d` every time.

The owner declined both amending this check and accepting other evidence in its
place, so it is recorded as a real failure.


### Output 3: no Copilot content in dist/

It is not empty:

```
$ grep -ril copilot dist/
dist/assets/SettingsView-W7gVL-am.js

$ grep -oi ".\{40\}copilot.\{40\}" dist/assets/SettingsView-W7gVL-am.js
],["view_reports","View reports"],["use_copilot","Use desktop assistant"]],va=l=>ht.red
```

The single match is the permission key itself, which the approved display change
must send to the server. The visible label is "Use desktop assistant"; only the key
carries the word. No assistant code, no mockup page, and no image ships. The owner
declined amending this check, so it stays a failure.

### Output 4: the frontend suite passes

```
$ npm run test -- --maxWorkers=2
 Test Files  101 passed (101)
      Tests  817 passed (817)
   Duration  419.83s
VITEST_EXIT=0
```

### Output 5: the backend suite passes

Retained from earlier in the phase and not rerun for this task, because no backend
file changed after it.

```
$ python manage.py test
Ran 850 tests in 1431.718s
OK
DJANGO_EXIT=0
```

### Output 6: the mockups are not build inputs

Inputs are clean: `vite.config.js` has no rollup or input override, `index.html`
has exactly one module script (`/src/main.jsx`), no `dist/` file carries the
mockup-only marker text, and no mockup page is emitted.

The stylesheet is not independent of the mockups:

```
  FAIL  121 mockup-only classes reach the production stylesheet: -mx-2, -right-1,
        -right-12, -top-1, -top-16, -translate-y-full, @3xl:flex, @3xl:flex-col
        the mockups are not build inputs, but Tailwind scans them and their selectors ship
        exclude the mockup folder from the Tailwind sources, or pass --allow-mockup-css to record the coupling
```

Under the owner's approved decision I ran it once more with
`--allow-mockup-css`. That records it as a warning and does not relabel it:

```
  WARN  121 mockup-only classes reach the production stylesheet: ... (allowed by --allow-mockup-css)
        this run does not prove the app stylesheet is independent of the mockups
RESULT: FAIL - 4 of 13 checks failed: p3, p4, b2, d1
```

Strict result, which is the one that counts:
`RESULT: FAIL - 5 of 14 checks failed: p3, p4, b2, d1, m5`. The approved warning is
not expanded to anything else: the mockup-CSS coupling is exactly what it was at
phase start, and the Tailwind source exclusion was not approved.

## 4. Deviations from this plan, with reasons

1. **`zod` and TypeScript, both approved before this board item.** The plan
   assumes dependencies it never names; the owner approved them. Used for the
   IPC contracts and the desktop build.

2. **The `use_copilot` server change (section 17), approved.** Textual only:
   `tasks/models.py` plus a new `tasks/test_assistant_access.py`. No migration,
   and the existing `member_detail` endpoint carries the write.

3. **A web-app change the plan's hard stop would otherwise forbid: the manager
   permission display, approved.** `src/components/SettingsView.jsx` and its
   tests. The screen could not show or count the new key, so an owner could not
   grant it at all.

4. **One extra web test edit, mine, not separately approved.**
   `src/App.settings-access.test.jsx` asserted "2 of 16 granted"; with the new
   key the honest total is 17, so the assertion and a one-line comment changed.
   Without this the frontend suite is red, which is worse than the edit. It was
   the only product file changed for that board item.

5. **`src/pencil.css`: the change that was here has been reverted.** The shell
   board item right-pinned the header actions at interior widths with one media
   query. That is a web-app change and it had no approval, so it was put to the
   owner, who declined to approve it. It is gone: `git diff -- src/pencil.css` is
   empty and the file matches `d3dd143`. Nothing else in the shell work depended on
   it, and the desktop check was rerun afterwards and still passes.

6. **The strict asset baseline was stale, so I re-recorded one.** See output 2.
   Nothing in the repository changed: the new baseline lives in `.tmp-phase1/`.

7. **The mockup-to-stylesheet coupling is retained, not fixed, under the approved
   decision.** The real fix is a Tailwind source exclusion, which is a `src/`
   change and therefore needs its own approval. The owner approved keeping it as
   the documented `--allow-mockup-css` warning, so it is a recorded decision, not an
   open question.

8. **The desktop controls are drawn locally instead of importing Flowbite
   `Button` and `Card`.** The house style is square, borderless, shadowless; the
   Flowbite components are round or bordered. An earlier review accepted this, and
   a test blocks any second stylesheet. Shared tokens are still consumed.

9. **The desktop tests are `node:test`, not vitest, and there is no `npm test`
   script there.** They run through `npm run check`, which the README documents.

10. **The proof script has no carve-out for the approved `use_copilot` change.**
    Section 5 of the plan allows it in prose; `verify-web-unchanged.mjs` does not
    implement it, so p1 fails the moment the approved server change is committed,
    and d1 fails now. The owner was offered two ways out - amend the proof, or
    accept the isolation evidence instead of a name-to-name match - and declined
    both. So the proof is left exactly as written and keeps failing. This is
    recorded, not papered over.

## 5. Decisions recorded, and the one that is still needed

### 5.1 What the owner decided

1. **The header-spacing change in `src/pencil.css`: declined, and reverted.** The
   file is now identical to `d3dd143`, so it is no longer an exception of any kind.
   Output 1 lists four changed files, not five.

2. **Amending the web-unchanged checks: declined.** No check, allowance list or
   ignore rule in `desktop/scripts/verify-web-unchanged.mjs` was changed for this
   phase, and nothing was accepted in place of a name-to-name asset comparison. The
   acceptance criteria allow an amended check only if tests prove that unrelated web
   changes and assistant content still fail it; since nothing was amended, no such
   tests were added, because there is no amendment for them to guard. Outputs 2 and
   3 therefore stay red exactly as the plan wrote them.

3. **The 121 mockup-only classes: approved as the documented `--allow-mockup-css`
   warning.** The strict run still fails m5; the approval changes how it is reported,
   not what it says, and it is not extended to anything else. The Tailwind source
   exclusion was not approved.

4. **The approved display correction is assessed on the plan's own terms.**
   `src/components/SettingsView.jsx` and its tests, plus the one-assertion permission
   total in `src/App.settings-access.test.jsx`, keep the manager permissions panel
   able to show, count and revoke the new key. No other web file changed.

### 5.2 Why Phase 1 is still blocked

Outputs 2 and 3 cannot pass while the approved display change exists: one changed
build input renames every JS chunk, and the permission key itself has to ship.
p3 and p4 also fail while the work is uncommitted, which this crew run requires.
That leaves four failing checks, three of them by rule and one approved as a
warning. None of them is caused by the desktop code, the server change, or the
approval set.

**Verdict: Phase 1 is not cleared. It is blocked on the proof's missing rule for an
approved web change, not on any code defect.**

### 5.3 The one decision that would unblock it

The proof needs a rule the plan does not have: how an approved web change is
represented. Amending the check and accepting other evidence have both been
declined. A third option needs neither, and can be run without touching the script:

1. Commit the two prepared commits, which clears p3 and p4.
2. Record b2 and d1 with the approved files named: compare a build of the working
   tree against a build of the same tree with only `src/components/SettingsView.jsx`,
   `src/components/SettingsView.test.jsx` and `src/App.settings-access.test.jsx`
   reverted. If the only difference is those three files, the web output moved for
   the approved reason and nothing else.

That is a build and a `diff`, not a code change, so it needs no approval of its own.
It is a recommendation, not a result: deciding that the phase is ready to record
belongs to the owner.

### 5.4 Outside this gate

5. **Re-record the committed Phase 0 baseline**
   (`.tmp-phase0/dist-assets-baseline.txt`) at `d3dd143`, or keep passing `--baseline`
   explicitly. The committed baseline is eight commits stale.

6. **Commit and push.** Two commits are prepared in `desktop/reports/phase-1.md`
   section 6.6, with path lists that include every changed file, including
   `tasks/models.py`. The repository hook rejects the word in the product's own name,
   so those messages say "desktop assistant".

7. **A product decision for a later phase:** demoting a granted manager to member and
   promoting them back restores the grant, because a role change does not clear
   stored permissions. Revoking through the permission switch, the shipped path,
   behaves correctly and is tested.

8. **Phase 2 (provider layer) waits on this gate.** It should not start while the
   proof is failing, because it adds the first provider secrets and the first real
   model calls.
