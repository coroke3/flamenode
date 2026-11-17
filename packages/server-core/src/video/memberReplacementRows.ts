/**
 * MIG-0650 U03d-2g: CURRENT SA-085 replacement member row projection.
 *
 * The HTTP host must authenticate/authorize, normalize and fail-close
 * canonical aliases before calling. This builder does not resolve X identities,
 * perform DB I/O, grant any new permission, or write audit/Queue entries.
 *
 * The CURRENT Next callback remains the sole source of member IDs. Build a
 * fresh set so caller snapshots and a second dry-run cannot be mutated.
 */
import type { videoMembers, xUsers } from "@flamenode/db/schema";

type MemberRow = typeof videoMembers.$inferSelect;
type NewXUserRow = typeof xUsers.$inferInsert;

export type ReplacementMemberInput = {
  name: string;
  x_user_id: string;
  role: string;
  comment: string;
};

export function buildVideoMemberReplacementRows(input: {
  videoId: string;
  members: readonly ReplacementMemberInput[];
  existingPublic: readonly MemberRow[];
  permissionCarryByXId: ReadonlyMap<string, MemberRow>;
  existingXIds: ReadonlySet<string>;
  canonicalIdentity: (raw: string | null | undefined) => string;
  normalizeXId: (raw: string | null | undefined) => string;
  generateMemberId: () => string;
}): {
  newXUsers: NewXUserRow[];
  nextMembers: MemberRow[];
} {
  const {
    videoId, members, existingPublic, permissionCarryByXId,
    canonicalIdentity, normalizeXId, generateMemberId,
  } = input;

  const existingPublicByXId = new Map<string, MemberRow>();
  const existingPublicByName = new Map<string, MemberRow>();
  for (const row of existingPublic) {
    const xId = canonicalIdentity(row.x_user_id);
    if (xId && !existingPublicByXId.has(xId)) {
      existingPublicByXId.set(xId, row);
    }
    const nameKey = row.name.trim().normalize("NFKC").toLowerCase();
    if (nameKey && !existingPublicByName.has(nameKey)) {
      existingPublicByName.set(nameKey, row);
    }
  }

  const existingXIds = new Set(input.existingXIds);
  const newXUsers: NewXUserRow[] = [];
  const nextMembers: MemberRow[] = [];
  for (const [index, member] of members.entries()) {
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
        approval_status: "pending",
      });
      existingXIds.add(xId);
    }

    const previousPublic = xId
      ? existingPublicByXId.get(xId)
      : existingPublicByName.get(
          member.name.trim().normalize("NFKC").toLowerCase(),
        );
    const permissionCarry = xId
      ? permissionCarryByXId.get(xId)
      : previousPublic;

    nextMembers.push({
      id: previousPublic?.id ?? generateMemberId(),
      video_id: videoId,
      x_user_id: xId,
      name: member.name.trim() || (xId ? `@${xId}` : ""),
      role: member.role || null,
      comment: member.comment || null,
      order_index: index,
      can_edit: permissionCarry?.can_edit ?? 0,
      is_public_member: 1,
      edit_granted_by_auth_user_id:
        permissionCarry?.edit_granted_by_auth_user_id ?? null,
      edit_granted_at: permissionCarry?.edit_granted_at ?? null,
      edit_updated_at: permissionCarry?.edit_updated_at ?? null,
    });
  }
  return { newXUsers, nextMembers };
}
