# ZuriCopilot desktop (Phase 0 spike)

Self-contained Electron package for the Phase 0 spike described in
`docs/zuricopilot-plan.md` (section 19, Phase 0) and bounded by
`desktop/reports/phase-0.md`.

The web app's build never reads this folder: the root Vite config has
`index.html` as its only input, and nothing here is imported from `src/`. The
reverse is also true, except for read-only reuse of design tokens and UI
primitives in later phases.

## Commands

Run from `desktop/`:

| Command | What it does |
| --- | --- |
| `npm install` | installs this package's own dependencies (Electron only); needs Node 22.12 or newer |
| `npm start` | boots the shell window, and in development the probe view alongside it |
| `npm run start:smoke` | boots the web view path with the window hidden, prints the Electron/Node/contract versions and exits 0 once the page loads. This is how the start command is checked without leaving a window on someone's desktop. |
| `npm run probe:smoke` | boots the probe view hidden and checks it end to end: the bridge, a read and a write, the table it renders, an injected inline script, a blocked network call and a blocked navigation. Exits 0 only if every check passes, and never touches a server. |
| `npm run check` | runs the contract tests with Node's built-in test runner (no test framework dependency). The script names the test file explicitly: `node --test <dir>` fails on Node 22 and a glob fails on Node 20, so a second contract test file must be added to the script. |

Nothing in these scripts runs from the repository root, and no root script,
dependency or build setting is required to use them.

## What exists here now

```
desktop/
  package.json                      Electron only
  electron/main.js                  wiring: web view, probe, IPC registration, probe view
  electron/windows.js               the WorkSpace web view: policy, navigation, hardened prefs
  electron/debug-window.js          the probe window: its own session, guards, no navigation
  electron/debug.html               the throwaway probe view, one file, hash-pinned CSP
  electron/preload/copilot.js       window.copilot.probe.read/write and nothing else
  features/copilot/main/ipc/        the IPC boundary, its tests
  features/copilot/main/workspace-api/  the probe client and its tests
  features/copilot/shared/          the probe contract and its tests
```

Deliberately absent, because other tasks own them: every production screen,
provider, local database, docking layout and the `use_copilot` permission.

## Dependencies and versions

- **Electron only.** `docs/zuricopilot-plan.md` section 21 lists TypeScript,
  Vite, the React plugin and zod as dependencies to request in the phase that
  first needs them. None is approved yet, so none was added: the contract,
  validation and tests are hand-written plain JavaScript. Asking for zod is
  the natural next step if the contract grows past a few scalar fields.
- **Electron 45, a currently supported major.** Electron only ships security
  fixes for the latest three stable majors, so the earlier 39 pin was dropped:
  it had passed end of life and no longer received Chromium security fixes.
  At this pin the supported majors are 43, 44 and 45, and 45.3.2 is the newest
  stable release. Keep this on a supported major; check
  https://www.electronjs.org/docs/latest/tutorial/electron-timelines when
  bumping.
- **Node 22.12 or newer to install.** Electron 40 and later install through
  `@electron/get` 5, which is ESM-only and declares `node >= 22.12`. Run
  `npm install` here with Node 22.12+ (CI already uses Node 22). This is an
  install-time requirement only: once installed, `npm start` and
  `npm run check` also run on Node 20, because the app ships its own Electron
  runtime. The `engines` field in `package.json` records the requirement.
- No packaging tooling yet: nothing is packaged, so there is no builder config
  to keep in step.

## The probe contract

`features/copilot/shared/probe-contract.js` is the only agreed shape for
requests and results. It is plain CommonJS with no Electron import, so the main
process and the test runner load the same file.

- One channel: `copilot:probe:run`.
- A request is `{ action: 'read' | 'write', confirmWrite: boolean }` and
  nothing else. Validation **rejects** unknown keys, so a renderer cannot
  supply a URL, path, method, header, body or workspace id and have it
  honoured. `read` lists the signed-in user's workspaces; `write` creates and
  then deletes one probe task, and is refused unless `confirmWrite` is `true`.
- A result is rebuilt from a fixed field list: contract version, action,
  status, error code, HTTP statuses, duration, ISO timestamp, workspace count
  and id, and the created/deleted booleans. Everything else is dropped, so
  cookies, CSRF tokens, response bodies and email addresses cannot reach a
  window even by accident.
- Errors are codes from a fixed vocabulary (`csrf_rejected`, `http_error`,
  `network_error`, `no_workspace`, `not_implemented`, `not_signed_in`,
  `unknown`). Server or provider text is never passed through, because it can
  echo credentials.
- `isSanitizedProbeResult` is the stricter boundary check: exact key set, enum
  values only, and an ISO timestamp as the only free-looking string.

Changing this contract needs the lead's approval and a note in the phase
report (plan section 22).

## The probe view and its bridge

One local page (`electron/debug.html`) over one preload. It is not the web view
and shares nothing with it.

- **Two methods, no generic invoke.** `window.copilot.probe.read()` and
  `.write()` take no arguments and send one fixed request each. The preload
exposes no `ipcRenderer`, no channel parameter and no subscription, so page code
cannot name a channel of its own. A sandboxed preload cannot import a project
file, so the channel name is repeated as a literal in the preload and a test
asserts it equals `PROBE_CHANNEL`.
- **The sender is checked, not assumed.** `features/copilot/main/ipc/probe-ipc.js`
trusts one `webContents` id and one local page URL. A request from another
window, from a frame inside the trusted page, or from a page that navigated
elsewhere is refused before the request is read. A refusal answers `null`, so it
reveals neither the reason nor anything about the server.
- **The answer is narrowed twice.** A probe result is sanitized and then re-read
by `isSanitizedProbeResult` before it leaves. If either step fails, the caller
gets a sanitized failure rather than a wider object.
- **One run at a time.** A second request while one is in flight is refused, so
the view cannot start two task creations.
- **The renderer has no session.** The probe view runs in a non-persistent
partition (`spike-probe-view`), not `persist:ws`, so it holds no cookies. Every
request is made by the main process on the web view's session.
- **Strict CSP, no navigation.** The page carries its own policy: `default-src
'none'`, one inline script and one inline style allowed by hash, `connect-src
'none'`, no `'unsafe-inline'`, no `'unsafe-eval'`, no remote source. Navigation,
redirects, popups and webview attachment are all refused outright, and the
session grants no permission at all.

`npm run probe:smoke` checks all of this in a real Electron window, with a
fixture probe so it needs no server and creates nothing.

The probe view opens automatically in development and can be turned off with
`npm start -- --no-probe-view`. A packaged build only opens it with
`--probe-view`.

## Notes for the next tasks

- Keep `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`,
  and keep the bridge on the probe view only. The WorkSpace web view must never
  receive this preload (plan section 4.1).
- Workspace and task ids belong to the probe's own throwaway workspace, per
  the isolation rules in `desktop/reports/phase-0.md` section 4. Set
  `ZURICOPILOT_PROBE_WORKSPACE_ID` to that workspace's id; a blank or invalid
  value makes writes answer `no_workspace` rather than picking a workspace.
- Anything new on this channel is a new contract field, so it needs the lead's
  approval rather than an extra key in the request.
