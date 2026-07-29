import { describe, expect, it } from "vitest";

import type { Event } from "@/db/schema";
import { descriptionStub, hashDescription, isPushable, toEventWrite } from "@/lib/sync/payload";

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    title: "Write CAO proposal",
    startsAt: new Date("2026-08-05T09:00:00.000Z"),
    endsAt: new Date("2026-08-05T11:00:00.000Z"),
    allDay: false,
    tz: "Africa/Lagos",
    recurrence: null,
    recurringEventId: null,
    originalStartTime: null,
    origin: "local",
    body: [],
    bodyText: null,
    bodyRev: 0,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Event;
}

describe("isPushable", () => {
  it("pushes local one-off events", () => {
    expect(isPushable(event())).toBe(true);
  });

  it("never pushes back what Google gave us", () => {
    expect(isPushable(event({ origin: "google" }))).toBe(false);
  });

  it("holds back recurring events, whose writes are deferred", () => {
    expect(isPushable(event({ recurrence: ["RRULE:FREQ=WEEKLY"] }))).toBe(false);
  });
});

describe("descriptionStub", () => {
  it("is just the deep link when the body is empty", () => {
    expect(descriptionStub(event())).toBe(
      "Open in Timeblock: http://localhost:3000/e/11111111-1111-4111-8111-111111111111",
    );
  });

  it("truncates a long body but always keeps the link", () => {
    const stub = descriptionStub(event({ bodyText: "x".repeat(900) }));
    const [excerpt, , link] = stub.split("\n");
    expect(excerpt).toHaveLength(501); // 500 characters plus the ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
    expect(link).toContain("/e/11111111-1111-4111-8111-111111111111");
  });

  it("leaves a short body whole", () => {
    expect(descriptionStub(event({ bodyText: "  Agenda  " }))).toMatch(/^Agenda\n\nOpen in/);
  });
});

describe("hashDescription", () => {
  it("is stable and sensitive to any change", () => {
    const a = hashDescription("Open in Timeblock: x");
    expect(hashDescription("Open in Timeblock: x")).toBe(a);
    expect(hashDescription("Open in Timeblock: y")).not.toBe(a);
    expect(a).toHaveLength(32);
  });
});

describe("toEventWrite", () => {
  it("sends a timed event as an instant plus its own zone", () => {
    const payload = toEventWrite(event());
    expect(payload.start).toEqual({
      dateTime: "2026-08-05T09:00:00.000Z",
      timeZone: "Africa/Lagos",
    });
    expect(payload.extendedProperties.private.tb_event_id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("makes the all-day end exclusive, or Google shortens the block to nothing", () => {
    const payload = toEventWrite(
      event({
        allDay: true,
        startsAt: new Date("2026-08-05T00:00:00.000+01:00"),
        endsAt: new Date("2026-08-06T00:00:00.000+01:00"),
      }),
    );
    expect(payload.start).toEqual({ date: "2026-08-05" });
    expect(payload.end).toEqual({ date: "2026-08-06" });
  });

  it("renders all-day dates in the event's zone, not the server's", () => {
    // 23:30 UTC is already the 6th in Lagos; using UTC here would lose a day.
    const payload = toEventWrite(
      event({ allDay: true, tz: "Africa/Lagos", startsAt: new Date("2026-08-05T23:30:00.000Z") }),
    );
    expect(payload.start).toEqual({ date: "2026-08-06" });
  });

  it("never sends an empty summary", () => {
    expect(toEventWrite(event({ title: "" })).summary).toBe("Untitled block");
  });
});
