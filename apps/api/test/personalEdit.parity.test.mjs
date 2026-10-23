import assert from "node:assert/strict";
import { test } from "node:test";
import { cookie, createD1, createSqlite, runUnderRootTsx } from "./support/personalHarness.mjs";
import { seed } from "./support/personalSeed.mjs";
import { BIG_VIDEOS, EDIT_VIDEOS, seedEdit } from "./support/personalEditSeed.mjs";

// MIG-0630 parity: the same seed is read by CURRENT's logic (the real src/** modules ownership / collabPerms /
// generalEditPermissions / videoEditPermissionView ..., with the loader code of app/(auth)/dashboard/edit/[id]/page.tsx
// and permissions/page.tsx copied below) and by the Hono /api/personal/edit/:id[/permissions] routes.
if (runUnderRootTsx(import.meta.url)) {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: "data:text/javascript,export%20{}", shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });

  const { drizzle } = await import("drizzle-orm/sqlite-proxy");
  const { and, eq, inArray } = await import("drizzle-orm");
  const S = await import("../../../src/lib/db/schema.ts");
  const { app } = await import("../src/app.ts");
  const { EditFormOptionsResponseSchema, EditPageResponseSchema, EditPermissionsResponseSchema } = await import("@flamenode/contracts");
  const { getHeaderLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/headerLinkedXUsers.ts");
  const { resolveActiveXUserId } = await import("../../../src/lib/auth/resolveActiveXId.ts");
  const { getLinkedXUsersForAuthUser } = await import("../../../src/lib/auth/xIdentity.ts");
  const { getLatestPublishedMajorTerms, termsReacceptRequiredValue } = await import("../../../src/lib/terms/reaccept.ts");
  const { normalizeXId } = await import("../../../src/lib/utils/xid.ts");
  const own = await import("../../../src/lib/auth/ownership.ts");
  const { approvedXIdsWhere } = await import("../../../src/lib/auth/approvedX.ts");
  const { loadVideoCollabSubjects, computeEditPermissionSummary } = await import("../../../src/lib/video/collabPerms.ts");
  const { disabledFieldKeysFromGeneralFields } = await import("../../../src/lib/video/generalEditPermissions.ts");
  const { buildVideoEditPermissionViewModel } = await import("../../../src/lib/video/videoEditPermissionView.ts");
  const { hasAnyEditableVideoFormSection } = await import("../../../src/lib/video/permissionUnlockHint.ts");
  const { canAttachInitialYoutubeToSlottedVideo } = await import("../../../src/lib/video/youtubeAttachEligibility.ts");
  const { getVideoSoftwareLabel } = await import("../../../src/lib/db/software.ts");
  const { acceptingEntriesWhere } = await import("../../../src/lib/utils/eventStatus.ts");
  const { getUsedSoftwareSuggestions } = await import("../../../src/lib/db/videoFormSuggestions.ts");
  const { getXIconCandidates } = await import("../../../src/lib/db/xIconResolution.ts");
  const { getYoutubeChannelCandidates } = await import("../../../src/lib/db/youtubeChannelCandidates.ts");
  const { fetchActiveCustomQuestionsForEvents } = await import("../../../src/lib/video/customQuestionAnswers.ts");
  const { loadStagePermissionFormSettingsJsonByEvents } = await import("../../../src/lib/video/stagePermissionQuestions.ts");
  const { readStagePermissionCustomAnswers } = await import("../../../src/lib/video/stagePermissionAnswers.ts");

  const sqlite = createSqlite();
  seed(sqlite);
  seedEdit(sqlite);
  const refDb = drizzle(async (text, params, method) => {
    const statement = sqlite.prepare(text);
    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }
    const rows = statement.all(...params).map((row) => Object.values(row));
    return { rows: method === "get" ? rows[0] : rows };
  });

  const canon = (value) => JSON.parse(JSON.stringify(value ?? null));
  const USERS = ["alice", "frank", "ivy", "bob", "carol", "erin", "many", "hank", "dave", "gina"];
  const stats = {};
  const MATRIX_VIDEOS = [...EDIT_VIDEOS.filter((id) => !BIG_VIDEOS.includes(id)), "no-such-video"];
  const MODES = [undefined, "", "normal", "admin", "event", "bogus"];

  async function call(path, token, options = {}) {
    const d1 = options.d1 ?? createD1(sqlite);
    const response = await app.request(path, { method: options.method ?? "GET", headers: token ? cookie(token) : {} }, { DB: d1 });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const result = { status: response.status, headers: response.headers, text, body, stats: d1.stats };
    (stats[path.split("?")[0].replace(/\/[^/]+(\/(permissions|form-options))?$/, "/:id$1")] ??= []).push(d1.stats);
    return result;
  }
  const url = (id, suffix, mode) => `/api/personal/edit/${encodeURIComponent(id)}${suffix}${mode === undefined ? "" : `?privileged=${mode}`}`;

  // ---------- CURRENT reference ----------
  async function refUser(name) {
    const id = `u_${name}`;
    const requiredMajor = await getLatestPublishedMajorTerms(refDb);
    const row = (
      await refDb
        .select({
          id: S.users.id, name: S.users.name, image: S.users.image, role: S.users.role, is_banned: S.users.is_banned,
          active_x_user_id: S.users.active_x_user_id, is_tos_accepted: S.users.is_tos_accepted,
          accepted_terms_version_id: S.users.accepted_terms_version_id,
          terms_reaccept_required: termsReacceptRequiredValue(requiredMajor),
        })
        .from(S.users)
        .where(eq(S.users.id, id))
        .limit(1)
    )[0];
    const linked = await getHeaderLinkedXUsersForAuthUser(refDb, id);
    const active = await resolveActiveXUserId(refDb, id, normalizeXId(row.active_x_user_id) || null, linked);
    return {
      id: row.id, name: row.name ?? "ゲスト", image: row.image ?? null,
      role: row.role === "admin" || row.role === "moderator" ? row.role : "user",
      is_banned: row.is_banned ?? 0, active_x_user_id: active, is_tos_accepted: row.is_tos_accepted ?? 0,
      accepted_terms_version_id: row.accepted_terms_version_id ?? null,
      terms_reaccept_required: row.terms_reaccept_required === 1 ? 1 : 0,
    };
  }
  const normalizeMode = (raw) => (raw === "admin" || raw === "event" ? raw : "normal");

  // app/(auth)/dashboard/edit/[id]/page.tsx (loader part; event options / answers / suggestions are a later unit)
  async function refEdit(name, id, requestedRaw) {
    const user = await refUser(name);
    const db = refDb;
    const video = (await db.select().from(S.videos).where(eq(S.videos.id, id)).limit(1))[0];
    if (!video) return { status: 404 };
    const requestedMode = normalizeMode(requestedRaw);
    const youtubeVideoId = video.youtube_video_id?.trim() || null;
    const editUser = { id: user.id, role: user.role ?? null };
    let privilegeMode = "normal";
    const memberRows = await db
      .select({ x_user_id: S.videoMembers.x_user_id, name: S.videoMembers.name, role: S.videoMembers.role, comment: S.videoMembers.comment, order_index: S.videoMembers.order_index, can_edit: S.videoMembers.can_edit, is_public_member: S.videoMembers.is_public_member })
      .from(S.videoMembers)
      .where(and(eq(S.videoMembers.video_id, video.id), eq(S.videoMembers.is_public_member, 1)))
      .orderBy(S.videoMembers.order_index);
    const initialMembers = memberRows.map((m) => ({ name: m.name, x_user_id: m.x_user_id ?? "", role: m.role ?? "", comment: m.comment ?? "", can_edit: m.can_edit, is_public_member: m.is_public_member }));
    const creatorX = video.creator_x_user_id;
    const xRow = creatorX ? (await db.select().from(S.xUsers).where(eq(S.xUsers.id, creatorX)).limit(1))[0] : null;
    const softwareLabel = await getVideoSoftwareLabel(db, video.id);
    const currentVideoEvents = await db.select({ event_id: S.videoEvents.event_id }).from(S.videoEvents).where(eq(S.videoEvents.video_id, video.id));
    const currentEventIds = currentVideoEvents.map((r) => r.event_id);
    if (video.primary_event_id && !currentEventIds.includes(video.primary_event_id)) currentEventIds.push(video.primary_event_id);
    const accessContext = await own.resolveVideoEditAccessContext({ db, user: editUser, video, currentEventIds });
    const canOfferEventMode = await own.canUseEventPrivilegeModeForVideo({ user: editUser, video, accessContext });
    if (requestedMode === "admin" && user.role === "admin") privilegeMode = "admin";
    else if (requestedMode === "event" && canOfferEventMode) privilegeMode = "event";
    // eventOptions = accepting events + attached events; only attached ids are ever looked up for titles
    const attachedEventRows = currentEventIds.length > 0 ? await db.select({ id: S.events.id, title: S.events.title }).from(S.events).where(inArray(S.events.id, currentEventIds)) : [];
    const eventTitleById = new Map(attachedEventRows.map((e) => [e.id, e.title]));
    const { subjects: videoCollabSubjects, tableAvailable } = await loadVideoCollabSubjects(db, video.id);
    const permissionSummary = computeEditPermissionSummary(videoCollabSubjects, { viewerDiscordId: user.id, ownerDiscordId: video.submitted_by_user_id });
    const xIdOptions = (await getLinkedXUsersForAuthUser(db, user.id, { approvedOnly: true }))
      .map((row) => ({ id: row.x_user_id, x_name: row.x_name }))
      .sort((a, b) => a.x_name.localeCompare(b.x_name, "ja"));
    const generalFields = privilegeMode === "normal" ? new Set(accessContext.ownerEditableFields) : undefined;
    const approvedXIds = Array.from(accessContext.approvedXUserIds);
    const ownership = accessContext.ownership;
    const editableEventIds = currentEventIds.filter((eventId) => (accessContext.eventPermissionKeysByEvent.get(eventId)?.size ?? 0) > 0);
    const isEventStaffForVideo = editableEventIds.length > 0;
    let membershipHint = "outsider";
    if (ownership.isOwner) membershipHint = "none";
    else if (approvedXIds.length > 0) {
      const membershipRows = await db.select({ can_edit: S.videoMembers.can_edit }).from(S.videoMembers).where(and(eq(S.videoMembers.video_id, video.id), approvedXIdsWhere(S.videoMembers.x_user_id, approvedXIds))).limit(8);
      if (membershipRows.some((row) => row.can_edit === 0)) membershipHint = "member_no_edit";
      else if (membershipRows.length === 0) membershipHint = "outsider";
    }
    const can = (requiredKey) => own.canEditVideo({ db, user: editUser, video, requiredKey, privilegeMode, generalFields, approvedXUserIds: approvedXIds, ownership, accessContext });
    const [canEditIdentity, canEditBasics, canEditYoutubeByPolicy, canEditCredits, canEditDescriptions, canEditMembers, canEditMemberChapters, canEditPermissions, canEditPrimaryEvent, canEditVisibility] = await Promise.all([
      can("video.identity"), can("video.basics"), can("video.youtube_id"), can("video.credits"), can("video.descriptions"),
      can("video.members"), can("video.member_chapters"), can("video.permissions"), can("video.primary_event"), can("video.status"),
    ]);
    const allowInitialYoutubeAttach = canAttachInitialYoutubeToSlottedVideo({ sourceType: video.source_type, schedulingType: video.scheduling_type, visibilityStatus: video.visibility_status, youtubeVideoId, privilegeMode, isCreatorOwner: ownership.isCreatorOwner });
    const canEditYoutube = canEditYoutubeByPolicy || allowInitialYoutubeAttach;
    const canOfferAdminMode = user.role === "admin" && privilegeMode !== "admin";
    const sectionPermissionKeys = [
      { section: "identity", key: "video.identity" }, { section: "basics", key: "video.basics" }, { section: "youtube", key: "video.youtube_id" },
      { section: "credits", key: "video.credits" }, { section: "descriptions", key: "video.descriptions" }, { section: "members", key: "video.members" },
      { section: "memberChapters", key: "video.member_chapters" }, { section: "primaryEvent", key: "video.primary_event" },
      { section: "visibility", key: "video.status" }, { section: "permissions", key: "video.permissions" },
    ];
    let sectionEventSources;
    if (privilegeMode === "event") {
      sectionEventSources = {};
      for (const { section, key } of sectionPermissionKeys) {
        const grant = own.resolveEventPermissionFromAccessContext(accessContext, key);
        if (!grant.allowed) continue;
        sectionEventSources[section] = { eventId: grant.eventId, eventTitle: eventTitleById.get(grant.eventId) };
      }
    }
    const eventTitleForMode =
      privilegeMode === "event"
        ? (video.primary_event_id && eventTitleById.get(video.primary_event_id)) ||
          Object.values(sectionEventSources ?? {}).map((meta) => meta?.eventTitle).find(Boolean) ||
          editableEventIds.map((eid) => eventTitleById.get(eid)).find(Boolean) ||
          null
        : null;
    const sections = { identity: canEditIdentity, basics: canEditBasics, youtube: canEditYoutube, credits: canEditCredits, descriptions: canEditDescriptions, members: canEditMembers, memberChapters: canEditMemberChapters, primaryEvent: canEditPrimaryEvent, visibility: canEditVisibility, permissions: canEditPermissions };
    const permissionView = buildVideoEditPermissionViewModel({
      privilegeMode, ownership, canOfferAdminMode, canOfferEventMode, membershipHint,
      eventId: privilegeMode === "event" ? video.primary_event_id ?? editableEventIds[0] : undefined,
      eventTitle: eventTitleForMode ?? undefined, sectionEventSources, sections,
    });
    const canEditAnySection = hasAnyEditableVideoFormSection(permissionView);
    const canEditAnyCapability = canEditAnySection || canEditPermissions;
    const hasAnyEditCapability = canEditAnyCapability || canOfferAdminMode || canOfferEventMode;
    const noAccess = () => {
      if (!ownership.isOwner && isEventStaffForVideo && !canOfferEventMode) return "event_staff_insufficient";
      if (ownership.isOwner && privilegeMode === "normal" && !canEditAnyCapability) return "owner_policy_denied";
      return "not_editable";
    };
    const access = {
      privilegeMode, ownership: { isCreatorOwner: ownership.isCreatorOwner, isCollaboratorOwner: ownership.isCollaboratorOwner, isOwner: ownership.isOwner },
      canOfferAdminMode, canOfferEventMode, membershipHint, sections,
      sectionEventSources: sectionEventSources ? Object.fromEntries(Object.entries(sectionEventSources).map(([k, v]) => [k, { eventId: v.eventId, eventTitle: v.eventTitle ?? null }])) : null,
      eventId: privilegeMode === "event" ? video.primary_event_id ?? editableEventIds[0] ?? null : null,
      eventTitleForMode, canEditAnySection,
    };
    // the view model decides the same editable flags the DTO carries
    for (const { section } of sectionPermissionKeys) assert.equal(permissionView[section].editable, sections[section], section);
    if (!hasAnyEditCapability) return { status: 200, body: { kind: "no_access", message: noAccess(), public_id: youtubeVideoId ?? video.id } };
    const header = { id: video.id, title: video.title, visibility_status: video.visibility_status, youtube_video_id: youtubeVideoId };
    const events = attachedEventRows.map((e) => ({ id: e.id, title: e.title })).sort((a, b) => (a.id < b.id ? -1 : 1));
    const canShowPrivilegeSwitchOnly = !canEditAnySection && !canEditPermissions && (canOfferAdminMode || canOfferEventMode);
    if (canShowPrivilegeSwitchOnly) {
      const message = canOfferAdminMode ? "switch_admin" : canOfferEventMode ? "switch_event" : noAccess();
      return { status: 200, body: { kind: "switch_only", user, video: header, access, message, events } };
    }
    const disabledSections = [
      !canEditIdentity ? "submitter" : null,
      !canEditBasics && !canEditYoutube && !canEditCredits ? "video" : null,
      !canEditDescriptions ? "descriptions" : null,
      !canEditMembers && !canEditMemberChapters ? "members" : null,
    ].filter(Boolean);
    const generalDisabledFields = generalFields !== undefined ? disabledFieldKeysFromGeneralFields(generalFields).filter((f) => !(allowInitialYoutubeAttach && f === "video.youtube_url")) : [];
    const disabledFields = [
      !canEditIdentity ? "submitter.display_name" : null, !canEditIdentity ? "submitter.icon_url" : null, !canEditIdentity ? "submitter.profile_text" : null,
      !canEditIdentity ? "submitter.youtube_channel_url" : null, !canEditIdentity ? "submitter.other_social_links" : null,
      !canEditBasics ? "video.title" : null, !canEditBasics ? "video.part" : null, !canEditYoutube ? "video.youtube_url" : null,
      !canEditCredits ? "video.music" : null, !canEditCredits ? "video.credit" : null,
      !canEditMemberChapters ? "chapters" : null, !canEditMembers ? "members" : null, ...generalDisabledFields,
    ].filter(Boolean);
    const showSummary = canEditPermissions && (video.collaboration_type === "collab" || videoCollabSubjects.length > 0 || !tableAvailable);
    return {
      status: 200,
      body: {
        kind: "edit", user,
        video: {
          ...header, updated_at: video.updated_at, scheduling_type: video.scheduling_type, collaboration_type: video.collaboration_type,
          primary_event_id: video.primary_event_id, part: video.part, creator_display_name: video.creator_display_name, creator_x_user_id: video.creator_x_user_id,
          creator_icon_url: video.creator_icon_url, creator_profile_text: video.creator_profile_text, creator_youtube_channel_url: video.creator_youtube_channel_url,
          creator_other_social_links: video.creator_other_social_links, music: video.music, music_reference_url: video.music_reference_url, credit: video.credit,
          intro_comment: video.intro_comment, highlights: video.highlights, production_story: video.production_story, closing_comment: video.closing_comment,
        },
        access, disabledSections, disabledFields, canEditEvents: canEditPrimaryEvent, canChangeSubmitter: privilegeMode === "admin" && user.role === "admin",
        defaultProfile: xRow ? { display_name: xRow.x_name, icon_url: xRow.icon_url, profile_text: xRow.profile_text, youtube_channel_url: xRow.youtube_channel_url, other_social_links: xRow.other_social_links } : null,
        softwareLabel, isCollab: video.collaboration_type === "collab" || initialMembers.length > 0, eventIds: currentEventIds, events,
        members: initialMembers, membersTruncated: false, xIdOptions,
        permissionSummary: showSummary ? permissionSummary : null, collabTruncated: false,
      },
    };
  }

  // app/(auth)/dashboard/edit/[id]/permissions/page.tsx (loader part)
  async function refPermissions(name, id, rawMode) {
    const user = await refUser(name);
    const db = refDb;
    const rawRequestedMode = rawMode?.trim();
    const hasExplicitPrivilegeMode = Boolean(rawRequestedMode);
    const requestedMode = normalizeMode(rawRequestedMode);
    const video = (await db.select().from(S.videos).where(eq(S.videos.id, id)).limit(1))[0];
    if (!video) return { status: 404 };
    const editUser = { id: user.id, role: user.role ?? null };
    const accessContext = await own.resolveVideoEditAccessContext({ db, user: editUser, video });
    const canOfferEventMode = await own.canUseEventPrivilegeModeForVideo({ user: editUser, video, accessContext });
    let privilegeMode = "normal";
    if (requestedMode === "admin" && user.role === "admin") privilegeMode = "admin";
    else if (requestedMode === "event" && canOfferEventMode) privilegeMode = "event";
    const allowedIn = (mode) => own.canEditVideo({ db, user: editUser, video, requiredKey: "video.permissions", privilegeMode: mode, accessContext });
    let canEditPermissions = await allowedIn(privilegeMode);
    if (!canEditPermissions && !hasExplicitPrivilegeMode) {
      if (user.role === "admin" && (await allowedIn("admin"))) { privilegeMode = "admin"; canEditPermissions = true; }
      if (!canEditPermissions && canOfferEventMode && (await allowedIn("event"))) { privilegeMode = "event"; canEditPermissions = true; }
    }
    if (!canEditPermissions) return { status: 200, body: { kind: "no_access", privilegeMode } };
    const memberRows = await db
      .select({ x_user_id: S.videoMembers.x_user_id, name: S.videoMembers.name, role: S.videoMembers.role, can_edit: S.videoMembers.can_edit })
      .from(S.videoMembers)
      .where(and(eq(S.videoMembers.video_id, video.id), eq(S.videoMembers.is_public_member, 1)))
      .orderBy(S.videoMembers.order_index);
    const publicMembers = memberRows.map((m) => ({ x_user_id: m.x_user_id, display_name: m.name, role: m.role, can_edit: m.can_edit }));
    const { subjects, tableAvailable } = await loadVideoCollabSubjects(db, video.id);
    const showCollabSection = tableAvailable && (video.collaboration_type === "collab" || subjects.length > 0);
    return {
      status: 200,
      body: {
        kind: "ok", privilegeMode,
        video: { id: video.id, title: video.title, youtube_video_id: video.youtube_video_id, collaboration_type: video.collaboration_type },
        showCollabSection, subjects: showCollabSection ? subjects : [], publicMembers: showCollabSection ? publicMembers : [], truncated: false,
      },
    };
  }

  // app/(auth)/dashboard/edit/[id]/page.tsx (the part that feeds VideoForm: event options, questions, answers, suggestions, candidates).
  // The form is rendered only when the page is kind "edit" (refEdit); the order of eventOptions differs by design
  // (attached-only events first, then the accepting events, each by id; CURRENT: accepting in storage order, then attached-only).
  async function refFormOptions(name, id, rawMode) {
    const edit = await refEdit(name, id, rawMode);
    if (edit.status === 404) return { status: 404 };
    if (edit.body.kind !== "edit") return { status: 200, body: { kind: "no_access" } };
    const db = refDb;
    const video = (await db.select().from(S.videos).where(eq(S.videos.id, id)).limit(1))[0];
    const currentEventIds = (await db.select({ event_id: S.videoEvents.event_id }).from(S.videoEvents).where(eq(S.videoEvents.video_id, video.id))).map((r) => r.event_id);
    if (video.primary_event_id && !currentEventIds.includes(video.primary_event_id)) currentEventIds.push(video.primary_event_id);
    const creatorX = video.creator_x_user_id;
    const softwareSuggestions = await getUsedSoftwareSuggestions(db);
    const iconCandidates = creatorX ? await getXIconCandidates(db, creatorX) : [];
    const channelCandidates = creatorX ? await getYoutubeChannelCandidates(db, creatorX) : [];
    const now = Math.floor(Date.now() / 1000);
    const optionColumns = { id: S.events.id, title: S.events.title, parts_json: S.events.parts_json, youtube_description_template: S.events.youtube_description_template, required_video_fields_json: S.events.required_video_fields_json };
    const acceptingEventRows = await db.select(optionColumns).from(S.events).where(and(acceptingEntriesWhere(now), eq(S.events.allow_user_video_event_links, 1)));
    const attachedEventRows = currentEventIds.length > 0 ? await db.select(optionColumns).from(S.events).where(inArray(S.events.id, currentEventIds)) : [];
    const acceptingEventMap = new Map();
    for (const ev of acceptingEventRows) acceptingEventMap.set(ev.id, { ...ev });
    for (const ev of attachedEventRows) acceptingEventMap.set(ev.id, { ...ev });
    const formSettingsByEvent = await loadStagePermissionFormSettingsJsonByEvents(db, Array.from(acceptingEventMap.keys()));
    const customQuestionsByEvent = await fetchActiveCustomQuestionsForEvents(db, Array.from(acceptingEventMap.keys()));
    const options = Array.from(acceptingEventMap.values()).map((event) => ({ ...event, video_form_settings_json: formSettingsByEvent.get(event.id) ?? null, custom_questions: customQuestionsByEvent.get(event.id) ?? [] }));
    const customQuestionById = new Map(Array.from(customQuestionsByEvent.values()).flat().map((question) => [question.id, question]));
    const customQuestionIds = Array.from(customQuestionById.keys());
    const customAnswerRows = [];
    for (let index = 0; index < customQuestionIds.length; index += 80) {
      const chunk = customQuestionIds.slice(index, index + 80);
      const rows = await db
        .select({ event_id: S.videoCustomAnswers.event_id, question_id: S.videoCustomAnswers.question_id, answer_text: S.videoCustomAnswers.answer_text, answer_json: S.videoCustomAnswers.answer_json })
        .from(S.videoCustomAnswers)
        .where(and(eq(S.videoCustomAnswers.video_id, video.id), inArray(S.videoCustomAnswers.question_id, chunk)))
        .limit(chunk.length);
      customAnswerRows.push(...rows);
    }
    const initialCustomAnswers = {};
    for (const row of customAnswerRows) {
      const question = customQuestionById.get(row.question_id);
      if (!question) continue;
      if (row.answer_json?.trim()) {
        try {
          const parsed = JSON.parse(row.answer_json);
          if (Array.isArray(parsed)) {
            initialCustomAnswers[`${row.event_id}:${question.question_key}`] = parsed.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean);
            continue;
          }
        } catch {
          // invalid JSON: use the text
        }
      }
      if (row.answer_text?.trim()) initialCustomAnswers[`${row.event_id}:${question.question_key}`] = row.answer_text.trim();
    }
    const stagePermissionInitial = await readStagePermissionCustomAnswers(db, { videoId: video.id, eventIds: currentEventIds });
    const acceptingIds = new Set(acceptingEventRows.map((r) => r.id));
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const eventOptions = [...options.filter((o) => !acceptingIds.has(o.id)).sort(byId), ...options.filter((o) => acceptingIds.has(o.id)).sort(byId)];
    return {
      status: 200,
      body: canon({
        kind: "ready", eventOptions, truncated: false, nextOffset: null, customAnswers: initialCustomAnswers, customAnswersTruncated: false,
        stagePermissionAnswers: stagePermissionInitial ?? null, softwareSuggestions, iconCandidates, channelCandidates,
      }),
    };
  }

  // ---------------- access control ----------------
  test("auth: 401 without a session / expired, 403 banned, private,no-store; only the session lookup runs; GET only", async () => {
    for (const path of ["/api/personal/edit/ed-own1", "/api/personal/edit/ed-own1/permissions"]) {
      for (const token of [undefined, "tok-expired", "tok-nope"]) {
        const r = await call(path, token);
        assert.equal(r.status, 401, `${path} ${token}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.ok(r.stats.statements <= 1);
      }
      const banned = await call(path, "tok-banned");
      assert.equal(banned.status, 403);
      assert.equal(banned.headers.get("cache-control"), "private, no-store");
      assert.ok(banned.stats.statements <= 1, "a banned user never reaches the data statement");
      for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await call(path, "tok-alice", { method })).status, 404, `${method} ${path}`);
    }
  });

  // ---------------- T01/T02: equality with CURRENT ----------------
  test("T01/T02 edit page: every user x video x privileged mode equals CURRENT (kind, access, form values)", async () => {
    let kinds = {};
    for (const name of USERS) {
      for (const id of MATRIX_VIDEOS) {
        for (const mode of MODES) {
          const expected = await refEdit(name, id, mode);
          const r = await call(url(id, "", mode), `tok-${name}`);
          assert.equal(r.status, expected.status, `${name} ${id} ${mode}`);
          if (expected.status === 404) {
            assert.deepEqual(r.body, { error: "not_found" });
            continue;
          }
          assert.deepEqual(canon(r.body), canon(expected.body), `${name} ${id} ${mode}`);
          EditPageResponseSchema.parse(r.body);
          assert.equal(r.headers.get("cache-control"), "private, no-store");
          kinds[expected.body.kind] = (kinds[expected.body.kind] ?? 0) + 1;
        }
      }
    }
    // the matrix reaches every branch of the page
    assert.ok(kinds.edit > 50 && kinds.no_access > 50 && kinds.switch_only > 5, JSON.stringify(kinds));
  });

  test("T01/T02 permissions page: every user x video x privileged mode equals CURRENT", async () => {
    const kinds = {};
    for (const name of USERS) {
      for (const id of MATRIX_VIDEOS) {
        for (const mode of MODES) {
          const expected = await refPermissions(name, id, mode);
          const r = await call(url(id, "/permissions", mode), `tok-${name}`);
          assert.equal(r.status, expected.status, `${name} ${id} ${mode}`);
          if (expected.status === 404) {
            assert.deepEqual(r.body, { error: "not_found" });
            continue;
          }
          assert.deepEqual(canon(r.body), canon(expected.body), `${name} ${id} ${mode}`);
          EditPermissionsResponseSchema.parse(r.body);
          kinds[`${expected.body.kind}:${expected.body.privilegeMode}`] = true;
        }
      }
    }
    for (const key of ["ok:normal", "ok:admin", "ok:event", "no_access:normal"]) assert.ok(kinds[key], `matrix covers ${key}`);
  });

  test("IDOR: someone else's video exposes nothing but the public link target; unknown id is 404 for everyone", async () => {
    const r = await call(url("ed-none", "", undefined), "tok-bob");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { kind: "no_access", message: "not_editable", public_id: "ytNONE" });
    assert.doesNotMatch(r.text, /Edit title|Creator|zed/);
    const perm = await call(url("ed-none", "/permissions", undefined), "tok-bob");
    assert.deepEqual(perm.body, { kind: "no_access", privilegeMode: "normal" });
    for (const name of USERS) {
      assert.equal((await call(url("nope", "", undefined), `tok-${name}`)).status, 404);
      assert.equal((await call(url("nope", "/permissions", undefined), `tok-${name}`)).status, 404);
    }
  });

  test("owner policy inputs: system_settings missing / NULL columns equal CURRENT (global field set)", async () => {
    const saved = sqlite.prepare("SELECT * FROM system_settings WHERE id = 'default'").get();
    try {
      for (const variant of ["null-columns", "no-row"]) {
        if (variant === "null-columns") sqlite.exec("UPDATE system_settings SET default_editable_fields = NULL, upcoming_editable_fields = NULL WHERE id = 'default'");
        else sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
        for (const id of ["ed-own1", "ed-pending", "ed-own-ee3", "ed-own-nokey", "ed-own-ee4", "ed-collab"]) {
          for (const name of ["alice", "frank", "carol"]) {
            const expected = await refEdit(name, id, undefined);
            const r = await call(url(id, "", undefined), `tok-${name}`);
            assert.deepEqual(canon(r.body), canon(expected.body), `${variant} ${name} ${id}`);
          }
        }
      }
    } finally {
      sqlite.exec("DELETE FROM system_settings WHERE id = 'default'");
      const keys = Object.keys(saved);
      sqlite.prepare(`INSERT INTO system_settings (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => saved[k]));
    }
  });

  // ---------------- S2 budget ----------------
  test("T04 S2 budget: session lookup + context + 1 data statement (3, no batch, no write, <= 100 binds) on every path", async () => {
    for (const [id, suffix, token] of [
      ["ed-own1", "", "tok-alice"], ["ed-own1", "/permissions", "tok-alice"], ["ed-collab", "", "tok-frank"], ["ed-multi", "", "tok-frank"],
      ["ed-staff", "?privileged=event", "tok-ivy"], ["ed-none", "", "tok-carol"], ["no-such-video", "", "tok-alice"], ["no-such-video", "/permissions", "tok-alice"],
      ["ed-own1", "", "tok-many"], ["ed-many", "", "tok-alice"], ["ed-bigcollab", "/permissions", "tok-alice"],
    ]) {
      const path = `/api/personal/edit/${id}${suffix}`;
      const r = await call(path, token);
      assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches, writes: r.stats.writes }, { statements: 3, batches: 0, writes: 0 }, path);
      assert.ok(r.stats.maxBinds <= 100, `${path} binds ${r.stats.maxBinds}`);
      assert.equal(r.headers.get("set-cookie"), null);
    }
  });

  test("T03 D1 failure -> 503 with a fixed body (CURRENT throws to the error page); nothing leaks", async () => {
    const failing = (match) => {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (text) => {
        if (match.test(text)) throw new Error("secret-internal tok-alice");
        return prepare(text);
      };
      return d1;
    };
    for (const path of ["/api/personal/edit/ed-own1", "/api/personal/edit/ed-own1/permissions"]) {
      for (const match of [/required_major/, /WITH v AS/]) {
        const r = await call(path, "tok-alice", { d1: failing(match) });
        assert.equal(r.status, 503, `${path} ${match}`);
        assert.equal(r.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(r.body, { error: "unavailable" });
        assert.doesNotMatch(r.text, /secret-internal|tok-alice/);
      }
    }
  });

  // ---------------- T05: S2 bounds ----------------
  test("T05 members: 130 public members -> first 100 in order, membersTruncated; permissions list cut the same way", async () => {
    const r = await call(url("ed-many", "", undefined), "tok-alice");
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, "edit");
    assert.equal(r.body.members.length, 100);
    assert.deepEqual(r.body.members.map((m) => m.name), Array.from({ length: 100 }, (_, i) => `Many ${i}`));
    assert.equal(r.body.membersTruncated, true);
    assert.equal(r.body.isCollab, true);
    assert.ok(Buffer.byteLength(r.text) <= 64 * 1024);
    const p = await call(url("ed-many", "/permissions", undefined), "tok-alice");
    assert.equal(p.body.kind, "ok");
    assert.equal(p.body.showCollabSection, true);
    assert.equal(p.body.truncated, true);
    assert.equal(p.body.publicMembers.length, 100);
    assert.ok(Buffer.byteLength(p.text) <= 64 * 1024);
  });

  test("T05 bytes: members are cut so the whole response stays <= 64 KiB (first rows kept, in order)", async () => {
    const r = await call(url("ed-bytes", "", undefined), "tok-alice");
    assert.equal(r.status, 200);
    assert.ok(Buffer.byteLength(r.text) <= 64 * 1024, `${Buffer.byteLength(r.text)} bytes`);
    assert.equal(r.body.membersTruncated, true);
    assert.ok(r.body.members.length > 0 && r.body.members.length < 100);
    assert.deepEqual(r.body.members.map((m) => m.name), Array.from({ length: r.body.members.length }, (_, i) => `Bytes ${i}`));
    const p = await call(url("ed-bytes", "/permissions", undefined), "tok-alice");
    assert.equal(p.status, 200);
    assert.ok(Buffer.byteLength(p.text) <= 64 * 1024);
  });

  test("T05 first-row rule: one row (or the fixed part) that cannot fit the 64 KiB bound fails closed (503), never a partial body", async () => {
    for (const id of ["ed-huge-first", "ed-bigmember"]) {
      const r = await call(url(id, "", undefined), "tok-alice");
      assert.equal(r.status, 503, id);
      assert.deepEqual(r.body, { error: "unavailable" });
      assert.equal(r.headers.get("cache-control"), "private, no-store");
    }
  });

  test("T05 collab subjects: 120 editors -> 100 subjects, truncated flags; summary covers the first 100", async () => {
    const p = await call(url("ed-bigcollab", "/permissions", undefined), "tok-alice");
    assert.equal(p.body.kind, "ok");
    assert.equal(p.body.subjects.length, 100);
    assert.equal(p.body.truncated, true);
    assert.ok(Buffer.byteLength(p.text) <= 64 * 1024);
    const r = await call(url("ed-bigcollab", "", undefined), "tok-alice");
    assert.equal(r.body.collabTruncated, true);
    assert.equal(r.body.permissionSummary.editorCount, 100);
  });

  test("the video_events and staff rows past the access snapshot (4 events) are denied like CURRENT (ed-multi, frank)", async () => {
    const r = await call(url("ed-multi", "", "event"), "tok-frank");
    const expected = await refEdit("frank", "ed-multi", "event");
    assert.deepEqual(canon(r.body), canon(expected.body));
    assert.equal(r.body.access.eventId !== null || r.body.kind !== "edit", true);
  });

  // ---------------- U02b: GET /api/personal/edit/:id/form-options ----------------
  const formUrl = (id, mode, offset) => {
    const query = [mode === undefined ? null : `privileged=${mode}`, offset === undefined ? null : `offset=${offset}`].filter(Boolean).join("&");
    return `/api/personal/edit/${encodeURIComponent(id)}/form-options${query ? `?${query}` : ""}`;
  };

  test("U02b auth: 401 without a session / expired, 403 banned (no data statement), private,no-store; GET only", async () => {
    for (const token of [undefined, "tok-expired", "tok-nope"]) {
      const r = await call(formUrl("ed-own1"), token);
      assert.equal(r.status, 401, String(token));
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.ok(r.stats.statements <= 1);
    }
    const banned = await call(formUrl("ed-own1"), "tok-banned");
    assert.equal(banned.status, 403);
    assert.ok(banned.stats.statements <= 1, "a banned user never reaches the data statement");
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await call(formUrl("ed-own1"), "tok-alice", { method })).status, 404, method);
  });

  test("U02b: every user x video x privileged mode equals CURRENT (gate, options, questions, answers, stage answers, suggestions, candidates)", async () => {
    const kinds = {};
    for (const name of USERS) {
      for (const id of MATRIX_VIDEOS) {
        for (const mode of [undefined, "admin", "event"]) {
          const expected = await refFormOptions(name, id, mode);
          const r = await call(formUrl(id, mode), `tok-${name}`);
          assert.equal(r.status, expected.status, `${name} ${id} ${mode}`);
          if (expected.status === 404) {
            assert.deepEqual(r.body, { error: "not_found" });
            continue;
          }
          assert.deepEqual(canon(r.body), expected.body, `${name} ${id} ${mode}`);
          EditFormOptionsResponseSchema.parse(r.body);
          assert.equal(r.headers.get("cache-control"), "private, no-store");
          kinds[expected.body.kind] = (kinds[expected.body.kind] ?? 0) + 1;
        }
      }
    }
    assert.ok(kinds.ready > 30 && kinds.no_access > 100, JSON.stringify(kinds));
  });

  test("U02b content: ed-own1 / alice (attached events first, accepting events by id, answers, stage answers, candidates)", async () => {
    const r = await call(formUrl("ed-own1"), "tok-alice");
    assert.equal(r.body.kind, "ready");
    assert.deepEqual(
      r.body.eventOptions.map((o) => o.id),
      ["ee1", "ee-open", "ee-open2", "ee-point"],
      "ee1 is attached only; closed / ended / future / nolink / private / noentry events are not options",
    );
    assert.deepEqual(r.body.eventOptions[0].custom_questions.map((q) => q.question_key), ["fq_multi", "fq_text", "fq_bad"], "active general questions in (sort_order, id) order, stage questions excluded");
    assert.ok(r.body.eventOptions[0].video_form_settings_json?.includes("Stage perm"));
    assert.deepEqual(r.body.customAnswers, {
      "ee1:fq_text": "hello",
      "ee1:fq_multi": ["a", "b", "c"],
      "ee1:fq_bad": "fallback",
      "ee-open:open_q": "stray answer on an accepting event",
    });
    assert.deepEqual(JSON.parse(r.body.stagePermissionAnswers), {
      version: 1,
      answers: [
        { id: "stage_permission", label: "Stage perm", value: "ok" },
        { id: "stage_permission_x_y_", label: "ステージ・素材・権利まわりの使用許可", value: "second" },
      ],
    });
    assert.ok(r.body.iconCandidates.length >= 3 && !r.body.iconCandidates.includes("https://i.test/hidden.png"), "only public videos feed the icon candidates");
    assert.ok(r.body.channelCandidates.length >= 3);
    assert.ok(r.body.softwareSuggestions.includes("Blender") && r.body.softwareSuggestions.includes("AfterEffects"));
    const noCreator = await call(formUrl("ed-null-creator"), "tok-carol", { });
    assert.deepEqual((await refFormOptions("carol", "ed-null-creator", undefined)).body.kind, noCreator.body.kind);
    if (noCreator.body.kind === "ready") assert.deepEqual([noCreator.body.iconCandidates, noCreator.body.channelCandidates], [[], []]);
  });

  test("U02b IDOR: a stranger gets nothing but {kind:no_access}; unknown id is 404 for everyone", async () => {
    const r = await call(formUrl("ed-none"), "tok-bob");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { kind: "no_access" });
    assert.doesNotMatch(r.text, /Form |Edit title|Creator|zed|stage|Label/i);
    for (const name of USERS) assert.equal((await call(formUrl("nope"), `tok-${name}`)).status, 404);
  });

  test("U02b S2 budget: session lookup + context + 1 data statement (3, no batch, no write, <= 4 binds)", async () => {
    for (const [id, token, mode] of [["ed-own1", "tok-alice"], ["ed-own2", "tok-alice"], ["ed-collab", "tok-frank"], ["ed-multi", "tok-frank", "event"], ["ed-none", "tok-carol", "admin"], ["no-such-video", "tok-alice"], ["ed-own1", "tok-many"], ["ed-ans-many", "tok-alice"]]) {
      const r = await call(formUrl(id, mode), token);
      assert.deepEqual({ statements: r.stats.statements, batches: r.stats.batches, writes: r.stats.writes }, { statements: 3, batches: 0, writes: 0 }, `${id} ${mode}`);
      assert.ok(r.stats.maxBinds <= 4, `binds ${r.stats.maxBinds}`);
      assert.equal(r.headers.get("set-cookie"), null);
      assert.ok(Buffer.byteLength(r.text) <= 64 * 1024);
    }
  });

  test("U02b D1 failure -> 503 with a fixed body; nothing leaks", async () => {
    for (const match of [/required_major/, /WITH v AS/]) {
      const d1 = createD1(sqlite);
      const prepare = d1.prepare;
      d1.prepare = (text) => {
        if (match.test(text)) throw new Error("secret-internal tok-alice");
        return prepare(text);
      };
      const r = await call(formUrl("ed-own1"), "tok-alice", { d1 });
      assert.equal(r.status, 503, String(match));
      assert.deepEqual(r.body, { error: "unavailable" });
      assert.equal(r.headers.get("cache-control"), "private, no-store");
      assert.doesNotMatch(r.text, /secret-internal|tok-alice/);
    }
  });

  test("U02b limits CURRENT enforces by throwing (5 stage questions, 19 general questions) are 503, never a partial body", async () => {
    await assert.rejects(readStagePermissionCustomAnswers(refDb, { videoId: "ed-stage-many", eventIds: ["est5"] }), /video_stage_answer_read_limit_exceeded/);
    await assert.rejects(fetchActiveCustomQuestionsForEvents(refDb, ["eq19"]), /video_custom_question_read_limit_exceeded/);
    for (const id of ["ed-stage-many", "ed-q-many"]) {
      const r = await call(formUrl(id), "tok-alice");
      assert.equal(r.status, 503, id);
      assert.deepEqual(r.body, { error: "unavailable" });
    }
  });

  test("U02b answers bound: 108 answers -> first 100 kept (all correct), customAnswersTruncated", async () => {
    const r = await call(formUrl("ed-ans-many"), "tok-alice");
    assert.equal(r.status, 200);
    assert.equal(r.body.kind, "ready");
    assert.equal(r.body.customAnswersTruncated, true);
    const entries = Object.entries(r.body.customAnswers);
    assert.equal(entries.length, 100);
    for (const [key, value] of entries) assert.equal(value, key.replace(/^(ea\d):a(\d+)$/, "$1/$2"), key);
  });

  test("U02b paging: 130 more accepting events -> pages of 100 by id, attached-only first on page 0, nothing lost or duplicated", async () => {
    for (let i = 0; i < 130; i += 1) sqlite.prepare("INSERT INTO events (id, title, visibility_status, allow_user_video_event_links, entry_start_time) VALUES (?, ?, 'public', 1, 1)").run(`ez${String(i).padStart(3, "0")}`, `Page ${i}`);
    try {
      const first = await call(formUrl("ed-own1", undefined, 0), "tok-alice");
      assert.equal(first.body.truncated, true);
      assert.equal(first.body.nextOffset, 100);
      assert.equal(first.body.eventOptions[0].id, "ee1");
      assert.equal(first.body.eventOptions.length, 101);
      const second = await call(formUrl("ed-own1", undefined, 100), "tok-alice");
      assert.equal(second.body.truncated, false);
      assert.equal(second.body.nextOffset, null);
      assert.equal(second.body.eventOptions.length, 33);
      assert.ok(!second.body.eventOptions.some((o) => o.id === "ee1"), "attached-only events are listed on the first page only");
      const seen = [...first.body.eventOptions, ...second.body.eventOptions].map((o) => o.id);
      assert.equal(new Set(seen).size, seen.length);
      assert.equal(seen.length, 134);
      const clamped = await call(formUrl("ed-own1", undefined, 99999), "tok-alice");
      assert.equal(clamped.status, 200);
      assert.equal(clamped.body.eventOptions.length, 0);
      for (const r of [first, second]) EditFormOptionsResponseSchema.parse(r.body);
    } finally {
      sqlite.exec("DELETE FROM events WHERE id LIKE 'ez%'");
    }
  });

  test("U02b bytes: options are cut so the response stays <= 64 KiB (nextOffset continues); an attached event that cannot fit fails closed (503)", async () => {
    for (let i = 0; i < 6; i += 1) sqlite.prepare("INSERT INTO events (id, title, visibility_status, allow_user_video_event_links, entry_start_time, parts_json) VALUES (?, ?, 'public', 1, 1, ?)").run(`zb${i}`, `Big ${i}`, "x".repeat(20_000));
    try {
      const first = await call(formUrl("ed-own1"), "tok-alice");
      assert.equal(first.status, 200);
      assert.ok(Buffer.byteLength(first.text) <= 64 * 1024, `${Buffer.byteLength(first.text)} bytes`);
      assert.equal(first.body.truncated, true);
      const kept = first.body.eventOptions.filter((o) => o.id.startsWith("zb")).length;
      assert.ok(kept > 0 && kept < 6);
      assert.equal(first.body.nextOffset, first.body.eventOptions.length - 1, "ee1 (attached only) is not counted");
      const rest = await call(formUrl("ed-own1", undefined, first.body.nextOffset), "tok-alice");
      assert.equal(rest.status, 200);
      const all = [...first.body.eventOptions, ...rest.body.eventOptions].filter((o) => o.id.startsWith("zb")).map((o) => o.id);
      assert.deepEqual([...new Set(all)], ["zb0", "zb1", "zb2", "zb3", "zb4", "zb5"]);
      sqlite.prepare("UPDATE events SET parts_json = ? WHERE id = 'ee1'").run("y".repeat(63_000));
      const failClosed = await call(formUrl("ed-own1"), "tok-alice");
      assert.equal(failClosed.status, 503);
      assert.deepEqual(failClosed.body, { error: "unavailable" });
    } finally {
      sqlite.exec("DELETE FROM events WHERE id LIKE 'zb%'");
      sqlite.exec("UPDATE events SET parts_json = NULL WHERE id = 'ee1'");
    }
  });

  test("read-only: no D1 write and no cookie on any edit endpoint; response summary (informational)", () => {
    const summary = Object.fromEntries(
      Object.entries(stats).map(([endpoint, list]) => [
        endpoint,
        { requests: list.length, max_statements: Math.max(0, ...list.map((s) => s.statements)), max_batches: Math.max(0, ...list.map((s) => s.batches)), max_binds: Math.max(0, ...list.map((s) => s.maxBinds)), writes: list.reduce((n, s) => n + s.writes, 0) },
      ]),
    );
    console.log("[MIG-0630] D1 usage per request", JSON.stringify(summary));
    assert.ok(Object.values(summary).every((s) => s.max_binds <= 100 && s.max_statements <= 3 && s.max_batches === 0 && s.writes === 0));
  });
}
