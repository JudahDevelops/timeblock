"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

import type { BlockDocument } from "@/lib/editor/document";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
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
  const coarse = useCoarsePointer();
  const [focused, setFocused] = useState(false);

  const editor = useCreateBlockNote({
    // BlockNote refuses a zero-block document, so a never-written body has to
    // come through as undefined and let it seed an empty paragraph.
    initialContent: initialContent.length > 0 ? initialContent : undefined,
  });

  return (
    <div
      className="flex min-h-full flex-col"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        onChange={() => onChange(editor.document)}
        className="flex-1"
      />
      {coarse && focused ? <NestingBar editor={editor} /> : null}
    </div>
  );
}

/**
 * Indent and outdent, for keyboards that have no Tab key.
 *
 * Nesting is the whole point of the document, and on iOS the only way to reach
 * it is a button: the software keyboard offers no Tab, and BlockNote's own
 * formatting toolbar only appears over a selection.
 */
function NestingBar({ editor }: { editor: BlockNoteEditor }) {
  // Nesting acts on the block holding the cursor, so the press must never take
  // focus — losing it would also lose the selection the action depends on.
  const hold = (run: () => void) => (event: React.PointerEvent | React.MouseEvent) => {
    event.preventDefault();
    run();
  };

  return (
    <div className="border-line bg-surface sticky bottom-0 mt-auto flex justify-end gap-1 border-t px-4 py-2">
      <NestingButton
        label="Outdent"
        onPress={hold(() => {
          if (editor.canUnnestBlock()) editor.unnestBlock();
        })}
      >
        <path d="M9 5h8M9 10h8M9 15h8M6 7l-3 3 3 3" />
      </NestingButton>
      <NestingButton
        label="Indent"
        onPress={hold(() => {
          if (editor.canNestBlock()) editor.nestBlock();
        })}
      >
        <path d="M9 5h8M9 10h8M9 15h8M3 7l3 3-3 3" />
      </NestingButton>
    </div>
  );
}

function NestingButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: (event: React.PointerEvent | React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      // Both: pointerdown does the work, mousedown is the compatibility event a
      // touch replays afterwards and would otherwise still steal focus.
      onPointerDown={onPress}
      onMouseDown={(event) => event.preventDefault()}
      className="active:bg-surface-raised text-ink-muted rounded-md p-2"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
