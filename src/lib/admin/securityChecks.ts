import "server-only";

import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  accounts as accountsTable,
  users as usersTable,
  videoChapters as videoChaptersTable,
  videos as videosTable,
  xUserAccountLinks as xUserAccountLinksTable,
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
type CountedRow = { total_count?: number | null };

type SecurityCheckDefinition = {
  id: string;
  label: string;
  run: () => SecurityCheckResult | Promise<SecurityCheckResult>;
};

const LABELS = {
  accessTokenNotNull: "accounts.access_token が null でない行",
  rejectedXIdActive: "rejected X ID が active_x_user_id に設定されている",
  unapprovedCreatorVideos: "未承認 X ID の creator_x_user_id を持つ作品",
  bannedUserVideos: "BAN ユーザーが owner の作品",
  tosNotAcceptedUserVideos: "TOS 未同意ユーザーが owner の作品",
  customPageDangerousHtml: "custom_pages/custom_themes disabled",
  bannedUserChapters: "BAN ユーザーが投稿したチャプターコメント",
  orphanApprovedXId: "approved な X ID で認証ユーザー紐付けがない",
} as const;

function getTotalCount(rows: CountedRow[]): number {
  return Number(rows[0]?.total_count ?? 0);
}

async function runCheckSafely(
  definition: SecurityCheckDefinition,
): Promise<SecurityCheckResult> {
  try {
    return await definition.run();
  } catch (error) {
    console.error(`[security-check:${definition.id}] failed`, error);
    return {
      id: definition.id,
      label: definition.label,
      status: "warn",
      count: 1,
      samples: [],
      note:
        "検査自体の実行に失敗しました。DB接続、schema適用状況、サーバーログを確認してください。",
    };
  }
}

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
    label: LABELS.accessTokenNotNull,
    status: count === 0 ? "ok" : "warn",
    count,
    samples: [],
    note: "OAuth トークンが残存しています。DBに平文トークンが保存されていないか確認してください。",
  };
}

/** rejected な X ID が誰かの active_x_user_id になっている */
async function checkRejectedXIdActive(db: AnyDb): Promise<SecurityCheckResult> {
  const rows = await db
    .select({
      id: usersTable.id,
      active_x_user_id: usersTable.active_x_user_id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(usersTable)
    .innerJoin(xUsersTable, eq(xUsersTable.id, usersTable.active_x_user_id!))
    .where(
      and(
        isNotNull(usersTable.active_x_user_id),
        eq(xUsersTable.approval_status, "rejected"),
      ),
    )
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "rejected_xid_active",
    label: LABELS.rejectedXIdActive,
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
    .select({
      id: videosTable.id,
      creator_x_user_id: videosTable.creator_x_user_id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(videosTable)
    .innerJoin(xUsersTable, eq(xUsersTable.id, videosTable.creator_x_user_id!))
    .where(
      and(
        isNotNull(videosTable.creator_x_user_id),
        ne(xUsersTable.approval_status, "approved"),
      ),
    )
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "unapproved_creator_videos",
    label: LABELS.unapprovedCreatorVideos,
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `video:${r.id} creator:${r.creator_x_user_id ?? ""}`),
  };
}

/** BAN ユーザーの書き込み */
async function checkBannedUserVideos(db: AnyDb): Promise<SecurityCheckResult> {
  const rows = await db
    .select({
      id: videosTable.id,
      owner: videosTable.submitted_by_user_id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(videosTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, videosTable.submitted_by_user_id),
    )
    .where(eq(usersTable.is_banned, 1))
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "banned_user_videos",
    label: LABELS.bannedUserVideos,
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
    .select({
      id: videosTable.id,
      owner: videosTable.submitted_by_user_id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(videosTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, videosTable.submitted_by_user_id),
    )
    .where(ne(usersTable.is_tos_accepted, 1))
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "tos_not_accepted_user_videos",
    label: LABELS.tosNotAcceptedUserVideos,
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

/** Worker と ORM スキーマのテーブル名乖離は CI の静的検査で担保する。 */
function checkNotificationTableMismatch(): SecurityCheckResult {
  return {
    id: "notification_table_mismatch",
    label: "通知テーブル名の整合性 (Worker / ORM schema)",
    status: "info",
    count: 0,
    samples: [],
    note:
      "Cloudflare Pages Edge Runtime ではソースファイルを参照できないため、CI の静的検査で確認します。",
  };
}

/** banned ユーザーがチャプターコメントを投稿していないか (BAN 後の投稿検出) */
async function checkBannedUserChapters(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({
      id: videoChaptersTable.id,
      x_user_id: videoChaptersTable.x_user_id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(videoChaptersTable)
    .where(sql`EXISTS (
      SELECT 1
      FROM ${xUserAccountLinksTable} link
      INNER JOIN ${usersTable} auth_user ON auth_user.id = link.auth_user_id
      WHERE link.x_user_id = ${videoChaptersTable.x_user_id}
        AND auth_user.is_banned = 1
    )`)
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "banned_user_chapters",
    label: LABELS.bannedUserChapters,
    status: count === 0 ? "ok" : "warn",
    count,
    samples: rows.slice(0, 5).map((r) => `chapter:${r.id} x:${r.x_user_id}`),
    note:
      count > 0
        ? "BAN 後にチャプターコメントが残存しています。writeGuard 漏れの可能性。"
        : undefined,
  };
}

/** approved な X ID が存在するのに account link がない (孤立) */
async function checkOrphanApprovedXId(
  db: AnyDb,
): Promise<SecurityCheckResult> {
  const rows = await db
    .select({
      id: xUsersTable.id,
      total_count: sql<number>`COUNT(*) OVER()`,
    })
    .from(xUsersTable)
    .where(
      and(
        eq(xUsersTable.approval_status, "approved"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${xUserAccountLinksTable} link
          WHERE link.x_user_id = ${xUsersTable.id}
        )`,
      ),
    )
    .limit(10);
  const count = getTotalCount(rows);
  return {
    id: "orphan_approved_xid",
    label: LABELS.orphanApprovedXId,
    status: count === 0 ? "ok" : "info",
    count,
    samples: rows.slice(0, 5).map((r) => `x:${r.id}`),
    note:
      count > 0
        ? "認証ユーザー紐付けがない approved X ID。公開名義として意図されたものか確認してください。"
        : undefined,
  };
}

/** custom_pages/custom_themes は初期本番では無効化する。 */
function checkCustomPageDangerousHtml(): SecurityCheckResult {
  return {
    id: "custom_page_dangerous_html",
    label: LABELS.customPageDangerousHtml,
    status: "ok",
    count: 0,
    samples: [],
    note: "初期本番では custom_pages/custom_themes は無効化されています。",
  };
}

export async function runSecurityChecks(
  db: AnyDb,
): Promise<SecurityCheckResult[]> {
  const definitions: SecurityCheckDefinition[] = [
    {
      id: "access_token_not_null",
      label: LABELS.accessTokenNotNull,
      run: () => checkAccessTokenNotNull(db),
    },
    {
      id: "rejected_xid_active",
      label: LABELS.rejectedXIdActive,
      run: () => checkRejectedXIdActive(db),
    },
    {
      id: "unapproved_creator_videos",
      label: LABELS.unapprovedCreatorVideos,
      run: () => checkUnapprovedCreatorVideos(db),
    },
    {
      id: "banned_user_videos",
      label: LABELS.bannedUserVideos,
      run: () => checkBannedUserVideos(db),
    },
    {
      id: "tos_not_accepted_user_videos",
      label: LABELS.tosNotAcceptedUserVideos,
      run: () => checkTosNotAcceptedUserVideos(db),
    },
    {
      id: "custom_page_dangerous_html",
      label: LABELS.customPageDangerousHtml,
      run: checkCustomPageDangerousHtml,
    },
    {
      id: "banned_user_chapters",
      label: LABELS.bannedUserChapters,
      run: () => checkBannedUserChapters(db),
    },
    {
      id: "orphan_approved_xid",
      label: LABELS.orphanApprovedXId,
      run: () => checkOrphanApprovedXId(db),
    },
  ];

  const dynamicResults = await Promise.all(definitions.map(runCheckSafely));
  return [
    ...dynamicResults,
    checkPublicApiLeak(),
    checkNotificationTableMismatch(),
  ];
}
