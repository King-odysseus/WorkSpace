import { describe, expect, it, vi } from "vitest";
import {
  applyWorkspaceTheme,
  normalizeWorkspaceTheme,
  persistWorkspaceTheme,
  readWorkspaceTheme,
  resolveWorkspaceTheme,
  WORKSPACE_THEME_STORAGE_KEY,
} from "./theme.js";

describe("workspace theme", () => {
  it("normalizes unsupported stored values to light", () => {
    expect(normalizeWorkspaceTheme("sepia")).toBe("light");
    expect(normalizeWorkspaceTheme("dark")).toBe("dark");
    expect(normalizeWorkspaceTheme("system")).toBe("system");
  });

  it("resolves system mode from the operating-system preference", () => {
    expect(resolveWorkspaceTheme("system", true)).toBe("dark");
    expect(resolveWorkspaceTheme("system", false)).toBe("light");
    expect(resolveWorkspaceTheme("dark", false)).toBe("dark");
  });

  it("applies the resolved theme to the document and persists the preference", () => {
    const root = document.createElement("html");
    const storage = { setItem: vi.fn() };

    const resolved = applyWorkspaceTheme("dark", { root, storage });

    expect(resolved).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.style.colorScheme).toBe("dark");
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_THEME_STORAGE_KEY,
      "dark",
    );
  });

  it("removes the dark context when returning to light", () => {
    const root = document.createElement("html");
    const storage = { setItem: vi.fn() };
    root.classList.add("dark");

    applyWorkspaceTheme("light", { root, storage });

    expect(root.dataset.theme).toBe("light");
    expect(root.classList.contains("dark")).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_THEME_STORAGE_KEY,
      "light",
    );
  });

  it("reads only supported persisted values", () => {
    expect(readWorkspaceTheme({ getItem: () => "system" })).toBe("system");
    expect(readWorkspaceTheme({ getItem: () => "sepia" })).toBe("light");
  });

  it("reports when browser storage rejects a theme preference", () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error("storage blocked");
      }),
    };

    expect(persistWorkspaceTheme("dark", storage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_THEME_STORAGE_KEY,
      "dark",
    );
  });

  it("normalizes unsupported theme values before persisting", () => {
    const storage = { setItem: vi.fn() };

    expect(persistWorkspaceTheme("sepia", storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      WORKSPACE_THEME_STORAGE_KEY,
      "light",
    );
  });
});
