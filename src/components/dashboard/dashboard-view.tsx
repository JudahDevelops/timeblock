"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { EmojiPicker } from "@/components/shell/emoji-picker";
import { useToast } from "@/components/shell/toast";
import {
  DEFAULT_FIELD_H,
  DEFAULT_FIELD_W,
  DEFAULT_GROUP_H,
  DEFAULT_GROUP_W,
  DEFAULT_SCALE,
  defaultsFor,
  type DashboardField,
  type FieldKind,
} from "@/lib/dashboard/field";
import { firstFreeSlot, type GridItem } from "@/lib/dashboard/grid";
import { useMediaQuery } from "@/lib/use-media-query";
import { createField, updateFieldLayout, updateDashboard } from "@/server/actions/dashboards";
import type { DashboardDetail } from "@/server/queries/dashboards";

import { AddField } from "./add-field";
import { FieldGrid } from "./field-grid";
import { useInvalidateDashboards } from "./use-dashboards";

/** A field drawn before its insert has returned, with the count that retires it. */
type PendingField = { countWhenAdded: number; field: DashboardField; parentId: string | null };

/**
 * One dashboard, as a free-form grid.
 *
 * Fields are placed and sized in grid units — never pixels — which is what lets
 * the same layout render at any width and collapse to a readable column on a
 * phone. The arithmetic lives in `lib/dashboard/grid.ts` and the pointer handling
 * in `field-grid.tsx`; this file owns the header, the writes, and the optimistic
 * bookkeeping around them.
 */
export function DashboardView({ dashboard, now }: { dashboard: DashboardDetail; now: Date }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateDashboards();
  const [name, setName] = useState(dashboard.name);
  /**
   * The icon drawn while a write is in flight.
   *
   * Held as an override rather than mirrored from props, so there is no effect
   * copying the server value into state — the shape the compiler lint rejects.
   * `undefined` means "no pending change, show what the server sent"; `null` is
   * a real value meaning the user removed the icon.
   */
  const [pendingEmoji, setPendingEmoji] = useState<string | null | undefined>(undefined);
  const [pickingEmoji, setPickingEmoji] = useState(false);

  // The server has caught up — stop overriding it.
  if (pendingEmoji !== undefined && pendingEmoji === dashboard.emoji) setPendingEmoji(undefined);
  const emoji = pendingEmoji === undefined ? dashboard.emoji : pendingEmoji;

  /** Fields drawn before the insert has come back. See `handleAdd`. */
  const [adding, setAdding] = useState<PendingField[]>([]);

  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== nameInput.current) setName(dashboard.name);
  }, [dashboard.name]);

  // Free-form placement is a desktop affordance. A phone gets one ordered
  // column, which is how the eye reads it anyway.
  const narrow = !useMediaQuery("(min-width: 640px)", true);

  /**
   * Fields as drawn, with anything still being inserted mixed in.
   *
   * A pending child is spliced into its group's `children` rather than appended
   * at the top level — otherwise clicking "Add to group" would show the new field
   * outside the box it was added to until the server came back.
   */
  const stillPending = adding.filter((entry) => dashboard.fields.length <= entry.countWhenAdded);
  const fields = (() => {
    const topLevel = stillPending.filter((entry) => entry.parentId === null);
    const nested = stillPending.filter((entry) => entry.parentId !== null);

    const withChildren = dashboard.fields.map((field) => {
      const mine = nested.filter((entry) => entry.parentId === field.id);
      if (mine.length === 0 || field.kind !== "group") return field;
      return { ...field, children: [...field.children, ...mine.map((entry) => entry.field)] };
    });

    return [...withChildren, ...topLevel.map((entry) => entry.field)];
  })();

  /**
   * Adds a field to a surface — the dashboard itself, or one group inside it.
   *
   * The field is drawn before the insert is sent, and removed again if it fails.
   * `parentId` decides which grid it lands on and which existing boxes it has to
   * avoid, so the first field in an empty group starts at its origin rather than
   * below the dashboard's other rows.
   */
  const handleAdd = (kind: FieldKind, parentId: string | null = null) => {
    const { config, value } = defaultsFor(kind);
    const id = `pending:${crypto.randomUUID()}`;

    const siblings =
      parentId === null ? fields : (fields.find((field) => field.id === parentId)?.children ?? []);

    const isGroup = kind === "group";
    const w = isGroup ? DEFAULT_GROUP_W : DEFAULT_FIELD_W;
    const h = isGroup ? DEFAULT_GROUP_H : DEFAULT_FIELD_H;
    const slot = firstFreeSlot(
      siblings.map((field) => ({ id: field.id, x: field.x, y: field.y, w: field.w, h: field.h })),
      w,
      h,
    );

    const entry: PendingField = {
      countWhenAdded: dashboard.fields.length + adding.length,
      parentId,
      field: {
        id,
        label: "",
        kind,
        config,
        value,
        position: siblings.length,
        parentId,
        children: [],
        scale: DEFAULT_SCALE,
        ...slot,
        w,
        h,
      } as DashboardField,
    };

    setAdding((current) => [...current, entry]);

    // Fired without awaiting: the field is already on screen, so a round trip
    // between the click and the first sight of it buys nothing.
    void createField({ dashboardId: dashboard.id, kind, parentId })
      .then(() => {
        invalidate();
        router.refresh();
        setAdding((current) => current.filter((pending) => pending.field.id !== id));
      })
      .catch(() => {
        setAdding((current) => current.filter((pending) => pending.field.id !== id));
        toast("Could not add that field.");
      });
  };

  /**
   * Persists one surface's boxes.
   *
   * The same call for the dashboard and for a group: `updateFieldLayout` matches
   * on field id, so a group's children are addressed exactly like top-level
   * fields and nothing needs to know which grid a box came from. A failure asks
   * the server for the truth rather than restoring a local snapshot — the draft
   * lives inside `FieldGrid`, and it retires itself as soon as the refreshed
   * rows disagree with it.
   */
  const save = (next: GridItem[]) => {
    void updateFieldLayout({
      dashboardId: dashboard.id,
      layout: next.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    })
      .then(() => {
        invalidate();
        router.refresh();
      })
      .catch(() => {
        router.refresh();
        toast("Could not save the layout.");
      });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      {/* Smaller than the 78px icon on a page: a dashboard opens straight into a
          grid of fields, so the header has to stay out of the way of the thing
          the page is actually for. */}
      <div className="relative mb-2 w-fit">
        <button
          type="button"
          onClick={() => setPickingEmoji((open) => !open)}
          aria-label="Change dashboard icon"
          className="hover:bg-surface-raised rounded-lg p-1 text-4xl leading-none transition-colors"
        >
          {emoji ?? "📊"}
        </button>
        {pickingEmoji ? (
          <EmojiPicker
            onSelect={(selected) => {
              setPendingEmoji(selected);
              setPickingEmoji(false);
              void updateDashboard({ id: dashboard.id, emoji: selected })
                .then(invalidate)
                .catch(() => {
                  setPendingEmoji(undefined);
                  router.refresh();
                  toast("Could not change the icon.");
                });
            }}
            onClose={() => setPickingEmoji(false)}
          />
        ) : null}
      </div>

      <input
        ref={nameInput}
        value={name}
        placeholder="Untitled dashboard"
        aria-label="Dashboard name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name === dashboard.name) return;
          const previous = dashboard.name;
          void updateDashboard({ id: dashboard.id, name })
            .then(invalidate)
            .catch(() => {
              setName(previous);
              router.refresh();
              toast("Could not rename the dashboard.");
            });
        }}
        className="text-ink placeholder:text-ink-faint w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
      />

      <div className="mt-5">
        <FieldGrid
          fields={fields}
          now={now}
          narrow={narrow}
          onSave={save}
          onAddToGroup={(groupId, kind) => handleAdd(kind, groupId)}
          onSaveChildren={(_groupId, layout) => save(layout)}
        />
      </div>

      {/* Not disabled while a field is in flight: each click already draws its
          own field, so several can be added without waiting between them. */}
      <div className="mt-3">
        <AddField onPick={(kind) => handleAdd(kind)} />
      </div>

      {fields.length === 0 ? (
        <p className="text-ink-faint mt-6 text-center text-sm">
          Nothing tracked yet. Add a field and pick what kind of thing it is.
        </p>
      ) : null}
    </div>
  );
}
