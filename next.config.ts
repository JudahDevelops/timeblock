import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * The client router cache defaults to 0s for dynamic routes, so stepping
     * back to a week you just looked at refetches it from the server. A short
     * window makes prev/next/today navigation instant; mutations still call
     * `revalidatePath`, so an edited day is never served stale.
     */
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
