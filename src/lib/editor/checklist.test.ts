import { describe, expect, it } from "vitest";

import { extractChecklist, firstUnchecked, itemAfter } from "./checklist";
import type { BlockDocument } from "./document";

/** Blocks are shaped like BlockNote's, cast in once so the tests stay readable. */
const doc = (blocks: unknown[]) => blocks as BlockDocument;

const item = (id: string, text: string, checked = false) => ({
  id,
  type: "checkListItem",
  props: { checked },
  content: [{ type: "text", text, styles: {} }],
});

describe("extractChecklist", () => {
  it("returns nothing for an empty document", () => {
    expect(extractChecklist(doc([]))).toEqual([]);
  });

  it("returns nothing when the body has no checklist blocks", () => {
    const body = doc([
      { id: "1", type: "paragraph", content: [{ type: "text", text: "Notes", styles: {} }] },
      { id: "2", type: "heading", content: [{ type: "text", text: "Agenda", styles: {} }] },
    ]);
    expect(extractChecklist(body)).toEqual([]);
  });

  it("reads text and checked state in document order", () => {
    const body = doc([item("a", "Draft the intro", true), item("b", "Outline the migration")]);
    expect(extractChecklist(body)).toEqual([
      { id: "a", text: "Draft the intro", checked: true },
      { id: "b", text: "Outline the migration", checked: false },
    ]);
  });

  it("joins styled runs into one line", () => {
    const body = doc([
      {
        id: "a",
        type: "checkListItem",
        props: { checked: false },
        content: [
          { type: "text", text: "Draft the ", styles: {} },
          { type: "text", text: "RFC", styles: { bold: true } },
          { type: "text", text: " intro", styles: {} },
        ],
      },
    ]);
    expect(extractChecklist(body)[0]?.text).toBe("Draft the RFC intro");
  });

  it("finds checklists nested inside toggles, flattened in reading order", () => {
    const body = doc([
      {
        id: "t",
        type: "toggleListItem",
        content: [{ type: "text", text: "Deliverables", styles: {} }],
        children: [item("a", "Ship the grid"), item("b", "Write the tests", true)],
      },
    ]);
    expect(extractChecklist(body).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps a checklist nested under another checklist", () => {
    const body = doc([
      { ...item("parent", "Release"), children: [item("child", "Tag the build")] },
    ]);
    expect(extractChecklist(body).map((i) => i.text)).toEqual(["Release", "Tag the build"]);
  });

  it("skips an empty checkbox, which is an opened line and not yet a task", () => {
    const body = doc([
      { id: "a", type: "checkListItem", props: { checked: false }, content: [] },
      item("b", "Real work"),
    ]);
    expect(extractChecklist(body).map((i) => i.id)).toEqual(["b"]);
  });

  it("treats a missing or non-boolean checked prop as unchecked", () => {
    const body = doc([
      { id: "a", type: "checkListItem", content: [{ type: "text", text: "No props", styles: {} }] },
      {
        id: "b",
        type: "checkListItem",
        props: { checked: "yes" },
        content: [{ type: "text", text: "Stringly typed", styles: {} }],
      },
    ]);
    expect(extractChecklist(body).every((i) => !i.checked)).toBe(true);
  });

  it("survives malformed jsonb rather than throwing at the trust boundary", () => {
    const body = doc([null, "not a block", 42, item("a", "Survivor")]);
    expect(extractChecklist(body).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("firstUnchecked", () => {
  it("returns the first item nobody has ticked", () => {
    const items = extractChecklist(
      doc([item("a", "Done", true), item("b", "Doing"), item("c", "Later")]),
    );
    expect(firstUnchecked(items)?.id).toBe("b");
  });

  it("returns null when everything is checked", () => {
    const items = extractChecklist(doc([item("a", "Done", true), item("b", "Also done", true)]));
    expect(firstUnchecked(items)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(firstUnchecked([])).toBeNull();
  });
});

describe("itemAfter", () => {
  it("returns the following item even when it is already checked", () => {
    const items = extractChecklist(
      doc([item("a", "First"), item("b", "Second", true), item("c", "Third")]),
    );
    expect(itemAfter(items, "a")?.id).toBe("b");
  });

  it("returns null at the end of the list", () => {
    const items = extractChecklist(doc([item("a", "Only")]));
    expect(itemAfter(items, "a")).toBeNull();
  });

  it("returns null when the id is not in the list", () => {
    const items = extractChecklist(doc([item("a", "Only")]));
    expect(itemAfter(items, "ghost")).toBeNull();
  });
});
