"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import type { SearchResult } from "@/app/api/search/route";
import { calendarPath, type CalendarView } from "@/lib/date";
import { HIGHLIGHT_END, HIGHLIGHT_START } from "@/lib/search/highlight";
import { cn } from "@/lib/utils";

/** Long enough to skip the noise of fast typing, short enough to feel live. */
const DEBOUNCE_MS = 150;

export function CommandPalette({ view }: { view: CalendarView }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((current) => !current);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="border-line text-ink-muted hover:bg-surface-sunken flex items-center gap-2 rounded-md border px-1.5 py-1 text-xs transition-colors sm:px-2.5"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        {/* The magnifier alone is unambiguous, and the word is what pushes the
            toolbar past a phone's width. */}
        <span className="hidden sm:inline">Search</span>
      </button>

      {/* Unmounted while closed, so every open starts from a blank query and
          nothing keeps polling in the background. */}
      {open ? <Palette view={view} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Palette({ view, onClose }: { view: CalendarView; onClose: () => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: async (): Promise<SearchResult[]> => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(debounced)}`);
      if (!response.ok) throw new Error("Search failed");
      return (await response.json()).results;
    },
    enabled: debounced.trim().length > 0,
    // Holding the previous list while the next one loads stops the palette
    // flickering empty between keystrokes.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const results = debounced.trim() ? (data ?? []) : [];
  // A shrinking result set can strand the cursor past the end of the list.
  const index = Math.min(active, Math.max(results.length - 1, 0));

  function go(hit: SearchResult) {
    onClose();
    if (hit.kind === "page") {
      router.push(`/pages/${hit.id}`);
    } else {
      router.push(`${calendarPath(view, new Date(hit.startsAt))}?open=${hit.id}`);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowDown") setActive(Math.min(index + 1, results.length - 1));
    else if (event.key === "ArrowUp") setActive(Math.max(index - 1, 0));
    else if (event.key === "Enter" && results[index]) go(results[index]);
    else return;

    event.preventDefault();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[12vh]">
      <div className="fixed inset-0 bg-black/30" onPointerDown={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label="Search blocks"
        className="border-line bg-surface relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-2xl"
      >
        <input
          autoFocus
          value={term}
          onChange={(event) => {
            setTerm(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search titles and block bodies…"
          aria-label="Search blocks"
          className="border-line placeholder:text-ink-faint shrink-0 border-b bg-transparent px-4 py-3 text-sm outline-none"
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {results.map((hit, i) => (
            <button
              key={hit.id}
              type="button"
              // Pointer down, not click: mousedown would blur the input first
              // and a click on a list that just re-rendered can miss entirely.
              onPointerDown={() => go(hit)}
              onPointerEnter={() => setActive(i)}
              className={cn(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left",
                i === index && "bg-surface-raised",
              )}
            >
              <span className="flex w-full items-baseline gap-2">
                {hit.kind === "page" ? (
                  <span className="shrink-0 text-sm" aria-hidden>
                    {hit.emoji ?? "📄"}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {hit.title || (hit.kind === "page" ? "Untitled" : "Untitled block")}
                </span>
                {hit.kind === "page" ? (
                  <span className="text-ink-faint shrink-0 text-xs">Page</span>
                ) : (
                  <span className="text-ink-faint shrink-0 text-xs tabular-nums">
                    {format(new Date(hit.startsAt), "d MMM · HH:mm")}
                  </span>
                )}
              </span>
              {hit.snippet ? (
                <span className="text-ink-muted line-clamp-1 text-xs">
                  <Snippet text={hit.snippet} />
                </span>
              ) : null}
            </button>
          ))}

          {results.length === 0 ? (
            <p className="text-ink-faint px-3 py-6 text-center text-sm">
              {!debounced.trim()
                ? "Type to search every block you have written."
                : isFetching
                  ? "Searching…"
                  : "Nothing matches."}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Renders the sentinel-delimited runs Postgres marked as the match. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(HIGHLIGHT_START).map((chunk, i) => {
        if (i === 0) return <span key={i}>{chunk}</span>;
        const [matched, rest] = chunk.split(HIGHLIGHT_END);
        return (
          <span key={i}>
            <mark className="text-ink bg-transparent font-medium">{matched}</mark>
            {rest}
          </span>
        );
      })}
    </>
  );
}
