/**
 * MIG-0602 U02: SA-004..006 announcement lifecycle on Hono.
 * CURRENT: src/lib/actions/announcement.ts (createAnnouncement /
 * updateAnnouncement / deleteAnnouncement). Result bodies keep the CURRENT
 * AnnouncementResult shape ({ok, message?, id?}); HTTP status is added:
 *   validation 400 / not found 404 / stale base_updated_at 409 /
 *   atomic mutation failure 500 (CURRENT generic message).
 * The route is mounted behind session -> writeGuard -> CostGuard
 * ("admin_announcement_broadcast"). Next revalidatePath has no Hono
 * equivalent (the Astro/Hono read side does not use the Next cache).
 */
import {
  type AnnouncementResult,
  validateAnnouncementInput,
} from "@flamenode/domain/announcements";
import { AnnouncementWriteBodySchema } from "@flamenode/contracts";
import { Hono } from "hono";
import type { AppEnv } from "../../env.ts";
import {
  generateId,
  MAX_SINGLE_ROW_LIMIT,
  mutateWithAudit,
} from "../../audit/mutateWithAudit.ts";
import {
  auditPreloaded,
  BODY_TOO_LARGE_MESSAGE,
  readAdminJsonBody,
} from "./body.ts";
import { buildAnnouncementChangeQueueStatement } from "../../audit/staticRebuildQueue.ts";
import { costGuardMiddleware } from "../../middleware/costGuard.ts";
import { onlyMutating } from "../../middleware/writeOrigin.ts";

export const ANNOUNCEMENT_FAILURE_MESSAGE =
  "保存に失敗しました。再読み込みして、もう一度お試しください。";

// Drizzle select() column order of packages/db schema `announcements`; the
// order is part of the audit before/after JSON bytes (pinned by test).
export const ANNOUNCEMENT_COLUMNS = [
  "id",
  "title",
  "body",
  "severity",
  "is_published",
  "publish_at",
  "expire_at",
  "target_audience",
  "created_by_user_id",
  "created_at",
  "updated_at",
] as const;

type AnnouncementRow = Record<(typeof ANNOUNCEMENT_COLUMNS)[number], unknown> & {
  updated_at: number;
};

/** Bounded JSON read (413) + contracts shape check (400). */
async function readAnnouncementBody(
  request: Request,
): Promise<
  | { ok: true; raw: Record<string, unknown> }
  | { ok: false; status: 400 | 413; message: string }
> {
  const read = await readAdminJsonBody(request);
  if (read.kind === "too_large") {
    return { ok: false, status: 413, message: BODY_TOO_LARGE_MESSAGE };
  }
  const shape =
    read.kind === "ok" ? AnnouncementWriteBodySchema.safeParse(read.value) : null;
  if (!shape || !shape.success) {
    return { ok: false, status: 400, message: "入力内容を確認してください。" };
  }
  return { ok: true, raw: shape.data };
}

async function loadAnnouncement(
  db: D1Database,
  id: string,
): Promise<AnnouncementRow | null> {
  return db
    .prepare(
      `SELECT ${ANNOUNCEMENT_COLUMNS.map((c) => `"${c}"`).join(", ")}
       FROM announcements WHERE id = ? LIMIT ${MAX_SINGLE_ROW_LIMIT}`,
    )
    .bind(id)
    .first<AnnouncementRow>();
}

function failure(
  c: { json: (b: unknown, s: 400 | 404 | 409 | 413 | 500) => Response },
  status: 400 | 404 | 409 | 413 | 500,
  message: string,
) {
  const body: AnnouncementResult = { ok: false, message };
  return c.json(body, status);
}

export const announcementRoutes = new Hono<AppEnv>();
announcementRoutes.use("*", onlyMutating(costGuardMiddleware("admin_announcement_broadcast")));

// SA-004 createAnnouncement
announcementRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user")!.id;
  const body0 = await readAnnouncementBody(c.req.raw);
  if (!body0.ok) return failure(c, body0.status, body0.message);
  const validated = validateAnnouncementInput(body0.raw);
  if (!validated.ok) return failure(c, 400, validated.message);
  const { data, dates } = validated;
  const id = data.id?.trim() || generateId("anc");
  const now = Math.floor(Date.now() / 1000);

  try {
    const queue = buildAnnouncementChangeQueueStatement({
      reason: "announcement_create",
      requestedByUserId: userId,
    });
    await mutateWithAudit(db, {
      mutationStatements: [
        {
          sql: `
          INSERT INTO announcements (
            id, title, body, severity, target_audience, is_published,
            publish_at, expire_at, created_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          params: [
            id, data.title, data.body, data.severity, data.target_audience,
            data.is_published, dates.publishAt, dates.expireAt, userId, now, now,
          ],
        },
        queue.statement,
      ],
      expectedMutationChanges: [1, queue.expectedChanges],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "CREATE",
          before: null,
          after: {
            id,
            title: data.title,
            body: data.body,
            severity: data.severity,
            target_audience: data.target_audience,
            is_published: data.is_published,
            publish_at: dates.publishAt,
            expire_at: dates.expireAt,
            created_by_user_id: userId,
            created_at: now,
            updated_at: now,
          },
          actor_user_id: userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    console.error("[announcement] atomic mutation failed", error);
    return failure(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE);
  }
  const body: AnnouncementResult = { ok: true, id };
  return c.json(body, 200);
});

// SA-005 updateAnnouncement
announcementRoutes.put("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user")!.id;
  const body0 = await readAnnouncementBody(c.req.raw);
  if (!body0.ok) return failure(c, body0.status, body0.message);
  // The path id is authoritative (CURRENT reads it from the form field `id`).
  const validated = validateAnnouncementInput({ ...body0.raw, id: c.req.param("id") });
  if (!validated.ok) return failure(c, 400, validated.message);
  const { data, dates } = validated;
  const id = data.id?.trim();
  if (!id) return failure(c, 400, "お知らせIDが必要です。");

  let existing: AnnouncementRow | null;
  try {
    existing = await loadAnnouncement(db, id);
  } catch (error) {
    console.error("[announcement] atomic mutation failed", error);
    return failure(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE);
  }
  if (!existing) return failure(c, 404, "対象のお知らせが見つかりません。");
  if (data.base_updated_at == null || data.base_updated_at !== existing.updated_at) {
    return failure(c, 409, "他の操作で更新されています。再読み込みして確認してください。");
  }

  const now = Math.floor(Date.now() / 1000);
  const nextUpdatedAt = Math.max(now, existing.updated_at + 1);
  try {
    const queue = buildAnnouncementChangeQueueStatement({
      reason: "announcement_update",
      requestedByUserId: userId,
    });
    await mutateWithAudit(db, {
      mutationStatements: [
        {
          sql: `
          UPDATE announcements
          SET title = ?, body = ?,
              severity = ?, target_audience = ?,
              is_published = ?, publish_at = ?,
              expire_at = ?, updated_at = ?
          WHERE id = ? AND updated_at = ?
        `,
          params: [
            data.title, data.body, data.severity, data.target_audience,
            data.is_published, dates.publishAt, dates.expireAt, nextUpdatedAt,
            id, data.base_updated_at,
          ],
        },
        queue.statement,
      ],
      expectedMutationChanges: [1, queue.expectedChanges],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "UPDATE",
          before: { ...existing },
          after: {
            ...existing,
            title: data.title,
            body: data.body,
            severity: data.severity,
            target_audience: data.target_audience,
            is_published: data.is_published,
            publish_at: dates.publishAt,
            expire_at: dates.expireAt,
            updated_at: nextUpdatedAt,
          },
          actor_user_id: userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    console.error("[announcement] atomic mutation failed", error);
    return failure(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE);
  }
  const body: AnnouncementResult = { ok: true, id };
  return c.json(body, 200);
});

// SA-006 deleteAnnouncement
announcementRoutes.delete("/:id", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user")!.id;
  const id = c.req.param("id").trim();
  if (!id) return failure(c, 400, "お知らせIDが必要です。");

  let existing: AnnouncementRow | null;
  try {
    existing = await loadAnnouncement(db, id);
  } catch (error) {
    console.error("[announcement] atomic mutation failed", error);
    return failure(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE);
  }
  if (!existing) return failure(c, 404, "対象のお知らせが見つかりません。");
  try {
    const queue = buildAnnouncementChangeQueueStatement({
      reason: "announcement_delete",
      requestedByUserId: userId,
    });
    await mutateWithAudit(db, {
      mutationStatements: [
        {
          sql: `
          DELETE FROM announcements
          WHERE id = ? AND updated_at = ?
        `,
          params: [id, existing.updated_at],
        },
        queue.statement,
      ],
      expectedMutationChanges: [1, queue.expectedChanges],
      preloaded: auditPreloaded(c),
      audits: [
        {
          table_name: "announcements",
          target_id: id,
          operation: "DELETE",
          before: { ...existing },
          after: null,
          actor_user_id: userId,
          retention_class: "normal",
        },
      ],
    });
  } catch (error) {
    console.error("[announcement] atomic mutation failed", error);
    return failure(c, 500, ANNOUNCEMENT_FAILURE_MESSAGE);
  }
  const body: AnnouncementResult = { ok: true };
  return c.json(body, 200);
});
