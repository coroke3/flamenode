import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { softwareAliases, softwareCatalog, videoSoftwares } from "@flamenode/db/schema";
import { MAX_ATOMIC_VIDEO_SOFTWARES } from "@flamenode/domain/video/atomicLimits";
import { normalizeSoftwareCatalogName, normalizeSoftwareKey, normalizeSoftwareLabels } from "@flamenode/domain/software/labels";
import type { ServerCoreDb } from "../db.ts";
import { generateId } from "../id.ts";
import type { UnslottedVideoAtomicPlan } from "./unslottedEventPlans.ts";

/**
 * Recompute CURRENT's alias-first, active-software selection inside the same
 * D1 write batch. Every requested label must still resolve to the ID
 * observed by the preflight read (or still have no active match). Unlike
 * checking a foreign key, this prevents silent stale software links after
 * an alias retarget, deactivation, or a new alias/direct-name arrival.
 *
 * All correlated probes are backed by the canonical normalized-name and
 * normalized-alias UNIQUE indexes; <=4 labels, one JSON1 bind. The guard is
 * a SELECT that MUST execute before the first video/metadata row write.
 */
export function buildFreeVideoSoftwareSelectionGuardSql(
  expected: readonly { aliasKey: string; name: string; targetId: string | null }[],
): SQL {
  if (expected.length < 1 || expected.length > MAX_ATOMIC_VIDEO_SOFTWARES ||
      expected.some((row) =>
        !row.aliasKey || !row.name ||
        row.aliasKey !== normalizeSoftwareKey(row.name) ||
        (row.targetId !== null && !row.targetId.trim())) ||
      new Set(expected.map(row => row.aliasKey)).size !== expected.length) {
    throw new Error("free_video_software_selection_guard_arguments_invalid");
  }
  return sql`
    WITH incoming AS (
      SELECT json_extract(value, '$.aliasKey') AS alias_key,
             json_extract(value, '$.name') AS name_key,
             json_extract(value, '$.targetId') AS expected_id
      FROM json_each(${JSON.stringify(expected)})
    ),
    resolved AS (
      SELECT expected_id,
        COALESCE(
          (SELECT c.id
           FROM software_aliases a
           JOIN software_catalog c ON c.id = a.software_id
           WHERE a.normalized_alias = incoming.alias_key AND c.is_active = 1
           LIMIT 1),
          (SELECT c.id
           FROM software_catalog c
           WHERE c.normalized_name = incoming.name_key AND c.is_active = 1
           LIMIT 1)
        ) AS actual_id
      FROM incoming
    )
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM resolved WHERE actual_id IS NOT expected_id
    ) THEN 1 ELSE json_extract('not-valid-json', '
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
  // S3: one bounded SELECT resolves direct names and active alias targets.
  // Putting the joined alias's nullable column in an outer OR forces a full
  // scan of software_catalog (confirmed via SQLite EXPLAIN QUERY PLAN).
  // Instead filter catalog IDs through the indexed software_aliases subquery:
  // SQLite can use MULTI-INDEX OR on normalized_name and catalog PK.
  // Names and aliases are globally unique, so <=4 labels bound the result.
  // Alias-first wins even if the input is also a direct catalog name.
  const matching = await db.select({
    softwareId: softwareCatalog.id,
    normalizedName: softwareCatalog.normalized_name,
    normalizedAlias: softwareAliases.normalized_alias,
  }).from(softwareCatalog)
    .leftJoin(softwareAliases, and(
      eq(softwareAliases.software_id, softwareCatalog.id),
      inArray(softwareAliases.normalized_alias, aliasKeys),
    ))
    .where(and(
      eq(softwareCatalog.is_active, 1),
      or(
        inArray(softwareCatalog.normalized_name, names),
        inArray(softwareCatalog.id, db.select({
          software_id: softwareAliases.software_id,
        }).from(softwareAliases).where(
          inArray(softwareAliases.normalized_alias, aliasKeys),
        )),
      ),
    ));
  const aliasByKey = new Map(matching
    .filter((row) => row.normalizedAlias !== null)
    .map((row) => [row.normalizedAlias!, row.softwareId]));
  const catalogByName = new Map(matching.map((row) =>
    [row.normalizedName, row.softwareId]));
  const newCatalogs: (typeof softwareCatalog.$inferSelect)[] = [];
  const links: (typeof videoSoftwares.$inferSelect)[] = [];
  const seen = new Set<string>();
  const preflightSelections: Array<{ aliasKey: string; name: string; targetId: string | null }> = [];
  for (const [index, label] of labels.entries()) {
    const name = names[index];
    let softwareId = aliasByKey.get(aliasKeys[index]) ?? catalogByName.get(name);
    preflightSelections.push({
      aliasKey: aliasKeys[index], name, targetId: softwareId ?? null,
    });
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
  // The standalone software plan places this CAS first; the full video
  // composer must hoist it before ANY base video INSERT as well.
  statements.push(db.run(buildFreeVideoSoftwareSelectionGuardSql(preflightSelections)));
  expectedChanges.push(null);
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
) END
  `;
}

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
  // S3: one bounded SELECT resolves direct names and active alias targets.
  // Putting the joined alias's nullable column in an outer OR forces a full
  // scan of software_catalog (confirmed via SQLite EXPLAIN QUERY PLAN).
  // Instead filter catalog IDs through the indexed software_aliases subquery:
  // SQLite can use MULTI-INDEX OR on normalized_name and catalog PK.
  // Names and aliases are globally unique, so <=4 labels bound the result.
  // Alias-first wins even if the input is also a direct catalog name.
  const matching = await db.select({
    softwareId: softwareCatalog.id,
    normalizedName: softwareCatalog.normalized_name,
    normalizedAlias: softwareAliases.normalized_alias,
  }).from(softwareCatalog)
    .leftJoin(softwareAliases, and(
      eq(softwareAliases.software_id, softwareCatalog.id),
      inArray(softwareAliases.normalized_alias, aliasKeys),
    ))
    .where(and(
      eq(softwareCatalog.is_active, 1),
      or(
        inArray(softwareCatalog.normalized_name, names),
        inArray(softwareCatalog.id, db.select({
          software_id: softwareAliases.software_id,
        }).from(softwareAliases).where(
          inArray(softwareAliases.normalized_alias, aliasKeys),
        )),
      ),
    ));
  const aliasByKey = new Map(matching
    .filter((row) => row.normalizedAlias !== null)
    .map((row) => [row.normalizedAlias!, row.softwareId]));
  const catalogByName = new Map(matching.map((row) =>
    [row.normalizedName, row.softwareId]));
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
