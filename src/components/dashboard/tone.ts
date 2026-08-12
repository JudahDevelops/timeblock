import type { ProgressTone, ValueScale } from "@/lib/dashboard/field";

/**
 * Presentation lookups shared by the editable field and the pause-menu glance.
 *
 * Both maps are written out in full because Tailwind only sees literal class
 * names — a template string like `text-${size}` compiles to nothing at all.
 * Shared rather than duplicated because the two surfaces must agree: the same
 * field showing green in one and red in the other, or huge in one and small in
 * the other, would be worse than having neither feature.
 */

/**
 * Colour by severity, so a bar is readable without reading the number.
 *
 * Keyed on the tone rather than the fraction: `progressTone` has already decided
 * which end is the good one, so a field counting something down lands here
 * needing no special casing.
 */
export const TONE_FILL: Record<ProgressTone, string> = {
  low: "bg-danger",
  mid: "bg-warn",
  high: "bg-ok",
};

/** How large a value is drawn. `xl` is deliberately a jump — it is a headline. */
export const SCALE_TEXT: Record<ValueScale, string> = {
  s: "text-sm",
  m: "text-lg",
  l: "text-2xl",
  xl: "text-4xl",
};

/** The same steps one notch down, for text that wraps rather than reading as a figure. */
export const SCALE_TEXT_SOFT: Record<ValueScale, string> = {
  s: "text-xs",
  m: "text-base",
  l: "text-xl",
  xl: "text-3xl",
};

/** The box grows with its label — a huge "Done" beside a tiny tickbox reads as a mistake. */
export const CHECKBOX_SIZE: Record<ValueScale, string> = {
  s: "size-3.5",
  m: "size-4",
  l: "size-5",
  xl: "size-6",
};
