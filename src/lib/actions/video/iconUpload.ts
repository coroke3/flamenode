"use server";

import { eq } from "drizzle-orm";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { expectedRowCondition } from "@/lib/audit/expectedRowCondition";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { xUsers } from "@/lib/db/schema";
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
  if (!(file instanceof File)) return { ok: false, message: "画像ファイルが必要です。" };
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: "2MB 以内の画像を選んでください。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  const xUser = (await db.select().from(xUsers).where(eq(xUsers.id, activeX)).limit(1))[0];
  if (!xUser) return { ok: false, message: "X ID が見つかりません。" };

  const env = getEnv();
  if (!env.BUCKET) return { ok: false, message: "ストレージが利用できません。" };
  const buffer = await file.arrayBuffer();
  const image = detectSupportedImageUpload(buffer);
  if (!image) return { ok: false, message: "PNG/JPEG/WEBP 画像ファイルのみアップロードできます。" };

  const key = `video-icons/${activeX}/${generateId("vicon")}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;
  const after = { ...xUser, icon_url: iconUrl };
  await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: image.contentType } });
  try {
    await mutateWithAudit(db, {
      mutationStatements: [
        db
          .update(xUsers)
          .set({ icon_url: iconUrl })
          .where(expectedRowCondition({ expectedCurrent: xUser })),
      ],
      expectedMutationChanges: [1],
      audits: [
        {
          table_name: "x_users",
          target_id: activeX,
          operation: "UPDATE",
          before: xUser,
          after,
          actor_user_id: sessionUser.id,
          context: "video-icon-upload",
          reason: "代表アイコンを手動アップロード",
          retention_class: "long_audit",
          strict: true,
        },
      ],
    });
  } catch (error) {
    await env.BUCKET.delete(key).catch((cleanupError) => {
      console.error("video_icon_orphan_cleanup_failed", cleanupError);
    });
    throw error;
  }
  return { ok: true, message: "代表アイコンを更新しました。", iconUrl };
}
