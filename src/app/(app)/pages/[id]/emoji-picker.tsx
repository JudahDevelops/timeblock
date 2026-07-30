"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { type EmojiClickData, Theme } from "emoji-picker-react";

import { useMediaQuery } from "@/lib/use-media-query";

const Picker = dynamic(() => import("emoji-picker-react"), { ssr: false });

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useMediaQuery("(prefers-color-scheme: dark)", false);

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
