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
  [/reservedSlots\.map\(\(slot\) =>/, "確保済み枠の1枠単位表示がありません。"],
  [/const aNeeds = !a\.video_id && a\.status === "reserved"/, "未提出枠の優先表示がありません。"],
  [/const needsSubmission =\s*!slot\.video_id && slot\.status === "reserved"/s, "未提出枠の提出導線がありません。"],
]);
forbidMatch(
  "app/(auth)/entry/page.tsx",
  /collapseReservationGroups/,
  "廃止した連続枠の表示統合を再導入しています。",
);

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
  [/staticLoaded\.mode === "unavailable"/, "unavailable 表示分岐がありません。"],
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
  [/\["light", "dark"\]/, "light/darkの2状態がありません。"],
  [/localStorage\.setItem/, "テーマ設定の保存がありません。"],
  [/aria-pressed/, "テーマ選択のアクセシビリティ表現がありません。"],
]);
forbidMatch(
  "src/components/layout/ThemeToggle.tsx",
  /OS設定/,
  "OS設定を明示する選択肢または文言が残っています。",
);

forbidMatch(
  "src/components/layout/PublicHeader.tsx",
  /XIdSwitcher/,
  "公開ヘッダーにX ID選択ボタンが残っています。",
);
requireMatch(
  "src/components/layout/PublicAccountIsland.tsx",
  /\/api\/account\/summary/,
  "公開アカウント島が account summary API を取得していません。",
);
requireMatch(
  "app/api/account/summary/route.ts",
  /private, no-store/,
  "account summary API が private no-store を返していません。",
);
forbidMatch(
  "app/(public)/layout.tsx",
  /getCurrentUser|buildHeaderUser|await auth\(/,
  "公開layoutにserver authが残っています。",
);
requireMatch(
  "app/(public)/layout.tsx",
  /CostGuardBanner/,
  "公開layoutにKV/envベースのCostGuardBannerがありません。",
);
forbidMatch(
  "app/(public)/layout.tsx",
  /source=["']admin["']/,
  "公開layoutのCostGuardBannerがadmin(D1正本)になっています。",
);
requireMatch(
  "src/components/layout/PublicHeader.module.css",
  /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/,
  "Desktop public navigation must use equal outer grid tracks so it is centered in the viewport.",
);
requireMatch(
  "src/components/layout/PublicHeader.module.css",
  /@media\s*\(min-width:\s*641px\)\s*and\s*\(max-width:\s*1180px\)[\s\S]*?\.menuToggle\s*\{[^}]*display:\s*inline-flex/s,
  "Public navigation must stay collapsed until both equal outer header tracks can contain the account actions.",
);
requireMatch(
  "src/components/layout/PublicHeader.module.css",
  /\.bar\s*\{[^}]*margin-inline:\s*auto/s,
  "The shared header rail must stay centered on admin and manage surfaces.",
);
requireMatch(
  "src/styles/redesign-public.css",
  /\[data-fn-surface="public"\]\s+\.fn-header-inner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/s,
  "The public surface override must preserve equal outer header tracks.",
);
requireMatch(
  "src/styles/admin-manage.css",
  /@media\s*\(min-width:\s*1001px\)[\s\S]*?\[data-fn-surface="admin"\]\s+\.fn-header-inner,[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content\s+minmax\(0,\s*1fr\)/,
  "Admin and manage desktop headers must preserve equal outer tracks.",
);
forbidMatch(
  "src/components/user/AccountMenu.tsx",
  /ThemeToggle/,
  "アカウントメニューにテーマ切替が残っています。テーマはヘッダー側へ集約します。",
);
requireMatch(
  "src/components/user/AccountMenu.tsx",
  /useActiveXSwitcher/,
  "アカウントメニューから Active X ID を切り替えられません。",
);
requireMatch(
  "src/components/user/AccountMenu.tsx",
  /別の X ID に切り替え/,
  "アカウントメニューに X ID 切替セクションがありません。",
);
requireMatch(
  "src/components/user/AccountMenu.tsx",
  /approval_status === "approved"/,
  "アカウントメニューの切替候補が承認済みに限定されていません。",
);
requireMatch(
  "src/components/user/useActiveXSwitcher.ts",
  /承認済みの X ID だけをアクティブにできます/,
  "未承認 X ID の切替をクライアント側で拒否していません。",
);
requireMatch(
  "src/components/user/AccountMenu.tsx",
  /href="\/dashboard\/settings"/,
  "X ID管理を設定画面へ集約する導線がありません。",
);

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

requireAll("src/components/video/ChapterTabs.tsx", [
  [/usePlayerTime/, "再生時刻の購読がありません。"],
  [/scrollIntoView/, "アクティブチャプターへの自動スクロールがありません。"],
  [/followPlayback|再生に追従/, "再生追従の切替がありません。"],
  [/findActiveChapterId/, "アクティブチャプター判定がありません。"],
]);

requireAll("src/components/layout/Shelf.tsx", [
  [/prefers-reduced-motion: reduce/, "reduced motion対応がありません。"],
  [/IntersectionObserver/, "viewport外停止がありません。"],
  [/visibilitychange/, "非表示tabでの停止がありません。"],
  [/data-mobile-rows=\{mobileRows\}/, "モバイル行数指定がありません。"],
  [/pauseAfterInteraction/, "操作後の自動送り一時停止がありません。"],
  [/pointerActiveRef/, "棚の外でpointerを離した場合の操作後停止がありません。"],
]);

forbidMatch(
  "src/components/layout/Shelf.tsx",
  /setPointerCapture/,
  "Shelf must not capture card pointer events because card links need to receive click completion.",
);

requireMatch(
  "src/components/layout/ConsoleShell.tsx",
  /consoleMode: "admin" \| "manage"/,
  "admin/manage共通shellになっていません。",
);

const videoDetailPage = read("app/(public)/[id]/page.tsx");
if (videoDetailPage) {
  if (!/VideoUtilityDock/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: VideoUtilityDock の import がありません。",
    );
  }
  if (/from "@\/components\/video\/ChapterTabs"/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: ChapterTabs を直接 import しています。",
    );
  }
  if (/from "@\/components\/video\/ChapterComposer"/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: ChapterComposer を直接 import しています。",
    );
  }
  if (/from "@\/components\/video\/PlaylistRail"/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: PlaylistRail を直接 import しています。",
    );
  }
  if (!/data-video-player-boundary/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: data-video-player-boundary がありません。",
    );
  }
  if (/fn-vd-login-panel/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: 旧ログインパネルが残っています。",
    );
  }
}

requireAll("src/components/video/VideoUtilityDock.tsx", [
  [/video-utility-playlist/, "再生リストパネル ID がありません。"],
  [/video-utility-chapters/, "チャプターパネル ID がありません。"],
  [/ChapterCommentPanel/, "ChapterCommentPanel が集約されていません。"],
  [/icon="list"/, "再生リストツールバーボタンがありません。"],
  [/icon="chapter"/, "チャプターツールバーボタンがありません。"],
  [/pushState/, "モバイルパネル用 history.pushState がありません。"],
  [/popstate/, "popstate でパネルを閉じる処理がありません。"],
  [/--fn-video-player-bottom/, "プレイヤー下端 CSS 変数の更新がありません。"],
]);

requireMatch(
  "src/components/video/ChapterCommentItem.tsx",
  /data-chapter-time=/,
  "投稿後スクロール用 data-chapter-time がありません。",
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

console.log("[check:ui-acceptance] OK: entry, posting, lists, theme, console drawer, ChapterTabs, video detail dock, Shelf, and breakpoint contracts are present.");
