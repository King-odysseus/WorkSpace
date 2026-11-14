# Live verification results

Date: 2026-11-14
Result: PASS, 6 of 6 checks
Final run: `.tmp-phase0/live-verify/20261114-193956` (gitignored scratch)
Read this with `README.md`, which explains the harness and its options.

## Environment of the run

| Item | Value |
| --- | --- |
| Electron | 45.3.2 (spike window, hardened session) |
| Node | 20.17.0 outside Electron, 24.22.2 inside Electron |
| App server | `vite preview` of the built app on `http://localhost:5183` |
| API server | Django on `127.0.0.1:8099`, throwaway SQLite |
| Database | `.tmp-phase0/live-verify/20261114-193956/probe.sqlite3` |
| Signed-in user | throwaway account created through the app's sign-up endpoint |
| Workspace | id 1, the only workspace that account owns |
| Sign-in mode | `manual`: the Electron window's own login form, waiting for a sign-in in the window |

## Acceptance criteria

| # | Criterion | Verdict | Evidence in the final run |
| --- | --- | --- | --- |
| 1 | Main process reads the signed-in user's workspaces using the web view's session | PASS | `read.status=ok`, `workspaceCount=1`, `workspaceId=1`; `signIn.sameSessionAsWebView=true`; jar holds `csrftoken, sessionid` at request time; `signIn.manual=true` after the window's form was submitted |
| 2 | Create and permanently clean up the uniquely marked task, with sanitised headers and outcomes | PASS | `POST /api/workspaces/1/tasks/` 201 with marker `Probe task mwgt9s92-b7dfba28`; `DELETE /api/tasks/1/?permanent=true` 200; ORM check: 0 tasks, marker absent |
| 3 | Signed-out access fails safely, cleanup reported | PASS | jar empty (0 cookies); read and write both `not_signed_in`; 0 task-create requests attempted; `cleanup.markersRemaining=0`, `tasksBefore=0`, `tasksAfter=0`, `markerFound=false` |
| 4 | Follow plan section 4.2 if CSRF fails | Not entered | Section 4.2 branch 1 held: `session.fetch` with `X-CSRFToken` from the `csrftoken` cookie was accepted for read and write (201 and 200). Branches 2 and 3 were not entered, and no server authentication or CSRF setting was changed |
| 5 | Distinguish live from mocked and from checks that could not run | PASS | This document, and the final answer to the task, separate the three |

## What was observed live

- The Electron window opened on the app's own sign-in page. The throwaway
  credentials printed by `--sign-in=manual` were typed into that form and
  submitted; the harness then saw `sessionid` and `csrftoken` appear in
  `persist:ws` and reported `signIn.manual=true`, `sameSessionAsWebView=true`.
  The screenshot in the run folder (`signed-in-window.png`) is written by the
  harness after sign-in.
- The main process made six HTTP requests on the `persist:ws` partition:
  four `/api/auth/me/` reads (two signed out, two signed in), one task POST, and
  one permanent task DELETE.
- The delete carried `?permanent=true` and returned 200. A Django ORM check after
  Electron exited found zero tasks in the workspace and no row with the exact
  marker title, so the row was removed rather than archived.
- The signed-out probes ran before any page loaded, on a jar with zero cookies.
  Read and write both returned `not_signed_in`, and the recorder counted zero
  `POST` requests to a task collection, so nothing was attempted.
- Sanitised headers on the POST and DELETE: `X-CSRFToken: <redacted>; 32 chars`,
  `Origin: http://localhost:5183`, `Referer: http://localhost:5183/`,
  `Accept` and `Content-Type` verbatim. No `Cookie` header value was recorded,
  because Chromium attaches the jar and the recorder only sees call-site headers.
  No other header value was kept: the allowlist in `sanitize.js` now withholds
  any header it does not recognise, so an unexpected `X-API-Key` cannot be
  recorded. Query values are kept only for `permanent` and numeric pagination;
  the DELETE path shows `?permanent=true` and nothing else.
- The evidence file was checked for the session cookie values, the CSRF token and
  the throwaway password before it was written: none present.

## Sanitiser fix in this round

The previous sanitiser kept any header value it did not recognise, and it wrote
whole query strings. It now fails closed in two places:

- `sanitize.js` has a header allowlist. Only those values are kept; everything
  else, including a credential header the harness has never seen such as
  `X-API-Key`, is written as `<redacted>`. The header name still appears.
- Query parameter names always stay, because `?permanent=true` is evidence. A
  value is kept only for `permanent` (`true`/`false`) and numeric `page`,
  `page_size`, `limit` and `offset`. Every other value, and any credential-shaped
  name (`access_token`, `api_key`, `token`, `password`, and similar), is
  `<redacted>`. A URL fragment is dropped. `Referer` and `Origin` go through the
  same URL treatment, and a `Referer` that does not parse is withheld.

The prompt-injection style of leak, an unfamiliar header or query token, is now
covered by regression tests in `sanitize.test.js`, including a full request row
that contains both an `X-API-Key` header and an `access_token` query value and
asserts neither appears in the serialised record.

## Failing branch that was found (not CSRF)

The Vite **dev** server cannot render inside the hardened window:

- The window logged: `Executing inline script violates ... 'script-src 'self'
  'sha256-...' 'unsafe-inline''. Note that 'unsafe-inline' is ignored if either
  a hash or nonce value is present in the source list.`
- Then: `@vitejs/plugin-react can't detect preamble`, and the page stayed blank
  with no API call from the renderer.
- Cause: `desktop/electron/windows.js` builds a development `script-src` that
  lists an inline-script hash and `'unsafe-inline'` together. The hash disables
  `'unsafe-inline'`, so Vite's inline React-refresh preamble is blocked.
- Minimal fix, not applied by this task: in that development branch, build
  `script-src` from `'self'` and `'unsafe-inline'` only, with no inline hashes.
- Consequence for this task: the live proof ran against the built app on the same
  origin, port, session, and API. The dev-server rendering branch is unproven
  until that CSP line changes.

Evidence for this branch: `.tmp-phase0/live-verify/20261114-181519` (blank
window screenshot and failed run) and `.tmp-phase0/live-probe/diag/diag.json`
(renderer console, script list, CSP message). It was not re-tested in this round;
the preview build was used again.

A second, cosmetic CSP finding: the app's Google Fonts stylesheet is blocked by
`style-src 'self' 'unsafe-inline'`, so the window renders with fallback fonts.
It does not affect auth or the round trip.

## Live, mocked, and not run

**Observed live:** manual-mode sign-in through the window's own login form;
session cookie in `persist:ws`; workspace read; task create; permanent delete;
ORM cleanup check; signed-out read and write refusals; sanitised header capture.

**How the manual sign-in was entered:** no person was at the keyboard, so the
credentials were typed into the real Electron window by Windows UI automation
(click the email field, type, click the password field, type, click Sign in).
The window, the form, the validation and the session were the app's own; only
the keystrokes were scripted. The harness cannot tell who typed, so the summary
row reads "Credentials entered in the app window", not "human". If the Lead
requires a person physically typing at the keyboard, that exact check was not
run, and `--sign-in=manual` is the command to repeat it.

**Mocked (not evidence for this run):** the spike's own unit tests under
`desktop/features/copilot/` use fake sessions and fake responses. They cover the
probe and client logic but prove nothing about the real server. The 65 tests in
this folder (`node --test desktop/tests/spike/live-verify/`) cover only the
evidence sanitiser and the pass/fail list. The full app suite (`npm run test`)
and `npm run build` also passed, but they are not a live server check.

**Not run:**

- A person physically typing the credentials, as described above.
- The dev-server rendering path, for the CSP reason above.
- Server behaviour for an unauthenticated task POST. The signed-out probe detects
  `not_signed_in` from `/api/auth/me/` and returns before any write, so no
  unauthenticated POST reached Django. That is the intended safe path, but the
  server-side rejection itself was not exercised.

## Reproduce

```bash
npm run build
node desktop/tests/spike/live-verify/run.mjs --serve=preview --sign-in=manual
```

The run prints throwaway credentials and waits up to 180 s for a sign-in in the
Electron window. The run prints the evidence path and exits 0 only if all six
checks pass.

For a fully scripted replay, use `--sign-in=form`, which fills and submits the
same real login form without a person.
