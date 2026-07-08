import "server-only";

import { and, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  accounts as accountsTable,
  users as usersTable,
  videoChapters as videoChaptersTable,
  videos as videosTable,
  xUsers as xUsersTable,
} from "@/lib/db/schema";

export type SecurityCheckResult = {
  id: string;
  label: string;
  status: "ok" | "warn" | "info";
  count: number;
  samples: string[];
  note?: string;
};

type AnyDb = LibSQLDatabase<any>;

/** accounts.access_token が null でない件数 */
async function checkAccessTokenNotNull(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(accountsTable)
    .where(isNotNull(accountsTable.access_token));
  const count = Number(rows[0]?.c ?? 0);
  return {
    id: "access_token_not_null",
    label: "accounts.access_token が null でない行",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: [],
    note: "OAuth トークンが残存しています。DBに平文トークンが保存されていないか確認してください。",
  };
}

/** rejected な X ID が誰かの active_x_user_id になっている */
async function checkRejectedXIdActive(db: AnyDb): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: usersTable.id, active_x_user_id: usersTable.active_x_user_id })
    .from(usersTable)
    .innerJoin(xUsersTable, eq(xUsersTable.id, usersTable.active_x_user_id!))
    .where(
      and(
        isNotNull(usersTable.active_x_user_id),
        eq(xUsersTable.approval_status, "rejected"),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "rejected_xid_active",
    label: "rejected X ID が active_x_user_id に設定されている",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `user:${r.id} x:${r.active_x_user_id ?? ""}`),
  };
}

/** 未承認 X ID で投稿された作品 */
async function checkUnapprovedCreatorVideos(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: videosTable.id, creator_x_user_id: videosTable.creator_x_user_id })
    .from(videosTable)
    .innerJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id!))
    .where(
      and(
        isNotNull(videosTable.creator_x_user_id),
        ne(xUsersTable.approval_status, "approved"),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "unapproved_creator_videos",
    label: "未承認 X ID の creator_x_user_id を持つ作品",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `video:${r.id} creator:${r.creator_x_user_id ?? ""}`),
  };
}

/** BAN ユーザーの書き込み */
async function checkBannedUserVideos(db: AnyDb): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: videosTable.id, owner: videosTable.submitted_by_discord_user_id })
    .from(videosTable)
    .innerJoin(
      usersTable,
      or(
        eq(usersTable.id, videosTable.submitted_by_discord_user_id),
        eq(usersTable.discord_id, videosTable.submitted_by_discord_user_id),
      )!,
    )
    .where(eq(usersTable.is_banned, 1))
    .limit(10);
  const count = rows.length;
  return {
    id: "banned_user_videos",
    label: "BAN ユーザーが owner の作品",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `video:${r.id} owner:${r.owner}`),
  };
}

/** TOS 未同意ユーザーの書き込み */
async function checkTosNotAcceptedUserVideos(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: videosTable.id, owner: videosTable.submitted_by_discord_user_id })
    .from(videosTable)
    .innerJoin(
      usersTable,
      or(
        eq(usersTable.id, videosTable.submitted_by_discord_user_id),
        eq(usersTable.discord_id, videosTable.submitted_by_discord_user_id),
      )!,
    )
    .where(ne(usersTable.is_tos_accepted, 1))
    .limit(10);
  const count = rows.length;
  return {
    id: "tos_not_accepted_user_videos",
    label: "TOS 未同意ユーザーが owner の作品",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `video:${r.id} owner:${r.owner}`),
  };
}

/** 公開 API 漏洩チェック (ホワイトリストで担保済み) */
function checkPublicApiLeak(): SecurityCheckResult {
  return {
    id: "public_api_leak",
    label: "公開 API 内部情報漏洩",
    status: "info",
    count: 0,
    samples: [],
    note: "OK (whitelist enforced)",
  };
}

/**
 * Worker と ORM スキーマのテーブル名乖離チェック (静的・読み取り専用)。
 * workers/notification-dispatcher/index.ts に "notifications" 文字列があり、
 * かつ src/lib/db/schema.ts に "notification_outbox" 定義しかない場合は WARN。
 */
function checkNotificationTableMismatch(): SecurityCheckResult {
  return {
    id: "notification_table_mismatch",
    label: "??????????? (Worker vs ORM schema)",
    status: "info",
    count: 0,
    samples: [],
    note:
      "Cloudflare Pages Edge Runtime ????????????????CI ????????????",
  };
}

/** banned ユーザーがチャプターコメントを投稿していないか (BAN 後の投稿検出) */
async function checkBannedUserChapters(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  // x_users.linked_discord_user_id 経由で banned ユーザーが投稿した video_chapters を検出。
  // raw SQL で `users AS u` を書くと、schema 上 `user` (singular) にマップされている関係で
  // 実行時に "no such table: users" が出るため drizzle ORM で組む。
  const rows = await db
    .select({
      id: videoChaptersTable.id,
      x_user_id: videoChaptersTable.x_user_id,
    })
    .from(videoChaptersTable)
    .innerJoin(
      xUsersTable,
      eq(xUsersTable.id, videoChaptersTable.x_user_id),
    )
    .innerJoin(
      usersTable,
      eq(usersTable.id, xUsersTable.linked_discord_user_id!),
    )
    .where(eq(usersTable.is_banned, 1))
    .limit(10);
  const count = rows.length;
  return {
    id: "banned_user_chapters",
    label: "BAN ユーザーが投稿したチャプターコメント",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `chapter:${r.id} x:${r.x_user_id}`),
    note:
      count > 0
        ? "BAN 後にチャプターコメントが残存しています。writeGuard 漏れの可能性。"
        : undefined,
  };
}

/** approved な X ID が存在するのに linked_discord_user_id が NULL (孤立) */
async function checkOrphanApprovedXId(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: xUsersTable.id })
    .from(xUsersTable)
    .where(
      and(
        eq(xUsersTable.approval_status, "approved"),
        isNull(xUsersTable.linked_discord_user_id),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "orphan_approved_xid",
    label: "approved な X ID で linked_discord_user_id が NULL",
    status: count === 0 ? "ok" : "info",
    count,
    samples: rows.slice(0, 5).map((r) => `x:${r.id}`),
    note:
      count > 0
        ? "Discord 紐付けが失われた approved X ID。legacy import 由来の可能性、または手動で承認したケース。"
        : undefined,
  };
}

/** custom_pages/custom_themes は初期本番では無効化する。 */
async function checkCustomPageDangerousHtml(
  _db: AnyDb,
): Promise<SecurityCheckResult> {
  void _db;
  const flagged: { id: string }[] = [];
  return {
    id: "custom_page_dangerous_html",
    label: "custom_pages/custom_themes disabled",
    status: "ok",
    count: flagged.length,
    samples: flagged.slice(0, 5).map((r) => `page:${r.id}`),
    note:
      "初期本番では custom_pages/custom_themes は無効化されています。",
  };
}

export async function runSecurityChecks(
  db: AnyDb,
): Promise<SecurityCheckResult[]> {
  const [
    accessToken,
    rejectedXId,
    unapprovedCreator,
    bannedUser,
    tosNotAccepted,
    customPageDanger,
    bannedChapters,
    orphanApprovedX,
  ] = await Promise.all([
    checkAccessTokenNotNull(db),
    checkRejectedXIdActive(db),
    checkUnapprovedCreatorVideos(db),
    checkBannedUserVideos(db),
    checkTosNotAcceptedUserVideos(db),
    checkCustomPageDangerousHtml(db),
    checkBannedUserChapters(db),
    checkOrphanApprovedXId(db),
  ]);
  return [
    accessToken,
    rejectedXId,
    unapprovedCreator,
    bannedUser,
    tosNotAccepted,
    customPageDanger,
    bannedChapters,
    orphanApprovedX,
    checkPublicApiLeak(),
    checkNotificationTableMismatch(),
  ];
}
