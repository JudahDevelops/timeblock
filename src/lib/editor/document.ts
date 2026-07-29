import type { Block } from "@blocknote/core";

/**
 * The stored body of an event: a BlockNote document, canonical and local-only.
 *
 * Every reference to BlockNote's shape goes through this module so a 0.x schema
 * change lands in one file rather than across the app.
 */
export type BlockDocument = Block[];

/** An event that has never been written to. BlockNote is given `undefined`
 *  instead, since it refuses to initialise from a zero-block document. */
export const EMPTY_BODY: BlockDocument = [];

/**
 * Bodies are `jsonb`, so Postgres will hand back whatever was put in. This is
 * a shape check at the trust boundary, not a schema validation: BlockNote
 * itself rejects blocks it cannot parse, and mirroring its full schema here
 * would need updating on every release.
 */
export function isBlockDocument(value: unknown): value is BlockDocument {
  return (
    Array.isArray(value) &&
    value.every(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        typeof (block as { type?: unknown }).type === "string",
    )
  );
}
