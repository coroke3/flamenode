/**
 * MIG-0636 U06 SA-105: isolated X identity icon-upload handler.
 *
 * Deliberately UNMOUNTED. The caller must inject xidWriteStack (Origin ->
 * authenticated session -> identity/TOS -> CostGuard -> DB). This module may
 * be exercised only by isolated/local tests until S3 CPU/D1 budget, CURRENT
 * parity, R2 lifecycle and independent security review are accepted.
 *
 * CURRENT src/lib/actions/xid.ts#uploadXIdIcon: verified PNG/JPEG/WEBP, staged
 * R2 plus final R2 key, one audited CAS+rebuild D1 batch, pre-commit rollback,
 * post-commit staging/orphan cleanup. No remote deploy or background Queue.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { isCanonicalXId, normalizeXId } from "@flamenode/domain/xid";
import { expectedRowCondition } from "@flamenode/server-core/audit/expectedRowCondition";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import { generateId } from "@flamenode/server-core/id";
import { buildAfterXUserPublicUpdateQueueBatch } from "@flamenode/server-core/staticRebuild/hooks";
import { sql } from "@flamenode/server-core/sql";
import type { AppEnv } from "../../env.ts";
import { limitXIdActionBody } from "../../middleware/bodyLimit.ts";
import { auditPreloaded } from "../admin/body.ts";
import { validateIconImageUpload } from "./iconImage.ts";
import { cleanupOldXIconAfterCommit } from "./orphanCleanup.ts";

const MAX_ICON_BYTES = 2 * 1024 * 1024;
const NO_STORE = "private, no-store";
const FAILED_UPLOAD = "アイコンのアップロードに失敗しました。時間をおいて再試行してください。";

type XRow = Record<string, unknown> & {
  id: string;
  icon_url: string | null;
  approval_status: string | null;
};

export function createXIdIconUploadRoutes(guard: MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.post("/:xUserId/icon/upload", guard, limitXIdActionBody("SA-105"), async (c) => {
    c.header("Cache-Control", NO_STORE);
    const xUserId = c.req.param("xUserId") ?? "";
    if (!isCanonicalXId(xUserId)) {
      return c.json({ ok: false, message: "X ID が不正です。" }, 400);
    }

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      return c.json({ ok: false, message: "画像ファイルが必要です。" }, 400);
    }
    const ids = form.getAll("x_user_id");
    const files = form.getAll("icon_file");
    if (ids.length !== 1 || typeof ids[0] !== "string" ||
        normalizeXId(ids[0]) !== xUserId) {
      return c.json({ ok: false, message: "操作する X ID が一致しません。" }, 400);
    }
    if (files.length !== 1 || !(files[0] instanceof File)) {
      return c.json({ ok: false, message: "画像ファイルが必要です。" }, 400);
    }
    const file = files[0];
    // The outer stream guard limits multipart to 8 MiB. The image itself
    // has the stricter CURRENT 2 MiB cap, checked before allocating its bytes.
    if (file.size > MAX_ICON_BYTES) {
      return c.json({ ok: false, message: "変換後の画像サイズが2MBを超えています。" }, 400);
    }
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      return c.json({ ok: false, message: "画像の読み込みに失敗しました。再度お試しください。" }, 400);
    }
    const image = validateIconImageUpload({ buffer, declaredType: file.type });
    if (!image.ok) return c.json({ ok: false, message: image.message }, 400);

    const authUserId = c.get("user")!.id;
    let before: XRow | null;
    try {
      before = await c.env.DB.prepare(`
        SELECT x.* FROM x_users AS x
        INNER JOIN x_user_account_links AS l ON l.x_user_id = x.id
        WHERE x.id = ? AND l.auth_user_id = ? LIMIT 1
      `).bind(xUserId, authUserId).first<XRow>();
    } catch {
      return c.json({ ok: false, message: "DBに接続できません。" }, 503);
    }
    if (!before) {
      return c.json({ ok: false, message: "この X ID を編集する権限がありません。" }, 403);
    }
    if (before.approval_status !== "approved") {
      return c.json({ ok: false, message: "承認済みの X ID だけを編集できます。" }, 403);
    }
    // Cloudflare binding getters can throw before an R2 operation begins.
    // Fail closed without exposing provider internals or writing any D1 state.
    let bucket: R2Bucket | undefined;
    try {
      bucket = c.env?.BUCKET;
    } catch {
      return c.json({ ok: false, message: "ストレージが利用できません。" }, 503);
    }
    if (!bucket) {
      return c.json({ ok: false, message: "ストレージが利用できません。" }, 503);
    }

    const objectId = generateId("xicon");
    const stagingKey = `xicons/staging/${authUserId}/${objectId}.${image.image.ext}`;
    const finalKey = `xicons/${xUserId}/${objectId}.${image.image.ext}`;
    const iconUrl = `/api/media/${finalKey}`;
    const after = { ...before, icon_url: iconUrl };
    let committed = false;
    let writePhase: "r2" | "db" = "r2";
    try {
      await bucket.put(stagingKey, buffer, { httpMetadata: { contentType: image.image.contentType } });
      await bucket.put(finalKey, buffer, { httpMetadata: { contentType: image.image.contentType } });
      writePhase = "db";
      const db = c.get("db");
      const queue = await buildAfterXUserPublicUpdateQueueBatch(db, {
        xUserId, reason: "x_user_icon_update", requestedByUserId: authUserId,
      });
      await mutateWithAudit(db, {
        mutationStatements: [
          db.run(sql`UPDATE x_users SET icon_url = ${iconUrl}
            WHERE id = ${xUserId}
              AND (${expectedRowCondition({ expectedCurrent: before })})
              AND approval_status = 'approved'
              AND EXISTS (
                SELECT 1 FROM x_user_account_links
                WHERE x_user_id = ${xUserId} AND auth_user_id = ${authUserId}
              )`),
          ...queue.statements,
        ],
        expectedMutationChanges: [1, ...queue.expectedChanges],
        // The guarded user and settings are already read. Reuse the exact
        // snapshots so audit does not repeat D1 settings/actor reads.
        preloaded: auditPreloaded(c),
        audits: [{
          table_name: "x_users", target_id: before.id, operation: "UPDATE",
          before: { ...before }, after, actor_user_id: authUserId,
          actor_x_user_id: xUserId, reason: "icon_upload",
          retention_class: "long_audit", strict: true,
        }],
      });
      committed = true;
    } catch {
      // Preserve CURRENT: only delete newly created keys BEFORE the D1 commit.
      // A committed URL must never be invalidated by an R2 cleanup failure.
      if (!committed) {
        await Promise.allSettled([bucket.delete(stagingKey), bucket.delete(finalKey)]);
      }
      return c.json({ ok: false, message: writePhase === "db"
        ? "アイコンを更新できませんでした。再読み込みしてお試しください。"
        : FAILED_UPLOAD }, writePhase === "db" ? 409 : 503);
    }

    // Keep cleanup entirely after the strict D1 commit. Never retry mutations
    // after a failed best-effort staging/orphan removal.
    try { await bucket.delete(stagingKey); } catch { /* orphan staging cleanup */ }
    try { await cleanupOldXIconAfterCommit(c.env.DB, bucket, before.icon_url, iconUrl); }
    catch { /* fail closed if the shared reference-check implementation changes */ }
    return c.json({ ok: true, message: "アイコンをアップロードしました。", iconUrl });
  });
  return routes;
}
