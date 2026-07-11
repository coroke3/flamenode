import { and, eq, inArray } from "drizzle-orm";
import { videoMembers, xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "#utils/xid";
import {
  type MemberInput,
  type ParsedMemberChapter,
  normalizeMemberChapters,
} from "@/lib/video/memberInputs";
import { serializeMemberChaptersJson } from "@/lib/video/memberChaptersJson";

/**
 * 作品の **公開メンバー** (is_public_member = 1) のみを差し替える。
 * 非公開編集者 (is_public_member = 0) は削除しない。
 */
export async function replaceVideoMembers(
  db: DB,
  videoId: string,
  members: MemberInput[],
  prevalidatedChapters?: Map<number, ParsedMemberChapter[]>,
): Promise<void> {
  const existing = await db
    .select()
    .from(videoMembers)
    .where(eq(videoMembers.video_id, videoId));

  const publicExisting = existing.filter((m) => m.is_public_member === 1);
  const carryByXid = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    if (row.x_user_id) {
      const key = normalizeXId(row.x_user_id);
      if (key && !carryByXid.has(key)) carryByXid.set(key, row);
    }
  }

  if (publicExisting.length > 0) {
    const publicMemberIds = publicExisting.map((row) => row.id);
    await db
      .delete(videoMembers)
      .where(
        and(
          eq(videoMembers.video_id, videoId),
          inArray(videoMembers.id, publicMemberIds),
        )!,
      );
  }
  if (members.length === 0) return;

  const xIdsToEnsure = Array.from(
    new Set(
      members
        .map((m) => normalizeXId(m.x_user_id))
        .filter((xid): xid is string => Boolean(xid)),
    ),
  );
  const existingXUsers = xIdsToEnsure.length
    ? await db
        .select({ id: xUsers.id })
        .from(xUsers)
        .where(inArray(xUsers.id, xIdsToEnsure))
    : [];
  const existingXUserSet = new Set(existingXUsers.map((r) => r.id));

  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    const xid = m.x_user_id || null;
    if (xid && !existingXUserSet.has(xid)) {
      await db.insert(xUsers).values({
        id: xid,
        x_name: m.name || `@${xid}`,
        approval_status: "pending",
        approval_requested_at: now,
      });
      existingXUserSet.add(xid);
    }
    const carry = xid ? carryByXid.get(normalizeXId(xid)) : undefined;
    const chapters =
      prevalidatedChapters?.get(i) ??
      (() => {
        const normalized = normalizeMemberChapters(m, i);
        return normalized.ok ? normalized.chapters : [];
      })();
    const chaptersJson = serializeMemberChaptersJson(chapters);

    await db.insert(videoMembers).values({
      id: generateId("vm"),
      video_id: videoId,
      x_user_id: xid,
      name: m.name,
      role: m.role || null,
      comment: m.comment || null,
      order_index: i,
      is_public_member: 1,
      can_edit: carry?.can_edit ?? 0,
      user_id: carry?.user_id ?? null,
      edit_granted_by_user_id: carry?.edit_granted_by_user_id ?? null,
      edit_granted_at: carry?.edit_granted_at ?? null,
      edit_updated_at: carry?.edit_updated_at ?? null,
      chapters_json: chaptersJson,
    });
  }
}
