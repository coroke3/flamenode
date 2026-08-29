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

requireAll("src/components/event/SlotGrid.tsx", [
  [/annotateReservationGroups/, "枠確保表は annotateReservationGroups で1枠1行表示する必要があります。"],
  [/枠目/, "連続枠の n枠目 表示がありません。"],
  [/slotGroupPosition/, "連続枠位置の CSS class がありません。"],
  [/normalizeMaxSlotsPerVideo|countContiguousAvailableForward/, "イベント最大枠数の共通判定がありません。"],
]);
forbidMatch(
  "src/components/event/SlotGrid.tsx",
  /collapseReservationGroups/,
  "枠確保表で collapseReservationGroups を再導入しています（行が消えます）。",
);
forbidMatch(
  "src/components/event/SlotGrid.tsx",
  /Math\.min\([\s\S]*MAX_ATOMIC_SLOT_ROWS/,
  "枠確保表で最大枠数を MAX_ATOMIC_SLOT_ROWS(3) へ clamp しています。",
);
requireAll("src/components/event/SlotGrid.tsx", [
  [/createPortal/, "編集メニューは createPortal で overflow 外へ出してください。"],
  [/computeFloatingMenuPosition/, "編集メニューの viewport 配置計算がありません。"],
]);
forbidMatch(
  "src/components/event/SlotGrid.module.css",
  /\.partsRow\s*\{[^}]*overflow\s*:\s*visible/,
  "partsRow の overflow-x 横スクロールを visible で潰しています。",
);
requireAll("src/components/event/SlotGrid.module.css", [
  [/\.partsRow\s*\{[^}]*overflow-x:\s*auto/s, "partsRow の横スクロール (overflow-x:auto) がありません。"],
  [/\.slotActionMenu\s*\{[^}]*position:\s*fixed/s, "編集メニューは position:fixed である必要があります。"],
  [/--slot-row-height/, "slot row height CSS 変数 (--slot-row-height) がありません。"],
]);
requireAll("src/components/event/SlotGrid.tsx", [
  [/submitted_icon_url/, "提出済みアイコン (submitted_icon_url) の表示経路がありません。"],
  [/styles\.submittedIcon/, "submittedIcon CSS class がありません。"],
]);
requireMatch(
  "app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx",
  /const canTakeSlot\s*=\s*[\s\S]*viewerOverlay\.canReserveSlot[\s\S]*\(accepting\s*\|\|\s*viewerOverlay\.operatorOverrideAllowed\)/,
  "canTakeSlot は canReserveSlot ベースであり、event.slots の運営例外だけを追加する。",
);
requireMatch(
  "src/lib/slots/slotViewerOverlay.ts",
  /canUseSlotOperatorOverride\(eventRow, now\)/,
  "募集開始前の運営例外は共有境界ヘルパーで判定する。",
);
forbidMatch(
  "app/(public)/event/[id]/slots/EventSlotsViewerPanel.tsx",
  /canTakeSlot=\{[^}]*viewerXId\s*!=\s*null/,
  "canTakeSlot が viewerXId 必須になっています。",
);
requireMatch(
  "app/(public)/event/[id]/slots/page.tsx",
  /slot-submission-icon\/\$\{slot\.id\}/,
  "提出済みアイコン API パス (slot-submission-icon) がありません。",
);
forbidMatch(
  "src/components/settings/SettingsNoXIdOnboarding.tsx",
  /枠確保は X ID 申請後/,
  "枠確保に X ID 申請が必要と誤解される文言が残っています。",
);

requireAll("src/components/video/playerBridge.ts", [
  [/PLAYER_ENDED/, "再生終了イベント定数がありません。"],
  [/publishPlayerEnded/, "再生終了イベント発行がありません。"],
  [/YOUTUBE_PLAYER_STATE_ENDED|playerState/, "YouTube ended state 検知がありません。"],
]);
requireAll("src/components/forms/ImeSafeGetForm.tsx", [
  [/shouldBlockSearchKeySubmit/, "IME Enter ガードがありません。"],
  [/navigateGetForm/, "公開検索は navigateGetForm を再利用してください。"],
]);
forbidMatch(
  "src/components/forms/ImeSafeGetForm.tsx",
  /window\.open|target=\{["_']blank["_']\}/,
  "公開検索で別ウィンドウ遷移を導入しています。",
);
requireAll("src/components/layout/PublicHeader.tsx", [
  [/ImeSafeGetForm/, "公開ヘッダー検索は ImeSafeGetForm を使う必要があります。"],
]);
requireAll("app/(public)/list/page.tsx", [
  [/ImeSafeGetForm/, "作品一覧は ImeSafeGetForm を使う必要があります。"],
]);
requireAll("app/(public)/event/page.tsx", [
  [/ImeSafeGetForm/, "イベント一覧は ImeSafeGetForm を使う必要があります。"],
]);
requireAll("app/(public)/user/page.tsx", [
  [/ImeSafeGetForm/, "ユーザー一覧は ImeSafeGetForm を使う必要があります。"],
]);

requireAll("src/components/video/PlaylistRail.tsx", [
  [/flamenode:video-ended|PLAYER_ENDED/, "再生終了イベントの購読がありません。"],
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
  [/parseVideoMemberText/, "CSV/TSV入力経路がありません。"],
  [/viewMode.*"card".*"table"/s, "カード/表の表示切替がありません。"],
  [/<table\s+className=\{styles\.sampleTable\}/, "一括入力の実例表がありません。"],
  [/Alice[\s\S]*alice_x[\s\S]*0:12;1:05[\s\S]*モーション担当[\s\S]*>ON</, "実例表のAlice行がありません。"],
  [/Bob[\s\S]*bob123[\s\S]*0:30[\s\S]*背景担当[\s\S]*>OFF</, "実例表のBob行がありません。"],
]);
forbidMatch(
  "src/components/forms/VideoMembersField.tsx",
  /minHeight\s*:\s*28|padding\s*:\s*["']2px 8px["']/,
  "メンバー操作ボタンに28pxの局所サイズ指定が残っています。",
);
forbidMatch(
  "src/components/ui/StatusPanel.module.css",
  /border-(?:left|inline-start)/,
  "StatusPanelに片側アクセント線を再導入しています。",
);
forbidMatch(
  "src/components/forms/VideoForm.module.css",
  /linear-gradient|radial-gradient|\.sectionTitle::before|\.wizardDock::before|\.submitDock::before/,
  "VideoFormに装飾gradientまたは縦アクセント疑似要素が残っています。",
);
forbidMatch(
  "src/components/layout/PublicHeader.module.css",
  /\.mobileLinkActive\s*\{[^}]*?(?:border\s*:\s*1px|box-shadow\s*:\s*inset\s+3px\s+0)|header::after|linear-gradient|radial-gradient/,
  "PublicHeaderに装飾gradientまたは片側アクセントが残っています。",
);
requireAll("src/components/layout/PublicHeader.module.css", [
  [/\.mobileNav:focus-visible\s*\{[\s\S]*?outline:\s*0/, "モバイルダイアログのコンテナに不要なフォーカス枠が復活しています。"],
]);
forbidMatch(
  "src/components/event/SlotGrid.module.css",
  /\.rowMine[\s\S]*?box-shadow\s*:\s*inset\s+2px\s+0/,
  "SlotGridの自分の枠に片側アクセント線が残っています。",
);
requireAll("src/components/forms/VideoMembersField.module.css", [
  [/sampleTableScroll/, "実例表の横スクロールラッパがありません。"],
  [/min-width:\s*620px/, "実例表のモバイル横スクロール幅がありません。"],
  [/bulkPreviewTable/, "一括入力プレビュー表の共通スタイルがありません。"],
  [/bulkHintList/, "一括入力の列説明が共通spacingを使っていません。"],
]);
requireAll("app/(auth)/entry/slotted/page.tsx", [
  [/className="fn-entry-flow"/, "枠投稿ページが共通vertical rhythmを使っていません。"],
]);
requireAll("app/(auth)/entry/unslotted/page.tsx", [
  [/className="fn-entry-flow"/, "枠なし投稿ページが共通vertical rhythmを使っていません。"],
  [/fn-entry-search/, "イベント検索がentry共通vertical rhythmに接続されていません。"],
]);
requireAll("src/styles/globals.css", [
  [/\.fn-entry-flow\s*\{/, "entry共通stackがありません。"],
  [/gap:\s*clamp\(18px,\s*2\.4vw,\s*28px\)/, "entry共通stackのgap tokenがありません。"],
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
  "src/components/layout/PublicHeader.tsx",
  /aria-label=\{mobileOpen \? "メニューを閉じる" : "メニューを開く"\}/,
  "モバイルメニューボタンが開閉状態を読み上げません。",
);
requireAll("src/components/layout/PublicHeader.tsx", [
  [
    /mobileOpen\s*\?\s*styles\.headerMenuOpen/,
    "モバイルメニュー表示中に公開ヘッダーを画面へ固定していません。",
  ],
  [
    /className=\{styles\.headerMenuSpacer\}/,
    "モバイルメニュー表示中に公開ヘッダー分のレイアウト高を維持していません。",
  ],
  [
    /mobileHeaderRef\.current\?\.getBoundingClientRect\(\)\.height/,
    "モバイルメニュー固定前の実ヘッダー高を保存していません。",
  ],
  [
    /mobileScroll\.scrollTop\s*=\s*0/,
    "モバイルメニューを開く際に内部スクロール位置を先頭へ戻していません。",
  ],
]);
requireMatch(
  "src/styles/mobile-public.css",
  /@media\s*\(max-width:\s*900px\)[\s\S]*?--header-h:\s*50px/,
  "スマートフォンの固定ヘッダー高が50pxではありません。",
);
forbidMatch(
  "src/styles/mobile-public.css",
  /\.fn-shelf\[data-loop="true"\][\s\S]*?display:\s*block/,
  "mobile-publicがloop棚をdisplay:blockへ落として2行グリッドを壊しています。",
);
requireMatch(
  "src/styles/mobile-public.css",
  /\.fn-shelf:not\(\[data-mobile-rows="2"\]\)[\s\S]*?grid-auto-columns:\s*min\(82vw,\s*280px\)/,
  "mobile-publicの82vw列幅が2行Shelfへ上書きされています。",
);
requireMatch(
  "src/components/layout/PublicHeader.module.css",
  /@media\s*\(max-width:\s*900px\)[\s\S]*?\.header\s+\.bar\s*\{[^}]*height:\s*calc\(var\(--header-h,\s*50px\)\s*-\s*1px\)/,
  "モバイルヘッダーの実寸が境界線込み50pxに固定されていません。",
);
requireMatch(
  "src/components/layout/PublicHeader.module.css",
  /\.mobile\s*\{[^}]*border-top:\s*0[\s\S]*?\.mobileOpen\s*\{[^}]*border-top:\s*1px/,
  "閉じたモバイルメニューの境界線がヘッダー高へ加算されます。",
);
requireAll("app/(public)/page.tsx", [
  [
    /tooOldForHome/,
    "トップページが trending の鮮度判定に tooOldForHome を参照していません。",
  ],
  [
    /title="FlameNodeで注目"[\s\S]*?\{!isDegraded/,
    "FlameNodeで注目 セクションが isDegraded ブロックの外にありません。",
  ],
  [
    /Promise\.all\(\[[\s\S]*?loadStaticTopPage\(\)[\s\S]*?loadStaticTrending\(\)/,
    "トップページが top と trending を並列読込していません。",
  ],
  [
    /loadStaticTopPage\(\)/,
    "トップページが静的top JSONの読込を維持していません。",
  ],
  [
    /title="FlameNodeで注目"/,
    "トップに FlameNodeで注目 セクションがありません。",
  ],
  [
    /RankedVideoCard/,
    "トップの急上昇棚が RankedVideoCard を使っていません。",
  ],
  [
    /shuffledCopy\(\s*recommended\.slice\(0, TOP_SHELF_DISPLAY_LIMIT\),\s*\)/,
    "今週のピックアップを表示直前にランダム順へ変換していません。",
  ],
  [
    /randomizedRecommended\.map/,
    "今週のピックアップがランダム順の配列を描画していません。",
  ],
  [
    /shuffledCopy\(\s*latest\.slice\(0, TOP_LATEST_LOOP_DISPLAY_LIMIT\),\s*\)/,
    "新着を表示直前にランダム順へ変換していません。",
  ],
  [
    /title="懐かしの映像"[\s\S]*?nostalgicLoopItems\.map/,
    "3年以上前の作品を表示する懐かしの映像棚がありません。",
  ],
  [
    /autoScrollDirection="left"[\s\S]*?autoScrollDirection="right"[\s\S]*?autoScrollDirection="left"/,
    "トップの連続棚が左右交互のスクロール方向になっていません。",
  ],
]);
{
  const homePage = read("app/(public)/page.tsx");
  const topLoopShelfCount = (homePage.match(/<TopLoopShelf/g) ?? []).length;
  if (topLoopShelfCount !== 4) {
    errors.push(
      `app/(public)/page.tsx: トップページでTopLoopShelfが4箇所使われていません（${topLoopShelfCount}箇所）。`,
    );
  }
}
requireAll("src/components/layout/Shelf.tsx", [
  [/normalizeLoopScroll/, "棚の連続ループ正規化がありません。"],
  [/getLoopRotateCount/, "棚のループ回転数判定がありません。"],
  [/rotateForward/, "棚の前方ループ回転がありません。"],
  [/ensureColumnAligned/, "棚の列境界揃えがありません。"],
  [/normalizingRef/, "棚のスクロール正規化再入防止がありません。"],
]);
forbidMatch(
  "src/components/layout/TopLoopShelf.tsx",
  /flushSync/,
  "TopLoopShelfにflushSyncが残っています。",
);
requireAll("src/components/layout/TopLoopShelf.tsx", [
  [/data-loop-group/, "TopLoopShelfにループグループ属性がありません。"],
  [/neutralizeCloneFocusables/, "TopLoopShelfにcloneフォーカス無効化がありません。"],
  [/scrollend/, "TopLoopShelfにscrollendテレポートがありません。"],
  [/IntersectionObserver/, "TopLoopShelfにviewport外停止がありません。"],
  [/visibilitychange/, "TopLoopShelfに非表示tab停止がありません。"],
  [/pauseAfterInteraction/, "TopLoopShelfに操作後一時停止がありません。"],
  [/prefers-reduced-motion/, "TopLoopShelfにreduced motion対応がありません。"],
  [/pointerActiveRef/, "TopLoopShelfにpointer追跡がありません。"],
  [/ensureColumnAligned/, "TopLoopShelfに列境界揃えがありません。"],
  [/前へスクロール/, "TopLoopShelfの前矢印ラベルがShelfと一致していません。"],
  [/次へスクロール/, "TopLoopShelfの次矢印ラベルがShelfと一致していません。"],
]);
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
  /getCurrentUser|buildHeaderUser|await auth\(|CostGuardBanner/,
  "公開layoutにserver authやCostGuardBannerを置かず、静的シェルを維持します。",
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
  "src/components/layout/PublicHeader.module.css",
  /\.headerMenuOpen\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0\s+0\s+auto/s,
  "The open mobile menu header must stay fixed to the viewport while body scroll is locked.",
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
  [/isVisible/, "非表示パネル中の自動追従停止がありません。"],
]);

requireAll("src/components/video/ChapterComposer.tsx", [
  [
    /\)\s*:\s*bulkOnly\s*\?/,
    "inline-sheetでCSV一括登録見出しを表示しない分岐がありません。",
  ],
  [
    /isInlineSheet[\s\S]*?background:\s*"transparent"/,
    "inline-sheetのカード枠解除がありません。",
  ],
]);

requireAll("src/components/video/ChapterCommentPanel.tsx", [
  [
    /rootRef\.current\?\.querySelector/,
    "投稿後スクロールがチャプターパネル内に限定されていません。",
  ],
  [
    /Math\.floor\(\s*submittedChapter\.chapterTime/,
    "投稿時刻とdata-chapter-timeの整数化が一致していません。",
  ],
]);

requireAll("app/(public)/trending/page.tsx", [
  [/急上昇ランキング/, "trending ページのタイトルがありません。"],
  [/loadStaticTrending/, "trending ページが静的 trending JSON を読み込んでいません。"],
  [/formatUnix/, "trending ページが JST 最終更新を表示していません。"],
  [/TRENDING_PAGE_LIMIT = 30/, "trending ページが上位30件制限を持っていません。"],
  [/ランキングを準備中/, "trending ページの空状態メッセージがありません。"],
  [/showWeeklyViews/, "trending ページが週間視聴数を表示していません。"],
  [/fn-list-grid/, "trending ページのリストグリッドがありません。"],
]);
forbidMatch(
  "app/(public)/trending/page.tsx",
  /views_2d|views_5d|views_30d/,
  "trending ページが許可されていない期間別視聴数を表示しています。",
);
forbidMatch(
  "app/(public)/trending/page.tsx",
  /from "@\/components\/layout\/Shelf"|mobileRail|fn-shelf/,
  "trending ページにモバイル専用 Shelf が残っています。",
);
requireAll("src/components/video/RankedVideoCard.tsx", [
  [/showWeeklyViews/, "RankedVideoCard に showWeeklyViews がありません。"],
  [/views_7d/, "RankedVideoCard が views_7d を表示していません。"],
  [/1週間/, "RankedVideoCard の週間視聴数ラベルがありません。"],
]);
forbidMatch(
  "src/components/video/RankedVideoCard.tsx",
  /views_2d|views_5d|views_30d|viewCount|直近2日/,
  "RankedVideoCard が許可されていない期間別視聴数を表示しています。",
);

requireAll("app/(public)/recommend/page.tsx", [
  [/label: "人気作品"/, "recommend のチップが人気作品に改名されていません。"],
  [/title="人気作品"/, "recommend の人気作品レール見出しがありません。"],
  [/ariaLabel="人気作品"/, "recommend の人気作品 ARIA ラベルがありません。"],
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
  if (!/VideoViewerUtilityDock/.test(videoDetailPage)) {
    errors.push(
      "app/(public)/[id]/page.tsx: VideoViewerUtilityDock の import がありません。",
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
]);

requireMatch(
  "src/components/video/FixedVideoPlayerFrame.tsx",
  /data-video-player-boundary/,
  "プレイヤー境界を所有するフレームに data-video-player-boundary がありません。",
);

requireMatch(
  "src/components/video/mobileVideoGeometry.ts",
  /--fn-mobile-player-bottom/,
  "モバイルプレイヤー幾何にプレイヤー下端 CSS 変数の更新がありません。",
);

requireMatch(
  "src/components/video/mobileVideoGeometry.ts",
  /--fn-mobile-player-left/,
  "モバイルプレイヤー幾何にプレイヤー左端 CSS 変数の更新がありません。",
);

requireAll("src/components/video/FixedVideoPlayerFrame.module.css", [
  [/left:\s*var\(--fn-mobile-player-left,\s*0px\)/, "モバイルプレイヤーが実測左端へ配置されていません。"],
  [/margin:\s*0/, "モバイルプレイヤーの外側余白が打ち消されていません。"],
]);

forbidMatch(
  "app/(public)/[id]/page.module.css",
  /\.playerPane\s*\{[^}]*margin-inline:\s*calc\(\s*-1/s,
  "固定プレイヤーへページ余白の相殺を重ねています。",
);

requireAll("app/(public)/[id]/page.module.css", [
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.sideRail\s*\{[^}]*position:\s*static/s,
    "通常PCの sideRail がページ本体の流れへ戻っていません。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.sideRail\s*\{[^}]*max-height:\s*none/s,
    "通常PCの sideRail に高さ制限が残っています。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.sideRail\s*\{[^}]*overflow:\s*visible/s,
    "通常PCの関連動画がページ本体でスクロールできません。",
  ],
]);

requireAll("src/components/video/ChapterCommentPanel.module.css", [
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.list\s*\{[^}]*max-height:\s*clamp\(180px,\s*28svh,\s*220px\)/s,
    "通常PCのチャプターコメント一覧に約200pxの可変上限がありません。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.list\s*\{[^}]*overflow-y:\s*auto/s,
    "通常PCのチャプターコメント一覧に独立スクロールがありません。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.list\s*\{[^}]*overscroll-behavior:\s*contain/s,
    "通常PCのチャプターコメント一覧がoverscroll連鎖を抑止していません。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.list\s*\{[^}]*scrollbar-width:\s*thin/s,
    "通常PCのチャプターコメント一覧に細いスクロールバー指定がありません。",
  ],
  [
    /@media\s*\(min-width:\s*901px\)\s*\{[\s\S]*?\.list\s*\{[^}]*scrollbar-gutter:\s*stable/s,
    "通常PCのチャプターコメント一覧がスクロールバー領域を安定確保していません。",
  ],
]);

requireMatch(
  "src/components/video/ChapterCommentItem.tsx",
  /data-chapter-time=/,
  "投稿後スクロール用 data-chapter-time がありません。",
);

requireAll("src/styles/mobile-hardening.css", [
  [
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\[data-fn-surface="public"\],[\s\S]*?font-size:\s*15px/s,
    "モバイル本文のコンパクトな15px基準がありません。",
  ],
  [
    /\.fn-btn:not\(\.fn-btn-sm\):not\(\.fn-btn-icon\):not\(\.fn-btn-lg\)[\s\S]*?font-size:\s*13px/s,
    "モバイル通常ボタンの13px基準がありません。",
  ],
  [
    /\.fn-intro-copy\s*\{[^}]*font-size:\s*clamp\(30px,\s*8\.2vw,\s*40px\)/s,
    "モバイルトップ見出しのコンパクトな文字スケールがありません。",
  ],
  [
    /\.fn-console-title[\s\S]*?font-size:\s*clamp\(19px,\s*5\.4vw,\s*22px\)/s,
    "モバイル管理画面見出しのコンパクトな文字スケールがありません。",
  ],
]);

requireAll("src/components/layout/PublicHeader.module.css", [
  [
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\.mobileSearch input\s*\{[^}]*font-size:\s*16px/s,
    "モバイル検索欄のiOS自動ズーム防止サイズがありません。",
  ],
  [
    /@media\s*\(max-width:\s*640px\)[\s\S]*?\.mobileLink\s*\{[^}]*font-size:\s*13px/s,
    "モバイルメニューのコンパクトな文字サイズがありません。",
  ],
]);

requireMatch(
  "app/(auth)/entry/page.module.css",
  /@media\s*\(max-width:\s*640px\)[\s\S]*?\.cardTitle\s*\{[^}]*font-size:\s*20px/s,
  "モバイル投稿入口カードのコンパクトな見出しサイズがありません。",
);

forbidMatch(
  "src/components/layout/PublicFooter.tsx",
  /\/rules#contact/,
  "Footer Guide に問い合わせ (/rules#contact) を再導入しています。",
);
forbidMatch(
  "src/components/layout/PublicFooter.tsx",
  /Built on Cloudflare/,
  "Footer に Built on Cloudflare 表記を再導入しています。",
);
forbidMatch(
  "src/components/ui/Logo.tsx",
  /showSub|NODE\.0426/,
  "Logo に showSub / NODE.0426 を再導入しています。",
);
requireAll("app/(public)/about/page.tsx", [
  [/FlameNode Sans/, "About に FlameNode Sans クレジットがありません。"],
  [/https:\/\/www\.foriio\.com\/tomokidesign/, "About に foriio (tomokidesign) URL がありません。"],
  [/https:\/\/x\.com\/tomoki3192/, "About に X (tomoki3192) URL がありません。"],
  [/制作クレジット/, "About に制作クレジット見出しがありません。"],
]);

requireAll("app/(public)/event/[id]/release/page.tsx", [
  [/投稿予定のご案内/, "Release ページ見出しがありません。"],
]);
forbidMatch(
  "app/(public)/event/[id]/release/page.tsx",
  /fn-btn/,
  "Release ページで fn-btn を使っています。",
);
requireAll("app/(public)/event/[id]/release/ReleaseView.tsx", [
  [/aria-label="リスト表示"/, "Release リスト表示の aria-label がありません。"],
  [/aria-label="カード表示"/, "Release カード表示の aria-label がありません。"],
  [/aria-label="作者別表示"/, "Release 作者別表示の aria-label がありません。"],
  [/window\.history\.replaceState/, "Release hash 同期 (replaceState) がありません。"],
  [/youtubeThumbUrl/, "Release カード表示の youtubeThumbUrl がありません。"],
  [/個人参加/, "Release 個人参加セクションがありません。"],
  [/グループ参加/, "Release グループ参加セクションがありません。"],
  [/複数人/, "Release 複数人バッジがありません。"],
]);
forbidMatch(
  "app/(public)/event/[id]/release/ReleaseView.tsx",
  /fn-btn/,
  "ReleaseView で fn-btn を使っています。",
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
