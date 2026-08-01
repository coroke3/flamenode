"use server";

import { getEnv } from "@/lib/cloudflare";
import { writeGuard } from "@/lib/auth/writeGuard";
import { generateId } from "@/lib/utils/id";
import { detectSupportedImageUpload } from "@/lib/utils/imageUpload";
import { normalizeXId } from "@/lib/utils/xid";
import type { VideoActionResult } from "@/lib/video/types";

/** 作品フォーム用アイコンを R2 へアップロードし URL を返す。x_users は更新しない。 */
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

  const env = getEnv();
  if (!env.BUCKET) return { ok: false, message: "ストレージが利用できません。" };
  const buffer = await file.arrayBuffer();
  const image = detectSupportedImageUpload(buffer);
  if (!image) return { ok: false, message: "PNG/JPEG/WEBP 画像ファイルのみアップロードできます。" };

  const key = `video-icons/${activeX}/${generateId("vicon")}.${image.ext}`;
  const iconUrl = `/api/media/${key}`;
  await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: image.contentType } });
  return { ok: true, message: "アップロードしました。", iconUrl };
}
