import type { EditAccess, EditCollabSubject, EditCollabSummary, EditNotice, EditSections } from "@flamenode/contracts";
import {
  canAttachInitialYoutubeToSlottedVideo,
  canUseEventPrivilegeFromAccessContext,
  decideCanEditVideoFromAccessContext,
  parseGeneralEditableFields,
  parseGeneralEditablePolicyV2,
  resolveEventPermissionFromAccessContext,
  resolveGeneralEditableFieldsFromPolicy,
  resolveGeneralEditableScope,
  resolveVideoOwnershipSync,
  type CanEditVideoPrivilegeMode,
  type GeneralEditableFieldKey,
  type VideoEditAccessContext,
  type VideoEditSectionKey,
} from "@flamenode/domain/video";
import { normalizeXId } from "@flamenode/domain/xid";
import { resolveStaffPermissionKeys } from "../../manage/access.ts";
import type { CollabRow, EditData, VideoRow } from "./data.ts";

// CURRENT: app/(auth)/dashboard/edit/[id]/page.tsx and permissions/page.tsx (the permission part of the loaders),
// src/lib/auth/ownership.ts (resolveVideoEditAccessContext, loadEffectiveOwnerEditableFieldSet, canEditVideo with an
// accessContext), src/lib/video/collabPerms.ts. The decisions themselves are the domain package's pure functions.

/** CURRENT MAX_ATOMIC_VIDEO_EVENTS (src/lib/video/atomicLimits.ts): the access snapshot keeps 4 events. */
const MAX_ATOMIC_VIDEO_EVENTS = 4;

export type PrivilegeMode = CanEditVideoPrivilegeMode;

export function normalizePrivilegeMode(raw: string | undefined): PrivilegeMode {
  return raw === "admin" || raw === "event" ? raw : "normal";
}

/** CURRENT page `currentEventIds`: video_events, then the primary event when it is not among them. */
export function pageEventIds(video: VideoRow, videoEventIds: readonly string[]): string[] {
  const ids = [...videoEventIds];
  if (video.primary_event_id && !ids.includes(video.primary_event_id)) ids.push(video.primary_event_id);
  return ids;
}

/** CURRENT loadEffectiveOwnerEditableFieldSet / loadGeneralEditableFieldSet over the rows the data statement read. */
export function ownerEditableFields(video: VideoRow, data: EditData): Set<GeneralEditableFieldKey> {
  const globalFields = (): Set<GeneralEditableFieldKey> => {
    const row = data.policySystem;
    if (!row) return new Set();
    const csv = resolveGeneralEditableScope(video) === "default" ? row.default_editable_fields : row.upcoming_editable_fields;
    return parseGeneralEditableFields(csv);
  };
  if (!video.primary_event_id) return globalFields();
  const row = data.policyEvent;
  if (row?.allow_user_video_edits === 1) {
    const policyJson = row.user_video_edit_permission_keys_json?.trim() ?? "";
    if (policyJson.startsWith("[")) return parseGeneralEditableFields(policyJson);
    if (!policyJson.startsWith("{")) return parseGeneralEditableFields(policyJson);
    if (parseGeneralEditablePolicyV2(policyJson)) {
      return resolveGeneralEditableFieldsFromPolicy({
        allowUserVideoEdits: row.allow_user_video_edits,
        policyJson,
        globalFields: globalFields(),
      });
    }
    return new Set();
  }
  return globalFields();
}

/** CURRENT resolveVideoEditAccessContext (the page passes its own event list; permissions passes none). */
export function buildAccessContext(args: {
  userId: string;
  video: VideoRow;
  approvedXIds: readonly string[];
  data: EditData;
}): VideoEditAccessContext {
  const { video, data } = args;
  const approved = Array.from(args.approvedXIds);
  const ownership = resolveVideoOwnershipSync({
    approvedXUserIds: approved,
    creatorXUserId: video.creator_x_user_id,
    hasCollaboratorEdit: approved.length > 0 && data.hasCollaboratorEdit,
  });
  const eventIds = Array.from(new Set(pageEventIds(video, data.videoEventIds)));
  const currentEventIds = [
    ...(video.primary_event_id ? [video.primary_event_id] : []),
    ...eventIds.filter((eventId) => eventId !== video.primary_event_id),
  ].slice(0, MAX_ATOMIC_VIDEO_EVENTS);
  const eventPermissionKeysByEvent = new Map<string, Set<string>>();
  if (approved.length > 0 && currentEventIds.length > 0) {
    for (const row of data.staff) {
      if (!currentEventIds.includes(row.event_id)) continue;
      const keys = eventPermissionKeysByEvent.get(row.event_id) ?? new Set<string>();
      for (const key of resolveStaffPermissionKeys(row)) keys.add(key);
      eventPermissionKeysByEvent.set(row.event_id, keys);
    }
  }
  return {
    userId: args.userId,
    videoId: video.id,
    approvedXUserIds: approved,
    ownership,
    currentEventIds,
    ownerEditableFields: ownership.isOwner ? ownerEditableFields(video, data) : new Set<GeneralEditableFieldKey>(),
    eventPermissionKeysByEvent,
  };
}

export const canEdit = (
  context: VideoEditAccessContext,
  role: string | null,
  requiredKey: VideoEditSectionKey,
  privilegeMode: PrivilegeMode,
): boolean => decideCanEditVideoFromAccessContext({ context, userRole: role, requiredKey, privilegeMode });

export const canOfferEventMode = (context: VideoEditAccessContext): boolean => canUseEventPrivilegeFromAccessContext(context);

/** CURRENT section order of the page (sectionPermissionKeys). */
const SECTION_KEYS: ReadonlyArray<{ section: keyof EditSections; key: VideoEditSectionKey }> = [
  { section: "identity", key: "video.identity" },
  { section: "basics", key: "video.basics" },
  { section: "youtube", key: "video.youtube_id" },
  { section: "credits", key: "video.credits" },
  { section: "descriptions", key: "video.descriptions" },
  { section: "members", key: "video.members" },
  { section: "memberChapters", key: "video.member_chapters" },
  { section: "primaryEvent", key: "video.primary_event" },
  { section: "visibility", key: "video.status" },
  { section: "permissions", key: "video.permissions" },
];

export interface EditDecision {
  access: EditAccess;
  canEditYoutube: boolean;
  canEditPermissions: boolean;
  hasAnyEditCapability: boolean;
  canShowPrivilegeSwitchOnly: boolean;
  noticeIfBlocked: EditNotice;
  generalFields: Set<GeneralEditableFieldKey> | undefined;
  allowInitialYoutubeAttach: boolean;
  canEditPrimaryEvent: boolean;
}

/** Everything the edit page decides from the access context before it renders (page.tsx lines 154-640). */
export function decideEditPage(args: {
  userRole: string | null;
  video: VideoRow;
  data: EditData;
  context: VideoEditAccessContext;
  requestedMode: PrivilegeMode;
}): EditDecision {
  const { video, data, context, userRole } = args;
  const ownership = context.ownership;
  const offerEvent = canOfferEventMode(context);
  let privilegeMode: PrivilegeMode = "normal";
  if (args.requestedMode === "admin" && userRole === "admin") privilegeMode = "admin";
  else if (args.requestedMode === "event" && offerEvent) privilegeMode = "event";

  const currentEventIds = pageEventIds(video, data.videoEventIds);
  const editableEventIds = currentEventIds.filter((eventId) => (context.eventPermissionKeysByEvent.get(eventId)?.size ?? 0) > 0);
  const isEventStaffForVideo = editableEventIds.length > 0;

  // membershipHint (page.tsx 402-421)
  let membershipHint: EditAccess["membershipHint"] = "outsider";
  if (ownership.isOwner) membershipHint = "none";
  else if (context.approvedXUserIds.length > 0 && data.hasNoEditMembership) membershipHint = "member_no_edit";

  const can = (key: VideoEditSectionKey) => canEdit(context, userRole, key, privilegeMode);
  const allowInitialYoutubeAttach = canAttachInitialYoutubeToSlottedVideo({
    sourceType: video.source_type,
    schedulingType: video.scheduling_type,
    visibilityStatus: video.visibility_status,
    youtubeVideoId: video.youtube_video_id?.trim() || null,
    privilegeMode,
    isCreatorOwner: ownership.isCreatorOwner,
  });
  const sections: EditSections = {
    identity: can("video.identity"),
    basics: can("video.basics"),
    youtube: can("video.youtube_id") || allowInitialYoutubeAttach,
    credits: can("video.credits"),
    descriptions: can("video.descriptions"),
    members: can("video.members"),
    memberChapters: can("video.member_chapters"),
    primaryEvent: can("video.primary_event"),
    visibility: can("video.status"),
    permissions: can("video.permissions"),
  };
  const canOfferAdminMode = userRole === "admin" && privilegeMode !== "admin";
  const titleOf = (eventId: string | undefined | null): string | undefined =>
    eventId == null ? undefined : data.eventTitles.get(eventId);

  let sectionEventSources: EditAccess["sectionEventSources"] = null;
  if (privilegeMode === "event") {
    sectionEventSources = {};
    for (const { section, key } of SECTION_KEYS) {
      const grant = resolveEventPermissionFromAccessContext(context, key);
      if (!grant.allowed) continue;
      sectionEventSources[section] = { eventId: grant.eventId, eventTitle: titleOf(grant.eventId) ?? null };
    }
  }
  const eventTitleForMode =
    privilegeMode === "event"
      ? (video.primary_event_id && titleOf(video.primary_event_id)) ||
        Object.values(sectionEventSources ?? {})
          .map((meta) => meta.eventTitle)
          .find(Boolean) ||
        editableEventIds.map((id) => titleOf(id)).find(Boolean) ||
        null
      : null;

  const canEditAnySection =
    sections.identity || sections.basics || sections.youtube || sections.credits || sections.descriptions ||
    sections.members || sections.memberChapters || sections.primaryEvent;
  const canEditAnyCapability = canEditAnySection || sections.permissions;
  const hasAnyEditCapability = canEditAnyCapability || canOfferAdminMode || offerEvent;

  let noticeIfBlocked: EditNotice = "not_editable";
  if (!ownership.isOwner && isEventStaffForVideo && !offerEvent) noticeIfBlocked = "event_staff_insufficient";
  else if (ownership.isOwner && privilegeMode === "normal" && !canEditAnyCapability) noticeIfBlocked = "owner_policy_denied";

  return {
    access: {
      privilegeMode,
      ownership: { ...ownership },
      canOfferAdminMode,
      canOfferEventMode: offerEvent,
      membershipHint,
      sections,
      sectionEventSources,
      eventId: privilegeMode === "event" ? (video.primary_event_id ?? editableEventIds[0] ?? null) : null,
      eventTitleForMode,
      canEditAnySection,
    },
    canEditYoutube: sections.youtube,
    canEditPermissions: sections.permissions,
    hasAnyEditCapability,
    canShowPrivilegeSwitchOnly: !canEditAnySection && !sections.permissions && (canOfferAdminMode || offerEvent),
    noticeIfBlocked,
    generalFields: privilegeMode === "normal" ? new Set(context.ownerEditableFields) : undefined,
    allowInitialYoutubeAttach,
    canEditPrimaryEvent: sections.primaryEvent,
  };
}

/**
 * CURRENT loadVideoCollabSubjects: one subject per normalized X ID. CURRENT has no ORDER BY there; its plan
 * (video_members_video_can_edit_idx) yields can_edit ASC, rowid, which is restored here. The SQL reads editors first
 * (can_edit DESC) so that a list cut at 100 rows keeps the editors.
 */
export function collabSubjectsOf(rows: readonly CollabRow[]): Array<EditCollabSubject> {
  const byXId = new Map<string, EditCollabSubject>();
  for (const row of [...rows].sort((x, y) => x.can_edit - y.can_edit || x.rid - y.rid)) {
    if (row.is_public_member !== 1 && row.can_edit !== 1) continue;
    const xid = normalizeXId(row.x_user_id);
    if (!xid) continue;
    const existing = byXId.get(xid);
    byXId.set(xid, {
      x_user_id: xid,
      user_id: null,
      display_name:
        existing && existing.is_public_member === 1 && row.is_public_member === 0 ? existing.display_name : row.name,
      can_edit: existing?.can_edit === 1 || row.can_edit === 1 ? 1 : 0,
      is_public_member: existing?.is_public_member === 1 || row.is_public_member === 1 ? 1 : 0,
      has_discord_link: Boolean(existing?.has_discord_link) || row.has_account_link === 1,
      can_notify: Boolean(existing?.can_notify) || row.has_notifiable_link === 1,
    });
  }
  return Array.from(byXId.values());
}

/** CURRENT computeEditPermissionSummary. */
export function editPermissionSummary(subjects: ReadonlyArray<EditCollabSubject>): EditCollabSummary {
  const editors = subjects.filter((subject) => subject.can_edit === 1);
  const names: string[] = [];
  let unlinkedEditorCount = 0;
  let notifiableEditorCount = 0;
  for (const editor of editors) {
    if (editor.display_name) names.push(editor.display_name);
    if (!editor.has_discord_link) unlinkedEditorCount += 1;
    if (editor.can_notify) notifiableEditorCount += 1;
  }
  const displayNames =
    names.length === 0
      ? ""
      : names.length <= 3
        ? `${names.join("、")} に編集権限が付与されています。`
        : `${names.slice(0, 3).join("、")}、ほか${names.length - 3}人`;
  const warnings: EditCollabSummary["warnings"] = [];
  if (unlinkedEditorCount > 0) {
    warnings.push({
      tone: "warning",
      title: "X ID連携待ちの編集者がいます。",
      detail: "権限自体は保存済みです。対象X IDとログインアカウントの連携が承認されると編集できるようになります。",
    });
  }
  return { editorCount: editors.length, unlinkedEditorCount, notifiableEditorCount, displayNames, warnings };
}
