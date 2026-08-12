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
  useSyncExternalStore,
  useTransition,
} from "react";

import { signOut } from "@/server/actions/auth";
import { createDashboard, deleteDashboard } from "@/server/actions/dashboards";
import { createPage, deletePage } from "@/server/actions/pages";
import { preloadEditor } from "@/components/editor/lazy-block-editor";
import { StatusWindow } from "@/components/status/status-window";
import { useToast } from "@/components/shell/toast";
import { readSidebarCollapsed, setSidebarCollapsed, subscribeSidebar } from "@/lib/sidebar";
import { closeTab } from "@/lib/tabs";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { TabBar } from "./tab-bar";
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

/** A panel beside a page — the same glyph both directions, so the button reads
 *  as one control being toggled rather than two that appear and vanish. */
function SidebarIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6.5 3v10" />
    </svg>
  );
}

export type SidebarPage = { id: string; title: string; emoji: string | null };
export type SidebarDashboard = { id: string; name: string; emoji: string | null };

export function AppShell({
  email,
  todayParam,
  pages,
  dashboards,
  children,
}: {
  email: string;
  todayParam: string;
  pages: SidebarPage[];
  dashboards: SidebarDashboard[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => setOpen(true), []);
  const panel = useRef<HTMLDivElement>(null);
  // `false` on the server, so the sidebar renders open and collapses on hydration
  // if that is what was stored. The other way round flashes a full-width page.
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebarCollapsed, () => false);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Fetch the editor chunk once the app has settled. It is large and loaded
  // lazily, so without this the first document of a session waits for it *after*
  // everything else has finished — the one open that feels slow no matter how
  // fast the query was. Deferred to idle so it never competes with the first
  // paint, and behind a timeout for Safari, which has no `requestIdleCallback`.
  useEffect(() => {
    const idle = window.requestIdleCallback;
    if (idle) {
      const handle = idle(() => preloadEditor(), { timeout: 3000 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(preloadEditor, 1500);
    return () => window.clearTimeout(handle);
  }, []);

  return (
    <OpenSidebar.Provider value={openMenu}>
      <div className="flex flex-1 overflow-hidden">
        {collapsed ? (
          // The way back. Sized and placed to match the sidebar's own collapse
          // button, so the control does not appear to move when it is used.
          <div className="hidden shrink-0 flex-col p-2 md:flex">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Show sidebar"
              aria-expanded={false}
              title="Show sidebar"
              className="text-ink-muted hover:text-ink hover:bg-surface-raised rounded-md p-1.5 transition-colors"
            >
              <SidebarIcon />
            </button>
          </div>
        ) : (
          <aside className="border-line hidden w-56 shrink-0 flex-col border-r md:flex">
            <Nav email={email} todayParam={todayParam} pages={pages} dashboards={dashboards} />
          </aside>
        )}

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
              <Nav
                email={email}
                todayParam={todayParam}
                pages={pages}
                dashboards={dashboards}
                onNavigate={close}
              />
            </div>
          </div>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Above the content and outside it, so switching tabs never unmounts
              the strip that did the switching. */}
          <TabBar />
          {children}
          <StatusWindow />
        </div>
      </div>
    </OpenSidebar.Provider>
  );
}

function Nav({
  email,
  todayParam,
  pages,
  dashboards,
  onNavigate,
}: {
  email: string;
  todayParam: string;
  pages: SidebarPage[];
  dashboards: SidebarDashboard[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const wide = useMediaQuery("(min-width: 640px)", true);
  const calendarHref = `/calendar/${wide ? "3day" : "day"}/${todayParam}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* The wordmark is the way home, the way every product's is. It was plain
          text before, which meant the one thing at the top of the sidebar was
          the one thing that did nothing. */}
      <div className="flex items-center gap-1">
        <Link
          href={calendarHref}
          onClick={onNavigate}
          aria-label="Timeblock — go to today"
          className="hover:bg-surface-raised -mx-1 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 transition-colors"
        >
          <span
            aria-hidden
            className="bg-ink text-surface flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[13px] font-bold"
          >
            T
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight">Timeblock</span>
        </Link>

        {/* Desktop only: the mobile drawer closes by tapping away or Escape, and
            a second, differently-shaped close would just be one more control. */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed(true)}
          aria-label="Hide sidebar"
          aria-expanded
          title="Hide sidebar"
          className="text-ink-muted hover:text-ink hover:bg-surface-raised hidden shrink-0 rounded-md p-1.5 transition-colors md:block"
        >
          <SidebarIcon />
        </button>
      </div>

      <nav className="mt-6 flex flex-col gap-0.5">
        <NavLink
          href={calendarHref}
          active={pathname.startsWith("/calendar")}
          onNavigate={onNavigate}
          icon={
            <svg
              viewBox="0 0 16 16"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden
            >
              <rect x="2" y="3" width="12" height="11" rx="2" />
              <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
            </svg>
          }
        >
          Calendar
        </NavLink>
      </nav>

      <DashboardsSection dashboards={dashboards} onNavigate={onNavigate} />
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

/**
 * The dashboards list, mirroring `PagesSection` so the sidebar has one
 * interaction vocabulary: a disclosure triangle, an inline +, right-click to
 * delete. Kept separate rather than generalised — the two differ in their
 * routes, their empty copy and their delete semantics, and a shared component
 * taking six props to paper over that would be harder to read than both.
 */
function DashboardsSection({
  dashboards,
  onNavigate,
}: {
  dashboards: SidebarDashboard[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [expanded, setExpanded] = useState(pathname.startsWith("/dashboards"));
  const [pending, startTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Hidden the moment delete is clicked; restored if the write fails. */
  const [deleted, setDeleted] = useState<string[]>([]);

  const handleCreate = (event: React.MouseEvent) => {
    event.stopPropagation();
    setExpanded(true);
    startTransition(async () => {
      try {
        const row = await createDashboard({});
        router.push(`/dashboards/${row.id}`);
        onNavigate?.();
      } catch {
        toast("Could not create the dashboard.");
      }
    });
  };

  const handleDelete = (id: string) => {
    setContextMenu(null);
    setDeleted((current) => [...current, id]);

    void deleteDashboard(id)
      .then(() => {
        // Closed on success only: this delete rolls back if the write fails, and
        // a tab discarded early could not be brought back with the row.
        closeTab(`/dashboards/${id}`);
        router.refresh();
      })
      .catch(() => {
        // Restored only on failure. On success the id stays in `deleted` until
        // the refreshed props arrive without it — clearing it here instead would
        // unhide the row for the frames between the write landing and the
        // repaint, flashing back a dashboard the user just removed.
        setDeleted((current) => current.filter((entry) => entry !== id));
        toast("Could not delete that dashboard.");
      });

    // Navigate away only from the one being deleted; the index is still valid.
    if (pathname === `/dashboards/${id}`) {
      router.push("/dashboards");
      onNavigate?.();
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  /**
   * Hidden rows are only those the server still sends. An id the refreshed list
   * has already dropped needs no hiding, so it stops being consulted — derived
   * here rather than cleared in an effect, which would both flash and trip
   * `react-hooks/set-state-in-effect`.
   */
  const visible = dashboards.filter((dashboard) => !deleted.includes(dashboard.id));

  return (
    <div className="mt-4 flex shrink-0 flex-col">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
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
          Dashboards
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={pending}
          aria-label="New dashboard"
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
          {visible.length === 0 ? (
            <p className="text-ink-faint px-2 py-1 text-xs">No dashboards yet</p>
          ) : (
            visible.map((dashboard) => {
              const active = pathname === `/dashboards/${dashboard.id}`;
              return (
                <Link
                  key={dashboard.id}
                  href={`/dashboards/${dashboard.id}`}
                  onClick={onNavigate}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ id: dashboard.id, x: event.clientX, y: event.clientY });
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-surface-raised text-ink font-medium"
                      : "text-ink-muted hover:text-ink hover:bg-surface-raised",
                  )}
                >
                  <span className="shrink-0 text-sm" aria-hidden>
                    {dashboard.emoji ?? "📊"}
                  </span>
                  <span className="min-w-0 truncate">{dashboard.name || "Untitled"}</span>
                </Link>
              );
            })
          )}
        </div>
      ) : null}

      {contextMenu ? (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => handleDelete(contextMenu.id)}
        />
      ) : null}
    </div>
  );
}

function PagesSection({ pages, onNavigate }: { pages: SidebarPage[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(pathname.startsWith("/pages"));
  const [pending, startTransition] = useTransition();
  const [contextMenu, setContextMenu] = useState<{ pageId: string; x: number; y: number } | null>(
    null,
  );

  const handleCreate = (event: React.MouseEvent) => {
    event.stopPropagation();
    startTransition(async () => {
      const row = await createPage({ title: "" });
      router.push(`/pages/${row.id}`);
      onNavigate?.();
    });
  };

  const handleContextMenu = (event: React.MouseEvent, pageId: string) => {
    event.preventDefault();
    setContextMenu({ pageId, x: event.clientX, y: event.clientY });
  };

  const handleDelete = (pageId: string) => {
    setContextMenu(null);
    void deletePage(pageId);
    // The tab outlives the page otherwise, and reopens as a 404.
    closeTab(`/pages/${pageId}`);
    if (pathname === `/pages/${pageId}`) {
      router.push("/pages");
      onNavigate?.();
    }
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

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
                  onContextMenu={(e) => handleContextMenu(e, page.id)}
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

      {contextMenu ? (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => handleDelete(contextMenu.pageId)}
        />
      ) : null}
    </div>
  );
}

function RowContextMenu({ x, y, onDelete }: { x: number; y: number; onDelete: () => void }) {
  return (
    <div
      className="bg-surface border-line fixed z-50 min-w-[140px] rounded-md border py-1 shadow-lg"
      style={{ left: x, top: y }}
      role="menu"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="text-danger hover:bg-danger-surface flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4M6.67 7.33v4M9.33 7.33v4M12.67 4v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4" />
        </svg>
        Delete
      </button>
    </div>
  );
}

function NavLink({
  href,
  active,
  onNavigate,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
  /** Occupies the same slot a dashboard's or page's emoji does, so a top-level
   *  destination lines up with the lists below it instead of hanging left. */
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-surface-raised text-ink font-medium" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon ? (
        <span className="flex size-[18px] shrink-0 items-center justify-center">{icon}</span>
      ) : null}
      {children}
    </Link>
  );
}
