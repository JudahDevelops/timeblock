import { describe, expect, it } from "vitest";

import { isSearchHotkey, isStatusHotkey } from "./hotkeys";

/** Only the fields the matchers read, so the tests stay legible. */
const press = (over: Partial<KeyboardEvent>) =>
  ({
    key: "",
    code: "",
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...over,
  }) as KeyboardEvent;

describe("isSearchHotkey", () => {
  it("matches Ctrl+Shift+K", () => {
    expect(isSearchHotkey(press({ code: "KeyK", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("ignores the editor's own Ctrl+K", () => {
    expect(isSearchHotkey(press({ code: "KeyK", ctrlKey: true }))).toBe(false);
  });

  it("ignores Super+Shift+K, which a tiling compositor eats anyway", () => {
    expect(isSearchHotkey(press({ code: "KeyK", metaKey: true, shiftKey: true }))).toBe(false);
  });

  it("ignores the same keys with Alt added", () => {
    expect(
      isSearchHotkey(press({ code: "KeyK", ctrlKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
  });

  it("ignores an unshifted k", () => {
    expect(isSearchHotkey(press({ code: "KeyK" }))).toBe(false);
  });
});

describe("isStatusHotkey", () => {
  it("matches Ctrl+Shift+.", () => {
    expect(isStatusHotkey(press({ code: "Period", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("matches on physical position, not the shifted character", () => {
    // Shift turns "." into ">" on a US layout, so a matcher reading `key` would
    // stop working the moment Shift was added to the binding.
    expect(isStatusHotkey(press({ key: ">", code: "Period", ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
  });

  it("ignores the input-method toggle Ctrl+.", () => {
    expect(isStatusHotkey(press({ code: "Period", ctrlKey: true }))).toBe(false);
  });

  it("does not fire for the search key", () => {
    expect(isStatusHotkey(press({ code: "KeyK", ctrlKey: true, shiftKey: true }))).toBe(false);
  });
});
