"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { useToast } from "@/components/shell/toast";
import type { FieldKind } from "@/lib/dashboard/field";
import { createField, reorderFields, updateDashboard } from "@/server/actions/dashboards";
import type { DashboardDetail } from "@/server/queries/dashboards";

import { AddField } from "./add-field";
import { FieldRow } from "./field-row";
import { useInvalidateDashboards } from "./use-dashboards";

/**
 * One dashboard, as an ordered column of fields.
 *
 * Phase 2a deliberately renders a single column rather than the free-form grid:
 * the field types are the thing that needs validating first, and a layout engine
 * is the part most likely to change once the types have been lived with. The
 * `grid_*` columns are already stored, so that upgrade is a rendering change.
 */
export function DashboardView({ dashboard, now }: { dashboard: DashboardDetail; now: Date }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidateDashboards();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(dashboard.name);

  /**
   * The dragged order, held locally while a finger or cursor is down.
   *
   * The list is drawn from this the moment it changes and the write is fired
   * without awaiting, matching how every grid mutation works — a reorder that
   * waited for Supabase would lag a drag by a third of a second.
   */
  const [order, setOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== nameInput.current) setName(dashboard.name);
  }, [dashboard.name]);

  /**
   * The list as drawn: the dragged order if it still describes these fields,
   * otherwise the server's.
   *
   * Derived rather than reconciled in an effect. A local order that has been
   * overtaken — the write landed, or a field was added or removed elsewhere —
   * simply stops matching and the server's order takes over on the next render,
   * with no `setState` in an effect to trigger a cascading one.
   */
  const fields = (() => {
    if (!order) return dashboard.fields;

    const found = order
      .map((id) => dashboard.fields.find((field) => field.id === id))
      .filter((field): field is (typeof dashboard.fields)[number] => field !== undefined);

    return found.length === dashboard.fields.length ? found : dashboard.fields;
  })();

  const handleAdd = (kind: FieldKind) => {
    startTransition(async () => {
      try {
        await createField({ dashboardId: dashboard.id, kind });
        invalidate();
        router.refresh();
      } catch {
        toast("Could not add that field.");
      }
    });
  };

  const startDrag = (id: string, event: React.PointerEvent) => {
    event.preventDefault();
    setDraggingId(id);

    const ids = fields.map((field) => field.id);
    const rows = Array.from(
      event.currentTarget.closest("ul")?.querySelectorAll("li[data-field-id]") ?? [],
    ) as HTMLElement[];

    let next = ids;

    const onMove = (move: PointerEvent) => {
      // Which row the pointer is over, by midpoint — the same "nearest slot"
      // rule the grid uses, and it means no drop targets are needed.
      const target = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return move.clientY < box.top + box.height / 2;
      });

      const from = next.indexOf(id);
      const to = target === -1 ? next.length - 1 : Math.max(0, target);
      if (from === to) return;

      const reordered = [...next];
      reordered.splice(from, 1);
      reordered.splice(to, 0, id);
      next = reordered;
      setOrder(reordered);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDraggingId(null);

      if (sameOrder(next, ids)) return;

      const previous = ids;
      void reorderFields({ dashboardId: dashboard.id, orderedIds: next })
        .then(invalidate)
        .catch(() => {
          setOrder(previous);
          router.refresh();
          toast("Could not save the new order.");
        });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
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

      <ul className="mt-5 space-y-2">
        {fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            now={now}
            dragging={draggingId === field.id}
            onDragStart={(event) => startDrag(field.id, event)}
          />
        ))}
      </ul>

      <div className="mt-3">
        <AddField onPick={handleAdd} pending={pending} />
      </div>

      {fields.length === 0 ? (
        <p className="text-ink-faint mt-6 text-center text-sm">
          Nothing tracked yet. Add a field and pick what kind of thing it is.
        </p>
      ) : null}
    </div>
  );
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
