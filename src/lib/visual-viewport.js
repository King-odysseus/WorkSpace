export function syncVisualViewportVariables(targetWindow = window, targetDocument = document) {
  const root = targetDocument?.documentElement;
  if (!root?.style) return;

  const viewport = targetWindow?.visualViewport;
  const width = viewport?.width ?? targetWindow?.innerWidth ?? 0;
  const height = viewport?.height ?? targetWindow?.innerHeight ?? 0;

  root.style.setProperty("--workspace-visual-viewport-top", `${Math.max(0, viewport?.offsetTop ?? 0)}px`);
  root.style.setProperty("--workspace-visual-viewport-left", `${Math.max(0, viewport?.offsetLeft ?? 0)}px`);
  root.style.setProperty("--workspace-visual-viewport-width", `${Math.max(0, width)}px`);
  root.style.setProperty("--workspace-visual-viewport-height", `${Math.max(0, height)}px`);
}
