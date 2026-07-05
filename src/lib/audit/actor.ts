import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { users, xUsers } from "@/lib/db/schema";
import type { ActorSnapshot } from "./types";

/**
 * ユーザーID から監査ログ用アクタースナップショットを構築する。
 * Discord 名・X ID・アイコン URL などを当時の値として固定するために使う。
 */
export async function buildActorSnapshot(
  db: DB,
  userId: string,
): Promise<ActorSnapshot> {
  const user = await db
    .select({
      discord_id: users.discord_id,
      name: users.name,
      active_x_user_id: users.active_x_user_id,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user) {
    return {
      discord_user_id: null,
      discord_name: null,
      x_user_id: null,
      x_name: null,
      icon_url: null,
    };
  }

  let x_name: string | null = null;
  let icon_url: string | null = user.image ?? null;

  if (user.active_x_user_id) {
    const xUser = await db
      .select({
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
      })
      .from(xUsers)
      .where(eq(xUsers.id, user.active_x_user_id))
      .get();

    if (xUser) {
      x_name = xUser.x_name;
      if (xUser.icon_url) icon_url = xUser.icon_url;
    }
  }

  return {
    discord_user_id: user.discord_id ?? null,
    discord_name: user.name ?? null,
    x_user_id: user.active_x_user_id ?? null,
    x_name,
    icon_url,
  };
}
