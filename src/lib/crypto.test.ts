import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { seal, secretsMatch, unseal } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("seal / unseal", () => {
  it("round-trips a token", () => {
    const token = "1//0eXaMpLe-refresh-token_value";
    expect(unseal(seal(token))).toBe(token);
  });

  it("round-trips unicode and empty strings", () => {
    expect(unseal(seal(""))).toBe("");
    expect(unseal(seal("café ✓ 日本語"))).toBe("café ✓ 日本語");
  });

  it("produces different bytes each time, so a repeated token is not recognisable", () => {
    const a = seal("same-token");
    const b = seal("same-token");
    expect(a.equals(b)).toBe(false);
    expect(unseal(a)).toBe(unseal(b));
  });

  it("refuses ciphertext that has been altered", () => {
    const sealed = seal("secret");
    // Flip a bit in the ciphertext; GCM's tag has to catch it.
    sealed[sealed.length - 1] ^= 0x01;
    expect(() => unseal(sealed)).toThrow();
  });

  it("refuses a value that is too short to hold an iv and tag", () => {
    expect(() => unseal(Buffer.alloc(8))).toThrow(/truncated/);
  });

  it("refuses a key of the wrong size rather than silently padding it", () => {
    const good = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => seal("x")).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = good;
  });
});

describe("secretsMatch", () => {
  it("compares by value", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    expect(secretsMatch("abc", "abcdef")).toBe(false);
    expect(secretsMatch("", "x")).toBe(false);
  });
});
