"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

import type { BlockDocument } from "@/lib/editor/document";
import { useMediaQuery } from "@/lib/use-media-query";

/**
 * The block canvas. Mounted through `next/dynamic` with `ssr: false` — BlockNote
 * builds a ProseMirror view against the DOM and cannot be prerendered.
 *
 * `initialContent` is read exactly once. The editor is uncontrolled from here
 * on: React never pushes content back into it, which is what keeps typing fast.
 */
export default function BlockEditor({
  initialContent,
  onChange,
}: {
  initialContent: BlockDocument;
  onChange: (body: BlockDocument) => void;
}) {
  const dark = useMediaQuery("(prefers-color-scheme: dark)", false);

  const editor = useCreateBlockNote({
    // BlockNote refuses a zero-block document, so a never-written body has to
    // come through as undefined and let it seed an empty paragraph.
    initialContent: initialContent.length > 0 ? initialContent : undefined,
  });

  return (
    <BlockNoteView
      editor={editor}
      theme={dark ? "dark" : "light"}
      onChange={() => onChange(editor.document)}
      className="min-h-full"
    />
  );
}
