import { describe, expect, it } from "vitest";

import { isBlockDocument, pickDocument } from "./document";

describe("isBlockDocument", () => {
  it("accepts an empty document", () => {
    expect(isBlockDocument([])).toBe(true);
  });

  it("accepts blocks carrying a string type", () => {
    expect(isBlockDocument([{ type: "paragraph" }, { type: "heading" }])).toBe(true);
  });

  it("rejects anything that is not an array", () => {
    expect(isBlockDocument(null)).toBe(false);
    expect(isBlockDocument(undefined)).toBe(false);
    expect(isBlockDocument({ type: "paragraph" })).toBe(false);
    expect(isBlockDocument("[]")).toBe(false);
  });

  it("rejects an array holding a non-block", () => {
    expect(isBlockDocument([{ type: "paragraph" }, null])).toBe(false);
    expect(isBlockDocument([{ notAType: true }])).toBe(false);
    expect(isBlockDocument([{ type: 3 }])).toBe(false);
  });
});

describe("pickDocument", () => {
  it("takes the incoming copy when nothing is cached", () => {
    const incoming = { bodyRev: 0 };
    expect(pickDocument(undefined, incoming)).toBe(incoming);
  });

  it("keeps the cached copy when it is ahead", () => {
    const cached = { bodyRev: 5 };
    expect(pickDocument(cached, { bodyRev: 4 })).toBe(cached);
  });

  it("takes the incoming copy when the server is ahead", () => {
    // The case that matters: edited in another tab, or arrived by sync. Holding
    // on to the cached copy here would show the user an older document than the
    // one they already saved.
    const incoming = { bodyRev: 9 };
    expect(pickDocument({ bodyRev: 8 }, incoming)).toBe(incoming);
  });

  it("takes the incoming copy on a tie", () => {
    // Same revision means the same document, so neither is more correct —
    // preferring the fresh object keeps a stale one from being pinned forever.
    const incoming = { bodyRev: 2 };
    expect(pickDocument({ bodyRev: 2 }, incoming)).toBe(incoming);
  });

  it("carries the rest of the document along with the choice", () => {
    const cached = { bodyRev: 7, body: "newer" };
    const incoming = { bodyRev: 3, body: "older" };
    expect(pickDocument(cached, incoming).body).toBe("newer");
  });
});
