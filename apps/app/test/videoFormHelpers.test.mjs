// Port of CURRENT video form pure helper & notice/callout tests (MIG-0738); tests the SPA copies under apps/app/.test-dist.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  extractYoutubeId,
  youtubeThumbUrl,
  youtubeWatchUrl,
  youtubeEmbedUrl,
} from "../.test-dist/apps/app/src/lib/youtubeId.js";
import {
  appendPublicReflectionDelayNotice,
  markPendingPublicReflection,
  PUBLIC_REFLECTION_DELAY_MESSAGE,
  spreadsheetSaveStatusMessage,
} from "../.test-dist/apps/app/src/lib/publicReflectionNotice.js";
import {
  DEFAULT_STAGE_PERMISSION_FIELD,
  createDefaultStagePermissionQuestion,
  filterImplicitEmptyStagePermissionQuestions,
  parseVideoFormSettings,
  resolveStagePermissionFieldsFromJson,
} from "../.test-dist/apps/app/src/lib/videoFormSettings.js";
import {
  firstMissingRequiredVideoField,
  formatRequiredVideoFieldSummary,
  missingRequiredVideoFieldMessage,
  parseRequiredVideoFields,
  serializeRequiredVideoFields,
  serializeRequiredVideoFieldsFromForm,
  unionRequiredVideoFields,
} from "../.test-dist/apps/app/src/lib/requiredVideoFields.js";
import {
  hasAnyEditableVideoFormSection,
  resolvePermissionUnlockHint,
} from "../.test-dist/apps/app/src/lib/permissionUnlockHint.js";
import {
  buildVideoFormDraft,
  parseVideoFormDraft,
  videoFormDraftAnswersToRecord,
  videoFormDraftIsStale,
} from "../.test-dist/apps/app/src/lib/videoFormDraft.js";
import {
  getGuardRedirectPath,
  redirectForGuardReason,
  shouldShowGuardErrorOnly,
} from "../.test-dist/apps/app/src/lib/guardRedirect.js";
import {
  ACTIVE_X_BEFORE_SWITCH_EVENT,
  dispatchBeforeActiveXSwitch,
} from "../.test-dist/apps/app/src/lib/activeXSwitchEvents.js";
import { submitFormCompat } from "../.test-dist/apps/app/src/lib/submitFormCompat.js";
import { draftMetadataMatches } from "../.test-dist/apps/app/src/lib/useFormDraft.js";
import {
  cleanupExpiredDraftFiles,
  deleteDraftFile,
  DRAFT_FILE_TTL_MS,
  loadDraftFile,
  saveDraftFile,
} from "../.test-dist/apps/app/src/lib/draftFileStore.js";
import { PublicReflectionDelayNotice } from "../.test-dist/apps/app/src/components/ui/PublicReflectionDelayNotice.js";
import { ErrorCallout } from "../.test-dist/apps/app/src/components/ui/ErrorCallout.js";

// --- 1. youtubeId (18 cases from CURRENT src/lib/youtube/id.test.mjs) ---

test("extractYoutubeId: 生の 11 桁 ID をそのまま返す", () => {
  assert.equal(extractYoutubeId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(extractYoutubeId(" dQw4w9WgXcQ "), "dQw4w9WgXcQ");
});

test("extractYoutubeId: null/空/不正は null", () => {
  assert.equal(extractYoutubeId(null), null);
  assert.equal(extractYoutubeId(undefined), null);
  assert.equal(extractYoutubeId(""), null);
  assert.equal(extractYoutubeId("too-short"), null);
  assert.equal(extractYoutubeId("0123456789012"), null);
});

test("extractYoutubeId: youtu.be 短縮 URL", () => {
  assert.equal(
    extractYoutubeId("https://youtu.be/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://youtu.be/dQw4w9WgXcQ?t=12"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: 通常 watch URL", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=42"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: shorts / embed / live URL", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
  assert.equal(
    extractYoutubeId("https://www.youtube.com/live/dQw4w9WgXcQ"),
    "dQw4w9WgXcQ",
  );
});

test("extractYoutubeId: 別ドメインは null", () => {
  assert.equal(extractYoutubeId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(extractYoutubeId("https://vimeo.com/123456789"), null);
});

test("extractYoutubeId: YouTubeに似た別ホストや非HTTP URLは null", () => {
  assert.equal(
    extractYoutubeId("https://evil-youtube.com/watch?v=dQw4w9WgXcQ"),
    null,
  );
  assert.equal(
    extractYoutubeId("ftp://youtube.com/watch?v=dQw4w9WgXcQ"),
    null,
  );
});

test("extractYoutubeId: v= が不正 (短い) なら null", () => {
  assert.equal(
    extractYoutubeId("https://www.youtube.com/watch?v=short"),
    null,
  );
});

test("youtubeThumbUrl: id があれば local cache URL", () => {
  assert.equal(
    youtubeThumbUrl("dQw4w9WgXcQ"),
    "/api/youtube-thumbnail/dQw4w9WgXcQ/hqdefault",
  );
  assert.equal(
    youtubeThumbUrl("dQw4w9WgXcQ", "maxresdefault"),
    "/api/youtube-thumbnail/dQw4w9WgXcQ/maxresdefault",
  );
});

test("youtubeThumbUrl: 空 id は空文字", () => {
  assert.equal(youtubeThumbUrl(null), "");
  assert.equal(youtubeThumbUrl(""), "");
});

test("youtubeWatchUrl: 単純連結", () => {
  assert.equal(
    youtubeWatchUrl("abc"),
    "https://www.youtube.com/watch?v=abc",
  );
});

test("youtubeEmbedUrl: rel/modestbranding/playsinline が常に含まれる", () => {
  const url = youtubeEmbedUrl("abc");
  assert.ok(url.includes("rel=0"));
  assert.ok(url.includes("modestbranding=1"));
  assert.ok(url.includes("playsinline=1"));
  assert.ok(!url.includes("enablejsapi=1"));
});

test("youtubeEmbedUrl: enableJsApi / origin オプション反映", () => {
  const url = youtubeEmbedUrl("abc", {
    enableJsApi: true,
    origin: "https://flamenode.example",
  });
  assert.ok(url.includes("enablejsapi=1"));
  assert.ok(url.includes("origin=https%3A%2F%2Fflamenode.example"));
});

test("youtubeEmbedUrl: autoplay/mute/start オプション反映", () => {
  const url = youtubeEmbedUrl("abc", { autoplay: true, mute: true, start: 30 });
  assert.ok(url.includes("autoplay=1"));
  assert.ok(url.includes("mute=1"));
  assert.ok(url.includes("start=30"));
});

test("youtubeEmbedUrl: start <= 0 は無視", () => {
  const url = youtubeEmbedUrl("abc", { start: 0 });
  assert.ok(!url.includes("start="));
});

test("youtubeWatchUrl: malformed ID cannot inject a list parameter or fragment", () => {
  const rawId = "dQw4w9WgXcQ&list=private#fragment";
  const url = new URL(youtubeWatchUrl(rawId));
  assert.equal(url.origin, "https://www.youtube.com");
  assert.equal(url.pathname, "/watch");
  assert.equal(url.searchParams.get("v"), rawId);
  assert.equal(url.searchParams.has("list"), false);
  assert.equal(url.hash, "");
  assert.equal(
    youtubeWatchUrl("dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
});

test("youtubeEmbedUrl: malformed ID remains one encoded path segment", () => {
  const rawId = "../other?v=override#fragment";
  const url = new URL(youtubeEmbedUrl(rawId, {
    start: 30,
    enableJsApi: true,
    origin: "https://flamenode.net",
  }));
  assert.equal(url.origin, "https://www.youtube.com");
  assert.equal(url.pathname, "/embed/..%2Fother%3Fv%3Doverride%23fragment");
  assert.equal(url.searchParams.get("rel"), "0");
  assert.equal(url.searchParams.get("start"), "30");
  assert.equal(url.searchParams.get("enablejsapi"), "1");
  assert.equal(url.searchParams.get("origin"), "https://flamenode.net");
  assert.equal(url.searchParams.has("v"), false);
  assert.equal(url.hash, "");
  assert.ok(youtubeEmbedUrl("dQw4w9WgXcQ").startsWith("https://www.youtube.com/embed/dQw4w9WgXcQ?"));
});

test("youtubeEmbedUrl: dot segments and malformed UTF-16 cannot escape the embed path", () => {
  for (const id of [".", ".."]) {
    const url = new URL(youtubeEmbedUrl(id));
    assert.equal(url.pathname, "/embed/_");
    assert.equal(url.searchParams.get("rel"), "0");
  }
  const malformed = "\uD800";
  const watch = new URL(youtubeWatchUrl(malformed));
  const embed = new URL(youtubeEmbedUrl(malformed));
  assert.equal(watch.searchParams.get("v"), "\uFFFD");
  assert.equal(embed.pathname, "/embed/%EF%BF%BD");
});

// --- 2. videoFormSettings (5 cases from CURRENT src/lib/video/formSettings.test.mjs) ---

test("parseVideoFormSettings returns empty settings for invalid JSON", () => {
  assert.deepEqual(parseVideoFormSettings("{bad"), {});
  assert.deepEqual(parseVideoFormSettings(""), {});
});

test("resolveStagePermissionFieldsFromJson enables field when any event enables it", () => {
  const resolved = resolveStagePermissionFieldsFromJson([
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: false }] }),
    JSON.stringify({
      stage_permissions: [{
        id: "stage_permission",
        enabled: true,
        required: false,
        label: "権利確認",
      }],
    }),
  ]);

  assert.equal(resolved[0]?.enabled, true);
  assert.equal(resolved[0]?.required, false);
  assert.equal(resolved[0]?.label, "権利確認");
});

test("resolveStagePermissionFieldsFromJson requires field when any event requires it", () => {
  const resolved = resolveStagePermissionFieldsFromJson([
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: true, required: false }] }),
    JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: true, required: true }] }),
  ]);

  assert.equal(resolved[0]?.required, true);
  assert.equal(resolved[0]?.placeholder, DEFAULT_STAGE_PERMISSION_FIELD.placeholder);
});

test("resolveStagePermissionFieldsFromJson hides field when no event enables it", () => {
  assert.deepEqual(
    resolveStagePermissionFieldsFromJson([
      JSON.stringify({ stage_permissions: [{ id: "stage_permission", enabled: false }] }),
      "{}",
    ]),
    [],
  );
});

test("legacy disabled placeholder is not restored as a configured question", () => {
  assert.deepEqual(
    filterImplicitEmptyStagePermissionQuestions([
      createDefaultStagePermissionQuestion(),
    ]),
    [],
  );
  const configured = {
    ...createDefaultStagePermissionQuestion(),
    enabled: true,
  };
  assert.deepEqual(
    filterImplicitEmptyStagePermissionQuestions([configured]),
    [configured],
  );
});

// --- 3. requiredVideoFields (6 cases from CURRENT src/lib/video/requiredVideoFields.test.mjs) ---

test("必須指定は allow-list だけを正本順で残す", () => {
  assert.deepEqual(parseRequiredVideoFields('["youtube_url","music","youtube_url","title"]'), [
    "music",
    "youtube_url",
  ]);
  assert.equal(
    serializeRequiredVideoFields(["youtube_url", "music"]),
    JSON.stringify(["music", "youtube_url"]),
  );
  assert.equal(serializeRequiredVideoFields([]), null);
  assert.deepEqual(parseRequiredVideoFields("not-json"), []);
});

test("複数イベントの必須指定は和集合になる", () => {
  assert.deepEqual(
    unionRequiredVideoFields(['["youtube_url"]', '["music","credit"]', null]),
    ["music", "credit", "youtube_url"],
  );
});

test("フォームは present フラグがあるときだけ上書きする", () => {
  const omitted = new FormData();
  assert.equal(serializeRequiredVideoFieldsFromForm(omitted), undefined);

  const empty = new FormData();
  empty.set("required_video_fields_present", "1");
  assert.equal(serializeRequiredVideoFieldsFromForm(empty), null);

  const selected = new FormData();
  selected.set("required_video_fields_present", "1");
  selected.append("required_video_fields", "youtube_url");
  selected.append("required_video_fields", "music");
  selected.append("required_video_fields", "title");
  assert.equal(
    serializeRequiredVideoFieldsFromForm(selected),
    JSON.stringify(["music", "youtube_url"]),
  );

  const hiddenJson = new FormData();
  hiddenJson.set("required_video_fields_present", "1");
  hiddenJson.set(
    "required_video_fields_json",
    JSON.stringify(["youtube_url", "music"]),
  );
  assert.equal(
    serializeRequiredVideoFieldsFromForm(hiddenJson),
    JSON.stringify(["music", "youtube_url"]),
  );
});

test("未入力の必須項目だけを欠けとして返す", () => {
  const values = {
    music: "song",
    youtube_url: "",
    icon_mode: "keep",
    icon_url: null,
    existing_icon_url: "/api/media/video-icons/x-user-1/existing.png",
    other_social_links: "[]",
  };
  assert.equal(
    firstMissingRequiredVideoField(["music", "youtube_url"], values),
    "youtube_url",
  );
  assert.equal(
    firstMissingRequiredVideoField(["icon_url"], values),
    null,
  );
  assert.equal(
    firstMissingRequiredVideoField(
      ["icon_url"],
      { ...values, icon_mode: "keep", existing_icon_url: null },
    ),
    "icon_url",
  );
  assert.equal(
    firstMissingRequiredVideoField(
      ["icon_url"],
      { ...values, icon_mode: "upload", icon_url: null, existing_icon_url: null },
    ),
    null,
  );
  assert.equal(
    firstMissingRequiredVideoField(["other_social_links"], values),
    "other_social_links",
  );
  assert.equal(
    firstMissingRequiredVideoField(["youtube_url"], values, new Set(["music"])),
    null,
  );
});

test("必須メッセージと要約は日本語ラベルを使う", () => {
  assert.equal(
    missingRequiredVideoFieldMessage("youtube_url"),
    "「YouTube URL」は必須です。",
  );
  assert.equal(formatRequiredVideoFieldSummary(null), "表示名とタイトルのみ");
  assert.equal(
    formatRequiredVideoFieldSummary('["music","youtube_url"]'),
    "使用楽曲、YouTube URL",
  );
});

test("配列風オブジェクトを必須項目として受理せず、Setを維持する", () => {
  assert.equal(
    serializeRequiredVideoFields({ 0: "music", length: 1 }),
    null,
  );
  assert.equal(
    serializeRequiredVideoFields(new Set(["youtube_url", "music"])),
    JSON.stringify(["music", "youtube_url"]),
  );
});

// --- 4. permissionUnlockHint (6 pure cases from CURRENT src/lib/video/permissionUnlockHint.test.mjs; 7th checks MIG-0714 VideoForm.tsx) ---

const ownershipOwner = {
  isCreatorOwner: true,
  isCollaboratorOwner: false,
  isOwner: true,
};

function makeOwnerNormalVm({
  canOfferAdminMode,
  canOfferEventMode,
  sections,
}) {
  const section = (key, label, isDangerousAdminOnly = false) =>
    sections[key]
      ? { editable: true, source: "owner_general", reason: "allowed", label }
      : {
          editable: false,
          source: "none",
          reason: isDangerousAdminOnly ? "admin_only" : "owner_policy_denied",
          label,
        };
  return {
    privilegeMode: "normal",
    ownership: ownershipOwner,
    canOfferAdminMode,
    canOfferEventMode,
    identity: section("identity", "提出者情報"),
    basics: section("basics", "作品タイトル・基本情報"),
    youtube: section("youtube", "YouTube URL"),
    credits: section("credits", "楽曲・クレジット"),
    descriptions: section("descriptions", "紹介文・振り返り"),
    members: section("members", "合作メンバー"),
    memberChapters: section("memberChapters", "メンバーチャプター"),
    primaryEvent: section("primaryEvent", "所属イベント"),
    visibility: section("visibility", "公開状態", true),
    permissions: section("permissions", "共同編集権限", true),
  };
}

test("resolvePermissionUnlockHint: editable なら null", () => {
  const vm = makeOwnerNormalVm({
    canOfferAdminMode: true,
    canOfferEventMode: true,
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
      permissions: true,
    },
  });
  assert.equal(resolvePermissionUnlockHint(vm.basics, vm), null);
});

test("resolvePermissionUnlockHint: admin_only は admin 案内", () => {
  const vm = makeOwnerNormalVm({
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
  assert.equal(resolvePermissionUnlockHint(vm.youtube, vm), "admin");
  // admin_only prioritizes admin even when event mode is also offered
  assert.equal(
    resolvePermissionUnlockHint(vm.visibility, {
      ...vm,
      canOfferEventMode: true,
    }),
    "admin",
  );
});

test("resolvePermissionUnlockHint: event 案内を優先できる", () => {
  const vm = makeOwnerNormalVm({
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
  assert.equal(resolvePermissionUnlockHint(vm.basics, vm), "event");
});

test("resolvePermissionUnlockHint: 一般作品権限拒否は event 案内を優先する", () => {
  const vm = makeOwnerNormalVm({
    canOfferAdminMode: true,
    canOfferEventMode: true,
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
  assert.equal(resolvePermissionUnlockHint(vm.youtube, vm), "event");
});

test("hasAnyEditableVideoFormSection: visibility/permissions は含めない", () => {
  const vm = makeOwnerNormalVm({
    canOfferAdminMode: false,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: false,
      primaryEvent: false,
      visibility: true,
      permissions: true,
    },
  });
  assert.equal(hasAnyEditableVideoFormSection(vm), false);
});

test("hasAnyEditableVideoFormSection: memberChapters を含める", () => {
  const vm = makeOwnerNormalVm({
    canOfferAdminMode: false,
    canOfferEventMode: false,
    sections: {
      identity: false,
      basics: false,
      youtube: false,
      credits: false,
      descriptions: false,
      members: false,
      memberChapters: true,
      primaryEvent: false,
      visibility: false,
      permissions: false,
    },
  });
  assert.equal(hasAnyEditableVideoFormSection(vm), true);
});

// --- 5. videoFormDraft (2 cases from CURRENT src/lib/video/videoFormDraft.test.mjs) ---

test("video draft keeps only whitelisted fields and serializes arbitrary question keys", () => {
  const formData = new FormData();
  formData.set("title", "作品");
  formData.set("youtube_url", "dQw4w9WgXcQ");
  formData.set("active_x_snapshot", "must-not-be-restored");
  formData.set("video_id", "server-value");
  const draft = buildVideoFormDraft({
    formData,
    customAnswers: { token: ["回答"] },
    stageAnswers: { "stage-1": "回答" },
    members: [],
    selectedEventIds: ["event-1"],
    selectedPart: "昼",
    isCollab: false,
    currentStep: 2,
    maxReachedStep: 3,
    baselineUpdatedAt: 10,
  });

  assert.equal(draft.fields.title, "作品");
  assert.equal("active_x_snapshot" in draft.fields, false);
  assert.equal("video_id" in draft.fields, false);
  assert.deepEqual(videoFormDraftAnswersToRecord(draft.customAnswers), {
    token: ["回答"],
  });
  assert.equal(draft.metadata.baselineUpdatedAt, 10);
});

test("video draft parses typed and legacy values and detects stale edit baselines", () => {
  const typed = parseVideoFormDraft({
    schemaVersion: "video-form-v1",
    fields: { title: "typed" },
    customAnswers: [{ key: "token", value: "safe" }],
    stageAnswers: [{ id: "q1", value: "yes" }],
    members: [],
    selectedEventIds: ["event-1"],
    selectedPart: "",
    isCollab: false,
    currentStep: 1,
    maxReachedStep: 1,
    metadata: { baselineUpdatedAt: 5 },
  });
  assert.ok(typed);
  assert.equal(videoFormDraftIsStale(typed, 6), true);
  assert.equal(videoFormDraftIsStale(typed, 5), false);

  const legacy = parseVideoFormDraft({
    title: "legacy",
    "custom_answer:event:token": "answer",
    members_json: "[]",
    event_ids: "event-1",
  });
  assert.ok(legacy);
  assert.equal(legacy.fields.title, "legacy");
  assert.deepEqual(videoFormDraftAnswersToRecord(legacy.customAnswers), {
    "event:token": "answer",
  });
  assert.deepEqual(legacy.selectedEventIds, ["event-1"]);
});

// --- 6. guardRedirect (6 cases from CURRENT src/lib/client/guardRedirect.test.mjs) ---

test("getGuardRedirectPath redirects unauthenticated to entry with next", () => {
  assert.equal(
    getGuardRedirectPath("unauthenticated", "/entry/unslotted"),
    "/entry?next=%2Fentry%2Funslotted",
  );
});

test("getGuardRedirectPath redirects TOS reasons to onboarding", () => {
  assert.equal(
    getGuardRedirectPath("tos_required", "/post"),
    "/onboarding?next=%2Fpost",
  );
  assert.equal(
    getGuardRedirectPath("tos_reaccept_required", "/post"),
    "/onboarding?next=%2Fpost",
  );
});

test("getGuardRedirectPath redirects Active X reasons to onboarding", () => {
  for (const reason of [
    "active_x_required",
    "active_x_rejected",
    "active_x_not_approved",
  ]) {
    assert.equal(
      getGuardRedirectPath(reason, "/entry/slotted?slot=s1"),
      "/onboarding?next=%2Fentry%2Fslotted%3Fslot%3Ds1",
    );
  }
});

test("getGuardRedirectPath does not redirect terminal error reasons", () => {
  for (const reason of [
    "banned",
    "maintenance_mode",
    "cost_guard_blocked",
    "db_unavailable",
  ]) {
    assert.equal(getGuardRedirectPath(reason, "/entry"), null);
    assert.equal(shouldShowGuardErrorOnly(reason), true);
  }
});

test("getGuardRedirectPath sanitizes unsafe next paths", () => {
  assert.equal(
    getGuardRedirectPath("unauthenticated", "https://evil.example/path"),
    "/entry?next=%2F",
  );
  assert.equal(
    getGuardRedirectPath("unauthenticated", "//evil.example/path"),
    "/entry?next=%2F",
  );
});

test("redirectForGuardReason pushes when redirectable", () => {
  const pushed = [];
  const ok = redirectForGuardReason(
    { push: (path) => pushed.push(path) },
    "active_x_required",
    "/entry",
  );
  assert.equal(ok, true);
  assert.deepEqual(pushed, ["/onboarding?next=%2Fentry"]);
});

// --- 7. activeXSwitchEvents (2 cases from CURRENT src/lib/client/activeXSwitchEvents.test.mjs) ---

test("activeXSwitchEvents は before/changed イベント定数と dispatch を export する", () => {
  const source = readFileSync(
    new URL("../src/lib/activeXSwitchEvents.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /export const ACTIVE_X_BEFORE_SWITCH_EVENT/);
  assert.match(source, /export const ACTIVE_X_CHANGED_EVENT/);
  assert.match(source, /export function dispatchBeforeActiveXSwitch/);
  assert.match(source, /export function dispatchActiveXChanged/);
  assert.match(source, /return !event\.defaultPrevented/);
});

test("dispatchBeforeActiveXSwitch は preventDefault で false を返す", () => {
  class MockEvent {
    type;
    detail;
    cancelable;
    defaultPrevented = false;

    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
      this.cancelable = options.cancelable ?? false;
    }

    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  const prevCustomEvent = globalThis.CustomEvent;
  const prevWindow = globalThis.window;
  globalThis.CustomEvent = MockEvent;
  globalThis.window = {
    dispatchEvent(event) {
      if (event.type === ACTIVE_X_BEFORE_SWITCH_EVENT) {
        event.preventDefault();
      }
      return true;
    },
  };

  try {
    assert.equal(
      dispatchBeforeActiveXSwitch({ fromXId: null, toXId: "foo" }),
      false,
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    if (prevCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = prevCustomEvent;
  }
});

// --- 8. submitFormCompat (4 cases from CURRENT src/lib/forms/submitFormCompat.test.mjs) ---

test("submitFormCompat uses requestSubmit with the form as this", () => {
  const calls = [];
  const form = {
    requestSubmit() {
      calls.push(this);
    },
  };

  submitFormCompat(form);

  assert.deepEqual(calls, [form]);
});

test("submitFormCompat validates before the legacy submit event", () => {
  const calls = [];
  const form = {
    checkValidity() {
      calls.push("check");
      return false;
    },
    reportValidity() {
      calls.push("report");
    },
    dispatchEvent() {
      calls.push("dispatch");
      return true;
    },
  };

  submitFormCompat(form);

  assert.deepEqual(calls, ["check", "report"]);
});

test("submitFormCompat dispatches a cancelable submit event for valid legacy forms", () => {
  let event = null;
  const form = {
    checkValidity() {
      return true;
    },
    dispatchEvent(nextEvent) {
      event = nextEvent;
      return true;
    },
  };

  submitFormCompat(form);

  assert.equal(event?.type, "submit");
  assert.equal(event?.bubbles, true);
  assert.equal(event?.cancelable, true);
});

test("submitFormCompat skips native validation when the form opts out", () => {
  const calls = [];
  const form = {
    noValidate: true,
    checkValidity() {
      calls.push("check");
      return false;
    },
    reportValidity() {
      calls.push("report");
    },
    dispatchEvent() {
      calls.push("dispatch");
      return true;
    },
  };

  submitFormCompat(form);

  assert.deepEqual(calls, ["dispatch"]);
});

// --- 9. useFormDraft (2 cases from CURRENT src/lib/interactions/useFormDraft.contract.test.mjs) ---

test("draft metadata accepts the same editor context only", () => {
  const expected = {
    schemaVersion: "event-form-v2",
    authUserId: "user-1",
    mode: "edit",
    eventId: "event-1",
    baseRevision: 42,
  };
  assert.equal(draftMetadataMatches(expected, { ...expected }), true);
  assert.equal(
    draftMetadataMatches(expected, { ...expected, baseRevision: 43 }),
    false,
  );
  assert.equal(
    draftMetadataMatches(expected, { ...expected, authUserId: "user-2" }),
    false,
  );
  assert.equal(draftMetadataMatches(expected, null), false);
});

test("draft hook exposes bounded autosave controls and lifecycle flushes", () => {
  const source = readFileSync(
    new URL("../src/lib/useFormDraft.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /ttlMs\?: number/);
  assert.match(source, /debounceMs\?: number/);
  assert.match(source, /maxBytes\?: number/);
  assert.match(source, /shouldSave\?: boolean/);
  assert.match(source, /flushDraft: \(nextValue\?: T\) => boolean/);
  assert.match(source, /lastSavedAt: number \| null/);
  assert.match(source, /saveError: string \| null/);
  assert.match(source, /pagehide/);
  assert.match(source, /visibilitychange/);
});

// --- 10. publicReflectionNotice (2 cases from CURRENT src/lib/staticRebuild/publicReflectionNotice.test.mjs) ---

test("markPendingPublicReflection は enqueue 時だけフラグを付ける", () => {
  assert.deepEqual(
    markPendingPublicReflection({ ok: true, message: "保存しました。" }, false),
    { ok: true, message: "保存しました。" },
  );
  assert.deepEqual(
    markPendingPublicReflection({ ok: true }, true),
    { ok: true, pendingPublicReflection: true },
  );
  assert.deepEqual(
    markPendingPublicReflection({ ok: false }, true),
    { ok: false },
  );
});

test("appendPublicReflectionDelayNotice は案内文を重複付与しない", () => {
  const once = appendPublicReflectionDelayNotice("保存しました。");
  assert.match(once, new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE));

  const twice = appendPublicReflectionDelayNotice(once);
  assert.equal(
    (twice.match(new RegExp(PUBLIC_REFLECTION_DELAY_MESSAGE, "g")) ?? []).length,
    1,
  );
  assert.equal(spreadsheetSaveStatusMessage("保存しました。", false), "保存しました。");
  assert.equal(spreadsheetSaveStatusMessage("保存しました。", true), once);
});

// --- 11. draftFileStore SSR-safe contract ---

test("draftFileStore exports 7-day TTL and safely no-ops without window.indexedDB", async () => {
  assert.equal(DRAFT_FILE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(await loadDraftFile("k"), null);
  assert.equal(await deleteDraftFile("k"), false);
  assert.equal(await cleanupExpiredDraftFiles(DRAFT_FILE_TTL_MS), 0);
  assert.equal(await saveDraftFile("k", new Blob(["x"])), false);
});

// --- 12. PublicReflectionDelayNotice & ErrorCallout renderToStaticMarkup (T04) ---

test("PublicReflectionDelayNotice renders CURRENT markup and default/custom classes", () => {
  const defaultHtml = renderToStaticMarkup(React.createElement(PublicReflectionDelayNotice));
  assert.equal(
    defaultHtml,
    `<p class="fn-muted fn-text-sm" style="margin:0">${PUBLIC_REFLECTION_DELAY_MESSAGE}</p>`,
  );

  const customHtml = renderToStaticMarkup(
    React.createElement(PublicReflectionDelayNotice, { className: "custom-notice" }),
  );
  assert.equal(
    customHtml,
    `<p class="custom-notice" style="margin:0">${PUBLIC_REFLECTION_DELAY_MESSAGE}</p>`,
  );
});

test("ErrorCallout renders null when empty and CURRENT CTA/tone/extraCta per reason", () => {
  assert.equal(renderToStaticMarkup(React.createElement(ErrorCallout, {})), "");

  const tosHtml = renderToStaticMarkup(
    React.createElement(ErrorCallout, { reason: "tos_required", message: "規約未同意" }),
  );
  assert.match(tosHtml, /role="alert"/);
  assert.match(tosHtml, /#b45309/);
  assert.match(tosHtml, /規約未同意/);
  assert.match(tosHtml, /href="\/onboarding\?next=%2F"/);
  assert.match(tosHtml, /class="fn-btn fn-btn-sm fn-btn-primary"/);
  assert.match(tosHtml, />利用規約を確認<\/a>/);

  const unauthHtml = renderToStaticMarkup(
    React.createElement(ErrorCallout, { reason: "unauthenticated" }),
  );
  assert.match(unauthHtml, /#b91c1c/);
  assert.match(unauthHtml, /エラーが発生しました/);
  assert.match(unauthHtml, /href="\/entry\?next=%2F"/);
  assert.match(unauthHtml, />ログイン<\/a>/);

  const activeXHtml = renderToStaticMarkup(
    React.createElement(ErrorCallout, { reason: "active_x_not_approved", message: "X未承認" }),
  );
  assert.match(activeXHtml, /#b91c1c/);
  assert.match(activeXHtml, /href="\/onboarding\?next=%2F"/);
  assert.match(activeXHtml, />初期設定を続ける<\/a>/);

  const dupHtml = renderToStaticMarkup(
    React.createElement(ErrorCallout, { reason: "duplicate_youtube_id", message: "重複" }),
  );
  assert.match(dupHtml, /#b91c1c/);
  assert.match(dupHtml, /href="\/list"/);
  assert.match(dupHtml, />既存作品を探す<\/a>/);

  const prevWindow = globalThis.window;
  globalThis.window = {
    location: { pathname: "/dashboard/edit/v1", search: "?from=list" },
  };
  try {
    const submitterHtml = renderToStaticMarkup(
      React.createElement(ErrorCallout, {
        reason: "submitter_change_denied",
        message: "提出者変更不可",
        extraCta: { href: "/dashboard", label: "戻る" },
      }),
    );
    assert.match(submitterHtml, /#b91c1c/);
    assert.match(submitterHtml, /href="\/dashboard\/edit\/v1\?from=list&amp;privileged=admin"/);
    assert.match(submitterHtml, />管理者モードに切替<\/a>/);
    assert.match(submitterHtml, /href="\/dashboard"/);
    assert.match(submitterHtml, /class="fn-btn fn-btn-sm fn-btn-ghost"/);
    assert.match(submitterHtml, />戻る<\/a>/);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }

  const costGuardHtml = renderToStaticMarkup(
    React.createElement(ErrorCallout, { reason: "cost_guard_blocked", message: "一時停止中" }),
  );
  assert.match(costGuardHtml, /#b45309/);
  assert.doesNotMatch(costGuardHtml, /<a /);
});

// --- 13. Static import hygiene across all 14 ported modules (T05) ---

test("MIG-0738 ported modules have provenance header and zero next/*, @/, or fetch(", () => {
  const portedPaths = [
    "../src/lib/youtubeId.ts",
    "../src/lib/publicReflectionNotice.ts",
    "../src/lib/videoTypes.ts",
    "../src/lib/videoFormSettings.ts",
    "../src/lib/requiredVideoFields.ts",
    "../src/lib/permissionUnlockHint.ts",
    "../src/lib/videoFormDraft.ts",
    "../src/lib/guardRedirect.ts",
    "../src/lib/activeXSwitchEvents.ts",
    "../src/lib/submitFormCompat.ts",
    "../src/lib/useFormDraft.ts",
    "../src/lib/draftFileStore.ts",
    "../src/components/ui/PublicReflectionDelayNotice.tsx",
    "../src/components/ui/ErrorCallout.tsx",
  ];
  for (const rel of portedPaths) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8");
    const firstLine = text.split(/\r?\n/, 1)[0];
    assert.match(
      firstLine,
      /^\/\/ Port of CURRENT .+ \(MIG-0738\)\. Same output\.$/,
      `${rel} missing provenance first line`,
    );
    assert.equal(text.includes("next/"), false, `${rel} must not import next/*`);
    assert.equal(text.includes("@/"), false, `${rel} must not use @/ alias`);
    assert.equal(text.includes("fetch("), false, `${rel} must not call fetch(`);
  }
});
