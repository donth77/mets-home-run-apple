import { useEffect, useState } from "react";

export const DESKTOP_VIEW_MODES_QUERY = "(min-width: 691px)";

export function useDesktopViewModes() {
  const [desktopViewModes, setDesktopViewModes] = useState(
    () => window.matchMedia?.(DESKTOP_VIEW_MODES_QUERY).matches ?? window.innerWidth > 690,
  );

  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP_VIEW_MODES_QUERY);
    if (!query) return;
    const updateViewport = (event: MediaQueryListEvent) => setDesktopViewModes(event.matches);
    query.addEventListener("change", updateViewport);
    return () => query.removeEventListener("change", updateViewport);
  }, []);

  return desktopViewModes;
}
