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

/** IDs of pages the user has visited this session, shown as tabs. */
const OpenPagesContext = createContext<{
  openPages: string[];
  addPage: (id: string) => void;
  removePage: (id: string) => void;
}>({ openPages: [], addPage: () => {}, removePage: () => {} });

export function useOpenPages() {
  return useContext(OpenPagesContext);
}

export function AppShell({
  email,
  todayParam,
  pages,
  children,
}: {
  email: string;
  todayParam: string;
  pages: SidebarPage[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => setOpen(true), []);
  const panel = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const [openPages, setOpenPages] = useState<string[]>([]);

  // Derive the current page ID from the URL so it always appears as a tab.
  const currentPageId = pathname.startsWith("/pages/") ? pathname.split("/")[2] : null;
  const effectiveOpenPages =
    currentPageId && !openPages.includes(currentPageId) ? [...openPages, currentPageId] : openPages;

  const addPage = useCallback((id: string) => {
    setOpenPages((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const removePage = useCallback((id: string) => {
    setOpenPages((prev) => prev.filter((p) => p !== id));
  }, []);

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
      <OpenPagesContext.Provider value={{ openPages: effectiveOpenPages, addPage, removePage }}>
        <div className="flex flex-1 overflow-hidden">
          <aside className="border-line hidden w-56 shrink-0 flex-col border-r md:flex">
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
                className="bg-surface border-line absolute inset-y-0 left-0 flex w-64 animate-[slide-in-left_160ms_ease-out] flex-col border-r outline-none"
              >
                <Nav email={email} todayParam={todayParam} pages={pages} onNavigate={close} />
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TabBar pages={pages} />
            {children}
          </div>
        </div>
      </OpenPagesContext.Provider>
    </OpenSidebar.Provider>
  );
}

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
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <span className="px-2 text-sm font-semibold tracking-tight">Timeblock</span>

      <nav className="mt-6 flex flex-col gap-0.5">
        <NavLink
          href={calendarHref}
          active={pathname.startsWith("/calendar")}
          onNavigate={onNavigate}
        >
          Calendar
        </NavLink>
      </nav>

      <PagesSection pages={pages} onNavigate={onNavigate} />

      {/* Bottom section: theme, integrations, account */}
      <div className="border-line mt-auto border-t pt-4">
        <div className="px-2">
          <ThemeToggle />
        </div>

        <div className="mt-3">
          <NavLink
            href="/settings/integrations"
            active={pathname.startsWith("/settings")}
            onNavigate={onNavigate}
          >
            Integrations
          </NavLink>
        </div>

        <div className="mt-4 space-y-2">
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
      </div>
    </div>
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
    <div className="mt-4 flex min-h-0 flex-col">
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
          All Pages
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
        <div className="mt-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
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
                    "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
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

function TabBar({ pages }: { pages: SidebarPage[] }) {
  const { openPages, removePage } = useOpenPages();
  const pathname = usePathname();
  const router = useRouter();

  const tabs = pages.filter((p) => openPages.includes(p.id));
  if (tabs.length === 0) return null;

  return (
    <div className="border-line bg-surface-sunken flex shrink-0 items-center gap-0 overflow-x-auto border-b">
      {tabs.map((page) => {
        const active = pathname === `/pages/${page.id}`;
        return (
          <div
            key={page.id}
            className={cn(
              "group border-line flex max-w-[200px] items-center border-r",
              active ? "bg-surface" : "hover:bg-surface-raised",
            )}
          >
            <Link
              href={`/pages/${page.id}`}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                active ? "text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <span className="shrink-0" aria-hidden>
                {page.emoji ?? "📄"}
              </span>
              <span className="min-w-0 truncate">{page.title || "Untitled"}</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                removePage(page.id);
                if (active) {
                  const remaining = openPages.filter((id) => id !== page.id);
                  if (remaining.length > 0) {
                    router.push(`/pages/${remaining[remaining.length - 1]}`);
                  } else {
                    router.push("/pages");
                  }
                }
              }}
              aria-label={`Close ${page.title || "Untitled"}`}
              className="text-ink-faint hover:text-ink mr-1 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg
                viewBox="0 0 12 12"
                className="size-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
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
