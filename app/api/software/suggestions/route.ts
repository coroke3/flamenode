export const runtime = "edge";

import { NextResponse } from "next/server";
import { withDatabase } from "@/lib/cloudflare";
import { softwareCatalog, softwareAliases } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

  const results = await withDatabase(async (db) => {
    if (!q) {
      return db
        .select({
          id: softwareCatalog.id,
          name: softwareCatalog.name,
          category: softwareCatalog.category,
          usage_count: softwareCatalog.usage_count,
          is_verified: softwareCatalog.is_verified,
        })
        .from(softwareCatalog)
        .where(eq(softwareCatalog.is_active, 1))
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
        .select({
          id: softwareCatalog.id,
          name: softwareCatalog.name,
          category: softwareCatalog.category,
          usage_count: softwareCatalog.usage_count,
          is_verified: softwareCatalog.is_verified,
        })
        .from(softwareCatalog)
        .where(sql`${softwareCatalog.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
        .orderBy(desc(softwareCatalog.is_verified), desc(softwareCatalog.usage_count))
        .limit(limit);
    }

    return db
      .select({
        id: softwareCatalog.id,
        name: softwareCatalog.name,
        category: softwareCatalog.category,
        usage_count: softwareCatalog.usage_count,
        is_verified: softwareCatalog.is_verified,
      })
      .from(softwareCatalog)
      .where(
        sql`${softwareCatalog.is_active} = 1 AND (
          ${softwareCatalog.name} LIKE ${"%" + q + "%"} OR
          ${softwareCatalog.normalized_name} LIKE ${"%" + normalized + "%"}
        )`,
      )
      .orderBy(
        sql`CASE WHEN ${softwareCatalog.normalized_name} LIKE ${normalized + "%"} THEN 0 WHEN ${softwareCatalog.normalized_name} LIKE ${"%" + normalized} THEN 1 ELSE 2 END`,
        desc(softwareCatalog.is_verified),
        desc(softwareCatalog.usage_count),
        softwareCatalog.name,
      )
      .limit(limit);
  });

  return NextResponse.json(results ?? []);
}
