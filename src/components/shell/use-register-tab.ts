"use client";

import { useEffect } from "react";

import { openTab } from "@/lib/tabs";

/**
 * Records that this document is open, so it appears in the tab strip.
 *
 * Called by the page itself rather than derived from the route, because only the
 * page knows its own title and emoji — the strip would otherwise have to hold a
 * lookup table of every route shape in the app, and would show a raw uuid for
 * the frames before it resolved one.
 *
 * An effect rather than a render-time call: this writes to storage and notifies
 * listeners, which is precisely the side effect that must not happen during
 * render.
 */
export function useRegisterTab(tab: { href: string; title: string; emoji: string | null }) {
  const { href, title, emoji } = tab;

  useEffect(() => {
    openTab({ href, title, emoji });
  }, [href, title, emoji]);
}
