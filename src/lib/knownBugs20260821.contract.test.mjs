import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

test("dashboardはActive X表示・イベント重複排除・DB側の枠順序を使う", () => {
  const source = read("../../app/(auth)/dashboard/page.tsx");

  assert.match(source, /\bvideoEvents\b/);
  assert.match(
    source,
    /eq\(videosTable\.creator_x_user_id,\s*onboarding\.activeApprovedXId\)/,
  );
  assert.match(source, /\.selectDistinct\(\{[\s\S]*?linked_event_id:\s*videoEvents\.event_id/);
  assert.match(source, /event_count:\s*participatingEventIds\.size/);
  assert.match(
    source,
    /CASE WHEN \$\{slotsTable\.start_time\} IS NULL THEN 1 ELSE 0 END/,
  );
  assert.match(
    source,
    /asc\(slotsTable\.start_time\)[\s\S]*?asc\(slotsTable\.sort_order\)[\s\S]*?asc\(slotsTable\.id\)[\s\S]*?\.limit\(1\)/,
  );
  assert.doesNotMatch(source, /sortSlotsChronologically/);
});

test("募集カードと公開イベント画面は募集締切境界を同じ契約で扱う", () => {
  const recruitCard = read("../components/layout/EventRecruitCard.tsx");
  const eventPage = read("../../app/(public)/event/[id]/page.tsx");
  const slotsPage = read("../../app/(public)/event/[id]/slots/page.tsx");

  assert.match(recruitCard, /now >= event\.entry_end_time/);
  assert.match(recruitCard, /state === "accepting" \|\| state === "full"/);
  assert.match(recruitCard, /heading:\s*"募集締切まで"/);
  assert.match(recruitCard, /resolveCountdown\(event, now, state\)/);
  assert.match(eventPage, /now >= event\.entry_end_time/);
  assert.match(slotsPage, /now >= event\.entry_end_time/);
});

test("運営表示ロールはActive Xを最優先し権限unionは維持する", () => {
  const source = read("./auth/manageAuthorization.ts");

  assert.match(source, /active_x_user_id:\s*users\.active_x_user_id/);
  assert.match(source, /const isActiveX = Boolean\(xUserId && activeXUserId === xUserId\)/);
  assert.match(source, /const displayPriority = isActiveX\s*\? 2/);
  assert.match(source, /rolePriorityByEvent/);
  assert.match(source, /for \(const key of permissionKeys\) eventPermissions\.add\(key\)/);
});

test("枠表示名はX ID単位で分離しlegacy値はX未設定時だけ読む", () => {
  const source = read("../components/event/SlotGrid.tsx");
  const scopedIndex = source.indexOf("if (scoped) return scoped;");
  const xGuardIndex = source.indexOf('if (normalizedViewerXId) return "";');
  const legacyIndex = source.indexOf(
    "const legacy = window.localStorage.getItem(LEGACY_SLOT_DISPLAY_NAME_KEY);",
  );

  assert.ok(scopedIndex >= 0);
  assert.ok(xGuardIndex > scopedIndex);
  assert.ok(legacyIndex > xGuardIndex);
});

test("監査ログのactor X検証結果は入力単位で保持する", () => {
  const source = read("./audit/logger.ts");

  assert.match(
    source,
    /new Map<WriteAuditLogInput, string \| null>\(\)/,
  );
  assert.match(source, /actorXUserIdByInput\.set\(\s*input,/);
  assert.match(source, /actorXUserIdByInput\.get\(input\)/);
  assert.doesNotMatch(source, /actorXUserIdByAuditKey/);
});
