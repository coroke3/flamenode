import { and, eq, inArray } from "drizzle-orm";
import { softwareAliases, softwareCatalog, videoSoftwares } from "@flamenode/db/schema";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@flamenode/domain/video/atomicLimits";
import { normalizeSoftwareCatalogName, normalizeSoftwareKey, normalizeSoftwareLabels } from "@flamenode/domain/software/labels";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * MIG-0651 SA-086 U02 UNMOUNTED: bounded new-video software INSERT plan.
 * Mirrors CURRENT alias-first resolution and active catalog lookup. Unlike
 * update, creation has no pre-existing video_softwares rows to delete.
 * Caller MUST append all statements/audits to the video INSERT in ONE
 * mutateWithAudit batch and include the actual 0..3 pre-read D1 queries in
 * the S3 budget. Never execute a statement or trust client-owned snapshots.
 * A concurrent new normalized catalog name violates the canonical UNIQUE
 * index and fails the whole transaction rather than creating an orphan.
 */
export async function buildFreeVideoSoftwareInsertPlan(
  db: ServerCoreDb,
  args: { videoId: string; actorUserId: string; raw: string | null | undefined; now: number },
): Promise<UnslottedVideoAtomicPlan> {
  const { videoId, actorUserId, now } = args;
  if (!videoId || !actorUserId || !Number.isSafeInteger(now) || now < 0) {
    throw new Error("free_video_software_arguments_invalid");
  }
  const labels = normalizeSoftwareLabels(args.raw);
  if (labels.length > MAX_ATOMIC_VIDEO_SOFTWARES) {
    throw new Error("video_software_atomic_limit_exceeded");
  }
  if (labels.length === 0) return { statements: [], expectedChanges: [], audits: [] };

  const aliasKeys = labels.map(normalizeSoftwareKey);
  const names = labels.map(normalizeSoftwareCatalogName);
  const aliases = await db.select().from(softwareAliases)
    .where(inArray(softwareAliases.normalized_alias, aliasKeys));
  const direct = await db.select().from(softwareCatalog)
    .where(and(eq(softwareCatalog.is_active, 1),
      inArray(softwareCatalog.normalized_name, names))!);
  const aliasTargetIds = [...new Set(aliases.map((row) => row.software_id))];
  const byAlias = aliasTargetIds.length === 0 ? []
    : await db.select().from(softwareCatalog)
      .where(and(eq(softwareCatalog.is_active, 1),
        inArray(softwareCatalog.id, aliasTargetIds))!);
  const catalogs = [...direct, ...byAlias.filter((row) =>
    !direct.some((candidate) => candidate.id === row.id))];
  const activeCatalogIds = new Set(catalogs.map((row) => row.id));
  const aliasByKey = new Map(aliases
    .filter((row) => activeCatalogIds.has(row.software_id))
    .map((row) => [row.normalized_alias, row.software_id]));
  const catalogByName = new Map(catalogs.map((row) => [row.normalized_name, row.id]));
  const newCatalogs: (typeof softwareCatalog.$inferSelect)[] = [];
  const links: (typeof videoSoftwares.$inferSelect)[] = [];
  const seen = new Set<string>();
  for (const [index, label] of labels.entries()) {
    const name = names[index];
    let softwareId = aliasByKey.get(aliasKeys[index]) ?? catalogByName.get(name);
    if (!softwareId) {
      softwareId = generateId("sw");
      newCatalogs.push({
        id: softwareId, name: label, normalized_name: name, category: null,
        usage_count: 0, is_active: 1, is_verified: 0, created_at: now, updated_at: now,
      });
    }
    if (seen.has(softwareId)) continue;
    seen.add(softwareId);
    links.push({ video_id: videoId, software_id: softwareId, raw_label: label });
  }
  const statements: UnslottedVideoAtomicPlan["statements"] = [];
  const expectedChanges: UnslottedVideoAtomicPlan["expectedChanges"] = [];
  const audits: UnslottedVideoAtomicPlan["audits"] = [];
  if (newCatalogs.length > 0) {
    statements.push(db.insert(softwareCatalog).values(newCatalogs));
    expectedChanges.push(newCatalogs.length);
    audits.push(...newCatalogs.map((row) => ({
      table_name: "software_catalog", target_id: row.id, operation: "CREATE" as const,
      before: null, after: { ...row }, actor_user_id: actorUserId,
      context: "video-save:software-catalog", retention_class: "normal" as const, strict: true,
    })));
  }
  if (links.length > 0) {
    statements.push(db.insert(videoSoftwares).values(links));
    expectedChanges.push(links.length);
    audits.push(...links.map((row) => ({
      table_name: "video_softwares",
      target_id: [row.video_id, row.software_id].map(encodeURIComponent).join(":"),
      operation: "CREATE" as const, before: null, after: { ...row },
      actor_user_id: actorUserId, context: "video-save:software",
      retention_class: "normal" as const, strict: true,
    })));
  }
  return { statements, expectedChanges, audits };
}
