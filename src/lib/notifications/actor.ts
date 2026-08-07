import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { users, xUsers } from "@/lib/db/schema";

import type { DiscordBlock } from "./templates/common";

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
  return {
    heading,
    lines: [
      `Active X: ${actor.activeXName?.trim() || "未設定"} (${actor.activeXId?.trim() || "未設定"})`,
      `Discord: ${actor.discordName?.trim() || "未設定"} (${actor.discordId?.trim() || "未設定"})`,
      `user_id: ${actor.userId}`,
    ],
  };
}
