import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Only the pages a signed-out visitor can actually reach. Listing an authenticated route would
 * advertise a URL that answers with a redirect to /login, which is worse than not listing it.
 *
 * `lastModified` is deliberately absent rather than `new Date()`: a timestamp that changes on every
 * build tells crawlers the content changed when it didn't, and they learn to stop trusting it.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/legal/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/legal/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
