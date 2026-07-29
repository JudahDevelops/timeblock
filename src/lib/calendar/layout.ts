/**
 * Side-by-side placement for overlapping events.
 *
 * Events that overlap in time are grouped into clusters, and each cluster is
 * split into as many columns as its densest moment requires. Pure and
 * DOM-free, because getting this subtly wrong is invisible until two blocks
 * silently sit on top of each other.
 */

export type Positionable = {
  id: string;
  startMinutes: number;
  endMinutes: number;
};

export type Placed<T extends Positionable> = {
  item: T;
  /** Zero-based column within the cluster. */
  column: number;
  /** Total columns in this event's cluster; width is 1/columns. */
  columns: number;
};

/**
 * Groups transitively-overlapping events, then assigns each to the leftmost
 * column that is free at its start time.
 *
 * Events are sorted by start, then longest-first, so a long event claims
 * column 0 and shorter ones stack to its right — which reads better than the
 * reverse.
 */
export function layoutDay<T extends Positionable>(items: readonly T[]): Placed<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      b.endMinutes - b.startMinutes - (a.endMinutes - a.startMinutes) ||
      a.id.localeCompare(b.id),
  );

  const placed: Placed<T>[] = [];
  let cluster: T[] = [];
  let clusterEnd = -Infinity;

  function flush() {
    if (cluster.length === 0) return;

    // Last occupied end-minute per column.
    const columnEnds: number[] = [];
    const assignments = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
      }
      columnEnds[column] = item.endMinutes;
      return { item, column };
    });

    const columns = columnEnds.length;
    for (const { item, column } of assignments) {
      placed.push({ item, column, columns });
    }

    cluster = [];
    clusterEnd = -Infinity;
  }

  for (const item of sorted) {
    // A zero-length event still belongs with whatever it touches, but an event
    // starting exactly when the cluster ends begins a new cluster.
    if (item.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flush();

  return placed;
}
