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

/** Enough of a document to decide which of two copies is newer. */
export type Revisioned = { bodyRev: number };

/**
 * Which of two copies of one document to open.
 *
 * Keeping a document cached across a tab switch is what makes reopening it
 * free, but a cache that always wins is a cache that can serve back a version
 * the user has already moved past — edited in another tab, or arrived by sync.
 * `bodyRev` is the only thing that actually orders the two, so it decides.
 *
 * Incoming wins a tie. A tie means the same revision, so the two are the same
 * document, and preferring the fresher object avoids pinning a stale one in the
 * cache forever.
 *
 * Pure and separated from the component because it is the rule that protects
 * the user's text: get it backwards and an edit disappears behind an older
 * copy. Kept honest by `document.test.ts`.
 */
export function pickDocument<T extends Revisioned>(cached: T | undefined, incoming: T): T {
  if (!cached) return incoming;
  return cached.bodyRev > incoming.bodyRev ? cached : incoming;
}
