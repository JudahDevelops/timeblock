/** Beyond this the query is noise, and every term costs another index probe. */
const MAX_TERMS = 8;

/**
 * Turns what someone typed into a prefix `tsquery`.
 *
 * Every term becomes a prefix match, because the palette searches on each
 * keystroke: without `:*`, "onbo" finds nothing and results only appear once
 * the last letter of "onboarding" is typed.
 *
 * Punctuation is stripped rather than escaped. `to_tsquery` parses its argument
 * as a boolean expression, so a stray `&` or `!` is a syntax error rather than
 * a search for that character, and a user's own `:` would corrupt the prefix
 * marker. Dropping everything that is not a letter or digit sidesteps both.
 */
export function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS);

  if (terms.length === 0) return null;
  return terms.map((term) => `${term}:*`).join(" & ");
}
