#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const errors = [];

function read(relative) {
  const target = path.join(root, relative);
  if (!fs.existsSync(target)) {
    errors.push(`${relative} がありません。`);
    return "";
  }
  return fs.readFileSync(target, "utf8");
}

function requireMatch(relative, pattern, message) {
  const body = read(relative);
  if (body && !pattern.test(body)) errors.push(`${relative}: ${message}`);
}

function forbidMatch(relative, pattern, message) {
  const body = read(relative);
  if (body && pattern.test(body)) errors.push(`${relative}: ${message}`);
}

function requireAll(relative, checks) {
  const body = read(relative);
  if (!body) return;
  for (const [pattern, message] of checks) {
    if (!pattern.test(body)) errors.push(`${relative}: ${message}`);
  }
}

requireAll("app/(auth)/entry/page.tsx", [
  [/イベントに参加する/, "イベント参加カードがありません。"],
  [/過去の自分の作品を投稿する/, "枠なし投稿カードがありません。"],
  [/collapseReservationGroups/, "確保済み連続枠の表示統合がありません。"],
  [/groupedReservedSlots\.map\(\(slot\) =>/, "確保済み枠の統合表示がありません。"],
  [/const aNeedsSubmission = !a\.video_id && a\.status === "reserved"/, "未提出枠の優先表示がありません。"],
  [/const needsSubmission =\s*!slot\.video_id && slot\.status === "reserved"/s, "未提出枠の提出導線がありません。"],
  [/slot\.is_group.*slot\.group_size/s, "連続枠数の表示がありません。"],
]);

requireAll("src/components/forms/VideoForm.tsx", [
  [/"submitter"\s*\|\s*"work"\s*\|\s*"youtube"\s*\|\s*"confirm"/, "4段階投稿フローがありません。"],
  [/aria-current=\{index === currentStep \? "step"/, "現在ステップのアクセシビリティ表現がありません。"],
  [/scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/, "入力エラー箇所への移動がありません。"],
  [/setDirty\(true\)/, "未保存変更の追跡がありません。"],
]);

requireAll("src/components/forms/VideoMembersField.tsx", [
  [/onChange\?\.\(normalizedRows\)/, "正規化メンバーの即時通知がありません。"],
  [/MAX_VIDEO_MEMBERS/, "メンバー件数上限がありません。"],
  [/parseVideoMemberCsv/, "CSV入力経路がありません。"],
  [/viewMode.*"card".*"table"/s, "カード/表の表示切替がありません。"],
]);

requireAll("app/(public)/event/page.tsx", [
  [/name="q"/, "イベント検索queryがありません。"],
  [/name="status"/, "イベント状態filterがありません。"],
  [/name="sort"/, "イベント並び替えがありません。"],
  [/loadStaticEventsIndex/, "静的イベントindexの読込がありません。"],
  [/canFallbackToDatabase/, "D1 fallback判定がありません。"],
]);

requireAll("app/(public)/list/page.tsx", [
  [/rawView === "index".*rawView === "compact"/s, "grid/compact/index表示切替がありません。"],
  [/PAGE_SIZE = 24/, "一覧のbounded paginationがありません。"],
  [/loadStaticRecentVideosPage/, "静的作品一覧の読込がありません。"],
  [/Pagination/, "ページングUIがありません。"],
]);

requireAll("app/layout.tsx", [
  [/prefers-color-scheme: dark/, "OSテーマ判定がありません。"],
  [/fn-theme/, "保存済みテーマの読込がありません。"],
  [/data-theme-preference/, "テーマ選択状態がDOMへ反映されません。"],
]);

requireAll("src/components/layout/ThemeToggle.tsx", [
  [/\["light", "dark", "system"\]/, "light/dark/systemの3状態がありません。"],
  [/localStorage\.setItem/, "テーマ設定の保存がありません。"],
  [/aria-pressed/, "テーマ選択のアクセシビリティ表現がありません。"],
]);

requireAll("src/components/layout/ConsoleDrawer.tsx", [
  [/max-width: 760px/, "760px以下のモバイル判定がありません。"],
  [/event\.key === "Escape"/, "Escapeで閉じる処理がありません。"],
  [/event\.key !== "Tab"/, "フォーカストラップがありません。"],
  [/role=\{drawerOpen \? "dialog"/, "dialog roleがありません。"],
  [/aria-modal=\{drawerOpen \? true/, "aria-modalがありません。"],
  [/document\.body\.style\.overflow = "hidden"/, "開いている間の背面scroll抑止がありません。"],
  [/panel\.inert = isMobile && !drawerOpen/, "閉じたモバイルドロワーのフォーカス無効化がありません。"],
  [/scrollIntoView\(\{ block: "center" \}\)/, "現在ページへの自動スクロールがありません。"],
  [/onClickCapture=\{\(event\) =>/, "リンク選択時にドロワーを閉じる処理がありません。"],
]);

requireAll("src/components/layout/Shelf.tsx", [
  [/prefers-reduced-motion: reduce/, "reduced motion対応がありません。"],
  [/IntersectionObserver/, "viewport外停止がありません。"],
  [/visibilitychange/, "非表示tabでの停止がありません。"],
  [/data-mobile-rows=\{mobileRows\}/, "モバイル行数指定がありません。"],
  [/pauseAfterInteraction/, "操作後の自動送り一時停止がありません。"],
]);

requireMatch(
  "src/components/layout/ConsoleShell.tsx",
  /consoleMode: "admin" \| "manage"/,
  "admin/manage共通shellになっていません。",
);

const requiredWidths = [360, 390, 430, 640, 768, 1024, 1280, 1440, 1920];
const acceptanceDoc = read("docs/operations/ui-acceptance.md");
for (const width of requiredWidths) {
  if (acceptanceDoc && !new RegExp(`\\b${width}px\\b`).test(acceptanceDoc)) {
    errors.push(`docs/operations/ui-acceptance.md: ${width}px の確認基準がありません。`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`[check:ui-acceptance] ${error}`);
  process.exit(1);
}

console.log("[check:ui-acceptance] OK: entry grouping, posting, lists, theme, console drawer, Shelf, and breakpoint contracts are present.");
