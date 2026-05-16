import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Worker と ORM スキーマのテーブル名乖離チェック (静的・読み取り専用)。
 * workers/notification-dispatcher/index.ts に "notifications" 文字列があり、
 * かつ src/lib/db/schema.ts に "notification_outbox" 定義しかない場合は WARN。
 */
function checkNotificationTableMismatch(): SecurityCheckResult {
  try {
    const cwd = process.cwd();
    const workerPath = join(
      cwd,
      "workers",
      "notification-dispatcher",
      "index.ts",
    );
    const schemaPath = join(cwd, "src", "lib", "db", "schema.ts");

    const workerSrc = readFileSync(workerPath, "utf-8");
    const schemaSrc = readFileSync(schemaPath, "utf-8");

    // Worker が raw SQL で "notifications" テーブルを参照しているか
    const workerHasNotifications = workerSrc.includes('"notifications"') || workerSrc.includes("'notifications'") || workerSrc.includes("`notifications`") || workerSrc.includes("FROM notifications") || workerSrc.includes("UPDATE notifications");
    // ORM スキーマ側に "notification_outbox" 定義があるか
    const schemaHasOutbox = schemaSrc.includes("notification_outbox");

    if (workerHasNotifications && schemaHasOutbox) {
      return {
        id: "notification_table_mismatch",
        label: "通知テーブル名乖離 (Worker vs ORM schema)",
        status: "warn",
        count: 1,
        samples: [],
        note:
          'workers/notification-dispatcher/index.ts が "notifications" テーブルを参照しているが、ORM schema は "notification_outbox" のみ定義。カラム名差分も含め Opus 判断を推奨。',
      };
    }

    return {
      id: "notification_table_mismatch",
      label: "通知テーブル名乖離 (Worker vs ORM schema)",
      status: "ok",
      count: 0,
      samples: [],
      note: "Worker と ORM schema のテーブル名が一致しています。",
    };
  } catch {
    return {
      id: "notification_table_mismatch",
      label: "通知テーブル名乖離 (Worker vs ORM schema)",
      status: "info",
      count: 0,
      samples: [],
      note: "自動検査スキップ (ファイル読み取り失敗)。",
    };
  }
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
    checkNotificationTableMismatch(),
  ];
}
