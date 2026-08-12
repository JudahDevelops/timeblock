import type { ProgressTone } from "@/lib/dashboard/field";

/**
 * Colour by severity, so a bar is readable without reading the number.
 *
 * Keyed on the tone rather than the fraction: `progressTone` has already decided
 * which end is the good one, so a field counting something down lands here
 * needing no special casing. Written out in full because Tailwind only sees
 * literal class names — a template string would compile to nothing.
 *
 * Shared by the editable row and the pause-menu glance, which must agree: the
 * same field showing green in one and red in the other would be worse than
 * having no colour at all.
 */
export const TONE_FILL: Record<ProgressTone, string> = {
  low: "bg-danger",
  mid: "bg-warn",
  high: "bg-ok",
};
