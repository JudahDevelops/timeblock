"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { signOut } from "@/server/actions/auth";
import { createPage } from "@/server/actions/pages";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

/**
 * Lets the toolbar open the drawer without the layout reaching into the page.
 *
 * The trigger has to sit *inside* the toolbar row — a phone screen showing a
 * calendar cannot spare a second bar just to hold a hamburger — but the toolbar
 * is rendered by the page, two trees away from the state. A no-op default keeps
 * the button harmless if it is ever rendered outside this shell.
 */
const OpenSidebar = createContext<() => void>(() => {});

export function SidebarTrigger() {
  const open = useContext(OpenSidebar);

  return (
    <button
      type="button"
      onClick={open}
      aria-label="Open menu"
      className="hover:bg-surface-sunken -ml-1 shrink-0 rounded-md p-1.5 transition-colors md:hidden"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    </button>
  );
}

export type SidebarPage = { id: string; title: string; emoji: string | null };

export function AppShell({
  email,
  todayParam,
  pages,
  children,
}: {
  email: string;
  /** `yyyy-MM-dd` for today, resolved on the server so rendering stays pure. */
  todayParam: string;
  pages: SidebarPage[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => setOpen(true), []);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <OpenSidebar.Provider value={openMenu}>
      <div className="flex flex-1 overflow-hidden">
        <aside className="border-line hidden w-56 shrink-0 flex-col border-r p-4 md:flex">
          <Nav email={email} todayParam={todayParam} pages={pages} />
        </aside>

        {open ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-black/40"
              onClick={close}
            />
            <div
              ref={panel}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Menu"
              className="bg-surface border-line absolute inset-y-0 left-0 flex w-64 animate-[slide-in-left_160ms_ease-out] flex-col border-r p-4 outline-none"
            >
              <Nav email={email} todayParam={todayParam} pages={pages} onNavigate={close} />
            </div>
          </div>
        ) : null}

        {/* `min-h-0` is load-bearing: without it a flex child refuses to shrink
            below its content height, so the grid's inner scroll never engages. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </OpenSidebar.Provider>
  );
}

/**
 * The same rail in both places, stacked from the top.
 *
 * It used to push the theme toggle and sign-out to the bottom edge with
 * `justify-between`, which read as two unrelated menus on a tall screen. One
 * column, rules between groups, and nothing floating a viewport away.
 */
function Nav({
  email,
  todayParam,
  pages,
  onNavigate,
}: {
  email: string;
  todayParam: string;
  pages: SidebarPage[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const wide = useMediaQuery("(min-width: 640px)", true);
  const calendarHref = `/calendar/${wide ? "3day" : "day"}/${todayParam}`;

  return (
    <>
      <span className="px-2 text-sm font-semibold tracking-tight">Timeblock</span>

      <nav className="mt-6 flex flex-col gap-0.5">
        <NavLink
          href={calendarHref}
          active={pathname.startsWith("/calendar")}
          onNavigate={onNavigate}
        >
          Calendar
        </NavLink>
        <NavLink
          href="/settings/integrations"
          active={pathname.startsWith("/settings")}
          onNavigate={onNavigate}
        >
          Integrations
        </NavLink>
      </nav>

      <PagesSection pages={pages} onNavigate={onNavigate} />

      <div className="border-line mt-6 border-t pt-6">
        <ThemeToggle />
      </div>

      <div className="border-line mt-6 space-y-2 border-t pt-6">
        <p className="text-ink-muted truncate px-2 text-xs" title={email}>
          {email}
        </p>
        <form action={signOut}>
          <button
            type="submit"
            className="text-ink-muted hover:text-ink px-2 text-xs underline-offset-4 transition-colors hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}

function PagesSection({ pages, onNavigate }: { pages: SidebarPage[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(pathname.startsWith("/pages"));
  const [pending, startTransition] = useTransition();

  const handleCreate = (event: React.MouseEvent) => {
    event.stopPropagation();
    startTransition(async () => {
      const row = await createPage({ title: "" });
      router.push(`/pages/${row.id}`);
      onNavigate?.();
    });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-ink-muted hover:text-ink flex flex-1 items-center gap-1 px-2 py-1 text-xs font-medium tracking-wider uppercase transition-colors"
        >
          <svg
            viewBox="0 0 16 16"
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          Pages
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          aria-label="New page"
          className="text-ink-muted hover:text-ink hover:bg-surface-raised rounded p-1 transition-colors disabled:opacity-50"
        >
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>

      {expanded ? (
        <div className="mt-1 flex flex-col gap-0.5">
          {pages.length === 0 ? (
            <p className="text-ink-faint px-2 py-1 text-xs">No pages yet</p>
          ) : (
            pages.map((page) => {
              const active = pathname === `/pages/${page.id}`;
              return (
                <Link
                  key={page.id}
                  href={`/pages/${page.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-surface-raised text-ink font-medium"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  <span className="shrink-0 text-sm" aria-hidden>
                    {page.emoji ?? "📄"}
                  </span>
                  <span className="min-w-0 truncate">{page.title || "Untitled"}</span>
                </Link>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

function NavLink({
  href,
  active,
  onNavigate,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Closing on click rather than on a pathname effect: the drawer should
      // shut when the user chooses something, including a link back to the page
      // they are already on, which a route change would never report.
      onClick={onNavigate}
      className={cn(
        "rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-surface-raised text-ink font-medium" : "text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
