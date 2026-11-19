/*
 * The shape of `window.zuriProviders`, as injected by the sandboxed preload.
 *
 * The types come from the shared contract rather than being restated here, for
 * the reason the access declaration gives: one table for the channels, the
 * requests and the failure tokens is what stops the main process and the page
 * drifting apart, and a second copy in a declaration file is exactly that drift.
 *
 * The field is optional because the page is also opened in a browser during
 * design work, where no preload runs. Keeping it optional forces the check at the
 * call site instead of hiding a crash until someone opens the page outside the
 * shell - and on a Models screen the failure that hides is a screen that silently
 * cannot save a key.
 */

import type { ProviderBridge } from '../../features/copilot/shared/providers/settings-contract'

declare global {
  interface Window { zuriProviders?: ProviderBridge }
}

export {}
