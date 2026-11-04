/** MIG-0511: build-only projection of CURRENT's public X icon map.
 * Optional icon metadata never authorizes a private user or weakens the
 * snapshot visibility fence. No request-time API / R2 access.
 */
import {
  hasProjectedPublicProfile,
  normalizePublicIconUrl,
  normalizePublicXIconMap,
  publicXIconEntriesToMap,
  resolveProjectedIcon,
  type PublicXIconEntry,
  type PublicXIconMapPayload,
} from "../../../../src/lib/publicData/publicIconProjection.ts";
import { normalizeStaticUsersIndex, type StaticUsersIndexPayload } from "../../../../src/lib/publicData/staticUsersIndexCore.ts";
import type { StaticEventDetail } from "../../../../src/lib/publicData/staticEventDetailCore.ts";
import { cachedGoogleImageUrl } from "../../../../src/lib/media/googleImages.ts";
import { normalizeXId } from "../../../../src/lib/utils/xid.ts";
import { PUBLIC_X_ICON_MAP_KEY, loadPublicXIconMapPayload } from "./publicDataLoader.ts";
import { snapshotAccessFromEnv } from "./snapshotEnv.ts";

/** CURRENT V1 + users-index supplement. Registered/none entries have priority;
 * only missing and video-sourced entries are filled from public user rows. */
export function projectPublicXIconMap(v1: unknown, usersIndex: unknown): PublicXIconMapPayload | null {
  const primary = normalizePublicXIconMap(v1);
  const index = usersIndex && typeof usersIndex === "object"
    ? normalizeStaticUsersIndex(usersIndex as StaticUsersIndexPayload)
    : null;
  if (!index) return primary;

  const entries: Record<string, PublicXIconEntry> = { ...(primary?.entries ?? {}) };
  for (const user of index.items) {
    const xId = normalizeXId(user.x_id);
    if (!xId) continue;
    const existing = entries[xId];
    if (existing?.source === "registered" || existing?.source === "none") continue;
    entries[xId] = {
      icon_url: user.icon_url ?? existing?.icon_url ?? null,
      source: user.icon_url ? "registered" : "none",
    };
  }
  return {
    schema_version: 1,
    generated_at: primary?.generated_at ?? index.generatedAt ?? 0,
    entries,
  };
}

/** Invalid or absent optional metadata degrades to the existing snapshot icon.
 * A bad digest is never used even if the payload appears public. */
export async function loadPublicXIconMapForBuild(
  env: Record<string, string | undefined> = process.env,
): Promise<Map<string, PublicXIconEntry>> {
  try {
    const access = snapshotAccessFromEnv(env);
    if (!access || !access.options.manifest?.allowedKeys?.includes(PUBLIC_X_ICON_MAP_KEY)) return new Map();
    const payload = await loadPublicXIconMapPayload(access.source, access.options);
    return publicXIconEntriesToMap(normalizePublicXIconMap(payload));
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? String((error as { code: unknown }).code)
      : "UNKNOWN";
    console.warn(`[icon-map] empty: snapshot ${PUBLIC_X_ICON_MAP_KEY} unavailable (${code})`);
    return new Map();
  }
}

/** Preserve CURRENT video-member icon and profile-link rules in one pure projection.
 * A map entry with a null icon deliberately suppresses the legacy icon; only
 * registered/none entries (or an existing public-profile flag) add a link.
 */
export function projectVideoMemberPresentation(
  member: {
    x_user_id: string | null;
    icon_url?: string | null;
    has_public_profile?: boolean | null;
  },
  iconMap: ReadonlyMap<string, PublicXIconEntry>,
): { iconUrl: string | null; profileHref: string | null } {
  const xUserId = member.x_user_id;
  return {
    iconUrl: cachedGoogleImageUrl(resolveProjectedIcon({
      xUserId,
      iconMap,
      legacyIconUrl: member.icon_url ?? null,
    })),
    profileHref: xUserId &&
      ((member.has_public_profile ?? false) || hasProjectedPublicProfile({ xUserId, iconMap }))
      ? `/user/${xUserId}`
      : null,
  };
}

/** Keep the detail object immutable; only user-facing public projection fields change. */
export function projectEventDetailIcons(
  detail: StaticEventDetail,
  iconMap: ReadonlyMap<string, PublicXIconEntry>,
): StaticEventDetail {
  return {
    ...detail,
    publicStaff: detail.publicStaff.map((m) => ({
      ...m,
      icon_url: resolveProjectedIcon({ xUserId: m.x_user_id, iconMap, legacyIconUrl: m.icon_url }),
      has_public_profile: (m.has_public_profile ?? false) ||
        hasProjectedPublicProfile({ xUserId: m.x_user_id, iconMap }),
    })),
    publicVideos: detail.publicVideos.map((v) => ({
      ...v,
      creator_icon_url: resolveProjectedIcon({
        xUserId: v.creator_x_user_id,
        iconMap,
        legacyIconUrl: v.creator_icon_url,
      }),
    })),
  };
}

export function portfolioIconUrl(
  user: { id: string; icon_url: string | null },
  iconMap: ReadonlyMap<string, PublicXIconEntry>,
): string | null {
  return cachedGoogleImageUrl(
    normalizePublicIconUrl(user.icon_url) ??
    resolveProjectedIcon({ xUserId: user.id, iconMap, legacyIconUrl: null }),
  );
}
