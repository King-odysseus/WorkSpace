import { beforeEach, describe, expect, it, vi } from "vitest";

function eventHandlers(addEventListener) {
  return Object.fromEntries(
    addEventListener.mock.calls.map(([type, handler]) => [type, handler]),
  );
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn() })));
});

describe("install prompt lifecycle", () => {
  it("captures the browser prompt and records an accepted install", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const module = await import("./install-prompt.js");
    module.startInstallPromptCapture();
    const handlers = eventHandlers(addEventListener);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = {
      preventDefault: vi.fn(),
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" }),
    };

    handlers.beforeinstallprompt(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(module.getInstallSnapshot().canPrompt).toBe(true);

    await expect(module.promptToInstall()).resolves.toBe("accepted");

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(module.getInstallSnapshot().installed).toBe(true);
    expect(window.localStorage.getItem("workspace-app-installed-v1")).toBe("true");
  });

  it("marks the app installed after the browser installation event", async () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    const module = await import("./install-prompt.js");
    module.startInstallPromptCapture();
    const handlers = eventHandlers(addEventListener);

    handlers.appinstalled();

    expect(module.getInstallSnapshot().installed).toBe(true);
    expect(window.localStorage.getItem("workspace-app-installed-v1")).toBe("true");
  });

  it("stores dismissals separately for each signed-in user", async () => {
    const module = await import("./install-prompt.js");

    expect(module.isInstallBannerDismissed(7)).toBe(false);
    module.dismissInstallBanner(7);

    expect(module.isInstallBannerDismissed(7)).toBe(true);
    expect(module.isInstallBannerDismissed(8)).toBe(false);
  });
});
