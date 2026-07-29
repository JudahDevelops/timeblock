"use client";

import { useEffect, useSyncExternalStore } from "react";

import { applyTheme, readTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: "system", label: "System", icon: <MonitorIcon /> },
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
];

/** The server has no storage to read, and hoisting keeps the identity stable. */
const systemTheme = (): Theme => "system";

/**
 * Three states, not two.
 *
 * A plain light/dark toggle has to pick one on first load and thereby commits
 * the user to it forever; "system" is the difference between an app that
 * follows the OS into the evening and one that has to be told twice a day.
 */
export function ThemeToggle() {
  // Always "system" on the server, because the real answer lives in
  // `localStorage` and reading it during render would not survive hydration.
  // The inline head script has already applied the right palette by now, so
  // the only thing catching up here is which segment looks selected.
  const theme = useSyncExternalStore(subscribeTheme, readTheme, systemTheme);

  // On "system" the OS can still change under us — at sunset, or when the user
  // flips it in settings — and nothing else is listening for that.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyTheme("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [theme]);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="border-line flex w-fit gap-0.5 rounded-md border p-0.5"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => applyTheme(option.value)}
          className={cn(
            "rounded p-1 transition-colors",
            theme === option.value
              ? "bg-surface-raised text-ink"
              : "text-ink-faint hover:text-ink-muted",
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

/* Drawn at 14px with a 1.75 stroke to match the drawer's close button, so the
   rail does not end in three icons a shade heavier than everything above it. */
function icon(children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function MonitorIcon() {
  return icon(
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>,
  );
}

function SunIcon() {
  return icon(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  );
}

function MoonIcon() {
  return icon(<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />);
}
