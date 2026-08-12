import type { BlockDocument } from "./document";

/** One `checkListItem` from a block document, flattened out of the tree. */
export type ChecklistItem = {
  /** BlockNote's block id. Stable across edits, so it can be stored as a cursor. */
  id: string;
  text: string;
  checked: boolean;
};

/**
 * Pulls every checklist item out of a body, in document order.
 *
 * Deliberately a second walk rather than a generalisation of `blocksToPlainText`:
 * that one flattens *all* prose to feed `to_tsvector` and cares only about words,
 * while this one keeps structure and drops everything that isn't a checkbox. Fusing
 * them would mean a search-shaped function growing a status-shaped parameter.
 *
 * Nesting is preserved by flattening, not by ignoring: a checklist inside a toggle
 * inside another checklist is still work the user wrote down, so it lands in the
 * list at the position it reads at.
 */
export function extractChecklist(body: BlockDocument): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  walk(body, items);
  return items;
}

/** First unchecked item, which is what the status window treats as "current". */
export function firstUnchecked(items: ChecklistItem[]): ChecklistItem | null {
  return items.find((item) => !item.checked) ?? null;
}

/**
 * The item after `current`, checked or not.
 *
 * Not "the next *unchecked* item" on purpose: the status window is answering
 * "what comes after this", and silently skipping a ticked box would misreport
 * a list the user has been filling in out of order.
 */
export function itemAfter(items: ChecklistItem[], currentId: string): ChecklistItem | null {
  const index = items.findIndex((item) => item.id === currentId);
  if (index === -1) return null;
  return items[index + 1] ?? null;
}

/** The item before `current`, checked or not. The mirror of `itemAfter`. */
export function itemBefore(items: ChecklistItem[], currentId: string): ChecklistItem | null {
  const index = items.findIndex((item) => item.id === currentId);
  if (index <= 0) return null;
  return items[index - 1] ?? null;
}

/**
 * The item the status window should treat as current.
 *
 * A pinned cursor wins over the default, which is the whole point of the
 * override: the user has said "I am on this one" and a ticked box further up the
 * list must not drag the window back. But the pin is a block id living inside
 * jsonb with nothing enforcing it, so a cursor naming an item that no longer
 * exists falls back to first-unchecked rather than showing nothing — a deleted
 * line should not leave the window blank until someone thinks to clear it.
 *
 * Deliberately does *not* skip a checked item: pinning one and ticking it should
 * leave the cursor where it was put, so the user can see what they just
 * completed before moving on. Advancing is an explicit gesture, not a side
 * effect of ticking.
 */
export function resolveCursor(
  items: ChecklistItem[],
  cursorItemId: string | null,
): ChecklistItem | null {
  if (cursorItemId) {
    const pinned = items.find((item) => item.id === cursorItemId);
    if (pinned) return pinned;
  }
  return firstUnchecked(items);
}

function walk(blocks: unknown, items: ChecklistItem[]): void {
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { type, id, props, content, children } = block as {
      type?: unknown;
      id?: unknown;
      props?: unknown;
      content?: unknown;
      children?: unknown;
    };

    if (type === "checkListItem" && typeof id === "string") {
      const parts: string[] = [];
      collectText(content, parts);
      const text = parts.join("").trim();
      // An empty checkbox is a line the user has opened but not written yet.
      // Surfacing it as the current sub-task would show a blank row.
      if (text) {
        items.push({ id, text, checked: isChecked(props) });
      }
    }

    walk(children, items);
  }
}

/** `props.checked` is whatever jsonb handed back, so anything non-true is unchecked. */
function isChecked(props: unknown): boolean {
  if (typeof props !== "object" || props === null) return false;
  return (props as { checked?: unknown }).checked === true;
}

/**
 * Gathers every `text` leaf in an inline-content tree.
 *
 * Mirrors `plain-text.ts`'s collector: structure-agnostic because BlockNote is
 * pre-1.0 and inline shapes differ, skipping `props`/`styles` because those hold
 * colours and URLs rather than the words on the line.
 */
function collectText(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") out.push(record.text);

  for (const [key, nested] of Object.entries(record)) {
    if (key === "text" || key === "props" || key === "styles") continue;
    collectText(nested, out);
  }
}
