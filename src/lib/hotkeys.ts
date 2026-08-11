/**
 * The app's global hotkeys.
 *
 * Both use Ctrl+Shift rather than the Cmd/Ctrl pair a web app would normally
 * reach for, because neither of the obvious choices survives a real Linux desktop:
 *
 * - **Meta is gone.** On Linux the Cmd key is Super, and a tiling compositor
 *   (Hyprland, sway, i3) takes Super for itself before the browser ever sees it.
 *   A `metaKey` branch is dead code on those setups, not a fallback.
 * - **Plain Ctrl collides.** Ctrl+K is "insert link" in every rich-text editor
 *   including BlockNote, and this product is mostly a text editor. Ctrl+. is the
 *   punctuation-mode toggle in Fcitx and IBus.
 *
 * Shift clears both. Matching is on `event.code`, which is the physical key
 * position: with Shift held, `.` arrives as `>` on a US layout, so `event.key`
 * would silently stop matching the very modifier we added.
 */

/** Opens the ⌘K-style search palette. */
export function isSearchHotkey(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyK";
}

/** Opens the status window / pause menu. */
export function isStatusHotkey(event: KeyboardEvent): boolean {
  return event.ctrlKey && event.shiftKey && !event.altKey && event.code === "Period";
}

/**
 * How the shortcuts are written in the UI.
 *
 * Spelled out rather than rendered as ⌘, which would be a lie on the platform
 * these bindings were chosen for.
 */
export const SEARCH_HOTKEY_LABEL = "Ctrl+Shift+K";
export const STATUS_HOTKEY_LABEL = "Ctrl+Shift+.";
