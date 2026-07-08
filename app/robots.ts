export const runtime = "edge";

import type { MetadataRoute } from "next";
import { absoluteUrl, getSiteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin/",
          "/manage/",
          "/dashboard/",
          "/entry",
          "/maintenance",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: site.origin,
  };
}
