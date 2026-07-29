import { describe, expect, it } from "vitest";

import { toPrefixTsQuery } from "./query";

describe("toPrefixTsQuery", () => {
  it("returns null when there is nothing to search for", () => {
    expect(toPrefixTsQuery("")).toBeNull();
    expect(toPrefixTsQuery("   ")).toBeNull();
    expect(toPrefixTsQuery("!!! ??")).toBeNull();
  });

  it("makes every term a prefix, so a half-typed word still matches", () => {
    expect(toPrefixTsQuery("onbo")).toBe("onbo:*");
    expect(toPrefixTsQuery("onbo lag")).toBe("onbo:* & lag:*");
  });

  it("lowercases and collapses runs of separators", () => {
    expect(toPrefixTsQuery("  CAO   Proposal  ")).toBe("cao:* & proposal:*");
  });

  it("strips tsquery operators instead of passing them to the parser", () => {
    // Left in place these would be a syntax error, not a search term.
    expect(toPrefixTsQuery("a & b | !c")).toBe("a:* & b:* & c:*");
    expect(toPrefixTsQuery("budget:*")).toBe("budget:*");
    expect(toPrefixTsQuery("' or 1=1 --")).toBe("or:* & 1:* & 1:*");
  });

  it("keeps letters outside ASCII", () => {
    expect(toPrefixTsQuery("café Ålesund")).toBe("café:* & ålesund:*");
  });

  it("caps the number of terms", () => {
    expect(toPrefixTsQuery("a b c d e f g h i j k")).toBe(
      "a:* & b:* & c:* & d:* & e:* & f:* & g:* & h:*",
    );
  });
});
