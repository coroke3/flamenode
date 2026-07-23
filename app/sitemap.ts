
import type { MetadataRoute } from "next";
import {
  buildStaticSitemapEntries,
  buildStaticSitemapStaticEntries,
} from "@/lib/publicData/sitemapSources";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dynamicEntries = await buildStaticSitemapEntries();
  return [...buildStaticSitemapStaticEntries(), ...dynamicEntries];
}
