import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VIDEO_VIEW_SECTION_LABELS,
  buildPermissionSummaryLists,
  buildVideoEditPermissionViewModel,
  buildVideoFieldPermission,
  formatPermissionBadge,
  formatVideoFieldPermissionReason,
} from "./videoEditPermissionView.ts";

const owner = {
  isOwner: true,
  isCreatorOwner: true,
  isCollaboratorOwner: false,
};

const collaboratorOwner = {
  isOwner: true,
  isCreatorOwner: false,
  isCollaboratorOwner: true,
};

const outsider = {
  isOwner: false,
  isCreatorOwner: false,
  isCollaboratorOwner: false,
};

const INTERNAL_KEY_PATTERNS = [
  /video\.youtube_id/,
  /video\.identity/,
  /video\.basics/,
  /video\.permissions/,
  /videos\./,
];

function assertNoInternalKeys(text) {
  for (const pattern of INTERNAL_KEY_PATTERNS) {
    assert.doesNotMatch(text, pattern, `内部 key が露出: ${text}`);
  }
}

test("buildVideoFieldPermission: editable=true / normal → allowed + owner_general", () => {
  const perm = buildVideoFieldPermission({
    editable: true,
    privilegeMode: "normal",
    ownership: owner,
    sectionKey: "basics",
    label: VIDEO_VIEW_SECTION_LABELS.basics,
  });
  assert.equal(perm.editable, true);
  assert.equal(perm.reason, "allowed");
  assert.equal(perm.source, "owner_general");
});

test("buildVideoFieldPermission: editable=true / event → allowed + event_staff", () => {
  const perm = buildVideoFieldPermission({
    editable: true,
    privilegeMode: "event",
    ownership: outsider,
    sectionKey: "youtube",
    label: VIDEO_VIEW_SECTION_LABELS.youtube,
    eventId: "ev-1",
    eventTitle: "春祭り",
  });
  assert.equal(perm.reason, "allowed");
  assert.equal(perm.source, "event_staff");
  assert.equal(perm.eventId, "ev-1");
  assert.equal(perm.eventTitle, "春祭り");
});

test("buildVideoFieldPermission: editable=true / admin → allowed + admin", () => {
  const perm = buildVideoFieldPermission({
    editable: true,
    privilegeMode: "admin",
    ownership: outsider,
    sectionKey: "identity",
    label: VIDEO_VIEW_SECTION_LABELS.identity,
  });
  assert.equal(perm.reason, "allowed");
  assert.equal(perm.source, "admin");
});

test("buildVideoFieldPermission: editable=false / normal / 非所有者 → not_owner", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "normal",
    ownership: outsider,
    sectionKey: "basics",
    label: VIDEO_VIEW_SECTION_LABELS.basics,
  });
  assert.equal(perm.reason, "not_owner");
  assert.equal(perm.source, "none");
});

test("buildVideoFieldPermission: editable=false / normal / member_no_edit → collaborator_not_granted", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "normal",
    ownership: outsider,
    sectionKey: "basics",
    label: VIDEO_VIEW_SECTION_LABELS.basics,
    membershipHint: "member_no_edit",
  });
  assert.equal(perm.reason, "collaborator_not_granted");
});

test("buildVideoFieldPermission: editable=false / normal / 所有者 + 安全キー → owner_policy_denied", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "normal",
    ownership: owner,
    sectionKey: "basics",
    label: VIDEO_VIEW_SECTION_LABELS.basics,
  });
  assert.equal(perm.reason, "owner_policy_denied");
});

test("buildVideoFieldPermission: editable=false / normal / 所有者 + 危険キー → admin_only", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "normal",
    ownership: owner,
    sectionKey: "youtube",
    label: VIDEO_VIEW_SECTION_LABELS.youtube,
    isDangerousAdminOnly: true,
  });
  assert.equal(perm.reason, "admin_only");
});

test("buildVideoFieldPermission: editable=false / event → event_permission_denied", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "event",
    ownership: outsider,
    sectionKey: "primaryEvent",
    label: VIDEO_VIEW_SECTION_LABELS.primaryEvent,
  });
  assert.equal(perm.reason, "event_permission_denied");
});

test("buildVideoFieldPermission: editable=false / admin → admin_only", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "admin",
    ownership: owner,
    sectionKey: "identity",
    label: VIDEO_VIEW_SECTION_LABELS.identity,
  });
  assert.equal(perm.reason, "admin_only");
});

test("formatVideoFieldPermissionReason: 各 reason の日本語メッセージ", () => {
  const cases = [
    {
      reason: "allowed",
      label: "YouTube URL",
      expected: "",
    },
    {
      reason: "owner_policy_denied",
      label: "作品タイトル・基本情報",
      expected: "この項目は、現在の一般作品権限では編集できません。",
    },
    {
      reason: "not_owner",
      label: "合作メンバー",
      expected: "この作品の所有者ではないため編集できません。",
    },
    {
      reason: "collaborator_not_granted",
      label: "合作メンバー",
      expected:
        "合作メンバーとして登録されていますが、作品編集権限が付与されていません。",
    },
    {
      reason: "event_permission_denied",
      label: "YouTube URL",
      expected:
        "この操作に必要なイベント運営権限が付与されていません。必要な権限: YouTube URL",
    },
    {
      reason: "admin_only",
      label: "提出者情報",
      expected: "この項目は管理者権限でのみ変更できます。",
    },
  ];

  for (const c of cases) {
    const message = formatVideoFieldPermissionReason({
      editable: c.reason === "allowed",
      source: "none",
      reason: c.reason,
      label: c.label,
    });
    assert.equal(message, c.expected, c.reason);
    assertNoInternalKeys(message);
  }
});

test("formatVideoFieldPermissionReason: YouTube 拒否メッセージに video.youtube_id を含まない", () => {
  const perm = buildVideoFieldPermission({
    editable: false,
    privilegeMode: "normal",
    ownership: owner,
    sectionKey: "youtube",
    label: VIDEO_VIEW_SECTION_LABELS.youtube,
    isDangerousAdminOnly: true,
  });
  const message = formatVideoFieldPermissionReason(perm);
  assert.match(message, /管理者権限/);
  assertNoInternalKeys(message);
  assert.doesNotMatch(message, /youtube_id/);
});

test("formatPermissionBadge: reason ごとのバッジ文言", () => {
  const cases = [
    { reason: "allowed", kind: "editable", text: "編集可能" },
    {
      reason: "owner_policy_denied",
      kind: "owner-denied",
      text: "所有者権限では編集不可",
    },
    {
      reason: "event_permission_denied",
      kind: "event",
      text: "運営権限が必要",
    },
    { reason: "admin_only", kind: "admin", text: "管理者限定" },
    { reason: "not_owner", kind: "locked", text: "編集不可" },
    {
      reason: "collaborator_not_granted",
      kind: "locked",
      text: "編集不可",
    },
  ];

  for (const c of cases) {
    const badge = formatPermissionBadge({
      editable: c.reason === "allowed",
      source: "none",
      reason: c.reason,
      label: "テスト",
    });
    assert.equal(badge.kind, c.kind, c.reason);
    assert.equal(badge.text, c.text, c.reason);
    assertNoInternalKeys(badge.text);
  }
});

test("buildPermissionSummaryLists: editable / locked ラベルを分類", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: owner,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: true,
      descriptions: true,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });

  const { editableLabels, lockedLabels } = buildPermissionSummaryLists(vm);
  assert.deepEqual(editableLabels, [
    "作品タイトル・基本情報",
    "楽曲・クレジット",
    "紹介文・振り返り",
  ]);
  assert.deepEqual(lockedLabels, [
    "提出者情報",
    "YouTube URL",
    "合作メンバー",
    "メンバーチャプター",
    "所属イベント",
    "公開状態",
    "共同編集権限",
  ]);
});

test("buildVideoEditPermissionViewModel: 所有者通常モードで危険キーは admin_only", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: owner,
    canOfferAdminMode: true,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: true,
      descriptions: true,
      members: true,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });

  assert.equal(vm.privilegeMode, "normal");
  assert.equal(vm.ownership.isCreatorOwner, true);
  assert.equal(vm.canOfferAdminMode, true);
  assert.equal(vm.basics.reason, "allowed");
  assert.equal(vm.youtube.reason, "admin_only");
  assert.equal(vm.permissions.reason, "admin_only");
  assert.equal(vm.memberChapters.reason, "owner_policy_denied");

  const youtubeMessage = formatVideoFieldPermissionReason(vm.youtube);
  assertNoInternalKeys(youtubeMessage);
  assert.doesNotMatch(youtubeMessage, /youtube_id/);
});

test("buildVideoEditPermissionViewModel: 合作所有者 + member_no_edit ヒント", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: collaboratorOwner,
    canOfferAdminMode: false,
    canOfferEventMode: true,
    membershipHint: "member_no_edit",
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });

  // collaboratorOwner は isOwner=true なので membershipHint は無視される
  assert.equal(vm.basics.reason, "owner_policy_denied");
});

test("buildVideoEditPermissionViewModel: 非所有者 + member_no_edit ヒント", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: outsider,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    membershipHint: "member_no_edit",
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });

  assert.equal(vm.basics.reason, "collaborator_not_granted");
  const message = formatVideoFieldPermissionReason(vm.basics);
  assert.match(message, /合作メンバーとして登録されていますが/);
  assertNoInternalKeys(message);
});

test("buildVideoEditPermissionViewModel: event モード拒否は event_permission_denied", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "event",
    ownership: outsider,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    eventId: "ev-42",
    eventTitle: "夏フェス",
    sections: {
      identity: false,
      basics: true,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });

  assert.equal(vm.basics.reason, "allowed");
  assert.equal(vm.basics.source, "event_staff");
  assert.equal(vm.youtube.reason, "event_permission_denied");
  assert.equal(vm.youtube.eventId, "ev-42");
  const message = formatVideoFieldPermissionReason(vm.youtube);
  assert.match(message, /必要な権限: YouTube URL/);
  assertNoInternalKeys(message);
});
