const INSTALLED_STORAGE_KEY = "workspace-app-installed-v1";
const DISMISSED_STORAGE_PREFIX = "workspace-install-banner-dismissed-";

let deferredInstallPrompt = null;
let installSnapshot = null;
let captureStarted = false;
const listeners = new Set();

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)")?.matches;
  return Boolean(displayMode || window.navigator?.standalone);
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function supportsNativeInstallPrompt() {
  return typeof window !== "undefined" && "onbeforeinstallprompt" in window;
}

function buildSnapshot() {
  const installed = isStandaloneMode() || readStorage(INSTALLED_STORAGE_KEY) === "true";
  const canPrompt = Boolean(deferredInstallPrompt);
  const ios = isIosDevice();
  const nativeSupported = supportsNativeInstallPrompt();
  return {
    installed,
    canPrompt,
    ios,
    nativeSupported,
    eligible: !installed && (canPrompt || ios || nativeSupported),
  };
}

function notify() {
  installSnapshot = null;
  listeners.forEach((listener) => listener());
}

function rememberInstalled() {
  deferredInstallPrompt = null;
  writeStorage(INSTALLED_STORAGE_KEY, "true");
  notify();
}

export function getInstallSnapshot() {
  const next = buildSnapshot();
  if (
    !installSnapshot ||
    installSnapshot.installed !== next.installed ||
    installSnapshot.canPrompt !== next.canPrompt ||
    installSnapshot.ios !== next.ios ||
    installSnapshot.nativeSupported !== next.nativeSupported ||
    installSnapshot.eligible !== next.eligible
  ) {
    installSnapshot = next;
  }
  return installSnapshot;
}

export function subscribeToInstallState(listener) {
  listeners.add(listener);
  startInstallPromptCapture();
  return () => listeners.delete(listener);
}

export function startInstallPromptCapture() {
  if (captureStarted || typeof window === "undefined") return;
  captureStarted = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault?.();
    deferredInstallPrompt = event;
    notify();
  });

  window.addEventListener("appinstalled", rememberInstalled);

  const media = window.matchMedia?.("(display-mode: standalone)");
  media?.addEventListener?.("change", notify);
}

export async function promptToInstall() {
  if (!deferredInstallPrompt) return "unavailable";

  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notify();

  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === "accepted") rememberInstalled();
    return choice?.outcome || "dismissed";
  } catch {
    return "unavailable";
  }
}

export function isInstallBannerDismissed(userId) {
  if (userId === null || userId === undefined || userId === "") return true;
  return readStorage(`${DISMISSED_STORAGE_PREFIX}${userId}`) === "true";
}

export function dismissInstallBanner(userId) {
  if (userId === null || userId === undefined || userId === "") return;
  writeStorage(`${DISMISSED_STORAGE_PREFIX}${userId}`, "true");
}
