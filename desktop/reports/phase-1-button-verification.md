# Control visibility: verification of the desktop shell fixes

Date: 2026-11-17. Scope: the buttons and sidebar actions repaired in
`desktop/renderer/src/shell.css`, verified in real Electron windows.

This note records what was measured. It does not change the status of Phase 3: finding
F11 (the record-id privacy rule) and the web-unchanged proof remain open exactly as they
stood, and nothing here clears them.

## 1. What was measured, and where

Sixteen new runtime checks run as part of `npm run shell:smoke`, in
`desktop/electron/smoke-controls.js`. They open the built page in hidden Electron windows
with the same stub preload the conversation checks use, and read the result after the
browser has resolved every cascade layer: computed style, bounding boxes and hit testing.
Reading a rule out of a file would not have caught any of these defects, because the token
sheet pins several of the same properties with `!important`; the rule was present, correct
and still losing.

| Check | What it would catch |
| --- | --- |
| `controlsChromeRailLabelsFitOnOneLine` | rail labels at any size but 10px, wrapped, clipped or two lines |
| `controlsChromeRailRowsShareOneShape` | the current row changing shape against its neighbours |
| `controlsChromeRailControlsAreUsable` | a title bar control missing, outside the window or covered |
| `controlsChromeModeSwitchWorksByMouse` | a mode control that does not switch the mode when clicked |
| `controlsChromeModeSwitchWorksByKeyboard` | a mode control unreachable by Tab, or inert on Enter |
| `controlsAssistantFillsTheWindow` | the assistant collapsing instead of filling its window |
| `controlsAssistantNavRowsShareOneShape` | the selected destination drawn differently from the rest |
| `controlsAssistantNavIsUsable` | a sidebar action missing, clipped or covered |
| `controlsDisabledControlSaysSo` | a disabled control still offering a pointer cursor |
| `controlsConversationPickersAreFindable` | a picker filled with the surface behind it, or transparent |
| `controlsModelsButtonsArePills` | the Models screen squared off against the rest of the window |
| `controlsModelsFieldsAreFindable` | the address or provider field invisible on its panel |
| `controlsModelsControlsAreUsable` | a Models control clipped, covered or pushed out of view |
| `controlsDarkThemeKeepsControlsReadable` | a palette that changes the page but not the controls |
| `controlsAssistantNavWorksByKeyboard` | the sidebar unreachable or inert from the keyboard |
| `controlsFitTheDock` | the 360px column overflowing sideways, or its actions pushed out |

"Usable" is asked three ways, because each way catches a different defect: is there a box,
is that box inside the window once scrolled to, and does a click at its centre land on it
rather than on something covering it.

Two details the checks had to get right, both found by measuring:

- A control below the fold of a scrolling panel is reachable and therefore fine, so each
  control is scrolled into view before it is measured. One that is still outside the window
  after that is genuinely unusable.
- A field whose fill is `transparent` shows whatever is behind it, so it is invisible on a
  panel of the same colour. Transparent is therefore treated as *not* distinguishable,
  which a plain "are the two colours different" comparison would have missed.

## 2. The checks catch the defects they were written for

Patching the built stylesheet back to the broken state, then running the smoke test without
rebuilding, fails exactly the matching checks. Nothing about the source was changed:

| Defect put back | Checks that failed |
| --- | --- |
| rail labels at 16px | `controlsChromeRailLabelsFitOnOneLine` |
| `html, body, #root` without a definite height | `controlsAssistantFillsTheWindow` |
| current row `border-radius: 0 8px 8px 0` | `controlsAssistantNavRowsShareOneShape` |
| disabled control `cursor: pointer` | `controlsDisabledControlSaysSo` |
| conversation selects transparent | `controlsConversationPickersAreFindable` |
| Models controls squared off | `controlsModelsButtonsArePills` |
| Models fields transparent | `controlsModelsFieldsAreFindable` |
| the same, in dark theme | `controlsDarkThemeKeepsControlsReadable` |

The first attempt at this proof did not fail two of them, and both were faults in the proof
rather than in the code: the patched selector for the nav row was weaker than the one the
app uses, and a transparent field was being counted as "different from" the surface behind
it. The second fault was a real weakness in the check and is fixed; the table above is the
run after both corrections.

## 3. Screenshots

Taken from the built renderer in a real Electron window with the stub bridges, one window
reused across pages, in both themes and in the shipped 360px dock. Nine images: title bar
rail, assistant home, Models, the conversation, and the dock, each light and dark.

They are scratch evidence and are not committed: they live in the gitignored `.tmp-buttons/`
folder. Two behaviours of a hidden window had to be handled before they were worth looking
at, and both were visible in the first attempt's images:

- A hidden window composites lazily, so a capture taken immediately after a change showed a
  colour transition mid-flight, with the previous row still white. Captures now wait for the
  frame to settle, and the settled frame agrees with the measured style.
- Loading the same file with only a different hash is a same-document change, so the window
  kept showing the title bar page. The screenshots now force a real navigation.

## 4. Access gating, sign-out locking and proposal approval

Unchanged by this work, which touched one stylesheet, one stylesheet test, the smoke test and
its test-only stub.

| Requirement | Evidence |
| --- | --- |
| A locked person sees a gate and no assistant content | `CopilotView` draws `data-access="gate"` for `locked` and nothing for a state that has not arrived; smoke checks `chatSignOutShowsTheGate` and `chatSignOutRecordsALockedState` pass |
| The web view has no assistant bridge | smoke check `webViewHasNoBridge` passes |
| Sign-out locks without claiming success | the controller locks before the server call, reports a failure rather than success, and two automatic refreshes answer the locked state without reading the session |
| Approving a proposal creates nothing | the approve path records a decision only; there is no task-creation call reachable from it, and the card states "Approving records your decision only. Nothing is created or sent until Phase 6." Visible in the conversation screenshots |
| Only a pending proposal can be decided | database tests assert a proposal starts pending and that status transitions out of pending are refused |

## 5. Shared source and stylesheet count

| Question | Answer |
| --- | --- |
| Stylesheets under `desktop/renderer/src` | exactly one, `shell.css` |
| Its imports | one, `../../../src/pencil.css` |
| Raw hex colours in it | none |
| `<link>` or `<style>` in `desktop/renderer/index.html` | none |
| `src/pencil.css` modified | no |
| Other files modified under `src/` | the three permission-display files from already-accepted earlier work, unchanged by this task |

## 6. Results

| Command | Result |
| --- | --- |
| `npm run check` (desktop) | typecheck and both type checks clean; unit `786` tests, `785` pass, `0` fail, `1` skipped (a Linux/Mac-only file-permission test); database `143` tests, `143` pass; evaluation `15` pass |
| `npm run shell:smoke` | `87` checks, `0` failed, including the `16` above |
| `npm run build:renderer` | clean |

## 7. What this does not cover

- The screenshots come from the stub bridges, not from a signed-in account against a live
  server. They prove layout, not data.
- No provider key was used and no model was called.
- The new checks measure the assistant page as the stub presents it: a signed-in owner with
  two workspaces. A member, or a person with no access, sees the gate instead, which the
  conversation checks cover.
- The test stub's provider catalogue was out of date with `providerCatalogEntrySchema` (it
  keyed on `presetId`, not `id`), so the Models form had never actually been opened in a
  window: the provider list rendered an unchosen option and the address field never
  appeared. It now matches the shipped bridge. This was test data, not a defect in the app.
