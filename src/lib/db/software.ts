import "server-only";

import { asc, eq } from "drizzle-orm";
import type { DB } from "./client";
import {
  softwareAliases,
  softwareCatalog,
  videoSoftwares,
} from "./schema";
import { generateId } from "@/lib/utils/id";

function normalizeSoftwareName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function parseSoftwareLabels(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\n,;、，]+/)
        .map((label) => label.trim().replace(/\s+/g, " "))
        .filter(Boolean)
        .slice(0, 20),
    ),
  );
}

async function resolveSoftwareId(db: DB, label: string): Promise<string> {
  const normalized = normalizeSoftwareName(label);
  const alias = (
    await db
      .select({ software_id: softwareAliases.software_id })
      .from(softwareAliases)
      .where(eq(softwareAliases.normalized_alias, normalized))
      .limit(1)
  )[0];
  if (alias) return alias.software_id;

  const existing = (
    await db
      .select({ id: softwareCatalog.id })
      .from(softwareCatalog)
      .where(eq(softwareCatalog.normalized_name, normalized))
      .limit(1)
  )[0];
  if (existing) return existing.id;

  const id = generateId("sw");
  try {
    await db.insert(softwareCatalog).values({
      id,
      name: label,
      normalized_name: normalized,
    });
    return id;
  } catch {
    const raced = (
      await db
        .select({ id: softwareCatalog.id })
        .from(softwareCatalog)
        .where(eq(softwareCatalog.normalized_name, normalized))
        .limit(1)
    )[0];
    if (raced) return raced.id;
    throw new Error(`software_catalog insert failed: ${label}`);
  }
}

export async function replaceVideoSoftwareLabels(
  db: DB,
  videoId: string,
  raw: string | null | undefined,
): Promise<void> {
  const labels = parseSoftwareLabels(raw);
  await db.delete(videoSoftwares).where(eq(videoSoftwares.video_id, videoId));
  let orderIndex = 0;
  const seenSoftwareIds = new Set<string>();
  for (const label of labels) {
    const softwareId = await resolveSoftwareId(db, label);
    if (seenSoftwareIds.has(softwareId)) continue;
    seenSoftwareIds.add(softwareId);
    await db.insert(videoSoftwares).values({
      video_id: videoId,
      software_id: softwareId,
      raw_label: label,
      order_index: orderIndex,
    });
    orderIndex += 1;
  }
}

export async function getVideoSoftwareLabels(
  db: DB,
  videoId: string,
): Promise<string[]> {
  const rows = await db
    .select({
      raw_label: videoSoftwares.raw_label,
      catalog_name: softwareCatalog.name,
    })
    .from(videoSoftwares)
    .leftJoin(softwareCatalog, eq(softwareCatalog.id, videoSoftwares.software_id))
    .where(eq(videoSoftwares.video_id, videoId))
    .orderBy(asc(videoSoftwares.order_index));
  return rows
    .map((row) => row.raw_label || row.catalog_name)
    .filter((label): label is string => Boolean(label));
}

export async function getVideoSoftwareLabel(
  db: DB,
  videoId: string,
): Promise<string | null> {
  const labels = await getVideoSoftwareLabels(db, videoId);
  return labels.length > 0 ? labels.join(", ") : null;
}
