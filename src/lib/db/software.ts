import "server-only";

import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { DB } from "./client";
import { softwareAliases, softwareCatalog, videoSoftwares } from "./schema";
import { generateId } from "@/lib/utils/id";
import {
  normalizeSoftwareCatalogName,
  normalizeSoftwareKey,
  normalizeSoftwareLabels,
} from "@/lib/utils/softwareLabels";
import {
  compositeAuditTargetId,
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@/lib/video/atomicLimits";

export function parseSoftwareLabels(raw: string | null | undefined): string[] {
  return normalizeSoftwareLabels(raw);
}

export async function buildReplaceVideoSoftwarePlan(
  db: DB,
  args: {
    videoId: string;
    raw: string | null | undefined;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  const labels = parseSoftwareLabels(args.raw);
  if (labels.length > MAX_ATOMIC_VIDEO_SOFTWARES) {
    throw new Error("video_software_atomic_limit_exceeded");
  }
  const existingLinks = await db
    .select()
    .from(videoSoftwares)
    .where(eq(videoSoftwares.video_id, args.videoId))
    .limit(MAX_ATOMIC_VIDEO_SOFTWARES + 1);
  if (existingLinks.length > MAX_ATOMIC_VIDEO_SOFTWARES) {
    throw new Error("video_software_existing_atomic_limit_exceeded");
  }

  const aliasKeys = labels.map(normalizeSoftwareKey);
  const catalogNames = labels.map(normalizeSoftwareCatalogName);
  const aliases = aliasKeys.length > 0
    ? await db
        .select()
        .from(softwareAliases)
        .where(inArray(softwareAliases.normalized_alias, aliasKeys))
    : [];
  const aliasTargetIds = [...new Set(aliases.map((row) => row.software_id))];
  const catalogsByName = catalogNames.length > 0
    ? await db
        .select()
        .from(softwareCatalog)
        .where(
          and(
            eq(softwareCatalog.is_active, 1),
            inArray(softwareCatalog.normalized_name, catalogNames),
          ),
        )
    : [];
  const catalogsByAlias = aliasTargetIds.length > 0
    ? await db
        .select()
        .from(softwareCatalog)
        .where(
          and(
            eq(softwareCatalog.is_active, 1),
            inArray(softwareCatalog.id, aliasTargetIds),
          ),
        )
    : [];
  const catalogs = [
    ...catalogsByName,
    ...catalogsByAlias.filter(
      (row) => !catalogsByName.some((candidate) => candidate.id === row.id),
    ),
  ];
  const activeCatalogIds = new Set(catalogs.map((row) => row.id));
  const aliasByName = new Map(
    aliases
      .filter((row) => activeCatalogIds.has(row.software_id))
      .map((row) => [row.normalized_alias, row.software_id]),
  );
  const catalogByName = new Map(
    catalogs.map((row) => [row.normalized_name, row.id]),
  );

  const now = Math.floor(Date.now() / 1000);
  const newCatalogs: (typeof softwareCatalog.$inferSelect)[] = [];
  const nextLinks: (typeof videoSoftwares.$inferSelect)[] = [];
  const seen = new Set<string>();
  for (const [index, label] of labels.entries()) {
    const aliasKey = aliasKeys[index];
    const catalogName = catalogNames[index];
    let softwareId = aliasByName.get(aliasKey) ?? catalogByName.get(catalogName);
    if (!softwareId) {
      softwareId = generateId("sw");
      newCatalogs.push({
        id: softwareId,
        name: label,
        normalized_name: catalogName,
        category: null,
        usage_count: 0,
        is_active: 1,
        is_verified: 0,
        created_at: now,
        updated_at: now,
      });
    }
    if (seen.has(softwareId)) continue;
    seen.add(softwareId);
    nextLinks.push({
      video_id: args.videoId,
      software_id: softwareId,
      raw_label: label,
    });
  }

  const plan = emptyVideoAtomicWritePlan();
  if (existingLinks.length > 0) {
    plan.statements.push(db.delete(videoSoftwares).where(or(...existingLinks.map((row) => and(
      eq(videoSoftwares.video_id, row.video_id),
      eq(videoSoftwares.software_id, row.software_id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(existingLinks.length);
    plan.audits.push(...existingLinks.map((row) => ({
      table_name: "video_softwares",
      target_id: compositeAuditTargetId(row.video_id, row.software_id),
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:software",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (newCatalogs.length > 0) {
    plan.statements.push(db.insert(softwareCatalog).values(newCatalogs));
    plan.expectedChanges.push(newCatalogs.length);
    plan.audits.push(...newCatalogs.map((row) => ({
      table_name: "software_catalog",
      target_id: row.id,
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:software-catalog",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (nextLinks.length > 0) {
    plan.statements.push(db.insert(videoSoftwares).values(nextLinks));
    plan.expectedChanges.push(nextLinks.length);
    plan.audits.push(...nextLinks.map((row) => ({
      table_name: "video_softwares",
      target_id: compositeAuditTargetId(row.video_id, row.software_id),
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:software",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  return plan;
}

export async function getVideoSoftwareLabels(
  db: DB,
  videoId: string,
): Promise<string[]> {
  const rows = await db
    .select({ raw_label: videoSoftwares.raw_label })
    .from(videoSoftwares)
    .innerJoin(
      softwareCatalog,
      eq(softwareCatalog.id, videoSoftwares.software_id),
    )
    .where(eq(videoSoftwares.video_id, videoId))
    .orderBy(
      asc(softwareCatalog.name),
      asc(videoSoftwares.raw_label),
    );
  return rows.map((row) => row.raw_label);
}

export async function getVideoSoftwareLabel(
  db: DB,
  videoId: string,
): Promise<string | null> {
  const labels = await getVideoSoftwareLabels(db, videoId);
  return labels.length > 0 ? labels.join(", ") : null;
}
