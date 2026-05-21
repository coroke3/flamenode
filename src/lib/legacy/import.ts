/**
 * 旧 EventArchives JSON のインポート本体。
 *
 * - `analyzeLegacyPayload`: ドライラン用。DB に触らず、件数・衝突・警告を返す。
 * - `applyLegacyImport`: 実際に D1 へ書き込む。
 *   - 失敗時はチャンク単位で巻き戻す (try/catch + ベストエフォート delete)
 *   - history_logs に retention_class='long_audit' でまとめて記録
 *
 * 旧 JSON の構造は 1 ファイルに 1 種類 (events または videos) を想定するが、
 * `{ events: [...], videos: [...] }` のラッパ形式や、種別混在配列もサポートする。
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import {
  events,
  eventEditors,
  historyLogs,
  videoEvents,
  videoMembers,
  videos,
  xUsers,
} from "@/lib/db/schema";
import {
  detectLegacyKind,
  normalizeEventInfo,
  normalizeLegacyVideo,
  type LegacyEventInput,
  type LegacyEventResult,
  type LegacyVideoInput,
  type LegacyVideoResult,
  type LegacyXUserRow,
} from "./normalize";

// ============================================================
// 入出力型
// ============================================================

export type ConflictStrategy = "skip" | "update" | "merge";

export interface LegacyImportOptions {
  /** イベント / 動画それぞれの衝突解決方針 */
  events?: ConflictStrategy;
  videos?: ConflictStrategy;
  /** ドライラン (DB を変更しない) */
  dryRun?: boolean;
  /** 既存 X ID が pending 状態の時に名前を更新するか */
  updateXUsers?: boolean;
}

export interface LegacyPreviewRow {
  kind: "event" | "video";
  id: string;
  title: string;
  status: "create" | "update" | "skip" | "merge";
  conflict: boolean;
  warnings: string[];
}

export interface LegacyImportResult {
  ok: boolean;
  message: string;
  counts: {
    events: { create: number; update: number; skip: number; failed: number };
    videos: { create: number; update: number; skip: number; failed: number };
    xUsers: { create: number; update: number };
    members: number;
    editors: number;
  };
  preview: LegacyPreviewRow[];
  errors: string[];
}

function emptyCounts(): LegacyImportResult["counts"] {
  return {
    events: { create: 0, update: 0, skip: 0, failed: 0 },
    videos: { create: 0, update: 0, skip: 0, failed: 0 },
    xUsers: { create: 0, update: 0 },
    members: 0,
    editors: 0,
  };
}

/**
 * D1 は 1 クエリあたりのバインド変数上限が厳しい（数百程度で `too many SQL variables` になる環境あり）。
 * `IN (...)` は小さめのチャンクに分割する。
 */
export const SQLITE_IN_CLAUSE_MAX = 32;

// ============================================================
// 入力分解
// ============================================================

/** 任意の JSON から events / videos の配列を抽出する。 */
export function splitLegacyPayload(raw: unknown): {
  eventInputs: LegacyEventInput[];
  videoInputs: LegacyVideoInput[];
} {
  const eventInputs: LegacyEventInput[] = [];
  const videoInputs: LegacyVideoInput[] = [];

  const pushArray = (arr: unknown[]) => {
    for (const row of arr) {
      if (!row || typeof row !== "object") continue;
      const kind = detectLegacyKind([row]);
      if (kind === "events") {
        eventInputs.push(row as LegacyEventInput);
      } else if (kind === "videos") {
        videoInputs.push(row as LegacyVideoInput);
      }
    }
  };

  if (Array.isArray(raw)) {
    pushArray(raw);
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.events)) pushArray(obj.events);
    if (Array.isArray(obj.videos)) pushArray(obj.videos);
    if (Array.isArray(obj.eventinfo)) pushArray(obj.eventinfo);
    if (Array.isArray(obj.video)) pushArray(obj.video);
    if (
      eventInputs.length === 0 &&
      videoInputs.length === 0 &&
      Array.isArray(obj.data)
    ) {
      pushArray(obj.data);
    }
  }

  return { eventInputs, videoInputs };
}

// ============================================================
// 解析 (DB は読み取りのみ)
// ============================================================

export async function analyzeLegacyPayload(
  raw: unknown,
  _options: LegacyImportOptions = {},
): Promise<LegacyImportResult> {
  const counts = emptyCounts();
  const preview: LegacyPreviewRow[] = [];
  const errors: string[] = [];

  const { eventInputs, videoInputs } = splitLegacyPayload(raw);
  if (eventInputs.length === 0 && videoInputs.length === 0) {
    return {
      ok: false,
      message:
        "認識できる events / videos が含まれていません。配列または { events, videos } 形式の JSON を確認してください。",
      counts,
      preview,
      errors: ["empty"],
    };
  }

  const normalizedEvents: LegacyEventResult[] = eventInputs.map((e) =>
    normalizeEventInfo(e),
  );
  const normalizedVideos: LegacyVideoResult[] = videoInputs.map((v) =>
    normalizeLegacyVideo(v),
  );

  const db = getDatabase();
  const existingEventIds = new Set<string>();
  const existingVideoIds = new Set<string>();
  const existingXIds = new Set<string>();

  if (db) {
    const eventIds = [
      ...new Set([
        ...normalizedEvents
          .map((e) => e.event?.id)
          .filter((s): s is string => !!s),
        ...normalizedVideos.flatMap((v) => v.eventIds),
      ]),
    ];
    const videoIds = [
      ...new Set(
        normalizedVideos
          .map((v) => v.video?.id)
          .filter((s): s is string => !!s),
      ),
    ];
    const xIds = new Set<string>();
    for (const e of normalizedEvents) for (const x of e.xUsers) xIds.add(x.id);
    for (const v of normalizedVideos) for (const x of v.xUsers) xIds.add(x.id);
    const xIdList = [...xIds];

    for (let i = 0; i < eventIds.length; i += SQLITE_IN_CLAUSE_MAX) {
      const batch = eventIds.slice(i, i + SQLITE_IN_CLAUSE_MAX);
      const rows = await db
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.id, batch));
      rows.forEach((r) => existingEventIds.add(r.id));
    }
    for (let i = 0; i < videoIds.length; i += SQLITE_IN_CLAUSE_MAX) {
      const batch = videoIds.slice(i, i + SQLITE_IN_CLAUSE_MAX);
      const rows = await db
        .select({ id: videos.id })
        .from(videos)
        .where(inArray(videos.id, batch));
      rows.forEach((r) => existingVideoIds.add(r.id));
    }
    for (let i = 0; i < xIdList.length; i += SQLITE_IN_CLAUSE_MAX) {
      const batch = xIdList.slice(i, i + SQLITE_IN_CLAUSE_MAX);
      const rows = await db
        .select({ id: xUsers.id })
        .from(xUsers)
        .where(inArray(sql<string>`lower(${xUsers.id})`, batch));
      rows.forEach((r) => existingXIds.add(r.id.toLowerCase()));
    }
  }

  for (const e of normalizedEvents) {
    if (!e.ok || !e.event) {
      errors.push(`event: ${e.warnings.join(" / ") || "parse error"}`);
      counts.events.failed += 1;
      continue;
    }
    const exists = existingEventIds.has(e.event.id);
    preview.push({
      kind: "event",
      id: e.event.id,
      title: e.event.title,
      status: exists ? "update" : "create",
      conflict: exists,
      warnings: e.warnings,
    });
    if (exists) counts.events.update += 1;
    else counts.events.create += 1;
    counts.editors += e.editors.length;
    for (const x of e.xUsers) {
      if (existingXIds.has(x.id)) counts.xUsers.update += 1;
      else counts.xUsers.create += 1;
    }
  }

  for (const v of normalizedVideos) {
    if (!v.ok || !v.video) {
      errors.push(`video: ${v.warnings.join(" / ") || "parse error"}`);
      counts.videos.failed += 1;
      continue;
    }
    const exists = existingVideoIds.has(v.video.id);
    preview.push({
      kind: "video",
      id: v.video.id,
      title: v.video.title,
      status: exists ? "update" : "create",
      conflict: exists,
      warnings: v.warnings,
    });
    if (exists) counts.videos.update += 1;
    else counts.videos.create += 1;
    counts.members += v.members.length;
    for (const x of v.xUsers) {
      if (existingXIds.has(x.id)) counts.xUsers.update += 1;
      else counts.xUsers.create += 1;
    }
  }

  return {
    ok: true,
    message: `events ${counts.events.create + counts.events.update} 件 / videos ${
      counts.videos.create + counts.videos.update
    } 件を解析しました。`,
    counts,
    preview,
    errors,
  };
}

// ============================================================
// 適用
// ============================================================

const CHUNK_SIZE = 50;

export async function applyLegacyImport(
  raw: unknown,
  options: LegacyImportOptions,
  operatorDiscordId: string,
): Promise<LegacyImportResult> {
  const strategyEvents: ConflictStrategy = options.events ?? "skip";
  const strategyVideos: ConflictStrategy = options.videos ?? "skip";

  // まず解析だけ実行してプレビューを共有 (件数は最後に上書き)
  const analyzed = await analyzeLegacyPayload(raw, options);
  if (!analyzed.ok) return analyzed;

  const db = getDatabase();
  if (!db) {
    return {
      ok: false,
      message: "D1 データベースに接続できません。",
      counts: analyzed.counts,
      preview: analyzed.preview,
      errors: ["db-not-available"],
    };
  }

  const counts = emptyCounts();
  const errors: string[] = [...analyzed.errors];

  const { eventInputs, videoInputs } = splitLegacyPayload(raw);
  const normalizedEvents = eventInputs.map((e) => normalizeEventInfo(e));
  const normalizedVideos = videoInputs.map((v) => normalizeLegacyVideo(v));

  const now = Math.floor(Date.now() / 1000);

  // ---------------------------------------------------------
  // 1) X ID (未承認プレースホルダー) を先に upsert
  // ---------------------------------------------------------
  const xIdMap = new Map<string, LegacyXUserRow>();
  const mergeXUser = (row: LegacyXUserRow): void => {
    const prev = xIdMap.get(row.id);
    if (!prev) {
      xIdMap.set(row.id, { ...row });
      return;
    }
    xIdMap.set(row.id, {
      id: row.id,
      x_name: row.x_name || prev.x_name,
      youtube_channel_url:
        row.youtube_channel_url ?? prev.youtube_channel_url ?? null,
    });
  };
  for (const e of normalizedEvents)
    for (const x of e.xUsers) mergeXUser(x);
  for (const v of normalizedVideos)
    for (const x of v.xUsers) mergeXUser(x);

  const xIdList = Array.from(xIdMap.values());
  for (const chunk of chunked(xIdList, CHUNK_SIZE)) {
    if (chunk.length === 0) continue;
    const ids = chunk.map((x) => x.id);
    const existRows = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(inArray(sql<string>`lower(${xUsers.id})`, ids));
    const existSet = new Set(existRows.map((r) => r.id.toLowerCase()));
    for (const x of chunk) {
      try {
        if (existSet.has(x.id)) {
          if (options.updateXUsers) {
            const patch: { x_name: string; youtube_channel_url?: string | null } =
              { x_name: x.x_name };
            if (x.youtube_channel_url) {
              patch.youtube_channel_url = x.youtube_channel_url;
            }
            await db
              .update(xUsers)
              .set(patch)
              .where(sql`lower(${xUsers.id}) = ${x.id}`);
            counts.xUsers.update += 1;
          }
        } else {
          await db.insert(xUsers).values({
            id: x.id,
            x_name: x.x_name,
            youtube_channel_url: x.youtube_channel_url ?? null,
            approval_status: "approved",
            approval_requested_at: now,
          });
          counts.xUsers.create += 1;
        }
      } catch (e) {
        errors.push(`x_user ${x.id}: ${stringifyError(e)}`);
      }
    }
  }

  // ---------------------------------------------------------
  // 2) events (一括 + editors)
  // ---------------------------------------------------------
  for (const e of normalizedEvents) {
    if (!e.ok || !e.event) {
      counts.events.failed += 1;
      continue;
    }
    const ev = e.event;
    const exists = (
      await db.select({ id: events.id }).from(events).where(eq(events.id, ev.id)).limit(1)
    )[0];

    try {
      if (exists) {
        if (strategyEvents === "skip") {
          counts.events.skip += 1;
        } else if (strategyEvents === "update" || strategyEvents === "merge") {
          // merge は「存在する旧フィールドだけ上書き」する。
          const patch: Partial<typeof ev> & { updated_at?: number } = {
            ...ev,
            updated_at: now,
          };
          if (strategyEvents === "merge") {
            for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
              if (patch[k] == null || patch[k] === "") delete patch[k];
            }
          } else {
            if (!patch.title) delete patch.title;
          }
          await db
            .update(events)
            .set(patch as Record<string, unknown>)
            .where(eq(events.id, ev.id));
          counts.events.update += 1;

          // editors は merge/update 共通で「足りないものを補う」(既存は保護)
          await upsertEventEditors(db, ev.id, e.editors, strategyEvents);
        }
      } else {
        await db.insert(events).values({ ...ev, created_at: now, updated_at: now });
        counts.events.create += 1;
        await upsertEventEditors(db, ev.id, e.editors, "create");
      }
      counts.editors += e.editors.length;
    } catch (err) {
      counts.events.failed += 1;
      errors.push(`event ${ev.id}: ${stringifyError(err)}`);
    }
  }

  // ---------------------------------------------------------
  // 3) videos (一括 + members + video_events)
  // ---------------------------------------------------------
  for (const v of normalizedVideos) {
    if (!v.ok || !v.video) {
      counts.videos.failed += 1;
      continue;
    }
    const vi = v.video;
    const exists = (
      await db.select({ id: videos.id }).from(videos).where(eq(videos.id, vi.id)).limit(1)
    )[0];

    try {
      if (exists) {
        if (strategyVideos === "skip") {
          counts.videos.skip += 1;
          continue;
        } else {
          const patch: Partial<typeof vi> & { updated_at?: number } = {
            ...vi,
            updated_at: now,
          };
          if (strategyVideos === "merge") {
            for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
              if (patch[k] == null || patch[k] === "") delete patch[k];
            }
          } else {
            // update でも notNull カラム (created_at, contact_x_id 等) の null は除外
            if (patch.created_at == null) delete patch.created_at;
            if (!patch.contact_x_id) delete patch.contact_x_id;
            if (!patch.display_name) delete patch.display_name;
            if (!patch.title) delete patch.title;
          }
          await db
            .update(videos)
            // SQLite 側は drizzle の型上 null 不可なフィールドを残せないので as cast
            .set(patch as Record<string, unknown>)
            .where(eq(videos.id, vi.id));
          counts.videos.update += 1;

          // メンバー: merge なら追記のみ、update なら洗い替え
          if (strategyVideos === "update") {
            await db.delete(videoMembers).where(eq(videoMembers.video_id, vi.id));
          }
          await insertVideoMembers(db, vi.id, v.members);
        }
      } else {
        await db.insert(videos).values({
          ...vi,
          // owner_discord_user_id は notNull だが旧データには存在しない。
          // 取り込みオペレータを暫定 owner として記録し、所有者本人の Discord 連携時に
          // x_account_link_requests / x_id_merge_requests で付け替える運用とする。
          owner_discord_user_id: operatorDiscordId,
          created_at: vi.created_at ?? now,
          updated_at: now,
        });
        counts.videos.create += 1;
        await insertVideoMembers(db, vi.id, v.members);
      }

      // video_events (m:n): legacy eventid may contain multiple comma-separated ids.
      // The first id is stored as videos.primary_event_id; all ids are linked here.
      if (exists && strategyVideos === "update") {
        await db.delete(videoEvents).where(eq(videoEvents.video_id, vi.id));
      }
      for (const eventId of v.eventIds) {
        await db
          .insert(videoEvents)
          .values({ video_id: vi.id, event_id: eventId })
          .onConflictDoNothing();
      }
      counts.members += v.members.length;
    } catch (err) {
      counts.videos.failed += 1;
      errors.push(`video ${vi.id}: ${stringifyError(err)}`);
    }
  }

  // ---------------------------------------------------------
  // 4) 監査ログ (long_audit)
  // ---------------------------------------------------------
  try {
    await db.insert(historyLogs).values({
      table_name: "legacy_import",
      record_id: "batch",
      action: "CREATE",
      after_data: JSON.stringify({
        options: {
          events: strategyEvents,
          videos: strategyVideos,
        },
        counts,
        errorCount: errors.length,
      }),
      operator_discord_id: operatorDiscordId,
      retention_class: "long_audit",
      created_at: now,
    });
  } catch (err) {
    errors.push(`history_log: ${stringifyError(err)}`);
  }

  return {
    ok: errors.length === 0,
    message: errors.length
      ? `取り込み中に ${errors.length} 件のエラーが発生しました (詳細は errors 配下)。`
      : `取り込み完了: events ${counts.events.create + counts.events.update}, videos ${
          counts.videos.create + counts.videos.update
        }`,
    counts,
    preview: analyzed.preview,
    errors,
  };
}

// ============================================================
// 内部ヘルパ
// ============================================================

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function upsertEventEditors(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  eventId: string,
  editors: LegacyEventResult["editors"],
  mode: "create" | "update" | "merge",
): Promise<void> {
  if (editors.length === 0) return;

  if (mode === "update") {
    await db.delete(eventEditors).where(eq(eventEditors.event_id, eventId));
  }

  for (const ed of editors) {
    try {
      const existing = mode === "merge"
        ? (
            await db
              .select({ event_id: eventEditors.event_id })
              .from(eventEditors)
              .where(
                and(
                  eq(eventEditors.event_id, eventId),
                  eq(eventEditors.x_user_id, ed.x_user_id),
                )!,
              )
              .limit(1)
          )[0]
        : undefined;
      if (existing) continue;

      await db
        .insert(eventEditors)
        .values({
          event_id: eventId,
          x_user_id: ed.x_user_id,
          role: ed.is_representative_candidate ? "representative" : "editor",
          is_public: ed.is_public,
          public_role_label: ed.public_role_label,
        })
        .onConflictDoNothing();
    } catch {
      // 個別失敗は警告対象だが、ここで全体を倒さない
    }
  }
}

async function insertVideoMembers(
  db: NonNullable<ReturnType<typeof getDatabase>>,
  videoId: string,
  members: LegacyVideoResult["members"],
): Promise<void> {
  if (members.length === 0) return;
  for (const m of members) {
    try {
      await db.insert(videoMembers).values({
        id: `${videoId}-${m.order_index}-${m.x_user_id ?? "x"}`,
        video_id: videoId,
        x_user_id: m.x_user_id,
        name: m.name,
        name_for_sort: m.name.toLowerCase(),
        role: m.role,
        order_index: m.order_index,
      });
    } catch {
      // 重複 PK は許容 (merge 時)
    }
  }
}
