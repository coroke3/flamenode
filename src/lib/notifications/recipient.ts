import { inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { users } from "@/lib/db/schema";

type AnyDb = LibSQLDatabase<any>;

export type RecipientLookup = {
  discordUserId: string;
  userName: string | null;
  notificationsEnabled: boolean | null;
};

/**
 * discord_user_id 一覧から users テーブルを引く (最大100件想定)。
 */
export async function lookupNotificationRecipients(
  db: AnyDb,
  discordUserIds: string[],
): Promise<Map<string, RecipientLookup>> {
  const unique = [...new Set(discordUserIds.filter(Boolean))];
  const map = new Map<string, RecipientLookup>();
  if (unique.length === 0) return map;

  const rows = await db
    .select({
      discord_id: users.discord_id,
      name: users.name,
      is_notification_enabled: users.is_notification_enabled,
    })
    .from(users)
    .where(inArray(users.discord_id, unique));

  for (const r of rows) {
    if (!r.discord_id) continue;
    map.set(r.discord_id, {
      discordUserId: r.discord_id,
      userName: r.name,
      notificationsEnabled: r.is_notification_enabled === 0 ? false : true,
    });
  }
  return map;
}

export function formatRecipientDisplay(
  discordUserId: string,
  lookup?: RecipientLookup | null,
): string {
  if (lookup?.userName) {
    return `${lookup.userName} (${discordUserId})`;
  }
  return discordUserId;
}
