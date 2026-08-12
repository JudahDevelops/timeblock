import { MAX_GROUP_DEPTH } from "./field";

/** The part of a field the tree rules care about. */
export type Nestable = {
  id: string;
  parentId: string | null;
};

/**
 * How many groups a field sits inside.
 *
 * 0 at the dashboard's top level, 1 inside a group, 2 inside a group inside a
 * group. A chain that loops, or one longer than any tree we would draw, returns
 * `Infinity` — the caller reads that as "do not nest this", which is the safe
 * answer for a row we cannot place.
 *
 * Walks upward rather than downward because a field knows its parent and not its
 * children, and the walk is bounded twice over: by the `seen` set, which catches
 * a cycle the moment it closes, and by the ceiling below it.
 */
export function depthOf(field: Nestable, byId: ReadonlyMap<string, Nestable>): number {
  const seen = new Set<string>([field.id]);
  let depth = 0;
  let current = field;

  while (current.parentId) {
    const parent = byId.get(current.parentId);
    // A parent outside this set is not an error: the row may have been deleted,
    // or belong to another dashboard. The field is simply top-level.
    if (!parent) return depth;

    // Closed the loop. Following it further would never terminate.
    if (seen.has(parent.id)) return Infinity;
    seen.add(parent.id);

    depth += 1;
    // Deeper than anything we draw. Reported rather than kept walking, so a
    // pathological chain cannot cost more than the ceiling.
    if (depth > MAX_GROUP_DEPTH) return Infinity;

    current = parent;
  }

  return depth;
}

/**
 * Whether a field may hang from its recorded parent.
 *
 * False for a field pointing at itself, for one whose parent chain loops, and
 * for one that would land below the depth ceiling. Every one of those cases
 * means the row exists but has nowhere legible to be drawn, and the caller
 * promotes it to the top level rather than losing it.
 */
export function canNest(field: Nestable, byId: ReadonlyMap<string, Nestable>): boolean {
  if (!field.parentId || field.parentId === field.id) return false;
  return depthOf(field, byId) <= MAX_GROUP_DEPTH;
}

/** A field carrying its own children — the shape the tree is drawn from. */
type Tree = { id: string; children: Tree[] };

/**
 * Finds a field anywhere in the tree, by id.
 *
 * Depth-first rather than a scan of the top rank, because a group may now sit
 * inside another one: looking only at the first level would miss the target and
 * silently hand back the wrong sibling set.
 *
 * Bounded by the depth ceiling that built the tree, so no cycle guard is needed
 * here — `nestFields` cannot produce one.
 */
export function findField<T extends Tree>(fields: T[], id: string): T | null {
  for (const field of fields) {
    if (field.id === id) return field;
    const found = findField(field.children as T[], id);
    if (found) return found;
  }
  return null;
}
