import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Every route past "/" is either a facilitator-auth-gated dashboard or a
// single-use learner join token — there's no public content here worth a
// search engine crawling, so disallow everything rather than leaving crawlers
// to guess (and hammer session/token routes with GET requests).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
