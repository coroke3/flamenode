import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { buildPermissionIntegrityChecks } from "./permissionIntegrityChecks";

const DISPLAY_LIMIT = 50;

export type IntegritySeverity = "danger" | "warning" | "info";

export interface IntegrityIssue {
  id: string;
  title: string;
  description: string;
  adminHref?: string;
  publicHref?: string;
  sqlPreview?: string;
}

export interface IntegrityCheckResult {
  id: string;
  title: string;
  area: string;
  severity: IntegritySeverity;
  description: string;
  count: number;
  issues: IntegrityIssue[];
  moreCount: number;
  recommendation: string;
  sqlPreview?: string;
}

type RawRow = Record<string, unknown>;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function videoHref(id: string): string {
  return `/admin/videos/${encodeURIComponent(id)}`;
}

function eventHref(id: string): string {
  return `/manage/events/${encodeURIComponent(id)}`;
}

function finalize(
  base: Omit<IntegrityCheckResult, "moreCount">,
): IntegrityCheckResult {
  return {
    ...base,
    moreCount: Math.max(0, base.count - base.issues.length),
  };
}

export async function makeCheck(args: {
  db: DB;
  id: string;
  title: string;
  area: string;
  severity: IntegritySeverity;
  description: string;
  from: SQL;
  where?: SQL;
  sampleSelect: Record<string, SQL>;
  recommendation: string;
  sqlPreview?: string;
  mapIssue(row: RawRow): IntegrityIssue;
}): Promise<IntegrityCheckResult> {
  // The window count keeps the full matching-row count while returning only
  // the bounded sample. This removes one full COUNT(*) scan per check.
  const rows = await args.db
    .select({
      ...args.sampleSelect,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(args.from)
    .where(args.where ?? sql`1 = 1`)
    .limit(DISPLAY_LIMIT);
  const rawRows = rows as RawRow[];
  const count = Number(rawRows[0]?.total_count ?? 0);
  return finalize({
    id: args.id,
    title: args.title,
    area: args.area,
    severity: args.severity,
    description: args.description,
    count,
    issues: rawRows.map(args.mapIssue),
    recommendation: args.recommendation,
    sqlPreview: args.sqlPreview,
  });
}

/**
 * 同一 event / start_time の別枠を、D1側の self-join で一意なペアとして数える。
 * NULL の reservation_group_id は既存のJS検査と同じく別グループ扱いにする。
 */
async function makeSlotDuplicateStartTimeCheck(
  db: DB,
): Promise<IntegrityCheckResult> {
  const pairWhere = sql`
    s1.start_time IS NOT NULL
    AND s2.start_time = s1.start_time
    AND s2.event_id = s1.event_id
    AND s1.id < s2.id
    AND (
      s1.reservation_group_id IS NULL
      OR s2.reservation_group_id IS NULL
      OR s1.reservation_group_id <> s2.reservation_group_id
    )
  `;
  const pairFrom = sql`slots AS s1, slots AS s2`;
  const sampleRows = await db
    .select({
      left_id: sql<string>`s1.id`,
      right_id: sql<string>`s2.id`,
      event_id: sql<string>`s1.event_id`,
      start_time: sql<number>`s1.start_time`,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(pairFrom)
    .where(pairWhere)
    .orderBy(sql`s1.event_id, s1.start_time, s1.id, s2.id`)
    .limit(5);
  const count = Number(sampleRows[0]?.total_count ?? 0);
  const issues = sampleRows.map((row) => ({
    id: `${text(row.left_id)}:${text(row.right_id)}`,
    title: `slot:${text(row.left_id)} / ${text(row.right_id)}`,
    description: `event:${text(row.event_id)} start_time:${text(row.start_time)}`,
    adminHref: eventHref(text(row.event_id)),
  }));
  return finalize({
    id: "slots_duplicate_start_time",
    area: "slots",
    title: "同一開始時刻の別枠",
    severity: "warning",
    description:
      "同一 event 内に同じ start_time で、reservation_group_id が異なる枠が存在する状態。",
    count,
    issues,
    recommendation:
      "連続枠なら同じ reservation_group_id に揃え、別枠なら開始時刻または部の切り方を見直してください。",
    sqlPreview: "-- Review start_time and reservation_group_id for the sampled slots.",
  });
}

export async function runIntegrityChecks(
  db: DB,
): Promise<IntegrityCheckResult[]> {
  const [base, permission] = await Promise.all([
    Promise.all([
    makeCheck({
      db,
      id: "videos_primary_event_missing_event",
      area: "videos",
      title: "primary_event_id の参照先イベント欠落",
      severity: "danger",
      description: "videos.primary_event_id が events.id に存在しない作品。",
      from: sql`videos`,
      where: sql`primary_event_id IS NOT NULL AND primary_event_id <> '' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = videos.primary_event_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        ref: sql<string>`primary_event_id`,
      },
      recommendation:
        "主イベントが削除またはID変更された可能性があります。正しい event_id に更新するか、primary_event_id をクリアしてください。",
      sqlPreview:
        "UPDATE videos SET primary_event_id = NULL WHERE id = '<video_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `参照先 event_id: ${text(r.ref)}`,
        adminHref: videoHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "videos_primary_event_not_in_video_events",
      area: "videos",
      title: "primary_event_id と video_events の不一致",
      severity: "warning",
      description: "主イベントが video_events に含まれていない作品。",
      from: sql`videos`,
      where: sql`primary_event_id IS NOT NULL AND primary_event_id <> '' AND NOT EXISTS (SELECT 1 FROM video_events ve WHERE ve.video_id = videos.id AND ve.event_id = videos.primary_event_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        ref: sql<string>`primary_event_id`,
      },
      recommendation:
        "video_events に primary_event_id を追加して、主イベントと所属イベントを同期してください。",
      sqlPreview:
        "INSERT OR IGNORE INTO video_events (video_id, event_id) VALUES ('<video_id>', '<primary_event_id>');",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `video_events に ${text(r.ref)} がありません。`,
        adminHref: videoHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "videos_creator_x_missing",
      area: "videos",
      title: "creator_x_user_id の参照先 X ID 欠落",
      severity: "danger",
      description: "作品の creator_x_user_id が x_users.id に存在しない状態。",
      from: sql`videos`,
      where: sql`creator_x_user_id IS NOT NULL AND creator_x_user_id <> '' AND NOT EXISTS (SELECT 1 FROM x_users xu WHERE lower(xu.id) = lower(videos.creator_x_user_id))`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        ref: sql<string>`creator_x_user_id`,
      },
      recommendation:
        "X ID を作成・復元するか、作品の投稿者X IDを既存の承認済み X ID へ修正してください。",
      sqlPreview:
        "INSERT INTO x_users (id, x_name, approval_status) VALUES ('<x_id>', '@<x_id>', 'pending');",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `存在しない X ID: @${text(r.ref)}`,
        adminHref: videoHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "videos_invalid_visibility_status",
      area: "videos",
      title: "visibility_status 不正値",
      severity: "danger",
      description: "schema で想定されていない公開状態の作品。",
      from: sql`videos`,
      where: sql`visibility_status NOT IN ('pending','public','private','voided')`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        status: sql<string>`visibility_status`,
      },
      recommendation:
        "公開状態を pending/public/private/voided のいずれかに修正してください。",
      sqlPreview:
        "UPDATE videos SET visibility_status = 'pending' WHERE id = '<video_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `不正な visibility_status: ${text(r.status)}`,
        adminHref: videoHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "events_invalid_visibility_status",
      area: "events",
      title: "events.visibility_status 不正値",
      severity: "danger",
      description: "イベント公開状態の正本に想定外の値が入っています。",
      from: sql`events`,
      where: sql`visibility_status NOT IN ('private','public')`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        status: sql<string>`visibility_status`,
      },
      recommendation:
        "visibility_status を private/public のいずれかに修正してください。",
      sqlPreview:
        "UPDATE events SET visibility_status = 'private' WHERE id = '<event_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `不正な visibility_status: ${text(r.status)}`,
        adminHref: eventHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "events_public_api_non_public",
      area: "events",
      title: "非公開イベントの Public API 有効化",
      severity: "danger",
      description:
        "public_api_enabled=1 ですが、イベント自体が public ではありません。",
      from: sql`events`,
      where: sql`public_api_enabled = 1 AND visibility_status <> 'public'`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        status: sql<string>`visibility_status`,
      },
      recommendation:
        "Public API を無効化するか、イベントを public に変更してください。",
      sqlPreview:
        "UPDATE events SET public_api_enabled = 0 WHERE id = '<event_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `public_api_enabled=1 / visibility_status:${text(r.status)}`,
        adminHref: eventHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "video_events_orphan_video",
      area: "video_events",
      title: "video_events.video_id 孤立",
      severity: "danger",
      description: "video_events.video_id に対応する videos.id が無い行。",
      from: sql`video_events`,
      where: sql`NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = video_events.video_id)`,
      sampleSelect: {
        video_id: sql<string>`video_id`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "元動画が削除または voided された可能性があります。不要なら video_events 行を削除してください。",
      sqlPreview:
        "DELETE FROM video_events WHERE video_id = '<video_id>' AND event_id = '<event_id>';",
      mapIssue: (r) => ({
        id: `${text(r.video_id)}:${text(r.event_id)}`,
        title: `video:${text(r.video_id)}`,
        description: `event:${text(r.event_id)} との関連だけが残っています。`,
      }),
    }),
    makeCheck({
      db,
      id: "video_events_orphan_event",
      area: "video_events",
      title: "video_events.event_id 孤立",
      severity: "danger",
      description: "video_events.event_id に対応する events.id が無い行。",
      from: sql`video_events`,
      where: sql`NOT EXISTS (SELECT 1 FROM events e WHERE e.id = video_events.event_id)`,
      sampleSelect: {
        video_id: sql<string>`video_id`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "イベント削除後の関連が残っている可能性があります。必要に応じて関連行を削除してください。",
      sqlPreview:
        "DELETE FROM video_events WHERE video_id = '<video_id>' AND event_id = '<event_id>';",
      mapIssue: (r) => ({
        id: `${text(r.video_id)}:${text(r.event_id)}`,
        title: `event:${text(r.event_id)}`,
        description: `video:${text(r.video_id)} が存在しないイベントへ紐づいています。`,
        adminHref: videoHref(text(r.video_id)),
      }),
    }),
    makeCheck({
      db,
      id: "video_events_duplicate",
      area: "video_events",
      title: "video_events 重複",
      severity: "info",
      description: "PK で防がれる想定の重複行。",
      from: sql`(SELECT video_id, event_id, COUNT(*) AS duplicate_count FROM video_events GROUP BY video_id, event_id HAVING COUNT(*) > 1) AS dup`,
      sampleSelect: {
        video_id: sql<string>`video_id`,
        event_id: sql<string>`event_id`,
        duplicate_count: sql<number>`duplicate_count`,
      },
      recommendation:
        "通常は発生しません。migration や import 経路を確認し、重複行を1行に整理してください。",
      sqlPreview:
        "SELECT video_id, event_id, COUNT(*) FROM video_events GROUP BY video_id, event_id HAVING COUNT(*) > 1;",
      mapIssue: (r) => ({
        id: `${text(r.video_id)}:${text(r.event_id)}`,
        title: `${text(r.video_id)} / ${text(r.event_id)}`,
        description: `${text(r.duplicate_count)} 件重複しています。`,
        adminHref: videoHref(text(r.video_id)),
      }),
    }),
    makeCheck({
      db,
      id: "video_members_orphan_video",
      area: "video_members",
      title: "video_members.video_id 孤立",
      severity: "danger",
      description: "メンバー行の video_id に対応する videos.id が無い状態。",
      from: sql`video_members`,
      where: sql`NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = video_members.video_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        video_id: sql<string>`video_id`,
        name: sql<string>`name`,
      },
      recommendation:
        "元動画が削除または voided された可能性があります。必要に応じて video_members を削除してください。",
      sqlPreview: "DELETE FROM video_members WHERE id = '<video_member_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.name),
        description: `存在しない video_id: ${text(r.video_id)}`,
      }),
    }),
    makeCheck({
      db,
      id: "video_members_x_user_missing",
      area: "video_members",
      title: "video_members.x_user_id の参照先欠落",
      severity: "warning",
      description: "メンバーの x_user_id が x_users.id に存在しない行。",
      from: sql`video_members`,
      where: sql`x_user_id IS NOT NULL AND x_user_id <> '' AND NOT EXISTS (SELECT 1 FROM x_users xu WHERE lower(xu.id) = lower(video_members.x_user_id))`,
      sampleSelect: {
        id: sql<string>`id`,
        video_id: sql<string>`video_id`,
        name: sql<string>`name`,
        x_user_id: sql<string>`x_user_id`,
      },
      recommendation:
        "表示名だけのメンバーとして扱うか、対応する x_users を作成してください。",
      sqlPreview:
        "UPDATE video_members SET x_user_id = NULL WHERE id = '<video_member_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.name),
        description: `存在しない X ID: @${text(r.x_user_id)}`,
        adminHref: videoHref(text(r.video_id)),
      }),
    }),
    makeCheck({
      db,
      id: "video_members_invalid_edit_grant",
      area: "video_members",
      title: "編集権限メンバーの主体欠落",
      severity: "danger",
      description: "can_edit=1 なのに x_user_id が空の行。",
      from: sql`video_members`,
      where: sql`can_edit = 1 AND (x_user_id IS NULL OR trim(x_user_id) = '')`,
      sampleSelect: {
        id: sql<string>`id`,
        video_id: sql<string>`video_id`,
        name: sql<string>`name`,
      },
      recommendation:
        "編集権限の主体が不明です。can_edit を解除するか、正しい X ID を設定してください。",
      sqlPreview:
        "UPDATE video_members SET can_edit = 0 WHERE id = '<video_member_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.name),
        description: "編集権限の対象ユーザーを特定できません。",
        adminHref: videoHref(text(r.video_id)),
      }),
    }),
    makeCheck({
      db,
      id: "video_members_private_display_risk",
      area: "video_members",
      title: "非公開メンバーの表示混入確認",
      severity: "info",
      description: "is_public_member=0 で公開用情報を持つ行。表示側が除外しているか確認用。",
      from: sql`video_members`,
      where: sql`is_public_member = 0 AND (COALESCE(name, '') <> '' OR COALESCE(role, '') <> '' OR COALESCE(comment, '') <> '')`,
      sampleSelect: {
        id: sql<string>`id`,
        video_id: sql<string>`video_id`,
        name: sql<string>`name`,
      },
      recommendation:
        "公開ページは is_public_member=1 のみ表示する実装を維持してください。混入があれば表示クエリを確認してください。",
      sqlPreview:
        "SELECT * FROM video_members WHERE is_public_member = 0;",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.name),
        description: "非公開メンバー行です。公開表示に混ざらないか確認してください。",
        adminHref: videoHref(text(r.video_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_orphan_event",
      area: "slots",
      title: "slots.event_id 孤立",
      severity: "danger",
      description: "枠の event_id に対応する events.id が無い状態。",
      from: sql`slots`,
      where: sql`NOT EXISTS (SELECT 1 FROM events e WHERE e.id = slots.event_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        status: sql<string>`status`,
      },
      recommendation:
        "イベント削除後に枠が残った可能性があります。イベント復元または枠削除を検討してください。",
      sqlPreview: "DELETE FROM slots WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: `存在しない event_id: ${text(r.event_id)} / status:${text(r.status)}`,
      }),
    }),
    makeCheck({
      db,
      id: "slots_orphan_video",
      area: "slots",
      title: "slots.video_id 孤立",
      severity: "danger",
      description: "slots.video_id に対応する videos.id が無い状態。",
      from: sql`slots`,
      where: sql`video_id IS NOT NULL AND video_id <> '' AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = slots.video_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        video_id: sql<string>`video_id`,
      },
      recommendation:
        "提出済み動画が削除された可能性があります。slot を available に戻すか、正しい video_id に修正してください。",
      sqlPreview:
        "UPDATE slots SET video_id = NULL, status = 'available' WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: `存在しない video_id: ${text(r.video_id)}`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_submitted_without_video",
      area: "slots",
      title: "submitted 枠に video_id なし",
      severity: "danger",
      description: "status=submitted なのに video_id が空の枠。",
      from: sql`slots`,
      where: sql`status = 'submitted' AND (video_id IS NULL OR trim(video_id) = '')`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "提出処理の途中失敗が疑われます。対応動画を紐付けるか、reserved/available へ戻してください。",
      sqlPreview:
        "UPDATE slots SET status = 'reserved' WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: "submitted ですが動画がありません。",
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_available_with_video",
      area: "slots",
      title: "available 枠に video_id 残存",
      severity: "warning",
      description: "status=available なのに video_id が残っている枠。",
      from: sql`slots`,
      where: sql`status = 'available' AND video_id IS NOT NULL AND trim(video_id) <> ''`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        video_id: sql<string>`video_id`,
      },
      recommendation:
        "解放処理後の残骸の可能性があります。video_id を NULL にしてください。",
      sqlPreview:
        "UPDATE slots SET video_id = NULL WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: `available ですが video_id:${text(r.video_id)} が残っています。`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_available_with_reservation_metadata",
      area: "slots",
      title: "available slot has reservation metadata",
      severity: "danger",
      description:
        "An available slot still contains owner, X, group, display, or video reservation fields.",
      from: sql`slots`,
      where: sql`status = 'available' AND (
        (reserved_by_user_id IS NOT NULL AND trim(reserved_by_user_id) <> '') OR
        (x_user_id IS NOT NULL AND trim(x_user_id) <> '') OR
        (reserved_x_id_snapshot IS NOT NULL AND trim(reserved_x_id_snapshot) <> '') OR
        (reservation_group_id IS NOT NULL AND trim(reservation_group_id) <> '') OR
        (display_name IS NOT NULL AND trim(display_name) <> '') OR
        (video_id IS NOT NULL AND trim(video_id) <> '')
      )`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        status: sql<string>`status`,
      },
      recommendation:
        "Clear reservation metadata or restore the slot to the appropriate reserved/submitted state.",
      sqlPreview:
        "UPDATE slots SET reserved_by_user_id = NULL, x_user_id = NULL, reserved_x_id_snapshot = NULL, reservation_group_id = NULL, display_name = NULL, video_id = NULL WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: "available slot retains reservation metadata",
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_group_mixed_status",
      area: "slots",
      title: "reservation group has mixed statuses",
      severity: "danger",
      description:
        "All rows in one reservation_group_id must share the same available/reserved/submitted status.",
      from: sql`(
        SELECT reservation_group_id, COUNT(DISTINCT status) AS status_count,
               MIN(event_id) AS event_id
        FROM slots
        WHERE reservation_group_id IS NOT NULL AND trim(reservation_group_id) <> ''
        GROUP BY reservation_group_id
        HAVING COUNT(DISTINCT status) > 1
      ) AS mixed`,
      where: sql`1 = 1`,
      sampleSelect: {
        reservation_group_id: sql<string>`reservation_group_id`,
        status_count: sql<number>`status_count`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "Reconcile the group atomically before allowing another reservation or submission.",
      sqlPreview:
        "SELECT * FROM slots WHERE reservation_group_id = '<reservation_group_id>' ORDER BY start_time, id;",
      mapIssue: (r) => ({
        id: text(r.reservation_group_id),
        title: `group:${text(r.reservation_group_id)}`,
        description: `status variants:${text(r.status_count)}`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_reserved_without_owner",
      area: "slots",
      title: "reserved slot has no reservation owner",
      severity: "danger",
      description:
        "A reserved slot must retain the auth user that owns the reservation.",
      from: sql`slots`,
      where: sql`status = 'reserved' AND (reserved_by_user_id IS NULL OR trim(reserved_by_user_id) = '')`,
      sampleSelect: {
        id: sql<string>`id`,
        event_id: sql<string>`event_id`,
        reservation_group_id: sql<string>`reservation_group_id`,
      },
      recommendation:
        "Recover the reservation owner from the audit record or release the slot atomically.",
      sqlPreview:
        "UPDATE slots SET status = 'available', reservation_group_id = NULL, reserved_x_id_snapshot = NULL WHERE id = '<slot_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `slot:${text(r.id)}`,
        description: "reserved slot has no reserved_by_user_id",
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_group_mixed_owner",
      area: "slots",
      title: "reservation group has mixed auth owners",
      severity: "warning",
      description:
        "Rows in a reservation group should share one reserved_by_user_id; mixed rows require recovery review.",
      from: sql`(
        SELECT reservation_group_id,
               COUNT(DISTINCT COALESCE(trim(reserved_by_user_id), '')) AS owner_count,
               MIN(event_id) AS event_id
        FROM slots
        WHERE reservation_group_id IS NOT NULL AND trim(reservation_group_id) <> ''
        GROUP BY reservation_group_id
        HAVING COUNT(DISTINCT COALESCE(trim(reserved_by_user_id), '')) > 1
      ) AS mixed`,
      where: sql`1 = 1`,
      sampleSelect: {
        reservation_group_id: sql<string>`reservation_group_id`,
        owner_count: sql<number>`owner_count`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "Review the group split/adoption audit before allowing submission or release.",
      sqlPreview:
        "SELECT * FROM slots WHERE reservation_group_id = '<reservation_group_id>' ORDER BY start_time, id;",
      mapIssue: (r) => ({
        id: text(r.reservation_group_id),
        title: `group:${text(r.reservation_group_id)}`,
        description: `auth owner variants:${text(r.owner_count)}`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_group_mixed_x_identity",
      area: "slots",
      title: "reservation group has mixed X identities",
      severity: "danger",
      description:
        "Rows in a reservation group should resolve to one normalized X identity across x_user_id and reserved_x_id_snapshot.",
      from: sql`(
        SELECT reservation_group_id,
               COUNT(DISTINCT lower(trim(ltrim(
                 COALESCE(
                   NULLIF(trim(x_user_id), ''),
                   NULLIF(trim(reserved_x_id_snapshot), '')
                 ), '@'
               )))) AS x_identity_count,
               SUM(CASE WHEN NULLIF(trim(x_user_id), '') IS NOT NULL
                   AND NULLIF(trim(reserved_x_id_snapshot), '') IS NOT NULL
                   AND lower(trim(ltrim(x_user_id, '@'))) <> lower(trim(ltrim(reserved_x_id_snapshot, '@')))
                 THEN 1 ELSE 0 END) AS row_identity_mismatch_count,
               MIN(event_id) AS event_id
        FROM slots
        WHERE reservation_group_id IS NOT NULL AND trim(reservation_group_id) <> ''
        GROUP BY reservation_group_id
        HAVING COUNT(DISTINCT lower(trim(ltrim(
          COALESCE(
            NULLIF(trim(x_user_id), ''),
            NULLIF(trim(reserved_x_id_snapshot), '')
          ), '@'
        )))) > 1
        OR SUM(CASE WHEN NULLIF(trim(x_user_id), '') IS NOT NULL
                 AND NULLIF(trim(reserved_x_id_snapshot), '') IS NOT NULL
                 AND lower(trim(ltrim(x_user_id, '@'))) <> lower(trim(ltrim(reserved_x_id_snapshot, '@')))
               THEN 1 ELSE 0 END) > 0
      ) AS mixed`,
      where: sql`1 = 1`,
      sampleSelect: {
        reservation_group_id: sql<string>`reservation_group_id`,
        x_identity_count: sql<number>`x_identity_count`,
        row_identity_mismatch_count: sql<number>`row_identity_mismatch_count`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "Reconcile x_user_id and reserved_x_id_snapshot to one normalized X identity before allowing another group mutation.",
      sqlPreview:
        "SELECT * FROM slots WHERE reservation_group_id = '<reservation_group_id>' ORDER BY start_time, id;",
      mapIssue: (r) => ({
        id: text(r.reservation_group_id),
        title: `group:${text(r.reservation_group_id)}`,
        description: `X identity variants:${text(r.x_identity_count)} / row mismatches:${text(r.row_identity_mismatch_count)}`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeCheck({
      db,
      id: "slots_submitted_group_mixed_video",
      area: "slots",
      title: "submitted reservation group has mixed videos",
      severity: "danger",
      description:
        "Submitted rows in one reservation group must point at one video.",
      from: sql`(
        SELECT reservation_group_id, COUNT(DISTINCT video_id) AS video_count,
               MIN(event_id) AS event_id
        FROM slots
        WHERE reservation_group_id IS NOT NULL
          AND status = 'submitted'
          AND video_id IS NOT NULL AND trim(video_id) <> ''
        GROUP BY reservation_group_id
        HAVING COUNT(DISTINCT video_id) > 1
      ) AS mixed`,
      where: sql`1 = 1`,
      sampleSelect: {
        reservation_group_id: sql<string>`reservation_group_id`,
        video_count: sql<number>`video_count`,
        event_id: sql<string>`event_id`,
      },
      recommendation:
        "Keep one video_id for the submitted group or split the group before resubmitting.",
      sqlPreview:
        "SELECT * FROM slots WHERE reservation_group_id = '<reservation_group_id>' ORDER BY start_time, id;",
      mapIssue: (r) => ({
        id: text(r.reservation_group_id),
        title: `group:${text(r.reservation_group_id)}`,
        description: `submitted video variants:${text(r.video_count)}`,
        adminHref: eventHref(text(r.event_id)),
      }),
    }),
    makeSlotDuplicateStartTimeCheck(db),
    makeCheck({
      db,
      id: "derived_missing_youtube_metadata",
      area: "derived rows",
      title: "video_youtube_metadata 派生行欠落",
      severity: "warning",
      description: "videos に対応する video_youtube_metadata が存在しない作品。",
      from: sql`videos`,
      where: sql`NOT EXISTS (SELECT 1 FROM video_youtube_metadata ym WHERE ym.video_id = videos.id)`,
      sampleSelect: {
        id: sql<string>`id`,
        title: sql<string>`title`,
        youtube_video_id: sql<string>`youtube_video_id`,
      },
      recommendation:
        "YouTube 同期キューに拾われません。video_youtube_metadata を pending で作成してください。",
      sqlPreview:
        "INSERT INTO video_youtube_metadata (video_id, sync_status, updated_at) VALUES ('<video_id>', 'pending', unixepoch());",
      mapIssue: (r) => ({
        id: text(r.id),
        title: text(r.title),
        description: `youtube_video_id: ${text(r.youtube_video_id) || "なし"}`,
        adminHref: videoHref(text(r.id)),
      }),
    }),
    makeCheck({
      db,
      id: "derived_orphan_youtube_metadata",
      area: "derived rows",
      title: "video_youtube_metadata 孤立",
      severity: "warning",
      description: "metadata.video_id に対応する videos.id が無い行。",
      from: sql`video_youtube_metadata`,
      where: sql`NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = video_youtube_metadata.video_id)`,
      sampleSelect: {
        video_id: sql<string>`video_id`,
        sync_status: sql<string>`sync_status`,
      },
      recommendation:
        "元動画が削除された可能性があります。不要なら metadata 行を削除してください。",
      sqlPreview:
        "DELETE FROM video_youtube_metadata WHERE video_id = '<video_id>';",
      mapIssue: (r) => ({
        id: text(r.video_id),
        title: `video:${text(r.video_id)}`,
        description: `sync_status: ${text(r.sync_status) || "なし"}`,
      }),
    }),
    makeCheck({
      db,
      id: "audit_videos_orphan",
      area: "audit_logs",
      title: "audit_logs videos target 孤立",
      severity: "info",
      description: "table_name=videos の target_id に対応する videos.id が無い監査ログ。",
      from: sql`audit_logs`,
      where: sql`table_name = 'videos' AND NOT EXISTS (SELECT 1 FROM videos v WHERE v.id = audit_logs.target_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        target_id: sql<string>`target_id`,
      },
      recommendation:
        "論理削除や移行の履歴であれば問題ありません。不要なら保持期間を確認してください。",
      sqlPreview:
        "SELECT * FROM audit_logs WHERE table_name = 'videos' AND target_id = '<video_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `audit #${text(r.id)}`,
        description: `target_id:${text(r.target_id)} の動画が見つかりません。`,
        adminHref: `/admin/audit/${text(r.id)}`,
      }),
    }),
    makeCheck({
      db,
      id: "audit_events_orphan",
      area: "audit_logs",
      title: "audit_logs events target 孤立",
      severity: "info",
      description: "table_name=events の target_id に対応する events.id が無い監査ログ。",
      from: sql`audit_logs`,
      where: sql`table_name = 'events' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = audit_logs.target_id)`,
      sampleSelect: {
        id: sql<string>`id`,
        target_id: sql<string>`target_id`,
      },
      recommendation:
        "削除済みイベントの監査履歴であれば問題ありません。復元対象かどうかを確認してください。",
      sqlPreview:
        "SELECT * FROM audit_logs WHERE table_name = 'events' AND target_id = '<event_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `audit #${text(r.id)}`,
        description: `target_id:${text(r.target_id)} のイベントが見つかりません。`,
        adminHref: `/admin/audit/${text(r.id)}`,
      }),
    }),
    makeCheck({
      db,
      id: "audit_x_users_orphan",
      area: "audit_logs",
      title: "audit_logs x_users target 孤立",
      severity: "info",
      description: "table_name=x_users の target_id に対応する x_users.id が無い監査ログ。",
      from: sql`audit_logs`,
      where: sql`table_name = 'x_users' AND NOT EXISTS (SELECT 1 FROM x_users xu WHERE lower(xu.id) = lower(audit_logs.target_id))`,
      sampleSelect: {
        id: sql<string>`id`,
        target_id: sql<string>`target_id`,
      },
      recommendation:
        "X ID 統合・削除の履歴であれば問題ありません。現在の X ID へ統合済みか確認してください。",
      sqlPreview:
        "SELECT * FROM audit_logs WHERE table_name = 'x_users' AND target_id = '<x_id>';",
      mapIssue: (r) => ({
        id: text(r.id),
        title: `audit #${text(r.id)}`,
        description: `target_id:@${text(r.target_id)} の X ID が見つかりません。`,
        adminHref: `/admin/audit/${text(r.id)}`,
      }),
    }),
    ]),
    buildPermissionIntegrityChecks(db),
  ]);
  return [...base, ...permission];
}
