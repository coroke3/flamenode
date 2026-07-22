
import { NextResponse } from "next/server";
import { withDatabase } from "@/lib/cloudflare";
import { softwareCatalog, softwareAliases } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  type PublicSoftwareSuggestionDto,
  assertNoForbiddenKeys,
  toPublicSoftwareSuggestionDto,
} from "@/lib/api/publicDto";
import { parseBoundedPositiveInt } from "@/lib/api/publicApi";

const DEFAULT_SOFTWARE_SUGGESTION_LIMIT = 20;

const softwareSuggestionSelection = {
  id: softwareCatalog.id,
  name: softwareCatalog.name,
  category: softwareCatalog.category,
  usage_count: softwareCatalog.usage_count,
  is_verified: softwareCatalog.is_verified,
  is_active: softwareCatalog.is_active,
};

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    DEFAULT_SOFTWARE_SUGGESTION_LIMIT,
    MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  );
  const activeSoftware = eq(softwareCatalog.is_active, 1);

  const results = await withDatabase(async (db) => {
    if (!q) {
      return db
        .select(softwareSuggestionSelection)
        .from(softwareCatalog)
        .where(activeSoftware)
        .orderBy(desc(softwareCatalog.is_verified), desc(softwareCatalog.usage_count), softwareCatalog.name)
        .limit(limit);
    }

    const normalized = q.toLowerCase().replace(/\s+/g, "");

    const byAlias = await db
      .select({
        software_id: softwareAliases.software_id,
      })
      .from(softwareAliases)
      .where(eq(softwareAliases.normalized_alias, normalized))
      .limit(5);

    if (byAlias.length > 0) {
      const ids = byAlias.map((r) => r.software_id);
      return db
        .select(softwareSuggestionSelection)
        .from(softwareCatalog)
        .where(and(activeSoftware, inArray(softwareCatalog.id, ids)))
        .orderBy(desc(softwareCatalog.is_verified), desc(softwareCatalog.usage_count))
        .limit(limit);
    }

    return db
      .select(softwareSuggestionSelection)
      .from(softwareCatalog)
      .where(
        and(activeSoftware, sql`(
          ${softwareCatalog.name} LIKE ${"%" + q + "%"} OR
          ${softwareCatalog.normalized_name} LIKE ${"%" + normalized + "%"}
        )`),
      )
      .orderBy(
        sql`CASE WHEN ${softwareCatalog.normalized_name} LIKE ${normalized + "%"} THEN 0 WHEN ${softwareCatalog.normalized_name} LIKE ${"%" + normalized} THEN 1 ELSE 2 END`,
        desc(softwareCatalog.is_verified),
        desc(softwareCatalog.usage_count),
        softwareCatalog.name,
      )
      .limit(limit);
  });

  const payload: PublicSoftwareSuggestionDto[] = (results ?? [])
    .map(toPublicSoftwareSuggestionDto)
    .filter((row): row is PublicSoftwareSuggestionDto => row !== null);
  assertNoForbiddenKeys(payload);
  return NextResponse.json(payload);
}
