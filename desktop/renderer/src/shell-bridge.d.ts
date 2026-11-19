/*
 * The shape of `window.zuriShell`, as injected by the sandboxed preload
 * (desktop/electron/preload/shell.js).
 *
 * The types are imported from the shared contract rather than restated here:
 * one table for the modes, the window actions and the channel names is what
 * stops the main process and the page drifting apart, and a second copy in a
 * declaration file would be exactly the drift the contract exists to prevent.
 *
 * The bridge is absent when the page is opened outside the desktop shell, for
 * example in a browser during design work, so every use has to handle
 * `undefined` before calling a method. Keeping the field optional is the point:
 * it forces the check at the call site instead of hiding a crash until someone
 * opens the page in a browser.
 *
 * This file is a module (it ends with an empty export), so the window
 * augmentation is written inside `declare global`; without that export the
 * block would be a syntax error.
 */

import type { ShellBridge } from '../../features/copilot/shared/shell-contract'

declare global {
  interface Window { zuriShell?: ShellBridge }
}

export {}
