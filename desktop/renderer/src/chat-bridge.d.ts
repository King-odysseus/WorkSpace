/*
 * The shape of `window.zuriChats`, as injected by the sandboxed preload
 * (desktop/electron/preload/shell.js).
 *
 * The types are imported from the shared contract rather than restated here:
 * one table for the channels, the event shapes and the failure tokens is what
 * stops the main process and the page drifting apart, and a second copy in a
 * declaration file would be exactly the drift the contract exists to prevent.
 *
 * The field is optional because the page is also opened in a browser during
 * design work, where no preload runs. Keeping it optional forces the check at
 * the call site instead of hiding a crash until someone opens the page outside
 * the shell - and on a conversation screen the failure that hides is a reply
 * that silently never arrives.
 *
 * `onEvent` is the only push channel on this bridge, and it answers with the
 * function that stops the listening. A turn streams into whichever listener was
 * registered, so a screen that unmounts without calling it leaves a callback
 * appending text to a conversation nobody can see.
 *
 * This file is a module (it ends with an empty export), so the window
 * augmentation is written inside `declare global`; without that export the
 * block would be a syntax error.
 */

import type { ChatBridge } from '../../features/copilot/shared/chat-contract'

declare global {
  interface Window { zuriChats?: ChatBridge }
}

export {}
