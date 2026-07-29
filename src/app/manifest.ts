import type { MetadataRoute } from "next";

/**
 * What turns the home-screen icon into an app rather than a bookmark.
 *
 * `scope` is the load-bearing field: iOS hands any navigation outside it back
 * to Safari, chrome and all. Everything here lives under `/`, so the scope is
 * the whole origin — including `/login` and the OAuth round trip, which would
 * otherwise drop you out of the app on the way to connecting a calendar.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Timeblock",
    short_name: "Timeblock",
    description: "A calendar where every block of time is a page you work inside.",
    // `/` rather than a dated calendar URL: the date has to be resolved on the
    // server at launch, and a URL baked in here would open on the day the app
    // was installed for ever after.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
  };
}
