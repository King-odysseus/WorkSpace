# Phase 3: Businesses and chat with memory

_Report written by the KAI Crew on 2026-11-17._

## What was built

- Add encrypted business storage: accepted, 4 rounds, sent back 1 time, $1.55
- Connect persistent chat to real streaming: accepted, 2 rounds, sent back 1 time, $4.15
- Add remembered items and draft task proposals: accepted, 2 rounds, sent back 1 time, $4.24
- Build the business chat and memory screens: accepted, 2 rounds, sent back 1 time, $6.45
- Review conversation privacy and isolation: accepted, 2 rounds, sent back 1 time, $3.12
- Verify Phase 3 and record acceptance evidence: accepted, 2 rounds, sent back 1 time, $2.93
- Keep remembered content separate from model instructions: accepted, $1.33
- Make the privacy notice describe what is actually checked: accepted, $1.27
- Make the privacy preview match the selected model's request: accepted, $1.40
- Complete the required memory and drafting evaluation sets: accepted, 2 rounds, sent back 1 time, $1.50
- Review the three Phase 3 security corrections: accepted, $2.10
- Record fresh evidence for the remaining Phase 3 work: accepted, 2 rounds, sent back 1 time, $1.26

## How it was checked

- Add encrypted business storage: Security accepted it in round 4.
- Add encrypted business storage: Lead accepted it in round 4.
- Connect persistent chat to real streaming: Security accepted it in round 2.
- Connect persistent chat to real streaming: Lead accepted it in round 2.
- Add remembered items and draft task proposals: Security accepted it in round 1.
- Add remembered items and draft task proposals: Security accepted it in round 2.
- Add remembered items and draft task proposals: Lead accepted it in round 2.
- Build the business chat and memory screens: Security accepted it in round 1.
- Build the business chat and memory screens: Security accepted it in round 2.
- Build the business chat and memory screens: Lead accepted it in round 2.
- Review conversation privacy and isolation: Security accepted it in round 1.
- Review conversation privacy and isolation: Security accepted it in round 2.
- Review conversation privacy and isolation: Lead accepted it in round 2.
- Verify Phase 3 and record acceptance evidence: Security accepted it in round 2.
- Verify Phase 3 and record acceptance evidence: Lead accepted it in round 2.
- Keep remembered content separate from model instructions: Security accepted it in round 1.
- Keep remembered content separate from model instructions: Lead accepted it in round 1.
- Make the privacy notice describe what is actually checked: Security accepted it in round 1.
- Make the privacy notice describe what is actually checked: Lead accepted it in round 1.
- Make the privacy preview match the selected model's request: Security accepted it in round 1.
- Make the privacy preview match the selected model's request: Lead accepted it in round 1.
- Complete the required memory and drafting evaluation sets: Security accepted it in round 2.
- Complete the required memory and drafting evaluation sets: Lead accepted it in round 2.
- Review the three Phase 3 security corrections: Security accepted it in round 1.
- Review the three Phase 3 security corrections: Lead accepted it in round 1.
- Record fresh evidence for the remaining Phase 3 work: Security accepted it in round 2.
- Record fresh evidence for the remaining Phase 3 work: Lead accepted it in round 2.

## Files changed (11)

- `desktop/features/copilot/main/db/ownership.test.js`
- `desktop/electron/smoke-chat-preload.js`
- `desktop/electron/smoke-chat.js`
- `.kai/plans/conv_c3d95a2f-8765-4990-a1ed-c9816637bf3f.json`
- `desktop/features/copilot/main/chat/context.test.js`
- `desktop/features/copilot/main/chat/context.ts`
- `.kai/plans/conv_6c2654fe-1e18-424f-b08b-78ed3fdbd6f4.json`
- `desktop/features/copilot/shared/chat-screen.test.js`
- `desktop/features/copilot/shared/chat-screen.ts`
- `desktop/evals/copilot/run-evaluation.test.js`
- `.kai/plans/conv_50694d7a-ef83-4c35-9cbd-c9c1c3013a10.json`

## Notes from the reviewers

- Lead: The DeepSeek key pasted into the crew guidance is stored there as plain text. Replace it with a new key and cancel the old one.
- Security: All 12 evaluation tests passed when run directly. No files changed or live provider calls made.
- Security: Plan recording was refused because approval is unavailable.
- Security: The task changed only its plan record. It contains no secrets and changes no application behavior, access checks or privacy controls.
- Security: No files changed and no tests run in this review. This accepts the recorded change only, not Phase 3 sign-off.
- Security: The security and acceptance reports still describe F1, F2 and F3 as unresolved. Update them with the correction review results.
- Lead: All four criteria are met. Most of the builder's reply was cut off before it reached me, but its plan shows every step done. What did come through covers the edge cases, business isolation, drafts only being proposed, and the missing runtime evidence.
- Lead: I checked the source myself against the builder's main claims, and they hold. F1: saved notes and the summary go to the model inside labelled start and end markers, with a warning that they are quoted data, not instructions. A line that tries to fake an end marker or that warning is escaped (made ha
- Lead: Nothing has been run or built for this review, so the verdicts rest on reading the code and tests. The builder's list of missing runtime evidence is fair. The new tests need a recorded run (run 'npm run build:main' in desktop first). There is no screen check of the privacy line for a real account, a
- Lead: Two small issues are worth a follow-up but do not block. The preview can show the previous model or text for a moment after a change. Send stays enabled while the preview says the message would be blocked, so the question is saved and then refused, though nothing leaves the app.
- Lead: The builder still needs to write the F1, F2 and F3 verdicts into the Phase 3 security review and acceptance report. Both still list all three as open.
- Lead: The bug where saved-note and summary ids are mistaken for long number strings is still there and blocks about a third of cloud turns. It needs its own task. The DeepSeek key pasted into the guidance should still be revoked and replaced.
- Security: No security blocker found in the changed test. It uses a synthetic key, isolated temporary folders and no network calls. It covers both reports containing the key, stale report cleanup and clean output.
- Security: Syntax check passed. Tests were not rerun because they write files and this review is read-only. No files changed.
- Lead: Criterion 1: both sets now have 24 cases each. The case-shape test checks that each set keeps at least 20 cases, its negative cases and the misses seen in earlier use.
- Lead: Criterion 2: every case gets new, empty stores. The run proves this by planting a marker row after each case is scored and checking that the next case never sees it. Timeouts, transport errors and badly shaped answers are counted on their own and are never scored as passes.
- Lead: Criteria 3 and 5: the key leak found in the last review is fixed. Both reports are built and checked in memory before either is saved. If the key shows up in either one, neither file is written, and old copies at those paths are deleted. The new test runs as part of 'npm run check', through 'test:ev
- Lead: Criterion 4: no local model is installed. The report keeps the allowed note that the live local test is postponed, and nothing was installed or downloaded.
- Lead: For this review I only read the code. I ran no tests because they write files. The builder reports 'npm run check' finishing without errors, and that their new test failed when run against the old code.
- Lead: The builder's list of changed files named only the test, but the runner and package.json changed as well. I reviewed all three.
- Security: No files changed. No full suites rerun.
- Security: The corrected reports keep F11 open and describe blocking as dependent on the record id. A read-only probe confirmed the passing and failing examples.
- Security: No credential patterns found in either report. No files changed or full suites rerun.
- Security: Phase 3 remains blocked; this acceptance covers the report correction only.
- Lead: Criteria 1 and 2: the reports give the commands, counts and failures for the desktop check, the window smoke test, the frontend suite with --maxWorkers=2, the root build, the Django suite and both runs of the existing web proof. These figures come from the builder's runs. This review only read the r
- Lead: Criterion 3: the reports keep the resolved findings (F1 to F3), the open finding (F11), the evaluation misses, the inherited web-gate failures and the allowed postponement of the local model test separate from each other.
- Lead: Criterion 4: the acceptance report keeps its five headings and says at the top that Phase 3 is blocked and cannot be signed off. Every remaining 'every cloud turn' sentence is now conditional: a business is refused on every turn or on none, depending on its ids. No universal claim is left.
- Lead: Criterion 5: nothing is staged. No key pattern was found in either report, and this round added no dependency.
- Lead: Phase 3 is still blocked. F11 needs its own fix and a fresh security review, and only the person can decide how an approved web change should count in the web proof.
- Lead: The DeepSeek key pasted into the crew guidance is still saved there as plain text. It should be cancelled and replaced at DeepSeek.

## Decided while you were away: check these

- "Connect persistent chat to real streaming": asked Security could not give a readable verdict after four tries, so it did not check "Connect persistent chat to real streaming". Chose: Went on without Security's check. Check: Have Security check "Connect persistent chat to real streaming" again.
- "Add remembered items and draft task proposals": asked Security could not give a readable verdict after four tries, so it did not check "Add remembered items and draft task proposals". Chose: Went on without Security's check. Check: Have Security check "Add remembered items and draft task proposals" again.
- "Add remembered items and draft task proposals": asked Security could not give a readable verdict after four tries, so it did not check "Add remembered items and draft task proposals". Chose: Went on without Security's check. Check: Have Security check "Add remembered items and draft task proposals" again.
- "Build the business chat and memory screens": asked Security could not give a readable verdict after four tries, so it did not check "Build the business chat and memory screens". Chose: Went on without Security's check. Check: Have Security check "Build the business chat and memory screens" again.

## Cost

$31.30 across 12 tasks.
