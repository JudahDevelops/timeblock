"use client";

import { useEffect } from "react";

import { findMatch } from "@/lib/search/locate";

/** Long enough to be seen after the scroll settles, short enough not to linger. */
const FLASH_MS = 2200;
/** Editor content arrives after mount, so the first look is usually too early. */
const RETRY_MS = 120;
/**
 * ~9s of looking. Generous because the editor is a dynamic import that then
 * fetches its own body: on a cold chunk load the text can be several seconds
 * away, and giving up early means the highlight silently never appears in
 * exactly the case the reader waited longest for. Nothing is drawn until the
 * text is found, so a long budget costs only the polling.
 */
const MAX_ATTEMPTS = 75;

/**
 * Scrolls the phrase someone searched for into view and flashes it.
 *
 * Clicking a search result used to drop the reader at the top of a document and
 * leave them to find the thing themselves — the match was known and then thrown
 * away. This paints it back.
 *
 * Done against the DOM rather than through BlockNote's API deliberately: the
 * editor owns its document and is never a controlled component, so reaching in
 * to rewrite blocks to mark a hit would both fight that and dirty the document,
 * triggering an autosave of content the user never edited. A `Range` over the
 * rendered text nodes changes nothing the editor knows about, and the highlight
 * is a `::selection`-like overlay that disappears on the next keystroke.
 *
 * Retries because the editor mounts through `next/dynamic` and then loads its
 * body asynchronously; there is no single event that means "the text is on
 * screen", so this looks until it finds something or gives up.
 */
export function useHighlightMatch(query: string | null, ready: boolean) {
  useEffect(() => {
    if (!query || !ready) return;

    let attempts = 0;
    let timer: number | null = null;
    let cleanup: (() => void) | null = null;

    function attempt() {
      timer = null;
      const root = document.querySelector<HTMLElement>(".bn-editor");
      const result = root ? paint(root, query!) : "retry";

      // Only a painted highlight ends the loop. "give-up" means the text is on
      // screen and genuinely has no match, which is also final — but distinct
      // from "retry", where the editor exists and is simply still empty. These
      // were one value once, and folding them together meant the very first
      // look, taken before ProseMirror had rendered a single character, counted
      // as a definitive answer and cancelled every retry.
      if (result === "retry") {
        if (++attempts < MAX_ATTEMPTS) timer = window.setTimeout(attempt, RETRY_MS);
        return;
      }

      if (typeof result === "function") cleanup = result;
    }

    attempt();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      cleanup?.();
    };
  }, [query, ready]);
}

/**
 * Marks the match inside `root`.
 *
 * Returns how to undo the highlight, or `"retry"` when the editor is present but
 * has not rendered its text yet, or `"give-up"` when there is simply nothing to
 * point at. The caller needs all three: the first two look identical from the
 * outside and mean opposite things.
 */
type PaintResult = (() => void) | "retry" | "give-up";

function paint(root: HTMLElement, query: string): PaintResult {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = "";

  // The document as one string, remembering where each node's slice began, so an
  // offset in the concatenation can be turned back into a node and an offset.
  const starts: number[] = [];
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? "";
    if (value) {
      starts.push(text.length);
      nodes.push(node as Text);
      text += value;
    }
    node = walker.nextNode();
  }

  // The editor is mounted but ProseMirror has not put the document in it yet.
  if (!text.trim()) return "retry";

  const match = findMatch(text, query);
  if (!match) return "give-up";

  const from = locate(nodes, starts, match.start);
  const to = locate(nodes, starts, match.end);
  if (!from || !to) return "give-up";

  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    // Offsets can fall outside a node if the document changed mid-walk. Not
    // worth retrying — the reader is already looking at the page.
    return "give-up";
  }

  const rects = range.getClientRects();
  // Text present but not laid out yet, so there is nowhere to draw. Worth
  // another look, unlike the failures above.
  if (rects.length === 0) return "retry";

  // An overlay rather than wrapping the text in a `<mark>`: inserting an element
  // inside a ProseMirror-managed subtree makes the editor rewrite it on the next
  // transaction, and can move the caret. Nothing here is in the editor's tree.
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0";

  const host = root.parentElement ?? root;
  const hostBox = host.getBoundingClientRect();
  // The overlay is positioned against `host`, so it needs a containing block.
  const previousPosition = host.style.position;
  if (getComputedStyle(host).position === "static") host.style.position = "relative";

  for (const rect of Array.from(rects)) {
    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      `left:${rect.left - hostBox.left + host.scrollLeft}px`,
      `top:${rect.top - hostBox.top + host.scrollTop}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      "border-radius:3px",
      "background:var(--now)",
      "opacity:0.28",
      "transition:opacity 400ms ease-out",
    ].join(";");
    layer.appendChild(box);
  }

  host.appendChild(layer);

  // `nearest` rather than `center`: the reader has just arrived and moving the
  // page when the match was already visible reads as the page jumping on its own.
  const anchor = from.node.parentElement;
  anchor?.scrollIntoView({ block: "nearest", behavior: "smooth" });

  const fade = window.setTimeout(() => {
    for (const box of Array.from(layer.children)) {
      (box as HTMLElement).style.opacity = "0";
    }
  }, FLASH_MS);

  const remove = window.setTimeout(() => layer.remove(), FLASH_MS + 400);

  return () => {
    window.clearTimeout(fade);
    window.clearTimeout(remove);
    layer.remove();
    host.style.position = previousPosition;
  };
}

/** Turns an offset into the concatenated text back into a node and an offset. */
function locate(
  nodes: Text[],
  starts: number[],
  offset: number,
): { node: Text; offset: number } | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (offset >= starts[i]) {
      const node = nodes[i];
      const local = offset - starts[i];
      return { node, offset: Math.min(local, node.nodeValue?.length ?? 0) };
    }
  }
  return null;
}
