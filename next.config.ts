import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * The client router cache defaults to 0s for dynamic routes, so stepping
     * back to a week you just looked at refetches it from the server. A window
     * here makes prev/next/today paging and tab switching instant; mutations
     * still call `revalidatePath`, so an edited day is never served stale.
     *
     * Ninety seconds rather than thirty because documents change far less often
     * than a calendar day does, and the tab strip means the same few are
     * revisited constantly within a single work session.
     */
    staleTimes: { dynamic: 90 },
  },
};

export default nextConfig;
