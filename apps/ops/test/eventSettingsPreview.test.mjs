import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventSettingsPreview } from "../.test-dist/apps/ops/src/components/event/EventSettingsPreview.js";
import { GENERAL_CUSTOM_QUESTION_TYPE_LABELS } from "../.test-dist/apps/ops/src/lib/event/generalCustomQuestionDraft.js";

const render = event => renderToStaticMarkup(React.createElement(EventSettingsPreview, { event }));

test("MIG-0721 U01b-2: preview body matches CURRENT after bounded import rewriting", () => {
  const current = readFileSync(new URL("../../../src/components/admin/EventSettingsPreview.tsx", import.meta.url), "utf8");
  const port = readFileSync(new URL("../src/components/event/EventSettingsPreview.tsx", import.meta.url), "utf8");
  const adapted = current
    .replace('} from "@/lib/video/formSettings";','} from "../../lib/event/formSettings.js";')
    .replace('import { formatRequiredVideoFieldSummary } from "@/lib/video/requiredVideoFields";','import { formatRequiredVideoFieldSummary } from "@flamenode/domain/video";')
    .replace('import { buildAccentVars } from "@/lib/theme/accent";','import { buildAccentVars } from "../../lib/event/accent.js";')
    .replace('} from "@/lib/event/generalCustomQuestionDraft";','} from "../../lib/event/generalCustomQuestionDraft.js";');
  assert.ok(port.includes(adapted.trimEnd()), "preview UI must not silently diverge from CURRENT");
});

test("MIG-0721 U01b-2: empty preview remains accessible and fail-safe", () => {
  const html = render({});
  assert.match(html, /aria-label="イベント設定プレビュー"/);
  assert.match(html, /イベント名未入力/);
  assert.match(html, /下書き/);
  assert.match(html, /表示名とタイトルのみ/);
  assert.match(html, /追加質問は表示されません/);
  assert.match(html, /部の選択は表示されません/);
  assert.match(html, /時間枠/);
  assert.match(html, /無制限/);
});

test("MIG-0721 U01b-2: visibility, required fields, time bounds and slot settings follow CURRENT", () => {
  const html = render({
    title: "公開イベント", visibility_status: "public", event_type: "festival",
    start_time: "2026-11-12T08:00", end_time: "2026-11-12T18:00",
    entry_start_time: 1760000000, entry_end_time: null,
    slot_type: "count", max_slots_per_video: 4,
    max_slot_reservation_groups_per_xid: 2, slot_interval_minutes: 10,
    required_video_fields_json: '["music","youtube_url","not_a_field"]',
    allow_user_video_event_links: 1, allow_unslotted_posts: 0,
  });
  assert.match(html, /公開イベント/);
  assert.match(html, /festival/);
  assert.match(html, /fn-badge-accent/);
  assert.match(html, /2026-11-12 08:00/);
  assert.match(html, /件数枠/);
  assert.match(html, /4/);
  assert.match(html, /2 件/);
  assert.match(html, /使用楽曲、YouTube URL/);
  assert.match(html, /ユーザーの追加紐付け/);
  assert.match(html, /不許可/);
});

test("MIG-0721 U01b-2: malformed parts fail visibly, text parts override JSON", () => {
  const invalid = render({ parts_json: "{broken" });
  assert.match(invalid, /parts_json を解析できません/);
  assert.doesNotMatch(invalid, /部の選択は表示されません/);
  const valid = render({ parts_text: " 第1部\n\n 第2部 ", parts_json: "{broken" });
  assert.match(valid, /第1部/);
  assert.match(valid, /第2部/);
  assert.doesNotMatch(valid, /parts_json を解析できません/);
});

test("MIG-0721 U01b-2: stage permissions, general questions and theme colors render", () => {
  const html = render({
    accent_color: "#abc",
    video_form_settings_json: JSON.stringify({ stage_permissions: [
      { id:"stage_permission", enabled:true, required:true, label:"素材利用権" },
    ] }),
    general_custom_questions: [{
      clientId:"draft-1", question_key:"q1", label:"希望連絡先",
      description:"", type:"select", required:true,
      options:[" メール "," SNS "], placeholder:"", enabled:true,
    }],
  });
  assert.match(html, /--event-accent/);
  assert.match(html, /素材利用権/);
  assert.match(html, /希望連絡先/);
  assert.match(html, /プルダウン/);
  assert.match(html, /メール \/ SNS/);
  assert.equal(GENERAL_CUSTOM_QUESTION_TYPE_LABELS.checkbox, "チェックボックス");
  assert.equal(GENERAL_CUSTOM_QUESTION_TYPE_LABELS.radio, "選択（ボタン）");
});

test("MIG-0721 U01b-2: unrecognized or malformed configuration cannot inject HTML", () => {
  const html = render({ title:"<img src=x onerror=alert(1)>", parts_json:"{}", review_settings:"[broken" });
  assert.doesNotMatch(html, /<img src=x onerror=/);
  assert.match(html, /&lt;img/);
  assert.match(html, /parts_json は配列ではありません/);
  assert.match(html, /JSONを解析できません/);
});
