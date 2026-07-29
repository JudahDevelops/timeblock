import type { BlockDocument } from "./document";

/**
 * `body_text` feeds a `tsvector`, and Postgres caps a lexeme-bearing document
 * at 1MB. Truncating keeps a pathological body from failing the whole save.
 */
const MAX_LENGTH = 500_000;

/**
 * Flattens a block document to the words inside it, one line per block.
 *
 * The obvious alternative, `@blocknote/server-util`'s `blocksToMarkdownLossy`,
 * statically imports BlockNote's Yjs bundle and so pulls ProseMirror and
 * y-prosemirror into a route that runs on every autosave. It would also emit
 * markdown punctuation, which is noise to `to_tsvector`. Search wants words.
 */
export function blocksToPlainText(body: BlockDocument): string {
  const lines: string[] = [];
  walk(body, lines);
  return lines.join("\n").slice(0, MAX_LENGTH);
}

function walk(blocks: unknown, lines: string[]): void {
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { content, children } = block as { content?: unknown; children?: unknown };

    const parts: string[] = [];
    collectText(content, parts);
    const line = parts.join("").trim();
    if (line) lines.push(line);

    // Nesting is the point of the product, so a word buried in a toggle inside
    // a checklist has to be as findable as one in a top-level paragraph.
    walk(children, lines);
  }
}

/**
 * Gathers every `text` leaf in an inline-content tree.
 *
 * Structure-agnostic on purpose: paragraphs, links, and table cells all differ
 * in shape and BlockNote is pre-1.0. Anything carrying a `text` string is
 * words the user typed; `props` and `styles` are skipped because they hold
 * colours, URLs and languages rather than prose.
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
