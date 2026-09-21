export const WORKSPACE_THEME_STORAGE_KEY = "workspace-theme";

export function normalizeWorkspaceTheme(value) {
  return value === "dark" || value === "system" ? value : "light";
}

export function resolveWorkspaceTheme(theme, prefersDark = false) {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme === "dark" ? "dark" : "light";
}

export function readWorkspaceTheme(storage = window.localStorage) {
  try {
    return normalizeWorkspaceTheme(
      storage.getItem(WORKSPACE_THEME_STORAGE_KEY),
    );
  } catch {
    return "light";
  }
}

export function applyWorkspaceTheme(
  theme,
  {
    prefersDark = false,
    root = document.documentElement,
    storage = window.localStorage,
  } = {},
) {
  const storedTheme = normalizeWorkspaceTheme(theme);
  const resolvedTheme = resolveWorkspaceTheme(storedTheme, prefersDark);

  root.dataset.theme = resolvedTheme;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.style.colorScheme = resolvedTheme;

  try {
    storage.setItem(WORKSPACE_THEME_STORAGE_KEY, storedTheme);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }

  return resolvedTheme;
}
