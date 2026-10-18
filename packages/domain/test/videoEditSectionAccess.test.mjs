import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERAL_EDITABLE_FIELD_KEYS,
  VIDEO_EDIT_SECTION_PERMISSION_KEYS,
  canAttachInitialYoutubeToSlottedVideo,
  decideCanEditVideoFromAccessContext,
  formatChapterTime,
  hasAnyVideoEditSection,
  resolveAdminOrEventVideoPrivilegeMode,
  resolveAllowedVideoEditSections,
  validateChapterTime,
} from "@flamenode/domain/video";

const slottedPending = {
  source_type: "youtube",
  scheduling_type: "slotted",
  visibility_status: "pending",
  youtube_video_id: null,
};

test("section table: one permission key per edit section, in CURRENT order", () => {
  assert.deepEqual(
    VIDEO_EDIT_SECTION_PERMISSION_KEYS.map(({ section, key }) => `${section}=${key}`),
    [
      "identity=video.identity",
      "basics=video.basics",
      "youtube=video.youtube_id",
      "credits=video.credits",
      "descriptions=video.descriptions",
      "members=video.members",
      "member_chapters=video.member_chapters",
      "primary_event=video.primary_event",
    ],
  );
});

test("resolveAllowedVideoEditSections keeps the narrow first-YouTube exception", () => {
  const denied = VIDEO_EDIT_SECTION_PERMISSION_KEYS.map(({ section }) => ({ section, allowed: false }));
  const creator = resolveAllowedVideoEditSections({ results: denied, video: slottedPending, privilegeMode: "normal", isCreatorOwner: true });
  assert.equal(creator.youtube, true);
  assert.equal(hasAnyVideoEditSection(creator), true);
  for (const [privilegeMode, isCreatorOwner, video] of [
    ["event", true, slottedPending],
    ["admin", true, slottedPending],
    ["normal", false, slottedPending],
    ["normal", true, { ...slottedPending, youtube_video_id: "abc" }],
    ["normal", true, { ...slottedPending, scheduling_type: "unslotted" }],
  ]) {
    const sections = resolveAllowedVideoEditSections({ results: denied, video, privilegeMode, isCreatorOwner });
    assert.equal(sections.youtube, false, `${privilegeMode}/${isCreatorOwner}`);
    assert.equal(hasAnyVideoEditSection(sections), false);
  }
  assert.equal(
    canAttachInitialYoutubeToSlottedVideo({ sourceType: "youtube", schedulingType: "slotted", visibilityStatus: "public", youtubeVideoId: " ", privilegeMode: "normal", isCreatorOwner: true }),
    true,
  );
});

test("chapter time validation is the shared domain validator", () => {
  assert.deepEqual(validateChapterTime("1:30"), { ok: true, seconds: 90 });
  assert.equal(validateChapterTime("91", { videoDurationSeconds: 90 }).ok, false);
  assert.equal(formatChapterTime(90), "1:30");
});

// SA-012..015 (chapter_admin), SA-082..084 (permissions), SA-085 (members):
// allow/deny matrix through the U01 decision the DB path also uses.
function context({ creator = false, collaborator = false, eventKeys = [] } = {}) {
  return {
    userId: "u",
    videoId: "v",
    approvedXUserIds: [],
    ownership: { isCreatorOwner: creator, isCollaboratorOwner: collaborator, isOwner: creator || collaborator },
    currentEventIds: ["e1"],
    ownerEditableFields: new Set(GENERAL_EDITABLE_FIELD_KEYS),
    eventPermissionKeysByEvent: new Map([["e1", new Set(eventKeys)]]),
  };
}

test("video management keys: allow/deny per actor and privilege mode", () => {
  const actors = {
    creator: [context({ creator: true }), null],
    collaborator: [context({ collaborator: true }), null],
    // event_staff rows hold canonical keys; legacy video.chapter_admin is stored as video.member_chapters.
    chapterStaff: [context({ eventKeys: ["video.member_chapters"] }), null],
    permissionStaff: [context({ eventKeys: ["video.permissions"] }), null],
    memberStaff: [context({ eventKeys: ["video.members"] }), null],
    admin: [context(), "admin"],
    plain: [context(), null],
  };
  const keys = ["video.chapter_admin", "video.permissions", "video.members"];
  const expected = {
    // [normal, event, admin] for chapter_admin | permissions | members
    creator: ["--", "T-", "T--"],
    collaborator: ["--", "--", "T--"],
    chapterStaff: ["-T", "--", "---"],
    permissionStaff: ["--", "-T", "---"],
    memberStaff: ["--", "--", "-T-"],
    admin: ["--T", "--T", "--T"],
    plain: ["--", "--", "---"],
  };
  for (const [name, [ctx, role]] of Object.entries(actors)) {
    const row = keys.map((requiredKey) =>
      ["normal", "event", "admin"]
        .map((privilegeMode) => (decideCanEditVideoFromAccessContext({ context: ctx, userRole: role, requiredKey, privilegeMode }) ? "T" : "-"))
        .join(""),
    );
    assert.deepEqual(row, expected[name].map((v) => v.padEnd(3, "-")), name);
  }
});

test("chapter management never runs in normal mode (SA-013..015)", () => {
  assert.equal(resolveAdminOrEventVideoPrivilegeMode("admin"), "admin");
  assert.equal(resolveAdminOrEventVideoPrivilegeMode("user"), "event");
  assert.equal(resolveAdminOrEventVideoPrivilegeMode(null), "event");
});
