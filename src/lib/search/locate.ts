/**
 * Finding what someone searched for inside the document they landed on.
 *
 * The palette matches through Postgres full-text search, which stems and
 * normalises: searching "running" matches a document containing "run". So the
 * phrase the user typed frequently does not appear literally anywhere on the
 * page, and a plain `indexOf` finds nothing precisely when the highlight is most
 * needed. These helpers pick the best *available* anchor instead, degrading from
 * the whole phrase to a single word rather than giving up.
 *
 * Pure and DOM-free so it can be tested; the caller walks the editor's text
 * nodes and hands the concatenated text in.
 */

/** Matching the palette's own tokenizer, so both agree on what a "word" is. */
function terms(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * A word short enough that matching it alone is noise rather than a location.
 *
 * Landing on the "the" in paragraph one when the real hit is nine paragraphs
 * down is worse than not scrolling at all: it looks like the feature ran and
 * chose that spot.
 */
const MIN_ANCHOR_LENGTH = 3;

export type Match = { start: number; end: number };

/**
 * Where in `text` to point the reader, or `null` if nothing is worth pointing at.
 *
 * Tried in descending order of confidence:
 *  1. the full phrase, which is what the user believes they searched for;
 *  2. the longest single term, because a long word is a far better locator than
 *     a short one and stemming means the short ones often match everywhere;
 *  3. a prefix of the longest term, which is what catches the stemmed case —
 *     "running" against a document that says "runs" shares only "run".
 */
export function findMatch(text: string, query: string): Match | null {
  const haystack = text.toLowerCase();
  const phrase = query.trim().toLowerCase();
  if (!phrase || !haystack) return null;

  const whole = haystack.indexOf(phrase);
  if (whole !== -1) return { start: whole, end: whole + phrase.length };

  const words = terms(query)
    .filter((term) => term.length >= MIN_ANCHOR_LENGTH)
    // Longest first: the most specific anchor available is the one to try next.
    .sort((a, b) => b.length - a.length);

  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at !== -1) return { start: at, end: at + word.length };
  }

  // Nothing matched whole, so fall back to stems. Only the longest term is worth
  // this: shortening the others would walk straight back into matching "the".
  const longest = words[0];
  if (!longest) return null;

  for (let length = longest.length - 1; length >= MIN_ANCHOR_LENGTH; length--) {
    const stem = longest.slice(0, length);
    const at = haystack.indexOf(stem);
    if (at !== -1) return { start: at, end: at + stem.length };
  }

  return null;
}
