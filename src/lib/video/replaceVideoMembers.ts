import { and, eq, inArray, or } from "drizzle-orm";
import { videoMembers, xUsers } from "@/lib/db/schema";
import type { DB } from "@/lib/db/client";
import { generateId } from "@/lib/utils/id";
import { normalizeXId } from "#utils/xid";
import type { MemberInput, ParsedMemberChapter } from "@/lib/video/memberInputs";
import { serializeMemberChaptersJson } from "@/lib/video/memberChaptersJson";
import {
  emptyVideoAtomicWritePlan,
  type VideoAtomicWritePlan,
} from "@/lib/video/atomicWritePlan";
import { expectedRowCondition } from "@/lib/audit/adapters";
import { MAX_ATOMIC_VIDEO_MEMBERS } from "@/lib/video/atomicLimits";

export async function buildReplaceVideoMembersPlan(
  db: DB,
  args: {
    videoId: string;
    members: MemberInput[];
    chaptersByIndex?: Map<number, ParsedMemberChapter[]>;
    actorUserId: string;
  },
): Promise<VideoAtomicWritePlan> {
  if (args.members.length > MAX_ATOMIC_VIDEO_MEMBERS) {
    throw new Error("video_member_atomic_limit_exceeded");
  }
  const existing = await db
    .select()
    .from(videoMembers)
    .where(and(
      eq(videoMembers.video_id, args.videoId),
      eq(videoMembers.is_public_member, 1),
    )!)
    .limit(MAX_ATOMIC_VIDEO_MEMBERS + 1);
  if (existing.length > MAX_ATOMIC_VIDEO_MEMBERS) {
    throw new Error("video_member_existing_atomic_limit_exceeded");
  }

  const xIds = Array.from(new Set(
    args.members.map((member) => normalizeXId(member.x_user_id)).filter(Boolean),
  ));
  const carryRows = xIds.length > 0
    ? await db
        .select()
        .from(videoMembers)
        .where(and(
          eq(videoMembers.video_id, args.videoId),
          inArray(videoMembers.x_user_id, xIds),
        )!)
        .limit(MAX_ATOMIC_VIDEO_MEMBERS * 2 + 1)
    : [];
  if (carryRows.length > MAX_ATOMIC_VIDEO_MEMBERS * 2) {
    throw new Error("video_member_carry_atomic_limit_exceeded");
  }
  const carryByXId = new Map<string, (typeof videoMembers.$inferSelect)>();
  for (const row of carryRows.sort((a, b) => b.can_edit - a.can_edit)) {
    const xId = normalizeXId(row.x_user_id);
    if (xId && !carryByXId.has(xId)) carryByXId.set(xId, row);
  }
  const existingXUsers = xIds.length > 0
    ? await db.select().from(xUsers).where(inArray(xUsers.id, xIds))
    : [];
  const existingXIds = new Set(existingXUsers.map((row) => row.id));
  const now = Math.floor(Date.now() / 1000);
  const newXUsers: (typeof xUsers.$inferSelect)[] = [];
  const nextMembers: (typeof videoMembers.$inferSelect)[] = [];

  for (const [index, member] of args.members.entries()) {
    const xId = normalizeXId(member.x_user_id) || null;
    if (xId && !existingXIds.has(xId)) {
      newXUsers.push({
        id: xId,
        x_name: member.name || `@${xId}`,
        icon_url: null,
        profile_text: null,
        portfolio_contact: null,
        youtube_channel_url: null,
        other_social_links: null,
        creative_start_date: null,
        linked_user_id: null,
        verification_token: null,
        token_expires_at: null,
        approval_status: "pending",
        approval_requested_at: now,
      });
      existingXIds.add(xId);
    }
    const carry = xId ? carryByXId.get(xId) : undefined;
    const chapters = args.chaptersByIndex?.get(index) ?? [];
    nextMembers.push({
      id: generateId("vm"),
      video_id: args.videoId,
      x_user_id: xId,
      name: member.name,
      role: member.role || null,
      comment: member.comment || null,
      order_index: index,
      user_id: carry?.user_id ?? null,
      can_edit: carry?.can_edit ?? 0,
      is_public_member: 1,
      edit_granted_by_user_id: carry?.edit_granted_by_user_id ?? null,
      edit_granted_at: carry?.edit_granted_at ?? null,
      edit_updated_at: carry?.edit_updated_at ?? null,
      chapters_json: serializeMemberChaptersJson(chapters),
    });
  }

  const plan = emptyVideoAtomicWritePlan();
  if (existing.length > 0) {
    plan.statements.push(db.delete(videoMembers).where(or(...existing.map((row) => and(
      eq(videoMembers.id, row.id),
      expectedRowCondition({ expectedCurrent: row }),
    )!))!));
    plan.expectedChanges.push(existing.length);
    plan.audits.push(...existing.map((row) => ({
      table_name: "video_members",
      target_id: row.id,
      operation: "DELETE" as const,
      before: { ...row },
      after: null,
      actor_user_id: args.actorUserId,
      context: "video-save:members",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (newXUsers.length > 0) {
    plan.statements.push(db.insert(xUsers).values(newXUsers));
    plan.expectedChanges.push(newXUsers.length);
    plan.audits.push(...newXUsers.map((row) => ({
      table_name: "x_users",
      target_id: row.id,
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:member-profile",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  if (nextMembers.length > 0) {
    plan.statements.push(db.insert(videoMembers).values(nextMembers));
    plan.expectedChanges.push(nextMembers.length);
    plan.audits.push(...nextMembers.map((row) => ({
      table_name: "video_members",
      target_id: row.id,
      operation: "CREATE" as const,
      before: null,
      after: { ...row },
      actor_user_id: args.actorUserId,
      context: "video-save:members",
      retention_class: "normal" as const,
      strict: true,
    })));
  }
  return plan;
}
