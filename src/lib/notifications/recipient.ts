import { inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { users } from "@/lib/db/schema";

type AnyDb = LibSQLDatabase<any>;

export type RecipientLookup = {
  userId: string;
  discordId: string | null;
  userName: string | null;
  notificationsEnabled: boolean | null;
};

/**
 * recipient_user_id 一覧から users テーブルを引く (最大100件想定)。
 */
export async function lookupNotificationRecipients(
  db: AnyDb,
  userIds: string[],
): Promise<Map<string, RecipientLookup>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, RecipientLookup>();
  if (unique.length === 0) return map;

  const rows = await db
    .select({
      id: users.id,
      discord_id: users.discord_id,
      name: users.name,
      is_notification_enabled: users.is_notification_enabled,
    })
    .from(users)
    .where(inArray(users.id, unique));

  for (const r of rows) {
    map.set(r.id, {
      userId: r.id,
      discordId: r.discord_id,
      userName: r.name,
      notificationsEnabled: r.is_notification_enabled === 0 ? false : true,
    });
  }
  return map;
}

export function formatRecipientDisplay(
  userId: string,
  lookup?: RecipientLookup | null,
): string {
  if (lookup?.userName) {
    return lookup.discordId
      ? `${lookup.userName} (${lookup.discordId})`
      : lookup.userName;
  }
  return lookup?.discordId ?? userId;
}
