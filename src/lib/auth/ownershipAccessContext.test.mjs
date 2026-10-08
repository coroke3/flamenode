import { test } from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_PERMISSION_ALIASES,
  canUseEventPrivilegeFromAccessContext,
  decideCanEditVideoFromAccessContext,
  eventStaffCandidatePermissionKeys,
  resolveEventPermissionFromAccessContext,
} from "./ownershipCore.ts";
import { ALL_PERMISSION_KEYS } from "./permissions/keys.ts";
import {
  resolveStaffPermissionKeys,
  staffRowHasPermissionKey,
} from "./permissions/permissionResolver.ts";
import { EVENT_STAFF_PRESETS } from "./permissions/presets.ts";
import {
  GENERAL_EDITABLE_FIELD_KEYS,
  sectionAllowedByGeneralFields,
} from "../video/generalEditPermissionsCore.ts";

function context(overrides = {}) {
  return {
    userId: "user-1",
    videoId: "video-1",
    approvedXUserIds: ["x-1"],
    ownership: { isCreatorOwner: true, isCollaboratorOwner: false, isOwner: true },
    currentEventIds: ["event-1", "event-2"],
    ownerEditableFields: new Set(["title", "youtube_url"]),
    eventPermissionKeysByEvent: new Map([
      ["event-1", new Set(["video.credits"])],
      ["event-2", new Set(["video.youtube_id"])],
    ]),
    ...overrides,
  };
}

test("request-local context permits normal owner YouTube policy without a DB probe", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context(),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    true,
  );
});

test("collaborator ownership receives the same normal YouTube policy", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context({
        ownership: { isCreatorOwner: false, isCollaboratorOwner: true, isOwner: true },
      }),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    true,
  );
});

test("event permission is resolved from the in-memory event map", () => {
  const value = resolveEventPermissionFromAccessContext(context(), "video.youtube_id");
  assert.deepEqual(value, { allowed: true, eventId: "event-2" });
  assert.equal(canUseEventPrivilegeFromAccessContext(context()), true);
});

test("context ownership prevents a non-owner from using the owner policy", () => {
  assert.equal(
    decideCanEditVideoFromAccessContext({
      context: context({
        ownership: { isCreatorOwner: false, isCollaboratorOwner: false, isOwner: false },
      }),
      userRole: "user",
      requiredKey: "video.youtube_id",
      privilegeMode: "normal",
    }),
    false,
  );
});

test("normal owner の section 判定は canEditVideo と同じ一般 field 対応表を使う", () => {
  const collaborator = { isCreatorOwner: false, isCollaboratorOwner: true, isOwner: true };
  const fieldSets = [
    new Set(),
    new Set(GENERAL_EDITABLE_FIELD_KEYS),
    ...GENERAL_EDITABLE_FIELD_KEYS.map((key) => new Set([key])),
  ];
  for (const requiredKey of Object.keys(VIDEO_PERMISSION_ALIASES)) {
    for (const fields of fieldSets) {
      assert.equal(
        decideCanEditVideoFromAccessContext({
          context: context({ ownership: collaborator, ownerEditableFields: fields }),
          userRole: null,
          requiredKey,
          privilegeMode: "normal",
        }),
        sectionAllowedByGeneralFields(requiredKey, fields),
        `${requiredKey}: ${[...fields].join(",")}`,
      );
    }
  }
});

const nonOwner = { isCreatorOwner: false, isCollaboratorOwner: false, isOwner: false };

test("event モードは対象イベントの event_staff 権限が無ければ全 section を拒否する", () => {
  for (const eventPermissionKeysByEvent of [
    new Map(),
    // 作品に紐づかないイベントの権限は使わない。
    new Map([["other-event", new Set(["video.status", "video.permissions"])]]),
  ]) {
    const stranger = context({
      ownership: nonOwner,
      ownerEditableFields: new Set(),
      eventPermissionKeysByEvent,
    });
    for (const requiredKey of Object.keys(VIDEO_PERMISSION_ALIASES)) {
      assert.deepEqual(resolveEventPermissionFromAccessContext(stranger, requiredKey), { allowed: false });
      assert.equal(
        decideCanEditVideoFromAccessContext({
          context: stranger,
          userRole: "admin",
          requiredKey,
          privilegeMode: "event",
        }),
        false,
        requiredKey,
      );
    }
    assert.equal(canUseEventPrivilegeFromAccessContext(stranger), false);
  }
});

test("access context の event 判定は DB 経路と同じ正規候補キーで行う", () => {
  const rows = [
    ...EVENT_STAFF_PRESETS.map((preset) => ({
      permission_preset: preset,
      custom_permission_keys_json: null,
    })),
    ...ALL_PERMISSION_KEYS.map((key) => ({
      permission_preset: "custom",
      custom_permission_keys_json: JSON.stringify([key]),
    })),
  ];
  for (const row of rows) {
    const staffContext = context({
      ownership: nonOwner,
      eventPermissionKeysByEvent: new Map([["event-1", resolveStaffPermissionKeys(row)]]),
    });
    for (const requiredKey of Object.keys(VIDEO_PERMISSION_ALIASES)) {
      // resolveEventStaffVideoPermissionGrant（DB 経路）の行判定と同じ式。
      const dbAllowed = Array.from(eventStaffCandidatePermissionKeys(requiredKey))
        .some((key) => staffRowHasPermissionKey(row, key));
      assert.equal(
        decideCanEditVideoFromAccessContext({
          context: staffContext,
          userRole: null,
          requiredKey,
          privilegeMode: "event",
        }),
        dbAllowed,
        `${row.permission_preset} ${row.custom_permission_keys_json ?? ""} -> ${requiredKey}`,
      );
    }
  }
  // video.members だけのスタッフは member_chapters を持つが、chapter_admin（一括登録）は持たない。
  const membersOnly = context({
    ownership: nonOwner,
    eventPermissionKeysByEvent: new Map([["event-1", new Set(["video.members"])]]),
  });
  assert.equal(resolveEventPermissionFromAccessContext(membersOnly, "video.member_chapters").allowed, true);
  assert.equal(resolveEventPermissionFromAccessContext(membersOnly, "video.chapter_admin").allowed, false);
});

test("event モードで preset ごとに編集できる section を値で固定する", () => {
  const contentSections = [
    "video.basics",
    "video.descriptions",
    "video.credits",
    "video.members",
    "video.member_chapters",
    "video.chapter_admin",
  ];
  const expected = {
    owner: [...contentSections, "video.status", "video.permissions"],
    manager: [...contentSections, "video.status", "video.permissions"],
    slot_manager: [],
    content_editor: contentSections,
    reviewer: ["video.status"],
    xid_reviewer: [],
    public_staff: [],
    custom: [],
  };
  const sectionKeys = Object.keys(VIDEO_PERMISSION_ALIASES).filter((key) => key.startsWith("video."));
  for (const preset of EVENT_STAFF_PRESETS) {
    const staffContext = context({
      ownership: nonOwner,
      eventPermissionKeysByEvent: new Map([[
        "event-1",
        resolveStaffPermissionKeys({ permission_preset: preset, custom_permission_keys_json: null }),
      ]]),
    });
    const allowed = sectionKeys.filter((requiredKey) =>
      decideCanEditVideoFromAccessContext({
        context: staffContext,
        userRole: null,
        requiredKey,
        privilegeMode: "event",
      }));
    assert.deepEqual(allowed.sort(), [...expected[preset]].sort(), preset);
  }
});
