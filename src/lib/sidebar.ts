/**
 * Whether the desktop sidebar is collapsed.
 *
 * Kept outside React because the shell remounts on every navigation, and a
 * `useState` there would spring the sidebar back open each time the user opened
 * a page — which is exactly the thing collapsing it was meant to allow. Read as
 * an external store rather than copied into state on mount, matching
 * `lib/theme.ts`: the value exists before React runs, and mirroring it would be
 * an effect whose only job is `setState`.
 *
 * Only desktop consults this. The mobile drawer is a transient overlay with its
 * own open state, and remembering *that* across navigations would mean arriving
 * on a new page with the menu already covering it.
 */
export const SIDEBAR_STORAGE_KEY = "timeblock-sidebar-collapsed";

const listeners = new Set<() => void>();

export function subscribeSidebar(onChange: () => void) {
  listeners.add(onChange);
  // Another tab collapsing it does not notify this one through the set.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    // Safari's private mode throws outright, and a sidebar is not worth a crash.
    return false;
  }
}

export function setSidebarCollapsed(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(SIDEBAR_STORAGE_KEY, "1");
    else localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  } catch {
    // Ignored: the toggle still works for this session through the listeners.
  }
  for (const listen of listeners) listen();
}
