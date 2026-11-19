# Phase 1: Shell, gating, access

_Report written by the KAI Crew on 2026-11-17._

## What was built

- Close Phase 1 verification and finalize its acceptance report: accepted, $1.43
- Restore visible desktop buttons and sidebar actions: accepted, $1.86
- Verify buttons in the running desktop app: accepted, $1.79

## How it was checked

- Close Phase 1 verification and finalize its acceptance report: Security accepted it in round 1.
- Close Phase 1 verification and finalize its acceptance report: Lead accepted it in round 1.
- Restore visible desktop buttons and sidebar actions: Security accepted it in round 1.
- Restore visible desktop buttons and sidebar actions: Lead accepted it in round 1.
- Verify buttons in the running desktop app: Security accepted it in round 1.
- Verify buttons in the running desktop app: Lead accepted it in round 1.

## Files changed (2)

- `desktop/electron/smoke-controls.js`
- `desktop/reports/phase-1-button-verification.md`

## Notes from the reviewers

- Security: No security issues found in shell.css or renderer-styles.test.js. No secrets, network requests or permission changes were introduced in these files.
- Security: All eight stylesheet tests passed when run directly. The test launcher was blocked by spawn EPERM.
- Security: No files changed. This security review does not independently verify visual behavior or clear Phase 3.
- Security: The credential exposed in the conversation should be revoked and replaced.
- Lead: Criterion 1: shell.css records each confirmed cause next to its fix. They are: the screen collapsed to 557px in an 800px window; the selected sidebar row was forced square; rail labels rendered at 16px because the app's unlayered 'button { font: inherit }' beat the 10px utility; the conversation pic
- Lead: Criterion 3: the assistant's sidebar rows and the Models and Chat buttons are now pills, and icon-only Chat buttons are circles. The no-border, no-shadow rule still holds. Rail cells use the web sidebar's 8px corner instead of a full pill, because each cell has two lines. That is a reasonable choice
- Lead: Criterion 4: there is still exactly one stylesheet under desktop/renderer/src, and it is shell.css. It adds no colour variables or raw colours. The shared files src/pencil.css and src/components/ui/ have no changes, and nothing is staged.
- Lead: Criterion 5: I re-ran the stylesheet tests directly and all 8 pass, including the 5 new regression checks. The full check, the renderer build and the light and dark screenshots are the builder's own results; this review did not repeat them.
- Lead: Small leftover: the comment above the chat-screen rules (around line 184 of shell.css) still says the Models screen is squared off. That is no longer true and should be updated in a later pass.
- Lead: The DeepSeek key pasted into the crew guidance is still saved there as plain text. It should be cancelled and replaced at DeepSeek.
- Security: No security issues found in the two scoped files. Test windows retain sandboxing and context isolation, use synthetic data, and introduce no credentials or privileged bridges.
- Security: JavaScript syntax validation passed. This review did not repeat visual checks or the full smoke suite. No files changed.
- Security: The provider key exposed in the conversation should be revoked and replaced.
- Lead: Criterion 3: the new control checks are wired into the window test. shell-smoke.js loads smoke-controls.js and runs runControlChecks. The 16 checks measure what is drawn: computed style, size, position in the window and what a click at the centre hits. They cover the rail, the assistant sidebar, Mod
- Lead: Criterion 1: nine screenshots are in the gitignored .tmp-buttons/shots folder. I opened the dark dock and dark Models shots. Their controls are visible, readable and not clipped, and the conversation footer and the 'Open full ZuriCopilot' button show in full. There is no dark shot of the assistant H
- Lead: Criterion 5: renderer/src still holds exactly one stylesheet, shell.css. src/pencil.css and src/components/ui have no changes. The only changed files under src/ are the three permission-display files from earlier accepted work. The report states that F11 and the web-unchanged proof remain open.
- Lead: For the person to look at: in dark theme the selected sidebar row is a dim pill with bronze text, not the 'white active pill' named in the design guidance. Light theme may differ. Compare it with the web app's dark sidebar in a later pass.
- Lead: The DeepSeek key pasted into the crew guidance is still stored there as plain text. It should be cancelled and replaced at DeepSeek.

## Cost

$5.08 across 3 tasks.
