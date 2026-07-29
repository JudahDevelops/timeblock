import { describe, expect, it } from "vitest";

import {
  isInboundStale,
  isWatchable,
  isWatchLive,
  needsRenewal,
  parseExpiration,
  readPing,
  webhookAddress,
} from "@/lib/google/channel";

describe("webhookAddress", () => {
  it("hangs the webhook off the deployment URL", () => {
    expect(webhookAddress("https://timeblock.app")).toBe(
      "https://timeblock.app/api/google/webhook",
    );
  });

  it("does not double the slash on a trailing one", () => {
    expect(webhookAddress("https://timeblock.app/")).toBe(
      "https://timeblock.app/api/google/webhook",
    );
  });
});

describe("isWatchable", () => {
  it("accepts a verified https deployment", () => {
    expect(isWatchable("https://timeblock.app")).toBe(true);
  });

  it("rejects localhost, which Google can never reach", () => {
    expect(isWatchable("http://localhost:3000")).toBe(false);
    expect(isWatchable("https://localhost:3000")).toBe(false);
    expect(isWatchable("https://127.0.0.1:3000")).toBe(false);
  });

  it("rejects plain http and anything unparseable", () => {
    expect(isWatchable("http://timeblock.app")).toBe(false);
    expect(isWatchable("not a url")).toBe(false);
  });
});

describe("parseExpiration", () => {
  it("reads epoch milliseconds out of Google's string", () => {
    expect(parseExpiration("1785283200000")).toEqual(new Date(1785283200000));
  });

  it("treats missing or nonsense as no expiry on record", () => {
    expect(parseExpiration(null)).toBeNull();
    expect(parseExpiration("")).toBeNull();
    expect(parseExpiration("soon")).toBeNull();
  });
});

describe("needsRenewal", () => {
  const now = new Date("2026-08-05T09:00:00.000Z");
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000);

  it("renews a channel we have no record of", () => {
    expect(needsRenewal(null, now)).toBe(true);
  });

  it("leaves a fresh channel alone", () => {
    expect(needsRenewal(inHours(6 * 24), now)).toBe(false);
  });

  it("renews inside the last day, so an hourly cron has many chances", () => {
    expect(needsRenewal(inHours(23), now)).toBe(true);
  });

  it("renews one already dead", () => {
    expect(needsRenewal(inHours(-1), now)).toBe(true);
  });
});

describe("isWatchLive", () => {
  const now = new Date("2026-08-05T09:00:00.000Z");

  it("is live until the moment it expires", () => {
    expect(isWatchLive(new Date(now.getTime() + 1000), now)).toBe(true);
    expect(isWatchLive(new Date(now.getTime() - 1000), now)).toBe(false);
    expect(isWatchLive(null, now)).toBe(false);
  });
});

describe("isInboundStale", () => {
  const now = new Date("2026-08-05T09:00:00.000Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("is quiet, not stale, inside three poll cycles", () => {
    expect(isInboundStale(minutesAgo(14), now)).toBe(false);
  });

  it("raises the alarm once the poll has plainly stopped", () => {
    expect(isInboundStale(minutesAgo(40), now)).toBe(true);
  });

  it("does not accuse a connection that has never synced", () => {
    expect(isInboundStale(null, now)).toBe(false);
  });
});

describe("readPing", () => {
  it("reads the headers a notification is made of", () => {
    const ping = readPing(
      new Headers({
        "X-Goog-Channel-ID": "9f1c",
        "X-Goog-Resource-ID": "res-1",
        "X-Goog-Resource-State": "exists",
        "X-Goog-Channel-Token": "shh",
      }),
    );

    expect(ping).toEqual({ channelId: "9f1c", resourceId: "res-1", state: "exists", token: "shh" });
  });

  it("reports an absent token as empty rather than failing to parse", () => {
    // An untokened ping is a rejection, not a malformed request — the route has
    // to reach the constant-time compare to make that call.
    expect(
      readPing(
        new Headers({
          "X-Goog-Channel-ID": "9f1c",
          "X-Goog-Resource-ID": "res-1",
          "X-Goog-Resource-State": "sync",
        }),
      )?.token,
    ).toBe("");
  });

  it("is nothing at all when the headers are missing", () => {
    expect(readPing(new Headers())).toBeNull();
  });
});
