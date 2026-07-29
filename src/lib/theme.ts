/** What the user picked. `"system"` defers to the OS and keeps following it. */
export type Theme = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "timeblock-theme";

/**
 * Applies a choice to the document and remembers it.
 *
 * The class goes on `<html>` rather than `<body>` because `color-scheme` has to
 * reach the native controls — the drawer's `<input type="time">` opens a picker
 * the browser paints, and it reads the scheme off the root element.
 */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", dark);

  // "system" is the absence of a preference, so it is stored as one — leaving a
  // stale "dark" behind would silently pin the app after the user chose to
  // follow the OS again.
  if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
  else localStorage.setItem(THEME_STORAGE_KEY, theme);

  for (const listen of listeners) listen();
}

/*
 * `localStorage` is the source of truth, so it is read as an external store
 * rather than copied into state on mount. Mirroring it meant an effect whose
 * only job was to call `setState`, which is the pattern the compiler rejects —
 * and it is genuinely the wrong shape: the value already exists before React
 * runs, put there by the head script.
 */
const listeners = new Set<() => void>();

export function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  // Another tab writing the key does not notify this one through the set.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

/**
 * Runs before the first paint, inlined into `<head>`.
 *
 * A class-based theme is applied by JavaScript, and every route here is
 * server-rendered, so without this the browser paints the light palette and
 * then swaps — a white flash on every cold load, worst on the calendar, which
 * is nearly the whole viewport. Kept as a string of source rather than a
 * component so it can be a blocking script: React would only run it after
 * hydration, which is far too late.
 *
 * Deliberately wrapped in try/catch. `localStorage` throws outright in Safari's
 * private mode, and a theme is not worth a blank page.
 */
export const THEME_SCRIPT = `
(function(){try{
  var t = localStorage.getItem("${THEME_STORAGE_KEY}");
  var dark = t === "dark" || (!t && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.classList.add("dark");
}catch(e){}})();
`;
