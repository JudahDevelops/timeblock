/**
 * Which documents are open, as a browser's tab strip means it.
 *
 * The set of open tabs is *not* the same thing as the current route. The route
 * says which one is in front; this says which ones are still there behind it.
 * Keeping them separate is what lets navigation stay ordinary `next/link`
 * routing — a tab is opened by visiting it, and every existing link keeps
 * working — rather than a bespoke navigation system layered over the router.
 *
 * Lives outside React and in `sessionStorage` for the same reason the sidebar's
 * collapse does: the shell remounts on every navigation, so component state
 * would empty the strip on the first click. `sessionStorage` rather than
 * `localStorage` because a tab strip is a working set, not a preference —
 * reopening the app tomorrow to nine tabs from yesterday is clutter, and each
 * browser tab deserves its own.
 */
export const TABS_STORAGE_KEY = "timeblock-open-tabs";

/** Beyond this the strip is unreadable and every tab is a sliver. */
export const MAX_TABS = 12;

export type OpenTab = {
  /** The route, which is also the identity — one tab per destination. */
  href: string;
  title: string;
  emoji: string | null;
};

const listeners = new Set<() => void>();

export function subscribeTabs(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The open tabs.
 *
 * Returns the same array identity when nothing has changed, because
 * `useSyncExternalStore` compares snapshots by identity and a fresh `JSON.parse`
 * on every read would re-render forever.
 */
let cache: OpenTab[] = [];
let cachedRaw: string | null = null;

export function readTabs(): OpenTab[] {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(TABS_STORAGE_KEY);
  } catch {
    return cache;
  }

  if (raw === cachedRaw) return cache;

  cachedRaw = raw;
  cache = raw ? parse(raw) : [];
  return cache;
}

function parse(raw: string): OpenTab[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];

    // Validated rather than cast: this is storage another version of the app may
    // have written, and a malformed entry would render as a blank tab that
    // cannot be closed.
    return value
      .filter(
        (entry): entry is OpenTab =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as OpenTab).href === "string" &&
          typeof (entry as OpenTab).title === "string",
      )
      .slice(0, MAX_TABS);
  } catch {
    return [];
  }
}

function write(tabs: OpenTab[]) {
  const next = tabs.slice(0, MAX_TABS);
  try {
    sessionStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignored: the listeners below still update this session.
  }
  cachedRaw = null;
  for (const listen of listeners) listen();
}

/**
 * Records a visit.
 *
 * Idempotent by `href`: revisiting an open tab fronts it rather than opening a
 * second copy of the same page. The title is refreshed on every visit so a
 * rename shows up in the strip without a reload.
 *
 * A new tab lands at the end. Inserting beside the active one would reorder the
 * strip under the user, which is the thing a tab bar exists not to do.
 */
export function openTab(tab: OpenTab) {
  const tabs = readTabs();
  const existing = tabs.findIndex((entry) => entry.href === tab.href);

  if (existing !== -1) {
    const current = tabs[existing];
    if (current.title === tab.title && current.emoji === tab.emoji) return;
    const next = [...tabs];
    next[existing] = tab;
    write(next);
    return;
  }

  // At the cap the oldest goes, which is the one furthest from what is being
  // worked on. Dropping the newest instead would make the cap feel like the
  // click failed.
  write(tabs.length >= MAX_TABS ? [...tabs.slice(1), tab] : [...tabs, tab]);
}

export function closeTab(href: string) {
  write(readTabs().filter((entry) => entry.href !== href));
}

export function closeAllTabs() {
  write([]);
}

/**
 * Where to go after closing `href`, given what was open and what is active.
 *
 * `null` means stay put — closing a background tab must not navigate. Closing
 * the active one moves to its right neighbour, falling back to its left, which
 * is what every browser does and therefore what fingers expect.
 *
 * Pure, and separated from the storage above so the rule can be tested without
 * a DOM.
 */
export function nextAfterClose(
  tabs: OpenTab[],
  closing: string,
  active: string | null,
): string | null {
  if (closing !== active) return null;

  const index = tabs.findIndex((entry) => entry.href === closing);
  if (index === -1) return null;

  const right = tabs[index + 1];
  if (right) return right.href;

  const left = tabs[index - 1];
  return left ? left.href : null;
}
