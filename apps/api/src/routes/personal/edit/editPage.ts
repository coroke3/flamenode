import { Hono } from "hono";
import { disabledFieldKeysFromGeneralFields as disabledFieldKeys } from "@flamenode/domain/video";
import type { EditMember, EditPageResponse } from "@flamenode/contracts";
import type { AppEnv } from "../../../env.ts";
import { approvedXIdsOf, loadPersonalContext } from "../context.ts";
import { assertResponseBytes, jsonBytes, MAX_RESPONSE_BYTES, takeWithinBytes } from "../entry/rows.ts";
import { buildAccessContext, collabSubjectsOf, decideEditPage, editPermissionSummary, normalizePrivilegeMode, pageEventIds } from "./access.ts";
import { loadEditData, MAX_EDIT_COLLAB_SUBJECTS, MAX_EDIT_MEMBERS } from "./data.ts";

// CURRENT: app/(auth)/dashboard/edit/[id]/page.tsx (loader part). GET only: nothing is written.
// CURRENT's notFound() is 404 `{error:"not_found"}`; its "編集権限がありません" panel is `{kind:"no_access"}` (200, no video data).
// D1 (S2, 3 statements incl. the session lookup): context = 1, then ONE data statement (see ./data.ts).
// NOT in this unit (later unit of MIG-0630): event options, custom questions / answers, stage-permission answers,
// software / icon / channel suggestions of the form.

const sortJa = (a: { x_name: string }, b: { x_name: string }) => a.x_name.localeCompare(b.x_name, "ja");

export const personalEditPageRoutes = new Hono<AppEnv>().get("/:id", async (c) => {
  const sessionUser = c.get("user");
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  const db = c.env.DB;
  const id = c.req.param("id");
  const ctx = await loadPersonalContext(db, sessionUser, {});
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const user = ctx.user;
  const approvedXIds = approvedXIdsOf(ctx.linkedRows);

  const data = await loadEditData(db, id, approvedXIds, "edit");
  const video = data.video;
  if (!video) return c.json({ error: "not_found" }, 404);
  const youtubeVideoId = video.youtube_video_id?.trim() || null;

  // Next gives an array for a repeated `?privileged=`; normalizePrivilegeMode treats it as "normal".
  const requested = c.req.queries("privileged");
  const context = buildAccessContext({ userId: user.id, video, approvedXIds, data });
  const decision = decideEditPage({
    userRole: user.role,
    video,
    data,
    context,
    requestedMode: normalizePrivilegeMode(requested?.length === 1 ? requested[0] : undefined),
  });
  const { access } = decision;

  if (!decision.hasAnyEditCapability) {
    return c.json({ kind: "no_access", message: decision.noticeIfBlocked, public_id: youtubeVideoId ?? video.id } satisfies EditPageResponse);
  }
  const header = { id: video.id, title: video.title, visibility_status: video.visibility_status, youtube_video_id: youtubeVideoId };
  const events = Array.from(data.eventTitles, ([eventId, title]) => ({ id: eventId, title }));
  if (decision.canShowPrivilegeSwitchOnly) {
    const message = access.canOfferAdminMode ? "switch_admin" : access.canOfferEventMode ? "switch_event" : decision.noticeIfBlocked;
    const body: EditPageResponse = { kind: "switch_only", user, video: header, access, message, events };
    assertResponseBytes(body);
    return c.json(body);
  }

  const s = access.sections;
  const disabledSections = [
    !s.identity ? "submitter" : null,
    !s.basics && !s.youtube && !s.credits ? "video" : null,
    !s.descriptions ? "descriptions" : null,
    !s.members && !s.memberChapters ? "members" : null,
  ].filter((v): v is string => Boolean(v));
  const generalDisabledFields =
    decision.generalFields !== undefined
      ? disabledFieldKeys(decision.generalFields).filter((field) => !(decision.allowInitialYoutubeAttach && field === "video.youtube_url"))
      : [];
  const disabledFields = [
    !s.identity ? "submitter.display_name" : null,
    !s.identity ? "submitter.icon_url" : null,
    !s.identity ? "submitter.profile_text" : null,
    !s.identity ? "submitter.youtube_channel_url" : null,
    !s.identity ? "submitter.other_social_links" : null,
    !s.basics ? "video.title" : null,
    !s.basics ? "video.part" : null,
    !s.youtube ? "video.youtube_url" : null,
    !s.credits ? "video.music" : null,
    !s.credits ? "video.credit" : null,
    !s.memberChapters ? "chapters" : null,
    !s.members ? "members" : null,
    ...generalDisabledFields,
  ].filter((v): v is string => Boolean(v));

  const subjectRows = data.collab.slice(0, MAX_EDIT_COLLAB_SUBJECTS);
  const subjects = collabSubjectsOf(subjectRows);
  const showSummary = s.permissions && (video.collaboration_type === "collab" || subjects.length > 0);
  const memberRows = data.members.slice(0, MAX_EDIT_MEMBERS);
  const allMembers: EditMember[] = memberRows.map((m) => ({
    name: m.name,
    x_user_id: m.x_user_id ?? "",
    role: m.role ?? "",
    comment: m.comment ?? "",
    can_edit: m.can_edit,
    is_public_member: m.is_public_member,
  }));

  const x = data.creatorX;
  const base: Extract<EditPageResponse, { kind: "edit" }> = {
    kind: "edit",
    user,
    video: {
      ...header,
      updated_at: video.updated_at,
      scheduling_type: video.scheduling_type,
      collaboration_type: video.collaboration_type,
      primary_event_id: video.primary_event_id,
      part: video.part,
      creator_display_name: video.creator_display_name,
      creator_x_user_id: video.creator_x_user_id,
      creator_icon_url: video.creator_icon_url,
      creator_profile_text: video.creator_profile_text,
      creator_youtube_channel_url: video.creator_youtube_channel_url,
      creator_other_social_links: video.creator_other_social_links,
      music: video.music,
      music_reference_url: video.music_reference_url,
      credit: video.credit,
      intro_comment: video.intro_comment,
      highlights: video.highlights,
      production_story: video.production_story,
      closing_comment: video.closing_comment,
    },
    access,
    disabledSections,
    disabledFields,
    canEditEvents: decision.canEditPrimaryEvent,
    canChangeSubmitter: access.privilegeMode === "admin" && user.role === "admin",
    defaultProfile: x
      ? {
          display_name: x.x_name,
          icon_url: x.icon_url,
          profile_text: x.profile_text,
          youtube_channel_url: x.youtube_channel_url,
          other_social_links: x.other_social_links,
        }
      : null,
    softwareLabel: data.softwareLabels.length > 0 ? data.softwareLabels.join(", ") : null,
    isCollab: video.collaboration_type === "collab" || data.members.length > 0,
    eventIds: pageEventIds(video, data.videoEventIds),
    events,
    members: [],
    membersTruncated: false,
    xIdOptions: ctx.linkedRows
      .filter((row) => row.approval_status === "approved")
      .map((row) => ({ id: row.x_user_id, x_name: row.x_name }))
      .sort(sortJa),
    permissionSummary: showSummary ? editPermissionSummary(subjects) : null,
    collabTruncated: data.collab.length > MAX_EDIT_COLLAB_SUBJECTS,
  };
  // The member list is the only unbounded-by-content part: cut it by bytes (first-row rule) to keep the response <= 64 KiB.
  const budget = MAX_RESPONSE_BYTES - jsonBytes(base) - 64;
  const kept = takeWithinBytes(allMembers, Math.max(budget, 2));
  const body: EditPageResponse = {
    ...base,
    members: kept.items,
    membersTruncated: data.members.length > MAX_EDIT_MEMBERS || kept.cut,
  };
  assertResponseBytes(body);
  return c.json(body);
});
