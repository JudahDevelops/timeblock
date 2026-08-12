"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { type EmojiClickData, Theme } from "emoji-picker-react";

import { readTheme, subscribeTheme } from "@/lib/theme";

const Picker = dynamic(() => import("emoji-picker-react"), { ssr: false });

/**
 * Whether the app is currently dark, which is not the same question as whether
 * the OS is.
 *
 * Dark mode here is a class on `<html>` that the user can set independently of
 * their system preference, so asking `prefers-color-scheme` directly renders a
 * light picker inside a dark app whenever the two disagree. Read through the
 * same store the theme toggle writes, then resolve "system" against the media
 * query only as the fallback it actually is.
 */
function subscribeDark(onChange: () => void) {
  const unsubscribe = subscribeTheme(onChange);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => {
    unsubscribe();
    media.removeEventListener("change", onChange);
  };
}

function isDark() {
  const theme = readTheme();
  if (theme !== "system") return theme === "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `false` on the server: the picker is `ssr: false` anyway, so this only
  // decides the very first client frame.
  const dark = useSyncExternalStore(subscribeDark, isDark, () => false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onSelect(emojiData.emoji);
  };

  return (
    <div ref={ref} className="absolute z-50 mt-2">
      <Picker
        onEmojiClick={handleEmojiClick}
        theme={dark ? Theme.DARK : Theme.LIGHT}
        width={350}
        height={400}
        searchPlaceHolder="Search emoji…"
        previewConfig={{ showPreview: false }}
      />
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="text-ink-muted hover:text-ink bg-surface-raised border-line mt-1 w-full rounded-lg border px-3 py-2 text-xs"
      >
        Remove icon
      </button>
    </div>
  );
}
