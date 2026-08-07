import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { users, xUsers } from "@/lib/db/schema";

import { escapeDiscordMention, type DiscordBlock } from "./templates/common";

type AnyDb = LibSQLDatabase<any>;

export type NotificationActor = {
  userId: string;
  discordId: string | null;
  discordName: string | null;
  activeXId: string | null;
  activeXName: string | null;
};

/** 通知操作者の Discord / Active X / 内部 user_id を1クエリで取得する。 */
export async function resolveNotificationActor(
  db: AnyDb,
  authUserId: string,
): Promise<NotificationActor | null> {
  const row = await db
    .select({
      userId: users.id,
      discordId: users.discord_id,
      discordName: users.name,
      activeXId: users.active_x_user_id,
      activeXName: xUsers.x_name,
    })
    .from(users)
    .leftJoin(xUsers, eq(xUsers.id, users.active_x_user_id))
    .where(eq(users.id, authUserId))
    .get();

  if (!row) return null;
  return {
    userId: row.userId,
    discordId: row.discordId ?? null,
    discordName: row.discordName ?? null,
    activeXId: row.activeXId ?? null,
    activeXName: row.activeXName ?? null,
  };
}

/** Active X の表示ラベル（運営通知・チャンネル通知共通）。 */
export function formatActiveXLabel(actor: {
  activeXId?: string | null;
  activeXName?: string | null;
}): string {
  const id = actor.activeXId?.trim() || null;
  const name = actor.activeXName?.trim() || null;
  if (!id && !name) return "未設定";
  if (id && name) {
    return `${escapeDiscordMention(name)} (${escapeDiscordMention(`@${id}`)})`;
  }
  if (id) return `X名義未取得 (${escapeDiscordMention(`@${id}`)})`;
  return escapeDiscordMention(name!);
}

/** 承認直後など DB 未反映の Active X を actor に上書きする（既存 Active X は維持）。 */
export function overlayNotificationActorActiveX(
  actor: NotificationActor | null,
  next: { activeXId: string; activeXName: string | null } | null,
): NotificationActor | null {
  if (!actor || !next) return actor;
  if (actor.activeXId?.trim()) return actor;
  return {
    ...actor,
    activeXId: next.activeXId,
    activeXName: next.activeXName,
  };
}

/** 運営 Webhook 文面用の操作者ブロック。 */
export function formatOpsActorSection(
  actor: NotificationActor | null,
  heading = "■ 操作者",
): DiscordBlock {
  if (!actor) {
    return {
      heading,
      lines: ["操作者情報を取得できませんでした。"],
    };
  }
  const discordId = actor.discordId?.trim() || null;
  const discordName = actor.discordName?.trim() || null;
  const discordLabel =
    discordName && discordId
      ? `${discordName} (${discordId})`
      : discordName
        ? discordName
        : discordId
          ? `未取得 (${discordId})`
          : "未設定";
  return {
    heading,
    lines: [
      `Active X: ${formatActiveXLabel(actor)}`,
      `Discord: ${discordLabel}`,
      `user_id: ${actor.userId}`,
    ],
  };
}
