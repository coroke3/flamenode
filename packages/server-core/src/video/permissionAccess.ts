import type { ServerCoreDb } from "../db.ts";
import {
  canEditVideo,
  canUseEventPrivilegeModeForVideo,
  resolveVideoEditAccessContext,
  type CanEditVideoPrivilegeMode,
  type SessionUserLike,
  type VideoEditAccessContext,
} from "../auth/ownership.ts";
import { loadPermissionVideoRow } from "./permissionVideoRead.ts";

export type AuthorizedPermissionVideo = NonNullable<
  Awaited<ReturnType<typeof loadPermissionVideoRow>>
> & { privilegeMode: CanEditVideoPrivilegeMode };

/**
 * SA-082..084: shared video.permissions authorization for CURRENT and Hono.
 *
 * The caller MUST separately validate the HTTP origin, session, ban/terms
 * write guard, and (for Hono) the user's session snapshot. This function does
 * not authorize HTTP requests, mutate D1, or enqueue a rebuild.
 *
 * A nonempty requested privilege mode NEVER silently falls back to an
 * alternate source. Only the legacy empty mode tries admin then event when
 * the normal ownership decision failed.
 */
export async function loadAuthorizedPermissionVideo(
  db: ServerCoreDb,
  actor: SessionUserLike,
  videoId: string,
  privilegeModeRaw: string,
): Promise<AuthorizedPermissionVideo | null> {
  const row = await loadPermissionVideoRow(db, videoId);
  if (!row) return null;
  const video = { ...row, submitted_by_user_id: row.submitted_by_user_id ?? "" };
  const accessContext = await resolveVideoEditAccessContext({
    db, user: actor, video, skipOwnerEditableFields: true,
  });

  const requested = privilegeModeRaw.trim();
  const resolveMode = async (
    rawMode: string,
    context: VideoEditAccessContext,
  ): Promise<CanEditVideoPrivilegeMode> => {
    if (rawMode === "admin" && actor.role === "admin") return "admin";
    if (rawMode === "event") {
      const allowed = await canUseEventPrivilegeModeForVideo({
        user: actor, video, accessContext: context,
      });
      if (allowed) return "event";
    }
    return "normal";
  };
  const requestedMode = await resolveMode(requested, accessContext);
  const allowed = await canEditVideo({
    db, user: actor, video, requiredKey: "video.permissions",
    privilegeMode: requestedMode, accessContext,
  });
  if (allowed) return { ...video, privilegeMode: requestedMode };
  if (requested) return null;

  if (actor.role === "admin") {
    const adminAllowed = await canEditVideo({
      db, user: actor, video, requiredKey: "video.permissions",
      privilegeMode: "admin", accessContext,
    });
    if (adminAllowed) return { ...video, privilegeMode: "admin" };
  }
  const canUseEvent = await canUseEventPrivilegeModeForVideo({
    user: actor, video, accessContext,
  });
  if (canUseEvent) {
    const eventAllowed = await canEditVideo({
      db, user: actor, video, requiredKey: "video.permissions",
      privilegeMode: "event", accessContext,
    });
    if (eventAllowed) return { ...video, privilegeMode: "event" };
  }
  return null;
}
