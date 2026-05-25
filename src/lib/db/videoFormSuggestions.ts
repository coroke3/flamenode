import "server-only";

import { asc } from "drizzle-orm";
import type { DB } from "./client";
import { softwareAliases, softwareCatalog } from "./schema";

export async function getUsedSoftwareSuggestions(
  db: DB,
  limit = 80,
): Promise<string[]> {
  const catalogRows = await db
    .select({ label: softwareCatalog.name })
    .from(softwareCatalog)
    .orderBy(asc(softwareCatalog.name))
    .limit(limit);
  if (catalogRows.length >= limit) return catalogRows.map((row) => row.label);

  const aliasRows = await db
    .select({ label: softwareAliases.alias })
    .from(softwareAliases)
    .orderBy(asc(softwareAliases.alias))
    .limit(limit - catalogRows.length);
  return Array.from(
    new Set([
      ...catalogRows.map((row) => row.label),
      ...aliasRows.map((row) => row.label),
    ]),
  );
}
