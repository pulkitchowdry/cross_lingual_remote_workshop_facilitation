import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Kept intentionally minimal to match robots.ts's disallow-all: only the
// unauthenticated setup entry point is a stable, linkable URL. Facilitator
// dashboards and learner join links are per-session/token and don't belong
// in a sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${APP_URL}/setup`,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
