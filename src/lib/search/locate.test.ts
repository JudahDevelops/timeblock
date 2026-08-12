import { describe, expect, it } from "vitest";

import { findMatch } from "./locate";

describe("findMatch", () => {
  it("finds the whole phrase when it is present", () => {
    const text = "Before. The quick brown fox. After.";
    const match = findMatch(text, "quick brown fox");

    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe("quick brown fox");
  });

  it("matches without regard to case", () => {
    const text = "Shipping THE Migration today";
    const match = findMatch(text, "the migration");

    expect(text.slice(match!.start, match!.end)).toBe("THE Migration");
  });

  it("falls back to the longest term when the phrase is absent", () => {
    const text = "Notes on the deployment pipeline";
    // "deployment schedule" never appears; "deployment" is the better anchor.
    const match = findMatch(text, "deployment schedule");

    expect(text.slice(match!.start, match!.end)).toBe("deployment");
  });

  it("prefers the longest term over an earlier shorter one", () => {
    // Both terms appear, but not together, so the phrase cannot match and the
    // choice between anchors is the thing under test. "the" occurs first and is
    // the worse landmark; "onboarding" is where the reader actually wants to be.
    const text = "the document, and separately, onboarding";
    const match = findMatch(text, "the onboarding");

    expect(text.slice(match!.start, match!.end)).toBe("onboarding");
  });

  it("matches a stem when the search was inflected", () => {
    // Postgres stems, so a hit can exist where the typed word never appears.
    const text = "He runs every morning";
    const match = findMatch(text, "running");

    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe("run");
  });

  it("ignores terms too short to be a location", () => {
    // Only short words, none of which are worth scrolling to.
    expect(findMatch("a document about it", "a it")).toBeNull();
  });

  it("returns null when nothing matches at all", () => {
    expect(findMatch("completely unrelated prose", "xylophone")).toBeNull();
  });

  it("returns null for an empty query or empty text", () => {
    expect(findMatch("some text", "")).toBeNull();
    expect(findMatch("some text", "   ")).toBeNull();
    expect(findMatch("", "anything")).toBeNull();
  });

  it("handles punctuation in the query", () => {
    const text = "Rewrite the sync engine";
    const match = findMatch(text, "sync, engine!");

    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.end)).toBe("engine");
  });

  it("reports offsets into the original string, not the lowercased copy", () => {
    const text = "AAAA target";
    const match = findMatch(text, "target");

    expect(match).toEqual({ start: 5, end: 11 });
  });
});
