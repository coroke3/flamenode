import { z } from "zod";
import { normalizeXId } from "#utils/xid";
import { MAX_VIDEO_MEMBERS } from "./atomicLimits.ts";

const memberInputSchema = z.object({
  name: z.string().trim().max(80),
  x_user_id: z.string().trim().max(32),
  role: z.string().trim().max(80).optional().default(""),
  comment: z.string().trim().max(500).optional().default(""),
});

const membersJsonSchema = z.array(memberInputSchema).max(
  MAX_VIDEO_MEMBERS,
  `合作メンバーは最大${MAX_VIDEO_MEMBERS}人です。`,
);

export interface MemberInput {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
}

/** 正本のvideo_membersへ保存する公開メンバー入力だけを解析する。 */
export function parseVideoMemberInputs(
  raw: FormDataEntryValue | null,
  isCollab: boolean,
):
  | { ok: true; members: MemberInput[] }
  | { ok: false; message: string } {
  if (!isCollab) return { ok: true, members: [] };
  if (typeof raw !== "string" || !raw.trim()) return { ok: true, members: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "合作メンバーのJSONが不正です。" };
  }

  const result = membersJsonSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      message: result.error.issues[0]?.message ?? "合作メンバーの入力が不正です。",
    };
  }

  const members: MemberInput[] = [];
  const seen = new Set<string>();
  for (const item of result.data) {
    const xId = normalizeXId(item.x_user_id);
    const name = item.name.trim();
    if (!name && !xId) continue;

    const key = xId
      ? `x:${xId}`
      : `n:${name.normalize("NFKC").toLowerCase()}`;
    if (seen.has(key)) {
      return { ok: false, message: "同じ合作メンバーが重複しています。" };
    }
    seen.add(key);

    members.push({
      name: name || (xId ? `@${xId}` : ""),
      x_user_id: xId,
      role: item.role ?? "",
      comment: item.comment ?? "",
    });
  }
  return { ok: true, members };
}
