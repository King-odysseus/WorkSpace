# Hand repeated local builder tools to the Architect

- kind: build
- written: 2026-11-19T14:33:17.121Z

# Local model stall and Architect handoff

## Reproduced

A new LM Studio runtime fixture kept requesting distinct `read_file` calls and reached 1,002 provider requests before the old 1,000-round default wrapped it up. A second fixture repeated the same tool call and result in an Implementer run; before the fix, the repeat guard asked the user to continue or finish instead of notifying the Architect handoff listener.

## Cause

The local provider inherited the general 1,000 tool-round ceiling. Also, the repeated-tool guard only asked the Architect listener for repeated assistant prose; repeated tool calls were handled only by the user-facing Continue/Finish path.

## Changes

- Local provider runs now default to a 30 tool-round ceiling. Explicit per-run and configured limits still take precedence. At the ceiling, KAI asks the model for a tool-free summary and preserves the work.
- When an Architect / Implementer run hits the repeated-tool stop threshold, the runtime notifies the active handoff listener. The Implementer turn is cancelled and the existing Architect loop receives its stuck marker and steps in. Runs without an active listener keep the existing Continue/Finish behavior.
- Added LM Studio runtime regressions for the local round ceiling and repeated-tool handoff.

## Verification

- Before fix: `npm test -- --run test/desktop-lmstudio.test.ts -t "wraps up a local model after 30 tool rounds"` failed; the mock received 1,002 requests under the old ceiling.
- After fix: `npm test -- --run test/desktop-lmstudio.test.ts test/desktop-architect-loop.test.ts test/desktop-direct-provider.test.ts` passed: 3 files, 152 tests.
- The new repeat handoff test confirms the same local tool result stops at five calls and invokes the active handoff listener.

## Limits

The regression uses an LM Studio-compatible local fixture; it does not run the user's Mac Studio model. The Architect can only step in when the run is started through the configured Architect / Implementer flow.
