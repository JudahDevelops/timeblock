"use client";

import { useEffect, useRef, useState } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Smileys",
    emojis: [
      "😀",
      "😃",
      "😄",
      "😁",
      "😆",
      "😅",
      "🤣",
      "😂",
      "🙂",
      "😊",
      "😇",
      "🥰",
      "😍",
      "🤩",
      "😘",
      "😎",
      "🤔",
      "🤗",
      "🫡",
      "🤫",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "📄",
      "📝",
      "📋",
      "📌",
      "📎",
      "📁",
      "📂",
      "🗂️",
      "📅",
      "📆",
      "🔖",
      "📕",
      "📗",
      "📘",
      "📙",
      "📚",
      "📖",
      "🔗",
      "💡",
      "🔍",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "⭐",
      "🌟",
      "✨",
      "💫",
      "🔥",
      "❤️",
      "🧡",
      "💛",
      "💚",
      "💙",
      "💜",
      "🖤",
      "🤍",
      "💯",
      "✅",
      "❌",
      "⚡",
      "🎯",
      "🚀",
      "🏆",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "🌱",
      "🌿",
      "🍀",
      "🌺",
      "🌻",
      "🌸",
      "🌈",
      "☀️",
      "🌙",
      "⛅",
      "🌊",
      "🏔️",
      "🌍",
      "🦋",
      "🐝",
      "🌵",
      "🍁",
      "🍂",
      "🌴",
      "🎄",
    ],
  },
  {
    label: "Food",
    emojis: [
      "🍎",
      "🍊",
      "🍋",
      "🍇",
      "🍓",
      "🫐",
      "🍑",
      "🥑",
      "🍕",
      "🍔",
      "☕",
      "🍵",
      "🧁",
      "🍰",
      "🎂",
      "🍫",
      "🍿",
      "🥤",
      "🍷",
      "🧃",
    ],
  },
];

export function EmojiPicker({
  onSelect,
  onClose,
}: {
  onSelect: (emoji: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");

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

  const allEmojis = EMOJI_GROUPS.flatMap((g) => g.emojis);

  return (
    <div
      ref={ref}
      className="bg-surface-raised border-line absolute z-50 mt-12 w-72 rounded-xl border p-3 shadow-xl"
      role="dialog"
      aria-label="Choose an icon"
    >
      <div className="mb-2 flex items-center gap-2">
        <input
          type="text"
          placeholder="Search emoji…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          className="border-line bg-surface flex-1 rounded-md border px-2 py-1 text-sm outline-none"
          autoFocus
        />
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-ink-muted hover:text-ink text-xs underline underline-offset-4"
        >
          Remove
        </button>
      </div>

      <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto">
        {(search ? allEmojis : allEmojis).map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="hover:bg-surface-sunken rounded p-1 text-xl transition-colors"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
