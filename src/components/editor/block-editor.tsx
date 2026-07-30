"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

import type { BlockDocument } from "@/lib/editor/document";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

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

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    block: Block;
  } | null>(null);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Walk up from the click target to find the block element
      const target = event.target as HTMLElement;
      const blockEl = target.closest("[data-node-type='blockContainer']");
      if (!blockEl) return;

      event.preventDefault();

      // Get the block id from the element
      const blockId = blockEl.getAttribute("data-id");
      if (!blockId) return;

      const block = editor.getBlock(blockId);
      if (!block) return;

      setContextMenu({ x: event.clientX, y: event.clientY, block });
    },
    [editor],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div
      className="relative flex min-h-full flex-col"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onContextMenu={handleContextMenu}
    >
      <BlockNoteView
        editor={editor}
        theme={dark ? "dark" : "light"}
        onChange={() => onChange(editor.document)}
        className="flex-1"
      />
      {coarse && focused ? <NestingBar editor={editor} /> : null}
      {contextMenu ? (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          block={contextMenu.block}
          editor={editor}
          onClose={closeContextMenu}
          onChange={() => onChange(editor.document)}
        />
      ) : null}
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

function EditorContextMenu({
  x,
  y,
  block,
  editor,
  onClose,
  onChange,
}: {
  x: number;
  y: number;
  block: Block;
  editor: BlockNoteEditor;
  onClose: () => void;
  onChange: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

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

  // Keep the menu within viewport bounds
  const style: React.CSSProperties = {
    position: "fixed",
    left: x,
    top: y,
    zIndex: 100,
  };

  const handleDelete = () => {
    editor.removeBlocks([block]);
    onChange();
    onClose();
  };

  const handleDuplicate = () => {
    const copy = { ...block, id: undefined } as Parameters<typeof editor.insertBlocks>[0][0];
    editor.insertBlocks([copy], block, "after");
    onChange();
    onClose();
  };

  const handleTurnIntoParagraph = () => {
    editor.updateBlock(block, { type: "paragraph" });
    onChange();
    onClose();
  };

  return (
    <div
      ref={ref}
      style={style}
      role="menu"
      className="bg-surface-raised border-line min-w-[160px] rounded-lg border py-1 shadow-xl"
    >
      <ContextMenuItem label="Delete" onSelect={handleDelete} destructive />
      <ContextMenuItem label="Duplicate" onSelect={handleDuplicate} />
      {block.type !== "paragraph" ? (
        <ContextMenuItem label="Turn into text" onSelect={handleTurnIntoParagraph} />
      ) : null}
    </div>
  );
}

function ContextMenuItem({
  label,
  onSelect,
  destructive,
}: {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "hover:bg-surface-sunken w-full px-3 py-1.5 text-left text-sm transition-colors",
        destructive ? "text-danger" : "text-ink",
      )}
    >
      {label}
    </button>
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
