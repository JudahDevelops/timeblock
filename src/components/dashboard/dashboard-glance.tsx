"use client";

import Link from "next/link";

import {
  formatValue,
  progressFraction,
  progressTone,
  type DashboardField,
} from "@/lib/dashboard/field";
import { cn } from "@/lib/utils";

import { SCALE_TEXT_SOFT, TONE_FILL } from "./tone";
import type { DashboardDetail } from "@/server/queries/dashboards";

/**
 * A dashboard as it appears inside the pause menu: read, not edited.
 *
 * The editing affordances are deliberately absent. A pause menu is entered, read
 * and left, and putting text inputs in it would turn a two-second glance into a
 * surface you can get stuck inside — which is the drift this whole feature exists
 * to interrupt. Editing lives one click away, and the link is always offered,
 * because naming a thing without offering the action is the documented failure of
 * the reference this menu is modelled on.
 */
export function DashboardGlance({ dashboard, now }: { dashboard: DashboardDetail; now: Date }) {
  if (dashboard.fields.length === 0) {
    return (
      <div className="px-5 py-8 text-center">
        <p className="text-ink-muted text-sm">Nothing tracked on this dashboard yet.</p>
        <Link
          href={`/dashboards/${dashboard.id}`}
          className="text-accent mt-2 inline-block text-sm underline underline-offset-4"
        >
          Add a field
        </Link>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <dl className="space-y-3">
        {dashboard.fields.map((field) => (
          <GlanceRow key={field.id} field={field} now={now} />
        ))}
      </dl>

      <Link
        href={`/dashboards/${dashboard.id}`}
        className="text-ink-faint hover:text-ink mt-4 inline-block text-xs underline underline-offset-4 transition-colors"
      >
        Edit dashboard
      </Link>
    </div>
  );
}

function GlanceRow({ field, now }: { field: DashboardField; now: Date }) {
  if (field.kind === "progress") {
    const fraction = progressFraction(field);
    const tone = progressTone(fraction, field.config.invert);

    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink truncate text-sm font-semibold tracking-tight">
            {field.label || "Untitled"}
          </dt>
          <dd
            className={cn(
              "text-ink-muted shrink-0 tabular-nums",
              SCALE_TEXT_SOFT[field.scale === "xl" ? "l" : field.scale],
            )}
          >
            {formatValue(field, now)}
          </dd>
        </div>
        <div className="bg-surface-sunken mt-1.5 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={cn("h-full rounded-full", TONE_FILL[tone])}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink truncate text-sm font-semibold tracking-tight">
        {field.label || "Untitled"}
      </dt>
      {/* The glance caps at `l`: this is the 2-second surface, and an `xl` field
          set on the dashboard would push everything else off it. */}
      <dd
        className={cn(
          "text-ink-muted min-w-0 shrink-0 truncate tabular-nums",
          SCALE_TEXT_SOFT[field.scale === "xl" ? "l" : field.scale],
        )}
      >
        {formatValue(field, now)}
      </dd>
    </div>
  );
}
