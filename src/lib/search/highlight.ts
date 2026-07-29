/**
 * Sentinels wrapping the matched words inside a search snippet.
 *
 * Control characters rather than markup: the snippet is rendered as text, so an
 * HTML marker would either show up literally or force `dangerouslySetInnerHTML`
 * over a string made of the user's own prose. Neither of these can occur in
 * anything a person typed.
 *
 * Shared rather than server-only because Postgres writes them and the palette
 * reads them, and the two have to agree.
 */
export const HIGHLIGHT_START = "\u0002";
export const HIGHLIGHT_END = "\u0003";
