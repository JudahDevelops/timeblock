import { describe, expect, it } from "vitest";

import { nextAfterClose, type OpenTab } from "./tabs";

const tab = (href: string): OpenTab => ({ href, title: href, emoji: null });

describe("nextAfterClose", () => {
  const tabs = [tab("/a"), tab("/b"), tab("/c")];

  it("stays put when closing a background tab", () => {
    // Closing something you are not looking at must never move you.
    expect(nextAfterClose(tabs, "/a", "/b")).toBeNull();
    expect(nextAfterClose(tabs, "/c", "/b")).toBeNull();
  });

  it("moves right when closing the active tab", () => {
    expect(nextAfterClose(tabs, "/b", "/b")).toBe("/c");
  });

  it("falls back to the left when the active tab is last", () => {
    expect(nextAfterClose(tabs, "/c", "/c")).toBe("/b");
  });

  it("returns null when closing the only tab", () => {
    expect(nextAfterClose([tab("/only")], "/only", "/only")).toBeNull();
  });

  it("returns null when the closing tab is not open", () => {
    expect(nextAfterClose(tabs, "/missing", "/missing")).toBeNull();
  });

  it("returns null when nothing is active", () => {
    expect(nextAfterClose(tabs, "/a", null)).toBeNull();
  });

  it("handles an empty strip", () => {
    expect(nextAfterClose([], "/a", "/a")).toBeNull();
  });
});
