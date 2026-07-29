import { describe, expect, it } from "vitest";

import type { BlockDocument } from "./document";
import { blocksToPlainText } from "./plain-text";

/** Blocks are shaped like BlockNote's, cast in once so the tests stay readable. */
const doc = (blocks: unknown[]) => blocks as BlockDocument;

describe("blocksToPlainText", () => {
  it("returns empty for an empty document", () => {
    expect(blocksToPlainText(doc([]))).toBe("");
  });

  it("joins the styled runs of a paragraph into one line", () => {
    const body = doc([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Draft the ", styles: {} },
          { type: "text", text: "CAO", styles: { bold: true } },
          { type: "text", text: " proposal", styles: {} },
        ],
      },
    ]);
    expect(blocksToPlainText(body)).toBe("Draft the CAO proposal");
  });

  it("separates blocks by line so words from different blocks never merge", () => {
    const body = doc([
      { type: "heading", content: [{ type: "text", text: "Agenda", styles: {} }] },
      { type: "paragraph", content: [{ type: "text", text: "Budget", styles: {} }] },
    ]);
    expect(blocksToPlainText(body)).toBe("Agenda\nBudget");
  });

  it("reaches text nested arbitrarily deep — the whole point of the editor", () => {
    const body = doc([
      {
        type: "toggleListItem",
        content: [{ type: "text", text: "Deliverables", styles: {} }],
        children: [
          {
            type: "checkListItem",
            content: [{ type: "text", text: "Ship the grid", styles: {} }],
            children: [
              {
                type: "bulletListItem",
                content: [{ type: "text", text: "buried treasure", styles: {} }],
              },
            ],
          },
        ],
      },
    ]);
    expect(blocksToPlainText(body)).toBe("Deliverables\nShip the grid\nburied treasure");
  });

  it("follows link content but ignores the href", () => {
    const body = doc([
      {
        type: "paragraph",
        content: [
          {
            type: "link",
            href: "https://example.com/secret",
            content: [{ type: "text", text: "the brief", styles: {} }],
          },
        ],
      },
    ]);
    expect(blocksToPlainText(body)).toBe("the brief");
  });

  it("indexes table cells", () => {
    const body = doc([
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[{ type: "text", text: "Lagos", styles: {} }]] }],
        },
      },
    ]);
    expect(blocksToPlainText(body)).toBe("Lagos");
  });

  it("skips props, so colours and image urls never reach the search index", () => {
    const body = doc([
      {
        type: "image",
        props: { url: "https://cdn.example.com/diagram.png", backgroundColor: "blue" },
        content: undefined,
      },
      {
        type: "paragraph",
        props: { textColor: "red" },
        content: [{ type: "text", text: "caption", styles: {} }],
      },
    ]);
    expect(blocksToPlainText(body)).toBe("caption");
  });

  it("drops blocks that hold no text rather than emitting blank lines", () => {
    const body = doc([
      { type: "paragraph", content: [] },
      { type: "divider" },
      { type: "paragraph", content: [{ type: "text", text: "after", styles: {} }] },
    ]);
    expect(blocksToPlainText(body)).toBe("after");
  });
});
