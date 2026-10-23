import { Hono } from "hono";
import type { EditPermissionsResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { approvedXIdsOf, loadPersonalContext } from "../context.ts";
import { assertResponseBytes, jsonBytes, MAX_RESPONSE_BYTES, takeWithinBytes } from "../entry/rows.ts";
import { buildAccessContext, canEdit, canOfferEventMode, collabSubjectsOf, normalizePrivilegeMode, type PrivilegeMode } from "./access.ts";
import { loadEditData, MAX_EDIT_COLLAB_SUBJECTS, MAX_EDIT_MEMBERS } from "./data.ts";

// CURRENT: app/(auth)/dashboard/edit/[id]/permissions/page.tsx (loader part). GET only.
// 404 `{error:"not_found"}` = notFound(); `{kind:"no_access"}` = the "編集権限がありません" panel (it links back with
// `privilegeMode`). tableAvailable (video_members.can_edit missing) is always true on D1 and is not returned.
// D1 (S2): context = 1, then ONE data statement (shared with the edit page, without its software / creator-X arms).

export const personalEditPermissionsRoutes = new Hono<AppEnv>().get("/:id/permissions", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const id = c.req.param("id");
  const ctx = await loadPersonalContext(db, sessionUser, {});
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const user = ctx.user;
  const approvedXIds = approvedXIdsOf(ctx.linkedRows);

  const data = await loadEditData(db, id, approvedXIds, "permissions");
  const video = data.video;
  if (!video) return c.json({ error: "not_found" }, 404);

  const queries = c.req.queries("privileged");
  const rawRequestedMode = (queries?.length === 1 ? queries[0] : undefined)?.trim();
  const hasExplicitPrivilegeMode = Boolean(rawRequestedMode);
  const requestedMode = normalizePrivilegeMode(rawRequestedMode);

  const context = buildAccessContext({ userId: user.id, video, approvedXIds, data });
  const offerEvent = canOfferEventMode(context);
  const allowed = (mode: PrivilegeMode) => canEdit(context, user.role, "video.permissions", mode);

  // Explicit modes are fail-closed; without a query: normal first, then site admin, then event staff.
  let privilegeMode: PrivilegeMode = "normal";
  if (requestedMode === "admin" && user.role === "admin") privilegeMode = "admin";
  else if (requestedMode === "event" && offerEvent) privilegeMode = "event";
  let canEditPermissions = allowed(privilegeMode);
  if (!canEditPermissions && !hasExplicitPrivilegeMode) {
    if (user.role === "admin" && allowed("admin")) {
      privilegeMode = "admin";
      canEditPermissions = true;
    }
    if (!canEditPermissions && offerEvent && allowed("event")) {
      privilegeMode = "event";
      canEditPermissions = true;
    }
  }
  if (!canEditPermissions) return c.json({ kind: "no_access", privilegeMode } satisfies EditPermissionsResponse);

  const subjectRows = data.collab.slice(0, MAX_EDIT_COLLAB_SUBJECTS);
  const subjects = collabSubjectsOf(subjectRows);
  const showCollabSection = video.collaboration_type === "collab" || subjects.length > 0;
  const base: Extract<EditPermissionsResponse, { kind: "ok" }> = {
    kind: "ok",
    privilegeMode,
    video: {
      id: video.id,
      title: video.title,
      youtube_video_id: video.youtube_video_id,
      collaboration_type: video.collaboration_type,
    },
    showCollabSection,
    subjects: [],
    publicMembers: [],
    truncated: false,
  };
  if (!showCollabSection) return c.json(base);

  // Lists are cut by bytes (first-row rule) so the response stays <= 64 KiB.
  const publicMembers = data.members.slice(0, MAX_EDIT_MEMBERS).map((m) => ({
    x_user_id: m.x_user_id,
    display_name: m.name,
    role: m.role,
    can_edit: m.can_edit,
  }));
  const budget = Math.max(MAX_RESPONSE_BYTES - jsonBytes(base) - 64, 4);
  const keptSubjects = takeWithinBytes(subjects, Math.floor(budget / 2));
  const keptMembers = takeWithinBytes(publicMembers, budget - jsonBytes(keptSubjects.items) - 2);
  const body: EditPermissionsResponse = {
    ...base,
    subjects: keptSubjects.items,
    publicMembers: keptMembers.items,
    truncated:
      data.collab.length > MAX_EDIT_COLLAB_SUBJECTS ||
      data.members.length > MAX_EDIT_MEMBERS ||
      keptSubjects.cut ||
      keptMembers.cut,
  };
  assertResponseBytes(body);
  return c.json(body);
});
