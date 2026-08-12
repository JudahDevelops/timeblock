"use client";

import dynamic from "next/dynamic";

/**
 * The editor, loaded on demand — but only ever described once.
 *
 * BlockNote is large and must stay out of the server render (`ssr: false`), so
 * both the page and the drawer reach it through `next/dynamic`. They used to
 * each call `dynamic()` themselves, which meant two module references to one
 * chunk and, more importantly, nowhere to say "fetch this now".
 *
 * Declaring it here gives both call sites the same component and gives the
 * shell a `preloadEditor()` to call while the app is idle, so the first
 * document opened in a session does not pay the download after everything else
 * has already finished waiting.
 */
export const BlockEditor = dynamic(() => import("./block-editor"), {
  ssr: false,
  loading: () => <div className="text-ink-faint px-14 py-8 text-sm">Loading editor…</div>,
});

/**
 * Starts fetching the editor chunk.
 *
 * Safe to call more than once — the underlying import is cached, so repeat
 * calls resolve against the same promise rather than refetching. Failure is
 * swallowed deliberately: this is a head start, not a dependency, and the real
 * mount will surface any genuine problem.
 */
export function preloadEditor() {
  void (BlockEditor as typeof BlockEditor & { preload?: () => Promise<unknown> })
    .preload?.()
    .catch(() => {});
}
