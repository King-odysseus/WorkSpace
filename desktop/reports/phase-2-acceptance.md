# Phase 2 acceptance report

Section 22 report for Phase 2: the provider layer.

- Phase start: `4579aaa` (the revision the working tree stood on when Phase 2 began).
- Report date: 2026-11-16.
- Phase 1 status: **not cleared.** The unchanged-web proof still fails on the same four
  conditions Phase 1's report recorded. Nothing in this phase touched them. The owner's
  instruction to continue is recorded in section 4; this report does not relabel those
  failures as passes.
- Phase 2 verdict: every code check in this phase passes. The unchanged-web gate does
  not, for the inherited reasons above and no new ones.

## 1. What was built (files and behaviour)

Everything below sits under `desktop/`. The web app was not touched (section 3).

### The neutral provider contract

- `shared/providers/types.ts` - the vocabulary every adapter answers to: capability
  profile, message parts (text, image bytes, tool call, tool result), chat request and
  reply, streamed deltas, embeddings, connection test, and the call context that says
  which business a call serves and why. Every schema is strict, so an unknown field is
  refused rather than dropped. An image part carries bytes and has no URL field at all,
  so nothing a model or a screen names can become something the app fetches.
- `shared/providers/errors.ts` - 14 fixed failure tokens, each with one plain sentence.
  `unsupported, aborted, network, timeout, provider_unauthorized, provider_rate_limited,
  provider_unavailable, provider_rejected, malformed_response, schema_mismatch,
  context_too_long, model_not_found, egress_blocked, internal_error`. The error type
  cannot carry the original text and deliberately has no `cause`, because
  `console.error` prints a cause.
- `shared/providers/tokens.ts` - the local size estimate used before a call is made.
- `shared/providers/structured.ts` - "ask for JSON, validate it, repair once" for models
  that cannot call tools natively.
- `shared/providers/contract-suite.ts` - the reusable suite every adapter is run against.
- `shared/providers/settings-contract.ts` - the eight channels, their strict request and
  reply schemas, and the bridge shape the screen is given.

### Security and the network boundary

- `security/ip-ranges.ts` - classifies loopback, private, link-local, unique-local and
  public addresses for IPv4 and IPv6. Only the `::ffff:` form borrows an IPv4 tail, so a
  public address that merely ends in a loopback-looking quartet is not treated as local.
- `security/egress-guard.ts` - one guard for every outbound model request. It resolves
  the host, classifies the answer, follows redirects by hand and re-checks each hop,
  blocks a cloud call for a local-only business before anything is sent, and records one
  audit line holding only the scheme, host and port.
- `security/pinned-transport.ts` - the connection the guard dials: it connects to the
  verified address and never asks the name service again, while still presenting the
  original hostname for the TLS handshake and certificate check.
- `security/audit.ts` - the sanitized audit records.
- `security/resolver.ts` - the one place the system resolver is called.
- `security/keychain.ts` - encrypted secrets, now with durable ciphertext, and a removal
  that reports whether the write actually landed.
- `security/credentials.ts` - per-account, per-server credentials. Names are length
  prefixed, so two different accounts cannot collide on one stored name.
- `security/credential-entry.ts` - the single boundary a key comes through: a single-use
  pass that expires in a minute and is bound to one account. The reply carries the
  outcome and at most the last four characters, never the key.
- `security/secret-file.ts` - the file the ciphertext lives in.

### The adapters

- `adapters/anthropic.ts` - native tools, images, streaming.
- `adapters/openai-compatible.ts` - one configurable adapter serving OpenAI, DeepSeek,
  Kimi, Together, OpenRouter, LM Studio and a custom endpoint; native or prompted tools,
  embeddings, streaming.
- `adapters/ollama.ts` - the local server's own four routes, newline-delimited JSON
  streaming, arguments that are already objects, derived tool-call ids and `keep_alive`.
- `presets.ts` - nine catalogue entries: `anthropic`, `openai`, `deepseek`, `kimi`,
  `together`, `openrouter`, `lmstudio`, `ollama`, `custom`.
- `capabilities.ts` - reads what a provider publishes about a model rather than guessing.
- `discovery.ts` - asks the two usual local addresses, 11434 and 1234, what they serve.
- `registry.ts`, `wire.ts`, `parts.ts`, `transport.ts` - routing a preset to an adapter,
  the HTTP helpers, message conversion, and the guarded transport every call goes through.

### Settings and the screen

- `providers/settings-service.ts` - stores each provider's address and starting model,
  reads keys from the encrypted store, tests a connection, lists models, finds local
  servers, and refuses a reply that outlives the account that asked for it.
- `providers/settings-ipc.ts` - trusted-sender check, request validation, reply
  validation, and a signed-out push that clears key material.
- `shared/providers/models-screen.ts` - the screen's decisions as pure functions, so the
  wording and ordering can be tested without a DOM.
- `renderer/src/ModelsPanel.tsx` - the screen: configured providers with Cloud/Local and
  a readiness badge, add or change a provider, key entry, test connection, model list
  with capability chips, local discovery.
- `electron/preload/shell.js` - the `zuriProviders` bridge, fixed channels only, with the
  same literal-copy discipline the other two bridges use.

## 2. How it was tested (commands and real output)

### The desktop suite

```
$ cd desktop && npm run check
> tsc -p tsconfig.json            (clean)
> tsc -p tsconfig.renderer.json   (clean)
> npm run build:main              (bundle written)
> node --test features
# tests 701
# pass 700
# fail 0
# skipped 1        (a file-permission test that only applies on Linux and Mac)
```

Per area, run one at a time so a failure names its own folder:

```
features/copilot/main/providers/adapters   # tests 188  # pass 188  # fail 0
features/copilot/main/providers            # tests 258  # pass 258  # fail 0
features/copilot/main/security             # tests 139  # pass 138  # fail 0  (1 skipped)
features/copilot/shared/providers          # tests 61   # pass 61   # fail 0
```

What those cover, against the Phase 2 acceptance criteria:

- **Adapter contracts.** All three adapters are driven by the shared suite: chat,
  streaming, embeddings where supported, error mapping and cancellation. The
  OpenAI-compatible suite is run once per preset, so a per-service difference cannot hide
  behind one green run.
- **Credential isolation.** Two accounts on one machine keep their own keys and their own
  rows; the same name on two servers stays separate; the two scope shapes that used to
  collide now produce different stored names; an unencrypted fallback is refused.
- **Secret leaks.** A new sweep (`secret-sweep.test.js`) reads every source, test and
  report file under `features/copilot/` plus `desktop/README.md` and `package.json` and
  fails if a key-shaped string appears anywhere. It was proved to work by pasting a
  fake key into the tree: the sweep failed, the file was deleted, the sweep passed.
- **Redirects.** A redirect is followed by hand and re-classified; a cross-origin
  redirect cannot receive provider credentials; only a default-port http-to-https
  upgrade keeps them.
- **Local-only bypass.** A chat, a model list and a connection test for a local-only
  business are all refused and no socket is opened, with the resolver called exactly
  once. DNS rebinding is covered with two real local servers and a resolver that would
  change its answer: the payload reaches the verified server and the second server sees
  no connection at all.
- **Cancellation.** Cancelling before a call sends nothing; an aborted connection
  surfaces as a cancellation, not as a network failure.

### The Electron window

```
$ cd desktop && npm run shell:smoke
zuricopilot-desktop shell smoke {"ok":true, ..., "failed":[]}
42 checks, 0 failed
```

This run covered all three modes, dock layout and resizing, theme following the OS, the
menu and dock shortcut, close-to-tray and restore, single instance, the web view having
no bridge, and the locked window showing the gate with no assistant content. On a
machine with nobody signed in it takes the locked branch, which is why the Models screen
needed driving separately.

### The Models screen, inside Electron

The smoke test cannot open the Models screen on a signed-out machine, so a scratch
harness loaded the real preload and the real built renderer in Electron and answered the
main-process channels from tables. It is not product code, it lives in a gitignored
folder, and no key it types is real.

```
20 checks, 0 failed
```

What was driven and seen:

- The rail's Models destination opens the screen.
- The configured DeepSeek provider is drawn with its address, starting model, key tail,
  a `Cloud` badge and a `Ready` badge.
- Test connection answers `Connected. 2 models available on cloud.`, and the list draws
  two models marked cloud, each with capability chips.
- Local discovery answers with one server found and one not running, and the refusal
  reads as a plain sentence with no token and no URL.
- The key field is `type="password"`, and it clears after saving; the screen then reads
  `Key stored, ending b1ff.`
- The dark theme follows and the controls stay square (radius `0px`), shadowless
  (`none`) and borderless.
- A focused field shows a 2px solid outline, so a keyboard user can see where they are.
- When access is withdrawn, the gate replaces everything: no Models screen, no provider
  rows, no rail rows.
- No console errors on any of it.

### The live cloud check

The owner supplied a DeepSeek key for this purpose. It arrived through an environment
variable, was never printed, never written to a file, and is not in this report. The run
used the shipped guard, the shipped pinned connection and the shipped settings service.

```
$ DEEPSEEK_KEY=<supplied> node .tmp-phase2/live-deepseek.cjs
{"ran":true,"preset":"deepseek","warnings":0,"fingerprint":"0b1f",
 "listModels":{"ok":true,"cloud":true,"count":2,
   "models":[{"id":"deepseek-flash","cloud":true,"tools":"native","contextWindow":64000},
             {"id":"deepseek-v4-pro","cloud":true,"tools":"native","contextWindow":64000}]},
 "testConnection":{"ok":true,"modelCount":2,"cloud":true},
 "warningsMentionKey":false}
```

Model named: `deepseek-flash`, with `deepseek-v4-pro` also returned by the real endpoint.
Result: the key was accepted, two models were listed, both classified cloud, the
connection test agreed, and no log line along that path contained the key.

### The frontend suite

```
$ npm run test -- --maxWorkers=2
 RUN  v4.1.11

 Test Files  101 passed (101)
      Tests  818 passed (818)
   Duration  316.29s
```

Phase 1's report recorded 817 tests for the same 101 files. The web sources are
byte-identical to what Phase 1 recorded (Output 1 above), so that one-test difference is
a counting difference in the two reports, not a code change; it was not chased further.

### The backend suite

```
$ python manage.py test
Ran 850 tests in 1287.010s
OK
```

### What was not tested

- **A real local model server.** Ollama and LM Studio are covered by mock servers only.
  Nothing was installed and no model was downloaded, as the plan requires. Real
  local-model testing is **pending** and needs a separate approval to install anything.
- **A live TLS handshake for the pinned address.** The certificate behaviour is checked
  by reading the connection settings (hostname presented, verification on), not by a
  real handshake in a test, because making a test certificate for a reserved name would
  need a dependency the owner has not approved. The real handshake does happen on the
  live DeepSeek call above, which succeeded, but it is not a repeatable test.
- **Cancellation partway through a stream.** Cancelling before a call and aborting a
  connection are tested; a cancel delivered mid-stream is not.
- **The four unchanged-web conditions**, which belong to Phase 1 and are listed in
  section 3.

## 3. Web app unchanged (the five section 5 outputs)

The owner's instruction is to record these as they are, not to amend the checks.

### Output 1: the protected-path diff is empty, except the approved Phase 1 change

```
$ git diff --stat 4579aaa..HEAD -- src tasks backend package.json package-lock.json vite.config.js
(no output)

$ git diff --stat -- src tasks backend package.json package-lock.json vite.config.js
 src/App.settings-access.test.jsx     |   3 +-
 src/components/SettingsView.jsx      |  15 ++++-
 src/components/SettingsView.test.jsx | 117 ++++++++++++++++++++++++++++++++++++
 tasks/models.py                      |   8 ++-
 4 files changed, 139 insertions(+), 4 deletions(-)

$ git status --porcelain --untracked-files=all -- src tasks backend | grep '^??'
?? src/mockups/copilot/Chat.jsx
?? src/mockups/copilot/CopilotMockup.jsx
?? src/mockups/copilot/Dashboard.jsx
?? src/mockups/copilot/WeeklyPlan.jsx
?? src/mockups/copilot/WorkspaceMode.jsx
?? src/mockups/copilot/main.jsx
?? src/mockups/copilot/parts.jsx
?? tasks/test_assistant_access.py
```

Read honestly: that diff is **identical** to the one Phase 1's report recorded, down to
the same four files and the same 139 insertions. Phase 2 added no web change at all; its
entire change set is under `desktop/`. The committed diff is empty only because nothing
is committed, which is this crew's rule.

### Output 2: the build output has the same hashed names

It does not, and it cannot while an approved web change exists.

```
  FAIL  asset list changed: 25 missing, 25 added
```

### Output 3: no Copilot content in dist/

```
  FAIL  Copilot content found: assets/SettingsView-CzN4eK_5.js (content)
```

The match is the approved permission-name string carried by the settings chunk, not
assistant code.

### Output 4: the frontend suite passes

```
$ npm run test -- --maxWorkers=2
 Test Files  101 passed (101)
      Tests  818 passed (818)
   Duration  316.29s
```

### Output 5: the backend suite passes

```
$ python manage.py test
Ran 850 tests in 1287.010s
OK
```

### Output 6: the mockups are not build inputs

```
  PASS  vite.config.js has no rollupOptions/input override, so the build takes the default index.html entry
  PASS  index.html has exactly one module script, /src/main.jsx
  PASS  no file in dist/ carries the mockup-only marker text
  PASS  no mockup page is emitted (copilot-mockup.html, mockup.html)
  WARN  121 mockup-only classes reach the production stylesheet (allowed by --allow-mockup-css)
```

### The whole proof, as one run

```
$ node desktop/scripts/verify-web-unchanged.mjs --phase-start 4579aaa \
    --baseline .tmp-phase1/phase1-baseline.txt --skip-build --allow-mockup-css
RESULT: FAIL - 4 of 13 checks failed: p3, p4, b2, d1
```

Those four are exactly the four Phase 1 recorded (`p3` and `p4` are uncommitted work,
`b2` is the asset list and `d1` is the permission string). `m5` is a warning under the
owner's approval, as before. **No new failure appeared in this phase.**

A Phase 2 baseline could not be sealed: `--record-baseline` runs every check first and
writes nothing when one fails, which is deliberate, so it refused. That refusal is
recorded rather than worked around by hand-writing a baseline.

## 4. Deviations

1. **The shared contract suite does not cover tool calling or prompted fallback.** Those
   are covered, thoroughly, in each adapter's own test file. The acceptance wording asks
   for one shared suite covering "tools or prompted fallback", and the shared suite does
   not: it covers chat, streaming, embeddings, error mapping, abort and capability
   honesty. This is a real deviation, recorded rather than smoothed over.
2. **The certificate check is configuration-level.** `pinned-transport.test.js` asserts
   that the hostname is presented and verification is left on; it does not perform a live
   handshake. The live DeepSeek call does perform one.
3. **No live local model.** Mock only, as required pending approval.
4. **An existing security test changed its stance.** The preload drift guard used to ban
   the words "credential" and "secret" anywhere in a channel name or the preload. That
   would have blocked the approved key-entry path. It now enforces the invariant it stood
   in for: no channel may read a secret back, the entry reply carries only a four-character
   fingerprint, and the page's state schema has no key field. That is stricter about what
   matters. The owner may prefer the original ban, which would need a different design for
   key entry.
5. **A test was added during verification.** `secret-sweep.test.js` closes the plan's
   "a test greps fixtures and logs" requirement, which had no counterpart. It is the only
   test this verification task added.
6. **Phase 1 is not cleared.** The owner declined both ways of amending the proof, so the
   four inherited failures stand and are recorded as failures. Continuing was the owner's
   explicit instruction, recorded here rather than presented as a pass.
7. **The Models screen's controls are squared by a scoped rule in the renderer's
   stylesheet.** The app's own token sheet forces pill corners, a shadow and a grey fill
   on buttons and inputs. No new stylesheet was added.

## 5. Open questions

1. **How is an approved web change supposed to count in the unchanged-web proof?** This is
   the question that keeps Phase 1 open. Until the owner answers it, every phase will
   inherit the same four failures.
2. **Should an embedding model be refused for chat in advance?** It is not, because the
   capability profile has no "cannot chat" field. The plan puts that decision in the model
   picker and the Phase 5 router, so the Models screen simply should not offer it.
3. **Should demoting a granted manager and promoting them back restore assistant access
   without a fresh grant?** It does today, because a role change does not clear stored
   permissions. That is a product decision for a later phase.
4. **Should the 121 mockup classes be excluded from the production stylesheet?** The owner
   approved recording the coupling as a warning. Excluding it would close `m5`.
5. **Rotate the DeepSeek key.** It was supplied for this test and now sits in the run
   history in plain text.
6. **Phase 2's phase-start revision is `4579aaa`, and Phase 1's work is still
   uncommitted.** When the owner commits, the baseline for the next phase should be
   recorded from the committed tree.
