"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { normalizeXId } from "@/lib/utils/xid";
import { executeXIdMerge } from "@/lib/xid/merge";

export interface MergeXIdsResult {
  ok: boolean;
  message?: string;
  fromXId?: string;
  toXId?: string;
  counts?: Record<string, number>;
  restoreSnapshotJson?: string;
  revertDeadlineAt?: number;
}

export async function mergeXIds(formData: FormData): Promise<MergeXIdsResult> {
  const session = await auth().catch(() => null);
  const user = session?.user as { id?: string; role?: string } | undefined;
  if (!user?.id || user.role !== "admin") {
    return { ok: false, message: "admin のみ実行できます。" };
  }

  const fromXId = normalizeXId(String(formData.get("from") ?? ""));
  const toXId = normalizeXId(String(formData.get("to") ?? ""));
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (!fromXId || !toXId) return { ok: false, message: "from / to が必要です。" };
  if (fromXId === toXId) return { ok: false, message: "from と to が同じ X ID です。" };
  if (confirm !== "MERGE") return { ok: false, message: "確認文字列 MERGE が一致しません。" };

  const db = getDatabase();
  if (!db) return { ok: false, message: "DB に接続できません。" };
  try {
    const result = await executeXIdMerge(db, {
      sourceXUserId: fromXId,
      targetXUserId: toXId,
      actorAuthUserId: user.id,
    });
    revalidatePath("/admin/x-link-requests");
    revalidatePath("/admin/x-id-merges");
    revalidatePath("/admin/users");
    revalidatePath(`/user/${fromXId}`);
    revalidatePath(`/user/${toXId}`);
    return {
      ok: true,
      message: `@${fromXId} → @${toXId} に統合しました。`,
      fromXId,
      toXId,
      counts: result.counts,
      restoreSnapshotJson: result.restoreSnapshotJson,
      revertDeadlineAt: result.revertDeadlineAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "X ID 統合を安全に確定できませんでした。",
    };
  }
}
