
import { withDatabase } from "@/lib/cloudflare";
import { softwareCatalog, softwareAliases } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  type PublicSoftwareSuggestionDto,
  assertNoForbiddenKeys,
  toPublicSoftwareSuggestionDto,
} from "@/lib/api/publicDto";
import {
  checkPublicApiRateLimit,
  parseBoundedPositiveInt,
  publicJsonResponse,
  publicServiceUnavailableResponse,
} from "@/lib/api/publicApi";

const DEFAULT_SOFTWARE_SUGGESTION_LIMIT = 20;
const MAX_QUERY_LENGTH = 64;

const softwareSuggestionSelection = {
  id: softwareCatalog.id,
  name: softwareCatalog.name,
  category: softwareCatalog.category,
  usage_count: softwareCatalog.usage_count,
  is_verified: softwareCatalog.is_verified,
  is_active: softwareCatalog.is_active,
};

type SoftwareSuggestionRow = {
  id: string;
  name: string;
  category: string | null;
  usage_count: number;
  is_verified: number;
  is_active: number;
};

export async function GET(req: Request): Promise<Response> {
  const limited = checkPublicApiRateLimit(req, "/api/software/suggestions");
  if (limited) return limited;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q")?.trim() ?? "").slice(
    0,
    MAX_QUERY_LENGTH,
  );
  const limit = parseBoundedPositiveInt(
    url.searchParams.get("limit"),
    DEFAULT_SOFTWARE_SUGGESTION_LIMIT,
    MAX_PUBLIC_SOFTWARE_SUGGESTION_LIMIT,
  );
  const activeSoftware = eq(softwareCatalog.is_active, 1);

  let results: SoftwareSuggestionRow[] | null;
  try {
    results = await withDatabase<SoftwareSuggestionRow[]>(async (db) => {
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
  } catch (error) {
    console.error("[software-suggestions] query failed", error);
    return publicServiceUnavailableResponse("database_unavailable");
  }

  if (!results) {
    return publicServiceUnavailableResponse("database_unavailable");
  }

  const payload: PublicSoftwareSuggestionDto[] = results
    .map(toPublicSoftwareSuggestionDto)
    .filter((row): row is PublicSoftwareSuggestionDto => row !== null);
  assertNoForbiddenKeys(payload);
  return publicJsonResponse(
    req,
    payload,
    "public, max-age=60, s-maxage=120, stale-while-revalidate=300",
  );
}
