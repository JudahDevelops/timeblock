import { describe, expect, it } from "vitest";

import type { GoogleEvent } from "@/lib/google/client";
import { mapGoogleEvent } from "./map";

const LAGOS = "Africa/Lagos"; // UTC+1, no daylight saving.

describe("mapGoogleEvent", () => {
  it("maps a timed event", () => {
    const mapped = mapGoogleEvent(
      {
        id: "abc",
        etag: '"123"',
        summary: "Standup",
        status: "confirmed",
        updated: "2026-07-29T08:00:00.000Z",
        start: { dateTime: "2026-07-29T09:00:00+01:00", timeZone: LAGOS },
        end: { dateTime: "2026-07-29T09:30:00+01:00", timeZone: LAGOS },
      },
      "UTC",
    );

    expect(mapped).toMatchObject({
      gcalEventId: "abc",
      cancelled: false,
      title: "Standup",
      allDay: false,
      tz: LAGOS,
      etag: '"123"',
    });
    expect(mapped!.startsAt.toISOString()).toBe("2026-07-29T08:00:00.000Z");
    expect(mapped!.endsAt.toISOString()).toBe("2026-07-29T08:30:00.000Z");
  });

  it("anchors an all-day event to midnight in its own zone, not UTC", () => {
    const mapped = mapGoogleEvent(
      {
        id: "d1",
        summary: "Public holiday",
        start: { date: "2026-07-29" },
        end: { date: "2026-07-30" },
      },
      LAGOS,
    );

    expect(mapped!.allDay).toBe(true);
    // Midnight in Lagos is 23:00 the previous day in UTC. Reading the bare date
    // as UTC would put this block on the wrong day for anyone east of it.
    expect(mapped!.startsAt.toISOString()).toBe("2026-07-28T23:00:00.000Z");
    expect(mapped!.endsAt.toISOString()).toBe("2026-07-29T23:00:00.000Z");
  });

  it("falls back to the calendar's zone when the event names none", () => {
    const mapped = mapGoogleEvent(
      {
        id: "e1",
        start: { dateTime: "2026-07-29T09:00:00Z" },
        end: { dateTime: "2026-07-29T10:00:00Z" },
      },
      LAGOS,
    );
    expect(mapped!.tz).toBe(LAGOS);
  });

  it("reports a cancellation that carries nothing but an id", () => {
    const mapped = mapGoogleEvent({ id: "gone", status: "cancelled" }, "UTC");
    expect(mapped).toMatchObject({ gcalEventId: "gone", cancelled: true });
  });

  it("keeps the series id and original start of a recurring instance", () => {
    const mapped = mapGoogleEvent(
      {
        id: "series_20260729T080000Z",
        recurringEventId: "series",
        originalStartTime: { dateTime: "2026-07-29T09:00:00+01:00" },
        start: { dateTime: "2026-07-29T10:00:00+01:00" },
        end: { dateTime: "2026-07-29T11:00:00+01:00" },
      },
      LAGOS,
    );
    expect(mapped!.recurringEventId).toBe("series");
    expect(mapped!.originalStartTime?.toISOString()).toBe("2026-07-29T08:00:00.000Z");
  });

  it("drops rows sync cannot use rather than throwing mid-page", () => {
    expect(mapGoogleEvent({ id: "" } as GoogleEvent, "UTC")).toBeNull();
    // Live, but with no start there is nowhere to draw it.
    expect(mapGoogleEvent({ id: "x", status: "confirmed" }, "UTC")).toBeNull();
    expect(mapGoogleEvent({ id: "y", start: { dateTime: "nonsense" } }, "UTC")).toBeNull();
  });

  it("treats a missing summary as an untitled block, not as invalid", () => {
    const mapped = mapGoogleEvent(
      {
        id: "n1",
        start: { dateTime: "2026-07-29T09:00:00Z" },
        end: { dateTime: "2026-07-29T10:00:00Z" },
      },
      "UTC",
    );
    expect(mapped!.title).toBe("");
  });

  it("carries our own id back off an event we pushed", () => {
    const mapped = mapGoogleEvent(
      {
        id: "p1",
        start: { dateTime: "2026-07-29T09:00:00Z" },
        end: { dateTime: "2026-07-29T10:00:00Z" },
        extendedProperties: { private: { tb_event_id: "0d4c1e2f-aaaa-bbbb-cccc-000000000001" } },
      },
      "UTC",
    );
    expect(mapped!.tbEventId).toBe("0d4c1e2f-aaaa-bbbb-cccc-000000000001");
    expect(mapGoogleEvent({ id: "p2", status: "cancelled" }, "UTC")!.tbEventId).toBeNull();
  });

  it("keeps our id on a cancellation, which is how a move stays traceable", () => {
    const mapped = mapGoogleEvent(
      {
        id: "p3",
        status: "cancelled",
        extendedProperties: { private: { tb_event_id: "0d4c1e2f-aaaa-bbbb-cccc-000000000002" } },
      },
      "UTC",
    );
    expect(mapped!.tbEventId).toBe("0d4c1e2f-aaaa-bbbb-cccc-000000000002");
  });
});
