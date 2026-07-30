"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";

import type { PageDocument } from "@/app/api/pages/[id]/body/route";
import { useBodyAutosave, type SaveState } from "@/components/editor/use-body-autosave";
import { deletePage, updatePageEmoji, updatePageTitle } from "@/server/actions/pages";
import { SidebarTrigger } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";

import { EmojiPicker } from "./emoji-picker";

const BlockEditor = dynamic(() => import("@/components/editor/block-editor"), {
  ssr: false,
  loading: () => <div className="text-ink-faint px-14 py-8 text-sm">Loading editor…</div>,
});

const STATUS_LABEL: Record<SaveState, string> = {
  idle: "",
  pending: "Unsaved",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Out of date",
  error: "Couldn't save",
};

export function PageDetail({
  pageId,
  title: initialTitle,
  emoji: initialEmoji,
}: {
  pageId: string;
  title: string;
  emoji: string | null;
}) {
  const router = useRouter();
  const [emoji, setEmoji] = useState(initialEmoji);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleRename = (value: string) => {
    if (value !== initialTitle) {
      void updatePageTitle({ id: pageId, title: value });
    }
  };

  const handleEmojiSelect = (selected: string | null) => {
    setEmoji(selected);
    setShowEmojiPicker(false);
    void updatePageEmoji({ id: pageId, emoji: selected });
  };

  const handleDelete = () => {
    void deletePage(pageId);
    router.push("/pages");
  };

  const { data, isPending, isError } = useQuery({
    queryKey: ["page-body", pageId],
    queryFn: async (): Promise<PageDocument> => {
      const response = await fetch(`/api/pages/${pageId}/body`);
      if (!response.ok) throw new Error(`Failed to load page ${pageId}`);
      return response.json();
    },
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="border-line flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
        <SidebarTrigger />
        <button
          type="button"
          onClick={() => router.push("/pages")}
          className="text-ink-muted hover:text-ink text-sm"
          aria-label="Back to pages"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.75}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 4l-6 6 6 6" />
          </svg>
        </button>
        <span className="text-ink-muted text-sm">Pages</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="mb-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="hover:bg-surface-raised rounded-lg p-1 text-3xl transition-colors"
              aria-label="Change icon"
            >
              {emoji ?? "📄"}
            </button>
            {showEmojiPicker ? (
              <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
            ) : null}
          </div>

          <input
            defaultValue={initialTitle}
            placeholder="Untitled"
            className="placeholder:text-ink-faint mb-6 w-full bg-transparent text-3xl font-bold outline-none"
            onBlur={(e) => handleRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />

          {isError ? (
            <p className="text-danger text-sm">Couldn&apos;t load this page. Try refreshing.</p>
          ) : isPending ? (
            <p className="text-ink-faint text-sm">Loading…</p>
          ) : (
            <PageBody doc={data} onDelete={handleDelete} />
          )}
        </div>
      </div>
    </div>
  );
}

function PageBody({ doc, onDelete }: { doc: PageDocument; onDelete: () => void }) {
  const [conflict, setConflict] = useState(false);
  const handleConflict = useCallback(() => setConflict(true), []);

  const { state, scheduleSave, flush } = useBodyAutosave({
    eventId: doc.id,
    initialRev: doc.bodyRev,
    onConflict: handleConflict,
    basePath: "/api/pages",
  });

  const flushed = useRef(false);
  useEffect(() => {
    return () => {
      if (!flushed.current) {
        flushed.current = true;
        void flush();
      }
    };
  }, [flush]);

  return (
    <>
      {conflict ? (
        <p className="bg-warn-surface text-warn mb-4 rounded-md px-4 py-2 text-sm">
          This page changed somewhere else. Nothing here is being saved — copy anything new, then
          reopen it.
        </p>
      ) : null}

      <div className="min-h-[50vh]">
        <BlockEditor initialContent={doc.body} onChange={scheduleSave} />
      </div>

      <footer className="border-line mt-8 flex items-center border-t pt-4">
        <button
          type="button"
          onClick={onDelete}
          className="text-danger hover:text-danger/80 text-xs"
        >
          Delete page
        </button>
        <span
          className={cn(
            "ml-auto text-xs",
            state === "error" || state === "conflict" ? "text-danger" : "text-ink-faint",
          )}
        >
          {STATUS_LABEL[state]}
        </span>
      </footer>
    </>
  );
}
