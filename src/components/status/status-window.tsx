"use client";

import { useEffect, useState } from "react";

import { isStatusHotkey } from "@/lib/hotkeys";

import { PauseMenu } from "./pause-menu";
import { StatusHud } from "./status-hud";
import { useNow, useStatus } from "./use-status";

/**
 * Owns the hotkey and the open state for both status surfaces.
 *
 * Mounted in the shell rather than inside the calendar tree, for two reasons:
 * `swipe-pager.tsx` offsets its strip by a negative margin precisely because a
 * `transform` would become the containing block for every `fixed` descendant,
 * and mounting outside it also keeps the window alive across calendar
 * navigation instead of remounting on every page turn.
 */
export function StatusWindow() {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const { data: view } = useStatus(now);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Modifiers mean no typing-guard is needed, the same reason the search
      // palette is safe to register globally while the toolbar's bare keys
      // are not. See `hotkeys.ts` for why it is Ctrl+Shift and not Cmd.
      if (!isStatusHotkey(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Nothing to say until the client has resolved a clock and the first fetch
  // has landed. Rendering a skeleton strip would just be a flash of furniture.
  if (!view || !now) return null;

  return (
    <>
      <StatusHud view={view} onOpen={() => setOpen(true)} />
      {open ? <PauseMenu view={view} now={now} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
