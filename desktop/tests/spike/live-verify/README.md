# Live verification harness (Phase 0)

Runs the desktop spike against a throwaway copy of the stack and records what the
Electron main process actually sent and received. Nothing here mocks the network:
one real Django server, one real web app, one real Electron window, one real
signed-in session.

The harness answers three questions with evidence:

1. Can the main process read the signed-in user's workspaces over the same
   `persist:ws` session object the web view uses?
2. Can it create a uniquely marked task and delete it permanently, with the CSRF
   token taken from that session's cookie jar?
3. With no session, do both probes refuse with `not_signed_in` and attempt no
   task creation at all?

## Isolation

- Database: a new SQLite file at
  `.tmp-phase0/live-verify/<stamp>/probe.sqlite3`, migrated from scratch. The
  `.tmp-*` pattern is gitignored, and the harness refuses to start if
  `DATABASE_URL` is set, so it can never attach to a real database.
- Electron: its own `userData` directory inside the run folder, so a developer's
  real desktop session cannot satisfy the check. The partition name stays
  `persist:ws`, which is the thing under test.
- Ports: the app on `5183` (a CSRF-trusted loopback port) and Django on `8099` by
  default. The harness refuses to start if either is in use and never kills a
  server it did not start.
- It does not change `src/`, `tasks/`, or `backend/settings.py`. The account is
  created through the app's own sign-up endpoint.

## Run it

```bash
# Built app, isolated servers, automated sign-in through the real login form
npm run build
node desktop/tests/spike/live-verify/run.mjs --serve=preview --sign-in=form

# Manual sign-in: a person types into the visible window
node desktop/tests/spike/live-verify/run.mjs --serve=preview --sign-in=manual
```

Manual mode prints the throwaway email and password to the terminal. Sign in with
them in the WorkSpace window that opens; the run continues by itself once the
`sessionid` cookie appears in the partition.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--sign-in=manual\|form` | `manual` | Who signs in: a person, or the harness filling the real form |
| `--serve=dev\|preview` | `dev` | Serve the Vite dev app, or the built app from `dist/` |
| `--api-port=<int>` | `8099` | Port for the throwaway Django server |
| `--sign-in-timeout-ms=<int>` | `180000` | How long to wait for the session cookie |

Exit codes: `0` every check passed, `1` a check failed (evidence is still
written), `2` the run could not be set up (port busy, no database, no `dist/`).

### Why `--serve=preview` and not the dev server

The dev server cannot render inside the hardened window. Its HTML contains an
inline React-refresh preamble, and the desktop Content Security Policy for a
loopback origin lists both a script hash and `'unsafe-inline'`. A hash cancels
`'unsafe-inline'`, so the preamble is blocked and React never mounts. The window
stays blank and no API call is made.

The minimal fix, if the dev-server path is wanted, is in
`desktop/electron/windows.js`: when `config.isDevelopment` is true, build
`script-src` from `'self'` and `'unsafe-inline'` only, without the inline-script
hashes. The harness itself does not change that file. The built app has no inline
preamble, so `--serve=preview` exercises the same session, API, and CSRF paths
without the defect.

## Evidence

The run writes into `.tmp-phase0/live-verify/<stamp>/` (gitignored):

| File | Contents |
| --- | --- |
| `evidence.json` | The authoritative record: probes, requests, checks, cleanup |
| `summary.md` | The same run as a readable report |
| `signed-in-window.png` | Screenshot of the web view after sign-in (when rendering works) |
| `electron-raw.json` | The Electron process's own record before merging |
| `django.log`, `vite.log`, `electron.log`, `migrate.log` | Server and process output |

`evidence.json` keeps every HTTP exchange the probes made: step, method, path,
status, duration, the header set, and the body. Headers are sanitised before they
are written, and the rule is an allowlist rather than a list of known secrets:

- A header value is kept only when its name is in the allowlist: `Accept`,
  `Accept-Encoding`, `Accept-Language`, `Cache-Control`, `Connection`,
  `Content-Length`, `Content-Type`, `DNT`, `Host`, `Origin`, `Pragma`, `Referer`,
  `Sec-Fetch-Dest`, `Sec-Fetch-Mode`, `Sec-Fetch-Site`, `Transfer-Encoding`,
  `Upgrade-Insecure-Requests`, `User-Agent`.
- Any other header value is withheld with `<redacted>`, including a credential
  header the harness has never seen such as `X-API-Key`. The header name still
  appears, so the recorded header set is complete. This is the difference from a
  denylist: a new header cannot leak by default.
- `Cookie` keeps only the cookie names, never the values.
- `X-CSRFToken` keeps its presence and length, never the token.
- `Origin` and `Referer` are URL values, so their query strings get the same
  redaction as a request URL. A `Referer` that does not parse as a URL is
  withheld.
- In a URL, every query parameter name is kept, because `?permanent=true` on a
  DELETE is evidence. Its value is kept only for `permanent` (`true` or `false`)
  and for numeric `page`, `page_size`, `limit` and `offset`. Any other value, and
  any credential-shaped name such as `access_token`, `api_key` or `token`, is
  written as `<redacted>`. A fragment is dropped, so an implicit-flow token
  cannot ride along.
- A request body keeps the task title only when it carries the probe's own
  `Probe task ` marker; anything else keeps its key names only.

Before writing, the run checks the serialised record for the session cookie
values, the CSRF token, and the throwaway password. If any of them appear, the
record is discarded and only a `evidence_withheld` note is written. That scan is
a second line of defence only: it knows the password and the cookie values, not
a credential header the harness has never seen. The header allowlist and the
query redaction are what keep those out of the file in the first place.

`cleanup` in the evidence is not just the API answer. After Electron exits, a
Django ORM check counts the tasks in the throwaway workspace and whether the
exact marker still exists, so an archived-but-not-deleted row would still be
counted.

## Tests

The unit tests here cover only the pure evidence helpers; they do not pretend to
cover the live run:

```bash
node --test desktop/tests/spike/live-verify/
```

`sanitize.test.js` proves the redaction rules, and `expectations.test.js` proves
the pass/fail list fails when each fact is broken. The probe and client modules
themselves are covered by their own mocked tests under
`desktop/features/copilot/`.

## Reading a run

1. `summary.md` first: PASS/FAIL, the six checks, the HTTP exchanges.
2. `evidence.json` when a number needs quoting: the exact status codes, header
   values, marker title, and cleanup counts.
3. `django.log` for what the server actually saw, if a request outcome and a log
   line disagree.

Cleanup after reading: delete the run folder. The throwaway database and the
Electron profile live inside it.
