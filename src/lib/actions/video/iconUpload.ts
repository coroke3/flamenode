"use server";

import { and, eq, sql } from "drizzle-orm";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { xUserIcons } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { detectSupportedImageUpload } from "@/lib/utils/imageUpload";
import { normalizeXId } from "@/lib/utils/xid";
import type { VideoActionResult } from "@/lib/video/types";

export async function uploadVideoIconCandidate(
  formData: FormData,
): Promise<VideoActionResult & { iconUrl?: string }> {
  const guard = await writeGuard({
    requireApprovedActiveXId: true,
    feature: "post_video_unslotted",
  });
  if (!guard.ok) return { ok: false, reason: guard.reason, message: guard.message };
  const sessionUser = guard.user;
  const activeX = normalizeXId(sessionUser.active_x_user_id);
  if (!activeX || !guard.approvedXIds.includes(activeX)) {
    return { ok: false, message: "承認済みの X ID を選択してください。" };
  }

  const file = formData.get("icon_file");
  if (!(file instanceof File)) {
    return { ok: false, message: "画像ファイルが必要です。" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "2MB 以内の画像を選んでください。" };
  }

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };

  const manualIconCount = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(xUserIcons)
    .where(
      and(
        eq(xUserIcons.x_user_id, activeX),
        eq(xUserIcons.source_type, "manual"),
      )!,
    );
  if (Number(manualIconCount[0]?.count ?? 0) >= 24) {
    return {
      ok: false,
      message:
        "手動アップロードの候補が上限に達しています。既存候補から選択してください。",
    };
  }

  const env = getEnv();
  if (!env.BUCKET) {
    return { ok: false, message: "ストレージが利用できません。" };
  }

  const buf = await file.arrayBuffer();
  const image = detectSupportedImageUpload(buf);
  if (!image) {
    return { ok: false, message: "PNG/JPEG/WEBP 画像ファイルのみアップロードできます。" };
  }

  const iconId = generateId("xicon");
  const key =
    `video-icons/${activeX}/${generateId("vicon")}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;
  const now = Math.floor(Date.now() / 1000);

  const row = {
    id: iconId,
    x_user_id: activeX,
    icon_url: iconUrl,
    source_video_id: null,
    source_type: "manual" as const,
    created_at: now,
  } satisfies typeof xUserIcons.$inferInsert;

  await env.BUCKET.put(key, buf, {
    httpMetadata: {
      contentType: image.contentType,
    },
  });

  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db.insert(xUserIcons).values(row),
      ],
      expectedMutationChanges: [1],
      audits: [
        {
          table_name: "x_user_icons",
          target_id: iconId,
          operation: "CREATE",
          before: null,
          after: row,
          actor_user_id: sessionUser.id,
          context: "video-icon-upload",
          retention_class: "long_audit",
          restore_strategy: "delete_created",
          strict: true,
        },
      ],
    });
  } catch (error) {
    try {
      await env.BUCKET.delete(key);
    } catch (cleanupError) {
      console.error(
        JSON.stringify({
          event: "video_icon_orphan_cleanup_failed",
          objectKey: key,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        }),
      );
    }

    return {
      ok: false,
      message:
        error instanceof Error
          ? `アイコン候補を保存できませんでした: ${error.message}`
          : "アイコン候補を保存できませんでした。",
    };
  }

  return {
    ok: true,
    message: "アップロードしました。",
    iconUrl,
  };
}
