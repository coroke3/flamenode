import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { announcements } from "@/lib/db/schema";

type DB = LibSQLDatabase<any>;

export interface PublicAnnouncement {
  id: string;
  title: string;
  body: string;
  severity: "info" | "warning" | "danger" | null;
  publish_at: number | null;
  expire_at: number | null;
}

export async function fetchPublicAnnouncements(
  db: DB,
  audience: "all" | "creators" | "admins" = "all",
  limit = 3,
): Promise<PublicAnnouncement[]> {
  const now = Math.floor(Date.now() / 1000);
  const safeLimit = Math.max(1, Math.min(5, Math.floor(limit)));
  return db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      severity: announcements.severity,
      publish_at: announcements.publish_at,
      expire_at: announcements.expire_at,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.is_published, 1),
        eq(announcements.target_audience, audience),
        or(isNull(announcements.publish_at), lte(announcements.publish_at, now)),
        or(isNull(announcements.expire_at), gt(announcements.expire_at, now)),
      ),
    )
    .orderBy(desc(announcements.publish_at), desc(announcements.updated_at))
    .limit(safeLimit);
}
