/**
 * ドライラン: DB は読み取りのみ。
 * - 既存 ID の衝突チェック
 * - replace_imported: legacy_import_batch_items を確認
 * - 旧互換フラグ (is_active 等) は表示しない。visibility_status を表示。
 */

import "server-only";

import { inArray, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  events,
  legacyImportBatchItems,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { MAX_IN_CLAUSE, MAX_PREVIEW_ROWS } from "./constants";
import type {
  DryRunPreviewRow,
  DryRunResult,
  ImportStrategy,
  LegacyImportPlan,
} from "./types";

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchExistingEventIds(db: DB, ids: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db.select({ id: events.id }).from(events).where(inArray(events.id, chunk));
    for (const r of rows) existing.add(r.id);
  }
  return existing;
}

async function fetchExistingVideoIds(db: DB, ids: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db.select({ id: videos.id }).from(videos).where(inArray(videos.id, chunk));
    for (const r of rows) existing.add(r.id);
  }
  return existing;
}

async function fetchExistingXIds(db: DB, ids: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(inArray(sql<string>`lower(${xUsers.id})`, chunk.map((id) => id.toLowerCase())));
    for (const r of rows) existing.add(r.id.toLowerCase());
  }
  return existing;
}

/** replace_imported: 過去の legacy import batch で作成済みの ID セットを取得 */
async function fetchImportedEventIds(db: DB, ids: string[]): Promise<Set<string>> {
  const imported = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db
      .select({ target_id: legacyImportBatchItems.target_id })
      .from(legacyImportBatchItems)
      .where(inArray(legacyImportBatchItems.target_id, chunk));
    for (const r of rows) imported.add(r.target_id);
  }
  return imported;
}

async function fetchImportedVideoIds(db: DB, ids: string[]): Promise<Set<string>> {
  const imported = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db
      .select({ target_id: legacyImportBatchItems.target_id })
      .from(legacyImportBatchItems)
      .where(inArray(legacyImportBatchItems.target_id, chunk));
    for (const r of rows) imported.add(r.target_id);
  }
  return imported;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function indexWarnings(plan: LegacyImportPlan): Map<string, string[]> {
  const warnings = new Map<string, string[]>();
  for (const warning of plan.warnings) {
    const current = warnings.get(warning.source);
    if (current) current.push(warning.message);
    else warnings.set(warning.source, [warning.message]);
  }
  return warnings;
}

export async function buildDryRunResult(
  db: DB,
  plan: LegacyImportPlan,
  strategy: ImportStrategy,
): Promise<DryRunResult> {
  const batchId = generateId("lib");

  const eventIds = plan.events.map((e) => e.id);
  const videoIds = plan.videos.map((v) => v.id);
  const xIdList = plan.xUsers.map((x) => x.id);

  const [existingEventIds, existingVideoIds, existingXIds] = await Promise.all([
    fetchExistingEventIds(db, eventIds),
    fetchExistingVideoIds(db, videoIds),
    fetchExistingXIds(db, xIdList),
  ]);

  let importedEventIds = new Set<string>();
  let importedVideoIds = new Set<string>();
  if (strategy === "replace_imported") {
    [importedEventIds, importedVideoIds] = await Promise.all([
      fetchImportedEventIds(db, eventIds),
      fetchImportedVideoIds(db, videoIds),
    ]);
  }

  const warningMessages = indexWarnings(plan);
  const staffCountByEvent = new Map<string, number>();
  for (const staff of plan.eventStaff) incrementCount(staffCountByEvent, staff.event_id);
  const memberCountByVideo = new Map<string, number>();
  for (const member of plan.videoMembers) incrementCount(memberCountByVideo, member.video_id);
  const firstExtraByVideo = new Map<string, (typeof plan.videoNormExtras)[number]>();
  for (const extra of plan.videoNormExtras) {
    if (!firstExtraByVideo.has(extra.video_id)) {
      firstExtraByVideo.set(extra.video_id, extra);
    }
  }

  const counts = {
    events: { create: 0, replace: 0, skip: 0, failed: plan.errors.filter((e) => e.source === "event").length },
    videos: { create: 0, replace: 0, skip: 0, failed: plan.errors.filter((e) => e.source === "video").length },
    xUsers: { create: 0 },
    members: 0,
    staff: 0,
  };

  const previewRows: DryRunPreviewRow[] = [];
  let previewTotal = 0;

  // events
  for (const ev of plan.events) {
    const exists = existingEventIds.has(ev.id);
    let action: DryRunPreviewRow["action"];
    if (!exists) {
      action = "create";
      counts.events.create++;
    } else if (strategy === "replace_imported" && importedEventIds.has(ev.id)) {
      action = "replace";
      counts.events.replace++;
    } else if (strategy === "create_only") {
      action = "skip";
      counts.events.skip++;
    } else if (strategy === "skip_existing") {
      action = "skip";
      counts.events.skip++;
    } else {
      action = "skip";
      counts.events.skip++;
    }

    const eventWarnings = warningMessages.get(`event:${ev.id}`) ?? [];

    previewTotal++;
    if (previewRows.length < MAX_PREVIEW_ROWS) {
      previewRows.push({
        kind: "event",
        id: ev.id,
        title: ev.title,
        action,
        conflict: exists,
        visibility_status: ev.visibility_status,
        softwareCount: 0,
        memberCount: 0,
        warnings: eventWarnings,
      });
    }

    if (action !== "skip") {
      counts.staff += staffCountByEvent.get(ev.id) ?? 0;
    }
  }

  // videos
  for (const vi of plan.videos) {
    const exists = existingVideoIds.has(vi.id);
    let action: DryRunPreviewRow["action"];
    if (!exists) {
      action = "create";
      counts.videos.create++;
    } else if (strategy === "replace_imported" && importedVideoIds.has(vi.id)) {
      action = "replace";
      counts.videos.replace++;
    } else {
      action = "skip";
      counts.videos.skip++;
    }

    const videoWarnings = warningMessages.get(`video:${vi.id}`) ?? [];
    const memberCount = memberCountByVideo.get(vi.id) ?? 0;
    const extra = firstExtraByVideo.get(vi.id);
    const softwareCount = extra?.softwareLabels.length ?? 0;

    previewTotal++;
    if (previewRows.length < MAX_PREVIEW_ROWS) {
      previewRows.push({
        kind: "video",
        id: vi.id,
        title: vi.title,
        action,
        conflict: exists,
        softwareCount,
        memberCount,
        warnings: videoWarnings,
      });
    }

    if (action !== "skip") {
      counts.members += memberCount;
    }
  }

  // x users
  for (const xu of plan.xUsers) {
    if (!existingXIds.has(xu.id.toLowerCase())) {
      counts.xUsers.create++;
    }
  }

  const errors = plan.errors.map((e) => `${e.source}: ${e.message}`);

  return {
    ok: plan.errors.length === 0,
    message:
      plan.errors.length > 0
        ? `${plan.errors.length} 件のエラーが検出されました。`
        : `events ${counts.events.create + counts.events.replace} 件 / videos ${
            counts.videos.create + counts.videos.replace
          } 件を取り込む予定です。`,
    counts,
    preview: previewRows,
    previewTotal,
    errors,
    batchId,
  };
}
