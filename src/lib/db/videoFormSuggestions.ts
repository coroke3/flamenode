import "server-only";

import { asc, isNotNull } from "drizzle-orm";
import type { DB } from "./client";
import { videos } from "./schema";

export async function getUsedSoftwareSuggestions(
  db: DB,
  limit = 80,
): Promise<string[]> {
  const rows = await db
    .select({ used_software: videos.used_software })
    .from(videos)
    .where(isNotNull(videos.used_software))
    .groupBy(videos.used_software)
    .orderBy(asc(videos.used_software))
    .limit(limit);

  return rows
    .map((row) => row.used_software?.trim())
    .filter((value): value is string => Boolean(value));
}
