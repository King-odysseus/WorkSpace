# Phase 3 acceptance report - businesses and chat with memory

Phase: 3, "Businesses and chat with memory" (`docs/zuricopilot-plan.md`, section 19).
Phase start commit: `4579aaa`. Historical run outputs are retained below with their original scope.

**Status: Phase 3 is unsigned.** F11 is regression-verified as resolved by the fence-label
fix. The separate web-build gate remains open, and a live local-model run remains pending.
The test in `privacy.test.js` passes stored memory, a summary and a seq 3 user turn through
`assembleContext` and sends `assembled.messages` directly to `buildCloudPayload`. Both
memory texts, the summary and the user turn reach the allowed payload without any of the
three digit-heavy row IDs. A user-supplied long number remains blocked as `long_number`.
The current desktop check ran 897 tests (1 skipped) and 216 database tests, all passing.

**Historical F11 failure.** The F1 correction originally fenced records with their row
IDs. A hexadecimal ID could contain seven consecutive digits and trigger the privacy
scanner. In the pre-fix measurement of 20,000 generated IDs, 35.0 percent of single IDs
and 57.9 percent of two-ID blocks triggered the rule. Section 1a.1 of the security review
records the old measurements and failure. The fence-label fix removed row IDs from the
prompt while retaining source IDs in context metadata.

**The "web app unchanged" gate does not pass.** It fails on the same conditions
Phase 1 and Phase 2 already left behind - four of them with the approved mockup-CSS
exception applied, five without it. Phase 3 added none. Phase 1 is still not cleared,
because that rests on a decision only the owner can make.

**What did move forward.** F1, F2, F3 and F11 are resolved; the evaluation sets are
complete at 24 cases per feature. Section 2 preserves the earlier suite run, including
its pre-fix F11 failure, alongside the other verification evidence. The current desktop
check ran 897 tests (1 skipped) and 216 database tests, all passing.

Three things were found while verifying. All three are recorded in section 4 rather than
quietly fixed:

- A **real defect** made every live model call fail through the shipped app. It is
  fixed, with regression tests, because criterion 3 could not be met without it.
- The **F1 correction introduced F11**. The later fence-label fix and regression test
  resolved it; the pre-fix failure remains documented below.
- The proof prints a **cause line that is wrong**. It is described, not repeated as
  fact.

---

## 1. What was built (files and behaviour)

All of it is under `desktop/`. No file outside the desktop app changed.

### Storage (about 3,280 lines across 12 files)

| File | Lines | What it does |
| --- | --- | --- |
| `main/db/connection.ts` | 259 | Opens the database, verifies the key against a key-check row before any personal row is touched, applies pragmas, runs migrations inside a transaction |
| `main/db/driver.ts` | 101 | The thin wrapper over the SQLite engine Electron ships |
| `main/db/cipher.ts` | 153 | Seals and opens one column's value with the account's key |
| `main/db/store.ts` | 377 | One database per person per server, key handling, migration, and the lifecycle that closes it on sign-out |
| `main/db/migrations/index.ts` | - | Numbered, transactional migrations |
| `main/db/repositories/businesses.ts` | 245 | The businesses a person may see |
| `main/db/repositories/threads.ts` | 373 | Threads: create, list, search, pin, rename, touch, remove |
| `main/db/repositories/messages.ts` | 370 | Messages, with the thread's business checked inside the insert |
| `main/db/repositories/memory.ts` | 386 | Remembered items: add, list, edit, remove, and the tombstone list the duplicate check reads |
| `main/db/repositories/summaries.ts` | 253 | Rolling summaries with a marker saying how far they read |
| `main/db/repositories/proposals.ts` | 375 | Drafted work, with the payload read key by key |
| `main/db/repositories/audit.ts` | 261 | The storage-side record of what happened |
| `main/db/repositories/context.ts` | 129 | The scope every repository is given, and the refusal when it does not match |

Every text a person wrote - a business name, a thread title, a message, a remembered
item, a summary, a proposal, an audit detail - is encrypted before it is bound. What
stays readable is metadata: ids, timestamps, role, provider, model, the cloud flag.

### Chat (about 3,400 lines across 11 files)

| File | Lines | What it does |
| --- | --- | --- |
| `main/chat/service.ts` | 1,041 | Threads, sending, streaming, persistence, cancellation, staleness, and the recall pass that runs after the answer |
| `main/chat/context.ts` | 249 | Assembles what the model sees, within its budget, with provenance labels |
| `main/chat/privacy.ts` | 307 | What may leave for a cloud model: substituting names, refusing what still identifies somebody, and the exact preview |
| `main/chat/extract.ts` | 223 | Turns a reply into validated remembered items, with a bounded repair |
| `main/chat/summary.ts` | 144 | The rolling summary |
| `main/chat/proposals.ts` | 155 | Task drafts, only from the person's own request |
| `main/chat/recall.ts` | 106 | The after-the-turn pass |
| `main/chat/ipc.ts` | 194 | The message layer: sender checked before the request is read, both sides validated |
| `shared/storage-contract.ts` | 281 | Row shapes, strict |
| `shared/chat-contract.ts` | 531 | 16 request channels plus one event push |
| `shared/chat-screen.ts` | 500 | Every sentence the screen shows, as pure functions |

### Screens

`renderer/src/ChatPanel.tsx` is the conversation: business switcher, thread rail with
search and pinning, streaming conversation with Stop, model picker, the attribution
chip, the fallback line, the sources line, the privacy line, the remembered-items rail
with edit and delete, and draft cards offering Approve, Edit and Reject. Styles were
appended to the **existing stylesheet**, `desktop/renderer/src/shell.css`, scoped to
`data-shell="chat-screen"`. No second stylesheet and no new token set: a test fails if
one appears.

---

## 2. How it was tested (commands and real output)

### Desktop suite - historical pre-fix run

```
$ cd desktop && npm run check
run-tests: unit tests under node (50 files)
# tests 781
# pass 780
# fail 0
# skipped 1
run-tests: database tests under Electron node (12 files)
i tests 143
i pass 142
i fail 1
```

The one skip is a file-permission test that only applies on Linux and Mac. The suite
runs in two halves because the Node on this machine is version 20 and has no built-in
database engine; the storage tests run under Electron's own Node, which is the engine
the shipped app uses.

**Historical F11 failure, before the fence-label fix.** It was
`features/copilot/main/chat/recall.test.js` - "closing a thread leaves a summary that later
turns are sent instead of the text it covered" - failing with `AssertionError: timed out
waiting for the turn to finish`. That test drives a `cloud: true` turn (`recall.test.js:89-90`)
after a summary existed. When the IDs drawn for that run tripped the rule, the turn was
refused before it reached the provider and the wait never ended; otherwise the test passed.
Run alone three times under Electron's Node, it failed twice and passed once. This is
pre-fix evidence, not the result of the current suite.

That count includes the areas criterion 1 names:

- **repository misuse**: cross-business and cross-account reads and writes, including
  a second person on the same machine and a foreign message id used as a source
- **recorded-provider chat**: a turn driven by a scripted provider, not a real model
- **cancellation**: stopping mid-stream leaves the partial answer and no assistant row
- **memory persistence**: items surviving a restart, and edits and deletions sticking
- **proposal safety**: a reply that *says* "create a task" creates nothing, while the
  same words in the person's own message produces a draft

### Desktop suite - current run

```
$ cd desktop && npm run check
run-tests: unit tests under node (50 files)
# tests 897
# pass 896
# fail 0
# skipped 1
run-tests: database tests under Electron node (12 files)
i tests 216
i pass 216
i fail 0
```

The one skipped test is a file-permission test that only applies on Linux and Mac. The suite
runs in two halves because the Node on this machine is version 20 and has no built-in
database engine; the storage tests run under Electron's own Node, which is the engine
the shipped app uses.

**Current F11 verification.** The test in `privacy.test.js` ("digit-heavy memory and summary IDs are allowed while user-supplied long numbers are blocked") passes stored memory, a summary and a seq 3 user turn through `assembleContext` and sends `assembled.messages` directly to `buildCloudPayload`. The allowed payload contains both memory texts, the summary text and the seq 3 user text, while excluding all three digit-heavy IDs. A separate user-supplied long number (`08031234567`) remains blocked as `long_number`. This regression verifies the F11 fence-label correction.

### Electron window

```
$ cd desktop && npm run shell:smoke
{"ok":true, ... ,"failed":[]}
```

71 checks, 0 failed, re-run on the corrected tree. 22 of them drive the conversation
screen in a real Electron window with stub bridges: it draws and is reachable from the rail, threads list, the
conversation draws, each answer carries its model and origin, the fallback sentence,
the no-sources sentence, a long unbroken message does not push the layout sideways,
the empty state, a failed turn with its sentence, the retry, Tab reaching the message
box, the focus rule, dark theme reaching the screen, switching business leaving nothing
behind, signing out replacing the screen with the gate, and the 360 px dock.

### Persistence, isolation and locking, under real Electron

A probe run under Electron's Node, against the built bundle, with a keychain that
writes to a file so a restart is a real restart. **13 checks, 0 failed.**

```
ok   each business lists only its own thread
ok   one business cannot read the other business's messages
ok   a stored answer keeps its model, provider and cloud label
ok   a restart still lists the conversation
ok   a restart keeps both messages, with the question in its own words
ok   a restart keeps what the assistant was told
ok   an edited item is marked as the person's own wording and locked
ok   the edit survives a restart, and is still marked as the person's
ok   a closed store refuses to hand back a conversation
ok   signing back in finds the conversation again, because the key is durable
ok   no sentence written to the database is readable in its files
ok   a different key is refused instead of showing an empty conversation
ok   the journal of an open database holds ciphertext too
```

The last one matters most: the check is not against the logic but against the bytes.
Two businesses were given conversations containing marker sentences, and the database
file, its shared-memory file and its write-ahead journal - 551,896 bytes with 20
messages in the open journal - were searched for those sentences and for the business
names. Nothing was found.

### Live cloud run (criterion 3)

Purpose-supplied key, entered through the same boundary the screen uses, against the
real endpoint. Model: **deepseek-flash**, reported by the provider as cloud.

```
turn settled after 1539 ms as done
answer: "Got it-I'll move the Tilley quote to Friday."
memory: [["decision", "The quote moves to Friday."]]
```

So a real turn streamed, was stored with its provider, model and cloud flag, and the
pass that runs afterwards extracted a decision from it.

**Live local run: pending.** No local model server is installed on this machine and the
phase forbids installing or downloading one without asking. The local adapter is
covered by its own tests against recorded and mock servers, which is what the plan
allows until a local model exists here.

### The evaluation (criterion 5)

Two sets of 24 prompts, run against deepseek-chat through the app's own path: credential
entry challenge, credential store, keychain, provider service, guarded transport, the
shipped prompt, and then the real apply rules. The sets live in `desktop/evals/copilot/`
and are checked by `npm run test:eval`, which fails if either set drops below 20 cases,
loses its negative cases, loses the misses seen in use, or grows an expectation the
judging code does not understand.

| Feature | Cases | Judged on content | Passed | Failed | Refused before send |
| --- | --- | --- | --- | --- | --- |
| Memory extraction | 24 | 23 | 18 | 5 | 1 |
| Task drafting | 24 | 24 | 24 | 0 | 0 |

Failed turns, reported separately and never scored as a pass or as a correct silence:
0 timeouts, 0 transport errors, 0 answers that could not be made to fit the shape, in
both sets.

The sets were run three times. The first run had a harness defect, described in section 4,
so its numbers are not reported. The two clean runs passed 17 and 18 of 23 memory cases,
with the same two groups failing each time, and 24 of 24 drafting cases each. An earlier
run of the same drafting set scored 23 of 24, when draft-14 put a project name in the due
hint field. The table above is the last clean run, which is the one the saved per-case
evidence comes from.

Each case gets brand-new repositories, so no case can inherit memory, a pending card or
half-finished extraction work from the one before it. That is asserted rather than
claimed: the run writes a canary row into a finished case's store and then checks the next
case's store for it. 48 checks, 0 failures. One case is refused before it is sent because
it contains an email address; it is counted in the last column and the model was not
exercised by it.

To repeat the run, from `desktop`: build the main bundle with `npm run build:main`, then
run `npm run eval -- --preset deepseek --model deepseek-chat` with `ZURICOPILOT_EVAL_KEY`
in the environment for that command only.

What the drafting table does not show, and this is the part worth reading: the drafting
pass is only reached for 16 of the 19 messages that should produce a card. The trigger is
a cost guard, and it does not recognise three phrasings people actually use - "Remind me
to call the surveyor on Monday", "I need a task to review the lease renewal before March"
and "Put a task on my list to print the induction packs". So the model drafts whenever it
is asked, and the app does not always ask. The earlier report counted those two as model
misses; they were not. The pass never ran for them.

What still misses, and why it matters:

- **5 of 23 memory prompts store something that should not be stored** (6 in another
  run of the same set). Three are acknowledgements of an assistant suggestion: the model
  returns a decision such as "The person agreed to proceed with the proposed action."
  although the offer came from the assistant. Two are questions the assistant answered in
  the next message: "How many items are still on the March invoice?" comes back as an open
  question. A third answered-question case moved between runs. These are invented items
  in the worse direction, because a stored item is sent as context on every later turn.
- **Both open-question misses from the earlier report now pass.** The Tilley deposit and
  the Abuja sign-off come back as open questions this time.
- **The closing-thank-you miss now passes.** "Thanks, that is all for now" and a plain
  thank you both produce no item, in this run and the one before it.

Limitations, stated so the numbers are not read as more than they are:

- One run per case at temperature 0, and the same case can still flip between runs:
  draft-14 put a project name in the due hint field in one run and passed in the other
  two, and mem-19 moved once. The counts are one sample each, which is why three runs are
  recorded above rather than one.
- Each memory case is a fixed two-message exchange fed straight to the recall pass, so
  the set measures extraction, not a whole chat turn.
- Judging is by token clauses, not exact wording. A clause requires the words that carry
  the meaning, so a correct answer phrased with entirely different words could fail.
- No local model is installed here, so the live local deferral above still stands and
  nothing was installed or downloaded to make this run possible.
- The key was supplied for this run through the environment, handed to the credential
  entry boundary, and never written to the results. The run re-reads its own output and
  deletes it if the key appears there. Full per-case evidence stays local and untracked
  in `.tmp-zuricopilot-eval/<run id>/`.


### The other suites (criterion 4)

```
$ npm run test -- --maxWorkers=2
 Test Files  101 passed (101)
      Tests  818 passed (818)
   Duration  117.59s

$ python manage.py test
Ran 850 tests in 847.891s
OK

$ npm run build
ok  built in 8.55s
```

All three were re-run on the corrected tree. The times are lower than the first pass only
because this machine was quieter; the counts are unchanged.

---

## 3. Web app unchanged (the six section 5 outputs)

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

Read honestly: that is the **same** diff Phase 1 and Phase 2 recorded, down to the same
four files and the same 139 insertions. Phase 3 added no web change at all. The
committed diff was empty at the time of that historical proof run; this is not a
statement about the current Git status.

### Output 2: the build output has the same hashed names

It does not, and it cannot while an approved web change exists.

```
  FAIL  asset list changed: 25 missing, 25 added
```

### Output 3: no assistant content in the built app

```
  FAIL  assistant content found: assets/SettingsView-CCD1SIl5.js (content)
```

The single match is the approved permission-name string carried by the settings chunk,
not assistant code.

### Output 4: the frontend suite passes

```
$ npm run test -- --maxWorkers=2
 Test Files  101 passed (101)
      Tests  818 passed (818)
   Duration  117.59s (transform 6.29s, setup 28.00s, import 18.84s, tests 124.89s, environment 43.52s)
```

### Output 5: the backend suite passes

```
$ python manage.py test
Ran 850 tests in 847.891s
OK
```

### Output 6: the mockups are not build inputs

```
4. Mockups stay outside the build
  PASS  vite.config.js has no rollupOptions/input override, so the build takes the default index.html entry
  PASS  index.html has exactly one module script, /src/main.jsx
  PASS  no file in dist/ carries the mockup-only marker text
  PASS  no mockup page is emitted (copilot-mockup.html, mockup.html)
  WARN  121 mockup-only classes reach the production stylesheet: -mx-2, -right-1, -right-12, -top-1, -top-16, -translate-y-full, @3xl:flex, @3xl:flex-col (allowed by --allow-mockup-css)
        this run does not prove the app stylesheet is independent of the mockups
```

### The proof, whole

```
$ node desktop/scripts/verify-web-unchanged.mjs --phase-start 4579aaa --baseline .tmp-phase1/phase1-baseline.txt
...
RESULT: FAIL - 5 of 14 checks failed: p3, p4, b2, d1, m5

$ ... --allow-mockup-css
...
RESULT: FAIL - 4 of 14 checks failed: p3, p4, b2, d1
```

Both were re-run on the corrected tree, with the build this time rather than `--skip-build`,
which is why the count is 14 checks here and 13 in the first pass. Inherited failures: p3
and p4 (the work is deliberately uncommitted), b2 (any web change renames all 25 built
chunks), d1 (the approved permission name), m5 (the approved mockup coupling, recorded as a
warning). **Phase 3 introduced none of them.** The set is identical to the one Phase 2
recorded.

---

## 4. Deviations

**1. A defect in the provider seam was found and fixed (the one code change in this
task).** Every adapter builds its request as a plain object; the shipped pinned
transport only accepts text or bytes, and the guard passed the object straight
through. The result was that **no real model call could succeed through the app** - it
failed before a socket was opened and came back as "the model provider could not be
reached", which reads exactly like a network problem and sends a person to check their
connection. There is no test that could have caught it, because the adapter tests and
the guard tests each supply a stand-in transport that accepts whatever it is handed, so
the two halves were each correct and never met.

The fix serialises a plain object once in the guard, before the first hop, so the
decision above it is made about the bytes that actually leave and a redirect cannot
carry a different body. Two regression tests were added: the object becomes text and is
identical on both hops, and a string or Buffer body is sent unchanged. Without this fix
criterion 3 could not be evidenced at all, which is why it is in this task rather than
deferred.

Evidence the fix is real, not just green tests: before it, a live turn failed before any
socket was opened, with `EgressTransportError`; after it, the same turn streamed and
settled in 1,539 ms and produced a decision.

**2. The report says "the six section 5 outputs", where earlier reports said "five"
and then listed six.** Counted properly there are six.

**3. A cause line in proof check b2 is wrong, and is not repeated as fact.** When the
asset list changes, the proof prints:

```
cause: the mockup files changed since the baseline was recorded (639650acd9138e5d -> 60c9755a16372aff)
```

The two fingerprints are not comparable: check p6 hashes the seven pinned mockup files
and passes, while this line hashes those seven *plus* `src/mockups/copilot/main.jsx`.
The mockups did not change. This is what actually drives b2: the baseline was recorded
before the approved Phase 1 web change, so every later build renames all 25 chunks. The
script is unchanged, because the owner declined amending the proof.

**4. The evaluation harness was wrong three times before it was right**, and every
mistake is recorded because each one nearly produced a false result. A fixed 2.5-second
wait was too short for a real extraction round trip, which made every prompt read as "got
nothing"; the drafting score counted already-rejected cards, which made later prompts look
as though they had drafted work nobody asked for; and, once the sets were widened, the
isolation canary was written into the store the judge was about to read, so two correct
empty answers were scored as failures. All three were fixed and the sets re-run. Numbers
from a run with a known harness defect are kept on disk but not reported, because they
measure the harness, not the model.

**5. Live local model test is pending**, as the plan permits: no local server is
installed and installing one is forbidden without asking.

**6. UI evidence comes from real Electron windows, not from a browser against the web
app.** The desktop renderer needs its preload bridge, so a browser check would be a
stub page - which is what the Electron harness already is, but running the real renderer
in real Chromium. It is the stronger of the two, so that is what the 22 checks use.

**7. One known behaviour was left alone.** Pressing "Try again" after a failed turn
re-asks the question, so the question appears twice in the thread. A single-message
retry needs a new channel in the service, which is a larger change than this task.

**8. Two verbatim-output glyphs were normalised.** The database half of the suite and
the root build print a leading `i`-in-a-circle and a check mark. Both were replaced with
plain text (`i` and `ok`) in section 2 so the report is ASCII. Nothing else in any
quoted output was altered.

**9. The F1 correction introduced F11, later fixed by fence labels.** Fencing each
remembered record with its row ID put a 32-character hex string into the prompt. The
privacy scan refused a run of seven or more consecutive digits, so the
pre-fix effect was that a business whose IDs held such a run had every cloud turn
refused. The measurement found this in 57.9 percent of two-ID blocks. The later
fence-label fix removed the IDs from the prompt, and the regression test verifies
the assembled cloud payload.

**10. What earlier verification ran, and what it carried forward.** The commands
quoted in sections 2 and 3 are historical runs. The desktop-suite output predates the
fence-label fix and records its F11 failure. The evaluation results in section 2 are
carried forward unchanged: they
were produced by the task that completed the 24-case sets, and this pass neither re-ran
them nor spent further live calls. The live cloud run and the live local deferral are
likewise carried forward, with the local one still pending because no local model is
installed here and installing one is not permitted without asking.

---

## 5. Open questions

**Historical question 1, resolved by the fence-label fix.**

1. **F11 previously blocked cloud turns for some businesses.** When fenced row IDs read as long numbers, cloud turns were
   refused. The F1 correction fenced every remembered record with its row ID. Row IDs are
   always 32 hexadecimal characters (`db/repositories/context.ts:41-43`,
   `randomBytes(16).toString('hex')`), and the privacy scan in `chat/privacy.ts` refuses a run
   of seven or more consecutive digits (`LONG_DIGIT_RUN` at `chat/privacy.ts:86`), which a hex
   id can hold. Letters break the run, so this is not every id. Measured against the built
   bundle: `memory:abcdefabcdefabcdefabcdefabcdefab` and
   `memory:deadbeefdeadbeefdeadbeefdeadbeef` return `null`, while
   `memory:0f1e2d3c4b5a69788796a5b4c3d2e1f0` and
   `summary:a1b2c3d4e5f60718293a4b5c6d7e8f90` return `long_number`, and a dashed date
   `14-03-26` returned `null`. Over 20,000 freshly generated IDs, 35.0 percent of
   single IDs and 57.9 percent of two-ID blocks fired the rule. Driving the old seam -
   `recallText()` output for one decision plus one summary, passed to `buildCloudPayload` -
   returned `blocked: true, reason: long_number` on such a draw. An affected business was
   refused on every cloud turn until its rows changed; a business without memory was
   unaffected. The historical desktop-suite failure above came from this defect.
   The implemented correction uses fence labels without row IDs in the prompt.

**The four findings that used to block are resolved:** F1, F2, F3 and F11. The evidence for each is in
`desktop/reports/phase-3-security-review.md`, sections 1a and 1a.2. They keep their place here, with the
original description and what was done about it, because they are the record of what this
phase got wrong:

- **F1 - remembered content reached the model as instructions, not as data.** Resolved:
  `chat/context.ts:101-104` now tells the model that everything between a record's begin and
  end lines is quoted business data and that directions inside it are never instructions.
  Each item and the summary are fenced with labels, and a stored line that forges a
  fence, a heading or the notice is escaped. Covered by regression tests in
  `chat/context.test.js`.
- **F2 - the privacy line claimed more than the code checks.** Resolved: the false assurance
  is gone, and the notice now names the limit at `chat-screen.ts:164` - "Client or staff names
  and postal addresses are not checked, so those would still be sent." A regression test
  covers a client name that still passes the checks unchanged.
- **F3 - the preview was not the payload that is sent.** Resolved: preview and send now open
  the provider identically with the model id (`chat/service.ts:847` and `:871`), share one
  context-assembly path and one privacy transform, and the new turn joins the conversation
  before the trim rather than after it.
- **F11 - fenced row IDs previously blocked some cloud turns.** Resolved: the test
  passes stored memory, a summary and a seq 3 user turn through `assembleContext`,
  then passes `assembled.messages` directly to `buildCloudPayload`. The allowed
  payload contains both memory texts, the summary and user turn, excludes all three
  digit-heavy IDs, and still blocks a user-supplied long number as `long_number`.

**Questions 2 to 6 are decisions, not defects.**

2. **How should an approved web change count in the proof?** This is the same question
   Phase 1 raised and is the only thing standing between the proof and a clean result. The
   recommendation, needing no script change and no new approval, is to commit the two
   prepared commits and then compare a build with the approved files reverted against a
   build without. That turns "unchanged" into a measurable claim instead of a
   contradiction.
3. **Should the drafting trigger recognise softer requests?** The wider set puts a number
   on it: 16 of the 19 messages that should produce a card reach the drafting pass at all.
   It misses "Remind me to call the surveyor on Monday", "I need a task to review the lease
   renewal before March" and "Put a task on my list to print the induction packs", and the
   model drafted all three correctly when handed to it directly. Widening the pattern is
   easy; the risk is the other column, where all five "must not draft" messages currently
   stay silent. Worth a decision before Phase 6, which is where drafts start being
   executed.
4. **Should an answered question be remembered?** The kind problem from the earlier run is
   gone: both open questions come back as `open_question`. What remains is different. Two
   cases asked a question that the assistant answered in the next message, and the model
   stored it as an open question anyway, even though the prompt says not to; a third did
   the same in two runs out of three. That is prompt wording rather than a missing kind,
   and it is the largest remaining memory miss.

5. **The remembered-items panel does not show provenance.** A fact the person deleted
   can still sit inside a rolling summary written before the deletion, so the model
   keeps seeing it in summary form until the summary is next written. Nothing on screen
   says so.
6. **A decided draft can be re-decided.** The plan's amend-only record would be more
   honest. It belongs with Phase 6, when a decision starts having consequences.
