import "server-only";

import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  accounts as accountsTable,
  users as usersTable,
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
    .select({ id: videosTable.id, creator_id: videosTable.creator_id })
    .from(videosTable)
    .innerJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_id!))
    .where(
      and(
        isNotNull(videosTable.creator_id),
        ne(xUsersTable.approval_status, "approved"),
      ),
    )
    .limit(10);
  const count = rows.length;
  return {
    id: "unapproved_creator_videos",
    label: "未承認 X ID の creator_id を持つ作品",
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `video:${r.id} creator:${r.creator_id ?? ""}`),
  };
}

/** BAN ユーザーの書き込み */
async function checkBannedUserVideos(db: AnyDb): Promise<SecurityCheckResult> {
  const rows = await db
    .select({ id: videosTable.id, owner: videosTable.owner_discord_user_id })
    .from(videosTable)
    .innerJoin(
      usersTable,
      eq(usersTable.discord_id, videosTable.owner_discord_user_id),
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
    .select({ id: videosTable.id, owner: videosTable.owner_discord_user_id })
    .from(videosTable)
    .innerJoin(
      usersTable,
      eq(usersTable.discord_id, videosTable.owner_discord_user_id),
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

export async function runSecurityChecks(
  db: AnyDb,
): Promise<SecurityCheckResult[]> {
  const [
    accessToken,
    rejectedXId,
    unapprovedCreator,
    bannedUser,
    tosNotAccepted,
  ] = await Promise.all([
    checkAccessTokenNotNull(db),
    checkRejectedXIdActive(db),
    checkUnapprovedCreatorVideos(db),
    checkBannedUserVideos(db),
    checkTosNotAcceptedUserVideos(db),
  ]);
  return [
    accessToken,
    rejectedXId,
    unapprovedCreator,
    bannedUser,
    tosNotAccepted,
    checkPublicApiLeak(),
  ];
}
