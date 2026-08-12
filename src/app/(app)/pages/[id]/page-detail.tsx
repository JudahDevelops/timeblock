"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";

import type { PageDocument } from "@/app/api/pages/[id]/body/route";
import { useBodyAutosave, type SaveState } from "@/components/editor/use-body-autosave";
import { useHighlightMatch } from "@/components/search/use-highlight-match";
import { useRegisterTab } from "@/components/shell/use-register-tab";
import { closeTab } from "@/lib/tabs";
import { deletePage, updatePageEmoji, updatePageTitle } from "@/server/actions/pages";
import { SidebarTrigger } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";

import { EmojiPicker } from "@/components/shell/emoji-picker";

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
  initialDoc,
}: {
  pageId: string;
  title: string;
  emoji: string | null;
  /** The document as the server already had it, so nothing has to be fetched. */
  initialDoc: PageDocument;
}) {
  const router = useRouter();
  const [emoji, setEmoji] = useState(initialEmoji);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  /** Set when arriving from the palette, so the match can be pointed at. */
  const query = useSearchParams().get("q");
  const [title, setTitle] = useState(initialTitle);

  // The bare path, never the `?q=` one: a tab is a document, and two visits to
  // the same page from two different searches are the same tab.
  useRegisterTab({ href: `/pages/${pageId}`, title, emoji });

  const handleRename = (value: string) => {
    if (value !== initialTitle) {
      setTitle(value);
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
    // Or the strip keeps a tab pointing at a page that no longer exists, which
    // reopens as a 404 the next time it is clicked.
    closeTab(`/pages/${pageId}`);
    router.push("/pages");
  };

  const { data, isPending, isError } = useQuery({
    queryKey: ["page-body", pageId],
    queryFn: async (): Promise<PageDocument> => {
      const response = await fetch(`/api/pages/${pageId}/body`);
      if (!response.ok) throw new Error(`Failed to load page ${pageId}`);
      return response.json();
    },
    // `initialData`, not `placeholderData`: this *is* the document, read from
    // the same row in the same request that rendered the page, so the query
    // starts resolved and the editor mounts on the first paint. With
    // `staleTime: Infinity` it is also never refetched behind the user's back —
    // which matters, because the editor is uncontrolled and a late refetch
    // would be a second document arriving after they had started typing.
    initialData: initialDoc,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Mobile menu trigger — small, top-left, doesn't take up page space */}
      <div className="sticky top-0 z-10 flex items-center px-4 pt-3 md:hidden">
        <SidebarTrigger />
      </div>

      <div className="mx-auto w-full max-w-[900px] px-6 pt-8 pb-24 sm:px-24 md:pt-16">
        {/* Emoji icon — click to change */}
        <div className="relative mb-4">
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="hover:bg-surface-raised rounded-lg p-1 text-[78px] leading-none transition-colors"
            aria-label="Change icon"
          >
            {emoji ?? "📄"}
          </button>
          {showEmojiPicker ? (
            <EmojiPicker onSelect={handleEmojiSelect} onClose={() => setShowEmojiPicker(false)} />
          ) : null}
        </div>

        {/* Title — large, bold, inline editable */}
        <input
          defaultValue={initialTitle}
          placeholder="Untitled"
          className="placeholder:text-ink-faint mb-2 w-full bg-transparent text-[40px] leading-tight font-bold outline-none"
          onBlur={(e) => handleRename(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />

        {/* Body */}
        {isError ? (
          <p className="text-danger mt-8 text-sm">Couldn&apos;t load this page. Try refreshing.</p>
        ) : isPending ? (
          <p className="text-ink-faint mt-8 text-sm">Loading…</p>
        ) : (
          <PageBody doc={data} onDelete={handleDelete} query={query} />
        )}
      </div>
    </div>
  );
}

function PageBody({
  doc,
  onDelete,
  query,
}: {
  doc: PageDocument;
  onDelete: () => void;
  query: string | null;
}) {
  const [conflict, setConflict] = useState(false);
  const handleConflict = useCallback(() => setConflict(true), []);

  // The body is in hand by the time this renders, so the editor is either up or
  // about to be; the hook retries until its text appears.
  useHighlightMatch(query, true);

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

      <div className="page-editor mt-1 min-h-[60vh]">
        <BlockEditor initialContent={doc.body} onChange={scheduleSave} />
      </div>

      <div className="border-line mt-12 flex items-center border-t pt-4">
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
      </div>
    </>
  );
}
