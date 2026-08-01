import "server-only";

import { getEnv } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { getXIconCandidates } from "@/lib/db/xIconResolution";
import { validateIconImageUpload } from "@/lib/utils/imageUpload";
import {
  normalizeIconUrl,
  type VideoFormData,
  type VideoIconMode,
} from "@/lib/video/videoFormSchema";

export type { VideoIconMode };

export type ResolvedVideoCreatorIcon = {
  iconUrl: string | null;
  uploadedKey: string | null;
};

export async function resolveVideoCreatorIcon(args: {
  formData: FormData;
  parsed: Pick<VideoFormData, "icon_mode" | "icon_url">;
  activeXId: string;
  videoId: string;
  existingIconUrl: string | null;
  db: DB;
}): Promise<
  | { ok: true; value: ResolvedVideoCreatorIcon }
  | { ok: false; message: string }
> {
  const mode: VideoIconMode =
    args.parsed.icon_mode ??
    (args.existingIconUrl !== null ? "keep" : "existing");

  if (mode === "keep") {
    return {
      ok: true,
      value: { iconUrl: args.existingIconUrl, uploadedKey: null },
    };
  }

  if (mode === "none") {
    return { ok: true, value: { iconUrl: null, uploadedKey: null } };
  }

  if (mode === "existing") {
    const iconUrl = normalizeIconUrl(args.parsed.icon_url);
    if (!iconUrl) {
      return { ok: false, message: "アイコン URL が不正です。" };
    }
    if (iconUrl.startsWith("/api/media/")) {
      const candidates = await getXIconCandidates(args.db, args.activeXId, 40);
      if (!candidates.includes(iconUrl)) {
        return { ok: false, message: "選択できないアイコンです。" };
      }
    }
    return { ok: true, value: { iconUrl, uploadedKey: null } };
  }

  const file = args.formData.get("icon_file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "画像ファイルが必要です。" };
  }

  const env = getEnv();
  if (!env.BUCKET) {
    return { ok: false, message: "ストレージが利用できません。" };
  }

  const buffer = await file.arrayBuffer();
  const validated = validateIconImageUpload({
    buffer,
    declaredType: file.type,
  });
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }

  const key = `video-icons/${args.activeXId}/${args.videoId}`;
  const iconUrl = `/api/media/${key}`;
  await env.BUCKET.put(key, buffer, {
    httpMetadata: { contentType: validated.image.contentType },
  });

  return { ok: true, value: { iconUrl, uploadedKey: key } };
}

export async function rollbackUploadedVideoIcon(
  uploadedKey: string | null | undefined,
): Promise<void> {
  if (!uploadedKey) return;
  const env = getEnv();
  if (!env.BUCKET) return;
  await env.BUCKET.delete(uploadedKey).catch((error) => {
    console.error("video_icon_orphan_cleanup_failed", error);
  });
}
