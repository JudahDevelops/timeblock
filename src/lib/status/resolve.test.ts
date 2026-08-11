import { describe, expect, it } from "vitest";

import type { BlockDocument } from "@/lib/editor/document";

import { OVERRUN_GRACE_MS, resolveStatus } from "./resolve";
import type { StatusEvent } from "./resolve";

const at = (hour: number, minute = 0) => new Date(2026, 7, 11, hour, minute, 0, 0);

const checklist = (...items: [string, string, boolean][]): BlockDocument =>
  items.map(([id, text, checked]) => ({
    id,
    type: "checkListItem",
    props: { checked },
    content: [{ type: "text", text, styles: {} }],
  })) as unknown as BlockDocument;

const block = (over: Partial<StatusEvent> & Pick<StatusEvent, "id">): StatusEvent => ({
  title: "Block",
  startsAt: at(9),
  endsAt: at(10),
  allDay: false,
  body: [] as BlockDocument,
  ...over,
});

describe("resolveStatus — running", () => {
  it("picks the block containing now and its first unchecked item", () => {
    const view = resolveStatus(
      [
        block({
          id: "deep",
          title: "Deep Work",
          startsAt: at(9),
          endsAt: at(11),
          body: checklist(
            ["a", "Draft the intro", true],
            ["b", "Outline the migration", false],
            ["c", "Review", false],
          ),
        }),
      ],
      at(10),
    );

    expect(view.kind).toBe("running");
    if (view.kind !== "running") return;
    expect(view.block.title).toBe("Deep Work");
    expect(view.current?.text).toBe("Outline the migration");
    expect(view.nextItem?.text).toBe("Review");
    expect(view.block.doneCount).toBe(1);
    expect(view.block.totalCount).toBe(3);
  });

  it("reports progress as a fraction and the remaining time", () => {
    const view = resolveStatus([block({ id: "a", startsAt: at(9), endsAt: at(11) })], at(10, 30));

    if (view.kind !== "running") throw new Error("expected running");
    expect(view.block.progress).toBeCloseTo(0.75);
    expect(view.block.remainingMs).toBe(30 * 60 * 1000);
  });

  it("counts a block as running the instant it starts", () => {
    const view = resolveStatus([block({ id: "a", startsAt: at(9), endsAt: at(10) })], at(9));
    expect(view.kind).toBe("running");
  });

  it("does not count a block as running at the instant it ends", () => {
    const view = resolveStatus([block({ id: "a", startsAt: at(9), endsAt: at(10) })], at(10));
    expect(view.kind).not.toBe("running");
  });

  it("prefers the most recently started block when two overlap", () => {
    const view = resolveStatus(
      [
        block({ id: "long", title: "All morning", startsAt: at(9), endsAt: at(12) }),
        block({ id: "short", title: "Standup", startsAt: at(10), endsAt: at(10, 15) }),
      ],
      at(10, 5),
    );

    if (view.kind !== "running") throw new Error("expected running");
    expect(view.block.title).toBe("Standup");
  });

  it("ignores all-day events entirely", () => {
    const view = resolveStatus(
      [block({ id: "holiday", allDay: true, startsAt: at(0), endsAt: at(23, 59) })],
      at(10),
    );
    expect(view.kind).toBe("clear");
  });

  it("leaves current null when every item is checked", () => {
    const view = resolveStatus(
      [block({ id: "a", startsAt: at(9), endsAt: at(11), body: checklist(["x", "Done", true]) })],
      at(10),
    );

    if (view.kind !== "running") throw new Error("expected running");
    expect(view.current).toBeNull();
    expect(view.nextItem).toBeNull();
  });
});

describe("resolveStatus — overrunning", () => {
  it("holds a just-ended block that still has unfinished items", () => {
    const view = resolveStatus(
      [
        block({
          id: "a",
          title: "Deep Work",
          startsAt: at(9),
          endsAt: at(10),
          body: checklist(["x", "Unfinished", false]),
        }),
      ],
      at(10, 5),
    );

    expect(view.kind).toBe("overrunning");
    if (view.kind !== "overrunning") return;
    expect(view.current?.text).toBe("Unfinished");
    expect(view.block.progress).toBe(1);
  });

  it("does not overrun when the checklist is complete", () => {
    const view = resolveStatus(
      [block({ id: "a", endsAt: at(10), body: checklist(["x", "Done", true]) })],
      at(10, 5),
    );
    expect(view.kind).toBe("clear");
  });

  it("does not overrun a block with no checklist at all", () => {
    const view = resolveStatus([block({ id: "a", endsAt: at(10) })], at(10, 5));
    expect(view.kind).toBe("clear");
  });

  it("ages out once the grace window passes", () => {
    const ended = at(10);
    const body = checklist(["x", "Unfinished", false]);
    const events = [block({ id: "a", endsAt: ended, body })];

    const inside = new Date(ended.getTime() + OVERRUN_GRACE_MS - 1000);
    const outside = new Date(ended.getTime() + OVERRUN_GRACE_MS + 1000);

    expect(resolveStatus(events, inside).kind).toBe("overrunning");
    expect(resolveStatus(events, outside).kind).toBe("clear");
  });

  it("is superseded the moment the next block starts", () => {
    const view = resolveStatus(
      [
        block({ id: "a", endsAt: at(10), body: checklist(["x", "Unfinished", false]) }),
        block({ id: "b", title: "Standup", startsAt: at(10), endsAt: at(10, 30) }),
      ],
      at(10, 5),
    );

    if (view.kind !== "running") throw new Error("expected running to win");
    expect(view.block.title).toBe("Standup");
  });
});

describe("resolveStatus — gap", () => {
  it("counts down to the next block", () => {
    const view = resolveStatus(
      [block({ id: "b", title: "Standup", startsAt: at(11), endsAt: at(11, 30) })],
      at(10, 30),
    );

    expect(view.kind).toBe("gap");
    if (view.kind !== "gap") return;
    expect(view.nextBlock.title).toBe("Standup");
    expect(view.nextBlock.startsInMs).toBe(30 * 60 * 1000);
  });

  it("summarises what is left without listing it", () => {
    const view = resolveStatus(
      [
        block({ id: "b", startsAt: at(11), endsAt: at(12) }),
        block({ id: "c", startsAt: at(14), endsAt: at(17, 30) }),
      ],
      at(10),
    );

    if (view.kind !== "gap") throw new Error("expected gap");
    expect(view.later.remainingBlocks).toBe(2);
    expect(view.later.dayEndsAt).toEqual(at(17, 30));
  });
});

describe("resolveStatus — clear", () => {
  it("reports a finished day", () => {
    const view = resolveStatus(
      [
        block({ id: "a", startsAt: at(9), endsAt: at(10) }),
        block({ id: "b", startsAt: at(11), endsAt: at(12) }),
      ],
      at(18),
    );

    expect(view.kind).toBe("clear");
    if (view.kind !== "clear") return;
    expect(view.blocksToday).toBe(2);
  });

  it("reports an empty day", () => {
    const view = resolveStatus([], at(10));
    expect(view).toEqual({ kind: "clear", blocksToday: 0 });
  });
});
