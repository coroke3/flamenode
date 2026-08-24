import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildPermissionSummaryLists,
  buildVideoEditPermissionViewModel,
  formatPermissionBadge,
  formatVideoFieldPermissionReason,
} from "./videoEditPermissionView.ts";

const ownershipOwner = {
  isCreatorOwner: true,
  isCollaboratorOwner: false,
  isOwner: true,
};

test("表示: 許可項目は editable、未許可は locked のまま reason 付き", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
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
      permissions: true,
    },
  });
  assert.equal(vm.basics.editable, true);
  assert.equal(formatPermissionBadge(vm.basics).text, "編集可能");
  assert.equal(vm.youtube.editable, false);
  assert.equal(vm.youtube.reason, "owner_policy_denied");
  assert.match(
    formatVideoFieldPermissionReason(vm.youtube),
    /一般作品権限では編集できません/,
  );
  assert.doesNotMatch(
    formatVideoFieldPermissionReason(vm.youtube),
    /video\.youtube_id/,
  );
  assert.equal(vm.members.editable, false);
  assert.match(
    formatVideoFieldPermissionReason(vm.members),
    /一般作品権限では編集できません/,
  );
  const lists = buildPermissionSummaryLists(vm);
  assert.ok(lists.editableLabels.includes("作品タイトル・基本情報"));
  assert.ok(lists.lockedLabels.includes("YouTube URL"));
});

test("表示: sectionEventSources で項目ごとの権限元を保持", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "event",
    ownership: ownershipOwner,
    canOfferAdminMode: false,
    canOfferEventMode: false,
    eventId: "ev-primary",
    eventTitle: "Primary Event",
    sectionEventSources: {
      basics: { eventId: "ev-a", eventTitle: "Event A" },
      youtube: { eventId: "ev-b", eventTitle: "Event B" },
    },
    sections: {
      identity: false,
      basics: true,
      youtube: true,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(vm.basics.eventTitle, "Event A");
  assert.equal(vm.youtube.eventTitle, "Event B");
  assert.equal(vm.credits.eventTitle, "Primary Event");
});

test("a11y: バッジは色以外のテキストを持つ", () => {
  const vm = buildVideoEditPermissionViewModel({
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode: true,
    canOfferEventMode: true,
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
  for (const field of [
    vm.identity,
    vm.basics,
    vm.youtube,
    vm.credits,
    vm.descriptions,
  ]) {
    const badge = formatPermissionBadge(field);
    assert.ok(badge.text.length > 0);
    assert.notEqual(badge.kind, "editable");
  }
});

test("a11y: 静的なロック説明は live region にせず control から参照する", () => {
  const noteSource = readFileSync(
    new URL("../../components/video/permission/FieldLockNote.tsx", import.meta.url),
    "utf8",
  );
  const formSource = readFileSync(
    new URL("../../components/forms/VideoForm.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(noteSource, /role="status"/);
  assert.match(formSource, /aria-describedby=\{lockNoteId\}/);
  assert.match(formSource, /videoFormLockNoteId\("memberChapters"\)/);
});

test("表示: 複合 section は個別 permission の集約 badge を使う", () => {
  const formSource = readFileSync(
    new URL("../../components/forms/VideoForm.tsx", import.meta.url),
    "utf8",
  );
  assert.match(formSource, /permissions=\{videoSectionPermissions\}/);
  assert.match(formSource, /permissions=\{membersSectionPermissions\}/);
  assert.match(
    formSource,
    /membersListDisabled \|\| isFieldDisabled\(disabledFields, "members\.is_collab"\)/,
  );
});

test("保存経路: updateVideo は未送信値を setDefault で現在値維持する", () => {
  const source = readFileSync(
    new URL("../actions/video/updateVideo.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /setDefault\("title"/);
  assert.match(source, /setDefault\("music"/);
  assert.match(source, /assertAllowedVideoFieldChanges/);
  assert.match(source, /編集中に作品の編集権限が変更されました/);
});

test("admin 編集導線は privileged=admin を付ける", () => {
  const adminPage = readFileSync(
    new URL("../../../app/(admin)/admin/videos/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(adminPage, /dashboard\/edit\/\$\{video\.id\}\?privileged=admin/);
  const tabs = readFileSync(
    new URL("../../components/admin/AdminVideoTabs.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tabs, /privileged=admin/);
  assert.match(tabs, /youtubeVideoId\?\.trim\(\) \|\| videoId/);
  const editPage = readFileSync(
    new URL("../../../app/(auth)/dashboard/edit/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(editPage, /const youtubeVideoId = video\.youtube_video_id\?\.trim\(\) \|\| null/);
  assert.match(editPage, /youtube_url: youtubeVideoId/);
});
