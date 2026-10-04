
import type { MetadataRoute } from "next";
import {
  buildStaticSitemapEntries,
  buildStaticSitemapStaticEntries,
} from "@/lib/publicData/sitemapSources";

// ISR so the content URLs come from the R2 indexes at runtime; the build has
// no bindings and would otherwise freeze the sitemap with static pages only.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dynamicEntries = await buildStaticSitemapEntries();
  return [...buildStaticSitemapStaticEntries(), ...dynamicEntries];
}
