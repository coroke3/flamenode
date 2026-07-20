import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogs, events, videos } from "@/lib/db/schema";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize";

const LEGACY_IMPORT_SYSTEM_USER_ID = "system_legacy_import";
const MAX_IDS_PER_QUERY = 80;

function chunks<T>(values: readonly T[], size = MAX_IDS_PER_QUERY): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    out.push(values.slice(index, index + size));
  }
  return out;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => !!value))];
}

async function existingEventIds(db: DB, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const group of chunks(ids)) {
    const rows = await db.select({ id: events.id }).from(events).where(inArray(events.id, group));
    rows.forEach((row) => found.add(row.id));
  }
  return found;
}

async function existingVideoRows(
  db: DB,
  ids: readonly string[],
): Promise<Map<string, { id: string; submittedBy: string | null; youtubeVideoId: string | null }>> {
  const found = new Map<string, { id: string; submittedBy: string | null; youtubeVideoId: string | null }>();
  for (const group of chunks(ids)) {
    const rows = await db
      .select({
        id: videos.id,
        submittedBy: videos.submitted_by_user_id,
        youtubeVideoId: videos.youtube_video_id,
      })
      .from(videos)
      .where(inArray(videos.id, group));
    rows.forEach((row) => found.set(row.id, row));
  }
  return found;
}

async function importedEventIds(db: DB, ids: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const group of chunks(ids)) {
    const rows = await db
      .select({ targetId: auditLogs.target_id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.table_name, "events"),
          eq(auditLogs.context, "legacy_import"),
          inArray(auditLogs.target_id, group),
        ),
      );
    rows.forEach((row) => found.add(row.targetId));
  }
  return found;
}

async function youtubeOwners(
  db: DB,
  youtubeIds: readonly string[],
): Promise<Array<{ id: string; youtubeVideoId: string | null }>> {
  const rows: Array<{ id: string; youtubeVideoId: string | null }> = [];
  for (const group of chunks(youtubeIds)) {
    rows.push(
      ...(await db
        .select({ id: videos.id, youtubeVideoId: videos.youtube_video_id })
        .from(videos)
        .where(inArray(videos.youtube_video_id, group))),
    );
  }
  return rows;
}

export async function preflightLegacyImportPlan(
  db: DB,
  plan: CanonicalLegacyPlan,
  strategy: LegacyImportStrategy,
): Promise<void> {
  if (plan.errors.length > 0) {
    throw new Error(plan.errors.join("\n"));
  }

  const errors: string[] = [];
  const planEventIds = unique(plan.events.map((row) => row.id));
  const planVideoIds = unique(plan.videos.map((row) => row.id));
  if (planEventIds.length !== plan.events.length) errors.push("plan内でイベントIDが重複しています。");
  if (planVideoIds.length !== plan.videos.length) errors.push("plan内で作品IDが重複しています。");

  for (const event of plan.events) {
    const ownerCount = plan.eventStaff.filter(
      (staff) => staff.event_id === event.id && staff.permission_preset === "owner",
    ).length;
    if (ownerCount < 1) errors.push(`イベント ${event.id} にownerがありません。`);
  }

  const [existingEvents, existingVideos] = await Promise.all([
    existingEventIds(db, planEventIds),
    existingVideoRows(db, planVideoIds),
  ]);

  if (strategy === "create_only") {
    existingEvents.forEach((id) => errors.push(`イベント ${id} は既に存在します。`));
    existingVideos.forEach((_, id) => errors.push(`作品 ${id} は既に存在します。`));
  }

  if (strategy === "replace_imported") {
    const importedEvents = await importedEventIds(db, [...existingEvents]);
    existingEvents.forEach((id) => {
      if (!importedEvents.has(id)) {
        errors.push(`イベント ${id} は旧形式インポート由来ではないため置換できません。`);
      }
    });
    existingVideos.forEach((row, id) => {
      if (row.submittedBy !== LEGACY_IMPORT_SYSTEM_USER_ID) {
        errors.push(`作品 ${id} は旧形式インポート由来ではないため置換できません。`);
      }
    });
  }

  const referencedEventIds = unique([
    ...plan.videos.map((row) => row.primary_event_id),
    ...plan.videoEvents.map((row) => row.event_id),
  ]);
  const externalEventIds = referencedEventIds.filter((id) => !planEventIds.includes(id));
  const existingExternalEvents = await existingEventIds(db, externalEventIds);
  externalEventIds.forEach((id) => {
    if (!existingExternalEvents.has(id)) {
      errors.push(`作品の所属イベント ${id} が存在せず、同じplanにも含まれていません。`);
    }
  });

  const incomingYoutubeIds = new Map<string, string>();
  for (const video of plan.videos) {
    if (!video.youtube_video_id) continue;
    if (strategy === "skip_existing" && existingVideos.has(video.id)) continue;
    const previous = incomingYoutubeIds.get(video.youtube_video_id);
    if (previous && previous !== video.id) {
      errors.push(
        `YouTube動画ID ${video.youtube_video_id} が作品 ${previous} と ${video.id} で重複しています。`,
      );
    } else {
      incomingYoutubeIds.set(video.youtube_video_id, video.id);
    }
  }

  const existingYoutubeOwners = await youtubeOwners(db, [...incomingYoutubeIds.keys()]);
  for (const row of existingYoutubeOwners) {
    if (!row.youtubeVideoId) continue;
    const incomingVideoId = incomingYoutubeIds.get(row.youtubeVideoId);
    if (incomingVideoId && incomingVideoId !== row.id) {
      errors.push(
        `YouTube動画ID ${row.youtubeVideoId} は既存作品 ${row.id} が使用しているため、作品 ${incomingVideoId} へ保存できません。`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
