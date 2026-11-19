# Phase 3 security review - conversation privacy and isolation

The original review was read-only: no source file was modified and no build was run.
Its historical evidence below comes from reading the code, from probes against the existing
`desktop/build/main/ipc.cjs`, and from running six focused test files (75 tests, all
passing). No browser, Electron window or live provider call was used.

The logging section (3) was added in a second pass and is the only part backed by probes
run in that pass: a log sink was attached to the existing bundle and the secret-handling
paths were driven through it. No file was rebuilt to obtain it.

**Historical verdict.** This review originally found three blocking issues (F1, F2 and F3).
They were corrected and re-reviewed. The F1 correction then introduced F11, described in
section 1a.1. The original findings and measurements remain below as a record of that review.

**Current verdict.** F1, F2, F3 and F11 are resolved; F11 is regression-verified through
the assembled cloud payload described in section 1a.2. Phase 3 remains unsigned pending
the separate web-build gate and a live local-model run.

## 1. Historical findings that blocked acceptance

### Historical F1 - Recalled items and the summary entered the prompt as instructions

`chat/context.ts:148-168` (`recallText`) pastes remembered items and the summary into one
`system` message with only a kind heading above each group:

```
Settled decisions:
- <item text>

Earlier conversation:
<summary text>
```

There is no delimiter, no quoting and no sentence telling the model that this block is
stored data rather than instruction. The text is model-generated and person-editable, so a
row containing "Ignore previous instructions..." or a forged heading is read with system
authority on every later turn of every later conversation in that business.

Injection *into* the store from another business is blocked (the cited message must belong
to the same scope and business). Injection *through* the store is not addressed at all, and
no test covers it. The plan's Phase 3 criteria include injection through remembered
content, so this is unmet.

Correction: wrap the block in explicit data delimiters and state in the prompt that
everything inside the block is quoted business data and never an instruction; add a test
with an item whose text is an instruction and assert the assembled prompt marks it as data.

### Historical F2 - The privacy line claimed identifier detection the code did not do

`chat/privacy.ts:151-161` (`residualIdentifier`) checks only: an email shape, a long digit
run, a dashed digit run, a contact-number run, a handle and a web address. There is no name
detection of any kind, and `placeholdersFor` (`privacy.ts:183-198`) builds at most two
values for a normal account - the signed-in person's name and the business name (`email` is
supplied as `null` by the shell, so `[[email]]` is dead in practice).

When nothing matches, `chat-screen.ts:201-206` tells the person:

> Sent as written. Nothing in this message identified a person or the business.

Probe against the existing bundle:

```
placeholders: [[person]],[[business]]
residualIdentifier('Call (202) 555-0123')            -> long_number   (correct)
residualIdentifier('Chase the Tilley quote on Friday')-> null          (a client name)
privacyView(cloud, no placeholders) -> 'Sent as written' |
   'Nothing in this message identified a person or the business.'
```

So a message naming a client, a member of staff or a street address is sent unchanged
while the screen states that nothing identified a person. The plan (`docs/zuricopilot-plan.md:221-223`)
asks for member names, emails and phone numbers to be replaced and for a likely identifier
that remains to block the send. The two identity substitutions that exist are correct; the
sentence around them is a false assurance.

Correction: either narrow the sentence to what is actually checked ("No email address,
phone number or web address was found"), or add the detection the sentence implies. The
narrowed wording is the honest minimum for this phase; the wider detection belongs with the
team and document work.

### Historical F3 - The payload preview was not the exact payload

`chat/service.ts:770` builds the preview with `openProvider(request.presetId)` while the
send at `:797` uses `openProvider(request.presetId, request.modelId)`. The context budget
and message cap come from the routed provider, so preview and send can trim differently.
`service.ts:771-772` then appends the new turn after `contextFor` has already sliced to the
message cap, so the preview can show one message the send will drop. The plan asks for the
exact payload (`docs/zuricopilot-plan.md:223`).

Correction: open the provider with the model id in the preview, and append the new turn
before the trim rather than after it.

## 1a. Corrections and re-review (added during Phase 3 verification)

All three original blocking findings were corrected in the code and independently
re-reviewed. Section 1 preserves their original evidence as historical findings.
This section records the corrections and cites the code and regression tests.

| Finding | State | Evidence |
| --- | --- | --- |
| `F1` | Resolved as specified | `chat/context.ts` tells the model that fenced records are quoted business data, never instructions. `memoryLabels` gives each remembered item a `memory-N` fence label, and `summarySource()` returns `summary`; the row IDs remain in context metadata and do not enter the prompt. A stored line that forges a fence, section heading or notice is escaped. Regression tests in `chat/context.test.js` cover injected instructions, forged headings, forged closing fences and unique fence labels. |
| `F2` | Resolved as specified | The false assurance is gone; `grep -rn "Nothing in this message identified" desktop/features/copilot/shared/chat-screen.ts` returns nothing. The notice now names what was checked and states the limit at `chat-screen.ts:164`: "Client or staff names and postal addresses are not checked, so those would still be sent." The substituted notice carries the same limit. A regression test covers a client name ("Chase the Tilley quote on Friday") that still passes the checks unchanged. |
| `F3` | Resolved as specified | Preview and send now open the provider identically with the model id, at `chat/service.ts:847` and `chat/service.ts:871`, both `openProvider(request.presetId, request.modelId)`. They share one context-assembly path and one privacy transform, and the new turn joins the conversation before the trim rather than after it. The preview keeps its thread-ownership check and persists nothing. |

### 1a.1 Historical F11 finding introduced by the F1 correction

**Historical F11 - a cloud turn was refused when a fenced row id happened to read as a long number, so
whether a given business was blocked was decided by its own ids.**
The F1 correction fenced each remembered record with its row id. Row ids are always 32
hexadecimal characters: `db/repositories/context.ts:41-43` defines `defaultNewId()` as
`randomBytes(16).toString('hex')`. The privacy scan runs `residualIdentifier`
(`chat/privacy.ts:151-161`) over every text part, including the system message carrying the
fences.

The match is narrower than an earlier version of this finding claimed. The rule that fires is
`LONG_DIGIT_RUN = /\d(?:[\d\s]{5,})\d/` (`chat/privacy.ts:86`), which is seven or more
consecutive digits. A hexadecimal letter breaks the run, so an id made only of letters does not
trip it. Measured against the built bundle (`desktop/build/main/ipc.cjs`):

- `memory:abcdefabcdefabcdefabcdefabcdefab` -> `null` (no digits, correctly passes)
- `memory:deadbeefdeadbeefdeadbeefdeadbeef` -> `null` (no digits, correctly passes)
- `memory:0f1e2d3c4b5a69788796a5b4c3d2e1f0` -> `long_number` (contains `69788796`)
- `summary:a1b2c3d4e5f60718293a4b5c6d7e8f90` -> `long_number` (contains `60718293`)
- a dashed date `14-03-26` -> `null` (correct)
- a phone number -> `long_number` (correct)

So the defect was real and common, but it was not universal, and the claim that every
32-character id trips it was wrong. Over 20,000 freshly generated ids, the share carrying a run
long enough to fire is:

| Ids in the scan | Blocked |
| --- | --- |
| one (a single remembered item, or a summary) | 35.0 percent |
| two (one remembered item plus the summary - the real seam case) | 57.9 percent |
| four (several remembered items) | 81.9 percent |

Driving the real seam: `recallText()` output for one decision plus one summary, passed to
`buildCloudPayload`, returned `blocked: true, reason: long_number` for that draw, and the fence
lines were the lines that tripped it.

Consequence, stated precisely: an id is fixed when its row is created, so a given business was
either blocked on every cloud turn or blocked on none, until its rows changed. It was not that a
third of turns failed. It was that roughly 58 percent of businesses holding one remembered item and
a summary were blocked on every cloud turn, and the rest were unaffected. A business with no
memory yet always worked, which is why the live cloud run recorded in the acceptance report
succeeded. The suite failure below varied run to run because each run built a fresh database
with fresh ids.

Evidence from the suite: `features/copilot/main/chat/recall.test.js` "closing a thread leaves a
summary that later turns are sent instead of the text it covered" was a `cloud: true` turn
(`recall.test.js:89-90`). Run alone three times under Electron's Node it failed twice and passed
once, each failure being `AssertionError: timed out waiting for the turn to finish`. That
failure was this defect, not a flaky test.

At the time, the proposed corrections were to remove row ids from the prompt, exclude the
app's own fences from the residual scan, or change the row-id alphabet. The fence-label
change took the first route; section 1a.2 records the verified correction.

### 1a.2 F11 fence-label correction and verification

The regression test in `features/copilot/main/chat/privacy.test.js` uses digit-heavy memory
and summary row ids (`a1234567890`, `a2345678901`, `t9876543210`). Its cloud payload is
allowed and excludes those ids, while a separate user-supplied long number (`08031234567`)
is blocked as `long_number`. This supports the fence-label correction.

The test passes a stored seq 3 user row to `assembleContext`, then passes
`assembled.messages` directly to `buildCloudPayload`. It checks that the allowed cloud
payload contains both memory texts, the summary text and the seq 3 user text, while
excluding all three digit-heavy IDs. A separate user-supplied long number remains
blocked. This regression verifies the F11 fence-label correction.

## 2. Lower-severity findings

- **F4 - the recall pass does not check what its comment claims.** `chat/service.ts:566-569`
  says a sign-out or workspace switch makes the pass throw, but the call is
  `routed.assertCurrent()`, which tracks the provider-settings claim
  (`providers/settings-service.ts:556`), not the account or workspace. `stillCurrent` is
  never consulted in `recallPass` (`:555-673`). It is safe today only because
  `electron/shell-window.js:456-473` closes the database when the identity goes away.
- **F5 - `runScoped` has no production caller.** `db/store.ts:315-347` is the only guard
  that re-checks the account after an await; grep finds it used only in
  `ownership.test.js` and `store.test.js`. Stale writes are stopped by the connection being
  closed, not by this guard.
- **F6 - the duplicate check is capped.** `chat/extract.ts:153-162` reads
  `memory.list` and `memory.listRemoved`, both `LIMIT 200`
  (`db/repositories/memory.ts:97,309,326`). Past 200 live items or 200 tombstones the guard
  stops seeing the row it exists to match, and a deleted or corrected item can return.
- **F7 - a decided draft can be re-decided.** `db/repositories/proposals.ts:290-311`
  (`setStatus`) writes `status` and `updated_at` with no "still pending" condition, unlike
  `update` at `:353`. An approved draft can be flipped to rejected and back, so the record
  of the decision is not append-only.
- **F8 - local-only has no producer.** Nothing in the shipped app sets `localOnly: true`;
  the chat paths set only `unredactedContent` (`service.ts:456,581,964`). The guard's
  local-only rule therefore never fires. That is Phase 5's feature; it should be recorded
  as unwired rather than counted as working.
- **F9 - audit rows are exempt from eligibility.** `db/store.ts:225,282-284` leaves `audit`
  unwrapped, `repositories/audit.ts:191-220` inserts `business_id` unvalidated and
  `db/migrations/index.ts:133-141` gives `audit_entry` no foreign key. The id is opaque and
  the detail is sealed, so this is low.
- **F10 - the renderer prints raw error objects.** Ten calls in `renderer/src` pass a
  live `error` straight to `console.error`/`console.warn`
  (`CopilotView.tsx:53,96,99`, `WorkspaceAccessPanel.tsx:150,172,187,217`,
  `AccessGate.tsx:158`, `App.tsx:76`, `ShellChrome.tsx:47`). What keeps this harmless today
  is that the page never holds a key: the only credential-shaped value it can receive is a
  four-character fingerprint, and every refusal reply carries a fixed token. It becomes a
  leak the day a reply carries something fuller, and the print would go unnoticed because
  nothing reads it. Correction belongs to a later phase: log the fixed reason rather than
  the object. Recorded here because the plan asks that the review cover logs, and these are
  the only log calls in the app that take a value of unknown shape.

## 3. Logging: what the main process writes

Criterion 2 asks this review to establish that no secret reaches a log. That cannot be
shown by reading the chat code alone, because the logging is spread across a dozen modules
that are each handed a `log` and each choose their own sentence. It was checked three
ways: every log call was found and read, every one was classified by what it can carry,
and a log sink was then attached to the running bundle while the secret-handling paths were
driven, to see what actually came out.

**There is no ad-hoc printing.** `grep` over `features/copilot` and `electron` finds no
`console.log`/`warn`/`error` in shipped code; the two matches are sentences in comments
(`shared/providers/errors.ts:17`, `shared/storage-contract.ts:124`) explaining why no
`cause` is attached to a failure. There is no `uncaughtException` or `unhandledRejection`
handler that would print an error object, and no `crashReporter`, `setAppLogsPath`,
`ELECTRON_ENABLE_LOGGING`, `--enable-logging` or `--log-file` switch, so nothing the
renderer prints is written to disk or forwarded to the main process.

**Every log call, and what it can carry.** The right-hand column is the part that matters:
in every case the value interpolated is a fixed token, an error's *name*, or a name the app
chose - never a key, a request body, a header, or a URL.

| Location | Line written | Value it interpolates |
| --- | --- | --- |
| `security/credentials.ts:188` | `saved "<name>"`, `save failed (<reason>)`, `removed "<name>"`, `cleared N credential(s)` | a preset id such as `deepseek`; a fixed reason token; a count. The secret is never an argument. |
| `security/credential-entry.ts:145` | `stored "<name>"`, `refused a submit (<reason>)`, `stored nothing (<reason>)` | as above. The reply carries a four-character fingerprint, which is not logged. |
| `security/keychain.ts:185` | `<reason>` | fixed token (`not_found`, `decrypt_failed`, `unavailable`, `storage_failed`). |
| `security/secret-file.ts:221` | `discarded (<reason>)`, `write_failed (<code>)`, `clear_failed (<code>)` | a fixed reason plus an error *code*. |
| `security/audit.ts:464,500` | `blocked <providerId> for <purpose> (<reason>)` | the provider id and purpose, never the target: `:495-499` states that the host and URL are the two things that must not be written. |
| `security/egress-guard.ts:307,446,456,463,515,532,581,610` | refusal sentences and `transport failed (<code>)` | fixed tokens. No URL, header or body reaches any of them. |
| `chat/ipc.ts:101,120,130` | `refused a chat request from an untrusted view`, `chat reply refused (<name>)`, `chat request refused (<failure>)` | an error *name* and a fixed failure token. No message text. |
| `chat/service.ts:670,835,988,1007` | `recall pass skipped (<name>)`, `chat turn ended without reporting`, `recall pass skipped (summary)`, `(memory)` | an error *name*; the rest are fixed sentences. No recalled item, summary or message text. |
| `access/ipc.ts:73,103,109,143,158`; `providers/settings-ipc.ts:101,128,134,191,197`; `shell/ipc.ts:125,154,159,226`; `ipc/handlers.ts:87` | `request refused (<token>)`, `handler failed (<name>)`, `reply refused (<reason>)` | fixed tokens and error *names*. |
| `providers/settings-service.ts:279,297,305,309,355` | fixed sentences, `nameOf(error)` | an error *name* only. `nameOf` (`:312-314`) reads `error.name`, not `error.message`. |
| `workspace-api/index.js:66,79,80` | one fixed sentence; `zuricopilot workspace-api unavailable: <message>` | the only place a raw `error.message` is logged in shipped code. Every error this module throws is a fixed sentence with no interpolated value (`client.js:41-188,265-344`, `probe.js:140-298`), so the message can only ever be one of those. `client.js:79` additionally refuses a server URL that carries credentials. |
| `electron/shell-window.js:385,468,606,735` | fixed sentences; `:606` adds `error.name`; `:468` adds a store failure token | error *name* and fixed tokens. `:468` names the token, never the driver's message, which can quote a bound value. |
| `electron/main.js:81,83,421,442,466` | `ServerConfigError` message; otherwise `error.name` | the class's message is always a fixed token (`windows.js:145-173`: `not_a_url`, `unsupported_protocol`, `credentials_in_url`, ...), never the URL's value. `:83` prints the variable's *name*, not its value. |
| `electron/main.js:263,286,291,296,309,321,325,333,346,354`; `electron/debug-window.js:134`; `electron/smoke-chat.js:103` | smoke and probe output | test-only paths: `electron/dev-flags.js` refuses them in a packaged build, and `main.js:421-423` reports the refusal. `:325` and `smoke-chat.js:103` print `error.message` from test code that never receives a key. |
| `electron/shell-window.js:826` | `"<view>" view failed to load (<message>)` | a local `file:` load failure, so a path rather than a credential. |
| `electron/windows.js:459,553` | `could not open external link (<code>)`, `page load failed code=<n>` | an error code and a numeric code. |

**What the sink actually saw.** A `log` that records every line was given to the existing
bundle, and seven paths were driven:

1. saving a credential whose secret was a canary string;
2. a request whose text was never redacted, aimed at a public address;
3. a transport failure whose message quoted a URL containing the canary;
4. a URL carrying the canary in its query string;
5. a URL carrying the canary as a username;
6. a cross-origin redirect that would have carried `Authorization: Bearer <canary>`;
7. saving a provider address written as `https://user:<canary>@api.example.com/v1?key=<canary>`.

These seven are the credential, network and configuration paths, which are the ones that
handle a secret. The chat and IPC rows in the table above are established by reading their
call sites, not by this probe.

Six lines were produced in total, and **none contained the canary, the word `Bearer`, or
the `sk-` prefix**:

```
zuricopilot credentials: saved "deepseek"
zuricopilot egress: refused a cloud destination for a request whose text was not redacted
zuricopilot egress: refused a cross-origin redirect that would have carried credentials
zuricopilot egress: transport failed (unknown)          x3
```

Two things that probe established, beyond the absence of a leak:

- **Path 7 never reached a log or the disk.** `saveProvider`
  (`providers/settings-service.ts:574-582`) rebuilds the address from `parsed.origin` plus
  the path, so it stored `https://api.example.com/v1`: the username, password and query
  string were dropped. A credential pasted into a provider address therefore cannot be
  persisted or printed - though it is discarded silently rather than refused, which a person
  would notice only as "my key stopped working".
- **Paths 4 and 5 were not refused by the guard.** A URL carrying a credential in its query
  string or as a username is sent as given; the three `transport failed (unknown)` lines are
  the guard reporting that the request ran and the transport refused, not a refusal of the
  URL. Nothing about that URL is written down, so this is not a log leak, but it means the
  guard is not the thing that keeps a credential out of a base URL - the settings service is,
  by dropping it at save time. Worth knowing before a later phase lets an endpoint be
  configured anywhere else.

**Two things this section does not claim.**

- It does not claim the audit *trail* is free of secrets, only the log lines. The trail is a
  separate question (F9), and its fields are allow-listed (`audit.ts:434-442`), so a record
  cannot hold free text.
- It does not claim the renderer prints nothing. Ten `console` calls there pass a live
  error object; they are recorded as F10, because what keeps them harmless is the page
  never holding a key rather than anything those calls do.

## 4. Verified as correctly guarded

- **Cross-business writes are refused in SQL, not by a caller-side check.** A message is
  inserted with `INSERT ... SELECT FROM thread` so the thread must match scope and business;
  a summary upsert cannot claim another business's row; a memory item's cited message must
  exist in the same scope and business; a proposal's thread is verified. Bounded by
  `ownership.test.js` and the repository tests.
- **Key handling fails closed.** A key is minted only when the keychain answers `not_found`
  and no database file exists (`db/store.ts:178-191`); `decrypt_failed`, locked and
  unavailable all become `bad_key`; a wrong key is detected against `key_check` before any
  personal row is touched (`db/connection.ts:220-224`).
- **No content is stored in the clear.** Every text column is sealed before it is bound, so
  the write-ahead journal holds ciphertext too. What remains readable is metadata only:
  scope id, role, provider, model, cloud flag, timestamps.
- **IPC validates sender then payload, in both directions.** Sender trust checks the
  registered `webContents.id`, rejects subframes and requires the exact `file:` URL
  (`shell/ipc.ts:129-140`); unexpected errors become `internal_error`; a refusal never
  rejects the renderer. The preload exposes no key, no cipher and no store handle.
- **Proposals cannot execute anything.** `setStatus` writes only `status` and `updated_at`;
  the draft payload is read key by key so an `assigneeId` or `taskId` cannot be acted on.
  `workspace-api/client.js:263-296` does contain `createTask`, and it is re-exported from
  `ipc/index.ts:118`, but no IPC channel, handler or preload method reaches it - the only
  caller is the Phase 0 probe. That is safety by absence of wiring, and no test asserts it.
- **Egress enforcement is sound.** Every hop is classified from resolved addresses before
  the socket is touched, a request whose text was not redacted is held to verified local
  addresses at every hop including redirects, and a credential is refused rather than
  stripped across an origin or non-default-port redirect.

## 5. What this review did not verify

- The six focused test files (75 tests) were run, and the log sink in section 3 was driven
  against the existing bundle for the credential, network and provider-address paths. What
  was **not** re-run is the full desktop suite and the Electron window suite
  (`electron/shell-smoke.js`), so the builder's counts for those are taken as reported. No
  build was run.
- The LAN case was not probed: a private-range endpoint is classified local, so a model
  server on another machine would receive unredacted text in the clear while the chip says
  it ran on this machine. Worth a decision, not a defect in this code.
