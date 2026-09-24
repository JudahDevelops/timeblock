import { describe, expect, it } from "vitest";

import { claimLocalId, isUuid } from "@/lib/sync/identity";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";
const CANDIDATE = "33333333-3333-3333-3333-333333333333";

describe("claimLocalId", () => {
  it("claims fresh when the candidate is null", () => {
    const owners = new Map<string, string>();
    expect(claimLocalId(null, owners, USER)).toEqual({ kind: "fresh" });
  });

  it("claims fresh when the candidate matches no row anywhere", () => {
    const owners = new Map<string, string>();
    expect(claimLocalId(CANDIDATE, owners, USER)).toEqual({ kind: "fresh" });
  });

  it("claims owned when the candidate belongs to this user", () => {
    const owners = new Map([[CANDIDATE, USER]]);
    expect(claimLocalId(CANDIDATE, owners, USER)).toEqual({ kind: "owned", id: CANDIDATE });
  });

  it("claims foreign when the candidate belongs to another user", () => {
    const owners = new Map([[CANDIDATE, OTHER_USER]]);
    expect(claimLocalId(CANDIDATE, owners, USER)).toEqual({ kind: "foreign" });
  });
});

describe("isUuid", () => {
  it("accepts a lowercase v4 uuid", () => {
    expect(isUuid("33333333-3333-4333-8333-333333333333")).toBe(true);
  });

  it("accepts an uppercase v4 uuid", () => {
    expect(isUuid("33333333-3333-4333-8333-333333333333".toUpperCase())).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });

  it("rejects a short non-uuid string", () => {
    expect(isUuid("abc")).toBe(false);
  });

  it("rejects a uuid with a trailing character", () => {
    expect(isUuid("33333333-3333-4333-8333-333333333333x")).toBe(false);
  });

  it("rejects a uuid missing its dashes", () => {
    expect(isUuid("33333333333343338333333333333333")).toBe(false);
  });
});
