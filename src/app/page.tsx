"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { toDateParam } from "@/lib/date";

/**
 * Redirects to the calendar anchored on today, picking a view that suits
 * the screen: day on handhelds (< 640px), 3day on wider screens.
 *
 * This has to be a client component because the server does not know the
 * viewport width. The redirect fires once, synchronously on mount.
 */
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const view = window.innerWidth < 640 ? "day" : "3day";
    router.replace(`/calendar/${view}/${toDateParam(new Date())}`);
  }, [router]);

  return null;
}
